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
 * SceneClassifier 单元测试
 *
 * 测试场景分类器的关键词匹配和 trace 数据推断功能
 */

import {SceneClassifier} from '../../agent/scene_classifier.js';
import {
  createMockTrace,
  createQueryResult,
  createEmptyQueryResult,
} from '../mocks';
import type {Trace} from '../../../../public/trace';

describe('SceneClassifier', () => {
  let classifier: SceneClassifier;
  let mockTrace: ReturnType<typeof createMockTrace>;

  beforeEach(() => {
    classifier = new SceneClassifier();
    mockTrace = createMockTrace();
    // 默认返回空结果
    mockTrace.engine.query.mockResolvedValue(createEmptyQueryResult());
  });

  describe('关键词匹配 - 基本场景', () => {
    it('应识别滑动场景 - scroll关键词', async () => {
      const result = await classifier.classify(
        '分析滑动卡顿问题',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('应识别滑动场景 - jank关键词', async () => {
      const result = await classifier.classify(
        'analyze frame jank during scrolling',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('应识别滑动场景 - fps关键词', async () => {
      const result = await classifier.classify(
        'fps掉帧严重',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('应识别冷启动场景 - cold start', async () => {
      const result = await classifier.classify(
        '冷启动时间过长',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_cold');
    });

    it('应识别冷启动场景 - app launch', async () => {
      const result = await classifier.classify(
        'app launch is slow',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_cold');
    });

    it('应识别ANR场景 - anr关键词', async () => {
      const result = await classifier.classify(
        'ANR发生在主线程',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('应识别ANR场景 - 无响应关键词', async () => {
      const result = await classifier.classify(
        '应用无响应',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('应识别温启动场景', async () => {
      const result = await classifier.classify(
        'warm startup analysis',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_warm');
    });

    it('应识别热启动场景', async () => {
      const result = await classifier.classify(
        'hot start performance',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_hot');
    });

    it('应识别锁竞争场景', async () => {
      const result = await classifier.classify(
        '锁竞争导致卡顿',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('lock_contention');
    });

    it('应识别Binder阻塞场景', async () => {
      const result = await classifier.classify(
        'binder transaction slow',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('binder_blocking');
    });

    it('应识别IO分析场景', async () => {
      const result = await classifier.classify(
        '主线程有IO操作',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('io_analysis');
    });

    it('应识别高CPU负载场景', async () => {
      const result = await classifier.classify(
        'high cpu usage',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('high_load');
    });
  });

  describe('复合模式匹配', () => {
    it('复合模式应有更高权重 - frame drop', async () => {
      const result = await classifier.classify(
        'frame drop during scroll',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('复合模式应有更高权重 - 滑动卡顿', async () => {
      const result = await classifier.classify(
        '列表滑动卡顿',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('复合模式应有更高权重 - slow startup', async () => {
      const result = await classifier.classify(
        'slow startup time',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_cold');
    });
  });

  describe('中英文关键词匹配', () => {
    it('中文关键词 - 滚动', async () => {
      const result = await classifier.classify(
        '滚动性能分析',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('中文关键词 - 死锁', async () => {
      const result = await classifier.classify(
        '疑似死锁问题',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('英文关键词 - deadlock', async () => {
      const result = await classifier.classify(
        'deadlock detected',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });
  });

  describe('优先级处理', () => {
    it('ANR应有最高优先级 (15)', async () => {
      // ANR关键词 + 其他关键词，ANR应该胜出
      const result = await classifier.classify(
        'ANR timeout during scroll',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('锁竞争优先级高于滑动 (12 vs 10)', async () => {
      const result = await classifier.classify(
        'lock contention during scrolling',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('lock_contention');
    });
  });

  describe('无匹配时 fallback 到 general', () => {
    it('无关键词匹配应返回 general', async () => {
      const result = await classifier.classify(
        '这是一个普通的问题',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('general');
    });

    it('空消息应返回 general', async () => {
      const result = await classifier.classify(
        '',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('general');
    });
  });

  describe('从 Trace 数据推断场景', () => {
    it('检测到 ANR 相关数据应返回 anr', async () => {
      // 第一个查询：ANR 检测
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{cnt: 5}]),
      );

      const result = await classifier.classifyFromTrace(
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('检测到高 jank 率应返回 scrolling', async () => {
      // ANR 检测返回 0
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{cnt: 0}]),
      );
      // Jank 检测返回高 jank 率
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{jank_count: 100, jank_rate: 25.0}]),
      );

      const result = await classifier.classifyFromTrace(
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('检测到启动相关 slice 应返回 startup_cold', async () => {
      // ANR 检测返回 0
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{cnt: 0}]),
      );
      // Jank 检测返回低 jank 率
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{jank_count: 2, jank_rate: 1.0}]),
      );
      // 启动检测返回有结果
      mockTrace.engine.query.mockResolvedValueOnce(
        createQueryResult([{cnt: 10}]),
      );

      const result = await classifier.classifyFromTrace(
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('startup_cold');
    });

    it('无特征数据应返回 null', async () => {
      // 所有查询返回空或 0
      mockTrace.engine.query.mockResolvedValue(
        createQueryResult([{cnt: 0, jank_count: 0, jank_rate: 0}]),
      );

      const result = await classifier.classifyFromTrace(
        mockTrace as unknown as Trace,
      );
      expect(result).toBeNull();
    });
  });

  describe('辅助方法', () => {
    it('getSceneDescription 应返回场景描述', () => {
      expect(classifier.getSceneDescription('scrolling')).toBe('滑动性能分析');
      expect(classifier.getSceneDescription('startup_cold')).toBe('冷启动分析');
      expect(classifier.getSceneDescription('anr')).toBe('ANR分析');
      expect(classifier.getSceneDescription('general')).toBe('通用分析');
    });

    it('getSupportedScenes 应返回所有支持的场景', () => {
      const scenes = classifier.getSupportedScenes();
      expect(scenes).toContain('scrolling');
      expect(scenes).toContain('startup_cold');
      expect(scenes).toContain('anr');
      expect(scenes).toContain('general');
      expect(scenes.length).toBe(12);
    });
  });

  describe('边界条件', () => {
    it('大小写不敏感 - SCROLL', async () => {
      const result = await classifier.classify(
        'SCROLL JANK',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('scrolling');
    });

    it('特殊字符处理', async () => {
      const result = await classifier.classify(
        '分析 ANR/超时 问题',
        mockTrace as unknown as Trace,
      );
      expect(result).toBe('anr');
    });

    it('trace 查询失败时应 fallback 到 null', async () => {
      mockTrace.engine.query.mockRejectedValue(new Error('Query failed'));

      const result = await classifier.classifyFromTrace(
        mockTrace as unknown as Trace,
      );
      expect(result).toBeNull();
    });
  });
});
