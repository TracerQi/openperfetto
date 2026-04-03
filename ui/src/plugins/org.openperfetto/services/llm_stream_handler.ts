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

/**
 * LLM 流式响应回调接口
 */
export interface LLMStreamCallbacks {
  /** 收到文本增量 */
  onTextDelta: (text: string) => void;
  /** 收到工具调用 */
  onToolUse: (toolCall: ToolCall) => void;
  /** 流式响应完成 */
  onDone: () => void;
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
        if (streamMsg.payload?.toolCall) {
          this.callbacks.onToolUse({
            id: streamMsg.payload.toolCall.id,
            name: streamMsg.payload.toolCall.name,
            arguments: streamMsg.payload.toolCall.arguments,
          });
        }
        break;

      case 'tool_result':
        // Tool 结果由 AgentLoop 处理，这里不需要特殊处理
        break;

      case 'error':
        this.flushTextBuffer();
        this.callbacks.onError(streamMsg.payload?.error || 'Unknown error');
        this.isStreaming = false;
        break;

      case 'done':
        this.flushTextBuffer();
        this.callbacks.onDone();
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
