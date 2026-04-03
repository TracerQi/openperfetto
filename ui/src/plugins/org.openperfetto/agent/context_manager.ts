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
import {SceneType} from '../types/plugin_state';
import {ChatMessage} from '../types/agent';

/**
 * Token 预算配置
 */
interface TokenBudgetConfig {
  total: number;
  systemPrompt: number;
  sceneStrategy: number;
  traceMetadata: number;
  history: number;
}

/**
 * 场景预算配置
 */
interface SceneBudgetConfig {
  total: number;
  allocation: {
    systemPrompt: number;
    sceneStrategy: number;
    traceMetadata: number;
    history: number;
  };
}

/**
 * 上下文管理器
 * 负责构建系统提示、管理 token 预算、压缩历史消息
 */
export class ContextManager {
  private trace: Trace;
  private currentSceneType: SceneType = 'general';
  private systemPrompt: string = '';
  private currentBudget: TokenBudgetConfig;

  /** 基础 Token 预算 */
  private static readonly BASE_BUDGET = 8192;

  /** 复杂场景 Token 预算 */
  private static readonly COMPLEX_BUDGET = 16384;

  /** 场景预算配置表 */
  private static readonly SCENE_BUDGETS: Record<SceneType, SceneBudgetConfig> =
    {
      // 复杂场景：ANR、冷启动需要更多上下文
      anr: {
        total: 16384,
        allocation: {
          systemPrompt: 0.1,
          sceneStrategy: 0.08,
          traceMetadata: 0.12,
          history: 0.7,
        },
      },
      startup_cold: {
        total: 16384,
        allocation: {
          systemPrompt: 0.1,
          sceneStrategy: 0.08,
          traceMetadata: 0.12,
          history: 0.7,
        },
      },
      binder_blocking: {
        total: 12288,
        allocation: {
          systemPrompt: 0.1,
          sceneStrategy: 0.08,
          traceMetadata: 0.12,
          history: 0.7,
        },
      },
      lock_contention: {
        total: 12288,
        allocation: {
          systemPrompt: 0.1,
          sceneStrategy: 0.08,
          traceMetadata: 0.12,
          history: 0.7,
        },
      },
      // 标准场景
      scrolling: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      startup_warm: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      startup_hot: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      io_analysis: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      high_load: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      screen_on_off: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      unlock: {
        total: 8192,
        allocation: {
          systemPrompt: 0.12,
          sceneStrategy: 0.08,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
      general: {
        total: 8192,
        allocation: {
          systemPrompt: 0.15,
          sceneStrategy: 0.05,
          traceMetadata: 0.1,
          history: 0.7,
        },
      },
    };

  constructor(trace: Trace) {
    this.trace = trace;
    this.currentBudget = this.calculateBudget('general');
  }

  /**
   * 根据场景计算 Token 预算
   */
  private calculateBudget(sceneType: SceneType): TokenBudgetConfig {
    const config = ContextManager.SCENE_BUDGETS[sceneType];
    const total = config.total;
    const alloc = config.allocation;

    return {
      total,
      systemPrompt: Math.floor(total * alloc.systemPrompt),
      sceneStrategy: Math.floor(total * alloc.sceneStrategy),
      traceMetadata: Math.floor(total * alloc.traceMetadata),
      history: Math.floor(total * alloc.history),
    };
  }

  /**
   * 获取当前预算配置
   */
  getBudget(): TokenBudgetConfig {
    return {...this.currentBudget};
  }

  /**
   * 根据场景构建完整上下文
   */
  async buildContext(sceneType: SceneType): Promise<void> {
    this.currentSceneType = sceneType;
    this.currentBudget = this.calculateBudget(sceneType);

    const parts: string[] = [];

    // 1. 核心角色定义（固定）
    parts.push(this.getCoreRolePrompt());

    // 2. 场景策略（按需）
    parts.push(this.getSceneStrategyPrompt(sceneType));

    // 3. Trace 元数据摘要
    parts.push(await this.getTraceMetadataPrompt());

    this.systemPrompt = parts.join('\n\n---\n\n');
  }

  /**
   * 获取构建好的系统提示
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * 构建上下文消息（裁剪历史保持在预算内）
   */
  buildContextMessages(messages: ChatMessage[]): ChatMessage[] {
    const historyBudget = this.currentBudget.history;
    let totalTokens = 0;
    const result: ChatMessage[] = [];

    // 从最新消息开始，倒序添加
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const tokens = this.estimateTokens(msg.content);

      if (totalTokens + tokens > historyBudget) {
        // 预算用尽，停止添加
        break;
      }

      result.unshift(msg);
      totalTokens += tokens;
    }

    return result;
  }

  /**
   * 估算文本的 Token 数量
   *
   * 改进方案：
   * - 中文字符按 1.5-2 tokens 估算
   * - 英文单词约 1.3 tokens
   * - 标点符号约 1 token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const punctuation = (text.match(/[^\w\s\u4e00-\u9fa5]/g) || []).length;

    return Math.ceil(
      chineseChars * 1.5 +
        englishWords * 1.3 +
        numbers * 0.5 +
        punctuation * 1,
    );
  }

  /**
   * 核心角色提示（固定内容）
   */
  private getCoreRolePrompt(): string {
    return `# 角色定义

你是一位专业的 Android 性能分析专家。你的任务是分析 Perfetto trace 文件，识别性能问题并提供可操作的建议。

## 分析方法论

1. **场景识别**: 首先确定场景类型（启动、滑动、ANR等）
2. **数据收集**: 使用工具收集相关指标和事件
3. **根因分析**: 遵循 WHY 链（至少深入2层）
4. **基于证据的结论**: 所有发现必须有 trace 数据支持

## 输出格式

你的分析应该包含:
- **严重程度**: HIGH / MEDIUM / LOW
- **发现**: 清晰描述问题
- **证据**: 来自 trace 的具体数据（时间戳、持续时间、计数）
- **根因**: 底层原因（包含 WHY 链）
- **建议**: 可操作的后续步骤

## 约束

- 绝不编造数据 - 所有数字必须来自实际查询
- 当数据不足时表达不确定性
- 使用查询结果中的时间戳，而非估算
- 关注可操作的洞察，而非泛泛的观察

## Planning Gate

在开始分析之前，你必须使用 submit_plan 工具提交分析计划。
计划应该包含:
- 分析阶段
- 每个阶段使用的工具
- 预期输出
- 成功标准`;
  }

  /**
   * 场景策略提示
   */
  private getSceneStrategyPrompt(sceneType: SceneType): string {
    const strategies: Record<SceneType, string> = {
      scrolling: `# 滑动分析策略

重点领域:
1. 帧时间线分析（预期 vs 实际）
2. Jank 检测和分类
3. 渲染线程阻塞识别
4. SF (SurfaceFlinger) deadline 错过

关键指标:
- 帧持续时间（60fps目标: 16.67ms）
- Jank 率百分比
- 最长阻塞调用持续时间

推荐工具:
- invoke_skill(frame_jank_detection)
- trace_process_flow 用于阻塞调用
- execute_sql 用于自定义帧查询`,

      startup_cold: `# 冷启动分析策略

重点领域:
1. 进程创建到首帧
2. 应用初始化阶段
3. ContentProvider 初始化
4. 启动期间主线程阻塞

关键指标:
- 总启动时间（进程 fork 到首帧）
- Time to Initial Display (TTID)
- Time to Full Display (TTFD)
- 阻塞调用分解

推荐工具:
- invoke_skill(cold_startup_analysis)
- trace_process_flow 用于启动序列
- execute_sql 用于进程生命周期事件`,

      startup_warm: `# 温启动分析策略

重点领域:
1. Activity resume 时间
2. View inflation 和 layout
3. 数据加载和绑定

关键指标:
- Resume 到首帧时间
- Layout pass 持续时间
- 数据加载延迟`,

      startup_hot: `# 热启动分析策略

重点领域:
1. Activity bring-to-front 时间
2. 窗口动画
3. Focus 获取

关键指标:
- Intent 到可见时间
- 动画持续时间`,

      anr: `# ANR 分析策略

重点领域:
1. 主线程阻塞源
2. Binder 事务延迟
3. 锁竞争
4. I/O 阻塞

关键指标:
- 阻塞持续时间（>5s 表示 ANR）
- 阻塞调用栈
- 竞争资源

关键: 识别 ANR 前的精确 5 秒窗口`,

      lock_contention: `# 锁竞争分析策略

重点领域:
1. Monitor 竞争事件
2. Mutex 获取时间
3. 线程阻塞模式

关键指标:
- 竞争持续时间
- 受影响线程
- 锁持有者识别`,

      binder_blocking: `# Binder 阻塞分析策略

重点领域:
1. Binder 事务时序
2. 服务端处理延迟
3. 线程池耗尽

关键指标:
- 事务往返时间
- 服务端处理时间
- 队列等待时间`,

      io_analysis: `# I/O 分析策略

重点领域:
1. 文件系统操作
2. 数据库查询
3. 主线程上的网络 I/O

关键指标:
- 每次操作的 I/O 持续时间
- 主线程 I/O 百分比
- 阻塞读/写调用`,

      high_load: `# 高 CPU 负载分析策略

重点领域:
1. 每核心 CPU 利用率
2. 热点方法/函数
3. 调度频率

关键指标:
- CPU 使用百分比
- 上下文切换率
- Runnable 时间 vs Running 时间`,

      screen_on_off: `# 亮灭屏分析策略

重点领域:
1. 显示状态转换
2. Wake lock 行为
3. 电源管理事件`,

      unlock: `# 设备解锁分析策略

重点领域:
1. Keyguard dismiss 时序
2. 生物识别认证延迟
3. 解锁后 Activity 启动`,

      general: `# 通用分析策略

对于未分类场景，遵循此通用方法:

1. 识别关注的主进程
2. 查找 UI 线程（主线程）阻塞
3. 检查帧丢失和 jank
4. 分析 CPU 和内存模式
5. 查找 I/O 和 Binder 问题

使用 execute_sql 和 lookup_sql_schema 进行探索。`,
    };

    return strategies[sceneType] || strategies.general;
  }

  /**
   * Trace 元数据提示
   */
  private async getTraceMetadataPrompt(): Promise<string> {
    const info = this.trace.traceInfo;

    // 获取主要进程列表
    let processes: string[] = [];
    try {
      const processesResult = await this.trace.engine.query(`
        SELECT name, pid, upid 
        FROM process 
        WHERE name IS NOT NULL AND name != ''
        ORDER BY 
          CASE WHEN name LIKE 'com.%' THEN 0 ELSE 1 END,
          pid
        LIMIT 20
      `);

      for (
        const it = processesResult.iter({
          name: 'str',
          pid: 'number',
          upid: 'number',
        });
        it.valid();
        it.next()
      ) {
        processes.push(`${it.name} (pid: ${it.pid})`);
      }
    } catch (e) {
      processes = ['(无法获取进程列表)'];
    }

    // 获取时间范围
    const startMs = Number(info.start) / 1_000_000;
    const endMs = Number(info.end) / 1_000_000;
    const durationMs = endMs - startMs;

    // 检测可用数据源
    const hasFrameTimeline = await this.hasFrameTimeline();
    const hasBinderData = await this.hasBinderData();
    const hasMemoryCounters = await this.hasMemoryCounters();

    return `# Trace 元数据

**Trace 标题**: ${info.traceTitle || 'Untitled'}
**持续时间**: ${(durationMs / 1000).toFixed(2)} 秒
**时间范围**: ${startMs.toFixed(0)}ms - ${endMs.toFixed(0)}ms

**主要进程**:
${processes.map((p) => `- ${p}`).join('\n')}

**可用数据源**:
- 调度数据: YES
- Frame timeline: ${hasFrameTimeline ? 'YES' : 'NO'}
- Binder transactions: ${hasBinderData ? 'YES' : 'NO'}
- Memory counters: ${hasMemoryCounters ? 'YES' : 'NO'}`;
  }

  private async hasFrameTimeline(): Promise<boolean> {
    try {
      const result = await this.trace.engine.query(
        `SELECT COUNT(*) as cnt FROM actual_frame_timeline_slice LIMIT 1`,
      );
      for (const it = result.iter({cnt: 'number'}); it.valid(); it.next()) {
        return it.cnt > 0;
      }
    } catch {
      return false;
    }
    return false;
  }

  private async hasBinderData(): Promise<boolean> {
    try {
      const result = await this.trace.engine.query(
        `SELECT COUNT(*) as cnt FROM slice WHERE name LIKE 'binder%' LIMIT 1`,
      );
      for (const it = result.iter({cnt: 'number'}); it.valid(); it.next()) {
        return it.cnt > 0;
      }
    } catch {
      return false;
    }
    return false;
  }

  private async hasMemoryCounters(): Promise<boolean> {
    try {
      const result = await this.trace.engine.query(
        `SELECT COUNT(*) as cnt FROM counter WHERE name LIKE 'mem.%' LIMIT 1`,
      );
      for (const it = result.iter({cnt: 'number'}); it.valid(); it.next()) {
        return it.cnt > 0;
      }
    } catch {
      return false;
    }
    return false;
  }
}
