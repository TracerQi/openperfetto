/**
 * LLM Provider 抽象层
 * 支持多 Provider（OpenAI、Anthropic）、熔断器、速率限制、故障转移
 */
import { LLMProviderConfig } from '../utils/config.js';
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
export type LLMStreamChunk = {
    type: 'text_delta';
    text: string;
} | {
    type: 'tool_use';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
} | {
    type: 'done';
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
} | {
    type: 'error';
    message: string;
};
export interface LLMProvider {
    readonly name: string;
    chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
}
export declare enum CircuitState {
    CLOSED = "CLOSED",// 正常状态
    OPEN = "OPEN",// 熔断状态
    HALF_OPEN = "HALF_OPEN"
}
export declare class CircuitBreaker {
    private readonly name;
    private state;
    private failureCount;
    private successCount;
    private lastFailureTime;
    private readonly failureThreshold;
    private readonly resetTimeout;
    private readonly halfOpenSuccessThreshold;
    constructor(name: string, options?: {
        failureThreshold?: number;
        resetTimeout?: number;
        halfOpenSuccessThreshold?: number;
    });
    /**
     * 检查是否可以执行请求
     */
    canExecute(): boolean;
    /**
     * 记录成功
     */
    recordSuccess(): void;
    /**
     * 记录失败
     */
    recordFailure(): void;
    getState(): CircuitState;
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
    };
}
export declare class RateLimiter {
    private readonly rpm;
    private readonly tpm;
    private requestTimestamps;
    private tokenCount;
    private windowStart;
    constructor(rpm?: number, // 每分钟请求数
    tpm?: number);
    /**
     * 检查是否可以发起请求
     */
    canMakeRequest(estimatedTokens?: number): {
        allowed: boolean;
        retryAfterMs?: number;
    };
    /**
     * 记录一次请求
     */
    recordRequest(tokens?: number): void;
    getStats(): {
        requestsInWindow: number;
        tokensInWindow: number;
    };
}
interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
    timestamp: number;
}
export declare class TokenMeter {
    private usageHistory;
    private userQuotas;
    recordUsage(usage: TokenUsage): void;
    getUsageStats(): {
        total: number;
        byProvider: Record<string, number>;
    };
    setUserQuota(userId: string, dailyLimit: number): void;
    checkUserQuota(userId: string, estimatedTokens: number): boolean;
    recordUserUsage(userId: string, tokens: number): void;
    private getNextMidnight;
}
export interface LLMConfig {
    defaultProvider: string;
    providers: Record<string, LLMProviderConfig>;
    failoverOrder?: string[];
}
export declare class LLMProxy {
    private providers;
    private circuitBreakers;
    private rateLimiters;
    private tokenMeter;
    private readonly config;
    private readonly retryConfig;
    private static readonly STREAM_TIMEOUT_MS;
    private static readonly STREAM_CHECK_INTERVAL_MS;
    constructor(config?: LLMConfig);
    private initializeProviders;
    private initializeProtection;
    /**
     * 获取可用的 Provider（支持故障转移）
     */
    private getAvailableProvider;
    /**
     * 指数退避延迟
     */
    private sleep;
    /**
     * 检查是否为不可重试错误
     */
    private isNonRetryableError;
    /**
     * 估算输入 Token 数
     */
    private estimateInputTokens;
    /**
     * 核心聊天方法（流式），包含流超时保护
     */
    chat(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
    /**
     * 获取 Token 使用统计
     */
    getTokenUsageStats(): {
        total: number;
        byProvider: Record<string, number>;
    };
    /**
     * 设置用户 Token 配额
     */
    setUserTokenQuota(userId: string, dailyLimit: number): void;
    /**
     * 获取熔断器状态
     */
    getCircuitBreakerStates(): Record<string, CircuitState>;
    /**
     * 获取速率限制器状态
     */
    getRateLimiterStats(): Record<string, {
        requestsInWindow: number;
        tokensInWindow: number;
    }>;
    /**
     * 检查是否有可用的 provider
     */
    hasAvailableProvider(): boolean;
}
export default LLMProxy;
//# sourceMappingURL=llm_proxy.d.ts.map