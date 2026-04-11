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

import {ConnectionState} from '../types/plugin_state';
import {opLogger} from '../utils/logger';

/**
 * WebSocket 消息类型
 */
export interface WebSocketMessage {
  type: string;
  payload?: unknown;
  data?: unknown;  // 后端使用 data 字段
  requestId?: string;
  traceId?: string;
  timestamp?: number;  // 用于 ping/pong
}

type StateChangeCallback = (state: ConnectionState) => void;
type MessageCallback = (message: WebSocketMessage) => void;

/**
 * WebSocket 客户端
 *
 * 功能：
 * - 单例模式
 * - 自动重连（指数退避：1s/2s/4s/8s/16s，最大30s）
 * - 心跳机制（每30秒发送ping）
 * - 连接状态管理
 */
export class WebSocketClient {
  private static instance: WebSocketClient | null = null;

  private ws: WebSocket | null = null;
  private url: string = 'ws://localhost:3001/ws';
  private connectionState: ConnectionState = {status: 'disconnected'};

  // 重连相关
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000; // 最大重连延迟 30s
  private readonly baseReconnectDelay = 1000; // 基础重连延迟 1s
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // 心跳相关
  private readonly heartbeatInterval = 30000; // 心跳间隔 30s
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 离线消息队列
  private pendingMessages: Array<{data: unknown; timestamp: number}> = [];
  private static readonly MAX_PENDING_MESSAGES = 50;
  private static readonly PENDING_MESSAGE_TTL = 30000; // 30秒

  // 回调
  private stateChangeCallbacks: Set<StateChangeCallback> = new Set();
  private messageCallbacks: Set<MessageCallback> = new Set();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }

  /**
   * 配置服务器 URL
   */
  setUrl(url: string): void {
    this.url = url;
  }

  /**
   * 获取当前连接状态
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 建立连接
   */
  connect(): void {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    opLogger.info('[WS] Connecting...', {url: this.url});
    this.updateState({status: 'connecting'});

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.updateState({status: 'error', message});
      this.scheduleReconnect();
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    opLogger.info('[WS] Disconnecting');
    this.stopHeartbeat();
    this.cancelReconnect();

    if (this.ws) {
      this.ws.onclose = null; // 阻止触发重连
      this.ws.close();
      this.ws = null;
    }

    this.updateState({status: 'disconnected'});
  }

  /**
   * 发送消息
   * 如果 WebSocket 未连接，会将消息缓存到队列中
   */
  send(message: WebSocketMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        const serialized = JSON.stringify(message);
        opLogger.info('[WS] >>> Send message', {
          type: message.type,
          size: serialized.length,
          traceId: message.traceId,
        });
        this.ws.send(serialized);
        return true;
      } catch (error) {
        opLogger.error('[WS] Failed to send WebSocket message:', error);
        return false;
      }
    }

    // 缓存消息（非 ping 类型）
    if (message.type !== 'ping') {
      this.pendingMessages.push({data: message, timestamp: Date.now()});
      if (this.pendingMessages.length > WebSocketClient.MAX_PENDING_MESSAGES) {
        this.pendingMessages.shift(); // 丢弃最旧的
      }
      opLogger.warn('WebSocket not connected, message queued');
    }
    return false;
  }

  /**
   * 发送队列中的待发送消息
   */
  private flushPendingMessages(): void {
    const now = Date.now();
    const validMessages = this.pendingMessages.filter(
      (m) => now - m.timestamp < WebSocketClient.PENDING_MESSAGE_TTL,
    );
    this.pendingMessages = [];
    for (const msg of validMessages) {
      this.send(msg.data as WebSocketMessage);
    }
  }

  /**
   * 注册状态变更回调
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    // 立即通知当前状态
    callback(this.connectionState);
    // 返回取消注册函数
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * 注册消息接收回调
   */
  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      opLogger.info('[WS] <<< Connected', {url: this.url});
      this.updateState({status: 'connected', agentId: this.generateAgentId()});
      this.startHeartbeat();
      this.flushPendingMessages();
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      opLogger.info('[WS] <<< Closed', {code: event.code, wasClean: event.wasClean});
      if (event.wasClean) {
        this.updateState({status: 'disconnected'});
      } else {
        this.updateState({
          status: 'error',
          message: `Connection closed unexpectedly (code: ${event.code})`,
        });
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // WebSocket error events don't provide detailed error info
      this.updateState({status: 'error', message: 'WebSocket connection error'});
    };

    this.ws.onmessage = (event) => {
      try {
        const rawMessage = JSON.parse(event.data) as WebSocketMessage;

        opLogger.debug('[WS] <<< Raw message received', {
          type: rawMessage.type,
          hasPayload: !!rawMessage.payload,
          hasData: !!rawMessage.data,
        });

        // 将后端的 data 字段映射为 payload（兼容处理）
        const message: WebSocketMessage = {
          ...rawMessage,
          payload: rawMessage.payload ?? rawMessage.data,
        };

        // 处理 pong 响应
        if (message.type === 'pong') {
          opLogger.debug('[WS] <<< Pong received');
          return;
        }

        opLogger.info('[WS] <<< Message dispatched to callbacks', {
          type: message.type,
          payloadKeys: message.payload ? Object.keys(message.payload as object) : [],
        });

        // 通知所有消息回调
        this.messageCallbacks.forEach((callback) => {
          try {
            callback(message);
          } catch (error) {
            opLogger.error('[WS] Error in message callback:', error);
          }
        });
      } catch (error) {
        opLogger.error('[WS] Failed to parse WebSocket message:', error);
      }
    };
  }

  private updateState(state: ConnectionState): void {
    this.connectionState = state;
    this.stateChangeCallbacks.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        opLogger.error('Error in state change callback:', error);
      }
    });
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();

    // 指数退避计算延迟
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );

    this.reconnectAttempts++;

    opLogger.info('[WS] Reconnecting', {attempt: this.reconnectAttempts, delayMs: delay});

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({type: 'ping', timestamp: Date.now()});
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 生成符合 UUID v4 格式的 agentId
   */
  private generateAgentId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // 回退实现：UUID v4 格式
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
