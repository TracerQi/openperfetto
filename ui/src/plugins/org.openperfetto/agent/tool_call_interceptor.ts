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

import {ArtifactStore} from './artifact_store';

/**
 * 工具调用拦截结果
 */
export interface InterceptResult {
  /** 拦截决策 */
  action: 'EXECUTE' | 'REUSE' | 'BLOCK';

  /** 复用时返回的已有 artifact ID */
  artifactId?: string;

  /** 决策原因（用于日志和调试） */
  reason?: string;
}

/**
 * 工具调用拦截器
 *
 * 在工具实际执行前检查是否可以复用已有 artifact 结果，
 * 仅对 invoke_skill 类型的调用生效。
 */
export class ToolCallInterceptor {
  constructor(private readonly artifactStore: ArtifactStore) {}

  /**
   * 拦截工具调用，决定执行策略
   *
   * @param toolName - 工具名称（如 'invoke_skill', 'execute_sql'）
   * @param args - 工具参数（原始 JSON 对象）
   * @returns InterceptResult 拦截决策
   *
   * 逻辑：
   * 1. 如果 toolName !== 'invoke_skill'，直接返回 EXECUTE（不拦截）
   * 2. 从 args 中提取 skillId 和 params：
   *    - skillId = args.skill_id (string)
   *    - params = args.params (Record<string, unknown>) 或 {}
   * 3. 如果 skillId 为空或不存在，返回 EXECUTE
   * 4. 调用 artifactStore.findBySkillAndParams(skillId, params)
   * 5. 如果找到 VALID artifact：
   *    - 返回 { action: 'REUSE', artifactId: artifact.id, reason: `Reusing existing artifact ${artifact.id} for skill ${skillId}` }
   * 6. 如果未找到：
   *    - 返回 { action: 'EXECUTE', reason: `No valid artifact found for skill ${skillId}` }
   */
  intercept(
    toolName: string,
    args: Record<string, unknown>,
  ): InterceptResult {
    // 仅对 invoke_skill 类型生效
    if (toolName !== 'invoke_skill') {
      return {action: 'EXECUTE'};
    }

    // 提取 skillId 和 params
    const skillId = args.skill_id;
    if (!skillId || typeof skillId !== 'string') {
      return {action: 'EXECUTE'};
    }

    const params = (args.params as Record<string, unknown>) ?? {};

    // 查找匹配的 VALID artifact
    const existing = this.artifactStore.findBySkillAndParams(skillId, params);

    if (existing) {
      return {
        action: 'REUSE',
        artifactId: existing.id,
        reason: `Reusing existing artifact ${existing.id} for skill ${skillId}`,
      };
    }

    return {
      action: 'EXECUTE',
      reason: `No valid artifact found for skill ${skillId}`,
    };
  }
}
