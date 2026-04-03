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
 * NavigateTimeline Tool - 时间轴导航
 *
 * 功能：
 * - 导航到指定时间戳位置
 * - 导航到指定 slice
 * - 控制可见窗口范围
 * - 支持居中、起始对齐等模式
 */

import {Trace} from '../../../public/trace';
import {Time} from '../../../base/time';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class NavigateTimelineTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'navigate_timeline',
    description: `Navigate the timeline view to a specific position.

Use this to show the user a relevant time range or slice.`,
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          description: 'Timestamp in nanoseconds (as string for bigint)',
        },
        sliceId: {
          type: 'number',
          description: 'Alternative: Navigate to a specific slice',
        },
        duration: {
          type: 'string',
          description: 'Visible window duration in nanoseconds',
        },
        align: {
          type: 'string',
          enum: ['center', 'start', 'zoom'],
          default: 'center',
          description: 'How to align the view',
        },
      },
    },
    category: 'navigation',
    concurrency: 'serial',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = performance.now();

    try {
      // 导航到 slice
      if (args.sliceId !== undefined) {
        const sliceId = args.sliceId as number;

        // 使用 Perfetto 的选择 API
        this.trace.selection.selectSqlEvent('slice', sliceId, {
          scrollToSelection: true,
          switchToCurrentSelectionTab: true,
        });

        return {
          success: true,
          data: {
            navigatedTo: 'slice',
            sliceId,
            message: `Navigated to slice ${sliceId}`,
          },
          executionTimeMs: performance.now() - startTime,
        };
      }

      // 导航到时间戳
      if (args.timestamp !== undefined) {
        const tsStr = args.timestamp as string;
        const ts = BigInt(tsStr);
        const time = Time.fromRaw(ts);
        const align = (args.align as string) || 'center';

        if (args.duration !== undefined) {
          // 设置可见范围
          const durStr = args.duration as string;
          const dur = BigInt(durStr);
          const endTime = Time.fromRaw(ts + dur);

          // 使用 timeline API 设置可见范围
          this.trace.timeline.panSpanIntoView(time, endTime);
        } else {
          // 只导航到时间点
          this.trace.timeline.panIntoView(time);
        }

        return {
          success: true,
          data: {
            navigatedTo: 'timestamp',
            timestamp: ts.toString(),
            align,
            message: `Navigated to timestamp ${ts}`,
          },
          executionTimeMs: performance.now() - startTime,
        };
      }

      return {
        success: false,
        error: 'Either timestamp or sliceId must be provided',
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
