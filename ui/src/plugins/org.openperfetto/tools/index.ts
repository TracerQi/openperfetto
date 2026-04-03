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
 * Tools Module - 导出所有 Tool 相关类型和实现
 *
 * 使用方式：
 * ```typescript
 * import {ToolRegistry, createAllTools} from './tools';
 *
 * const registry = new ToolRegistry(trace, artifactStore);
 * registry.registerAll(createAllTools(trace, artifactStore));
 * ```
 */

// 导出 ToolRegistry 和类型
export {
  ToolRegistry,
  ITool,
  ToolDefinition,
  ToolExecutionResult,
  JSONSchema,
} from './tool_registry';

// 导出所有 Tool 实现
export {ExecuteSqlTool} from './execute_sql';
export {InvokeSkillTool} from './invoke_skill';
export {ListSkillsTool} from './list_skills';
export {TraceProcessFlowTool} from './trace_process_flow';
export {LookupSqlSchemaTool} from './lookup_sql_schema';
export {FetchArtifactTool} from './fetch_artifact';
export {SubmitPlanTool} from './submit_plan';
export {NavigateTimelineTool} from './navigate_timeline';
export {MarkPositionTool} from './mark_position';
export {PinThreadTool} from './pin_thread';

// 导入依赖
import {Trace} from '../../../public/trace';
import {ArtifactStore} from '../agent/artifact_store';
import {ITool} from './tool_registry';

import {ExecuteSqlTool} from './execute_sql';
import {InvokeSkillTool} from './invoke_skill';
import {ListSkillsTool} from './list_skills';
import {TraceProcessFlowTool} from './trace_process_flow';
import {LookupSqlSchemaTool} from './lookup_sql_schema';
import {FetchArtifactTool} from './fetch_artifact';
import {SubmitPlanTool} from './submit_plan';
import {NavigateTimelineTool} from './navigate_timeline';
import {MarkPositionTool} from './mark_position';
import {PinThreadTool} from './pin_thread';

/**
 * 创建所有内置 Tools
 *
 * @param trace Perfetto Trace 实例
 * @param artifactStore ArtifactStore 实例
 * @returns 所有 Tool 实例数组
 */
export function createAllTools(
  trace: Trace,
  artifactStore: ArtifactStore,
): ITool[] {
  return [
    // Query Tools
    new ExecuteSqlTool(trace, artifactStore),
    new LookupSqlSchemaTool(trace),
    new TraceProcessFlowTool(trace, artifactStore),
    new FetchArtifactTool(artifactStore),

    // Skill Tools
    new InvokeSkillTool(trace, artifactStore),
    new ListSkillsTool(),

    // Mutation Tools
    new SubmitPlanTool(),

    // Navigation Tools
    new NavigateTimelineTool(trace),
    new MarkPositionTool(trace),
    new PinThreadTool(trace),
  ];
}

/**
 * 获取 Tool 名称列表（用于验证）
 */
export const TOOL_NAMES = [
  'execute_sql',
  'invoke_skill',
  'list_skills',
  'trace_process_flow',
  'lookup_sql_schema',
  'fetch_artifact',
  'submit_plan',
  'navigate_timeline',
  'mark_position',
  'pin_thread',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
