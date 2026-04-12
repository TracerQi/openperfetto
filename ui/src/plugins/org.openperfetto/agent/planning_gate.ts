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

import {AnalysisPlan} from '../types/agent';
import {SceneType} from '../types/plugin_state';

/**
 * 计划验证结果
 */
export interface PlanValidationResult {
  valid: boolean;
  issues: string[];
  /** 硬性问题：结构缺陷，必须通知用户 */
  hardIssues: string[];
  /** 软性警告：建议性内容，仅日志记录 */
  softWarnings: string[];
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

  /** 场景必需阶段的语义别名映射 */
  private phaseAliases: Map<string, string[]> = new Map([
    ['process_creation', ['fork', 'process_start', 'process_info', 'target_app', 'identify_app', 'app_identify', '进程创建', '进程启动', '应用启动']],
    ['initialization', ['init', 'startup_phase', 'cold_startup', 'startup_analysis', 'app_init', 'bindApplication', '初始化', '应用初始化', '启动初始化']],
    ['first_frame', ['first_draw', 'ttfd', 'ttid', 'frame_render', 'rendering', 'first_frame_draw', '首帧', '首帧渲染', '第一帧']],
    ['root_cause', ['root_cause_analysis', 'cause', 'conclusion', 'final_analysis', 'diagnosis', '根因', '根本原因', '根因分析', '结论', '总结']],
    ['frame_analysis', ['frame_timeline', 'jank_detection', 'frame_inspection', '帧分析', '帧时间线']],
    ['blocking_identification', ['blocking_detection', 'blocking_call', 'blocking_analysis', 'main_thread_blocking', '阻塞识别', '阻塞检测', '主线程阻塞']],
    ['jank_detection', ['jank_frame', 'frame_jank', 'detect_jank', '卡顿检测', '掉帧检测']],
    ['activity_resume', ['resume', 'onResume', 'activity_start', 'Activity恢复']],
    ['view_binding', ['view_create', 'layout_inflate', 'view_init', '视图绑定', '视图创建']],
    ['bring_to_front', ['foreground', 'move_front', 'resume_activity', '前台切换']],
    ['blocking_detection', ['block_detect', 'main_block', 'ui_block', '阻塞检测']],
    ['stack_analysis', ['call_stack', 'stack_trace', 'trace_stack', '调用栈', '堆栈分析']],
    ['resource_contention', ['contention', 'lock_wait', 'resource_wait', '资源竞争', '锁竞争']],
    ['contention_detection', ['lock_contention_detect', 'contention_find', '竞争检测']],
    ['holder_identification', ['lock_holder', 'holder_find', 'owner_thread', '锁持有者']],
    ['transaction_analysis', ['binder_trans', 'transaction_trace', '事务分析', 'Binder分析']],
    ['server_delay', ['service_delay', 'binder_delay', 'server_slow', '服务端延迟']],
    ['io_detection', ['io_find', 'disk_detect', 'io_issue', 'IO检测', '磁盘检测']],
    ['main_thread_io', ['ui_io', 'main_disk', 'main_read_write', '主线程IO', '主线程磁盘']],
    ['cpu_analysis', ['cpu_usage', 'cpu_load', 'cpu_profile', 'CPU分析', 'CPU使用率', 'CPU负载', '性能分析', '耗时分析']],
    ['hotspot_detection', ['hotspot', 'bottleneck', 'cpu_hot', '热点检测', '瓶颈检测', '性能瓶颈', '耗时瓶颈']],
    ['state_transition', ['power_state', 'screen_transition', '状态转换']],
    ['keyguard_dismiss', ['lock_screen', 'keyguard_exit', '锁屏解除']],
    ['data_collection', ['collect', 'query_data', 'fetch_data', '数据收集', '数据采集']],
    ['pattern_identification', ['pattern_find', 'anomaly_detect', 'identify_pattern', '模式识别', '异常检测']],
  ]);

  /**
   * 验证分析计划的完整性
   */
  validatePlan(plan: AnalysisPlan): PlanValidationResult {
    const hardIssues: string[] = [];
    const softWarnings: string[] = [];

    // 1. 检查计划是否有足够的阶段（至少2个）— 硬性
    if (plan.phases.length < 2) {
      hardIssues.push('计划必须至少包含2个阶段');
    }

    // 2. 检查每个阶段是否有工具（至少1个）— 硬性
    for (const phase of plan.phases) {
      if (!phase.requiredTools || phase.requiredTools.length === 0) {
        hardIssues.push(`阶段 "${phase.name}" 未指定所需工具`);
      }
      if (!phase.expectedOutputs || phase.expectedOutputs.length === 0) {
        softWarnings.push(`阶段 "${phase.name}" 未指定预期输出`);
      }
    }

    // 3. 检查成功标准（至少1个）— 软性（不阻塞流程）
    if (!plan.successCriteria || plan.successCriteria.length === 0) {
      softWarnings.push('计划未定义成功标准');
    }

    // 4. 检查是否包含必要的阶段 — 软性（建议性）
    const requiredPhases =
      this.requiredPhases.get(plan.sceneType) ||
      this.requiredPhases.get('general')!;

    const phaseIds = plan.phases.map((p) => p.id.toLowerCase());
    const phaseNames = plan.phases.map((p) => p.name.toLowerCase());

    let matchedCount = 0;
    for (const required of requiredPhases) {
      const found = this.matchesRequiredPhase(phaseIds, phaseNames, required);
      if (found) {
        matchedCount++;
      }
    }

    // 匹配不到一半必需阶段时仅作为软性建议，不阻断流程
    if (matchedCount < requiredPhases.length / 2) {
      softWarnings.push(
        `计划可能缺少关键阶段。建议阶段: ${requiredPhases.join(', ')}`,
      );
    }

    // 5. 检查 package_name 参数是否使用完整包名格式 — 软性
    this.checkPackageNameFormat(plan, softWarnings);

    const issues = [...hardIssues, ...softWarnings];
    return {
      valid: hardIssues.length === 0,  // 只有硬性问题才影响 valid
      issues,
      hardIssues,
      softWarnings,
    };
  }

  /**
   * 检查必需阶段是否被计划中的某个阶段匹配
   * 支持字面匹配、语义别名匹配、关键词分词匹配
   */
  private matchesRequiredPhase(
    phaseIds: string[],
    phaseNames: string[],
    required: string,
  ): boolean {
    // 1. 字面匹配
    const literalMatch =
      phaseIds.some(
        (id) => id.includes(required) || required.includes(id),
      ) ||
      phaseNames.some(
        (name) => name.includes(required) || required.includes(name),
      );
    if (literalMatch) return true;

    // 2. 语义别名匹配
    const aliases = this.phaseAliases.get(required) || [];
    const aliasMatch = aliases.some(
      (alias) =>
        phaseIds.some(
          (id) => id.includes(alias) || alias.includes(id),
        ) ||
        phaseNames.some(
          (name) => name.includes(alias) || alias.includes(name),
        ),
    );
    if (aliasMatch) return true;

    // 3. 关键词分词匹配：将阶段名拆分为关键词，检查是否包含别名关键词
    // 例如 "startup_performance_analysis" 拆分为 ["startup", "performance", "analysis"]
    // 如果别名中包含这些关键词，则匹配成功
    const requiredKeywords = this.tokenizePhaseName(required);
    const aliasesKeywords = aliases.flatMap((alias) => this.tokenizePhaseName(alias));
    const allTargetKeywords = [...requiredKeywords, ...aliasesKeywords];

    return phaseIds.some((id) => {
      const idTokens = this.tokenizePhaseName(id);
      return allTargetKeywords.some(
        (target) => idTokens.some((token) => token.includes(target) || target.includes(token)),
      );
    }) || phaseNames.some((name) => {
      const nameTokens = this.tokenizePhaseName(name);
      return allTargetKeywords.some(
        (target) => nameTokens.some((token) => token.includes(target) || target.includes(token)),
      );
    });
  }

  /**
   * 将阶段名分词：按下划线、空格、驼峰拆分，并转小写
   */
  private tokenizePhaseName(name: string): string[] {
    // 按下划线和空格拆分
    const tokens = name
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // 驼峰分词
      .split(/[_\s]+/)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 2);  // 过滤单字符
    return tokens;
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

  /**
   * 检查计划中涉及的 package_name 参数是否使用完整包名格式
   * 完整包名格式：至少包含一个点号，如 com.android.settings
   */
  private checkPackageNameFormat(
    plan: AnalysisPlan,
    softWarnings: string[],
  ): void {
    // 仅检查 startup 相关场景
    const startupScenes: SceneType[] = [
      'startup_cold',
      'startup_warm',
      'startup_hot',
    ];

    if (!startupScenes.includes(plan.sceneType)) {
      return;
    }

    // 从计划的阶段描述中提取可能的包名引用
    for (const phase of plan.phases) {
      const text = `${phase.description || ''} ${phase.name || ''}`;
      // 匹配看起来像短名称的模式（常见应用简称）
      const shortNamePattern =
        /\b(?:settings|chrome|phone|camera|calendar|dialer|messages|contacts|clock|calculator)\b/i;
      const match = text.match(shortNamePattern);
      if (match) {
        softWarnings.push(
          `阶段 "${phase.name}" 中引用了应用简称 "${match[0]}"，` +
          `建议使用完整 Android 包名格式（如 com.android.settings）`,
        );
      }
    }
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
