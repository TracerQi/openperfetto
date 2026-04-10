// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {ToolCall} from '../types/agent';
import {WebSocketMessage} from './websocket_client';
import {opLogger} from '../utils/logger';

/**
 * LLM 流式响应 usage 信息
 */
export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * LLM 流式响应回调接口
 */
export interface LLMStreamCallbacks {
  /** 收到文本增量 */
  onTextDelta: (text: string) => void;
  /** 收到工具调用 */
  onToolUse: (toolCall: ToolCall) => void;
  /** 流式响应完成 */
  onDone: (usage?: LLMUsage) => void;
  /** 发生错误 */
  onError: (error: string) => void;
}

/**
 * LLM 流式消息类型
 */
interface LLMStreamMessage {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'error' | 'done';
  agentId?: string;
  requestId?: string;
  payload?: {
    text?: string;
    toolCall?: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
    error?: string;
    usage?: LLMUsage;
    // 后端实际发送的 tool_use 数据直接在 payload 顶层
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

/**
 * LLM 流式响应处理器
 *
 * 功能：
 * - 监听 WebSocket 消息
 * - 解析 text_delta / tool_use / tool_result / error / done 消息
 * - 防抖缓冲：100ms 间隔合并 text_delta
 */
export class LLMStreamHandler {
  private callbacks: LLMStreamCallbacks | null = null;
  // Track which agent the stream belongs to
  private currentAgentId: string = '';
  private isStreaming: boolean = false;

  // 防抖缓冲
  private textBuffer: string = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 100;

  /**
   * 开始流式监听
   */
  startStream(agentId: string, callbacks: LLMStreamCallbacks): void {
    opLogger.info('LLM stream started', agentId);
    this.callbacks = callbacks;
    this.currentAgentId = agentId;
    this.isStreaming = true;
    this.textBuffer = '';

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * 停止流式监听
   */
  stopStream(): void {
    opLogger.info('LLM stream stopped', this.currentAgentId);
    this.flushTextBuffer();
    this.isStreaming = false;
    this.callbacks = null;
    this.currentAgentId = '';

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * 检查是否正在流式处理
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * 获取当前 Agent ID
   */
  getAgentId(): string {
    return this.currentAgentId;
  }

  /**
   * 处理 WebSocket 消息
   */
  handleMessage(message: WebSocketMessage): void {
    if (!this.isStreaming || !this.callbacks) {
      return;
    }

    // 解析为 LLM 流式消息
    const streamMsg = this.parseLLMMessage(message);
    if (!streamMsg) {
      return;
    }

    switch (streamMsg.type) {
      case 'text_delta':
        this.handleTextDelta(streamMsg.payload?.text || '');
        break;

      case 'tool_use':
        // 先刷新缓冲的文本
        this.flushTextBuffer();
        // 兼容两种格式：
        // 1. payload.toolCall (spec 格式)
        // 2. payload 本身就是 {id, name, arguments} (后端实际格式)
        {
          const toolPayload = streamMsg.payload as Record<string, unknown> | undefined;
          const toolCallData = toolPayload?.toolCall ?? toolPayload;
          if (
            toolCallData &&
            typeof toolCallData === 'object' &&
            'id' in toolCallData &&
            'name' in toolCallData
          ) {
            opLogger.debug('LLM tool_use received', (toolCallData as {name: string}).name);
            this.callbacks.onToolUse({
              id: (toolCallData as {id: string}).id,
              name: (toolCallData as {name: string}).name,
              arguments:
                ((toolCallData as unknown) as {arguments: Record<string, unknown>})
                  .arguments || {},
            });
          }
        }
        break;

      case 'tool_result':
        // Tool 结果由 AgentLoop 处理，这里不需要特殊处理
        break;

      case 'error':
        this.flushTextBuffer();
        {
          const errorPayload = streamMsg.payload as Record<string, unknown> | undefined;
          const errorMsg =
            (errorPayload?.error as string) ||
            (errorPayload?.message as string) ||
            'Unknown error';
          const errorCode = errorPayload?.code as string | undefined;
          const fullError = errorCode ? `[${errorCode}] ${errorMsg}` : errorMsg;
          opLogger.error('LLM stream error received', fullError);
          this.callbacks.onError(fullError);
        }
        this.isStreaming = false;
        break;

      case 'done':
        this.flushTextBuffer();
        opLogger.debug('LLM stream done', streamMsg.payload?.usage);
        this.callbacks.onDone(streamMsg.payload?.usage);
        this.isStreaming = false;
        break;
    }
  }

  /**
   * 解析 LLM 消息
   */
  private parseLLMMessage(message: WebSocketMessage): LLMStreamMessage | null {
    // 检查消息类型
    const validTypes = ['text_delta', 'tool_use', 'tool_result', 'error', 'done', 'chat_response'];
    
    if (!validTypes.includes(message.type)) {
      return null;
    }

    // chat_response 是包装类型，需要解析内部内容
    if (message.type === 'chat_response') {
      const payload = message.payload as {
        type?: string;
        text?: string;
        toolCall?: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        error?: string;
      };

      if (payload.type) {
        return {
          type: payload.type as LLMStreamMessage['type'],
          payload: {
            text: payload.text,
            toolCall: payload.toolCall,
            error: payload.error,
          },
        };
      }
    }

    return {
      type: message.type as LLMStreamMessage['type'],
      agentId: message.requestId,
      payload: message.payload as LLMStreamMessage['payload'],
    };
  }

  /**
   * 处理文本增量（带防抖）
   */
  private handleTextDelta(text: string): void {
    this.textBuffer += text;

    // 重置防抖定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushTextBuffer();
    }, LLMStreamHandler.DEBOUNCE_MS);
  }

  /**
   * 刷新文本缓冲区
   */
  private flushTextBuffer(): void {
    if (this.textBuffer.length > 0 && this.callbacks) {
      this.callbacks.onTextDelta(this.textBuffer);
      this.textBuffer = '';
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
