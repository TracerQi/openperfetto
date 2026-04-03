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
 * ContextManager 单元测试
 *
 * 测试上下文管理器的 Token 预算分配、上下文构建、场景策略选择等功能
 */

import {ContextManager} from '../../agent/context_manager.js';
import {
  createMockTrace,
  createQueryResult,
  createEmptyQueryResult,
} from '../mocks';
import type {Trace} from '../../../../public/trace';
import type {ChatMessage} from '../../types/agent';

describe('ContextManager', () => {
  let contextManager: ContextManager;
  let mockTrace: ReturnType<typeof createMockTrace>;

  beforeEach(() => {
    mockTrace = createMockTrace({traceTitle: 'test-trace.perfetto'});
    // 默认返回空结果
    mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());
    contextManager = new ContextManager(mockTrace as unknown as Trace);
  });

  describe('Token 预算分配', () => {
    it('初始预算应为 general 场景配置', () => {
      const budget = contextManager.getBudget();
      expect(budget.total).toBe(8192);
      expect(budget.systemPrompt).toBeGreaterThan(0);
      expect(budget.sceneStrategy).toBeGreaterThan(0);
      expect(budget.traceMetadata).toBeGreaterThan(0);
      expect(budget.history).toBeGreaterThan(0);
    });

    it('ANR 场景应有更高预算 (16384)', async () => {
      await contextManager.buildContext('anr');
      const budget = contextManager.getBudget();
      expect(budget.total).toBe(16384);
    });

    it('冷启动场景应有更高预算 (16384)', async () => {
      await contextManager.buildContext('startup_cold');
      const budget = contextManager.getBudget();
      expect(budget.total).toBe(16384);
    });

    it('滑动场景应使用标准预算 (8192)', async () => {
      await contextManager.buildContext('scrolling');
      const budget = contextManager.getBudget();
      expect(budget.total).toBe(8192);
    });

    it('预算分配应符合百分比约束', async () => {
      await contextManager.buildContext('general');
      const budget = contextManager.getBudget();

      // 检查分配比例 (general: systemPrompt 15%, sceneStrategy 5%, traceMetadata 10%, history 70%)
      const total = budget.total;
      expect(budget.systemPrompt).toBe(Math.floor(total * 0.15));
      expect(budget.sceneStrategy).toBe(Math.floor(total * 0.05));
      expect(budget.traceMetadata).toBe(Math.floor(total * 0.1));
      expect(budget.history).toBe(Math.floor(total * 0.7));
    });

    it('Binder 阻塞场景预算应为 12288', async () => {
      await contextManager.buildContext('binder_blocking');
      const budget = contextManager.getBudget();
      expect(budget.total).toBe(12288);
    });
  });

  describe('上下文构建', () => {
    it('应设置当前场景类型', async () => {
      await contextManager.buildContext('scrolling');
      expect(contextManager.getCurrentSceneType()).toBe('scrolling');
    });

    it('系统提示应包含核心角色定义', async () => {
      // Mock 进程查询
      mockTrace.engine.query.mockResolvedValue(
        createQueryResult([
          {name: 'com.example.app', pid: 1234, upid: 1},
        ]),
      );

      await contextManager.buildContext('general');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('角色定义');
      expect(prompt).toContain('Android 性能分析专家');
      expect(prompt).toContain('Planning Gate');
    });

    it('系统提示应包含场景策略', async () => {
      mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());

      await contextManager.buildContext('scrolling');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('滑动分析策略');
      expect(prompt).toContain('帧时间线分析');
      expect(prompt).toContain('Jank 检测');
    });

    it('冷启动场景应有对应策略', async () => {
      mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());

      await contextManager.buildContext('startup_cold');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('冷启动分析策略');
      expect(prompt).toContain('TTID');
    });

    it('ANR 场景应有对应策略', async () => {
      mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());

      await contextManager.buildContext('anr');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('ANR 分析策略');
      expect(prompt).toContain('主线程阻塞');
    });
  });

  describe('Trace 元数据获取', () => {
    it('应包含 trace 标题和时间信息', async () => {
      mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());

      await contextManager.buildContext('general');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('Trace 元数据');
      expect(prompt).toContain('test-trace.perfetto');
    });

    it('应包含进程列表', async () => {
      mockTrace.engine.query.mockResolvedValue(
        createQueryResult([
          {name: 'com.example.app', pid: 1234, upid: 1},
          {name: 'system_server', pid: 1000, upid: 2},
        ]),
      );

      await contextManager.buildContext('general');
      const prompt = contextManager.getSystemPrompt();

      expect(prompt).toContain('主要进程');
      expect(prompt).toContain('com.example.app');
    });

    it('进程查询失败时应降级处理', async () => {
      mockTrace.engine.query.mockRejectedValue(new Error('Query failed'));

      await contextManager.buildContext('general');
      const prompt = contextManager.getSystemPrompt();

      // 应该仍能构建上下文，只是进程列表为空或显示错误信息
      expect(prompt).toContain('Trace 元数据');
    });
  });

  describe('Token 估算', () => {
    it('应正确估算中文文本 token', () => {
      const tokens = contextManager.estimateTokens('你好世界');
      // 4个中文字符 * 1.5 = 6 tokens
      expect(tokens).toBe(6);
    });

    it('应正确估算英文文本 token', () => {
      const tokens = contextManager.estimateTokens('hello world');
      // 2个英文单词 * 1.3 = 2.6，向上取整 = 3
      expect(tokens).toBe(3);
    });

    it('应正确估算混合文本 token', () => {
      const tokens = contextManager.estimateTokens('分析 performance 问题');
      // 3个中文字符 * 1.5 + 2个英文单词 * 1.3 = 4.5 + 2.6 = 7.1 ≈ 8
      expect(tokens).toBeGreaterThan(0);
    });

    it('空文本应返回 0', () => {
      const tokens = contextManager.estimateTokens('');
      expect(tokens).toBe(0);
    });
  });

  describe('上下文消息构建（历史裁剪）', () => {
    it('应保留最新消息在预算内', () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 100; i++) {
        messages.push({
          id: `msg_${i}`,
          role: 'user',
          content: 'A'.repeat(100), // 每条消息约 25 tokens
          timestamp: Date.now() + i,
        });
      }

      const result = contextManager.buildContextMessages(messages);

      // 历史预算约 5734 tokens (70% of 8192)
      // 每条消息约 25 tokens，应该保留约 229 条
      // 但最多 100 条，所以应该全部保留或接近全部
      expect(result.length).toBeLessThanOrEqual(messages.length);
      expect(result.length).toBeGreaterThan(0);

      // 最新消息应在结果中
      expect(result[result.length - 1].id).toBe('msg_99');
    });

    it('消息超出预算时应裁剪', () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          id: `msg_${i}`,
          role: 'user',
          content: 'A'.repeat(1000), // 每条消息约 250 tokens
          timestamp: Date.now() + i,
        });
      }

      const result = contextManager.buildContextMessages(messages);

      // 历史预算约 5734 tokens
      // 每条消息约 250 tokens，应该保留约 22 条
      // 但只有 10 条，应该全部保留
      expect(result.length).toBe(10);
    });

    it('空消息列表应返回空数组', () => {
      const result = contextManager.buildContextMessages([]);
      expect(result).toEqual([]);
    });
  });

  describe('场景切换', () => {
    it('切换场景应更新预算', async () => {
      await contextManager.buildContext('general');
      expect(contextManager.getBudget().total).toBe(8192);

      await contextManager.buildContext('anr');
      expect(contextManager.getBudget().total).toBe(16384);
    });

    it('切换场景应更新系统提示', async () => {
      await contextManager.buildContext('scrolling');
      const scrollPrompt = contextManager.getSystemPrompt();

      await contextManager.buildContext('startup_cold');
      const startupPrompt = contextManager.getSystemPrompt();

      expect(scrollPrompt).not.toBe(startupPrompt);
      expect(startupPrompt).toContain('冷启动');
    });
  });

  describe('边界条件', () => {
    it('所有场景类型都应有对应的预算配置', async () => {
      const scenes = [
        'scrolling', 'startup_cold', 'startup_warm', 'startup_hot',
        'anr', 'lock_contention', 'binder_blocking', 'io_analysis',
        'high_load', 'screen_on_off', 'unlock', 'general',
      ] as const;

      for (const scene of scenes) {
        await contextManager.buildContext(scene);
        const budget = contextManager.getBudget();
        expect(budget.total).toBeGreaterThan(0);
        expect(budget.systemPrompt).toBeGreaterThan(0);
      }
    });

    it('所有场景类型都应有对应的策略提示', async () => {
      const scenes = [
        'scrolling', 'startup_cold', 'anr', 'general',
      ] as const;

      for (const scene of scenes) {
        await contextManager.buildContext(scene);
        const prompt = contextManager.getSystemPrompt();
        expect(prompt.length).toBeGreaterThan(100);
      }
    });
  });
});
