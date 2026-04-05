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
 * InvokeSkill Tool - 调用后端 Skill
 *
 * 功能：
 * - 通过 WebSocket 调用后端预定义的 Skill
 * - Skill 是可复用的分析模式，包含优化过的 SQL 查询
 * - 结果存储到 ArtifactStore
 */

import {Trace} from '../../../public/trace';
import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {WebSocketClient} from '../services/websocket_client';
import {ArtifactData} from '../types/artifact';

/**
 * Skill 调用响应类型
 */
interface SkillResponse {
  success: boolean;
  data?: ArtifactData;
  sql?: string;
  skillDescription?: string;
  error?: string;
}

export class InvokeSkillTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'invoke_skill',
    description: `Invoke a predefined Skill from the backend.

Skills are reusable analysis patterns with optimized SQL queries.
Use list_skills to discover available Skills for the current scenario.

The skill will be executed on the backend and results returned.`,
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'The ID of the Skill to invoke',
        },
        params: {
          type: 'object',
          description: 'Parameters for the Skill',
        },
      },
      required: ['skillId'],
    },
    category: 'skill',
    concurrency: 'serial',
  };

  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    void trace; // Reserved for future use
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const skillId = args.skillId as string;
    const params = (args.params as Record<string, unknown>) || {};

    const startTime = performance.now();

    try {
      // 通过 WebSocket 调用 Skill
      const wsClient = WebSocketClient.getInstance();
      const response = await this.invokeSkillViaWebSocket(
        wsClient,
        skillId,
        params,
      );

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Skill execution failed',
          executionTimeMs: performance.now() - startTime,
        };
      }

      // 将结果存储到 ArtifactStore
      const data = response.data || {
        columns: [],
        rows: [],
        totalRowCount: 0,
      };

      const artifact = this.artifactStore.store(
        'table',
        data,
        `invoke_skill:${skillId}`,
        response.sql,
      );

      const executionTimeMs = performance.now() - startTime;

      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'invoke_skill',
            skillId,
            rowCount: data.totalRowCount,
            execMs: Math.round(executionTimeMs),
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
          skillDescription: response.skillDescription,
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
   * 生成 UUID
   */
  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 通过 WebSocket 调用 Skill
   */
  private invokeSkillViaWebSocket(
    wsClient: WebSocketClient,
    skillId: string,
    params: Record<string, unknown>,
  ): Promise<SkillResponse> {
    return new Promise((resolve, reject) => {
      const requestId = `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const traceId = this.generateUUID();
      const timeout = 30000; // 30s 超时

      let timeoutHandle: ReturnType<typeof setTimeout>;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (unsubscribe) {
          unsubscribe();
        }
      };

      // 设置超时
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`Skill invocation timeout: ${skillId}`));
      }, timeout);

      // 监听响应：后端发送 tool_result 和 error
      unsubscribe = wsClient.onMessage((message) => {
        // 检查是否匹配 requestId（后端会在 data 中透传）
        const msgData = message.payload as {
          requestId?: string;
          toolCallId?: string;
          success?: boolean;
          result?: unknown;
          error?: string;
          code?: string;
          message?: string;
        } | undefined;
        
        const matchesRequest = 
          msgData?.requestId === requestId || 
          msgData?.toolCallId === requestId;

        // 如果有 traceId，做额外验证
        if (matchesRequest && message.traceId && message.traceId !== traceId) {
          return; // traceId 不匹配，跳过
        }
        
        if (message.type === 'tool_result' && matchesRequest) {
          cleanup();
          if (msgData?.success) {
            const result = msgData.result as SkillResponse | undefined;
            resolve({
              success: true,
              data: result?.data,
              sql: result?.sql,
              skillDescription: result?.skillDescription,
            });
          } else {
            resolve({success: false, error: msgData?.error || 'Skill execution failed'});
          }
        } else if (message.type === 'error' && message.traceId) {
          // 检查是否是当前请求的错误（通过 traceId 或 requestId 匹配）
          const errorData = msgData as {code?: string; message?: string} | undefined;
          if (matchesRequest || message.requestId === requestId) {
            cleanup();
            resolve({success: false, error: errorData?.message || 'Skill error'});
          }
        }
      });

      // 发送请求：符合后端 InvokeSkillSchema 格式
      // 获取 agentId
      const connState = wsClient.getState();
      const agentId = connState.status === 'connected' && connState.agentId
        ? connState.agentId
        : this.generateUUID();

      const sent = wsClient.send({
        type: 'invoke_skill',
        agentId,
        traceId,
        requestId,
        skillId,
        params,
      } as import('../services/websocket_client').WebSocketMessage);

      if (!sent) {
        cleanup();
        reject(new Error('WebSocket not connected'));
      }
    });
  }
}
