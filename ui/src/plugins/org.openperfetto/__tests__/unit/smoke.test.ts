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
 * Smoke Test - 验证测试基础设施配置正确
 *
 * 这个测试文件用于验证：
 * 1. Jest 能正确运行
 * 2. TypeScript 编译正常
 * 3. jsdom 环境可用
 * 4. Mock 工具可以正常导入和使用
 */

import {
  createMockTrace,
  createMockStore,
  createMockWebSocketClient,
  createQueryResult,
} from '../mocks';

describe('OpenPerfetto Test Infrastructure', () => {
  describe('Jest Environment', () => {
    it('should run tests successfully', () => {
      expect(1 + 1).toBe(2);
    });

    it('should support async/await', async () => {
      const result = await Promise.resolve('hello');
      expect(result).toBe('hello');
    });

    it('should have jsdom environment', () => {
      expect(typeof document).toBe('object');
      expect(typeof window).toBe('object');
    });

    it('should have requestAnimationFrame', () => {
      expect(typeof requestAnimationFrame).toBe('function');
    });

    it('should have crypto.randomUUID', () => {
      expect(typeof crypto.randomUUID).toBe('function');
      const uuid = crypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('Mock Trace', () => {
    it('should create mock trace', () => {
      const trace = createMockTrace();

      expect(trace).toBeDefined();
      expect(trace.engine).toBeDefined();
      expect(typeof trace.engine.query).toBe('function');
      expect(typeof trace.timeline.panIntoView).toBe('function');
      expect(typeof trace.mountStore).toBe('function');
    });

    it('should mock engine.query', async () => {
      const trace = createMockTrace();

      // 配置返回值
      trace.engine.query.mockResolvedValueOnce(
        createQueryResult([{ cnt: 5 }]),
      );

      const result = await trace.engine.query('SELECT COUNT(*) as cnt FROM slice');

      expect(trace.engine.query).toHaveBeenCalledWith('SELECT COUNT(*) as cnt FROM slice');
      expect(result.numRows()).toBe(1);
    });

    it('should mock mountStore', () => {
      const trace = createMockTrace({ initialState: { test: 'value' } });
      const store = trace.mountStore('test_store');

      expect(store.state).toEqual({ test: 'value' });
      expect(typeof store.edit).toBe('function');
    });
  });

  describe('Mock Store', () => {
    it('should create mock store with default state', () => {
      const store = createMockStore();

      expect(store.state).toBeDefined();
      expect(store.state.version).toBe(2);
      expect(store.state.initialized).toBe(true);
      expect(store.state.connectionState).toEqual({ status: 'disconnected' });
      expect(typeof store.edit).toBe('function');
    });

    it('should allow state modification via edit', () => {
      const store = createMockStore();

      store.edit((draft) => {
        draft.theme = 'dark';
      });

      expect(store.edit).toHaveBeenCalled();
      expect(store.state.theme).toBe('dark');
    });

    it('should create store with custom initial state', () => {
      const store = createMockStore({
        connectionState: { status: 'connected', agentId: 'test-123' },
      });

      expect(store.state.connectionState).toEqual({
        status: 'connected',
        agentId: 'test-123',
      });
    });
  });

  describe('Mock WebSocket Client', () => {
    it('should create mock websocket client', () => {
      const wsClient = createMockWebSocketClient();

      expect(typeof wsClient.connect).toBe('function');
      expect(typeof wsClient.disconnect).toBe('function');
      expect(typeof wsClient.send).toBe('function');
      expect(typeof wsClient.onMessage).toBe('function');
    });

    it('should track send calls', () => {
      const wsClient = createMockWebSocketClient({ isConnected: true });

      const message = { type: 'chat', payload: { text: 'hello' } };
      const result = wsClient.send(message);

      expect(result).toBe(true);
      expect(wsClient.send).toHaveBeenCalledWith(message);
    });

    it('should simulate message reception', () => {
      const wsClient = createMockWebSocketClient();
      const messageHandler = jest.fn();

      wsClient.onMessage(messageHandler);
      wsClient.simulateMessage({ type: 'llm_delta', payload: { text: 'Hi' } });

      expect(messageHandler).toHaveBeenCalledWith({
        type: 'llm_delta',
        payload: { text: 'Hi' },
      });
    });

    it('should simulate state changes', () => {
      const wsClient = createMockWebSocketClient();
      const stateHandler = jest.fn();

      wsClient.onStateChange(stateHandler);

      // 初始通知
      expect(stateHandler).toHaveBeenCalledWith({ status: 'disconnected' });

      // 模拟连接
      wsClient.simulateConnect();
      expect(stateHandler).toHaveBeenCalledWith({
        status: 'connected',
        agentId: 'mock-agent-id',
      });
    });
  });
});
