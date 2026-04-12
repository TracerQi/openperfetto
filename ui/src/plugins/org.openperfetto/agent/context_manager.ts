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
import {NUM} from '../../../trace_processor/query_result';
import {SceneType} from '../types/plugin_state';
import {ChatMessage} from '../types/agent';
import {opLogger} from '../utils/logger';

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
/**
 * 场景到 Skill ID 的静态映射
 * 前端仅注入 Skill ID 标记，后端负责加载完整 Skill 内容
 */
const SCENE_SKILL_MAP: Record<SceneType, string[]> = {
  scrolling: ['scroll_jank_detection', 'frame_timeline_analysis', 'render_thread_analysis'],
  startup_cold: ['app_startup_breakdown', 'startup_blocking_calls', 'startup_cpu_analysis'],
  startup_warm: ['app_startup_breakdown', 'startup_blocking_calls'],
  startup_hot: ['app_startup_breakdown'],
  anr: ['anr_root_cause', 'main_thread_blocking', 'binder_timeout_analysis'],
  lock_contention: ['lock_contention_analysis', 'mutex_wait_analysis'],
  binder_blocking: ['binder_transaction_analysis', 'binder_timeout_analysis'],
  io_analysis: ['network_io_analysis', 'thread_state_analysis'],
  high_load: ['cpu_scheduling_analysis', 'cpu_frequency_analysis', 'thread_state_analysis'],
  screen_on_off: ['wakelock_analysis', 'cpu_frequency_analysis'],
  unlock: ['process_overview', 'thread_state_analysis'],
  general: ['process_overview', 'cpu_scheduling_analysis', 'thread_state_analysis'],
};

export class ContextManager {
  private trace: Trace;
  private _currentSceneType: SceneType = 'general';
  private systemPrompt: string = '';
  // Current budget config, updated when scene changes
  private _currentBudget: TokenBudgetConfig;

  /** 基础 Token 预算 */
  static readonly BASE_BUDGET = 8192;

  /** 复杂场景 Token 预算 */
  static readonly COMPLEX_BUDGET = 16384;

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
    this._currentBudget = this.calculateBudget('general');
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
    return {...this._currentBudget};
  }

  /**
   * 获取当前场景类型
   */
  getCurrentSceneType(): SceneType {
    return this._currentSceneType;
  }

  /**
   * 根据场景构建完整上下文
   */
  async buildContext(sceneType: SceneType): Promise<void> {
    this._currentSceneType = sceneType;
    this._currentBudget = this.calculateBudget(sceneType);

    const parts: string[] = [];

    // 1. 核心角色定义（固定）
    parts.push(this.getCoreRolePrompt());

    // 2. 场景策略（按需）
    parts.push(this.getSceneStrategyPrompt(sceneType));

    // 3. Trace 元数据摘要
    parts.push(await this.getTraceMetadataPrompt());

    // 4. Perfetto 核心表 Schema 摘要（供 execute_sql 使用）
    parts.push(this.getCoreTableSchemaPrompt());

    // 5. 注入场景相关 Skill 标记（后端将融合完整 Skill 内容）
    const skillMarkers = this.getSkillMarkersForScene(sceneType);
    if (skillMarkers) {
      parts.push(skillMarkers);
    }

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
    const historyBudget = this._currentBudget.history;
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
- 成功标准

选择场景类型时，请根据用户问题语义选择最匹配的 sceneType:
- scrolling: 滑动/滚动性能问题，帧率、掉帧、卡顿、jank
- startup_cold: 冷启动/应用启动问题，启动时间、启动耗时、启动过程
- startup_warm: 温启动问题，从后台恢复慢
- startup_hot: 热启动问题，从最近任务恢复慢
- anr: 应用无响应，ANR、界面卡死
- lock_contention: 锁竞争问题
- binder_blocking: Binder/IPC 阻塞
- io_analysis: I/O 性能问题
- high_load: CPU 高负载问题，CPU 占用高、计算密集
- screen_on_off: 亮灭屏问题
- unlock: 解锁性能问题
- general: 通用性能分析

## 工具调用规则

1. **SQL 查询前必须确认表结构**：如果你不确定某个表的列名，先使用 lookup_sql_schema 工具查询，不要猜测列名。
2. **参数规范**：package_name 参数必须使用 Android 完整包名格式（如 com.android.settings），不要使用应用简称。
3. **避免重复调用**：同一个 Skill 或 SQL 不要用不同参数调用第二次（除非第一次返回了明确的错误提示需要修正参数）。如果已获得结果，直接使用该结果。
4. **工具调用顺序**：优先使用 invoke_skill 调用预定义技能获取结构化数据，当预定义技能不能满足需求时才使用 execute_sql 自定义查询。
5. **每次工具调用后**：先分析返回的数据，判断是否需要更多数据，再决定下一步调用。不要一次性规划所有调用。

## 参数使用规范

- package_name: 必须使用完整的 Android 包名（如 com.android.settings），不要使用缩写或简称（如 settings）
- 如果用户提到的应用名称不是完整包名，你应该先推断出完整包名再调用工具
- 常见应用映射：Settings → com.android.settings, Chrome → com.android.chrome, Phone → com.android.dialer, Camera → com.android.camera2, Calendar → com.android.calendar`;
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
- execute_sql 用于自定义帧查询

推荐阶段 ID（提交计划时请使用这些 ID）:
- frame_analysis: 帧时间线分析
- jank_detection: Jank 检测
- blocking_identification: 阻塞调用识别
- root_cause: 根因分析`,

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

推荐工具调用顺序:
1. invoke_skill(app_startup_breakdown, {package_name: "完整包名"}) — 获取启动阶段拆解
2. invoke_skill(startup_blocking_calls, {package_name: "完整包名"}) — 获取阻塞调用列表
3. execute_sql — 仅在需要补充细节时使用自定义查询

注意：
- 第2步依赖第1步的结果来确认启动过程是否正常
- package_name 必须使用完整 Android 包名（如 com.android.settings）

推荐阶段 ID（提交计划时请使用这些 ID）:
- process_creation: 进程创建分析
- initialization: 初始化阶段分析
- first_frame: 首帧分析
- root_cause: 根因分析`,

      startup_warm: `# 温启动分析策略

重点领域:
1. Activity resume 时间
2. View inflation 和 layout
3. 数据加载和绑定

关键指标:
- Resume 到首帧时间
- Layout pass 持续时间
- 数据加载延迟

推荐阶段 ID（提交计划时请使用这些 ID）:
- activity_resume: Activity 恢复分析
- view_binding: 视图绑定分析
- root_cause: 根因分析`,

      startup_hot: `# 热启动分析策略

重点领域:
1. Activity bring-to-front 时间
2. 窗口动画
3. Focus 获取

关键指标:
- Intent 到可见时间
- 动画持续时间

推荐阶段 ID（提交计划时请使用这些 ID）:
- bring_to_front: 前台切换分析
- root_cause: 根因分析`,

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

关键: 识别 ANR 前的精确 5 秒窗口

推荐阶段 ID（提交计划时请使用这些 ID）:
- blocking_detection: 阻塞检测
- stack_analysis: 调用栈分析
- resource_contention: 资源竞争分析
- root_cause: 根因分析`,

      lock_contention: `# 锁竞争分析策略

重点领域:
1. Monitor 竞争事件
2. Mutex 获取时间
3. 线程阻塞模式

关键指标:
- 竞争持续时间
- 受影响线程
- 锁持有者识别

推荐阶段 ID（提交计划时请使用这些 ID）:
- contention_detection: 竞争检测
- holder_identification: 持有者识别
- root_cause: 根因分析`,

      binder_blocking: `# Binder 阻塞分析策略

重点领域:
1. Binder 事务时序
2. 服务端处理延迟
3. 线程池耗尽

关键指标:
- 事务往返时间
- 服务端处理时间
- 队列等待时间

推荐阶段 ID（提交计划时请使用这些 ID）:
- transaction_analysis: 事务分析
- server_delay: 服务端延迟分析
- root_cause: 根因分析`,

      io_analysis: `# I/O 分析策略

重点领域:
1. 文件系统操作
2. 数据库查询
3. 主线程上的网络 I/O

关键指标:
- 每次操作的 I/O 持续时间
- 主线程 I/O 百分比
- 阻塞读/写调用

推荐阶段 ID（提交计划时请使用这些 ID）:
- io_detection: I/O 检测
- main_thread_io: 主线程 I/O 分析
- root_cause: 根因分析`,

      high_load: `# 高 CPU 负载分析策略

重点领域:
1. 每核心 CPU 利用率
2. 热点方法/函数
3. 调度频率

关键指标:
- CPU 使用百分比
- 上下文切换率
- Runnable 时间 vs Running 时间

推荐阶段 ID（提交计划时请使用这些 ID）:
- cpu_analysis: CPU 使用率分析
- hotspot_detection: 性能瓶颈检测
- root_cause: 根因分析`,

      screen_on_off: `# 亮灭屏分析策略

重点领域:
1. 显示状态转换
2. Wake lock 行为
3. 电源管理事件

推荐阶段 ID（提交计划时请使用这些 ID）:
- state_transition: 状态转换分析
- root_cause: 根因分析`,

      unlock: `# 设备解锁分析策略

重点领域:
1. Keyguard dismiss 时序
2. 生物识别认证延迟
3. 解锁后 Activity 启动

推荐阶段 ID（提交计划时请使用这些 ID）:
- keyguard_dismiss: 锁屏解除分析
- root_cause: 根因分析`,

      general: `# 通用分析策略

对于未分类场景，遵循此通用方法:

1. 识别关注的主进程
2. 查找 UI 线程（主线程）阻塞
3. 检查帧丢失和 jank
4. 分析 CPU 和内存模式
5. 查找 I/O 和 Binder 问题

使用 execute_sql 和 lookup_sql_schema 进行探索。

推荐阶段 ID（提交计划时请使用这些 ID）:
- data_collection: 数据收集
- pattern_identification: 模式识别
- root_cause: 根因分析`,
    };

    return strategies[sceneType] || strategies.general;
  }

  /**
   * Perfetto 核心表 Schema 摘要（硬编码，非动态查询）
   * 供 LLM 编写 execute_sql 时参考，避免列名/JOIN 路径错误
   */
  private getCoreTableSchemaPrompt(): string {
    return `# Perfetto 核心表结构（供 execute_sql 使用）

以下是 Perfetto trace 数据库的核心表结构。编写 SQL 时必须使用正确的列名和 JOIN 路径。

## 核心表

| 表名 | 主要列 |
|------|--------|
| process | upid(int, PK), pid(int), name(string) |
| thread | utid(int, PK), upid(int→process), tid(int), name(string), is_main_thread(int) |
| thread_track | id(int, PK), utid(int→thread) |
| slice | id(int, PK), ts(int64, ns), dur(int64, ns), name(string), track_id(int→thread_track), depth(int), parent_id(int) |
| counter_track | id(int, PK), name(string), utid(int) |
| counter | id(int, PK), track_id(int→counter_track), ts(int64, ns), value(real) |
| actual_frame_timeline_slice | ts(int64), dur(int64), name(string), upid(int), jank_type(string) |

## 常用 JOIN 路径

${'```'}
slice → thread_track (track_id = id) → thread (utid = utid) → process (upid = upid)
${'```'}

示例：查询某进程主线程上的 slice：
${'```sql'}
SELECT s.name, s.dur
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
JOIN process p ON t.upid = p.upid
WHERE p.name LIKE '%com.example.app%'
  AND t.is_main_thread = 1
${'```'}

## 注意事项
- slice 表没有 upid 列，不能直接写 s.upid
- thread 表的列名是 name，不是 thread_name
- 使用别名时注意区分：s.name(slice名)、t.name(线程名)、p.name(进程名)
- 时间单位：ts 和 dur 均为纳秒(ns)，如需毫秒请除以 1e6`;
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

  /**
   * 获取场景对应的 Skill 标记
   * 仅返回 Skill ID 标记，后端会将其解析并替换为完整 Skill 文档
   */
  private getSkillMarkersForScene(sceneType: SceneType): string | null {
    try {
      const skillIds = SCENE_SKILL_MAP[sceneType];
      if (!skillIds || skillIds.length === 0) {
        return null;
      }

      const markers = skillIds
        .map((id) => `skill:${id}|{}`)
        .join('\n');

      opLogger.info(
        `Injected ${skillIds.length} skill markers for scene "${sceneType}":`,
        skillIds,
      );

      return `## Available Analysis Skills

The following skills are available for this analysis scenario. The backend will provide detailed skill documentation.
Use the invoke_skill tool to execute any of these skills during your analysis.

${markers}`;
    } catch (e) {
      opLogger.warn(
        'Failed to get skills for scene, skipping injection',
        sceneType,
        e,
      );
      return null;
    }
  }

  private async hasFrameTimeline(): Promise<boolean> {
    try {
      const result = await this.trace.engine.query(
        `SELECT COUNT(*) as cnt FROM actual_frame_timeline_slice LIMIT 1`,
      );
      for (const it = result.iter({cnt: NUM}); it.valid(); it.next()) {
        return Number(it.cnt) > 0;
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
      for (const it = result.iter({cnt: NUM}); it.valid(); it.next()) {
        return Number(it.cnt) > 0;
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
      for (const it = result.iter({cnt: NUM}); it.valid(); it.next()) {
        return Number(it.cnt) > 0;
      }
    } catch {
      return false;
    }
    return false;
  }
}
