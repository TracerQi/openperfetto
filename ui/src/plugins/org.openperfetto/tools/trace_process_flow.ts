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
 * TraceProcessFlow Tool - 追踪进程调用流
 *
 * 功能：
 * - 从指定 slice 开始追踪调用流程
 * - 向下追踪子调用、向上追踪父调用
 * - 追踪跨进程 Binder 事务
 * - 构建调用链视图
 */

import {Trace} from '../../../public/trace';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {ArtifactData, ColumnDefinition} from '../types/artifact';

interface SliceInfo {
  name: string;
  ts: bigint;
  dur_ms: number;
  thread: string;
  process: string;
}

export class TraceProcessFlowTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'trace_process_flow',
    description: `Trace the execution flow from a specific slice.

Recursively finds:
- Child slices (nested calls)
- Parent slices (call stack)
- Blocking calls on the critical path
- Cross-process Binder transactions

Use this to understand the call chain that led to a performance issue.`,
    inputSchema: {
      type: 'object',
      properties: {
        sliceId: {
          type: 'number',
          description: 'The slice ID to trace from',
        },
        sliceName: {
          type: 'string',
          description: 'Alternative: slice name pattern to search',
        },
        processName: {
          type: 'string',
          description: 'Process name to filter (used with sliceName)',
        },
        direction: {
          type: 'string',
          description: 'Trace direction',
          enum: ['down', 'up', 'both'],
          default: 'down',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 5)',
          default: 5,
        },
      },
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;
  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sliceId = args.sliceId as number | undefined;
    const sliceName = args.sliceName as string | undefined;
    const processName = args.processName as string | undefined;
    const direction = (args.direction as string) || 'down';
    const maxDepth = (args.maxDepth as number) || 5;

    const startTime = performance.now();

    try {
      let targetSliceId = sliceId;

      // 如果提供了 sliceName，先查找对应的 slice
      if (!targetSliceId && sliceName) {
        targetSliceId = await this.findSliceByName(sliceName, processName);
      }

      if (!targetSliceId) {
        return {
          success: false,
          error: 'Could not find target slice. Provide either sliceId or sliceName.',
          executionTimeMs: performance.now() - startTime,
        };
      }

      // 追踪调用流程
      const flowData = await this.traceFlow(targetSliceId, direction, maxDepth);

      // 存储结果
      const artifact = this.artifactStore.store(
        'trace_flow',
        flowData,
        'trace_process_flow',
      );

      const executionTimeMs = performance.now() - startTime;

      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'trace_process_flow',
            startSliceId: targetSliceId,
            direction,
            maxDepth,
            nodeCount: flowData.totalRowCount,
            execMs: Math.round(executionTimeMs),
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
        },
        artifactRef: artifact.id,
        executionTimeMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * 根据名称查找 slice
   */
  private async findSliceByName(
    sliceName: string,
    processName?: string,
  ): Promise<number | undefined> {
    const escapedSliceName = sliceName.replace(/'/g, "''");
    const processFilter = processName
      ? `AND p.name LIKE '%${processName.replace(/'/g, "''")}%'`
      : '';

    const sql = `
      SELECT s.id
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE s.name LIKE '%${escapedSliceName}%'
      ${processFilter}
      ORDER BY s.dur DESC
      LIMIT 1
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({id: 'number'}); it.valid(); it.next()) {
      return (it.id as unknown as number | undefined) ?? undefined;
    }
    return undefined;
  }

  /**
   * 追踪调用流程
   */
  private async traceFlow(
    sliceId: number,
    direction: string,
    maxDepth: number,
  ): Promise<ArtifactData> {
    const rows: unknown[][] = [];

    const columns: ColumnDefinition[] = [
      {name: 'depth', type: 'integer'},
      {name: 'slice_id', type: 'integer'},
      {name: 'name', type: 'string'},
      {name: 'ts', type: 'timestamp'},
      {name: 'dur_ms', type: 'duration'},
      {name: 'thread', type: 'string'},
      {name: 'process', type: 'string'},
      {name: 'relation', type: 'string'},
      {name: 'from_pid', type: 'integer'},
      {name: 'to_pid', type: 'integer'},
      {name: 'binder_reply_id', type: 'integer'},
      {name: 'round_trip_ms', type: 'duration'},
    ];

    // 获取起始 slice 信息
    const startInfo = await this.getSliceInfo(sliceId);
    if (startInfo) {
      rows.push([
        0,
        sliceId,
        startInfo.name,
        startInfo.ts,
        startInfo.dur_ms,
        startInfo.thread,
        startInfo.process,
        'start',
        null,
        null,
        null,
        null,
      ]);
    }

    // 向下追踪子调用
    if (direction === 'down' || direction === 'both') {
      await this.traceChildren(sliceId, 1, maxDepth, rows);
    }

    // 向上追踪父调用
    if (direction === 'up' || direction === 'both') {
      await this.traceParents(sliceId, -1, maxDepth, rows);
    }

    // 追踪 Binder 跨进程调用
    if (startInfo) {
      await this.traceBinderTransactions(startInfo, direction, rows);
    }

    return {
      columns,
      rows,
      totalRowCount: rows.length,
    };
  }

  /**
   * 获取 slice 信息
   */
  private async getSliceInfo(sliceId: number): Promise<SliceInfo | null> {
    const sql = `
      SELECT s.name, s.ts, ROUND(s.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE s.id = ${sliceId}
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      return {
        name: it.name ?? '',
        ts: (it.ts as unknown as bigint | undefined) ?? 0n,
        dur_ms: (it.dur_ms as unknown as number | undefined) ?? 0,
        thread: it.thread ?? '',
        process: it.process ?? '',
      };
    }
    return null;
  }

  /**
   * 追踪子调用
   */
  private async traceChildren(
    parentId: number,
    depth: number,
    maxDepth: number,
    rows: unknown[][],
  ): Promise<void> {
    if (depth > maxDepth) return;

    const sql = `
      SELECT s.id, s.name, s.ts, ROUND(s.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE s.parent_id = ${parentId}
      ORDER BY s.dur DESC
      LIMIT 10
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      id: 'number',
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      rows.push([
        depth,
        it.id,
        it.name,
        it.ts,
        it.dur_ms,
        it.thread,
        it.process,
        'child',
        null,
        null,
        null,
        null,
      ]);

      // 递归
      await this.traceChildren((it.id as unknown as number | undefined) ?? 0, depth + 1, maxDepth, rows);
    }
  }

  /**
   * 追踪父调用
   */
  private async traceParents(
    childId: number,
    depth: number,
    maxDepth: number,
    rows: unknown[][],
  ): Promise<void> {
    if (Math.abs(depth) > maxDepth) return;

    const sql = `
      SELECT parent.id, parent.name, parent.ts, ROUND(parent.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice child
      JOIN slice parent ON child.parent_id = parent.id
      JOIN thread_track tt ON parent.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE child.id = ${childId}
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      id: 'number',
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      rows.push([
        depth,
        it.id,
        it.name,
        it.ts,
        it.dur_ms,
        it.thread,
        it.process,
        'parent',
        null,
        null,
        null,
        null,
      ]);

      // 递归
      await this.traceParents((it.id as unknown as number | undefined) ?? 0, depth - 1, maxDepth, rows);
    }
  }

  /**
   * 追踪 Binder 跨进程调用
   */
  private async traceBinderTransactions(
    sliceInfo: SliceInfo,
    direction: string,
    rows: unknown[][],
  ): Promise<void> {
    const ts = sliceInfo.ts;
    const dur = BigInt(Math.round(sliceInfo.dur_ms * 1e6));
    const endTs = ts + dur;
    const escapedProcess = sliceInfo.process.replace(/'/g, "''");

    // 查询发出的 Binder 事务
    if (direction === 'down' || direction === 'both') {
      try {
        const sql = `
          SELECT
            s.id AS slice_id,
            s.ts,
            ROUND(s.dur / 1e6, 2) AS dur_ms,
            s.name,
            t.name AS thread_name,
            p.name AS process_name,
            p.pid
          FROM slice s
          JOIN thread_track tt ON s.track_id = tt.id
          JOIN thread t ON tt.utid = t.utid
          JOIN process p ON t.upid = p.upid
          WHERE s.name LIKE 'binder transaction%'
            AND s.ts >= ${ts}
            AND s.ts <= ${endTs}
            AND p.name = '${escapedProcess}'
          ORDER BY s.dur DESC
          LIMIT 10
        `;

        const result = await this.trace.engine.query(sql);
        for (const it = result.iter({
          slice_id: 'number',
          ts: 'bigint',
          dur_ms: 'number',
          name: 'str',
          thread_name: 'str',
          process_name: 'str',
          pid: 'number',
        }); it.valid(); it.next()) {
          rows.push([
            1,
            it.slice_id,
            it.name,
            it.ts,
            it.dur_ms,
            it.thread_name,
            it.process_name,
            'binder_outgoing',
            it.pid,
            null,
            null,
            it.dur_ms,
          ]);
        }
      } catch (e) {
        // Binder 表可能不存在，忽略错误
        console.warn('Binder tracing failed:', e);
      }
    }
  }
}
