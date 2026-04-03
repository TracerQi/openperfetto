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
 * ExecuteSql Tool - 执行 PerfettoSQL 查询
 *
 * 功能：
 * - 执行 SQL 查询并返回结果
 * - 自动添加 LIMIT 防止数据过大
 * - 结果存储到 ArtifactStore 并压缩
 * - 支持超时控制
 */

import {Trace} from '../../../public/trace';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {ArtifactData, ColumnDefinition} from '../types/artifact';

export class ExecuteSqlTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'execute_sql',
    description: `Execute a PerfettoSQL query against the loaded trace.

Use this for custom queries when no suitable Skill exists.
Results are automatically compressed and stored in ArtifactStore.

Important:
- Use LIMIT to avoid excessive results (max 5000 rows)
- Timestamps are in nanoseconds
- Include INCLUDE PERFETTO MODULE statements in separate calls`,
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'The PerfettoSQL query to execute',
        },
        maxRows: {
          type: 'number',
          description: 'Maximum rows to return (default: 200, max: 5000)',
          default: 200,
        },
      },
      required: ['sql'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;
  private artifactStore: ArtifactStore;

  private static readonly MAX_ROWS = 5000;
  private static readonly DEFAULT_ROWS = 200;
  private static readonly QUERY_TIMEOUT_MS = 30000;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sql = args.sql as string;
    const maxRows = Math.min(
      (args.maxRows as number) || ExecuteSqlTool.DEFAULT_ROWS,
      ExecuteSqlTool.MAX_ROWS,
    );

    const startTime = performance.now();

    try {
      // 添加 LIMIT 如果没有的话
      let finalSql = sql.trim();
      if (!finalSql.toLowerCase().includes('limit')) {
        finalSql = `${finalSql} LIMIT ${maxRows}`;
      }

      // 执行查询（带超时）
      const result = await Promise.race([
        this.trace.engine.query(finalSql),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Query timeout')),
            ExecuteSqlTool.QUERY_TIMEOUT_MS,
          ),
        ),
      ]);

      // 解析列定义
      const columnNames = result.columns();
      const columns: ColumnDefinition[] = columnNames.map((name) => ({
        name,
        type: this.inferColumnType(name),
      }));

      // 收集结果行
      const rows: unknown[][] = [];
      const iter = result.iter({});

      while (iter.valid() && rows.length < maxRows) {
        const row: unknown[] = [];
        for (const col of columns) {
          // 使用索引访问迭代器属性
          const value = (iter as unknown as Record<string, unknown>)[col.name];
          row.push(value);
        }
        rows.push(row);
        iter.next();
      }

      const data: ArtifactData = {
        columns,
        rows,
        totalRowCount: rows.length,
      };

      // 存储到 ArtifactStore
      const artifact = this.artifactStore.store('table', data, 'execute_sql', sql);

      const executionTimeMs = performance.now() - startTime;

      // 返回压缩摘要
      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'execute_sql',
            rowCount: data.totalRowCount,
            columns: columns.map((c) => c.name),
            execMs: Math.round(executionTimeMs),
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
        },
        artifactRef: artifact.id,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = performance.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      };
    }
  }

  /**
   * 根据列名推断类型
   */
  private inferColumnType(name: string): ColumnDefinition['type'] {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('ts') || lowerName.includes('time')) {
      return 'timestamp';
    }
    if (lowerName.includes('dur')) {
      return 'duration';
    }
    if (lowerName.includes('name') || lowerName.includes('type')) {
      return 'string';
    }
    if (lowerName.includes('id') || lowerName.includes('count')) {
      return 'integer';
    }
    return 'string';
  }
}
