/**
 * LLM Provider 抽象层
 * 支持多 Provider（OpenAI、Anthropic）、熔断器、速率限制、故障转移
 */

import { StructuredLogger } from '../utils/logger.js';
import { getConfig, LLMProviderConfig } from '../utils/config.js';

const logger = new StructuredLogger('llm_proxy');

// ============= 类型定义 =============

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolResult?: unknown;
}

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMTool[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export type LLMStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string };

export interface LLMProvider {
  readonly name: string;
  chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
}

// ============= 熔断器状态 =============

export enum CircuitState {
  CLOSED = 'CLOSED',     // 正常状态
  OPEN = 'OPEN',         // 熔断状态
  HALF_OPEN = 'HALF_OPEN', // 半开状态，尝试恢复
}

// ============= 熔断器类 =============

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;     // 熔断后多久进入半开状态（毫秒）
  private readonly halfOpenSuccessThreshold: number;
  
  constructor(
    private readonly name: string,
    options: {
      failureThreshold?: number;
      resetTimeout?: number;
      halfOpenSuccessThreshold?: number;
    } = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000; // 30秒
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 3;
  }
  
  /**
   * 检查是否可以执行请求
   */
  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.state === CircuitState.OPEN) {
      // 检查是否应该进入半开状态
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`Circuit breaker ${this.name} entering HALF_OPEN state`);
        return true;
      }
      return false;
    }
    
    // HALF_OPEN 状态允许执行
    return true;
  }
  
  /**
   * 记录成功
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        logger.info(`Circuit breaker ${this.name} closed after recovery`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // 重置失败计数
      this.failureCount = 0;
    }
  }
  
  /**
   * 记录失败
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // 半开状态下失败，直接回到打开状态
      this.state = CircuitState.OPEN;
      logger.warn(`Circuit breaker ${this.name} reopened due to failure in HALF_OPEN state`);
      return;
    }
    
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn(`Circuit breaker ${this.name} opened after ${this.failureCount} failures`);
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  getStats(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }
}

// ============= 速率限制器 =============

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private tokenCount = 0;
  private windowStart = Date.now();
  
  constructor(
    private readonly rpm: number = 60,      // 每分钟请求数
    private readonly tpm: number = 100000   // 每分钟 Token 数
  ) {}
  
  /**
   * 检查是否可以发起请求
   */
  canMakeRequest(estimatedTokens = 0): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const windowMs = 60000; // 1分钟窗口
    
    // 清理过期的时间戳
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < windowMs);
    
    // 检查窗口是否需要重置
    if (now - this.windowStart >= windowMs) {
      this.tokenCount = 0;
      this.windowStart = now;
    }
    
    // 检查 RPM
    if (this.requestTimestamps.length >= this.rpm) {
      const oldestTimestamp = this.requestTimestamps[0];
      const retryAfterMs = windowMs - (now - oldestTimestamp);
      return { allowed: false, retryAfterMs };
    }
    
    // 检查 TPM
    if (this.tokenCount + estimatedTokens > this.tpm) {
      const retryAfterMs = windowMs - (now - this.windowStart);
      return { allowed: false, retryAfterMs };
    }
    
    return { allowed: true };
  }
  
  /**
   * 记录一次请求
   */
  recordRequest(tokens = 0): void {
    this.requestTimestamps.push(Date.now());
    this.tokenCount += tokens;
  }
  
  getStats(): { requestsInWindow: number; tokensInWindow: number } {
    return {
      requestsInWindow: this.requestTimestamps.length,
      tokensInWindow: this.tokenCount,
    };
  }
}

// ============= Token 计量器 =============

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  timestamp: number;
}

export class TokenMeter {
  private usageHistory: TokenUsage[] = [];
  private userQuotas: Map<string, { daily: number; used: number; resetAt: number }> = new Map();
  
  recordUsage(usage: TokenUsage): void {
    this.usageHistory.push(usage);
    
    // 只保留最近24小时的记录
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.usageHistory = this.usageHistory.filter(u => u.timestamp > dayAgo);
  }
  
  getUsageStats(): { total: number; byProvider: Record<string, number> } {
    const byProvider: Record<string, number> = {};
    let total = 0;
    
    for (const usage of this.usageHistory) {
      const tokens = usage.inputTokens + usage.outputTokens;
      total += tokens;
      byProvider[usage.provider] = (byProvider[usage.provider] || 0) + tokens;
    }
    
    return { total, byProvider };
  }
  
  setUserQuota(userId: string, dailyLimit: number): void {
    this.userQuotas.set(userId, {
      daily: dailyLimit,
      used: 0,
      resetAt: this.getNextMidnight(),
    });
  }
  
  checkUserQuota(userId: string, estimatedTokens: number): boolean {
    const quota = this.userQuotas.get(userId);
    if (!quota) return true; // 没有配额限制
    
    // 检查是否需要重置
    if (Date.now() > quota.resetAt) {
      quota.used = 0;
      quota.resetAt = this.getNextMidnight();
    }
    
    return quota.used + estimatedTokens <= quota.daily;
  }
  
  recordUserUsage(userId: string, tokens: number): void {
    const quota = this.userQuotas.get(userId);
    if (quota) {
      quota.used += tokens;
    }
  }
  
  private getNextMidnight(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }
}

// ============= OpenAI Provider =============

class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly maxTokens: number,
    private readonly baseUrl: string = 'https://api.openai.com/v1'
  ) {}
  
  async *chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const messages = this.buildMessages(request);
    
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      messages,
      stream: true,
    };
    
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }
    
    if (!response.body) {
      throw new Error('No response body from OpenAI');
    }
    
    // 解析 SSE 流
    yield* this.parseSSEStream(response.body);
  }
  
  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    
    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }
    
    return messages;
  }
  
  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    // 用于累积 tool call
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let inputTokens = 0;
    let outputTokens = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // 发送累积的 tool calls
            for (const [, tc] of toolCalls) {
              try {
                yield {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  arguments: JSON.parse(tc.arguments || '{}'),
                };
              } catch {
                yield {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  arguments: {},
                };
              }
            }
            
            yield {
              type: 'done',
              usage: { inputTokens, outputTokens },
            };
            return;
          }
          
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            
            // 提取 usage
            if (json.usage) {
              inputTokens = json.usage.prompt_tokens || 0;
              outputTokens = json.usage.completion_tokens || 0;
            }
            
            if (delta?.content) {
              yield { type: 'text_delta', text: delta.content };
            }
            
            // 处理 tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!toolCalls.has(index)) {
                  toolCalls.set(index, { id: tc.id || '', name: '', arguments: '' });
                }
                const existing = toolCalls.get(index)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}

// ============= Anthropic Provider =============

class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly maxTokens: number,
    private readonly baseUrl: string = 'https://api.anthropic.com'
  ) {}
  
  async *chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const messages = this.buildMessages(request);
    
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      messages,
      stream: true,
    };
    
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }
    
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }
    
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }
    
    if (!response.body) {
      throw new Error('No response body from Anthropic');
    }
    
    // 解析 SSE 流
    yield* this.parseSSEStream(response.body);
  }
  
  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    
    for (const msg of request.messages) {
      // Anthropic 不支持 system role 在 messages 中
      if (msg.role === 'system') continue;
      messages.push({ role: msg.role, content: msg.content });
    }
    
    return messages;
  }
  
  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (!data) continue;
          
          try {
            const event = JSON.parse(data);
            
            switch (event.type) {
              case 'message_start':
                if (event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens || 0;
                }
                break;
                
              case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                  currentToolId = event.content_block.id || '';
                  currentToolName = event.content_block.name || '';
                  currentToolArgs = '';
                }
                break;
                
              case 'content_block_delta':
                if (event.delta?.type === 'text_delta') {
                  yield { type: 'text_delta', text: event.delta.text };
                } else if (event.delta?.type === 'input_json_delta') {
                  currentToolArgs += event.delta.partial_json || '';
                }
                break;
                
              case 'content_block_stop':
                // 如果有累积的 tool call，发送它
                if (currentToolName) {
                  try {
                    yield {
                      type: 'tool_use',
                      id: currentToolId,
                      name: currentToolName,
                      arguments: JSON.parse(currentToolArgs || '{}'),
                    };
                  } catch {
                    yield {
                      type: 'tool_use',
                      id: currentToolId,
                      name: currentToolName,
                      arguments: {},
                    };
                  }
                  currentToolId = '';
                  currentToolName = '';
                  currentToolArgs = '';
                }
                break;
                
              case 'message_delta':
                if (event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }
                break;
                
              case 'message_stop':
                yield {
                  type: 'done',
                  usage: { inputTokens, outputTokens },
                };
                return;
                
              case 'error':
                yield {
                  type: 'error',
                  message: event.error?.message || 'Unknown Anthropic error',
                };
                return;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}

// ============= LLM 配置类型 =============

export interface LLMConfig {
  defaultProvider: string;
  providers: Record<string, LLMProviderConfig>;
  failoverOrder?: string[];
}

// ============= LLMProxy 主类 =============

export class LLMProxy {
  private providers: Map<string, LLMProvider> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private tokenMeter: TokenMeter;
  
  private readonly config: LLMConfig;
  private readonly retryConfig = {
    maxAttempts: 3,
    baseDelayMs: 1000, // 1秒
    maxDelayMs: 8000,  // 8秒
  };
  
  constructor(config?: LLMConfig) {
    this.config = config || getConfig().llm;
    this.tokenMeter = new TokenMeter();
    this.initializeProviders();
    this.initializeProtection();
  }
  
  private initializeProviders(): void {
    const providers = this.config.providers;
    
    for (const [name, providerConfig] of Object.entries(providers)) {
      if (!providerConfig.apiKey) {
        logger.debug(`Skipping provider ${name}: no API key configured`);
        continue;
      }
      
      switch (name) {
        case 'openai':
          this.providers.set(name, new OpenAIProvider(
            providerConfig.apiKey,
            providerConfig.model,
            providerConfig.maxTokens,
            providerConfig.baseUrl
          ));
          break;
          
        case 'anthropic':
          this.providers.set(name, new AnthropicProvider(
            providerConfig.apiKey,
            providerConfig.model,
            providerConfig.maxTokens,
            providerConfig.baseUrl
          ));
          break;
          
        default:
          logger.warn(`Unknown provider: ${name}`);
      }
    }
    
    logger.info(`Initialized ${this.providers.size} LLM providers`, {
      providers: Array.from(this.providers.keys()),
    });
  }
  
  private initializeProtection(): void {
    for (const name of this.providers.keys()) {
      this.circuitBreakers.set(name, new CircuitBreaker(name));
      this.rateLimiters.set(name, new RateLimiter(60, 100000));
    }
  }
  
  /**
   * 获取可用的 Provider（支持故障转移）
   */
  private getAvailableProvider(): string {
    const failoverOrder = this.config.failoverOrder || [this.config.defaultProvider];
    
    for (const providerName of failoverOrder) {
      // 检查 provider 是否存在
      if (!this.providers.has(providerName)) {
        continue;
      }
      
      // 检查熔断器
      const circuitBreaker = this.circuitBreakers.get(providerName);
      if (circuitBreaker && !circuitBreaker.canExecute()) {
        logger.warn(`Provider ${providerName} circuit breaker is OPEN, skipping`);
        continue;
      }
      
      // 检查速率限制
      const rateLimiter = this.rateLimiters.get(providerName);
      if (rateLimiter) {
        const { allowed } = rateLimiter.canMakeRequest();
        if (!allowed) {
          logger.warn(`Provider ${providerName} rate limited, skipping`);
          continue;
        }
      }
      
      return providerName;
    }
    
    throw new Error('No available LLM provider');
  }
  
  /**
   * 指数退避延迟
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 检查是否为不可重试错误
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('invalid api key') ||
        message.includes('authentication') ||
        message.includes('invalid_request') ||
        message.includes('401') ||
        message.includes('403')
      );
    }
    return false;
  }
  
  /**
   * 估算输入 Token 数
   */
  private estimateInputTokens(request: LLMRequest): number {
    let text = request.systemPrompt || '';
    text += request.messages.map(m => m.content).join(' ');
    if (request.tools) {
      text += JSON.stringify(request.tools);
    }
    // 粗略估算：每4个字符约1个token
    return Math.ceil(text.length / 4);
  }
  
  /**
   * 核心聊天方法（流式）
   */
  async *chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    let lastError: Error | undefined;
    let providerName: string | undefined;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        // 获取可用 provider
        providerName = this.getAvailableProvider();
        const provider = this.providers.get(providerName)!;
        
        logger.debug(`Using provider ${providerName}, attempt ${attempt}/${this.retryConfig.maxAttempts}`);
        
        // 记录请求
        const rateLimiter = this.rateLimiters.get(providerName);
        const estimatedTokens = this.estimateInputTokens(request);
        
        if (rateLimiter) {
          const { allowed, retryAfterMs } = rateLimiter.canMakeRequest(estimatedTokens);
          if (!allowed) {
            yield {
              type: 'error',
              message: `Rate limited. Retry after ${retryAfterMs}ms`,
            };
            return;
          }
        }
        
        // 执行请求
        let inputTokens = 0;
        let outputTokens = 0;
        
        for await (const chunk of provider.chat(request)) {
          if (chunk.type === 'done' && chunk.usage) {
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
          }
          yield chunk;
          
          // 成功收到响应，记录成功
          if (chunk.type === 'done') {
            this.circuitBreakers.get(providerName)?.recordSuccess();
            rateLimiter?.recordRequest(inputTokens + outputTokens);
            
            // 记录 token 使用
            this.tokenMeter.recordUsage({
              inputTokens,
              outputTokens,
              provider: providerName,
              model: this.config.providers[providerName]?.model || 'unknown',
              timestamp: Date.now(),
            });
          }
        }
        
        return; // 成功完成
        
      } catch (error) {
        lastError = error as Error;
        
        // 不可重试错误
        if (this.isNonRetryableError(error)) {
          yield {
            type: 'error',
            message: lastError.message,
          };
          return;
        }
        
        // 记录失败
        if (providerName) {
          this.circuitBreakers.get(providerName)?.recordFailure();
        }
        
        logger.warn(`LLM request failed, attempt ${attempt}/${this.retryConfig.maxAttempts}`, {
          provider: providerName,
          error: lastError.message,
        });
        
        if (attempt < this.retryConfig.maxAttempts) {
          // 指数退避：1s, 2s, 4s
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
            this.retryConfig.maxDelayMs
          );
          await this.sleep(delay);
        }
      }
    }
    
    // 所有重试失败
    yield {
      type: 'error',
      message: lastError?.message || 'All retry attempts failed',
    };
  }
  
  // ============= 公开方法 =============
  
  /**
   * 获取 Token 使用统计
   */
  getTokenUsageStats(): { total: number; byProvider: Record<string, number> } {
    return this.tokenMeter.getUsageStats();
  }
  
  /**
   * 设置用户 Token 配额
   */
  setUserTokenQuota(userId: string, dailyLimit: number): void {
    this.tokenMeter.setUserQuota(userId, dailyLimit);
  }
  
  /**
   * 获取熔断器状态
   */
  getCircuitBreakerStates(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {};
    for (const [name, breaker] of this.circuitBreakers) {
      states[name] = breaker.getState();
    }
    return states;
  }
  
  /**
   * 获取速率限制器状态
   */
  getRateLimiterStats(): Record<string, { requestsInWindow: number; tokensInWindow: number }> {
    const stats: Record<string, { requestsInWindow: number; tokensInWindow: number }> = {};
    for (const [name, limiter] of this.rateLimiters) {
      stats[name] = limiter.getStats();
    }
    return stats;
  }
  
  /**
   * 检查是否有可用的 provider
   */
  hasAvailableProvider(): boolean {
    try {
      this.getAvailableProvider();
      return true;
    } catch {
      return false;
    }
  }
}

export default LLMProxy;
