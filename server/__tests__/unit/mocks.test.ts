/**
 * Mock 文件导入测试
 * 
 * 验证 Mock 文件能够正确导入和使用
 */

import {
  MockLLMProvider,
  createMockLLMProvider,
  MockScenarios,
} from '../mocks/llm_provider.mock.js';

import {
  MockTraceEngine,
  createMockTraceEngine,
  QueryResultBuilder,
  MockQueryScenarios,
} from '../mocks/trace_engine.mock.js';

describe('LLM Provider Mock', () => {
  it('should create mock provider', () => {
    const provider = new MockLLMProvider();
    expect(provider.name).toBe('mock-provider');
  });

  it('should create mock provider with custom name', () => {
    const provider = createMockLLMProvider({ name: 'custom-provider' });
    expect(provider.name).toBe('custom-provider');
  });

  it('should yield text chunks from chat', async () => {
    const provider = createMockLLMProvider({
      defaultResponse: MockScenarios.simpleText('Hello, world!'),
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chat({ messages: [] })) {
      if (chunk.type === 'text_delta') {
        chunks.push(chunk.text);
      }
    }

    expect(chunks).toContain('Hello, world!');
  });

  it('should yield tool calls from chat', async () => {
    const provider = createMockLLMProvider({
      defaultResponse: MockScenarios.toolCall('test_tool', { arg1: 'value1' }),
    });

    let toolCall = null;
    for await (const chunk of provider.chat({ messages: [] })) {
      if (chunk.type === 'tool_use') {
        toolCall = chunk;
      }
    }

    expect(toolCall).not.toBeNull();
    expect(toolCall?.name).toBe('test_tool');
    expect(toolCall?.arguments).toEqual({ arg1: 'value1' });
  });

  it('should handle error scenario', async () => {
    const provider = createMockLLMProvider({
      defaultResponse: MockScenarios.error('Test error'),
    });

    let errorChunk = null;
    for await (const chunk of provider.chat({ messages: [] })) {
      if (chunk.type === 'error') {
        errorChunk = chunk;
      }
    }

    expect(errorChunk).not.toBeNull();
    expect(errorChunk?.message).toBe('Test error');
  });
});

describe('Trace Engine Mock', () => {
  it('should create mock engine', () => {
    const engine = new MockTraceEngine();
    expect(engine).toBeDefined();
  });

  it('should return default empty result', async () => {
    const engine = createMockTraceEngine();
    const result = await engine.query('SELECT * FROM unknown');
    
    expect(result.rows).toEqual([]);
    expect(result.numRows).toBe(0);
  });

  it('should match query by contains', async () => {
    const engine = createMockTraceEngine([
      MockQueryScenarios.processList([
        { pid: 1, name: 'init' },
        { pid: 100, name: 'chrome' },
      ]),
    ]);

    const result = await engine.query('SELECT * FROM process');
    
    expect(result.numRows).toBe(2);
    expect(result.rows[0]).toEqual({ pid: 1, name: 'init' });
  });

  it('should build query results', () => {
    const result = QueryResultBuilder.fromData([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ]);

    expect(result.columns).toContain('id');
    expect(result.columns).toContain('name');
    expect(result.numRows).toBe(2);
  });

  it('should record query calls', async () => {
    const engine = createMockTraceEngine();
    
    await engine.query('SELECT 1');
    await engine.query('SELECT 2');
    
    const calls = engine.getQueryCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toBe('SELECT 1');
    expect(calls[1].sql).toBe('SELECT 2');
  });

  it('should handle error scenario', async () => {
    const engine = createMockTraceEngine([
      MockQueryScenarios.error('bad_query', 'Query failed'),
    ]);

    await expect(engine.query('SELECT bad_query')).rejects.toThrow('Query failed');
  });
});
