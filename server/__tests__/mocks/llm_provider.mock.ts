/**
 * LLM Provider Mock
 * 
 * 模拟 LLM Provider 的行为，用于单元测试
 */

import type {
  LLMMessage,
  LLMTool,
  LLMRequest,
  LLMStreamChunk,
  LLMProvider,
} from '../../src/services/llm_proxy.js';

// 重新导出类型方便使用
export type { LLMMessage, LLMTool, LLMRequest, LLMStreamChunk, LLMProvider };

/**
 * Mock 响应配置
 */
export interface MockLLMResponse {
  /** 要返回的文本片段 */
  textChunks?: string[];
  /** 要返回的工具调用 */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** 使用量统计 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** 是否应该抛出错误 */
  shouldError?: boolean;
  /** 错误消息 */
  errorMessage?: string;
  /** 模拟延迟（毫秒） */
  delayMs?: number;
  /** 是否模拟超时（在指定时间后停止响应） */
  simulateTimeout?: boolean;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * Mock LLM Provider
 * 
 * 提供可配置的 LLM 响应模拟
 */
export class MockLLMProvider implements LLMProvider {
  readonly name: string;
  private responses: MockLLMResponse[] = [];
  private currentResponseIndex = 0;
  private defaultResponse: MockLLMResponse = {
    textChunks: ['Hello, I am a mock LLM response.'],
    usage: { inputTokens: 10, outputTokens: 20 },
  };

  constructor(name = 'mock-provider') {
    this.name = name;
  }

  /**
   * 设置将要返回的响应序列
   */
  setResponses(responses: MockLLMResponse[]): void {
    this.responses = responses;
    this.currentResponseIndex = 0;
  }

  /**
   * 设置默认响应（当响应序列用完时使用）
   */
  setDefaultResponse(response: MockLLMResponse): void {
    this.defaultResponse = response;
  }

  /**
   * 重置 mock 状态
   */
  reset(): void {
    this.responses = [];
    this.currentResponseIndex = 0;
  }

  /**
   * 获取当前响应
   */
  private getCurrentResponse(): MockLLMResponse {
    if (this.currentResponseIndex < this.responses.length) {
      return this.responses[this.currentResponseIndex++];
    }
    return this.defaultResponse;
  }

  /**
   * 模拟聊天接口
   */
  async *chat(_request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const response = this.getCurrentResponse();

    // 模拟延迟
    if (response.delayMs) {
      await this.sleep(response.delayMs);
    }

    // 模拟错误
    if (response.shouldError) {
      yield {
        type: 'error',
        message: response.errorMessage || 'Mock LLM error',
      };
      return;
    }

    // 模拟超时
    if (response.simulateTimeout) {
      await this.sleep(response.timeoutMs || 35000);
      // 超时后不返回任何东西，让调用者处理超时逻辑
      return;
    }

    // 返回文本片段
    if (response.textChunks) {
      for (const text of response.textChunks) {
        yield { type: 'text_delta', text };
        // 模拟流式传输的小延迟
        await this.sleep(10);
      }
    }

    // 返回工具调用
    if (response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        yield {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        };
      }
    }

    // 返回完成信号
    yield {
      type: 'done',
      usage: response.usage || { inputTokens: 0, outputTokens: 0 },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建一个配置好的 Mock Provider 的工厂函数
 */
export function createMockLLMProvider(
  config?: Partial<{
    name: string;
    responses: MockLLMResponse[];
    defaultResponse: MockLLMResponse;
  }>
): MockLLMProvider {
  const provider = new MockLLMProvider(config?.name);
  
  if (config?.responses) {
    provider.setResponses(config.responses);
  }
  
  if (config?.defaultResponse) {
    provider.setDefaultResponse(config.defaultResponse);
  }
  
  return provider;
}

/**
 * 预定义的响应场景
 */
export const MockScenarios = {
  /** 简单的文本响应 */
  simpleText: (text: string): MockLLMResponse => ({
    textChunks: [text],
    usage: { inputTokens: 10, outputTokens: text.length / 4 },
  }),

  /** 多个文本片段的流式响应 */
  streamingText: (chunks: string[]): MockLLMResponse => ({
    textChunks: chunks,
    usage: { inputTokens: 10, outputTokens: chunks.join('').length / 4 },
  }),

  /** 工具调用响应 */
  toolCall: (
    name: string,
    args: Record<string, unknown>,
    id = 'tool_call_1'
  ): MockLLMResponse => ({
    toolCalls: [{ id, name, arguments: args }],
    usage: { inputTokens: 10, outputTokens: 50 },
  }),

  /** 文本 + 工具调用组合响应 */
  textWithToolCall: (
    text: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): MockLLMResponse => ({
    textChunks: [text],
    toolCalls: [{ id: 'tool_1', name: toolName, arguments: toolArgs }],
    usage: { inputTokens: 10, outputTokens: 100 },
  }),

  /** 错误响应 */
  error: (message: string): MockLLMResponse => ({
    shouldError: true,
    errorMessage: message,
  }),

  /** 超时场景 */
  timeout: (timeoutMs = 35000): MockLLMResponse => ({
    simulateTimeout: true,
    timeoutMs,
  }),

  /** 延迟响应 */
  delayed: (text: string, delayMs: number): MockLLMResponse => ({
    textChunks: [text],
    delayMs,
    usage: { inputTokens: 10, outputTokens: text.length / 4 },
  }),
};
