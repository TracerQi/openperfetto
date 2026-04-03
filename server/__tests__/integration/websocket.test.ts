/**
 * WebSocket 集成测试
 *
 * 启动真实的 Fastify 实例，通过 WebSocket 客户端进行端到端测试
 *
 * 注意：Fastify 5.x 需要 Node.js 20+，因此在较低版本的 Node.js 上这些测试会被跳过
 */

// 检测 Node.js 版本
const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
const isNodeVersionSupported = nodeVersion >= 20;

// 如果 Node.js 版本不支持，跳过整个测试套件
const describeOrSkip = isNodeVersionSupported ? describe : describe.skip;

// 动态导入，仅在支持的 Node.js 版本上执行
let Fastify: typeof import('fastify').default;
let fastifyWebsocket: typeof import('@fastify/websocket').default;
let fastifyCors: typeof import('@fastify/cors').default;
let WsWebSocket: typeof import('ws').default;
let setupWebSocketRoutes: typeof import('../../src/routes/websocket.js').setupWebSocketRoutes;
let setWebSocketDependencies: typeof import('../../src/routes/websocket.js').setWebSocketDependencies;
let connectionPool: typeof import('../../src/routes/websocket.js').connectionPool;
let SessionManager: typeof import('../../src/services/session_manager.js').SessionManager;
let SkillMarkerParser: typeof import('../../src/services/skill_marker_parser.js').SkillMarkerParser;
let SkillRegistry: typeof import('../../src/services/skill_registry.js').SkillRegistry;
let SkillProcessor: typeof import('../../src/services/skill_processor.js').SkillProcessor;
let SqlSanitizer: typeof import('../../src/utils/sql_sanitizer.js').SqlSanitizer;
let createMockLLMProvider: typeof import('../mocks/llm_provider.mock.js').createMockLLMProvider;
let MockScenarios: typeof import('../mocks/llm_provider.mock.js').MockScenarios;

// ============= 测试辅助类型 =============

interface ServerMessage {
  type: string;
  traceId?: string;
  timestamp?: number;
  data?: {
    code?: string;
    message?: string;
    text?: string;
    agentId?: string;
    usage?: { inputTokens: number; outputTokens: number };
    [key: string]: unknown;
  };
}

// ============= 生成 UUID =============

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============= 主测试套件 =============

describeOrSkip('WebSocket Integration Tests', () => {
  // 如果版本不支持，输出跳过原因
  if (!isNodeVersionSupported) {
    it.skip('requires Node.js 20+ (current: ' + process.version + ')', () => {});
    return;
  }

  // 类型定义
  type FastifyInstance = import('fastify').FastifyInstance;
  type MockLLMProvider = import('../mocks/llm_provider.mock.js').MockLLMProvider;
  type WsInstance = import('ws').WebSocket;

  let app: FastifyInstance;
  let wsUrl: string;
  let mockProvider: MockLLMProvider;
  let mockLLMProxy: ReturnType<typeof createMockLLMProxyFn>;
  let sessionManager: InstanceType<typeof SessionManager>;
  let skillMarkerParser: InstanceType<typeof SkillMarkerParser>;
  let skillRegistry: InstanceType<typeof SkillRegistry>;
  let skillProcessor: InstanceType<typeof SkillProcessor>;
  const activeConnections: WsInstance[] = [];

  // 创建 Mock LLMProxy
  function createMockLLMProxyFn(mockProv: MockLLMProvider) {
    return {
      hasAvailableProvider: jest.fn().mockReturnValue(true),
      chat: jest.fn(async function* (request: unknown) {
        yield* mockProv.chat(request as Parameters<MockLLMProvider['chat']>[0]);
      }),
      getTokenUsageStats: jest.fn().mockReturnValue({ total: 0, byProvider: {} }),
      getCircuitBreakerStates: jest.fn().mockReturnValue({}),
      getRateLimiterStats: jest.fn().mockReturnValue({}),
    };
  }

  // WebSocket 辅助函数
  function connectWs(url: string, timeout = 5000): Promise<WsInstance> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`WebSocket connection timeout after ${timeout}ms`));
      }, timeout);

      const ws = new WsWebSocket(url);

      ws.on('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function waitForMessage(ws: WsInstance, timeout = 5000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Message receive timeout after ${timeout}ms`));
      }, timeout);

      ws.once('message', (data: Buffer) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(new Error(`Failed to parse message: ${data.toString()}`));
        }
      });
    });
  }

  function collectMessages(
    ws: WsInstance,
    count: number,
    timeout = 5000
  ): Promise<ServerMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: ServerMessage[] = [];
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for ${count} messages, received ${messages.length}`
          )
        );
      }, timeout);

      const handler = (data: Buffer) => {
        try {
          messages.push(JSON.parse(data.toString()));
          if (messages.length >= count) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(messages);
          }
        } catch (err) {
          clearTimeout(timer);
          ws.off('message', handler);
          reject(new Error(`Failed to parse message: ${data.toString()}`));
        }
      };

      ws.on('message', handler);
    });
  }

  function collectUntilType(
    ws: WsInstance,
    targetType: string,
    timeout = 5000
  ): Promise<ServerMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: ServerMessage[] = [];
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for '${targetType}' message, received: ${JSON.stringify(messages)}`
          )
        );
      }, timeout);

      const handler = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          messages.push(msg);
          if (msg.type === targetType) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(messages);
          }
        } catch (err) {
          clearTimeout(timer);
          ws.off('message', handler);
          reject(new Error(`Failed to parse message: ${data.toString()}`));
        }
      };

      ws.on('message', handler);
    });
  }

  function closeWs(ws: WsInstance): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WsWebSocket.CLOSED) {
        resolve();
        return;
      }

      ws.once('close', () => resolve());
      ws.close();

      setTimeout(() => {
        if (ws.readyState !== WsWebSocket.CLOSED) {
          ws.terminate();
        }
        resolve();
      }, 1000);
    });
  }

  beforeAll(async () => {
    // 动态导入模块
    const fastifyModule = await import('fastify');
    const fastifyWsModule = await import('@fastify/websocket');
    const fastifyCorsModule = await import('@fastify/cors');
    const wsModule = await import('ws');
    const websocketRoutes = await import('../../src/routes/websocket.js');
    const sessionManagerModule = await import('../../src/services/session_manager.js');
    const skillMarkerParserModule = await import('../../src/services/skill_marker_parser.js');
    const skillRegistryModule = await import('../../src/services/skill_registry.js');
    const skillProcessorModule = await import('../../src/services/skill_processor.js');
    const sqlSanitizerModule = await import('../../src/utils/sql_sanitizer.js');
    const mockModule = await import('../mocks/llm_provider.mock.js');

    Fastify = fastifyModule.default;
    fastifyWebsocket = fastifyWsModule.default;
    fastifyCors = fastifyCorsModule.default;
    WsWebSocket = wsModule.default;
    setupWebSocketRoutes = websocketRoutes.setupWebSocketRoutes;
    setWebSocketDependencies = websocketRoutes.setWebSocketDependencies;
    connectionPool = websocketRoutes.connectionPool;
    SessionManager = sessionManagerModule.SessionManager;
    SkillMarkerParser = skillMarkerParserModule.SkillMarkerParser;
    SkillRegistry = skillRegistryModule.SkillRegistry;
    SkillProcessor = skillProcessorModule.SkillProcessor;
    SqlSanitizer = sqlSanitizerModule.SqlSanitizer;
    createMockLLMProvider = mockModule.createMockLLMProvider;
    MockScenarios = mockModule.MockScenarios;

    // 创建 Mock Provider
    mockProvider = createMockLLMProvider({
      defaultResponse: MockScenarios.simpleText('Hello from mock LLM'),
    });
    mockLLMProxy = createMockLLMProxyFn(mockProvider);

    // 创建服务实例
    sessionManager = new SessionManager({
      store: 'memory',
      ttlMs: 86400000,
      cleanupIntervalMs: 3600000,
      maxSessions: 1000,
    });
    skillMarkerParser = new SkillMarkerParser();
    skillRegistry = new SkillRegistry();
    const sqlSanitizer = new SqlSanitizer();
    skillProcessor = new SkillProcessor(skillRegistry, sqlSanitizer);

    // 创建 Fastify 实例
    app = Fastify({
      logger: false,
    });

    // 注册插件
    await app.register(fastifyCors, { origin: '*' });
    await app.register(fastifyWebsocket, { options: { maxPayload: 1048576 } });

    // 设置 WebSocket 依赖
    setWebSocketDependencies({
      llmProxy: mockLLMProxy as unknown as Parameters<
        typeof setWebSocketDependencies
      >[0]['llmProxy'],
      sessionManager,
      skillMarkerParser,
      skillRegistry,
      skillProcessor,
    });

    // 注册路由
    setupWebSocketRoutes(app);

    // 启动服务器
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (typeof address === 'string' || !address) {
      throw new Error('Failed to get server address');
    }
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterAll(async () => {
    // 关闭所有活跃连接
    for (const ws of activeConnections) {
      await closeWs(ws);
    }

    // 关闭连接池
    connectionPool.closeAll();

    // 销毁 SessionManager
    await sessionManager.destroy();

    // 关闭服务器
    await app.close();
  });

  afterEach(async () => {
    // 清理每个测试后的连接
    for (const ws of [...activeConnections]) {
      await closeWs(ws);
      const index = activeConnections.indexOf(ws);
      if (index > -1) {
        activeConnections.splice(index, 1);
      }
    }

    // 重置 Mock
    mockProvider.reset();
    mockProvider.setDefaultResponse(MockScenarios.simpleText('Hello from mock LLM'));
    mockLLMProxy.hasAvailableProvider.mockReturnValue(true);
  });

  // ============= 连接管理测试 =============

  describe('Connection Management', () => {
    it('should establish WebSocket connection successfully', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      expect(ws.readyState).toBe(WsWebSocket.OPEN);
    });

    it('should allow multiple connections', async () => {
      const ws1 = await connectWs(wsUrl);
      const ws2 = await connectWs(wsUrl);
      activeConnections.push(ws1, ws2);

      expect(ws1.readyState).toBe(WsWebSocket.OPEN);
      expect(ws2.readyState).toBe(WsWebSocket.OPEN);
    });

    it('should reject connection to invalid path', async () => {
      const invalidUrl = wsUrl.replace('/ws', '/invalid-path');

      await expect(connectWs(invalidUrl, 2000)).rejects.toThrow();
    });
  });

  // ============= Ping/Pong 心跳测试 =============

  describe('Ping/Pong Heartbeat', () => {
    it('should respond to ping with pong', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const timestamp = Date.now();
      ws.send(JSON.stringify({ type: 'ping', timestamp }));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBe(timestamp);
    });

    it('should include timestamp in pong response', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const timestamp = 1234567890;
      ws.send(JSON.stringify({ type: 'ping', timestamp }));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBe(1234567890);
    });

    it('should handle multiple ping messages', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const timestamps = [Date.now(), Date.now() + 1000, Date.now() + 2000];

      for (const ts of timestamps) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: ts }));
      }

      const responses = await collectMessages(ws, 3);

      expect(responses).toHaveLength(3);
      responses.forEach((resp, i) => {
        expect(resp.type).toBe('pong');
        expect(resp.timestamp).toBe(timestamps[i]);
      });
    });
  });

  // ============= Chat 消息流程测试 =============

  describe('Chat Message Flow', () => {
    it('should receive text_delta and done responses for valid chat message', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      mockProvider.setDefaultResponse({
        textChunks: ['Hello', ' World'],
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const chatMessage = {
        type: 'chat',
        agentId: generateUUID(),
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
      };

      ws.send(JSON.stringify(chatMessage));

      const messages = await collectUntilType(ws, 'done');

      const textDeltas = messages.filter((m) => m.type === 'text_delta');
      const doneMsg = messages.find((m) => m.type === 'done');

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(doneMsg).toBeDefined();
      expect(doneMsg?.data?.agentId).toBe(chatMessage.agentId);
    });

    it('should return error for chat message missing required fields', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const invalidMessage = {
        type: 'chat',
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      ws.send(JSON.stringify(invalidMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_MESSAGE');
    });

    it('should reject chat message with invalid agentId format', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const invalidMessage = {
        type: 'chat',
        agentId: 'not-a-uuid',
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      ws.send(JSON.stringify(invalidMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_MESSAGE');
    });

    it('should include usage statistics in done message', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      mockProvider.setDefaultResponse({
        textChunks: ['Test response'],
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const chatMessage = {
        type: 'chat',
        agentId: generateUUID(),
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: 'Test' }],
        },
      };

      ws.send(JSON.stringify(chatMessage));

      const messages = await collectUntilType(ws, 'done');
      const doneMsg = messages.find((m) => m.type === 'done');

      expect(doneMsg?.data?.usage).toBeDefined();
      expect(doneMsg?.data?.usage?.inputTokens).toBe(100);
      expect(doneMsg?.data?.usage?.outputTokens).toBe(50);
    });

    it('should use echo mode when LLM provider is unavailable', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      mockLLMProxy.hasAvailableProvider.mockReturnValue(false);

      const chatMessage = {
        type: 'chat',
        agentId: generateUUID(),
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: 'Hello echo mode' }],
        },
      };

      ws.send(JSON.stringify(chatMessage));

      const messages = await collectUntilType(ws, 'done');
      const textDelta = messages.find((m) => m.type === 'text_delta');

      expect(textDelta?.data?.text).toContain('[Echo]');
      expect(textDelta?.data?.text).toContain('Hello echo mode');
    });
  });

  // ============= invoke_skill 消息测试 =============

  describe('Invoke Skill Messages', () => {
    it('should return error for invoke_skill with non-existent skill', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const invokeMessage = {
        type: 'invoke_skill',
        skillId: 'non-existent-skill-12345',
        params: {},
      };

      ws.send(JSON.stringify(invokeMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
    });

    it('should return error for invalid skillId', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const invokeMessage = {
        type: 'invoke_skill',
        skillId: 'test-skill',
        params: { query: 'test query' },
      };

      ws.send(JSON.stringify(invokeMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
    });
  });

  // ============= 错误处理测试 =============

  describe('Error Handling', () => {
    it('should return error for malformed JSON', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      ws.send('{ invalid json }');

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_JSON');
    });

    it('should return error for unknown message type', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const unknownMessage = {
        type: 'unknown_type_xyz',
        data: { foo: 'bar' },
      };

      ws.send(JSON.stringify(unknownMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_MESSAGE');
    });

    it('should return error for empty message', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      ws.send('');

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_JSON');
    });

    it('should return error for message without type field', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const noTypeMessage = {
        agentId: generateUUID(),
        payload: { messages: [] },
      };

      ws.send(JSON.stringify(noTypeMessage));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('error');
      expect(response.data?.code).toBe('INVALID_MESSAGE');
    });
  });

  // ============= 连接生命周期测试 =============

  describe('Connection Lifecycle', () => {
    it('should handle client disconnect gracefully', async () => {
      const ws = await connectWs(wsUrl);

      await closeWs(ws);

      expect(ws.readyState).toBe(WsWebSocket.CLOSED);
    });

    it('should handle multiple concurrent connections independently', async () => {
      const ws1 = await connectWs(wsUrl);
      const ws2 = await connectWs(wsUrl);
      activeConnections.push(ws1, ws2);

      const timestamp1 = 1111;
      const timestamp2 = 2222;

      ws1.send(JSON.stringify({ type: 'ping', timestamp: timestamp1 }));
      ws2.send(JSON.stringify({ type: 'ping', timestamp: timestamp2 }));

      const [response1, response2] = await Promise.all([
        waitForMessage(ws1),
        waitForMessage(ws2),
      ]);

      expect(response1.type).toBe('pong');
      expect(response1.timestamp).toBe(timestamp1);

      expect(response2.type).toBe('pong');
      expect(response2.timestamp).toBe(timestamp2);
    });

    it('should not affect other connections when one disconnects', async () => {
      const ws1 = await connectWs(wsUrl);
      const ws2 = await connectWs(wsUrl);
      activeConnections.push(ws2);

      await closeWs(ws1);

      ws2.send(JSON.stringify({ type: 'ping', timestamp: 3333 }));

      const response = await waitForMessage(ws2);

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBe(3333);
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      for (let i = 0; i < 5; i++) {
        const ws = await connectWs(wsUrl);
        expect(ws.readyState).toBe(WsWebSocket.OPEN);
        await closeWs(ws);
      }
    });
  });

  // ============= 消息顺序测试 =============

  describe('Message Ordering', () => {
    it('should process messages in order', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      const timestamps = [1, 2, 3, 4, 5];

      for (const ts of timestamps) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: ts }));
      }

      const responses = await collectMessages(ws, 5);

      for (let i = 0; i < timestamps.length; i++) {
        expect(responses[i].timestamp).toBe(timestamps[i]);
      }
    });
  });

  // ============= 边界情况测试 =============

  describe('Edge Cases', () => {
    it('should handle large message payload', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      mockProvider.setDefaultResponse({
        textChunks: ['Large response received'],
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      const largeContent = 'x'.repeat(10000);
      const chatMessage = {
        type: 'chat',
        agentId: generateUUID(),
        traceId: generateUUID(),
        payload: {
          messages: [{ role: 'user', content: largeContent }],
        },
      };

      ws.send(JSON.stringify(chatMessage));

      const messages = await collectUntilType(ws, 'done', 10000);
      const doneMsg = messages.find((m) => m.type === 'done');

      expect(doneMsg).toBeDefined();
    });

    it('should handle special characters in messages', async () => {
      const ws = await connectWs(wsUrl);
      activeConnections.push(ws);

      mockProvider.setDefaultResponse(
        MockScenarios.simpleText('Response with special chars: 你好 🎉 <>&"\'')
      );

      const chatMessage = {
        type: 'chat',
        agentId: generateUUID(),
        traceId: generateUUID(),
        payload: {
          messages: [
            {
              role: 'user',
              content: '特殊字符测试: 中文 emoji 🎉 HTML <script> &amp;',
            },
          ],
        },
      };

      ws.send(JSON.stringify(chatMessage));

      const messages = await collectUntilType(ws, 'done');
      const textDelta = messages.find((m) => m.type === 'text_delta');

      expect(textDelta).toBeDefined();
      expect(textDelta?.data?.text).toContain('你好');
    });
  });
});

// 当 Node.js 版本不支持时，输出跳过信息
if (!isNodeVersionSupported) {
  describe('WebSocket Integration Tests', () => {
    it(`skipped: requires Node.js 20+ (current: ${process.version}). Fastify 5.x uses diagnostics_channel.tracingChannel which is only available in Node.js 20+`, () => {
      console.log(
        `⚠️  WebSocket integration tests skipped: Node.js ${process.version} detected, but Node.js 20+ is required for Fastify 5.x`
      );
      expect(true).toBe(true);
    });
  });
}
