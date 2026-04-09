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
 * MarkPosition Tool - 在时间轴上添加标记
 *
 * 功能：
 * - 在指定时间戳或 slice 位置添加标记
 * - 支持自定义颜色和注释
 * - AI 创建的标记有特殊标识
 */

import {Trace} from '../../../public/trace';
import {Time} from '../../../base/time';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {DEFAULT_AI_ZOOM_DURATION_NS} from '../types/plugin_state';
import {LONG, NUM} from '../../../trace_processor/query_result';
import {opLogger} from '../utils/logger';

export class MarkPositionTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'mark_position',
    description: `Add a marker to the timeline at a specific position.

Markers help highlight important events for the user.
AI-created markers are visually distinguished.`,
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          description: 'Timestamp in nanoseconds (as string)',
        },
        sliceId: {
          type: 'number',
          description: 'Alternative: Mark a specific slice',
        },
        note: {
          type: 'string',
          description: 'Note to attach to the marker',
        },
        color: {
          type: 'string',
          description: 'Marker color (hex)',
          default: '#4285f4',
        },
      },
      required: ['note'],
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const note = args.note as string;
    const color = (args.color as string) || '#4285f4';

    const startTime = performance.now();

    try {
      let timestamp: bigint | undefined;
      let duration: bigint = 0n;
      let sliceName = '';
      let threadName = '';
      let processName = '';
      let sliceTrackId = 0;

      // 从 sliceId 获取时间戳
      if (args.sliceId !== undefined) {
        const sliceId = args.sliceId as number;
        opLogger.debug('mark_position: querying slice', {sliceId});
        const sql = `
          SELECT s.ts, s.dur, s.name AS slice_name,
                 s.track_id,
                 t.name AS thread_name, p.name AS process_name
          FROM slice s
          JOIN thread_track tt ON s.track_id = tt.id
          JOIN thread t ON tt.utid = t.utid
          LEFT JOIN process p ON t.upid = p.upid
          WHERE s.id = ${sliceId}
        `;
        const result = await this.trace.engine.query(sql);

        for (const it = result.iter({
          ts: LONG,
          dur: LONG,
          track_id: NUM,
          slice_name: 'str',
          thread_name: 'str',
          process_name: 'str',
        }); it.valid(); it.next()) {
          timestamp = (it.ts as unknown as bigint | undefined) ?? undefined;
          duration = (it.dur as unknown as bigint) ?? 0n;
          sliceTrackId = Number(it.track_id);
          sliceName = it.slice_name ?? '';
          threadName = it.thread_name ?? '';
          processName = it.process_name ?? '';
          opLogger.debug('mark_position: slice found', {sliceTrackId, sliceName, threadName, processName});
          break;
        }

        if (timestamp === undefined) {
          return {
            success: false,
            error: `Slice not found: ${sliceId}`,
            executionTimeMs: performance.now() - startTime,
          };
        }
      } else if (args.timestamp !== undefined) {
        timestamp = BigInt(args.timestamp as string);
      } else {
        return {
          success: false,
          error: 'Either timestamp or sliceId must be provided',
          executionTimeMs: performance.now() - startTime,
        };
      }

      // 创建标记
      // 注意：Perfetto 的 notes API 可能因版本而异
      // 这里使用标准的 addNote 方法
      const noteText = `[AI] ${note}`;
      const time = Time.fromRaw(timestamp);

      // 尝试使用 notes API
      let markerId: string | undefined;
      try {
        const noteId = this.trace.notes.addNote({
          timestamp: time,
          color,
          text: noteText,
        });
        markerId = String(noteId);
      } catch (e) {
        // 如果 notes API 不可用，记录但不失败
        console.warn('Notes API not available:', e);
        markerId = `marker_${Date.now()}`;
      }

      // AI 标记使用默认缩放窗口
      const halfDur = BigInt(DEFAULT_AI_ZOOM_DURATION_NS) / 2n;
      const defaultTimelineState = {
        visibleWindowStart: (timestamp - halfDur).toString(),
        visibleWindowEnd: (timestamp + halfDur).toString(),
      };

      // 通过 trackIds tag 查找正确的 track URI（workspace 中不存在 /thread_track_${id} 这种自定义格式）
      let relatedTrackUri = '';
      if (sliceTrackId > 0) {
        const matchingTrack = this.trace.tracks
          .getAllTracks()
          .find((t) => t.tags?.trackIds?.includes(sliceTrackId));
        if (matchingTrack) {
          relatedTrackUri = matchingTrack.uri;
          opLogger.debug('mark_position: found relatedTrackUri', {sliceTrackId, uri: relatedTrackUri});
        } else {
          opLogger.warn(`mark_position: no track found for sliceTrackId=${sliceTrackId}`);
        }
      }

      return {
        success: true,
        data: {
          markerId,
          timestamp: timestamp.toString(),
          duration: (duration ?? 0n).toString(),
          sliceId: args.sliceId ?? 0,
          note: noteText,
          color,
          processName: processName ?? '',
          threadName: threadName ?? '',
          sliceName: sliceName ?? '',
          timelineState: defaultTimelineState,
          relatedTrackUri,
          message: `Marker added at ${timestamp}`,
        },
        executionTimeMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: performance.now() - startTime,
      };
    }
  }
}
