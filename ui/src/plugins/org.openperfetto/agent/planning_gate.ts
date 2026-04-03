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

import {AnalysisPlan, AnalysisPhase} from '../types/agent';
import {SceneType} from '../types/plugin_state';

/**
 * 计划验证结果
 */
export interface PlanValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Planning Gate
 * 强制 Agent 在开始分析前提交分析计划
 */
export class PlanningGate {
  /** 场景必需阶段配置 */
  private requiredPhases: Map<SceneType, string[]> = new Map([
    [
      'scrolling',
      ['frame_analysis', 'jank_detection', 'blocking_identification', 'root_cause'],
    ],
    [
      'startup_cold',
      ['process_creation', 'initialization', 'first_frame', 'root_cause'],
    ],
    ['startup_warm', ['activity_resume', 'view_binding', 'root_cause']],
    ['startup_hot', ['bring_to_front', 'root_cause']],
    [
      'anr',
      ['blocking_detection', 'stack_analysis', 'resource_contention', 'root_cause'],
    ],
    [
      'lock_contention',
      ['contention_detection', 'holder_identification', 'root_cause'],
    ],
    [
      'binder_blocking',
      ['transaction_analysis', 'server_delay', 'root_cause'],
    ],
    ['io_analysis', ['io_detection', 'main_thread_io', 'root_cause']],
    ['high_load', ['cpu_analysis', 'hotspot_detection', 'root_cause']],
    ['screen_on_off', ['state_transition', 'root_cause']],
    ['unlock', ['keyguard_dismiss', 'root_cause']],
    ['general', ['data_collection', 'pattern_identification', 'root_cause']],
  ]);

  /**
   * 验证分析计划的完整性
   */
  validatePlan(plan: AnalysisPlan): PlanValidationResult {
    const issues: string[] = [];

    // 1. 检查计划是否有足够的阶段（至少2个）
    if (plan.phases.length < 2) {
      issues.push('计划必须至少包含2个阶段');
    }

    // 2. 检查每个阶段是否有工具（至少1个）
    for (const phase of plan.phases) {
      if (!phase.requiredTools || phase.requiredTools.length === 0) {
        issues.push(`阶段 "${phase.name}" 未指定所需工具`);
      }
      if (!phase.expectedOutputs || phase.expectedOutputs.length === 0) {
        issues.push(`阶段 "${phase.name}" 未指定预期输出`);
      }
    }

    // 3. 检查成功标准（至少1个）
    if (!plan.successCriteria || plan.successCriteria.length === 0) {
      issues.push('计划必须定义成功标准');
    }

    // 4. 检查是否包含必要的阶段（宽松检查）
    const requiredPhases =
      this.requiredPhases.get(plan.sceneType) ||
      this.requiredPhases.get('general')!;

    const phaseIds = plan.phases.map((p) => p.id.toLowerCase());
    const phaseNames = plan.phases.map((p) => p.name.toLowerCase());

    // 检查是否至少匹配了必需阶段的一半
    let matchedCount = 0;
    for (const required of requiredPhases) {
      const found =
        phaseIds.some(
          (id) => id.includes(required) || required.includes(id),
        ) ||
        phaseNames.some(
          (name) => name.includes(required) || required.includes(name),
        );
      if (found) {
        matchedCount++;
      }
    }

    // 如果匹配不到一半必需阶段，添加警告
    if (matchedCount < requiredPhases.length / 2) {
      issues.push(
        `计划可能缺少关键阶段。建议阶段: ${requiredPhases.join(', ')}`,
      );
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 生成计划模板
   */
  generatePlanTemplate(sceneType: SceneType): string {
    const templates: Partial<Record<SceneType, string>> = {
      scrolling: `请使用以下模板提交分析计划:

{
  "phases": [
    {
      "id": "frame_analysis",
      "name": "帧时间线分析",
      "description": "分析帧渲染时间线，识别 jank 帧",
      "requiredTools": ["invoke_skill", "execute_sql"],
      "expectedOutputs": ["frame_count", "jank_rate", "worst_frames"]
    },
    {
      "id": "blocking_identification",
      "name": "阻塞调用识别",
      "description": "识别导致掉帧的阻塞调用",
      "requiredTools": ["trace_process_flow", "execute_sql"],
      "expectedOutputs": ["blocking_calls", "blocking_duration"]
    },
    {
      "id": "root_cause",
      "name": "根因分析",
      "description": "通过 WHY 链确定根因",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["root_cause", "why_chain"]
    }
  ],
  "successCriteria": [
    "Jank 率已计算",
    "阻塞调用已识别",
    "根因包含 >= 2 层 WHY 链"
  ]
}`,

      startup_cold: `请使用以下模板提交分析计划:

{
  "phases": [
    {
      "id": "process_creation",
      "name": "进程创建分析",
      "description": "分析进程 fork 和初始化",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["fork_time", "process_info"]
    },
    {
      "id": "initialization",
      "name": "初始化阶段分析",
      "description": "分析 Application 和 ContentProvider 初始化",
      "requiredTools": ["invoke_skill", "trace_process_flow"],
      "expectedOutputs": ["init_phases", "blocking_calls"]
    },
    {
      "id": "first_frame",
      "name": "首帧分析",
      "description": "分析从 onCreate 到首帧的过程",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["ttid", "ttfd"]
    },
    {
      "id": "root_cause",
      "name": "根因分析",
      "description": "确定启动慢的根因",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["root_cause", "optimization_suggestions"]
    }
  ],
  "successCriteria": [
    "启动时间已测量",
    "关键阻塞点已识别",
    "提供可操作的优化建议"
  ]
}`,

      anr: `请使用以下模板提交分析计划:

{
  "phases": [
    {
      "id": "blocking_detection",
      "name": "阻塞检测",
      "description": "在 ANR 窗口内检测主线程阻塞",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["blocking_duration", "blocking_slices"]
    },
    {
      "id": "stack_analysis",
      "name": "调用栈分析",
      "description": "分析阻塞期间的调用栈",
      "requiredTools": ["trace_process_flow"],
      "expectedOutputs": ["call_stack", "blocking_source"]
    },
    {
      "id": "resource_contention",
      "name": "资源竞争分析",
      "description": "检查锁、Binder、I/O 竞争",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["contention_type", "contended_resource"]
    },
    {
      "id": "root_cause",
      "name": "根因分析",
      "description": "确定 ANR 的精确根因",
      "requiredTools": ["execute_sql"],
      "expectedOutputs": ["root_cause", "fix_suggestion"]
    }
  ],
  "successCriteria": [
    "ANR 窗口已定位",
    "阻塞源已识别",
    "根因明确且可操作"
  ]
}`,
    };

    return (
      templates[sceneType] ||
      `请提交一个分析计划，包含:
1. 多个分析阶段 (phases)
2. 每个阶段的所需工具 (requiredTools)
3. 每个阶段的预期输出 (expectedOutputs)
4. 成功标准 (successCriteria)`
    );
  }

  /**
   * 创建计划模板对象
   */
  createPlanTemplate(sceneType: SceneType): AnalysisPlan {
    const templates: Partial<Record<SceneType, AnalysisPlan>> = {
      scrolling: {
        id: `plan_${Date.now()}`,
        sceneType: 'scrolling',
        phases: [
          {
            id: 'frame_analysis',
            name: '帧时间线分析',
            description: '分析帧渲染时间线，识别 jank 帧',
            requiredTools: ['invoke_skill', 'execute_sql'],
            expectedOutputs: ['frame_count', 'jank_rate', 'worst_frames'],
            completed: false,
          },
          {
            id: 'blocking_identification',
            name: '阻塞调用识别',
            description: '识别导致掉帧的阻塞调用',
            requiredTools: ['trace_process_flow', 'execute_sql'],
            expectedOutputs: ['blocking_calls', 'blocking_duration'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因分析',
            description: '通过 WHY 链确定根因',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['root_cause', 'why_chain'],
            completed: false,
          },
        ],
        successCriteria: [
          'Jank 率已计算',
          '阻塞调用已识别',
          '根因包含 >= 2 层 WHY 链',
        ],
        estimatedSteps: 8,
        submittedAt: Date.now(),
      },

      startup_cold: {
        id: `plan_${Date.now()}`,
        sceneType: 'startup_cold',
        phases: [
          {
            id: 'process_creation',
            name: '进程创建分析',
            description: '分析进程 fork 和初始化',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['fork_time', 'process_info'],
            completed: false,
          },
          {
            id: 'initialization',
            name: '初始化阶段分析',
            description: '分析 Application 和 ContentProvider 初始化',
            requiredTools: ['invoke_skill', 'trace_process_flow'],
            expectedOutputs: ['init_phases', 'blocking_calls'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因分析',
            description: '确定启动慢的根因',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['root_cause', 'optimization_suggestions'],
            completed: false,
          },
        ],
        successCriteria: [
          '启动时间已测量',
          '关键阻塞点已识别',
          '提供可操作的优化建议',
        ],
        estimatedSteps: 10,
        submittedAt: Date.now(),
      },

      anr: {
        id: `plan_${Date.now()}`,
        sceneType: 'anr',
        phases: [
          {
            id: 'blocking_detection',
            name: '阻塞检测',
            description: '在 ANR 窗口内检测主线程阻塞',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['blocking_duration', 'blocking_slices'],
            completed: false,
          },
          {
            id: 'resource_contention',
            name: '资源竞争分析',
            description: '检查锁、Binder、I/O 竞争',
            requiredTools: ['execute_sql', 'trace_process_flow'],
            expectedOutputs: ['contention_type', 'contended_resource'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因分析',
            description: '确定 ANR 的精确根因',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['root_cause', 'fix_suggestion'],
            completed: false,
          },
        ],
        successCriteria: [
          'ANR 窗口已定位',
          '阻塞源已识别',
          '根因明确且可操作',
        ],
        estimatedSteps: 12,
        submittedAt: Date.now(),
      },
    };

    return templates[sceneType] || this.createGenericTemplate(sceneType);
  }

  private createGenericTemplate(sceneType: SceneType): AnalysisPlan {
    return {
      id: `plan_${Date.now()}`,
      sceneType,
      phases: [
        {
          id: 'data_collection',
          name: '数据收集',
          description: '收集相关 trace 数据',
          requiredTools: ['execute_sql', 'lookup_sql_schema'],
          expectedOutputs: ['relevant_data'],
          completed: false,
        },
        {
          id: 'pattern_identification',
          name: '模式识别',
          description: '识别异常模式',
          requiredTools: ['execute_sql'],
          expectedOutputs: ['patterns', 'anomalies'],
          completed: false,
        },
        {
          id: 'root_cause',
          name: '根因分析',
          description: '识别并解释根因',
          requiredTools: ['execute_sql', 'trace_process_flow'],
          expectedOutputs: ['root_cause', 'evidence'],
          completed: false,
        },
      ],
      successCriteria: ['问题已识别并有证据支持'],
      estimatedSteps: 5,
      submittedAt: Date.now(),
    };
  }
}
