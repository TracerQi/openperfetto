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
 * LookupSqlSchema Tool - 查询 PerfettoSQL 表结构
 *
 * 功能：
 * - 查询表的列定义和类型
 * - 列出所有表和视图
 * - 列出可用的 stdlib 函数
 */

import {Trace} from '../../../public/trace';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class LookupSqlSchemaTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'lookup_sql_schema',
    description: `Look up PerfettoSQL table/view schema and available functions.

Use this to:
- Discover table columns before writing queries
- Find available stdlib functions
- Understand data types

Available lookups:
- table: Get columns and types for a table
- tables: List all tables matching a pattern
- functions: List stdlib functions`,
    inputSchema: {
      type: 'object',
      properties: {
        lookupType: {
          type: 'string',
          enum: ['table', 'tables', 'functions'],
          description: 'Type of lookup to perform',
        },
        pattern: {
          type: 'string',
          description: 'Table name or pattern to search',
        },
      },
      required: ['lookupType'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const lookupType = args.lookupType as string;
    const pattern = args.pattern as string | undefined;

    const startTime = performance.now();

    try {
      switch (lookupType) {
        case 'table':
          return await this.lookupTable(pattern || '', startTime);
        case 'tables':
          return await this.listTables(pattern, startTime);
        case 'functions':
          return this.listFunctions(pattern, startTime);
        default:
          return {
            success: false,
            error: `Unknown lookup type: ${lookupType}`,
            executionTimeMs: performance.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * 查询表结构
   */
  private async lookupTable(
    tableName: string,
    startTime: number,
  ): Promise<ToolExecutionResult> {
    if (!tableName) {
      return {
        success: false,
        error: 'Table name is required for table lookup',
        executionTimeMs: performance.now() - startTime,
      };
    }

    const sql = `PRAGMA table_info('${tableName.replace(/'/g, "''")}')`;
    const result = await this.trace.engine.query(sql);

    const columns: Array<{name: string; type: string; notnull: boolean}> = [];

    for (const it = result.iter({
      name: 'str',
      type: 'str',
      notnull: 'number',
    }); it.valid(); it.next()) {
      columns.push({
        name: it.name ?? '',
        type: it.type ?? '',
        notnull: ((it.notnull as unknown as number) ?? 0) === 1,
      });
    }

    if (columns.length === 0) {
      return {
        success: false,
        error: `Table '${tableName}' not found`,
        executionTimeMs: performance.now() - startTime,
      };
    }

    const sampleColumns = columns.slice(0, 5).map((c) => c.name);

    return {
      success: true,
      data: {
        table: tableName,
        columns,
        columnCount: columns.length,
        hint: `Use: SELECT ${sampleColumns.join(', ')}${columns.length > 5 ? ', ...' : ''} FROM ${tableName}`,
      },
      executionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * 列出表
   */
  private async listTables(
    pattern: string | undefined,
    startTime: number,
  ): Promise<ToolExecutionResult> {
    const whereClause = pattern
      ? `AND name LIKE '%${pattern.replace(/'/g, "''")}%'`
      : '';

    const sql = `
      SELECT name, type
      FROM sqlite_schema
      WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '\_%' ESCAPE '\\'
        ${whereClause}
      ORDER BY name
      LIMIT 50
    `;

    const result = await this.trace.engine.query(sql);
    const tables: Array<{name: string; type: string}> = [];

    for (const it = result.iter({
      name: 'str',
      type: 'str',
    }); it.valid(); it.next()) {
      tables.push({
        name: it.name ?? '',
        type: it.type ?? '',
      });
    }

    return {
      success: true,
      data: {
        tables,
        count: tables.length,
        hint: 'Use lookup_sql_schema(lookupType: "table", pattern: "table_name") to get columns',
      },
      executionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * 列出函数
   */
  private listFunctions(
    pattern: string | undefined,
    startTime: number,
  ): ToolExecutionResult {
    // 常用 stdlib 函数列表
    const functions = [
      {name: 'ROUND(x, n)', description: 'Round x to n decimal places'},
      {name: 'CAST(x AS type)', description: 'Convert x to type'},
      {name: 'COALESCE(x, y)', description: 'Return first non-null value'},
      {name: 'IIF(cond, x, y)', description: 'If cond then x else y'},
      {name: 'GROUP_CONCAT(x)', description: 'Concatenate values in group'},
      {name: 'LAG(x)', description: 'Previous row value (window function)'},
      {name: 'LEAD(x)', description: 'Next row value (window function)'},
      {name: 'ROW_NUMBER()', description: 'Row number in partition'},
      {name: 'SUM(x)', description: 'Sum of values'},
      {name: 'AVG(x)', description: 'Average of values'},
      {name: 'MIN(x)', description: 'Minimum value'},
      {name: 'MAX(x)', description: 'Maximum value'},
      {name: 'COUNT(*)', description: 'Count rows'},
      {name: 'SUBSTR(x, start, len)', description: 'Extract substring'},
      {name: 'INSTR(x, y)', description: 'Find substring position'},
      {name: 'REPLACE(x, from, to)', description: 'Replace substring'},
      {name: 'UPPER(x)', description: 'Convert to uppercase'},
      {name: 'LOWER(x)', description: 'Convert to lowercase'},
      {name: 'TRIM(x)', description: 'Remove whitespace'},
      {name: 'ABS(x)', description: 'Absolute value'},
      {name: 'PRINTF(format, ...)', description: 'Format string'},
    ];

    const filtered = pattern
      ? functions.filter((f) =>
          f.name.toLowerCase().includes(pattern.toLowerCase()),
        )
      : functions;

    return {
      success: true,
      data: {
        functions: filtered,
        count: filtered.length,
        note: 'For stdlib modules, use: INCLUDE PERFETTO MODULE android.* (or slices.*, viz.*, etc.)',
      },
      executionTimeMs: performance.now() - startTime,
    };
  }
}
