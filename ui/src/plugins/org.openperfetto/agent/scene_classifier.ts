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

import {Trace} from '../../../public/trace';
import {NUM, NUM_NULL} from '../../../trace_processor/query_result';
import {SceneType} from '../types/plugin_state';

/**
 * 分类规则定义
 */
interface ClassificationRule {
  /** 关键词列表（中英文） */
  keywords: string[];
  /** 复合模式（多词组合） */
  compoundPatterns: string[];
  /** 目标场景类型 */
  sceneType: SceneType;
  /** 权重（1-15，越高优先级越高） */
  priority: number;
}

/**
 * 场景分类器
 * 通过关键词匹配和 trace 数据分析确定场景类型
 */
export class SceneClassifier {
  /**
   * 分类规则配置
   * 权重说明：
   * - 10: 高优先级场景（滑动、冷启动、ANR）
   * - 8-9: 中等优先级
   * - 6-7: 一般优先级
   */
  private rules: ClassificationRule[] = [
    // 滑动场景 - 权重10
    {
      keywords: [
        'scroll',
        'scrolling',
        'sliding',
        'swipe',
        '滑动',
        '滚动',
        'fling',
        'recyclerview',
        'jank',
        'fps',
        'frame',
        '掉帧',
        '卡顿',
      ],
      compoundPatterns: ['frame drop', 'jank during scroll', '滑动卡顿', '列表滑动'],
      sceneType: 'scrolling',
      priority: 10,
    },

    // 冷启动场景 - 权重10
    {
      keywords: [
        'cold start',
        'cold startup',
        'app launch',
        'first launch',
        '冷启动',
        'process start',
        'application start',
        '启动时间',
        '启动耗时',
        '启动过程',
        '启动分析',
        '启动',
        'ttid',
        'ttfd',
        '开动时间',
        '打开时间',
      ],
      compoundPatterns: ['slow startup', 'launch time', '启动慢', '应用启动', '启动耗时', '启动过程', '启动性能'],
      sceneType: 'startup_cold',
      priority: 10,
    },

    // ANR场景 - 权重15（最高优先级）
    {
      keywords: [
        'anr',
        'not responding',
        'application not responding',
        '无响应',
        'timeout',
        'deadlock',
        '死锁',
        '卡死',
        'frozen',
      ],
      compoundPatterns: ['frozen ui', 'stuck', '界面卡死', '应用无响应'],
      sceneType: 'anr',
      priority: 15,
    },

    // 温启动场景 - 权重9
    {
      keywords: ['warm start', 'warm startup', 'resume', '温启动', 'activity resume'],
      compoundPatterns: ['warm launch', 'resume slow'],
      sceneType: 'startup_warm',
      priority: 9,
    },

    // 热启动场景 - 权重8
    {
      keywords: ['hot start', 'hot startup', 'quick resume', '热启动'],
      compoundPatterns: ['bring to front', 'quick launch'],
      sceneType: 'startup_hot',
      priority: 8,
    },

    // 锁竞争场景 - 权重12
    {
      keywords: [
        'lock',
        'mutex',
        'synchronized',
        'contention',
        '锁',
        '锁竞争',
        'monitor',
        'blocking',
      ],
      compoundPatterns: ['lock contention', 'waiting for lock', '等待锁', '锁等待'],
      sceneType: 'lock_contention',
      priority: 12,
    },

    // Binder阻塞场景 - 权重11
    {
      keywords: [
        'binder',
        'ipc',
        'transaction',
        'remote call',
        'aidl',
        '跨进程',
      ],
      compoundPatterns: ['binder delay', 'slow binder', 'binder blocking', 'binder timeout'],
      sceneType: 'binder_blocking',
      priority: 11,
    },

    // I/O分析场景 - 权重9
    {
      keywords: [
        'io',
        'disk',
        'file',
        'database',
        'network',
        'read',
        'write',
        '磁盘',
        '文件',
        '数据库',
      ],
      compoundPatterns: ['slow io', 'blocking io', 'disk read', 'file write', '主线程IO'],
      sceneType: 'io_analysis',
      priority: 9,
    },

    // 高CPU负载场景 - 权重7
    {
      keywords: [
        'cpu',
        'load',
        'high usage',
        'performance',
        'slow',
        '性能',
        '慢',
        'cpu占用',
      ],
      compoundPatterns: ['high cpu', 'cpu bound', '高CPU', 'CPU占用高'],
      sceneType: 'high_load',
      priority: 7,
    },

    // 亮灭屏场景 - 权重6
    {
      keywords: ['screen on', 'screen off', 'display', 'wake', '亮屏', '灭屏', '屏幕'],
      compoundPatterns: ['screen on slow', 'display turn on'],
      sceneType: 'screen_on_off',
      priority: 6,
    },

    // 解锁场景 - 权重6
    {
      keywords: [
        'unlock',
        'keyguard',
        'fingerprint',
        'biometric',
        '解锁',
        '指纹',
        '面部识别',
      ],
      compoundPatterns: ['slow unlock', 'keyguard dismiss'],
      sceneType: 'unlock',
      priority: 6,
    },
  ];

  /**
   * 分类用户输入的场景
   */
  async classify(userMessage: string, trace: Trace): Promise<SceneType> {
    const lowerMessage = userMessage.toLowerCase();

    // 1. 基于关键词匹配计算分数
    const keywordScores = this.calculateKeywordScores(lowerMessage);

    // 2. 基于复合模式匹配计算分数
    const patternScores = this.calculatePatternScores(lowerMessage);

    // 3. 合并分数
    const combinedScores = new Map<SceneType, number>();

    for (const [scene, score] of keywordScores) {
      combinedScores.set(scene, (combinedScores.get(scene) || 0) + score);
    }

    for (const [scene, score] of patternScores) {
      // 复合模式权重 1.5x
      combinedScores.set(scene, (combinedScores.get(scene) || 0) + score * 1.5);
    }

    // 4. 如果没有明确匹配（分数低于阈值），尝试从 trace 数据推断
    const maxScore = Math.max(...Array.from(combinedScores.values()), 0);
    if (combinedScores.size === 0 || maxScore < 5) {
      const inferredScene = await this.classifyFromTrace(trace);
      if (inferredScene) {
        return inferredScene;
      }
    }

    // 5. 返回最高分的场景，或默认 general
    let bestScene: SceneType = 'general';
    let bestScore = 0;

    for (const [scene, score] of combinedScores) {
      if (score > bestScore) {
        bestScore = score;
        bestScene = scene;
      }
    }

    return bestScene;
  }

  /**
   * 从 trace 内容推断场景类型
   * 包含NULLIF防除零保护
   */
  async classifyFromTrace(trace: Trace): Promise<SceneType | null> {
    try {
      // 检查是否有 ANR 相关数据
      const anrResult = await trace.engine.query(`
        SELECT COUNT(*) as cnt 
        FROM slice 
        WHERE name LIKE '%ANR%' OR name LIKE '%not responding%'
        LIMIT 1
      `);
      for (const it = anrResult.iter({cnt: NUM}); it.valid(); it.next()) {
        if (Number(it.cnt) > 0) return 'anr';
      }

      // 检查是否有大量掉帧（使用NULLIF防除零）
      try {
        const jankResult = await trace.engine.query(`
          SELECT 
            COUNT(*) as jank_count,
            CAST(COUNT(*) AS FLOAT) * 100.0 / 
              NULLIF((SELECT COUNT(*) FROM actual_frame_timeline_slice), 0) as jank_rate
          FROM actual_frame_timeline_slice
          WHERE jank_type != 'None' AND jank_type IS NOT NULL
        `);
        for (
          const it = jankResult.iter({
            jank_count: NUM,
            jank_rate: NUM_NULL,
          });
          it.valid();
          it.next()
        ) {
          // jank_rate > 10% 认为是滑动问题
          const rate = it.jank_rate !== null ? Number(it.jank_rate) : 0;
          if (rate > 10) return 'scrolling';
        }
      } catch {
        // Frame timeline 表可能不存在
      }

      // 检查是否有启动相关的 slice
      const startupResult = await trace.engine.query(`
        SELECT COUNT(*) as cnt 
        FROM slice 
        WHERE name LIKE '%bindApplication%' 
           OR name LIKE '%activityStart%'
           OR name LIKE '%ActivityThreadMain%'
        LIMIT 1
      `);
      for (
        const it = startupResult.iter({cnt: NUM});
        it.valid();
        it.next()
      ) {
        if (Number(it.cnt) > 0) return 'startup_cold';
      }

      // 检查是否有 Binder 阻塞
      try {
        const binderResult = await trace.engine.query(`
          SELECT COUNT(*) as cnt,
                 AVG(dur) / 1e6 as avg_dur_ms
          FROM slice 
          WHERE name LIKE 'binder%'
          HAVING avg_dur_ms > 50
        `);
        for (
          const it = binderResult.iter({
            cnt: NUM,
            avg_dur_ms: NUM_NULL,
          });
          it.valid();
          it.next()
        ) {
          const avgDur = it.avg_dur_ms !== null ? Number(it.avg_dur_ms) : 0;
          if (avgDur > 50) return 'binder_blocking';
        }
      } catch {
        // Binder 数据可能不存在
      }

      // 检查锁竞争
      try {
        const lockResult = await trace.engine.query(`
          SELECT COUNT(*) as cnt
          FROM slice 
          WHERE name LIKE '%contention%' 
             OR name LIKE '%monitor%'
             OR name LIKE '%Lock%'
        `);
        for (
          const it = lockResult.iter({cnt: NUM});
          it.valid();
          it.next()
        ) {
          if (Number(it.cnt) > 10) return 'lock_contention';
        }
      } catch {
        // 忽略错误
      }
    } catch (error) {
      console.warn('Failed to infer scene from trace:', error);
    }

    return null;
  }

  /**
   * 计算关键词分数
   */
  private calculateKeywordScores(message: string): Map<SceneType, number> {
    const scores = new Map<SceneType, number>();

    for (const rule of this.rules) {
      let score = 0;
      for (const keyword of rule.keywords) {
        if (message.includes(keyword.toLowerCase())) {
          score += rule.priority;
        }
      }
      if (score > 0) {
        scores.set(rule.sceneType, (scores.get(rule.sceneType) || 0) + score);
      }
    }

    return scores;
  }

  /**
   * 计算复合模式分数
   */
  private calculatePatternScores(message: string): Map<SceneType, number> {
    const scores = new Map<SceneType, number>();

    for (const rule of this.rules) {
      for (const pattern of rule.compoundPatterns) {
        if (message.includes(pattern.toLowerCase())) {
          // 复合模式匹配给予双倍优先级分数
          scores.set(
            rule.sceneType,
            (scores.get(rule.sceneType) || 0) + rule.priority * 2,
          );
        }
      }
    }

    return scores;
  }

  /**
   * 获取场景的中文描述
   */
  getSceneDescription(sceneType: SceneType): string {
    const descriptions: Record<SceneType, string> = {
      scrolling: '滑动性能分析',
      startup_cold: '冷启动分析',
      startup_warm: '温启动分析',
      startup_hot: '热启动分析',
      anr: 'ANR分析',
      lock_contention: '锁竞争分析',
      binder_blocking: 'Binder阻塞分析',
      io_analysis: 'I/O性能分析',
      high_load: '高CPU负载分析',
      screen_on_off: '亮灭屏分析',
      unlock: '解锁性能分析',
      general: '通用分析',
    };
    return descriptions[sceneType] || '通用分析';
  }

  /**
   * 获取所有支持的场景类型
   */
  getSupportedScenes(): SceneType[] {
    return [
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
    ];
  }
}
