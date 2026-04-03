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
 * ToolRegistry 单元测试
 *
 * 测试 Tool 注册中心的注册、查找、执行和参数验证功能
 */

import {
  ToolRegistry,
  ITool,
  ToolExecutionResult,
} from '../../tools/tool_registry.js';
import {ArtifactStore} from '../../agent/artifact_store.js';
import {createMockTrace} from '../mocks';
import type {Trace} from '../../../../public/trace';
import type {ToolCall} from '../../types/agent';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let mockTrace: ReturnType<typeof createMockTrace>;
  let artifactStore: ArtifactStore;

  // Mock Tool 实现
  function createMockTool(
    name: string,
    options?: {
      inputSchema?: Record<string, unknown>;
      executeResult?: ToolExecutionResult;
      throwError?: Error;
    },
  ): ITool {
    return {
      definition: {
        name,
        description: `Mock tool: ${name}`,
        inputSchema: options?.inputSchema ?? {
          type: 'object',
          properties: {},
        },
        category: 'query',
        concurrency: 'parallel',
      },
      execute: jest.fn().mockImplementation(async () => {
        if (options?.throwError) {
          throw options.throwError;
        }
        return options?.executeResult ?? {
          success: true,
          data: {result: 'ok'},
          executionTimeMs: 10,
        };
      }),
    };
  }

  beforeEach(() => {
    mockTrace = createMockTrace();
    artifactStore = new ArtifactStore();
    registry = new ToolRegistry(mockTrace as unknown as Trace, artifactStore);
  });

  describe('注册 Tool', () => {
    it('应能注册单个 Tool', () => {
      const tool = createMockTool('test_tool');
      registry.register(tool);

      expect(registry.size()).toBe(1);
      expect(registry.getTool('test_tool')).toBe(tool);
    });

    it('应能批量注册 Tools', () => {
      const tools = [
        createMockTool('tool1'),
        createMockTool('tool2'),
        createMockTool('tool3'),
      ];

      registry.registerAll(tools);

      expect(registry.size()).toBe(3);
      expect(registry.getToolNames()).toContain('tool1');
      expect(registry.getToolNames()).toContain('tool2');
      expect(registry.getToolNames()).toContain('tool3');
    });

    it('重复注册应替换旧 Tool', () => {
      const tool1 = createMockTool('duplicate');
      const tool2 = createMockTool('duplicate', {
        executeResult: {success: false, executionTimeMs: 0},
      });

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.size()).toBe(1);
      expect(registry.getTool('duplicate')).toBe(tool2);
    });
  });

  describe('查找 Tool', () => {
    beforeEach(() => {
      registry.registerAll([
        createMockTool('execute_sql'),
        createMockTool('invoke_skill'),
        createMockTool('trace_process_flow'),
      ]);
    });

    it('应能按名称查找 Tool', () => {
      const tool = registry.getTool('execute_sql');
      expect(tool).toBeDefined();
      expect(tool?.definition.name).toBe('execute_sql');
    });

    it('查找不存在的 Tool 应返回 undefined', () => {
      const tool = registry.getTool('non_existent');
      expect(tool).toBeUndefined();
    });

    it('getToolNames 应返回所有已注册的名称', () => {
      const names = registry.getToolNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('execute_sql');
      expect(names).toContain('invoke_skill');
      expect(names).toContain('trace_process_flow');
    });

    it('getToolDefinitions 应返回所有 Tool 定义', () => {
      const definitions = registry.getToolDefinitions();

      expect(definitions).toHaveLength(3);
      expect(definitions.every((d) => d.name && d.description)).toBe(true);
    });
  });

  describe('执行 Tool', () => {
    it('应成功执行已注册的 Tool', async () => {
      const tool = createMockTool('test_tool', {
        executeResult: {
          success: true,
          data: {count: 42},
          executionTimeMs: 15,
        },
      });
      registry.register(tool);

      const toolCall: ToolCall = {
        id: 'call_1',
        name: 'test_tool',
        arguments: {query: 'SELECT * FROM slice'},
      };

      const result = await registry.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({count: 42});
      expect(result.toolCallId).toBe('call_1');
      expect(tool.execute).toHaveBeenCalledWith({query: 'SELECT * FROM slice'});
    });

    it('执行未知 Tool 应返回错误', async () => {
      const toolCall: ToolCall = {
        id: 'call_2',
        name: 'unknown_tool',
        arguments: {},
      };

      const result = await registry.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
      expect(result.error).toContain('unknown_tool');
    });

    it('Tool 执行异常应返回错误结果', async () => {
      const tool = createMockTool('failing_tool', {
        throwError: new Error('Execution failed'),
      });
      registry.register(tool);

      const toolCall: ToolCall = {
        id: 'call_3',
        name: 'failing_tool',
        arguments: {},
      };

      const result = await registry.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution failed');
    });

    it('应传递 artifact 引用', async () => {
      const tool = createMockTool('artifact_tool', {
        executeResult: {
          success: true,
          data: {rows: []},
          artifactRef: 'art_123',
          executionTimeMs: 20,
        },
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_4',
        name: 'artifact_tool',
        arguments: {},
      });

      expect(result.artifactRef).toBe('art_123');
    });
  });

  describe('参数验证', () => {
    it('缺少必需参数应返回错误', async () => {
      const tool = createMockTool('strict_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            query: {type: 'string'},
          },
          required: ['query'],
        },
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_5',
        name: 'strict_tool',
        arguments: {}, // 缺少 query
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter');
      expect(result.error).toContain('query');
    });

    it('参数类型错误应返回错误', async () => {
      const tool = createMockTool('typed_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            count: {type: 'number'},
          },
        },
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_6',
        name: 'typed_tool',
        arguments: {count: 'not a number'}, // 类型错误
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('expected number');
    });

    it('integer 类型验证应检查整数', async () => {
      const tool = createMockTool('int_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            limit: {type: 'integer'},
          },
        },
      });
      registry.register(tool);

      // 浮点数应失败
      const result1 = await registry.execute({
        id: 'call_7',
        name: 'int_tool',
        arguments: {limit: 10.5},
      });
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('integer');

      // 整数应成功
      const result2 = await registry.execute({
        id: 'call_8',
        name: 'int_tool',
        arguments: {limit: 10},
      });
      expect(result2.success).toBe(true);
    });

    it('enum 类型验证应检查允许值', async () => {
      const tool = createMockTool('enum_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
          },
        },
      });
      registry.register(tool);

      // 无效值应失败
      const result1 = await registry.execute({
        id: 'call_9',
        name: 'enum_tool',
        arguments: {level: 'ultra'},
      });
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('must be one of');

      // 有效值应成功
      const result2 = await registry.execute({
        id: 'call_10',
        name: 'enum_tool',
        arguments: {level: 'high'},
      });
      expect(result2.success).toBe(true);
    });

    it('boolean 类型验证', async () => {
      const tool = createMockTool('bool_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            enabled: {type: 'boolean'},
          },
        },
      });
      registry.register(tool);

      const result1 = await registry.execute({
        id: 'call_11',
        name: 'bool_tool',
        arguments: {enabled: 'true'}, // 字符串而非布尔值
      });
      expect(result1.success).toBe(false);

      const result2 = await registry.execute({
        id: 'call_12',
        name: 'bool_tool',
        arguments: {enabled: true},
      });
      expect(result2.success).toBe(true);
    });

    it('array 类型验证', async () => {
      const tool = createMockTool('array_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            items: {type: 'array'},
          },
        },
      });
      registry.register(tool);

      const result1 = await registry.execute({
        id: 'call_13',
        name: 'array_tool',
        arguments: {items: 'not an array'},
      });
      expect(result1.success).toBe(false);

      const result2 = await registry.execute({
        id: 'call_14',
        name: 'array_tool',
        arguments: {items: [1, 2, 3]},
      });
      expect(result2.success).toBe(true);
    });

    it('object 类型验证', async () => {
      const tool = createMockTool('object_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            config: {type: 'object'},
          },
        },
      });
      registry.register(tool);

      // 数组不是对象
      const result1 = await registry.execute({
        id: 'call_15',
        name: 'object_tool',
        arguments: {config: [1, 2]},
      });
      expect(result1.success).toBe(false);

      // null 不是对象
      const result2 = await registry.execute({
        id: 'call_16',
        name: 'object_tool',
        arguments: {config: null},
      });
      expect(result2.success).toBe(false);

      // 正常对象应成功
      const result3 = await registry.execute({
        id: 'call_17',
        name: 'object_tool',
        arguments: {config: {key: 'value'}},
      });
      expect(result3.success).toBe(true);
    });

    it('有效参数应通过验证', async () => {
      const tool = createMockTool('valid_tool', {
        inputSchema: {
          type: 'object',
          properties: {
            query: {type: 'string'},
            limit: {type: 'number'},
          },
          required: ['query'],
        },
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_18',
        name: 'valid_tool',
        arguments: {query: 'SELECT *', limit: 100},
      });

      expect(result.success).toBe(true);
    });
  });

  describe('清空和辅助方法', () => {
    it('clear 应清空所有注册', () => {
      registry.registerAll([
        createMockTool('tool1'),
        createMockTool('tool2'),
      ]);
      expect(registry.size()).toBe(2);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.getToolNames()).toHaveLength(0);
    });

    it('getTrace 应返回 Trace 实例', () => {
      const trace = registry.getTrace();
      expect(trace).toBe(mockTrace);
    });

    it('getArtifactStore 应返回 ArtifactStore 实例', () => {
      const store = registry.getArtifactStore();
      expect(store).toBe(artifactStore);
    });
  });

  describe('边界条件', () => {
    it('空注册表应正常工作', () => {
      expect(registry.size()).toBe(0);
      expect(registry.getToolNames()).toEqual([]);
      expect(registry.getToolDefinitions()).toEqual([]);
      expect(registry.getTool('any')).toBeUndefined();
    });

    it('空参数应正常验证', async () => {
      const tool = createMockTool('no_params', {
        inputSchema: {type: 'object', properties: {}},
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_19',
        name: 'no_params',
        arguments: {},
      });

      expect(result.success).toBe(true);
    });

    it('无 schema 的参数验证应通过', async () => {
      const tool = createMockTool('loose_tool', {
        inputSchema: {}, // 空 schema
      });
      registry.register(tool);

      const result = await registry.execute({
        id: 'call_20',
        name: 'loose_tool',
        arguments: {any: 'value', number: 123},
      });

      expect(result.success).toBe(true);
    });

    it('null/undefined required 值应被拒绝', async () => {
      const tool = createMockTool('required_tool', {
        inputSchema: {
          type: 'object',
          properties: {field: {type: 'string'}},
          required: ['field'],
        },
      });
      registry.register(tool);

      const result1 = await registry.execute({
        id: 'call_21',
        name: 'required_tool',
        arguments: {field: null},
      });
      expect(result1.success).toBe(false);

      const result2 = await registry.execute({
        id: 'call_22',
        name: 'required_tool',
        arguments: {field: undefined},
      });
      expect(result2.success).toBe(false);
    });
  });

  describe('Tool 定义格式', () => {
    it('Tool 定义应包含所有必需字段', () => {
      const tool = createMockTool('complete_tool');
      registry.register(tool);

      const definitions = registry.getToolDefinitions();
      const def = definitions[0];

      expect(def.name).toBe('complete_tool');
      expect(def.description).toBeDefined();
      expect(def.inputSchema).toBeDefined();
      expect(def.category).toBeDefined();
      expect(def.concurrency).toBeDefined();
    });
  });
});
