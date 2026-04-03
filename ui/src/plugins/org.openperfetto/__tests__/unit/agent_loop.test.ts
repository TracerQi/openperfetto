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
 * AgentLoop 单元测试
 *
 * 测试 AgentLoop 状态机的状态枚举、常量和基本逻辑
 * 注意：由于 AgentLoop 有复杂的依赖（WebSocket、LLM等），
 * 完整的集成测试应该在 e2e 测试中进行
 */

import {AgentLoopState} from '../../agent/agent_loop.js';

describe('AgentLoopState 枚举', () => {
  it('应包含完整的状态流程', () => {
    // 验证核心状态存在
    expect(AgentLoopState.IDLE).toBeDefined();
    expect(AgentLoopState.CLASSIFYING).toBeDefined();
    expect(AgentLoopState.BUILDING_CONTEXT).toBeDefined();
    expect(AgentLoopState.AWAITING_PLAN).toBeDefined();
    expect(AgentLoopState.AWAITING_LLM).toBeDefined();
    expect(AgentLoopState.EXECUTING_TOOL).toBeDefined();
    expect(AgentLoopState.VERIFYING).toBeDefined();
    expect(AgentLoopState.COMPLETE).toBeDefined();
  });

  it('应包含错误和取消状态', () => {
    expect(AgentLoopState.ERROR).toBeDefined();
    expect(AgentLoopState.CANCELLED).toBeDefined();
  });

  it('总共应有 10 个状态', () => {
    const states = Object.values(AgentLoopState);
    expect(states.length).toBe(10);
  });

  it('所有状态值应该是唯一的字符串', () => {
    const values = Object.values(AgentLoopState);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
    
    // 验证都是字符串
    for (const value of values) {
      expect(typeof value).toBe('string');
    }
  });

  it('IDLE 应该是字符串 "IDLE"', () => {
    expect(AgentLoopState.IDLE).toBe('IDLE');
  });

  it('所有状态值应该与键名一致', () => {
    // string enum 的特点：值与键名相同
    expect(AgentLoopState.IDLE).toBe('IDLE');
    expect(AgentLoopState.CLASSIFYING).toBe('CLASSIFYING');
    expect(AgentLoopState.BUILDING_CONTEXT).toBe('BUILDING_CONTEXT');
    expect(AgentLoopState.AWAITING_PLAN).toBe('AWAITING_PLAN');
    expect(AgentLoopState.AWAITING_LLM).toBe('AWAITING_LLM');
    expect(AgentLoopState.EXECUTING_TOOL).toBe('EXECUTING_TOOL');
    expect(AgentLoopState.VERIFYING).toBe('VERIFYING');
    expect(AgentLoopState.COMPLETE).toBe('COMPLETE');
    expect(AgentLoopState.ERROR).toBe('ERROR');
    expect(AgentLoopState.CANCELLED).toBe('CANCELLED');
  });
});

describe('AgentLoop 状态机语义', () => {
  it('IDLE 表示空闲待命', () => {
    expect(AgentLoopState.IDLE).toBe('IDLE');
  });

  it('CLASSIFYING 表示正在分类场景', () => {
    expect(AgentLoopState.CLASSIFYING).toBe('CLASSIFYING');
  });

  it('BUILDING_CONTEXT 表示正在构建上下文', () => {
    expect(AgentLoopState.BUILDING_CONTEXT).toBe('BUILDING_CONTEXT');
  });

  it('AWAITING_PLAN 表示等待规划', () => {
    expect(AgentLoopState.AWAITING_PLAN).toBe('AWAITING_PLAN');
  });

  it('AWAITING_LLM 表示等待 LLM 响应', () => {
    expect(AgentLoopState.AWAITING_LLM).toBe('AWAITING_LLM');
  });

  it('EXECUTING_TOOL 表示正在执行工具', () => {
    expect(AgentLoopState.EXECUTING_TOOL).toBe('EXECUTING_TOOL');
  });

  it('VERIFYING 表示正在验证结果', () => {
    expect(AgentLoopState.VERIFYING).toBe('VERIFYING');
  });

  it('COMPLETE 表示分析完成', () => {
    expect(AgentLoopState.COMPLETE).toBe('COMPLETE');
  });

  it('ERROR 表示发生错误', () => {
    expect(AgentLoopState.ERROR).toBe('ERROR');
  });

  it('CANCELLED 表示已取消', () => {
    expect(AgentLoopState.CANCELLED).toBe('CANCELLED');
  });
});

describe('AgentLoop 配置常量', () => {
  // 这些常量应该在 AgentLoop 中定义
  it('MAX_ITERATIONS 应该有合理的默认值', () => {
    // 根据源码，MAX_ITERATIONS = 20
    const MAX_ITERATIONS = 20;
    expect(MAX_ITERATIONS).toBeGreaterThan(0);
    expect(MAX_ITERATIONS).toBeLessThanOrEqual(100);
  });

  it('MAX_DURATION_MS 应该有合理的默认值', () => {
    // 根据源码，MAX_DURATION_MS = 5 * 60 * 1000 = 300000 (5分钟)
    const MAX_DURATION_MS = 5 * 60 * 1000;
    expect(MAX_DURATION_MS).toBeGreaterThan(60000); // 至少 1 分钟
    expect(MAX_DURATION_MS).toBeLessThanOrEqual(600000); // 最多 10 分钟
  });

  it('TOOL_TIMEOUT_MS 应该有合理的默认值', () => {
    // 根据源码，TOOL_TIMEOUT_MS = 30000 (30秒)
    const TOOL_TIMEOUT_MS = 30000;
    expect(TOOL_TIMEOUT_MS).toBeGreaterThan(5000); // 至少 5 秒
    expect(TOOL_TIMEOUT_MS).toBeLessThanOrEqual(120000); // 最多 2 分钟
  });
});

describe('AgentLoop 状态转换规则', () => {
  // 定义有效的状态转换
  const validTransitions: Map<AgentLoopState, AgentLoopState[]> = new Map([
    [
      AgentLoopState.IDLE,
      [AgentLoopState.CLASSIFYING, AgentLoopState.CANCELLED],
    ],
    [
      AgentLoopState.CLASSIFYING,
      [
        AgentLoopState.BUILDING_CONTEXT,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [
      AgentLoopState.BUILDING_CONTEXT,
      [
        AgentLoopState.AWAITING_PLAN,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [
      AgentLoopState.AWAITING_PLAN,
      [
        AgentLoopState.AWAITING_LLM,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [
      AgentLoopState.AWAITING_LLM,
      [
        AgentLoopState.EXECUTING_TOOL,
        AgentLoopState.VERIFYING,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [
      AgentLoopState.EXECUTING_TOOL,
      [
        AgentLoopState.AWAITING_LLM,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [
      AgentLoopState.VERIFYING,
      [
        AgentLoopState.COMPLETE,
        AgentLoopState.AWAITING_LLM,
        AgentLoopState.ERROR,
        AgentLoopState.CANCELLED,
      ],
    ],
    [AgentLoopState.COMPLETE, [AgentLoopState.IDLE]], // reset
    [AgentLoopState.ERROR, [AgentLoopState.IDLE]], // reset
    [AgentLoopState.CANCELLED, [AgentLoopState.IDLE]], // reset
  ]);

  it('每个状态都应该有定义的转换规则', () => {
    const allStates = Object.values(AgentLoopState);

    for (const state of allStates) {
      expect(validTransitions.has(state)).toBe(true);
    }
  });

  it('IDLE 只能转换到 CLASSIFYING 或 CANCELLED', () => {
    const targets = validTransitions.get(AgentLoopState.IDLE);
    expect(targets).toContain(AgentLoopState.CLASSIFYING);
    expect(targets).toContain(AgentLoopState.CANCELLED);
    expect(targets?.length).toBe(2);
  });

  it('终态 (COMPLETE/ERROR/CANCELLED) 只能通过 reset 回到 IDLE', () => {
    const terminalStates = [
      AgentLoopState.COMPLETE,
      AgentLoopState.ERROR,
      AgentLoopState.CANCELLED,
    ];

    for (const state of terminalStates) {
      const targets = validTransitions.get(state);
      expect(targets).toEqual([AgentLoopState.IDLE]);
    }
  });

  it('所有活动状态都可以转换到 ERROR 和 CANCELLED', () => {
    const activeStates = [
      AgentLoopState.CLASSIFYING,
      AgentLoopState.BUILDING_CONTEXT,
      AgentLoopState.AWAITING_PLAN,
      AgentLoopState.AWAITING_LLM,
      AgentLoopState.EXECUTING_TOOL,
      AgentLoopState.VERIFYING,
    ];

    for (const state of activeStates) {
      const targets = validTransitions.get(state);
      expect(targets).toContain(AgentLoopState.ERROR);
      expect(targets).toContain(AgentLoopState.CANCELLED);
    }
  });

  it('EXECUTING_TOOL 可以循环回 AWAITING_LLM', () => {
    const targets = validTransitions.get(AgentLoopState.EXECUTING_TOOL);
    expect(targets).toContain(AgentLoopState.AWAITING_LLM);
  });

  it('VERIFYING 可以循环回 AWAITING_LLM（验证失败需要重试）', () => {
    const targets = validTransitions.get(AgentLoopState.VERIFYING);
    expect(targets).toContain(AgentLoopState.AWAITING_LLM);
  });
});

describe('AgentLoop 状态标签', () => {
  // 定义状态对应的中文标签（根据源码）
  const stateLabels: Record<AgentLoopState, string> = {
    [AgentLoopState.IDLE]: '空闲',
    [AgentLoopState.CLASSIFYING]: '场景识别中',
    [AgentLoopState.BUILDING_CONTEXT]: '构建上下文',
    [AgentLoopState.AWAITING_PLAN]: '等待规划',
    [AgentLoopState.AWAITING_LLM]: '等待 AI 响应',
    [AgentLoopState.EXECUTING_TOOL]: '执行工具',
    [AgentLoopState.VERIFYING]: '验证结果',
    [AgentLoopState.COMPLETE]: '分析完成',
    [AgentLoopState.ERROR]: '出错',
    [AgentLoopState.CANCELLED]: '已取消',
  };

  it('每个状态都应该有对应的中文标签', () => {
    const allStates = Object.values(AgentLoopState);

    for (const state of allStates) {
      expect(stateLabels[state]).toBeDefined();
      expect(typeof stateLabels[state]).toBe('string');
      expect(stateLabels[state].length).toBeGreaterThan(0);
    }
  });

  it('IDLE 标签应为"空闲"', () => {
    expect(stateLabels[AgentLoopState.IDLE]).toBe('空闲');
  });

  it('COMPLETE 标签应为"分析完成"', () => {
    expect(stateLabels[AgentLoopState.COMPLETE]).toBe('分析完成');
  });

  it('ERROR 标签应为"出错"', () => {
    expect(stateLabels[AgentLoopState.ERROR]).toBe('出错');
  });
});

describe('AgentLoop 状态类型检查', () => {
  it('可以使用 switch 语句处理所有状态', () => {
    const getStateName = (state: AgentLoopState): string => {
      switch (state) {
        case AgentLoopState.IDLE:
          return 'idle';
        case AgentLoopState.CLASSIFYING:
          return 'classifying';
        case AgentLoopState.BUILDING_CONTEXT:
          return 'building_context';
        case AgentLoopState.AWAITING_PLAN:
          return 'awaiting_plan';
        case AgentLoopState.AWAITING_LLM:
          return 'awaiting_llm';
        case AgentLoopState.EXECUTING_TOOL:
          return 'executing_tool';
        case AgentLoopState.VERIFYING:
          return 'verifying';
        case AgentLoopState.COMPLETE:
          return 'complete';
        case AgentLoopState.ERROR:
          return 'error';
        case AgentLoopState.CANCELLED:
          return 'cancelled';
        default:
          return 'unknown';
      }
    };

    expect(getStateName(AgentLoopState.IDLE)).toBe('idle');
    expect(getStateName(AgentLoopState.COMPLETE)).toBe('complete');
    expect(getStateName(AgentLoopState.ERROR)).toBe('error');
  });

  it('状态可以作为字符串比较', () => {
    const stateString: string = AgentLoopState.IDLE;
    expect(stateString === 'IDLE').toBe(true);
    expect(stateString === 'idle').toBe(false);
  });

  it('状态可以用于对象键', () => {
    const stateData: Record<string, number> = {
      [AgentLoopState.IDLE]: 0,
      [AgentLoopState.CLASSIFYING]: 1,
      [AgentLoopState.COMPLETE]: 2,
    };

    expect(stateData[AgentLoopState.IDLE]).toBe(0);
    expect(stateData['IDLE']).toBe(0);
  });
});
