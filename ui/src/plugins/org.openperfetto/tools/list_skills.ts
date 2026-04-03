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
 * ListSkills Tool - 列出可用的 Skills
 *
 * 功能：
 * - 获取后端可用的 Skill 列表
 * - 支持按场景类型和类别过滤
 * - 返回 Skill 的 ID、名称、描述和参数信息
 */

import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {WebSocketClient} from '../services/websocket_client';
import {SceneType} from '../types/plugin_state';

/**
 * Skill 参数定义
 */
interface SkillParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/**
 * Skill 定义
 */
interface SkillDefinition {
  id: string;
  name: string;
  category: 'atomic' | 'composite' | 'pipeline';
  type: string;
  description: string;
  params: SkillParam[];
}

export class ListSkillsTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'list_skills',
    description: `List available Skills for the current analysis scenario.

Returns Skills filtered by scene type with descriptions.
Use this to discover what predefined analysis patterns are available.`,
    inputSchema: {
      type: 'object',
      properties: {
        sceneType: {
          type: 'string',
          description: 'Filter by scene type (scrolling, startup_cold, anr, etc.)',
          enum: [
            'scrolling',
            'startup_cold',
            'startup_warm',
            'startup_hot',
            'anr',
            'lock_contention',
            'binder_blocking',
            'io_analysis',
            'high_load',
            'screen_on_off',
            'unlock',
            'general',
          ],
        },
        category: {
          type: 'string',
          description: 'Filter by Skill category',
          enum: ['atomic', 'composite', 'pipeline'],
        },
      },
    },
    category: 'skill',
    concurrency: 'parallel',
  };

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sceneType = args.sceneType as SceneType | undefined;
    const category = args.category as string | undefined;

    const startTime = performance.now();

    try {
      // 通过 WebSocket 获取 Skill 列表
      const wsClient = WebSocketClient.getInstance();
      const skills = await this.fetchSkillsViaWebSocket(
        wsClient,
        sceneType,
        category,
      );

      // 格式化为易读的列表
      const formatted = skills.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        type: s.type,
        description: s.description,
        params: s.params.map(
          (p) => `${p.name}${p.required ? '*' : ''}: ${p.type}`,
        ),
      }));

      const executionTimeMs = performance.now() - startTime;

      return {
        success: true,
        data: {
          status: 'success',
          skills: formatted,
          count: formatted.length,
          hint: 'Use invoke_skill(skillId, params) to execute a Skill',
        },
        executionTimeMs,
      };
    } catch (error) {
      // 如果 WebSocket 未连接，返回内置的 Skill 列表
      const builtinSkills = this.getBuiltinSkills(sceneType, category);

      return {
        success: true,
        data: {
          status: 'success',
          skills: builtinSkills,
          count: builtinSkills.length,
          hint: 'Use invoke_skill(skillId, params) to execute a Skill',
          note: 'Showing built-in skills (backend not connected)',
        },
        executionTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * 通过 WebSocket 获取 Skill 列表
   */
  private fetchSkillsViaWebSocket(
    wsClient: WebSocketClient,
    sceneType?: SceneType,
    category?: string,
  ): Promise<SkillDefinition[]> {
    return new Promise((resolve, reject) => {
      const requestId = `list_skills_${Date.now()}`;
      const timeout = 10000; // 10s 超时

      let timeoutHandle: ReturnType<typeof setTimeout>;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (unsubscribe) {
          unsubscribe();
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('List skills timeout'));
      }, timeout);

      unsubscribe = wsClient.onMessage((message) => {
        if (message.type === 'skills_list' && message.requestId === requestId) {
          cleanup();
          const payload = message.payload as {skills: SkillDefinition[]};
          resolve(payload.skills);
        }
      });

      const sent = wsClient.send({
        type: 'list_skills',
        requestId,
        payload: {sceneType, category},
      });

      if (!sent) {
        cleanup();
        reject(new Error('WebSocket not connected'));
      }
    });
  }

  /**
   * 获取内置 Skill 列表（当后端不可用时使用）
   */
  private getBuiltinSkills(
    sceneType?: SceneType,
    category?: string,
  ): Array<{
    id: string;
    name: string;
    category: string;
    description: string;
    params: string[];
  }> {
    const allSkills = [
      {
        id: 'detect_jank_frames',
        name: 'Detect Jank Frames',
        category: 'atomic',
        sceneTypes: ['scrolling', 'general'],
        description:
          'Detect frames that exceeded their deadline (jank frames)',
        params: ['processName: string', 'threshold_ms?: number'],
      },
      {
        id: 'analyze_startup_time',
        name: 'Analyze Startup Time',
        category: 'atomic',
        sceneTypes: ['startup_cold', 'startup_warm', 'startup_hot'],
        description: 'Analyze application startup time breakdown',
        params: ['packageName: string'],
      },
      {
        id: 'find_blocking_calls',
        name: 'Find Blocking Calls',
        category: 'atomic',
        sceneTypes: ['scrolling', 'anr', 'general'],
        description: 'Find blocking calls on the main thread',
        params: ['processName: string', 'minDuration_ms?: number'],
      },
      {
        id: 'detect_anr_window',
        name: 'Detect ANR Window',
        category: 'atomic',
        sceneTypes: ['anr'],
        description: 'Detect ANR windows and analyze blocking causes',
        params: ['processName: string'],
      },
      {
        id: 'analyze_binder_transactions',
        name: 'Analyze Binder Transactions',
        category: 'atomic',
        sceneTypes: ['binder_blocking', 'anr', 'general'],
        description: 'Analyze Binder IPC transactions and delays',
        params: ['processName: string', 'minLatency_ms?: number'],
      },
      {
        id: 'detect_lock_contention',
        name: 'Detect Lock Contention',
        category: 'atomic',
        sceneTypes: ['lock_contention', 'anr'],
        description: 'Detect lock contention events',
        params: ['processName: string'],
      },
      {
        id: 'analyze_io_operations',
        name: 'Analyze I/O Operations',
        category: 'atomic',
        sceneTypes: ['io_analysis', 'anr'],
        description: 'Analyze I/O operations, especially on main thread',
        params: ['processName: string'],
      },
      {
        id: 'cpu_hotspot_analysis',
        name: 'CPU Hotspot Analysis',
        category: 'composite',
        sceneTypes: ['high_load', 'general'],
        description: 'Identify CPU hotspots and high-usage functions',
        params: ['processName: string'],
      },
    ];

    return allSkills
      .filter((s) => {
        if (sceneType && !s.sceneTypes.includes(sceneType)) {
          return false;
        }
        if (category && s.category !== category) {
          return false;
        }
        return true;
      })
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        params: s.params,
      }));
  }
}
