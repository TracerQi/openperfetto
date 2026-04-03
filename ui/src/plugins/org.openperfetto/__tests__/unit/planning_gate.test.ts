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
 * PlanningGate 单元测试
 *
 * 测试规划门控的计划验证和模板生成功能
 */

import {PlanningGate} from '../../agent/planning_gate.js';
import type {AnalysisPlan} from '../../types/agent';

describe('PlanningGate', () => {
  let planningGate: PlanningGate;

  beforeEach(() => {
    planningGate = new PlanningGate();
  });

  describe('有效计划验证', () => {
    it('应通过有效的完整计划', () => {
      const plan: AnalysisPlan = {
        id: 'plan_1',
        sceneType: 'scrolling',
        phases: [
          {
            id: 'frame_analysis',
            name: '帧分析',
            description: '分析帧时间线',
            requiredTools: ['execute_sql', 'invoke_skill'],
            expectedOutputs: ['frame_count', 'jank_rate'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因分析',
            description: '确定根因',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['root_cause'],
            completed: false,
          },
        ],
        successCriteria: ['Jank率已计算', '根因已识别'],
        estimatedSteps: 5,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('应通过包含 3 个阶段的计划', () => {
      const plan: AnalysisPlan = {
        id: 'plan_2',
        sceneType: 'startup_cold',
        phases: [
          {
            id: 'process_creation',
            name: '进程创建',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['fork_time'],
            completed: false,
          },
          {
            id: 'initialization',
            name: '初始化',
            description: '',
            requiredTools: ['trace_process_flow'],
            expectedOutputs: ['init_time'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['cause'],
            completed: false,
          },
        ],
        successCriteria: ['启动时间已测量'],
        estimatedSteps: 6,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(true);
    });
  });

  describe('无效计划检测', () => {
    it('应拒绝只有 1 个阶段的计划', () => {
      const plan: AnalysisPlan = {
        id: 'plan_invalid_1',
        sceneType: 'general',
        phases: [
          {
            id: 'only_phase',
            name: '唯一阶段',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 1,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('计划必须至少包含2个阶段');
    });

    it('应拒绝没有阶段的计划', () => {
      const plan: AnalysisPlan = {
        id: 'plan_invalid_2',
        sceneType: 'general',
        phases: [],
        successCriteria: ['完成'],
        estimatedSteps: 0,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('计划必须至少包含2个阶段');
    });

    it('应检测阶段缺少工具', () => {
      const plan: AnalysisPlan = {
        id: 'plan_invalid_3',
        sceneType: 'general',
        phases: [
          {
            id: 'phase1',
            name: '阶段1',
            description: '',
            requiredTools: [], // 没有工具
            expectedOutputs: ['result'],
            completed: false,
          },
          {
            id: 'phase2',
            name: '阶段2',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 2,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('阶段1') && i.includes('工具'))).toBe(true);
    });

    it('应检测阶段缺少预期输出', () => {
      const plan: AnalysisPlan = {
        id: 'plan_invalid_4',
        sceneType: 'general',
        phases: [
          {
            id: 'phase1',
            name: '阶段1',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: [], // 没有预期输出
            completed: false,
          },
          {
            id: 'phase2',
            name: '阶段2',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 2,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('阶段1') && i.includes('输出'))).toBe(true);
    });

    it('应检测缺少成功标准', () => {
      const plan: AnalysisPlan = {
        id: 'plan_invalid_5',
        sceneType: 'general',
        phases: [
          {
            id: 'phase1',
            name: '阶段1',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
          {
            id: 'phase2',
            name: '阶段2',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
        ],
        successCriteria: [], // 没有成功标准
        estimatedSteps: 2,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('计划必须定义成功标准');
    });
  });

  describe('必需阶段检查', () => {
    it('滑动场景应建议包含 frame_analysis 阶段', () => {
      const plan: AnalysisPlan = {
        id: 'plan_scroll',
        sceneType: 'scrolling',
        phases: [
          {
            id: 'some_phase',
            name: '某阶段',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
          {
            id: 'another_phase',
            name: '另一阶段',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['result'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 2,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      // 缺少必需阶段会添加警告
      expect(result.issues.some((i) => i.includes('建议阶段'))).toBe(true);
    });

    it('包含必需阶段的计划应通过', () => {
      const plan: AnalysisPlan = {
        id: 'plan_scroll_valid',
        sceneType: 'scrolling',
        phases: [
          {
            id: 'frame_analysis',
            name: '帧分析',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['frames'],
            completed: false,
          },
          {
            id: 'jank_detection',
            name: 'Jank检测',
            description: '',
            requiredTools: ['invoke_skill'],
            expectedOutputs: ['jank'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: '根因分析',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['cause'],
            completed: false,
          },
        ],
        successCriteria: ['Jank已识别'],
        estimatedSteps: 3,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(true);
    });
  });

  describe('计划模板生成', () => {
    it('generatePlanTemplate 应返回滑动场景模板', () => {
      const template = planningGate.generatePlanTemplate('scrolling');

      expect(template).toContain('frame_analysis');
      expect(template).toContain('phases');
      expect(template).toContain('requiredTools');
      expect(template).toContain('expectedOutputs');
    });

    it('generatePlanTemplate 应返回冷启动场景模板', () => {
      const template = planningGate.generatePlanTemplate('startup_cold');

      expect(template).toContain('process_creation');
      expect(template).toContain('initialization');
      expect(template).toContain('ttid');
    });

    it('generatePlanTemplate 应返回 ANR 场景模板', () => {
      const template = planningGate.generatePlanTemplate('anr');

      expect(template).toContain('blocking_detection');
      expect(template).toContain('stack_analysis');
    });

    it('generatePlanTemplate 应为未知场景返回通用提示', () => {
      const template = planningGate.generatePlanTemplate('io_analysis');

      expect(template).toContain('phases');
      expect(template).toContain('requiredTools');
    });
  });

  describe('createPlanTemplate 对象创建', () => {
    it('应创建滑动场景计划模板对象', () => {
      const plan = planningGate.createPlanTemplate('scrolling');

      expect(plan.sceneType).toBe('scrolling');
      expect(plan.phases.length).toBeGreaterThanOrEqual(2);
      expect(plan.phases[0].id).toBe('frame_analysis');
      expect(plan.successCriteria.length).toBeGreaterThan(0);
      expect(plan.id).toMatch(/^plan_/);
      expect(plan.submittedAt).toBeGreaterThan(0);
    });

    it('应创建冷启动场景计划模板对象', () => {
      const plan = planningGate.createPlanTemplate('startup_cold');

      expect(plan.sceneType).toBe('startup_cold');
      expect(plan.phases.some((p) => p.id === 'process_creation')).toBe(true);
      expect(plan.phases.some((p) => p.id === 'initialization')).toBe(true);
    });

    it('应创建 ANR 场景计划模板对象', () => {
      const plan = planningGate.createPlanTemplate('anr');

      expect(plan.sceneType).toBe('anr');
      expect(plan.phases.some((p) => p.id === 'blocking_detection')).toBe(true);
    });

    it('应为未知场景创建通用模板对象', () => {
      const plan = planningGate.createPlanTemplate('high_load');

      expect(plan.sceneType).toBe('high_load');
      expect(plan.phases.length).toBeGreaterThanOrEqual(2);
      expect(plan.phases.some((p) => p.id === 'data_collection')).toBe(true);
      expect(plan.phases.some((p) => p.id === 'root_cause')).toBe(true);
    });

    it('模板对象应通过自身验证', () => {
      const scenes = ['scrolling', 'startup_cold', 'anr', 'general'] as const;

      for (const scene of scenes) {
        const plan = planningGate.createPlanTemplate(scene);
        const result = planningGate.validatePlan(plan);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('边界条件', () => {
    it('阶段 ID 模糊匹配应工作', () => {
      const plan: AnalysisPlan = {
        id: 'plan_fuzzy',
        sceneType: 'scrolling',
        phases: [
          {
            id: 'frame_analysis_custom', // 包含 frame_analysis
            name: '帧分析',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['frames'],
            completed: false,
          },
          {
            id: 'jank_detect', // 包含 jank
            name: 'Jank',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['jank'],
            completed: false,
          },
          {
            id: 'root_cause_analysis',
            name: '根因',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['cause'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 3,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      // 模糊匹配应能识别这些阶段
      expect(result.valid).toBe(true);
    });

    it('阶段名称也应参与匹配', () => {
      const plan: AnalysisPlan = {
        id: 'plan_name_match',
        sceneType: 'scrolling',
        phases: [
          {
            id: 'phase1',
            name: 'frame_analysis阶段', // 名称包含关键词
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['frames'],
            completed: false,
          },
          {
            id: 'phase2',
            name: 'blocking_identification',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['blocking'],
            completed: false,
          },
          {
            id: 'phase3',
            name: 'root_cause',
            description: '',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['cause'],
            completed: false,
          },
        ],
        successCriteria: ['完成'],
        estimatedSteps: 3,
        submittedAt: Date.now(),
      };

      const result = planningGate.validatePlan(plan);
      expect(result.valid).toBe(true);
    });
  });
});
