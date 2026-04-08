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
 * PinThread Tool - 置顶线程轨道
 *
 * 功能：
 * - 将指定线程的轨道固定到时间轴顶部
 * - 支持通过 utid 或进程/线程名称查找
 * - AI 置顶的轨道有特殊标识
 */

import {Trace} from '../../../public/trace';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {NUM, STR} from '../../../trace_processor/query_result';
import {Store} from '../../../base/store';
import {OpenPerfettoState} from '../types/plugin_state';

export class PinThreadTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'pin_thread',
    description: `Pin a thread track to the top of the timeline.

Pinned tracks remain visible when scrolling.
AI-pinned tracks are visually distinguished.`,
    inputSchema: {
      type: 'object',
      properties: {
        utid: {
          type: 'number',
          description: 'The unique thread ID (utid)',
        },
        processName: {
          type: 'string',
          description: 'Alternative: Process name pattern',
        },
        threadName: {
          type: 'string',
          description: 'Thread name pattern (used with processName)',
        },
      },
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  private trace: Trace;
  private store: Store<OpenPerfettoState> | null;

  constructor(trace: Trace, store?: Store<OpenPerfettoState>) {
    this.trace = trace;
    this.store = store ?? null;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = performance.now();

    try {
      let utid = args.utid as number | undefined;
      let threadName: string | undefined;
      let processName: string | undefined;

      // 如果提供了名称模式，先查找 utid
      if (utid === undefined && args.processName) {
        processName = args.processName as string;
        threadName = (args.threadName as string) || '%';

        const escapedProcess = processName.replace(/'/g, "''");
        const escapedThread = threadName.replace(/'/g, "''");

        const sql = `
          SELECT t.utid, t.name as thread_name, p.name as process_name
          FROM thread t
          JOIN process p ON t.upid = p.upid
          WHERE p.name LIKE '%${escapedProcess}%'
            AND t.name LIKE '%${escapedThread}%'
          LIMIT 1
        `;

        const result = await this.trace.engine.query(sql);
        for (const it = result.iter({
          utid: NUM,
          thread_name: STR,
          process_name: STR,
        }); it.valid(); it.next()) {
          utid = it.utid ?? undefined;
          threadName = it.thread_name ?? undefined;
          processName = it.process_name ?? undefined;
          break;
        }
      }

      if (utid === undefined) {
        return {
          success: false,
          error: 'Thread not found. Provide utid or valid processName/threadName pattern.',
          executionTimeMs: performance.now() - startTime,
        };
      }

      // 查找对应的 track 并 pin
      // Perfetto 的 track URI 格式通常是 /thread_{utid}
      const trackUri = `/thread_${utid}`;

      // 尝试通过 workspace API 获取 track
      let pinned = false;
      try {
        const workspace = this.trace.currentWorkspace;
        if (workspace) {
          // 遍历所有 tracks 查找匹配的
          const tracks = workspace.flatTracks;
          for (const track of tracks) {
            if (track.uri && track.uri.includes(`thread_${utid}`)) {
              track.pin();
              pinned = true;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('Workspace API not available:', e);
      }

      // 如果 workspace API 不可用，尝试其他方法
      if (!pinned) {
        try {
          // 尝试通过 currentWorkspace
          const currentWorkspace = this.trace.currentWorkspace;
          if (currentWorkspace) {
            const track = currentWorkspace.getTrackByUri(trackUri);
            if (track) {
              track.pin();
              pinned = true;
            }
          }
        } catch (e) {
          console.warn('Alternative pin method failed:', e);
        }
      }

      if (pinned) {
        // 记录 AI pin 状态到 store
        if (this.store) {
          const pinnedUri = trackUri;
          this.store.edit((draft) => {
            // 记录到 aiPinnedTrackUris
            if (!draft.aiPinnedTrackUris.includes(pinnedUri)) {
              draft.aiPinnedTrackUris.push(pinnedUri);
            }
            // 同时记录到当前 session 的 pinnedTracks
            if (draft.currentSession) {
              const exists = draft.currentSession.pinnedTracks.some(
                (p) => p.trackId === pinnedUri,
              );
              if (!exists) {
                draft.currentSession.pinnedTracks.push({
                  trackId: pinnedUri,
                  processName: processName ?? '',
                  threadName: threadName ?? '',
                  order: draft.currentSession.pinnedTracks.length,
                });
              }
            }
          });
        }

        return {
          success: true,
          data: {
            utid,
            trackUri,
            threadName,
            processName,
            pinned: true,
            aiPinned: true,
            message: `Thread ${utid} pinned to top`,
          },
          executionTimeMs: performance.now() - startTime,
        };
      }

      return {
        success: false,
        error: `Track not found for utid: ${utid}. The track may not exist in the current view.`,
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
