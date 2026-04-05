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
 * Tool Registry - Tool 注册和管理中心
 *
 * 核心职责：
 * - 注册和发现 Tools
 * - 执行 Tool 调用
 * - 参数验证
 * - 统一错误处理
 */

import {Trace} from '../../../public/trace';
import {ArtifactStore} from '../agent/artifact_store';
import {ToolCall, ToolResult} from '../types/agent';

/**
 * JSON Schema 类型定义
 */
export type JSONSchema = Record<string, unknown>;

/**
 * Tool 定义接口 - 供 LLM 使用的元数据
 */
export interface ToolDefinition {
  /** Tool 名称（唯一标识） */
  name: string;
  /** Tool 描述（供 LLM 理解） */
  description: string;
  /** 输入参数 JSON Schema */
  inputSchema: JSONSchema;
  /** Tool 类别 */
  category: 'query' | 'skill' | 'navigation' | 'mutation';
  /** 并发模式 */
  concurrency: 'parallel' | 'serial';
}

/**
 * Tool 执行结果
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 返回数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** Artifact 引用 */
  artifactRef?: string;
  /** 执行耗时（毫秒） */
  executionTimeMs: number;
}

/**
 * Tool 实现接口
 */
export interface ITool {
  /** Tool 定义（元数据） */
  readonly definition: ToolDefinition;
  /** 执行 Tool */
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * Tool 注册表
 * 管理所有可用的 Agent Tools
 */
export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();
  private trace: Trace;
  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  /**
   * 注册 Tool
   */
  register(tool: ITool): void {
    if (this.tools.has(tool.definition.name)) {
      console.warn(`Tool '${tool.definition.name}' already registered, replacing`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * 批量注册 Tools
   */
  registerAll(tools: ITool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取 Tool
   */
  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有 Tool 定义（供 LLM 使用）
   */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * 获取已注册的 Tool 名称列表
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 执行 Tool 调用
   * 统一处理参数验证、执行、错误捕获
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Unknown tool: ${toolCall.name}. Available tools: ${this.getToolNames().join(', ')}`,
      };
    }

    void performance.now(); // startTime reserved for logging

    try {
      // 验证参数
      const validationError = this.validateArgs(
        toolCall.arguments,
        tool.definition.inputSchema,
      );
      if (validationError) {
        return {
          toolCallId: toolCall.id,
          success: false,
          error: `Parameter validation failed: ${validationError}`,
        };
      }

      // 执行 Tool
      const result = await tool.execute(toolCall.arguments);
      // Note: executionTimeMs 可用于日志记录或性能监控

      return {
        toolCallId: toolCall.id,
        success: result.success,
        data: result.data,
        error: result.error,
        artifactRef: result.artifactRef,
      };
    } catch (error) {
      // Note: executionTimeMs 可用于日志记录
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(`Tool '${toolCall.name}' execution failed:`, error);

      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Tool execution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * 验证参数
   * 简化的 JSON Schema 验证
   */
  private validateArgs(
    args: Record<string, unknown>,
    schema: JSONSchema,
  ): string | null {
    // 检查 required 字段
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (args[field] === undefined || args[field] === null) {
          return `Missing required parameter: ${field}`;
        }
      }
    }

    // 检查参数类型
    const properties = schema.properties as
      | Record<string, JSONSchema>
      | undefined;
    if (properties) {
      for (const [key, value] of Object.entries(args)) {
        const propSchema = properties[key];
        if (propSchema) {
          const typeError = this.validateType(value, propSchema);
          if (typeError) {
            return `Parameter '${key}': ${typeError}`;
          }
        }
      }
    }

    return null;
  }

  /**
   * 验证类型
   */
  private validateType(value: unknown, schema: JSONSchema): string | null {
    const expectedType = schema.type as string | undefined;
    if (!expectedType) return null;

    const actualType = typeof value;

    switch (expectedType) {
      case 'string':
        if (actualType !== 'string') {
          return `expected string, got ${actualType}`;
        }
        break;
      case 'number':
      case 'integer':
        if (actualType !== 'number') {
          return `expected number, got ${actualType}`;
        }
        if (expectedType === 'integer' && !Number.isInteger(value)) {
          return `expected integer, got float`;
        }
        break;
      case 'boolean':
        if (actualType !== 'boolean') {
          return `expected boolean, got ${actualType}`;
        }
        break;
      case 'object':
        if (actualType !== 'object' || value === null || Array.isArray(value)) {
          return `expected object, got ${Array.isArray(value) ? 'array' : actualType}`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return `expected array, got ${actualType}`;
        }
        break;
    }

    // 检查 enum
    const enumValues = schema.enum as unknown[] | undefined;
    if (enumValues && !enumValues.includes(value)) {
      return `value must be one of: ${enumValues.join(', ')}`;
    }

    return null;
  }

  /**
   * 获取 Trace 实例（供 Tool 使用）
   */
  getTrace(): Trace {
    return this.trace;
  }

  /**
   * 获取 ArtifactStore 实例（供 Tool 使用）
   */
  getArtifactStore(): ArtifactStore {
    return this.artifactStore;
  }

  /**
   * 清空注册
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * 获取注册的 Tool 数量
   */
  size(): number {
    return this.tools.size;
  }
}
