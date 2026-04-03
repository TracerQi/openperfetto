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

/**
 * Mock WebSocket Client
 *
 * 模拟 WebSocketClient 单例，用于单元测试。
 * 基于 services/websocket_client.ts 定义。
 */

import { ConnectionState } from '../../types/plugin_state';

/**
 * WebSocket 消息类型（与实际类型一致）
 */
export interface WebSocketMessage {
  type: string;
  payload?: unknown;
  data?: unknown;
  requestId?: string;
  traceId?: string;
  timestamp?: number;
}

type StateChangeCallback = (state: ConnectionState) => void;
type MessageCallback = (message: WebSocketMessage) => void;

/**
 * Mock WebSocket Client
 */
export interface MockWebSocketClient {
  // 核心方法
  connect: jest.Mock<void, []>;
  disconnect: jest.Mock<void, []>;
  send: jest.Mock<boolean, [WebSocketMessage]>;
  getState: jest.Mock<ConnectionState, []>;
  setUrl: jest.Mock<void, [string]>;

  // 事件回调注册
  onStateChange: jest.Mock<() => void, [StateChangeCallback]>;
  onMessage: jest.Mock<() => void, [MessageCallback]>;

  // 测试辅助方法
  simulateMessage: (message: WebSocketMessage) => void;
  simulateStateChange: (state: ConnectionState) => void;
  simulateConnect: () => void;
  simulateDisconnect: () => void;
  simulateError: (message: string) => void;
}

/**
 * 创建 Mock WebSocket Client
 *
 * @param options 可选配置
 * @returns Mock WebSocket Client
 *
 * @example
 * ```typescript
 * const wsClient = createMockWebSocketClient();
 *
 * // 注册消息回调
 * const unsubscribe = wsClient.onMessage((msg) => {
 *   console.log('Received:', msg);
 * });
 *
 * // 模拟接收消息
 * wsClient.simulateMessage({
 *   type: 'llm_delta',
 *   payload: { text: 'Hello' },
 * });
 *
 * // 验证发送
 * expect(wsClient.send).toHaveBeenCalledWith(
 *   expect.objectContaining({ type: 'chat' })
 * );
 * ```
 */
export function createMockWebSocketClient(options?: {
  initialState?: ConnectionState;
  isConnected?: boolean;
}): MockWebSocketClient {
  let currentState: ConnectionState = options?.initialState ?? { status: 'disconnected' };
  const stateChangeCallbacks = new Set<StateChangeCallback>();
  const messageCallbacks = new Set<MessageCallback>();

  const mockClient: MockWebSocketClient = {
    connect: jest.fn(() => {
      currentState = { status: 'connecting' };
      stateChangeCallbacks.forEach((cb) => cb(currentState));
    }),

    disconnect: jest.fn(() => {
      currentState = { status: 'disconnected' };
      stateChangeCallbacks.forEach((cb) => cb(currentState));
    }),

    send: jest.fn((_message: WebSocketMessage): boolean => {
      return currentState.status === 'connected';
    }),

    getState: jest.fn((): ConnectionState => currentState),

    setUrl: jest.fn((_url: string): void => {}),

    onStateChange: jest.fn((callback: StateChangeCallback): (() => void) => {
      stateChangeCallbacks.add(callback);
      // 立即通知当前状态
      callback(currentState);
      return () => stateChangeCallbacks.delete(callback);
    }),

    onMessage: jest.fn((callback: MessageCallback): (() => void) => {
      messageCallbacks.add(callback);
      return () => messageCallbacks.delete(callback);
    }),

    // 测试辅助方法
    simulateMessage: (message: WebSocketMessage): void => {
      messageCallbacks.forEach((cb) => cb(message));
    },

    simulateStateChange: (state: ConnectionState): void => {
      currentState = state;
      stateChangeCallbacks.forEach((cb) => cb(state));
    },

    simulateConnect: (): void => {
      currentState = { status: 'connected', agentId: 'mock-agent-id' };
      stateChangeCallbacks.forEach((cb) => cb(currentState));
    },

    simulateDisconnect: (): void => {
      currentState = { status: 'disconnected' };
      stateChangeCallbacks.forEach((cb) => cb(currentState));
    },

    simulateError: (message: string): void => {
      currentState = { status: 'error', message };
      stateChangeCallbacks.forEach((cb) => cb(currentState));
    },
  };

  // 如果初始设置为已连接
  if (options?.isConnected) {
    currentState = { status: 'connected', agentId: 'mock-agent-id' };
  }

  return mockClient;
}

/**
 * 创建 WebSocketClient 模块的 Mock
 * 用于 jest.mock() 替换整个模块
 */
export function createWebSocketClientModuleMock(): {
  WebSocketClient: {
    getInstance: jest.Mock<MockWebSocketClient, []>;
  };
} {
  const mockInstance = createMockWebSocketClient();

  return {
    WebSocketClient: {
      getInstance: jest.fn(() => mockInstance),
    },
  };
}

/**
 * 类型断言辅助函数
 */
export function asMockWebSocketClient(client: MockWebSocketClient): unknown {
  return client;
}
