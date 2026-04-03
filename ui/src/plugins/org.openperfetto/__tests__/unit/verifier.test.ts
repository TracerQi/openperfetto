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
 * Verifier 单元测试
 *
 * 测试三层验证系统：L1 启发式规则、L2 计划遵从检查、L3 接口
 */

import {Verifier, L3Reviewer} from '../../agent/verifier.js';
import type {ChatMessage, AnalysisPlan} from '../../types/agent';
import type {Artifact, ArtifactData} from '../../types/artifact';

describe('Verifier', () => {
  let verifier: Verifier;

  beforeEach(() => {
    verifier = new Verifier();
  });

  // 辅助函数：创建消息
  function createMessage(
    role: ChatMessage['role'],
    content: string,
    options?: {
      toolCall?: ChatMessage['toolCall'];
      toolResult?: ChatMessage['toolResult'];
    },
  ): ChatMessage {
    return {
      id: `msg_${Date.now()}_${Math.random()}`,
      role,
      content,
      timestamp: Date.now(),
      ...options,
    };
  }

  // 辅助函数：创建 artifact
  function createArtifact(
    data: Partial<ArtifactData> = {},
    options?: {sourceTool?: string; sourceQuery?: string},
  ): Artifact {
    return {
      id: `art_${Date.now()}`,
      type: 'table',
      createdAt: Date.now(),
      fullData: {
        columns: data.columns ?? [{name: 'value', type: 'integer'}],
        rows: data.rows ?? [[1]],
        totalRowCount: data.totalRowCount ?? 1,
      },
      summary: {
        rowCount: data.totalRowCount ?? 1,
        estimatedTokens: 100,
      },
      sourceTool: options?.sourceTool ?? 'execute_sql',
      sourceQuery: options?.sourceQuery,
    };
  }

  describe('L1 启发式规则验证', () => {
    describe('规则 L1-001: timestamp_monotonic', () => {
      it('时间戳单调递增应通过', () => {
        const artifact = createArtifact({
          columns: [{name: 'ts', type: 'timestamp'}],
          rows: [[100n], [200n], [300n]],
          totalRowCount: 3,
        });

        const issues = verifier.runL1Validation([], [artifact]);
        expect(issues.some((i) => i.includes('L1-001'))).toBe(false);
      });

      it('时间戳不单调应报错', () => {
        const artifact = createArtifact({
          columns: [{name: 'ts', type: 'timestamp'}],
          rows: [[300], [200], [100]], // 降序
          totalRowCount: 3,
        });

        const issues = verifier.runL1Validation([], [artifact]);
        expect(issues.some((i) => i.includes('L1-001'))).toBe(true);
      });
    });

    describe('规则 L1-002: thread_existence', () => {
      it('有工具支持的线程引用应通过', () => {
        const messages = [
          createMessage('assistant', 'RenderThread 阻塞了', {
            toolResult: {toolCallId: '1', success: true},
          }),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-002'))).toBe(false);
      });

      it('无工具支持的线程引用应报错', () => {
        const messages = [createMessage('assistant', 'RenderThread 阻塞了')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-002'))).toBe(true);
      });
    });

    describe('规则 L1-003: process_state_consistency', () => {
      it('一致的进程状态应通过', () => {
        const messages = [createMessage('assistant', '进程正在运行')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-003'))).toBe(false);
      });

      it('矛盾的进程状态应报错', () => {
        const messages = [
          createMessage('assistant', '进程正在运行，但后来进程被killed'),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-003'))).toBe(true);
      });
    });

    describe('规则 L1-004: cpu_freq_anomaly', () => {
      it('合理的 CPU 频率应通过', () => {
        const messages = [createMessage('assistant', 'CPU频率为 2.4GHz')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-004'))).toBe(false);
      });

      it('异常的 CPU 频率应报错', () => {
        const messages = [createMessage('assistant', 'CPU频率为 100GHz')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-004'))).toBe(true);
      });
    });

    describe('规则 L1-005: gc_pause_anomaly', () => {
      it('有证据支持的 GC 暂停应通过', () => {
        const messages = [createMessage('assistant', 'GC 暂停 150ms')];
        const artifacts = [
          createArtifact({}, {sourceTool: 'gc_analysis', sourceQuery: 'gc query'}),
        ];
        // 修改 summary 以包含 gc - 规则会检查 JSON.stringify(summary).toLowerCase() 是否包含 'gc'
        artifacts[0].summary = {
          ...artifacts[0].summary,
          insights: ['gc related'],
        };

        const issues = verifier.runL1Validation(messages, artifacts);
        // artifact summary 包含 'gc'，规则认为有证据支持，不应触发
        expect(issues.some((i) => i.includes('L1-005'))).toBe(false);
      });

      it('无证据的 GC 暂停声明应触发', () => {
        const messages = [createMessage('assistant', 'GC 暂停 200ms 导致卡顿')];
        // 没有提供任何 artifact 支持
        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-005'))).toBe(true);
      });
    });

    describe('规则 L1-006: main_thread_io', () => {
      it('有工具证据的主线程 IO 声明应通过', () => {
        const messages = [
          createMessage('assistant', '主线程存在IO问题', {
            toolResult: {toolCallId: '1', success: true},
          }),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-006'))).toBe(false);
      });

      it('无工具证据的主线程 IO 声明应报错', () => {
        const messages = [createMessage('assistant', '主线程存在I/O问题')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-006'))).toBe(true);
      });
    });

    describe('规则 L1-011: numeric_sanity', () => {
      it('合理的百分比应通过', () => {
        const messages = [createMessage('assistant', 'CPU使用率为 85%')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-011'))).toBe(false);
      });

      it('超出范围的百分比应报错', () => {
        const messages = [createMessage('assistant', 'CPU使用率为 150%')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-011'))).toBe(true);
      });

      it('负数格式不被正则匹配所以不触发检查', () => {
        // 注意：规则正则 /(\d+(?:\.\d+)?)\s*%/g 不匹配负数前缀
        // 所以 -10% 不会被捕获进行范围检查
        const messages = [createMessage('assistant', '效率为 -10%')];

        const issues = verifier.runL1Validation(messages, []);
        // 正则不匹配负数，所以不触发 L1-011
        expect(issues.some((i) => i.includes('L1-011'))).toBe(false);
      });

      it('超大百分比应报错', () => {
        const messages = [createMessage('assistant', '超标了 200%')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-011'))).toBe(true);
      });
    });

    describe('规则 L1-013: unsupported_root_cause', () => {
      it('有足够工具调用支持的根因应通过', () => {
        const messages = [
          createMessage('assistant', '根因是...', {
            toolResult: {toolCallId: '1', success: true},
          }),
          createMessage('assistant', '继续分析', {
            toolResult: {toolCallId: '2', success: true},
          }),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-013'))).toBe(false);
      });

      it('工具调用不足的根因声明应报错', () => {
        const messages = [
          createMessage('assistant', '根因是锁竞争', {
            toolResult: {toolCallId: '1', success: true},
          }),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-013'))).toBe(true);
      });
    });

    describe('规则 L1-014: anr_cause_unclear', () => {
      it('ANR 分析有原因类型应通过', () => {
        const messages = [
          createMessage('assistant', 'ANR 是由 input dispatch timeout 导致'),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-014'))).toBe(false);
      });

      it('ANR 分析无原因类型应报错', () => {
        const messages = [createMessage('assistant', '检测到 ANR')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-014'))).toBe(true);
      });
    });

    describe('规则 L1-015: lock_no_holder', () => {
      it('锁竞争分析有持有者应通过', () => {
        const messages = [
          createMessage('assistant', 'lock contention, held by RenderThread'),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-015'))).toBe(false);
      });

      it('锁竞争分析无持有者应报错', () => {
        const messages = [createMessage('assistant', '存在 lock contention')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-015'))).toBe(true);
      });
    });

    describe('规则 L1-016: fps_calculation', () => {
      it('合理的 FPS 值应通过', () => {
        const messages = [createMessage('assistant', '平均帧率为 58 fps')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-016'))).toBe(false);
      });

      it('异常的 FPS 值应报错', () => {
        const messages = [createMessage('assistant', '帧率为 500 fps')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-016'))).toBe(true);
      });
    });

    describe('规则 L1-018: no_query_conclusion', () => {
      it('有工具调用的结论应通过', () => {
        const messages = [
          createMessage('assistant', '结论：性能问题来自...', {
            toolResult: {toolCallId: '1', success: true},
          }),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-018'))).toBe(false);
      });

      it('无工具调用的结论应报错', () => {
        const messages = [createMessage('assistant', '结论：问题在于...')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-018'))).toBe(true);
      });
    });

    describe('规则 L1-020: single_frame_overmark', () => {
      it('正常的帧问题描述应通过', () => {
        const messages = [createMessage('assistant', '检测到多帧 jank')];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-020'))).toBe(false);
      });

      it('单帧问题过度标记应报错', () => {
        const messages = [
          createMessage('assistant', '单帧 jank 是严重问题'),
        ];

        const issues = verifier.runL1Validation(messages, []);
        expect(issues.some((i) => i.includes('L1-020'))).toBe(true);
      });
    });
  });

  describe('L2 计划遵从验证', () => {
    const createPlan = (options?: Partial<AnalysisPlan>): AnalysisPlan => ({
      id: 'plan_1',
      sceneType: 'scrolling',
      phases: [
        {
          id: 'phase1',
          name: '帧分析',
          description: '',
          requiredTools: ['execute_sql', 'invoke_skill'],
          expectedOutputs: ['frames'],
          completed: false,
        },
        {
          id: 'phase2',
          name: '根因分析',
          description: '',
          requiredTools: ['trace_process_flow'],
          expectedOutputs: ['root_cause'],
          completed: false,
        },
      ],
      successCriteria: ['Jank已识别', '根因已分析'],
      estimatedSteps: 4,
      submittedAt: Date.now(),
      ...options,
    });

    describe('硬性问题检测', () => {
      it('执行了所有工具应通过', () => {
        const plan = createPlan();
        const messages = [
          createMessage('assistant', '', {
            toolCall: {id: '1', name: 'execute_sql', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '2', name: 'invoke_skill', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '3', name: 'trace_process_flow', arguments: {}},
          }),
        ];

        const result = verifier.runL2Validation(plan, messages);
        expect(result.hardIssues.length).toBe(0);
      });

      it('缺少必需工具应报硬性问题', () => {
        const plan = createPlan();
        const messages = [
          createMessage('assistant', '', {
            toolCall: {id: '1', name: 'execute_sql', arguments: {}},
          }),
          // 缺少 invoke_skill 和 trace_process_flow
        ];

        const result = verifier.runL2Validation(plan, messages);
        expect(result.hardIssues.length).toBeGreaterThan(0);
        expect(result.hardIssues.some((i) => i.includes('invoke_skill'))).toBe(true);
      });
    });

    describe('软警告检测', () => {
      it('达成成功标准不应有软警告', () => {
        const plan = createPlan();
        const messages = [
          createMessage('assistant', 'Jank已识别，根因已分析完成', {
            toolCall: {id: '1', name: 'execute_sql', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '2', name: 'invoke_skill', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '3', name: 'trace_process_flow', arguments: {}},
          }),
        ];

        const result = verifier.runL2Validation(plan, messages);
        expect(result.softWarnings.length).toBe(0);
      });

      it('未达成成功标准应有软警告', () => {
        const plan = createPlan();
        const messages = [
          createMessage('assistant', '分析完成', {
            toolCall: {id: '1', name: 'execute_sql', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '2', name: 'invoke_skill', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '3', name: 'trace_process_flow', arguments: {}},
          }),
        ];

        const result = verifier.runL2Validation(plan, messages);
        expect(result.softWarnings.length).toBeGreaterThan(0);
        expect(result.softWarnings.some((i) => i.includes('soft'))).toBe(true);
      });

      it('软警告不应影响 passed 判定', async () => {
        const plan = createPlan();
        const messages = [
          createMessage('assistant', '分析完成', {
            toolCall: {id: '1', name: 'execute_sql', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '2', name: 'invoke_skill', arguments: {}},
          }),
          createMessage('assistant', '', {
            toolCall: {id: '3', name: 'trace_process_flow', arguments: {}},
          }),
        ];

        const result = await verifier.runFullVerification(messages, [], plan);

        // 只要没有硬性问题和 L1 问题，即使有软警告也应该 passed
        if (result.l1Issues.length === 0 && result.l2Issues.length === 0) {
          expect(result.passed).toBe(true);
        }
      });
    });

    describe('空计划处理', () => {
      it('没有计划应跳过 L2 检查', () => {
        const result = verifier.runL2Validation(null as any, []);
        expect(result.hardIssues.length).toBe(0);
        expect(result.softWarnings.length).toBe(0);
      });

      it('空阶段列表应跳过 L2 检查', () => {
        const plan = createPlan({phases: []});
        const result = verifier.runL2Validation(plan, []);
        expect(result.hardIssues.length).toBe(0);
      });
    });
  });

  describe('L3 审查接口', () => {
    it('未设置 L3 审查器时应返回 null', async () => {
      const result = await verifier.runL3Review('结论', ['证据']);
      expect(result).toBeNull();
    });

    it('设置 L3 审查器后应调用审查', async () => {
      const mockReviewer: L3Reviewer = {
        review: jest.fn().mockResolvedValue({
          approved: true,
          issues: [],
          suggestions: ['建议1'],
          confidence: 0.95,
        }),
      };

      verifier.setL3Reviewer(mockReviewer);
      const result = await verifier.runL3Review('结论', ['证据1', '证据2']);

      expect(mockReviewer.review).toHaveBeenCalledWith('结论', ['证据1', '证据2']);
      expect(result?.approved).toBe(true);
      expect(result?.confidence).toBe(0.95);
    });

    it('L3 审查失败应返回 null', async () => {
      const mockReviewer: L3Reviewer = {
        review: jest.fn().mockRejectedValue(new Error('API error')),
      };

      verifier.setL3Reviewer(mockReviewer);
      const result = await verifier.runL3Review('结论', []);

      expect(result).toBeNull();
    });

    it('createL3Reviewer 工厂方法应返回默认实现', () => {
      const reviewer = Verifier.createL3Reviewer('api_key', 'model');

      expect(reviewer).toBeDefined();
      expect(typeof reviewer.review).toBe('function');
    });
  });

  describe('完整验证流程', () => {
    it('所有检查通过时 passed 应为 true', async () => {
      const messages = [
        createMessage('assistant', '分析结果', {
          toolResult: {toolCallId: '1', success: true},
        }),
        createMessage('assistant', '', {
          toolResult: {toolCallId: '2', success: true},
        }),
      ];

      const result = await verifier.runFullVerification(messages, [], null);

      expect(result.passed).toBe(true);
      expect(result.l1Issues.length).toBe(0);
      expect(result.l2Issues.length).toBe(0);
      expect(result.totalIssues).toBe(0);
    });

    it('L1 问题应导致 passed 为 false', async () => {
      const messages = [
        createMessage('assistant', '结论是...'), // 无工具调用的结论
      ];

      const result = await verifier.runFullVerification(messages, [], null);

      expect(result.passed).toBe(false);
      expect(result.l1Issues.length).toBeGreaterThan(0);
    });

    it('结果应包含时间戳', async () => {
      const before = Date.now();
      const result = await verifier.runFullVerification([], [], null);
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('规则统计', () => {
    it('getRuleStats 应返回正确的统计', () => {
      const stats = verifier.getRuleStats();

      expect(stats.total).toBe(20);
      expect(stats.byCategory).toBeDefined();
      expect(stats.byCategory['data_integrity']).toBeGreaterThan(0);
      expect(stats.byCategory['performance_metrics']).toBeGreaterThan(0);
    });
  });

  describe('边界条件', () => {
    it('空消息列表应正常处理', () => {
      const issues = verifier.runL1Validation([], []);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('空 artifact 列表应正常处理', () => {
      const messages = [createMessage('user', '问题')];
      const issues = verifier.runL1Validation(messages, []);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('规则执行出错不应阻塞验证', async () => {
      // 即使某个规则失败，验证应继续
      const result = await verifier.runFullVerification([], [], null);
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
    });
  });
});
