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

Example plan structure:
{
  sceneType: "scrolling",
  phases: [
    {
      id: "detect_jank",
      name: "Detect Jank Frames",
      description: "Find frames with jank",
      requiredTools: ["invoke_skill"],
      expectedOutputs: ["jank_rate", "worst_frames"]
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
