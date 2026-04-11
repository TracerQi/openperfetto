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
 * SubmitPlan Tool - 提交分析计划
 *
 * 功能：
 * - Agent 在开始分析前必须提交分析计划
 * - 计划包含分析阶段、所需工具、预期输出
 * - 通过 PlanningGate 验证计划的完整性
 */

import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {AnalysisPlan, AnalysisPhase} from '../types/agent';
import {SceneType} from '../types/plugin_state';

export class SubmitPlanTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'submit_plan',
    description: `Submit an analysis plan before starting investigation.

This is REQUIRED before using other analysis tools.
The plan should outline:
- Analysis phases with required tools
- Expected outputs for each phase
- Success criteria

IMPORTANT: You MUST analyze the user's question to determine the correct sceneType.
Read the user's question carefully and choose the sceneType that best matches their intent.

Scene type descriptions (choose the one that best matches the user's question):
- scrolling: 滑动/滚动性能问题，帧率、掉帧、卡顿、jank、fps、recyclerview
- startup_cold: 冷启动/应用启动问题，启动时间、启动耗时、启动过程、应用启动、TTID、TTFD、首次打开
- startup_warm: 温启动问题，从后台恢复、resume 慢
- startup_hot: 热启动问题，从最近任务恢复慢
- anr: 应用无响应，ANR、界面卡死、frozen、deadlock
- lock_contention: 锁竞争问题，mutex、synchronized、monitor contention
- binder_blocking: Binder/IPC 阻塞，跨进程调用慢、binder delay
- io_analysis: I/O 性能问题，磁盘读写慢、主线程 I/O、网络延迟
- high_load: CPU 高负载问题，CPU 占用高、计算密集、性能瓶颈
- screen_on_off: 亮灭屏问题，屏幕开关慢
- unlock: 解锁性能问题，指纹/面部解锁慢
- general: 通用性能分析，无法明确归类的性能问题

IMPORTANT: Use the recommended phase IDs for your scene type to ensure proper validation.
If you need additional phases beyond the recommended ones, you can add them freely.

Recommended phase IDs per scene type:
- scrolling: frame_analysis, jank_detection, blocking_identification, root_cause
- startup_cold: process_creation, initialization, first_frame, root_cause
- startup_warm: activity_resume, view_binding, root_cause
- startup_hot: bring_to_front, root_cause
- anr: blocking_detection, stack_analysis, resource_contention, root_cause
- lock_contention: contention_detection, holder_identification, root_cause
- binder_blocking: transaction_analysis, server_delay, root_cause
- io_analysis: io_detection, main_thread_io, root_cause
- high_load: cpu_analysis, hotspot_detection, root_cause
- screen_on_off: state_transition, root_cause
- unlock: keyguard_dismiss, root_cause
- general: data_collection, pattern_identification, root_cause

Example plan structure:
{
  sceneType: "startup_cold",
  phases: [
    {
      id: "process_creation",
      name: "Process Creation Analysis",
      description: "Analyze Settings process creation and initialization",
      requiredTools: ["execute_sql", "invoke_skill"],
      expectedOutputs: ["process_creation_time", "initialization_duration"]
    },
    {
      id: "initialization",
      name: "Initialization Phase Analysis",
      description: "Analyze main thread initialization and blocking calls",
      requiredTools: ["execute_sql", "trace_process_flow"],
      expectedOutputs: ["key_init_steps_duration", "blocking_calls"]
    },
    {
      id: "first_frame",
      name: "First Frame Rendering Analysis",
      description: "Analyze first frame render timing",
      requiredTools: ["execute_sql"],
      expectedOutputs: ["first_frame_timestamp", "total_render_duration"]
    },
    {
      id: "root_cause",
      name: "Root Cause Analysis",
      description: "Determine root cause with WHY chain",
      requiredTools: ["execute_sql"],
      expectedOutputs: ["root_cause", "why_chain"]
    }
  ],
  successCriteria: ["Root cause identified with evidence"]
}`,
    inputSchema: {
      type: 'object',
      properties: {
        sceneType: {
          type: 'string',
          description: 'The identified scene type',
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
        phases: {
          type: 'array',
          description: 'Analysis phases',
        },
        successCriteria: {
          type: 'array',
          description: 'Criteria for successful analysis',
        },
      },
      required: ['sceneType', 'phases', 'successCriteria'],
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sceneType = args.sceneType as SceneType;
    const phasesInput = args.phases as Array<{
      id?: string;
      name?: string;
      description?: string;
      requiredTools?: string[];
      expectedOutputs?: string[];
    }>;
    const successCriteria = args.successCriteria as string[];

    const startTime = performance.now();

    // 构建计划对象
    const phases: AnalysisPhase[] = (phasesInput || []).map((p, index) => ({
      id: p.id || `phase_${index + 1}`,
      name: p.name || `Phase ${index + 1}`,
      description: p.description || '',
      requiredTools: p.requiredTools || [],
      expectedOutputs: p.expectedOutputs || [],
      completed: false,
    }));

    const plan: AnalysisPlan = {
      id: `plan_${Date.now()}`,
      sceneType,
      phases,
      successCriteria: successCriteria || [],
      estimatedSteps: phases.length * 2,
      submittedAt: Date.now(),
    };

    // 计划验证由 AgentLoop 的 PlanningGate 统一处理
    // 此处不再双重验证，避免与 AgentLoop 行为不一致

    return {
      success: true,
      data: {
        status: 'success',
        plan,
        message: 'Analysis plan submitted successfully',
        hint: 'You can now proceed with the analysis phases',
      },
      executionTimeMs: performance.now() - startTime,
    };
  }
}
