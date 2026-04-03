# OpenPerfetto 实现规格说明书 (Implementation Specification)

> **版本**: 1.0  
> **日期**: 2026-04-03  
> **状态**: 初稿  
> **关联文档**: OpenPerfetto PRD与架构设计文档

---

## 目录

1. [概述](#第1章概述)
2. [前端插件详细设计](#第2章前端插件详细设计)
3. [Agent核心引擎详细设计](#第3章agent核心引擎详细设计)
4. [Tool系统详细设计](#第4章tool系统详细设计)
5. [后端服务详细设计](#第5章后端服务详细设计nodejs-fastify)
6. [Skill系统详细设计](#第6章skill系统详细设计)
7. [通信协议详细设计](#第7章通信协议详细设计)
8. [数据模型](#第8章数据模型)
9. [开发阶段规划](#第9章开发阶段规划)
10. [测试策略](#第10章测试策略)
11. [附录](#第11章附录)

---

## 第1章：概述

### 1.1 项目目标

**OpenPerfetto** 是基于 Google Perfetto 开源项目的 AI 增强版，在 Perfetto Web UI 中集成 AI Agent，实现对 Android 性能 trace 的智能分析。

**核心价值主张**：
- 将"流程固定、细节变化"的 trace 分析工作自动化
- AI Agent 负责数据收集、流程梳理和初步归因
- 工程师做最终判断和确认
- 目标：让工程师基于 AI 分析结果在 5 分钟内定位到具体代码位置

### 1.2 范围边界

**包含范围**：
- 新侧边栏框架（可折叠/展开、主题切换、国际化）
- 搜索与 Pin 置顶功能
- 标记与跳转功能
- Agent 对话模块（核心）
- 设置入口
- Agent 核心引擎（前端）
- Tool 系统（前端）
- Skill 系统（后端）
- 后端服务（Node.js Fastify）
- WebSocket 通信协议

**不包含范围**：
- L3 独立模型审查验证（仅预留接口）
- 用户认证/授权系统
- 云端 trace 存储
- 多用户协作功能

### 1.3 技术栈汇总

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端框架 | Mithril.js 2.x + TypeScript | Perfetto 原生技术栈，通过插件系统扩展 |
| 前端样式 | SCSS + CSS Variables | 复用 Perfetto `--pf-color-*` 变量体系 |
| 前端构建 | Rollup (Perfetto 原有) | 随 Perfetto 构建流程 |
| 后端框架 | Node.js + Fastify + TypeScript | 高性能、TypeScript 原生支持 |
| 通信协议 | WebSocket (流式) + REST API (配置) | 双向实时通信 |
| 数据验证 | Zod | 前后端共享 schema 定义 |
| LLM 集成 | 多 Provider 抽象 | 支持 OpenAI/Anthropic/Google 等 |

### 1.4 与PRD的映射关系

| PRD 模块 | 实现模块 | 主要文件 |
|----------|----------|----------|
| F1 新侧边栏框架 | `sidebar/` | `sidebar_container.ts`, `top_bar.ts` |
| F2 搜索与Pin | `sidebar/` | `search_pin.ts` |
| F3 标记与跳转 | `sidebar/` | `markers_jump.ts` |
| F4 Agent对话 | `sidebar/` + `agent/` | `ai_chat.ts`, `agent_loop.ts` |
| F5 设置入口 | `sidebar/` | `settings.ts` |
| Agent核心引擎 | `agent/` | `agent_loop.ts`, `context_manager.ts` 等 |
| Tool系统 | `tools/` | 10个Tool定义文件 |
| Skill系统 | 后端 `src/services/` | `skill_processor.ts`, `skill_registry.ts` |
| 后端服务 | `server/src/` | 完整后端服务实现 |

---

## 第2章：前端插件详细设计

### 2.1 插件注册和生命周期

OpenPerfetto 作为 Perfetto 插件实现，遵循 Perfetto 插件系统的标准接口：

```typescript
// ui/src/plugins/org.openperfetto/index.ts

import {PerfettoPlugin, PerfettoPluginStatic} from '../../public/plugin';
import {App} from '../../public/app';
import {Trace} from '../../public/trace';
import {RouteArgs} from '../../public/route_schema';

export default class OpenPerfettoPlugin implements PerfettoPlugin {
  static readonly id = 'org.openperfetto';
  static readonly description = `
    OpenPerfetto - AI-enhanced Android performance trace analyzer.
    Integrates intelligent Agent for automated trace analysis.
  `;

  // 可选依赖其他插件
  static readonly dependencies: ReadonlyArray<PerfettoPluginStatic<PerfettoPlugin>> = [];

  /**
   * 应用级别激活钩子 - 在应用启动时调用（trace加载前）
   * 用于注册全局命令、设置、侧边栏菜单项等
   */
  static onActivate(app: App, args: RouteArgs): void {
    // 注册设置项
    OpenPerfettoPlugin.registerSettings(app);
    
    // 注册全局命令
    OpenPerfettoPlugin.registerCommands(app);
    
    // 初始化 WebSocket 连接
    OpenPerfettoPlugin.initializeConnection(app);
  }

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  /**
   * Trace级别加载钩子 - 在trace加载完成后调用
   * 用于初始化trace相关的功能
   */
  async onTraceLoad(ctx: Trace, args?: {[key: string]: unknown}): Promise<void> {
    // 初始化 Agent 核心引擎
    await this.initializeAgentEngine(ctx);
    
    // 注册侧边栏 UI
    this.registerSidebarUI(ctx);
    
    // 注册 AI 标记和 Pin 管理
    this.registerAIMarkerManager(ctx);
    
    // 初始化场景分类器
    await this.initializeSceneClassifier(ctx);
  }

  private static registerSettings(app: App): void {
    // 实现见 2.2 节
  }

  private static registerCommands(app: App): void {
    // 实现见 2.2 节
  }

  private static initializeConnection(app: App): void {
    // 实现见 services/websocket_client.ts
  }

  private async initializeAgentEngine(ctx: Trace): Promise<void> {
    // 实现见 agent/agent_loop.ts
  }

  private registerSidebarUI(ctx: Trace): void {
    // 实现见 2.3 节
  }

  private registerAIMarkerManager(ctx: Trace): void {
    // 实现见 2.4 节
  }

  private async initializeSceneClassifier(ctx: Trace): Promise<void> {
    // 实现见 agent/scene_classifier.ts
  }
}
```

### 2.2 核心接口定义

#### 2.2.1 插件状态接口与Store管理

```typescript
// types/plugin_state.ts

import {Migrate} from '../../../base/store';

/**
 * OpenPerfetto 插件的全局状态
 * 
 * 状态管理规范：
 * - 使用 trace.mountStore() 挂载状态，而非通过 props 传递
 * - 所有组件通过 Store 读写状态
 * - 使用 migration 函数处理状态版本升级
 * - 使用 trace.trash 注册资源清理回调
 */
export interface OpenPerfettoState {
  /** 状态版本，用于 migration */
  version: number;
  
  /** 是否已初始化 */
  initialized: boolean;
  
  /** 当前连接状态 */
  connectionState: ConnectionState;
  
  /** 当前分析会话 */
  currentSession: AnalysisSession | null;
  
  /** 当前主题 */
  theme: 'light' | 'dark';
  
  /** 当前语言 */
  locale: 'zh' | 'en';
  
  /** 预置 Pin 场景列表 */
  presetPinScenes: PresetPinScene[];
  
  /** 搜索历史（最近20条） */
  searchHistory: string[];
  
  /** AI标记列表 */
  markers: AIMarker[];
}

/** 当前状态版本 */
export const CURRENT_STATE_VERSION = 2;

/**
 * 创建默认状态
 * 替代 localStorage 初始化，确保状态结构一致性
 */
export function createDefaultState(): OpenPerfettoState {
  return {
    version: CURRENT_STATE_VERSION,
    initialized: false,
    connectionState: { status: 'disconnected' },
    currentSession: null,
    theme: 'light',
    locale: 'zh',
    presetPinScenes: [],
    searchHistory: [],
    markers: [],
  };
}

/**
 * 状态 Migration 函数
 * 处理状态版本升级，确保向后兼容
 * 
 * @param oldState 旧状态（可能是任意版本或undefined）
 * @returns 升级后的状态
 * 
 * 使用方式：
 * ```typescript
 * const store = trace.mountStore<OpenPerfettoState>(
 *   'openperfetto_state',
 *   migrateState
 * );
 * ```
 */
export const migrateState: Migrate<OpenPerfettoState> = (oldState: unknown): OpenPerfettoState => {
  // 如果没有旧状态，返回默认状态
  if (!oldState || typeof oldState !== 'object') {
    return createDefaultState();
  }
  
  const state = oldState as Partial<OpenPerfettoState>;
  const version = state.version ?? 0;
  
  // 版本 0 -> 1: 添加 searchHistory
  if (version < 1) {
    state.searchHistory = state.searchHistory ?? [];
    state.version = 1;
  }
  
  // 版本 1 -> 2: 添加 markers, 移除 sidebarExpanded (改为Page模式)
  if (version < 2) {
    state.markers = state.markers ?? [];
    state.version = 2;
    // 清理废弃字段
    delete (state as Record<string, unknown>).sidebarExpanded;
  }
  
  // 确保所有必需字段存在
  return {
    ...createDefaultState(),
    ...state,
    version: CURRENT_STATE_VERSION,
  };
};

export type ConnectionState = 
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; agentId: string }
  | { status: 'error'; message: string };

export interface AnalysisSession {
  id: string;
  startTime: number;
  sceneType: SceneType;
  messages: ChatMessage[];
  artifacts: Map<string, Artifact>;
  plan: AnalysisPlan | null;
  pinnedTracks: AIPinnedTrack[];
}

export type SceneType = 
  | 'scrolling'
  | 'startup_cold'
  | 'startup_warm'
  | 'startup_hot'
  | 'anr'
  | 'lock_contention'
  | 'binder_blocking'
  | 'io_analysis'
  | 'high_load'
  | 'screen_on_off'
  | 'unlock'
  | 'general';

export interface AIMarker {
  id: string;
  sliceId: number;
  timestamp: bigint;
  duration: bigint;
  name: string;
  note: string;
  severity: 'info' | 'warning' | 'error';
  createdAt: number;
}

export interface PresetPinScene {
  id: string;
  name: string;
  threads: PresetPinThread[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetPinThread {
  processPattern: string;
  threadPattern: string;
  order: number;
}
```

#### 2.2.2 消息和对话接口

```typescript
// types/agent.ts

/**
 * 对话消息类型
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  
  /** 如果是工具调用消息 */
  toolCall?: ToolCall;
  
  /** 如果是工具结果消息 */
  toolResult?: ToolResult;
  
  /** 渲染相关元数据 */
  metadata?: {
    /** 是否正在流式输出 */
    isStreaming?: boolean;
    /** 包含的可点击时间戳 */
    clickableTimestamps?: ClickableTimestamp[];
    /** 包含的可点击帧 ID */
    clickableFrameIds?: ClickableFrameId[];
  };
}

export interface ClickableTimestamp {
  text: string;
  tsNs: bigint;
  startIndex: number;
  endIndex: number;
}

export interface ClickableFrameId {
  text: string;
  frameId: number;
  startIndex: number;
  endIndex: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  artifactRef?: string;
}

/**
 * 分析计划（Planning Gate 输出）
 */
export interface AnalysisPlan {
  id: string;
  sceneType: SceneType;
  phases: AnalysisPhase[];
  successCriteria: string[];
  estimatedSteps: number;
  submittedAt: number;
}

export interface AnalysisPhase {
  id: string;
  name: string;
  description: string;
  requiredTools: string[];
  expectedOutputs: string[];
  completed: boolean;
}
```

#### 2.2.3 Artifact 接口

```typescript
// types/artifact.ts

/**
 * Artifact Store 中的数据项
 */
export interface Artifact {
  id: string;
  type: ArtifactType;
  createdAt: number;
  
  /** 原始完整数据（供 UI 渲染） */
  fullData: ArtifactData;
  
  /** 压缩摘要（供 LLM 使用） */
  summary: ArtifactSummary;
  
  /** 来源 Tool */
  sourceTool: string;
  
  /** 原始 SQL 查询（如适用） */
  sourceQuery?: string;
}

export type ArtifactType = 'table' | 'scalar' | 'chart' | 'trace_flow';

export interface ArtifactData {
  columns: ColumnDefinition[];
  rows: unknown[][];
  totalRowCount: number;
}

export interface ColumnDefinition {
  name: string;
  type: 'integer' | 'float' | 'string' | 'timestamp' | 'duration' | 'boolean';
  unit?: string;
}

/**
 * 数据摘要（压缩后发送给 LLM）
 */
export interface ArtifactSummary {
  /** 估算的 token 数量 */
  estimatedTokens: number;
  
  /** 行数统计 */
  rowCount: number;
  
  /** 数值列统计 */
  numericStats?: Record<string, NumericStats>;
  
  /** 字符串列统计 */
  stringStats?: Record<string, StringStats>;
  
  /** 样本行（最严重的 N 行） */
  sampleRows?: unknown[][];
  
  /** 自动识别的洞察 */
  insights?: string[];
}

export interface NumericStats {
  min: number;
  max: number;
  avg: number;
  /** 分位数采样：覆盖完整分布 */
  p0: number;     // 最小值（同 min）
  p25: number;    // 25分位
  p50: number;    // 中位数
  p75: number;    // 75分位
  p90: number;
  p95: number;    // 新增
  p99: number;
  p999: number;   // 新增：99.9分位，捕获极端长尾
}

export interface StringStats {
  topValues: Array<{ value: string; count: number }>;
  uniqueCount: number;
}
```

### 2.3 Page与侧边栏菜单注册

OpenPerfetto 遵循 Perfetto 插件规范，通过 **Page组件** 和 **侧边栏菜单项** 实现UI集成，而非自建侧边栏容器。

#### 2.3.1 Page注册与侧边栏入口

```typescript
// 在 onTraceLoad 中注册 Page 和侧边栏菜单项
// 参考 Perfetto MCP 插件实现 (ui/src/plugins/com.google.PerfettoMcp/index.ts)

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {OpenPerfettoPage} from './openperfetto_page';
import {OpenPerfettoState, createDefaultState, migrateState} from '../types/plugin_state';

/**
 * 在 onTraceLoad 中注册 OpenPerfetto Page
 * 
 * 设计说明：
 * - 使用 trace.pages.registerPage() 注册独立Page，而非嵌入原生侧边栏
 * - 使用 trace.sidebar.addMenuItem() 添加入口链接
 * - 使用 trace.mountStore() 管理插件状态（见2.3.2节）
 * - 使用 trace.trash 注册资源清理回调
 */
async onTraceLoad(ctx: Trace): Promise<void> {
  // 1. 挂载状态 Store（替代 props 传递状态）
  const store = ctx.mountStore<OpenPerfettoState>(
    'openperfetto_state',
    migrateState
  );
  
  // 初始化默认状态（如果是新会话）
  if (!store.state.initialized) {
    store.edit((draft) => {
      Object.assign(draft, createDefaultState());
      draft.initialized = true;
    });
  }

  // 2. 初始化 WebSocket 连接
  const wsClient = await this.initializeWebSocket(ctx, store);
  
  // 3. 初始化 Agent 引擎
  const agentLoop = new AgentLoop(ctx, store);
  
  // 4. 注册 OpenPerfetto Page
  ctx.pages.registerPage({
    route: '/openperfetto',
    render: () => {
      return m(OpenPerfettoPage, {
        trace: ctx,
        store,
        agentLoop,
      });
    },
  });
  
  // 5. 在侧边栏 "Current Trace" 区域添加菜单入口
  ctx.sidebar.addMenuItem({
    section: 'current_trace',  // 使用已有section: current_trace | trace_files | settings | support | convert_trace
    text: 'OpenPerfetto AI',
    href: '#!/openperfetto',   // 对应 registerPage 的 route
    icon: 'smart_toy',         // Material Icons 图标名
    sortOrder: 5,              // 排序优先级，数字越小越靠前
    tooltip: 'AI-powered trace analysis',
  });
  
  // 6. 注册资源清理（trace 卸载时执行）
  ctx.trash.use(() => {
    wsClient.disconnect();
    agentLoop.dispose();
  });
}

private async initializeWebSocket(
  ctx: Trace, 
  store: Store<OpenPerfettoState>
): Promise<WebSocketClient> {
  const wsClient = WebSocketClient.getInstance();
  
  // 连接状态变更时更新 Store
  wsClient.onStateChange((state) => {
    store.edit((draft) => {
      draft.connectionState = state;
    });
  });
  
  // 注册到 trash 确保断开连接
  ctx.trash.use(() => wsClient.disconnect());
  
  return wsClient;
}
```

#### 2.3.2 OpenPerfetto Page 组件

```typescript
// sidebar/openperfetto_page.ts

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {TopBar} from './top_bar';
import {SearchPin} from './search_pin';
import {MarkersJump} from './markers_jump';
import {AIChat} from './ai_chat';
import {Settings} from './settings';
import {OpenPerfettoState} from '../types/plugin_state';
import {AgentLoop} from '../agent/agent_loop';

export interface OpenPerfettoPageAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  agentLoop: AgentLoop;
}

/**
 * OpenPerfetto 主页面组件
 * 
 * 作为独立 Page 注册到 Perfetto，包含所有子模块：
 * ┌─────────────────────────────┐
 * │         TopBar              │  固定高度
 * ├─────────────────────────────┤
 * │     SearchPin Module        │  可折叠
 * ├─────────────────────────────┤
 * │     Markers Module          │  可折叠
 * ├─────────────────────────────┤
 * │     AI Chat Module          │  可折叠，flex-grow
 * ├─────────────────────────────┤
 * │     Settings Button         │  固定高度
 * └─────────────────────────────┘
 * 
 * 状态管理：
 * - 所有状态通过 Store 读写，而非 props 传递
 * - 子组件通过 store.state 读取状态
 * - 子组件通过 store.edit() 修改状态
 */
export class OpenPerfettoPage implements m.ClassComponent<OpenPerfettoPageAttrs> {
  /** 模块折叠状态（页面局部状态，不持久化） */
  private moduleCollapsed = {
    searchPin: false,
    markers: true,
    aiChat: false,
  };

  view({attrs}: m.CVnode<OpenPerfettoPageAttrs>): m.Children {
    const {trace, store, agentLoop} = attrs;
    const state = store.state;

    return m('.openperfetto-page', {
      class: state.theme === 'dark' ? 'openperfetto-page--dark' : '',
    }, [
      // 顶部栏
      m(TopBar, {
        store,
        onThemeToggle: () => store.edit((draft) => {
          draft.theme = draft.theme === 'light' ? 'dark' : 'light';
        }),
      }),
      
      // 可滚动内容区域
      m('.openperfetto-page__content', [
        // 搜索与 Pin 模块
        m(SearchPin, {
          trace,
          store,
          collapsed: this.moduleCollapsed.searchPin,
          onToggleCollapse: () => this.toggleModule('searchPin'),
        }),
        
        // 标记与跳转模块
        m(MarkersJump, {
          trace,
          store,
          collapsed: this.moduleCollapsed.markers,
          onToggleCollapse: () => this.toggleModule('markers'),
        }),
        
        // AI 对话模块（占据剩余空间）
        m(AIChat, {
          trace,
          store,
          agentLoop,
          collapsed: this.moduleCollapsed.aiChat,
          onToggleCollapse: () => this.toggleModule('aiChat'),
        }),
      ]),
      
      // 设置按钮
      m(Settings, { store }),
    ]);
  }

  private toggleModule(module: keyof typeof this.moduleCollapsed): void {
    this.moduleCollapsed[module] = !this.moduleCollapsed[module];
  }
}
```

#### 2.3.2 顶部栏模块

```typescript
// sidebar/top_bar.ts

import m from 'mithril';
import {OpenPerfettoState} from '../types/plugin_state';
import {Icon} from '../../../widgets/icon';
import {t} from '../i18n';

export interface TopBarAttrs {
  state: OpenPerfettoState;
  onCollapse: () => void;
  onThemeToggle: () => void;
}

export class TopBar implements m.ClassComponent<TopBarAttrs> {
  view({attrs}: m.CVnode<TopBarAttrs>): m.Children {
    const {state, onCollapse, onThemeToggle} = attrs;
    
    return m('.openperfetto-topbar', [
      // Logo 和项目名
      m('.openperfetto-topbar__brand', [
        m('img.openperfetto-topbar__logo', {
          src: 'assets/openperfetto-logo.svg',
          alt: 'OpenPerfetto',
        }),
        m('span.openperfetto-topbar__title', 'OpenPerfetto'),
      ]),
      
      // 操作按钮组
      m('.openperfetto-topbar__actions', [
        // 主题切换
        m('button.openperfetto-topbar__btn', {
          onclick: onThemeToggle,
          title: t(state.locale, 'topbar.toggleTheme'),
        }, [
          m(Icon, {icon: state.theme === 'light' ? 'dark_mode' : 'light_mode'}),
        ]),
        
        // 折叠按钮
        m('button.openperfetto-topbar__btn', {
          onclick: onCollapse,
          title: t(state.locale, 'topbar.collapse'),
        }, [
          m(Icon, {icon: 'chevron_left'}),
        ]),
      ]),
    ]);
  }
}
```

#### 2.3.3 搜索与Pin模块

```typescript
// sidebar/search_pin.ts

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Icon} from '../../../widgets/icon';
import {TextInput} from '../../../widgets/text_input';
import {t} from '../i18n';
import {TrackNode} from '../../../public/workspace';

export interface SearchPinAttrs {
  trace: Trace;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface SearchPinState {
  searchQuery: string;
  searchHistory: string[];
  searchResults: SearchResult[];
  isSearching: boolean;
  presetScenes: PresetScene[];
  showPresetEditor: boolean;
}

interface SearchResult {
  processName: string;
  threadName: string;
  upid: number;
  utid: number;
  trackUri?: string;
}

interface PresetScene {
  id: string;
  name: string;
  threads: Array<{processPattern: string; threadPattern: string; order: number}>;
}

export class SearchPin implements m.ClassComponent<SearchPinAttrs> {
  private state: SearchPinState = {
    searchQuery: '',
    searchHistory: [],
    searchResults: [],
    isSearching: false,
    presetScenes: [],
    showPresetEditor: false,
  };

  oninit(): void {
    // 从 localStorage 加载搜索历史和预置场景
    this.loadFromStorage();
  }

  view({attrs}: m.CVnode<SearchPinAttrs>): m.Children {
    const {trace, collapsed, onToggleCollapse} = attrs;
    const locale = 'zh'; // TODO: 从全局状态获取

    return m('.openperfetto-module.openperfetto-search-pin', {
      class: collapsed ? 'openperfetto-module--collapsed' : '',
    }, [
      // 模块标题栏
      m('.openperfetto-module__header', {
        onclick: onToggleCollapse,
      }, [
        m(Icon, {icon: collapsed ? 'expand_more' : 'expand_less'}),
        m('span', t(locale, 'searchPin.title')),
      ]),
      
      // 模块内容
      !collapsed && m('.openperfetto-module__content', [
        // 搜索输入框
        this.renderSearchInput(trace, locale),
        
        // 搜索历史
        this.state.searchHistory.length > 0 && 
          this.renderSearchHistory(trace, locale),
        
        // 搜索结果
        this.state.searchResults.length > 0 && 
          this.renderSearchResults(trace, locale),
        
        // 预置 Pin 场景
        this.renderPresetScenes(trace, locale),
      ]),
    ]);
  }

  private renderSearchInput(trace: Trace, locale: string): m.Children {
    return m('.openperfetto-search-pin__input-row', [
      m(TextInput, {
        value: this.state.searchQuery,
        placeholder: t(locale, 'searchPin.placeholder'), // "surf+vsync"
        oninput: (e: Event) => {
          this.state.searchQuery = (e.target as HTMLInputElement).value;
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this.executeSearch(trace);
          }
        },
      }),
      m('button.openperfetto-search-pin__search-btn', {
        onclick: () => this.executeSearch(trace),
        disabled: this.state.isSearching,
      }, [
        m(Icon, {icon: 'search'}),
      ]),
    ]);
  }

  private renderSearchHistory(trace: Trace, locale: string): m.Children {
    return m('.openperfetto-search-pin__history', [
      m('.openperfetto-search-pin__history-title', t(locale, 'searchPin.history')),
      m('.openperfetto-search-pin__history-chips', 
        this.state.searchHistory.slice(0, 5).map(query => 
          m('.openperfetto-search-pin__history-chip', {
            onclick: () => {
              this.state.searchQuery = query;
              this.executeSearch(trace);
            },
            title: query,
          }, this.truncateQuery(query))
        )
      ),
    ]);
  }

  private renderSearchResults(trace: Trace, locale: string): m.Children {
    return m('.openperfetto-search-pin__results', [
      m('.openperfetto-search-pin__results-title', 
        `${t(locale, 'searchPin.results')} (${this.state.searchResults.length})`
      ),
      m('.openperfetto-search-pin__results-list',
        this.state.searchResults.map(result => 
          m('.openperfetto-search-pin__result-item', [
            m('.openperfetto-search-pin__result-info', [
              m('span.openperfetto-search-pin__process', result.processName),
              m('span.openperfetto-search-pin__separator', ' / '),
              m('span.openperfetto-search-pin__thread', result.threadName),
            ]),
            m('.openperfetto-search-pin__result-actions', [
              // 跳转按钮
              m('button', {
                onclick: () => this.navigateToThread(trace, result),
                title: t(locale, 'searchPin.goTo'),
              }, m(Icon, {icon: 'arrow_forward'})),
              // Pin 按钮
              m('button', {
                onclick: () => this.pinThread(trace, result),
                title: t(locale, 'searchPin.pin'),
              }, m(Icon, {icon: 'push_pin'})),
            ]),
          ])
        )
      ),
    ]);
  }

  private renderPresetScenes(trace: Trace, locale: string): m.Children {
    return m('.openperfetto-search-pin__presets', [
      m('.openperfetto-search-pin__presets-header', [
        m('span', t(locale, 'searchPin.presets')),
        m('button', {
          onclick: () => this.state.showPresetEditor = true,
          title: t(locale, 'searchPin.managePresets'),
        }, m(Icon, {icon: 'settings'})),
      ]),
      m('.openperfetto-search-pin__presets-list',
        this.state.presetScenes.map(scene => 
          m('.openperfetto-search-pin__preset-item', {
            onclick: () => this.applyPresetScene(trace, scene),
          }, [
            m('span', scene.name),
            m('span.openperfetto-search-pin__preset-count', 
              `(${scene.threads.length})`
            ),
          ])
        )
      ),
    ]);
  }

  /**
   * 执行搜索
   * 支持 "process+thread" 格式，如 "surf+vsync"
   */
  private async executeSearch(trace: Trace): Promise<void> {
    const query = this.state.searchQuery.trim();
    if (!query) return;

    this.state.isSearching = true;
    this.state.searchResults = [];

    try {
      // 解析查询：支持 "process+thread" 格式
      const parts = query.split('+').map(p => p.trim());
      const processPattern = parts[0] || '%';
      const threadPattern = parts[1] || '%';

      // 执行 SQL 查询
      const sql = `
        SELECT 
          p.name AS process_name,
          t.name AS thread_name,
          p.upid,
          t.utid
        FROM thread t
        JOIN process p ON t.upid = p.upid
        WHERE p.name LIKE '%${processPattern}%'
          AND t.name LIKE '%${threadPattern}%'
        ORDER BY p.name, t.name
        LIMIT 50
      `;

      const result = await trace.engine.query(sql);
      const results: SearchResult[] = [];

      for (const it = result.iter({
        process_name: 'str',
        thread_name: 'str',
        upid: 'number',
        utid: 'number',
      }); it.valid(); it.next()) {
        results.push({
          processName: it.process_name ?? '',
          threadName: it.thread_name ?? '',
          upid: it.upid ?? 0,
          utid: it.utid ?? 0,
        });
      }

      this.state.searchResults = results;

      // 添加到搜索历史
      this.addToSearchHistory(query);

    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      this.state.isSearching = false;
      m.redraw();
    }
  }

  private pinThread(trace: Trace, result: SearchResult): void {
    // 查找对应的 track 并 pin
    const trackUri = `thread_${result.utid}`;
    const track = trace.currentWorkspace.getTrackByUri(trackUri);
    if (track) {
      track.pin();
    }
  }

  private navigateToThread(trace: Trace, result: SearchResult): void {
    // 查找对应的 track 并滚动到该位置
    const trackUri = `thread_${result.utid}`;
    const track = trace.currentWorkspace.getTrackByUri(trackUri);
    if (track) {
      track.reveal();
      trace.selection.selectTrack(trackUri, {scrollToSelection: true});
    }
  }

  private async applyPresetScene(trace: Trace, scene: PresetScene): Promise<void> {
    // 按顺序 pin 预置场景中的所有线程
    for (const thread of scene.threads.sort((a, b) => a.order - b.order)) {
      const sql = `
        SELECT t.utid
        FROM thread t
        JOIN process p ON t.upid = p.upid
        WHERE p.name LIKE '%${thread.processPattern}%'
          AND t.name LIKE '%${thread.threadPattern}%'
        LIMIT 1
      `;
      
      try {
        const result = await trace.engine.query(sql);
        for (const it = result.iter({utid: 'number'}); it.valid(); it.next()) {
          const trackUri = `thread_${it.utid}`;
          const track = trace.currentWorkspace.getTrackByUri(trackUri);
          if (track) {
            track.pin();
          }
        }
      } catch (error) {
        console.warn(`Failed to find thread: ${thread.processPattern}+${thread.threadPattern}`);
      }
    }
  }

  private addToSearchHistory(query: string): void {
    // 移除重复项
    this.state.searchHistory = this.state.searchHistory.filter(q => q !== query);
    // 添加到开头
    this.state.searchHistory.unshift(query);
    // 限制数量
    this.state.searchHistory = this.state.searchHistory.slice(0, 10);
    // 保存到 localStorage
    this.saveToStorage();
  }

  private truncateQuery(query: string, maxLength = 20): string {
    return query.length > maxLength ? query.slice(0, maxLength) + '...' : query;
  }

  private loadFromStorage(): void {
    try {
      const history = localStorage.getItem('openperfetto_search_history');
      if (history) {
        this.state.searchHistory = JSON.parse(history);
      }
      const presets = localStorage.getItem('openperfetto_preset_scenes');
      if (presets) {
        this.state.presetScenes = JSON.parse(presets);
      }
    } catch (e) {
      console.warn('Failed to load from localStorage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        'openperfetto_search_history', 
        JSON.stringify(this.state.searchHistory)
      );
      localStorage.setItem(
        'openperfetto_preset_scenes', 
        JSON.stringify(this.state.presetScenes)
      );
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }
  }
}
```

#### 2.3.4 标记与跳转模块

```typescript
// sidebar/markers_jump.ts

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Time, time} from '../../../base/time';
import {Icon} from '../../../widgets/icon';
import {OpenPerfettoState, AIMarker} from '../types/plugin_state';
import {t} from '../i18n';

export interface MarkersJumpAttrs {
  trace: Trace;
  state: OpenPerfettoState;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * 标记项接口
 */
export interface MarkerItem {
  id: string;
  index: number;
  timestamp: bigint;
  processName: string;
  threadName: string;
  sliceName?: string;
  note: string;
  isAI: boolean;
  color: string;
}

export class MarkersJump implements m.ClassComponent<MarkersJumpAttrs> {
  private markers: MarkerItem[] = [];
  private editingMarkerId: string | null = null;
  private editingNote: string = '';

  view({attrs}: m.CVnode<MarkersJumpAttrs>): m.Children {
    const {trace, state, collapsed, onToggleCollapse} = attrs;
    const locale = state.locale;

    // 同步 AI 标记
    this.syncAIMarkers(state);

    return m('.openperfetto-module.openperfetto-markers', {
      class: collapsed ? 'openperfetto-module--collapsed' : '',
    }, [
      // 模块标题栏
      m('.openperfetto-module__header', {
        onclick: onToggleCollapse,
      }, [
        m(Icon, {icon: collapsed ? 'expand_more' : 'expand_less'}),
        m('span', `${t(locale, 'markers.title')} (${this.markers.length})`),
      ]),
      
      // 模块内容
      !collapsed && m('.openperfetto-module__content', [
        // 使用说明
        m('.openperfetto-markers__hint', t(locale, 'markers.hint')),
        
        // 标记列表
        this.markers.length > 0 
          ? this.renderMarkerList(trace, locale)
          : m('.openperfetto-markers__empty', t(locale, 'markers.empty')),
      ]),
    ]);
  }

  private renderMarkerList(trace: Trace, locale: string): m.Children {
    return m('.openperfetto-markers__list', 
      this.markers.map(marker => 
        m('.openperfetto-markers__item', {
          key: marker.id,
          class: marker.isAI ? 'openperfetto-markers__item--ai' : '',
        }, [
          // 序号和 AI 标识
          m('.openperfetto-markers__index', [
            m('span.openperfetto-markers__number', {
              style: {backgroundColor: marker.color},
            }, marker.index),
            marker.isAI && m('.openperfetto-markers__ai-badge', [
              m(Icon, {icon: 'smart_toy'}),
            ]),
          ]),
          
          // 标记信息
          m('.openperfetto-markers__info', {
            onclick: () => this.navigateToMarker(trace, marker),
          }, [
            m('.openperfetto-markers__location', [
              m('span.openperfetto-markers__process', marker.processName),
              m('span', ' / '),
              m('span.openperfetto-markers__thread', marker.threadName),
            ]),
            marker.sliceName && m('.openperfetto-markers__slice', marker.sliceName),
            m('.openperfetto-markers__time', this.formatTimestamp(marker.timestamp)),
          ]),
          
          // 备注
          this.editingMarkerId === marker.id 
            ? this.renderNoteEditor(marker)
            : this.renderNote(marker, locale),
          
          // 操作按钮
          m('.openperfetto-markers__actions', [
            m('button', {
              onclick: () => this.startEditNote(marker),
              title: t(locale, 'markers.editNote'),
            }, m(Icon, {icon: 'edit'})),
            m('button', {
              onclick: () => this.removeMarker(trace, marker),
              title: t(locale, 'markers.remove'),
            }, m(Icon, {icon: 'close'})),
          ]),
        ])
      )
    );
  }

  private renderNote(marker: MarkerItem, locale: string): m.Children {
    return m('.openperfetto-markers__note', {
      onclick: () => this.startEditNote(marker),
    }, marker.note || t(locale, 'markers.addNote'));
  }

  private renderNoteEditor(marker: MarkerItem): m.Children {
    return m('input.openperfetto-markers__note-input', {
      value: this.editingNote,
      oninput: (e: Event) => {
        this.editingNote = (e.target as HTMLInputElement).value;
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.saveNote(marker);
        } else if (e.key === 'Escape') {
          this.cancelEditNote();
        }
      },
      onblur: () => this.saveNote(marker),
      oncreate: (vnode: m.VnodeDOM<unknown>) => {
        (vnode.dom as HTMLInputElement).focus();
      },
    });
  }

  private navigateToMarker(trace: Trace, marker: MarkerItem): void {
    const ts = Time.fromRaw(marker.timestamp);
    trace.timeline.panIntoView(ts, {align: 'center'});
    
    // 如果有关联的 note ID，选中该 note
    const note = trace.notes.getNote(marker.id);
    if (note) {
      trace.selection.selectTrackEvent(
        '', // trackUri - notes don't have a track
        0,  // eventId
        {scrollToSelection: true}
      );
    }
  }

  private startEditNote(marker: MarkerItem): void {
    this.editingMarkerId = marker.id;
    this.editingNote = marker.note;
  }

  private saveNote(marker: MarkerItem): void {
    marker.note = this.editingNote;
    this.editingMarkerId = null;
    this.editingNote = '';
    // TODO: 更新 Perfetto note
  }

  private cancelEditNote(): void {
    this.editingMarkerId = null;
    this.editingNote = '';
  }

  private removeMarker(trace: Trace, marker: MarkerItem): void {
    // 从列表中移除
    this.markers = this.markers.filter(m => m.id !== marker.id);
    // 重新编号
    this.markers.forEach((m, i) => m.index = i + 1);
    // TODO: 从 Perfetto notes 中移除
  }

  private syncAIMarkers(state: OpenPerfettoState): void {
    if (!state.currentSession) return;
    
    // 将 AI 创建的标记添加到列表中
    for (const aiMarker of state.currentSession.markers) {
      const exists = this.markers.find(m => m.id === aiMarker.id);
      if (!exists) {
        this.markers.push({
          id: aiMarker.id,
          index: this.markers.length + 1,
          timestamp: aiMarker.timestamp,
          processName: aiMarker.processName,
          threadName: aiMarker.threadName,
          sliceName: aiMarker.sliceName,
          note: aiMarker.note,
          isAI: true,
          color: aiMarker.color || '#4285f4',
        });
      }
    }
  }

  private formatTimestamp(ts: bigint): string {
    // 转换为毫秒显示
    const ms = Number(ts / 1_000_000n);
    return `${ms.toFixed(3)} ms`;
  }

  /**
   * 添加新标记（供外部调用，如键盘快捷键）
   */
  public addMarker(marker: Omit<MarkerItem, 'index'>): void {
    this.markers.push({
      ...marker,
      index: this.markers.length + 1,
    });
    m.redraw();
  }
}
```

#### 2.3.5 AI对话模块

```typescript
// sidebar/ai_chat.ts

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Icon} from '../../../widgets/icon';
import {TextInput} from '../../../widgets/text_input';
import {Button, ButtonVariant} from '../../../widgets/button';
import {Intent} from '../../../widgets/common';
import {Spinner} from '../../../widgets/spinner';
import {OpenPerfettoState, ChatMessage} from '../types/plugin_state';
import {t} from '../i18n';
import {AgentLoop} from '../agent/agent_loop';
import markdownit from 'markdown-it';

export interface AIChatAttrs {
  trace: Trace;
  state: OpenPerfettoState;
  onStateChange: (newState: Partial<OpenPerfettoState>) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface AIChatState {
  userInput: string;
  isProcessing: boolean;
}

export class AIChat implements m.ClassComponent<AIChatAttrs> {
  private localState: AIChatState = {
    userInput: '',
    isProcessing: false,
  };
  
  private agentLoop: AgentLoop | null = null;
  private md: markdownit;
  private conversationEl: HTMLElement | null = null;

  constructor() {
    this.md = markdownit({
      html: false,
      linkify: true,
      breaks: true,
    });
  }

  view({attrs}: m.CVnode<AIChatAttrs>): m.Children {
    const {trace, state, onStateChange, collapsed, onToggleCollapse} = attrs;
    const locale = state.locale;
    const session = state.currentSession;

    return m('.openperfetto-module.openperfetto-ai-chat', {
      class: [
        collapsed ? 'openperfetto-module--collapsed' : '',
        'openperfetto-ai-chat--flex-grow',
      ].filter(Boolean).join(' '),
    }, [
      // 模块标题栏
      m('.openperfetto-module__header', {
        onclick: onToggleCollapse,
      }, [
        m(Icon, {icon: collapsed ? 'expand_more' : 'expand_less'}),
        m('span', t(locale, 'aiChat.title')),
        // 连接状态指示器
        this.renderConnectionStatus(state.connectionState),
      ]),
      
      // 模块内容
      !collapsed && m('.openperfetto-module__content.openperfetto-ai-chat__content', [
        // 对话显示区域
        m('.openperfetto-ai-chat__conversation', {
          oncreate: (vnode: m.VnodeDOM) => {
            this.conversationEl = vnode.dom as HTMLElement;
          },
          onupdate: () => {
            // 自动滚动到底部
            if (this.conversationEl) {
              this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
            }
          },
        }, [
          // 欢迎消息
          !session?.messages.length && this.renderWelcomeMessage(locale),
          
          // 消息列表
          session?.messages.map(msg => this.renderMessage(msg, trace, locale)),
        ]),
        
        // 输入区域
        m('.openperfetto-ai-chat__input-area', [
          m(TextInput, {
            value: this.localState.userInput,
            placeholder: this.localState.isProcessing 
              ? t(locale, 'aiChat.waitingResponse')
              : t(locale, 'aiChat.inputPlaceholder'),
            disabled: this.localState.isProcessing || 
                      state.connectionState.status !== 'connected',
            oninput: (e: Event) => {
              this.localState.userInput = (e.target as HTMLTextAreaElement).value;
            },
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage(trace, state, onStateChange);
              }
            },
          }),
          
          m(Button, {
            icon: 'send',
            title: t(locale, 'aiChat.send'),
            onclick: () => this.sendMessage(trace, state, onStateChange),
            loading: this.localState.isProcessing,
            disabled: this.localState.isProcessing || 
                      state.connectionState.status !== 'connected' ||
                      !this.localState.userInput.trim(),
            variant: ButtonVariant.Filled,
            intent: Intent.Primary,
          }),
        ]),
      ]),
    ]);
  }

  private renderConnectionStatus(status: OpenPerfettoState['connectionState']): m.Children {
    const statusClass = {
      disconnected: 'openperfetto-ai-chat__status--disconnected',
      connecting: 'openperfetto-ai-chat__status--connecting',
      connected: 'openperfetto-ai-chat__status--connected',
      error: 'openperfetto-ai-chat__status--error',
    }[status.status];

    return m('.openperfetto-ai-chat__status', {
      class: statusClass,
      title: status.status === 'error' ? status.message : status.status,
    }, [
      status.status === 'connecting' && m(Spinner),
    ]);
  }

  private renderWelcomeMessage(locale: string): m.Children {
    return m('.openperfetto-ai-chat__welcome', [
      m('.openperfetto-ai-chat__welcome-icon', [
        m(Icon, {icon: 'smart_toy'}),
      ]),
      m('.openperfetto-ai-chat__welcome-text', [
        m('h3', t(locale, 'aiChat.welcomeTitle')),
        m('p', t(locale, 'aiChat.welcomeText')),
        m('ul', [
          m('li', t(locale, 'aiChat.welcomeHint1')),
          m('li', t(locale, 'aiChat.welcomeHint2')),
          m('li', t(locale, 'aiChat.welcomeHint3')),
        ]),
      ]),
    ]);
  }

  private renderMessage(msg: ChatMessage, trace: Trace, locale: string): m.Children {
    const roleLabel = {
      user: t(locale, 'aiChat.roleUser'),
      assistant: t(locale, 'aiChat.roleAssistant'),
      tool: t(locale, 'aiChat.roleTool'),
      system: t(locale, 'aiChat.roleSystem'),
    }[msg.role];

    return m('.openperfetto-ai-chat__message', {
      key: msg.id,
      class: `openperfetto-ai-chat__message--${msg.role}`,
    }, [
      m('.openperfetto-ai-chat__message-header', [
        m('span.openperfetto-ai-chat__message-role', roleLabel),
        m('span.openperfetto-ai-chat__message-time', 
          new Date(msg.timestamp).toLocaleTimeString()
        ),
      ]),
      m('.openperfetto-ai-chat__message-content', {
        onclick: (e: Event) => this.handleContentClick(e, msg, trace),
      }, [
        // 渲染 Markdown 内容
        m.trust(this.renderContent(msg)),
        
        // 如果正在流式输出，显示光标
        msg.metadata?.isStreaming && m('span.openperfetto-ai-chat__cursor'),
      ]),
      
      // 工具调用信息
      msg.toolCall && this.renderToolCall(msg.toolCall, locale),
      
      // 工具结果信息
      msg.toolResult && this.renderToolResult(msg.toolResult, locale),
    ]);
  }

  private renderContent(msg: ChatMessage): string {
    let content = msg.content;
    
    // 处理可点击的时间戳
    if (msg.metadata?.clickableTimestamps) {
      for (const ts of msg.metadata.clickableTimestamps) {
        const replacement = `<span class="openperfetto-ai-chat__clickable-ts" data-ts="${ts.tsNs}">${ts.text}</span>`;
        content = content.replace(ts.text, replacement);
      }
    }
    
    // 处理可点击的帧 ID
    if (msg.metadata?.clickableFrameIds) {
      for (const frame of msg.metadata.clickableFrameIds) {
        const replacement = `<span class="openperfetto-ai-chat__clickable-frame" data-frame-id="${frame.frameId}">${frame.text}</span>`;
        content = content.replace(frame.text, replacement);
      }
    }
    
    return this.md.render(content);
  }

  private handleContentClick(e: Event, msg: ChatMessage, trace: Trace): void {
    const target = e.target as HTMLElement;
    
    // 处理时间戳点击
    if (target.classList.contains('openperfetto-ai-chat__clickable-ts')) {
      const ts = BigInt(target.dataset.ts!);
      this.navigateToTimestamp(trace, ts);
    }
    
    // 处理帧 ID 点击
    if (target.classList.contains('openperfetto-ai-chat__clickable-frame')) {
      const frameId = parseInt(target.dataset.frameId!, 10);
      this.navigateToFrame(trace, frameId);
    }
  }

  private async navigateToTimestamp(trace: Trace, ts: bigint): Promise<void> {
    const time = {ts} as unknown as import('../../../base/time').time;
    trace.timeline.panIntoView(time, {align: 'center'});
  }

  private async navigateToFrame(trace: Trace, frameId: number): Promise<void> {
    // 查询帧的时间戳
    const sql = `
      SELECT ts FROM actual_frame_timeline_slice 
      WHERE id = ${frameId}
      LIMIT 1
    `;
    try {
      const result = await trace.engine.query(sql);
      for (const it = result.iter({ts: 'bigint'}); it.valid(); it.next()) {
        const time = {ts: it.ts} as unknown as import('../../../base/time').time;
        trace.timeline.panIntoView(time, {align: 'center'});
        break;
      }
    } catch (error) {
      console.error('Failed to navigate to frame:', error);
    }
  }

  private renderToolCall(toolCall: ChatMessage['toolCall'], locale: string): m.Children {
    if (!toolCall) return null;
    
    return m('.openperfetto-ai-chat__tool-call', [
      m('.openperfetto-ai-chat__tool-call-header', [
        m(Icon, {icon: 'build'}),
        m('span', `${t(locale, 'aiChat.toolCall')}: ${toolCall.name}`),
      ]),
      m('pre.openperfetto-ai-chat__tool-call-args', 
        JSON.stringify(toolCall.arguments, null, 2)
      ),
    ]);
  }

  private renderToolResult(toolResult: ChatMessage['toolResult'], locale: string): m.Children {
    if (!toolResult) return null;
    
    return m('.openperfetto-ai-chat__tool-result', {
      class: toolResult.success 
        ? 'openperfetto-ai-chat__tool-result--success' 
        : 'openperfetto-ai-chat__tool-result--error',
    }, [
      m('.openperfetto-ai-chat__tool-result-header', [
        m(Icon, {icon: toolResult.success ? 'check_circle' : 'error'}),
        m('span', toolResult.success 
          ? t(locale, 'aiChat.toolSuccess') 
          : t(locale, 'aiChat.toolError')
        ),
      ]),
      toolResult.error && m('pre.openperfetto-ai-chat__tool-result-error', 
        toolResult.error
      ),
      toolResult.artifactRef && m('.openperfetto-ai-chat__tool-result-artifact', [
        m(Icon, {icon: 'table_chart'}),
        m('span', `Artifact: ${toolResult.artifactRef}`),
      ]),
    ]);
  }

  private async sendMessage(
    trace: Trace, 
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void
  ): Promise<void> {
    const userInput = this.localState.userInput.trim();
    if (!userInput) return;

    this.localState.userInput = '';
    this.localState.isProcessing = true;

    try {
      // 确保有 Agent Loop 实例
      if (!this.agentLoop) {
        this.agentLoop = new AgentLoop(trace, state, onStateChange);
      }

      // 发送用户消息
      await this.agentLoop.sendMessage(userInput);

    } catch (error) {
      console.error('Failed to send message:', error);
      // 添加错误消息到对话
      const errorMessage: ChatMessage = {
        id: `error_${Date.now()}`,
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
      
      if (state.currentSession) {
        state.currentSession.messages.push(errorMessage);
        onStateChange({currentSession: state.currentSession});
      }
    } finally {
      this.localState.isProcessing = false;
      m.redraw();
    }
  }
}
```

#### 2.3.6 设置模块

```typescript
// sidebar/settings.ts

import m from 'mithril';
import {Icon} from '../../../widgets/icon';
import {OpenPerfettoState, PresetPinScene} from '../types/plugin_state';
import {t} from '../i18n';

export interface SettingsAttrs {
  state: OpenPerfettoState;
  onStateChange: (newState: Partial<OpenPerfettoState>) => void;
}

interface SettingsState {
  isOpen: boolean;
  activeTab: 'general' | 'presets' | 'about';
  editingPreset: PresetPinScene | null;
}

export class Settings implements m.ClassComponent<SettingsAttrs> {
  private localState: SettingsState = {
    isOpen: false,
    activeTab: 'general',
    editingPreset: null,
  };

  view({attrs}: m.CVnode<SettingsAttrs>): m.Children {
    const {state, onStateChange} = attrs;
    const locale = state.locale;

    return m('.openperfetto-settings', [
      // 设置按钮
      m('button.openperfetto-settings__btn', {
        onclick: () => this.localState.isOpen = !this.localState.isOpen,
        title: t(locale, 'settings.title'),
      }, [
        m(Icon, {icon: 'settings'}),
        m('span', t(locale, 'settings.title')),
      ]),
      
      // 设置面板（模态框）
      this.localState.isOpen && this.renderSettingsPanel(state, onStateChange, locale),
    ]);
  }

  private renderSettingsPanel(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    locale: string
  ): m.Children {
    return m('.openperfetto-settings__panel', [
      // 遮罩层
      m('.openperfetto-settings__overlay', {
        onclick: () => this.localState.isOpen = false,
      }),
      
      // 面板内容
      m('.openperfetto-settings__content', [
        // 标题栏
        m('.openperfetto-settings__header', [
          m('h2', t(locale, 'settings.title')),
          m('button', {
            onclick: () => this.localState.isOpen = false,
          }, m(Icon, {icon: 'close'})),
        ]),
        
        // 标签页
        m('.openperfetto-settings__tabs', [
          this.renderTab('general', t(locale, 'settings.tabGeneral')),
          this.renderTab('presets', t(locale, 'settings.tabPresets')),
          this.renderTab('about', t(locale, 'settings.tabAbout')),
        ]),
        
        // 标签页内容
        m('.openperfetto-settings__tab-content', [
          this.localState.activeTab === 'general' && 
            this.renderGeneralSettings(state, onStateChange, locale),
          this.localState.activeTab === 'presets' && 
            this.renderPresetsSettings(state, onStateChange, locale),
          this.localState.activeTab === 'about' && 
            this.renderAboutSettings(locale),
        ]),
      ]),
    ]);
  }

  private renderTab(id: SettingsState['activeTab'], label: string): m.Children {
    return m('button.openperfetto-settings__tab', {
      class: this.localState.activeTab === id ? 'openperfetto-settings__tab--active' : '',
      onclick: () => this.localState.activeTab = id,
    }, label);
  }

  private renderGeneralSettings(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    locale: string
  ): m.Children {
    return m('.openperfetto-settings__section', [
      // 主题设置
      m('.openperfetto-settings__item', [
        m('label', t(locale, 'settings.theme')),
        m('select', {
          value: state.theme,
          onchange: (e: Event) => {
            const value = (e.target as HTMLSelectElement).value as 'light' | 'dark';
            onStateChange({theme: value});
          },
        }, [
          m('option', {value: 'light'}, t(locale, 'settings.themeLight')),
          m('option', {value: 'dark'}, t(locale, 'settings.themeDark')),
        ]),
      ]),
      
      // 语言设置
      m('.openperfetto-settings__item', [
        m('label', t(locale, 'settings.language')),
        m('select', {
          value: state.locale,
          onchange: (e: Event) => {
            const value = (e.target as HTMLSelectElement).value as 'zh' | 'en';
            onStateChange({locale: value});
          },
        }, [
          m('option', {value: 'zh'}, '中文'),
          m('option', {value: 'en'}, 'English'),
        ]),
      ]),
    ]);
  }

  private renderPresetsSettings(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    locale: string
  ): m.Children {
    return m('.openperfetto-settings__section', [
      // 预置场景列表
      m('.openperfetto-settings__presets-list', [
        state.presetPinScenes.map(scene => 
          m('.openperfetto-settings__preset-item', {
            key: scene.id,
          }, [
            m('span', scene.name),
            m('.openperfetto-settings__preset-actions', [
              m('button', {
                onclick: () => this.editPreset(scene),
                title: t(locale, 'settings.editPreset'),
              }, m(Icon, {icon: 'edit'})),
              m('button', {
                onclick: () => this.deletePreset(state, onStateChange, scene.id),
                title: t(locale, 'settings.deletePreset'),
              }, m(Icon, {icon: 'delete'})),
            ]),
          ])
        ),
      ]),
      
      // 添加按钮
      m('button.openperfetto-settings__add-preset', {
        onclick: () => this.addNewPreset(state, onStateChange),
      }, [
        m(Icon, {icon: 'add'}),
        m('span', t(locale, 'settings.addPreset')),
      ]),
      
      // 编辑面板
      this.localState.editingPreset && 
        this.renderPresetEditor(state, onStateChange, locale),
    ]);
  }

  private renderPresetEditor(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    locale: string
  ): m.Children {
    const preset = this.localState.editingPreset!;
    
    return m('.openperfetto-settings__preset-editor', [
      m('h3', t(locale, 'settings.editPresetTitle')),
      
      // 场景名称
      m('.openperfetto-settings__item', [
        m('label', t(locale, 'settings.presetName')),
        m('input', {
          type: 'text',
          value: preset.name,
          oninput: (e: Event) => {
            preset.name = (e.target as HTMLInputElement).value;
          },
        }),
      ]),
      
      // 线程列表
      m('.openperfetto-settings__preset-threads', [
        m('label', t(locale, 'settings.presetThreads')),
        preset.threads.map((thread, index) => 
          m('.openperfetto-settings__preset-thread', {
            key: index,
          }, [
            m('input', {
              type: 'text',
              placeholder: 'Process pattern',
              value: thread.processPattern,
              oninput: (e: Event) => {
                thread.processPattern = (e.target as HTMLInputElement).value;
              },
            }),
            m('span', '+'),
            m('input', {
              type: 'text',
              placeholder: 'Thread pattern',
              value: thread.threadPattern,
              oninput: (e: Event) => {
                thread.threadPattern = (e.target as HTMLInputElement).value;
              },
            }),
            m('button', {
              onclick: () => {
                preset.threads.splice(index, 1);
              },
            }, m(Icon, {icon: 'remove'})),
          ])
        ),
        m('button', {
          onclick: () => {
            preset.threads.push({
              processPattern: '',
              threadPattern: '',
              order: preset.threads.length,
            });
          },
        }, [
          m(Icon, {icon: 'add'}),
          m('span', t(locale, 'settings.addThread')),
        ]),
      ]),
      
      // 操作按钮
      m('.openperfetto-settings__preset-actions', [
        m('button', {
          onclick: () => this.localState.editingPreset = null,
        }, t(locale, 'settings.cancel')),
        m('button.openperfetto-settings__save-btn', {
          onclick: () => this.savePreset(state, onStateChange),
        }, t(locale, 'settings.save')),
      ]),
    ]);
  }

  private renderAboutSettings(locale: string): m.Children {
    return m('.openperfetto-settings__section.openperfetto-settings__about', [
      m('h3', 'OpenPerfetto'),
      m('p', t(locale, 'settings.aboutDescription')),
      m('p', [
        m('strong', t(locale, 'settings.version')),
        ': 1.0.0',
      ]),
      m('p', [
        m('a', {
          href: 'https://github.com/example/openperfetto',
          target: '_blank',
        }, 'GitHub'),
      ]),
    ]);
  }

  private editPreset(scene: PresetPinScene): void {
    this.localState.editingPreset = {...scene, threads: [...scene.threads]};
  }

  private addNewPreset(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void
  ): void {
    const newPreset: PresetPinScene = {
      id: `preset_${Date.now()}`,
      name: 'New Preset',
      threads: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.localState.editingPreset = newPreset;
  }

  private savePreset(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void
  ): void {
    if (!this.localState.editingPreset) return;

    const preset = this.localState.editingPreset;
    preset.updatedAt = Date.now();

    const existingIndex = state.presetPinScenes.findIndex(p => p.id === preset.id);
    const newPresets = [...state.presetPinScenes];

    if (existingIndex >= 0) {
      newPresets[existingIndex] = preset;
    } else {
      newPresets.push(preset);
    }

    onStateChange({presetPinScenes: newPresets});
    this.localState.editingPreset = null;

    // 保存到 localStorage
    localStorage.setItem('openperfetto_preset_scenes', JSON.stringify(newPresets));
  }

  private deletePreset(
    state: OpenPerfettoState, 
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    presetId: string
  ): void {
    const newPresets = state.presetPinScenes.filter(p => p.id !== presetId);
    onStateChange({presetPinScenes: newPresets});
    localStorage.setItem('openperfetto_preset_scenes', JSON.stringify(newPresets));
  }
}
```

### 2.4 Mithril.js 组件实现规范

#### 2.4.1 组件生命周期使用规范

```typescript
/**
 * Mithril.js 组件实现规范
 * 
 * 所有 OpenPerfetto 组件应遵循以下规范：
 */

// 1. 类组件结构
class ExampleComponent implements m.ClassComponent<ExampleAttrs> {
  // 私有状态
  private localState: ExampleState = {/* ... */};
  
  // 可选：初始化钩子
  oninit(vnode: m.Vnode<ExampleAttrs>): void {
    // 初始化逻辑，如从 localStorage 加载数据
  }
  
  // 必须：渲染函数
  view(vnode: m.CVnode<ExampleAttrs>): m.Children {
    // 返回虚拟 DOM
  }
  
  // 可选：DOM 创建后
  oncreate(vnode: m.VnodeDOM<ExampleAttrs>): void {
    // 操作真实 DOM，如添加事件监听
  }
  
  // 可选：DOM 更新后
  onupdate(vnode: m.VnodeDOM<ExampleAttrs>): void {
    // 响应 DOM 更新
  }
  
  // 可选：组件销毁前
  onremove(vnode: m.VnodeDOM<ExampleAttrs>): void {
    // 清理资源，如移除事件监听
  }
}

// 2. 属性接口命名：以 Attrs 结尾
interface ExampleAttrs {
  trace: Trace;
  state: OpenPerfettoState;
  onStateChange: (newState: Partial<OpenPerfettoState>) => void;
}

// 3. 状态更新触发重绘
private async handleAsyncAction(): Promise<void> {
  try {
    // 异步操作
    await someAsyncTask();
  } finally {
    // 确保 UI 更新
    m.redraw();
  }
}

// 4. 事件处理使用箭头函数或绑定
view(): m.Children {
  return m('button', {
    // 推荐：直接内联
    onclick: () => this.handleClick(),
    // 或者：使用绑定（需在 constructor 中）
    onclick: this.handleClick.bind(this),
  });
}
```

#### 2.4.2 样式规范

```scss
// styles/openperfetto.scss

// 使用 Perfetto CSS 变量
.openperfetto-sidebar {
  background-color: var(--pf-color-surface);
  color: var(--pf-color-on-surface);
  border-right: 1px solid var(--pf-color-outline);
  
  // 暗色模式覆写
  &--dark {
    --pf-openperfetto-accent: #60a5fa;
    --pf-openperfetto-surface-elevated: #1e1e1e;
  }
}

// OpenPerfetto 专用变量
:root {
  --pf-openperfetto-accent: #3b82f6;
  --pf-openperfetto-accent-hover: #2563eb;
  --pf-openperfetto-surface-elevated: #ffffff;
  --pf-openperfetto-ai-badge-bg: #e0f2fe;
  --pf-openperfetto-ai-badge-color: #0284c7;
}

// 模块通用样式
.openperfetto-module {
  border-bottom: 1px solid var(--pf-color-outline);
  
  &__header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    
    &:hover {
      background-color: color-hover-surface();
    }
  }
  
  &__content {
    padding: 8px 12px;
  }
  
  &--collapsed {
    .openperfetto-module__content {
      display: none;
    }
  }
}
```

---

## 第3章：Agent核心引擎详细设计

### 3.1 AgentLoop（Ralph Loop）状态机

```typescript
// agent/agent_loop.ts

import {Trace} from '../../../public/trace';
import {OpenPerfettoState, ChatMessage, AnalysisPlan, SceneType} from '../types/plugin_state';
import {ContextManager} from './context_manager';
import {PlanningGate} from './planning_gate';
import {SceneClassifier} from './scene_classifier';
import {ArtifactStore} from './artifact_store';
import {Verifier} from './verifier';
import {ToolRegistry} from '../tools/tool_registry';
import {WebSocketClient} from '../services/websocket_client';
import {LLMStreamHandler} from '../services/llm_stream_handler';

/**
 * Agent Loop 状态枚举
 */
export enum AgentLoopState {
  /** 空闲状态，等待用户输入 */
  IDLE = 'IDLE',
  
  /** 场景分类中 */
  CLASSIFYING = 'CLASSIFYING',
  
  /** 构建上下文中 */
  BUILDING_CONTEXT = 'BUILDING_CONTEXT',
  
  /** 等待分析计划 */
  AWAITING_PLAN = 'AWAITING_PLAN',
  
  /** 执行分析计划中 */
  EXECUTING_PLAN = 'EXECUTING_PLAN',
  
  /** 等待 LLM 响应 */
  AWAITING_LLM = 'AWAITING_LLM',
  
  /** 执行工具调用 */
  EXECUTING_TOOL = 'EXECUTING_TOOL',
  
  /** 验证结果中 */
  VERIFYING = 'VERIFYING',
  
  /** 完成 */
  COMPLETE = 'COMPLETE',
  
  /** 错误状态 */
  ERROR = 'ERROR',
}

/**
 * Agent Loop 状态转换事件
 */
export type AgentLoopEvent =
  | { type: 'USER_MESSAGE'; message: string }
  | { type: 'SCENE_CLASSIFIED'; sceneType: SceneType }
  | { type: 'CONTEXT_BUILT' }
  | { type: 'PLAN_SUBMITTED'; plan: AnalysisPlan }
  | { type: 'LLM_TEXT_DELTA'; text: string }
  | { type: 'LLM_TOOL_USE'; toolCall: ToolCall }
  | { type: 'TOOL_RESULT'; result: ToolResult }
  | { type: 'LLM_DONE' }
  | { type: 'VERIFICATION_PASSED' }
  | { type: 'VERIFICATION_FAILED'; issues: string[] }
  | { type: 'ERROR'; error: Error };

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  artifactRef?: string;
}

/**
 * Agent 进度信息（M5 修复）
 * 
 * 用于在长时间操作期间反馈进度，避免 UI 阻塞感
 */
export interface AgentProgress {
  /** 当前阶段 */
  stage: 'classifying' | 'building_context' | 'awaiting_plan' | 
         'awaiting_llm' | 'executing_tool' | 'verifying' | 'complete';
  /** 阶段内进度 (0-100) */
  percent: number;
  /** 当前操作描述 */
  message: string;
  /** 当前执行的工具名称（如适用） */
  currentTool?: string;
  /** 已完成的工具调用数 */
  completedToolCalls: number;
  /** 最大工具调用数 */
  maxToolCalls: number;
}

/**
 * UI 线程调度器
 * 
 * M5 修复：在 SQL 查询之间让出 UI 线程
 * 避免长时间阻塞导致界面无响应
 */
const scheduler = {
  /**
   * 让出 UI 线程
   * 使用 requestAnimationFrame 或 setTimeout 让浏览器有机会处理 UI 事件
   */
  yield: (): Promise<void> => {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  },
};

/**
 * Agent Loop 核心实现
 * 
 * 状态机流程：
 * 
 *   ┌──────────┐
 *   │   IDLE   │ <─────────────────────────────────────────┐
 *   └────┬─────┘                                           │
 *        │ USER_MESSAGE                                    │
 *        ▼                                                 │
 *   ┌────────────────┐                                     │
 *   │  CLASSIFYING   │ ── 场景分类                          │
 *   └────────┬───────┘                                     │
 *            │ SCENE_CLASSIFIED                            │
 *            ▼                                             │
 *   ┌────────────────────┐                                 │
 *   │  BUILDING_CONTEXT  │ ── 构建系统提示                   │
 *   └────────┬───────────┘                                 │
 *            │ CONTEXT_BUILT                               │
 *            ▼                                             │
 *   ┌─────────────────┐                                    │
 *   │  AWAITING_PLAN  │ ── Planning Gate                   │
 *   └────────┬────────┘                                    │
 *            │ PLAN_SUBMITTED                              │
 *            ▼                                             │
 *   ┌─────────────────┐    LLM_TOOL_USE   ┌──────────────────┐
 *   │  AWAITING_LLM   │ ───────────────► │  EXECUTING_TOOL  │
 *   └────────┬────────┘                   └────────┬─────────┘
 *            │                                     │
 *            │ LLM_DONE                            │ TOOL_RESULT
 *            │                    ┌────────────────┘
 *            ▼                    ▼
 *   ┌─────────────────┐    ┌──────────────────┐
 *   │   VERIFYING     │ ◄──│  AWAITING_LLM    │ (循环)
 *   └────────┬────────┘    └──────────────────┘
 *            │
 *            │ VERIFICATION_PASSED
 *            ▼
 *   ┌─────────────────┐
 *   │    COMPLETE     │ ──────────────────────────────────►│
 *   └─────────────────┘
 */
export class AgentLoop {
  private state: AgentLoopState = AgentLoopState.IDLE;
  private trace: Trace;
  private pluginState: OpenPerfettoState;
  private onStateChange: (s: Partial<OpenPerfettoState>) => void;
  
  // 核心组件
  private contextManager: ContextManager;
  private planningGate: PlanningGate;
  private sceneClassifier: SceneClassifier;
  private artifactStore: ArtifactStore;
  private verifier: Verifier;
  private toolRegistry: ToolRegistry;
  private wsClient: WebSocketClient;
  private streamHandler: LLMStreamHandler;
  
  // 当前会话状态
  private currentSceneType: SceneType = 'general';
  private currentPlan: AnalysisPlan | null = null;
  private toolCallCount = 0;
  private pendingToolCalls: Map<string, ToolCall> = new Map();
  
  // 流式响应防抖缓冲（M4 修复）
  private streamBuffer: string = '';
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly STREAM_DEBOUNCE_MS = 100;  // 100ms 防抖间隔
  
  // 进度回调（M5 修复）
  private onProgress?: (progress: AgentProgress) => void;
  
  // 配置
  private static readonly MAX_TOOL_CALLS = 20;
  private static readonly TOOL_TIMEOUT_MS = 30000;

  constructor(
    trace: Trace,
    pluginState: OpenPerfettoState,
    onStateChange: (s: Partial<OpenPerfettoState>) => void,
    options?: { onProgress?: (progress: AgentProgress) => void }
  ) {
    this.trace = trace;
    this.pluginState = pluginState;
    this.onStateChange = onStateChange;
    this.onProgress = options?.onProgress;
    
    // 初始化组件
    this.contextManager = new ContextManager(trace);
    this.planningGate = new PlanningGate();
    this.sceneClassifier = new SceneClassifier();
    this.artifactStore = new ArtifactStore();
    this.verifier = new Verifier();
    this.toolRegistry = new ToolRegistry(trace, this.artifactStore);
    this.wsClient = WebSocketClient.getInstance();
    this.streamHandler = new LLMStreamHandler();
    
    // 设置流式处理回调
    this.setupStreamHandlers();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    this.flushStreamBuffer();  // 确保最后的内容被刷新
  }

  /**
   * 更新进度状态（M5 修复）
   * 通过回调通知 UI 当前进度，用于显示进度条
   */
  private updateProgress(
    stage: AgentProgress['stage'], 
    percent: number, 
    message: string,
    currentTool?: string
  ): void {
    if (this.onProgress) {
      this.onProgress({
        stage,
        percent,
        message,
        currentTool,
        completedToolCalls: this.toolCallCount,
        maxToolCalls: AgentLoop.MAX_TOOL_CALLS,
      });
    }
  }

  /**
   * 发送用户消息，启动分析流程
   */
  async sendMessage(message: string): Promise<void> {
    if (this.state !== AgentLoopState.IDLE) {
      throw new Error(`Cannot send message in state: ${this.state}`);
    }
    
    // 添加用户消息
    this.addMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });
    
    // 触发状态转换
    await this.transition({ type: 'USER_MESSAGE', message });
  }

  /**
   * 状态转换处理
   */
  private async transition(event: AgentLoopEvent): Promise<void> {
    const prevState = this.state;
    
    try {
      switch (this.state) {
        case AgentLoopState.IDLE:
          await this.handleIdleState(event);
          break;
          
        case AgentLoopState.CLASSIFYING:
          await this.handleClassifyingState(event);
          break;
          
        case AgentLoopState.BUILDING_CONTEXT:
          await this.handleBuildingContextState(event);
          break;
          
        case AgentLoopState.AWAITING_PLAN:
          await this.handleAwaitingPlanState(event);
          break;
          
        case AgentLoopState.AWAITING_LLM:
          await this.handleAwaitingLLMState(event);
          break;
          
        case AgentLoopState.EXECUTING_TOOL:
          await this.handleExecutingToolState(event);
          break;
          
        case AgentLoopState.VERIFYING:
          await this.handleVerifyingState(event);
          break;
          
        case AgentLoopState.COMPLETE:
        case AgentLoopState.ERROR:
          // 终态，不处理事件
          break;
      }
    } catch (error) {
      console.error(`State transition error: ${prevState} -> ${this.state}`, error);
      this.state = AgentLoopState.ERROR;
      this.addMessage({
        id: `error_${Date.now()}`,
        role: 'system',
        content: `Analysis error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      });
    }
  }

  private async handleIdleState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'USER_MESSAGE') return;
    
    this.state = AgentLoopState.CLASSIFYING;
    this.updateProgress('classifying', 0, 'Classifying scene type...');
    
    // 执行场景分类
    const sceneType = await this.sceneClassifier.classify(
      event.message,
      this.trace
    );
    
    await this.transition({ type: 'SCENE_CLASSIFIED', sceneType });
  }

  private async handleClassifyingState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'SCENE_CLASSIFIED') return;
    
    this.currentSceneType = event.sceneType;
    this.state = AgentLoopState.BUILDING_CONTEXT;
    this.updateProgress('building_context', 0, `Building context for ${event.sceneType}...`);
    
    // M5 修复：在构建上下文期间让出 UI 线程
    await scheduler.yield();
    
    // 构建上下文
    await this.contextManager.buildContext(event.sceneType);
    
    // 构建完成后再次让出 UI 线程
    await scheduler.yield();
    
    this.updateProgress('building_context', 100, 'Context built');
    await this.transition({ type: 'CONTEXT_BUILT' });
  }

  private async handleBuildingContextState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'CONTEXT_BUILT') return;
    
    this.state = AgentLoopState.AWAITING_PLAN;
    this.updateProgress('awaiting_plan', 0, 'Waiting for analysis plan...');
    
    // 发送到 LLM，要求提交分析计划
    await this.sendToLLM({
      requirePlan: true,
      systemPrompt: this.contextManager.getSystemPrompt(),
      messages: this.getSessionMessages(),
      tools: this.toolRegistry.getToolDefinitions(),
    });
  }

  private async handleAwaitingPlanState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'PLAN_SUBMITTED':
        this.currentPlan = event.plan;
        this.planningGate.validatePlan(event.plan);
        this.state = AgentLoopState.AWAITING_LLM;
        
        // 继续分析
        await this.sendToLLM({
          requirePlan: false,
          systemPrompt: this.contextManager.getSystemPrompt(),
          messages: this.getSessionMessages(),
          tools: this.toolRegistry.getToolDefinitions(),
        });
        break;
        
      case 'LLM_TOOL_USE':
        if (event.toolCall.name === 'submit_plan') {
          // Planning Gate 工具调用
          const result = await this.toolRegistry.execute(
            event.toolCall.name,
            event.toolCall.arguments
          );
          
          if (result.success && result.data) {
            await this.transition({
              type: 'PLAN_SUBMITTED',
              plan: result.data as AnalysisPlan,
            });
          }
        }
        break;
        
      case 'LLM_TEXT_DELTA':
        // 流式更新 UI（使用防抖缓冲）
        this.handleStreamChunk(event.text);
        break;
    }
  }

  private async handleAwaitingLLMState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'LLM_TEXT_DELTA':
        this.handleStreamChunk(event.text);
        break;
        
      case 'LLM_TOOL_USE':
        this.state = AgentLoopState.EXECUTING_TOOL;
        this.pendingToolCalls.set(event.toolCall.id, event.toolCall);
        
        // 执行工具
        await this.executeToolCall(event.toolCall);
        break;
        
      case 'LLM_DONE':
        // LLM 完成响应，进入验证阶段
        this.state = AgentLoopState.VERIFYING;
        await this.runVerification();
        break;
    }
  }

  private async handleExecutingToolState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'TOOL_RESULT') return;
    
    // 移除已完成的工具调用
    this.pendingToolCalls.delete(event.result.toolCallId);
    
    // 添加工具结果消息
    this.addMessage({
      id: `tool_result_${Date.now()}`,
      role: 'tool',
      content: event.result.success 
        ? `Tool executed successfully` 
        : `Tool error: ${event.result.error}`,
      timestamp: Date.now(),
      toolResult: event.result,
    });
    
    // 检查工具调用次数限制
    this.toolCallCount++;
    if (this.toolCallCount >= AgentLoop.MAX_TOOL_CALLS) {
      this.addMessage({
        id: `warning_${Date.now()}`,
        role: 'system',
        content: `Maximum tool calls (${AgentLoop.MAX_TOOL_CALLS}) reached.`,
        timestamp: Date.now(),
      });
    }
    
    // 如果没有待处理的工具调用，返回 AWAITING_LLM
    if (this.pendingToolCalls.size === 0) {
      this.state = AgentLoopState.AWAITING_LLM;
      
      // 发送 REASONING_NUDGE，促使 Agent 反思
      await this.sendToLLM({
        requirePlan: false,
        systemPrompt: this.contextManager.getSystemPrompt(),
        messages: this.getSessionMessages(),
        tools: this.toolRegistry.getToolDefinitions(),
        reasoningNudge: this.generateReasoningNudge(),
      });
    }
  }

  private async handleVerifyingState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'VERIFICATION_PASSED':
        this.state = AgentLoopState.COMPLETE;
        this.finalizeAnalysis();
        break;
        
      case 'VERIFICATION_FAILED':
        // 验证失败，添加提示并继续
        this.addMessage({
          id: `verification_${Date.now()}`,
          role: 'system',
          content: `Verification issues detected:\n${event.issues.join('\n')}`,
          timestamp: Date.now(),
        });
        
        // 返回 AWAITING_LLM 继续分析
        this.state = AgentLoopState.AWAITING_LLM;
        await this.sendToLLM({
          requirePlan: false,
          systemPrompt: this.contextManager.getSystemPrompt(),
          messages: this.getSessionMessages(),
          tools: this.toolRegistry.getToolDefinitions(),
        });
        break;
    }
  }

  /**
   * 执行工具调用
   */
  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    try {
      // 添加工具调用消息
      this.addMessage({
        id: `tool_call_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCall,
      });
      
      // 执行工具（带超时）
      const result = await Promise.race([
        this.toolRegistry.execute(toolCall.name, toolCall.arguments),
        new Promise<ToolResult>((_, reject) => 
          setTimeout(() => reject(new Error('Tool execution timeout')), 
            AgentLoop.TOOL_TIMEOUT_MS)
        ),
      ]);
      
      await this.transition({ type: 'TOOL_RESULT', result });
      
    } catch (error) {
      await this.transition({
        type: 'TOOL_RESULT',
        result: {
          toolCallId: toolCall.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * 发送消息到 LLM（通过 WebSocket）
   */
  private async sendToLLM(params: {
    requirePlan: boolean;
    systemPrompt: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    reasoningNudge?: string;
  }): Promise<void> {
    const { requirePlan, systemPrompt, messages, tools, reasoningNudge } = params;
    
    // 构建完整的消息列表
    const fullMessages = [...messages];
    if (reasoningNudge) {
      fullMessages.push({
        id: `nudge_${Date.now()}`,
        role: 'system',
        content: reasoningNudge,
        timestamp: Date.now(),
      });
    }
    
    // 通过 WebSocket 发送
    await this.wsClient.send({
      type: 'chat',
      agentId: this.pluginState.connectionState.status === 'connected' 
        ? this.pluginState.connectionState.agentId 
        : '',
      payload: {
        messages: fullMessages.map(m => ({
          role: m.role,
          content: m.content,
          toolCall: m.toolCall,
          toolResult: m.toolResult,
        })),
        tools,
        systemPrompt,
        stream: true,
        requirePlan,
      },
    });
  }

  /**
   * 运行验证
   */
  private async runVerification(): Promise<void> {
    const messages = this.getSessionMessages();
    const artifacts = this.artifactStore.getAll();
    
    // L1: 启发式验证
    const l1Issues = this.verifier.runL1Validation(messages, artifacts);
    
    // L2: 计划遵从验证
    const l2Issues = this.currentPlan 
      ? this.verifier.runL2Validation(this.currentPlan, messages)
      : [];
    
    const allIssues = [...l1Issues, ...l2Issues];
    
    if (allIssues.length > 0) {
      await this.transition({ type: 'VERIFICATION_FAILED', issues: allIssues });
    } else {
      await this.transition({ type: 'VERIFICATION_PASSED' });
    }
  }

  /**
   * 生成 REASONING_NUDGE
   */
  private generateReasoningNudge(): string {
    const lastToolResult = this.getLastToolResult();
    if (!lastToolResult) return '';
    
    return `
[REASONING_NUDGE]
Based on the tool result above:
1. What does this data tell us about the performance issue?
2. Does this align with or contradict previous findings?
3. What should be the next step in the analysis?
4. Are there any anomalies or unexpected patterns?
`;
  }

  /**
   * 最终化分析
   */
  private finalizeAnalysis(): void {
    // 记录分析完成的日志
    console.log('Analysis completed', {
      sceneType: this.currentSceneType,
      toolCallCount: this.toolCallCount,
      artifactCount: this.artifactStore.size(),
    });
    
    // 重置状态以准备下一次分析
    this.state = AgentLoopState.IDLE;
    this.toolCallCount = 0;
    this.currentPlan = null;
    this.pendingToolCalls.clear();
  }

  /**
   * 设置流式处理回调
   */
  private setupStreamHandlers(): void {
    this.streamHandler.on('text_delta', (text: string) => {
      this.transition({ type: 'LLM_TEXT_DELTA', text });
    });
    
    this.streamHandler.on('tool_use', (toolCall: ToolCall) => {
      this.transition({ type: 'LLM_TOOL_USE', toolCall });
    });
    
    this.streamHandler.on('done', () => {
      this.transition({ type: 'LLM_DONE' });
    });
    
    this.streamHandler.on('error', (error: Error) => {
      this.transition({ type: 'ERROR', error });
    });
  }

  // 辅助方法
  
  private addMessage(message: ChatMessage): void {
    if (this.pluginState.currentSession) {
      this.pluginState.currentSession.messages.push(message);
      this.onStateChange({ currentSession: this.pluginState.currentSession });
    }
  }

  /**
   * 流式响应处理（带防抖缓冲）
   * 
   * M4 修复：
   * - 累积文本到缓冲区，而非每次立即更新 UI
   * - 使用 100ms 防抖间隔批量刷新
   * - 每次 flush 触发 m.redraw() 进行增量重绘
   * - 避免高频 UI 更新导致的性能问题
   */
  private handleStreamChunk(text: string): void {
    // 累积到缓冲区
    this.streamBuffer += text;
    
    // 重置防抖定时器
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
    }
    
    // 设置新的防抖定时器
    this.streamFlushTimer = setTimeout(() => {
      this.flushStreamBuffer();
    }, AgentLoop.STREAM_DEBOUNCE_MS);
  }

  /**
   * 刷新流式缓冲区到 UI
   */
  private flushStreamBuffer(): void {
    if (this.streamBuffer.length === 0) return;
    
    const textToFlush = this.streamBuffer;
    this.streamBuffer = '';
    
    const session = this.pluginState.currentSession;
    if (!session) return;
    
    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content += textToFlush;
      lastMessage.metadata = { ...lastMessage.metadata, isStreaming: true };
    } else {
      this.addMessage({
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: textToFlush,
        timestamp: Date.now(),
        metadata: { isStreaming: true },
      });
    }
    
    // 更新状态并触发 UI 重绘
    this.onStateChange({ currentSession: session });
    
    // 触发 Mithril 重绘（如果在浏览器环境）
    if (typeof m !== 'undefined' && m.redraw) {
      m.redraw();
    }
  }

  /**
   * 标记流式响应完成
   */
  private finalizeStreamingMessage(): void {
    // 刷新剩余缓冲
    this.flushStreamBuffer();
    
    const session = this.pluginState.currentSession;
    if (!session) return;
    
    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.metadata = { ...lastMessage.metadata, isStreaming: false };
      this.onStateChange({ currentSession: session });
    }
  }

  private getSessionMessages(): ChatMessage[] {
    return this.pluginState.currentSession?.messages ?? [];
  }

  private getLastToolResult(): ToolResult | null {
    const messages = this.getSessionMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].toolResult) {
        return messages[i].toolResult!;
      }
    }
    return null;
  }
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
```

### 3.2 ContextManager 上下文管理

```typescript
// agent/context_manager.ts

import {Trace} from '../../../public/trace';
import {SceneType} from '../types/plugin_state';

/**
 * Token 预算配置（动态预算机制）
 * 
 * 设计理念：
 * - 现代 LLM 支持 128K-200K 上下文窗口，但仍需合理分配预算
 * - 基础预算 8192 tokens，复杂场景（ANR、冷启动）自动提升到 16384
 * - 按场景类型配置不同的预算分配比例
 * - 使用 tiktoken 或类似方案精确估算 token 数量
 */
interface TokenBudget {
  systemPrompt: number;      // 系统提示预算
  sceneStrategy: number;     // 场景策略预算
  traceMetadata: number;     // Trace 元数据预算
  history: number;           // 历史对话预算
  toolResults: number;       // 工具结果预算
  total: number;             // 总预算
}

/**
 * 场景预算配置
 * 不同场景类型有不同的预算分配策略
 */
interface SceneBudgetConfig {
  total: number;
  /** 各部分占比，总和应为 1.0 */
  allocation: {
    systemPrompt: number;
    sceneStrategy: number;
    traceMetadata: number;
    history: number;
    toolResults: number;
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
  private currentBudget: TokenBudget;
  
  /** 基础 Token 预算 */
  private static readonly BASE_BUDGET = 8192;
  
  /** 复杂场景 Token 预算 */
  private static readonly COMPLEX_BUDGET = 16384;
  
  /** 场景预算配置表 */
  private static readonly SCENE_BUDGETS: Record<SceneType, SceneBudgetConfig> = {
    // 复杂场景：ANR、冷启动需要更多上下文
    anr: {
      total: 16384,
      allocation: { systemPrompt: 0.10, sceneStrategy: 0.08, traceMetadata: 0.12, history: 0.40, toolResults: 0.30 },
    },
    startup_cold: {
      total: 16384,
      allocation: { systemPrompt: 0.10, sceneStrategy: 0.08, traceMetadata: 0.12, history: 0.40, toolResults: 0.30 },
    },
    binder_blocking: {
      total: 12288,
      allocation: { systemPrompt: 0.10, sceneStrategy: 0.08, traceMetadata: 0.12, history: 0.35, toolResults: 0.35 },
    },
    lock_contention: {
      total: 12288,
      allocation: { systemPrompt: 0.10, sceneStrategy: 0.08, traceMetadata: 0.12, history: 0.35, toolResults: 0.35 },
    },
    // 标准场景
    scrolling: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    startup_warm: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    startup_hot: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    io_analysis: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.35, toolResults: 0.35 },
    },
    high_load: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    screen_on_off: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    unlock: {
      total: 8192,
      allocation: { systemPrompt: 0.12, sceneStrategy: 0.08, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
    general: {
      total: 8192,
      allocation: { systemPrompt: 0.15, sceneStrategy: 0.05, traceMetadata: 0.10, history: 0.40, toolResults: 0.30 },
    },
  };

  constructor(trace: Trace) {
    this.trace = trace;
    this.currentBudget = this.calculateBudget('general');
  }

  /**
   * 根据场景计算 Token 预算
   */
  private calculateBudget(sceneType: SceneType): TokenBudget {
    const config = ContextManager.SCENE_BUDGETS[sceneType];
    const total = config.total;
    const alloc = config.allocation;
    
    return {
      systemPrompt: Math.floor(total * alloc.systemPrompt),
      sceneStrategy: Math.floor(total * alloc.sceneStrategy),
      traceMetadata: Math.floor(total * alloc.traceMetadata),
      history: Math.floor(total * alloc.history),
      toolResults: Math.floor(total * alloc.toolResults),
      total,
    };
  }

  /**
   * 获取当前预算配置
   */
  getBudget(): TokenBudget {
    return { ...this.currentBudget };
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
    parts.push(await this.getSceneStrategyPrompt(sceneType));
    
    // 3. Trace 元数据摘要
    parts.push(await this.getTraceMetadataPrompt());
    
    this.systemPrompt = parts.join('\n\n---\n\n');
  }

  /**
   * 估算文本的 Token 数量
   * 
   * 改进方案（生产环境建议）：
   * - 使用 tiktoken (OpenAI) 或 sentencepiece 精确计算
   * - 对于 Claude 可使用 Anthropic 的 token 计数 API
   * - 中文字符按 1.5-2 tokens 估算（比英文更多）
   * 
   * 当前实现：简化估算，后续可替换为精确实现
   */
  estimateTokens(text: string): number {
    // 简化估算规则：
    // - 英文单词约 1.3 tokens
    // - 中文字符约 1.5 tokens
    // - 标点符号约 1 token
    
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const punctuation = (text.match(/[^\w\s\u4e00-\u9fa5]/g) || []).length;
    
    return Math.ceil(
      chineseChars * 1.5 +
      englishWords * 1.3 +
      numbers * 0.5 +
      punctuation * 1
    );
  }

  /**
   * 获取构建好的系统提示
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * 核心角色提示（固定内容）
   */
  private getCoreRolePrompt(): string {
    return `# Role Definition

You are an expert Android performance analyst. Your task is to analyze Perfetto traces and identify performance issues.

## Methodology

1. **Scene Identification**: First identify the scenario type (startup, scrolling, ANR, etc.)
2. **Data Collection**: Use tools to gather relevant metrics and events
3. **Root Cause Analysis**: Follow the WHY chain (at least 2 levels deep)
4. **Evidence-Based Conclusions**: All findings must be backed by trace data

## Output Format

Your analysis should include:
- **Severity**: HIGH / MEDIUM / LOW
- **Finding**: Clear description of the issue
- **Evidence**: Specific data from the trace (timestamps, durations, counts)
- **Root Cause**: The underlying reason (with WHY chain)
- **Recommendation**: Actionable next steps

## Constraints

- Never fabricate data - all numbers must come from actual queries
- Express uncertainty when data is inconclusive
- Use timestamps from query results, not estimates
- Focus on actionable insights, not generic observations

## Planning Gate

Before starting analysis, you MUST submit an analysis plan using the submit_plan tool.
The plan should outline:
- Analysis phases
- Tools to be used in each phase
- Expected outputs
- Success criteria`;
  }

  /**
   * 场景策略提示
   */
  private async getSceneStrategyPrompt(sceneType: SceneType): Promise<string> {
    const strategies: Record<SceneType, string> = {
      scrolling: `# Scrolling Analysis Strategy

Focus Areas:
1. Frame timeline analysis (expected vs actual)
2. Jank detection and classification
3. Render thread blocking identification
4. SF (SurfaceFlinger) deadline misses

Key Metrics:
- Frame duration (target: 16.67ms for 60fps)
- Jank rate percentage
- Longest blocking call duration

Recommended Tools:
- invoke_skill(frame_jank_detection)
- trace_process_flow for blocking calls
- execute_sql for custom frame queries`,

      startup_cold: `# Cold Startup Analysis Strategy

Focus Areas:
1. Process creation to first frame
2. Application initialization phases
3. Content provider initialization
4. Main thread blocking during startup

Key Metrics:
- Total startup time (process fork to first frame)
- Time to Initial Display (TTID)
- Time to Full Display (TTFD)
- Blocking call breakdown

Recommended Tools:
- invoke_skill(cold_startup_analysis)
- trace_process_flow for startup sequence
- execute_sql for process lifecycle events`,

      startup_warm: `# Warm Startup Analysis Strategy

Focus Areas:
1. Activity resume time
2. View inflation and layout
3. Data loading and binding

Key Metrics:
- Resume to first frame time
- Layout pass duration
- Data loading latency`,

      startup_hot: `# Hot Startup Analysis Strategy

Focus Areas:
1. Activity bring-to-front time
2. Window animation
3. Focus acquisition

Key Metrics:
- Intent to visible time
- Animation duration`,

      anr: `# ANR Analysis Strategy

Focus Areas:
1. Main thread blocking source
2. Binder transaction delays
3. Lock contention
4. I/O blocking

Key Metrics:
- Blocked duration (>5s indicates ANR)
- Blocking call stack
- Contended resources

Critical: Identify the exact 5-second window before ANR`,

      lock_contention: `# Lock Contention Analysis Strategy

Focus Areas:
1. Monitor contention events
2. Mutex acquisition times
3. Thread blocking patterns

Key Metrics:
- Contention duration
- Affected threads
- Lock holder identification`,

      binder_blocking: `# Binder Blocking Analysis Strategy

Focus Areas:
1. Binder transaction timing
2. Server-side processing delay
3. Thread pool exhaustion

Key Metrics:
- Transaction round-trip time
- Server processing time
- Queue wait time`,

      io_analysis: `# I/O Analysis Strategy

Focus Areas:
1. File system operations
2. Database queries
3. Network I/O on main thread

Key Metrics:
- I/O duration per operation
- Main thread I/O percentage
- Blocking read/write calls`,

      high_load: `# High CPU Load Analysis Strategy

Focus Areas:
1. CPU utilization per core
2. Hot methods/functions
3. Scheduling frequency

Key Metrics:
- CPU usage percentage
- Context switch rate
- Runnable time vs running time`,

      screen_on_off: `# Screen On/Off Analysis Strategy

Focus Areas:
1. Display state transitions
2. Wake lock behavior
3. Power management events`,

      unlock: `# Device Unlock Analysis Strategy

Focus Areas:
1. Keyguard dismiss timing
2. Biometric authentication delay
3. Post-unlock activity launch`,

      general: `# General Analysis Strategy

For unclassified scenarios, follow this general approach:

1. Identify the main process of interest
2. Look for UI thread (main thread) blocking
3. Check for frame drops and jank
4. Analyze CPU and memory patterns
5. Look for I/O and Binder issues

Use execute_sql and lookup_sql_schema for exploration.`,
    };

    return strategies[sceneType] || strategies.general;
  }

  /**
   * Trace 元数据提示
   */
  private async getTraceMetadataPrompt(): Promise<string> {
    const info = this.trace.traceInfo;
    
    // 获取主要进程列表
    const processesResult = await this.trace.engine.query(`
      SELECT name, pid, upid 
      FROM process 
      WHERE name IS NOT NULL AND name != ''
      ORDER BY 
        CASE WHEN name LIKE 'com.%' THEN 0 ELSE 1 END,
        pid
      LIMIT 20
    `);
    
    const processes: string[] = [];
    for (const it = processesResult.iter({
      name: 'str',
      pid: 'number',
      upid: 'number',
    }); it.valid(); it.next()) {
      processes.push(`${it.name} (pid: ${it.pid})`);
    }
    
    // 获取时间范围
    const startMs = Number(info.start) / 1_000_000;
    const endMs = Number(info.end) / 1_000_000;
    const durationMs = endMs - startMs;
    
    return `# Trace Metadata

**Trace Title**: ${info.traceTitle || 'Untitled'}
**Duration**: ${(durationMs / 1000).toFixed(2)} seconds
**Time Range**: ${startMs.toFixed(0)}ms - ${endMs.toFixed(0)}ms

**Key Processes**:
${processes.map(p => `- ${p}`).join('\n')}

**Data Sources Available**:
- Scheduling data: YES
- Frame timeline: ${await this.hasFrameTimeline() ? 'YES' : 'NO'}
- Binder transactions: ${await this.hasBinderData() ? 'YES' : 'NO'}
- Memory counters: ${await this.hasMemoryCounters() ? 'YES' : 'NO'}`;
  }

  private async hasFrameTimeline(): Promise<boolean> {
    try {
      const result = await this.trace.engine.query(
        `SELECT COUNT(*) as cnt FROM actual_frame_timeline_slice LIMIT 1`
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
        `SELECT COUNT(*) as cnt FROM slice WHERE name LIKE 'binder%' LIMIT 1`
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
        `SELECT COUNT(*) as cnt FROM counter WHERE name LIKE 'mem.%' LIMIT 1`
      );
      for (const it = result.iter({cnt: 'number'}); it.valid(); it.next()) {
        return it.cnt > 0;
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * 估算文本的 token 数量（简化版，按字符计算）
   */
  estimateTokens(text: string): number {
    // 简化估算：约 4 字符 = 1 token
    return Math.ceil(text.length / 4);
  }
}
```

### 3.3 PlanningGate 计划门禁

```typescript
// agent/planning_gate.ts

import {AnalysisPlan, AnalysisPhase, SceneType} from '../types/plugin_state';

/**
 * Planning Gate
 * 强制 Agent 在开始分析前提交分析计划
 */
export class PlanningGate {
  private requiredPhases: Map<SceneType, string[]> = new Map([
    ['scrolling', ['frame_analysis', 'jank_detection', 'blocking_identification', 'root_cause']],
    ['startup_cold', ['process_creation', 'initialization', 'first_frame', 'root_cause']],
    ['startup_warm', ['activity_resume', 'view_binding', 'root_cause']],
    ['anr', ['blocking_detection', 'stack_analysis', 'resource_contention', 'root_cause']],
    ['general', ['data_collection', 'pattern_identification', 'root_cause']],
  ]);

  /**
   * 验证分析计划的完整性
   */
  validatePlan(plan: AnalysisPlan): ValidationResult {
    const issues: string[] = [];
    
    // 1. 检查计划是否有足够的阶段
    if (plan.phases.length < 2) {
      issues.push('Plan must have at least 2 phases');
    }
    
    // 2. 检查是否包含必要的阶段
    const requiredPhases = this.requiredPhases.get(plan.sceneType) || 
                          this.requiredPhases.get('general')!;
    
    const phaseNames = plan.phases.map(p => p.id.toLowerCase());
    for (const required of requiredPhases) {
      const found = phaseNames.some(name => 
        name.includes(required) || required.includes(name)
      );
      if (!found) {
        issues.push(`Missing required phase: ${required}`);
      }
    }
    
    // 3. 检查每个阶段是否有工具和预期输出
    for (const phase of plan.phases) {
      if (!phase.requiredTools || phase.requiredTools.length === 0) {
        issues.push(`Phase "${phase.name}" has no required tools specified`);
      }
      if (!phase.expectedOutputs || phase.expectedOutputs.length === 0) {
        issues.push(`Phase "${phase.name}" has no expected outputs specified`);
      }
    }
    
    // 4. 检查成功标准
    if (!plan.successCriteria || plan.successCriteria.length === 0) {
      issues.push('Plan must have success criteria defined');
    }
    
    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 创建计划模板
   */
  createPlanTemplate(sceneType: SceneType): AnalysisPlan {
    const templates: Partial<Record<SceneType, AnalysisPlan>> = {
      scrolling: {
        id: `plan_${Date.now()}`,
        sceneType: 'scrolling',
        phases: [
          {
            id: 'frame_analysis',
            name: 'Frame Timeline Analysis',
            description: 'Analyze frame rendering timeline and identify jank frames',
            requiredTools: ['invoke_skill', 'execute_sql'],
            expectedOutputs: ['frame_count', 'jank_rate', 'worst_frames'],
            completed: false,
          },
          {
            id: 'blocking_identification',
            name: 'Blocking Call Identification',
            description: 'Identify blocking calls causing frame drops',
            requiredTools: ['trace_process_flow', 'execute_sql'],
            expectedOutputs: ['blocking_calls', 'blocking_duration'],
            completed: false,
          },
          {
            id: 'root_cause',
            name: 'Root Cause Analysis',
            description: 'Determine root cause with WHY chain',
            requiredTools: ['execute_sql'],
            expectedOutputs: ['root_cause', 'why_chain'],
            completed: false,
          },
        ],
        successCriteria: [
          'Jank rate calculated',
          'Blocking calls identified',
          'Root cause with WHY chain >= 2 levels',
        ],
        estimatedSteps: 8,
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
          name: 'Data Collection',
          description: 'Gather relevant trace data',
          requiredTools: ['execute_sql', 'lookup_sql_schema'],
          expectedOutputs: ['relevant_data'],
          completed: false,
        },
        {
          id: 'root_cause',
          name: 'Root Cause Analysis',
          description: 'Identify and explain root cause',
          requiredTools: ['execute_sql', 'trace_process_flow'],
          expectedOutputs: ['root_cause', 'evidence'],
          completed: false,
        },
      ],
      successCriteria: ['Issue identified with evidence'],
      estimatedSteps: 5,
      submittedAt: Date.now(),
    };
  }
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
}
```

### 3.4 SceneClassifier 场景分类器

```typescript
// agent/scene_classifier.ts

import {Trace} from '../../../public/trace';
import {SceneType} from '../types/plugin_state';

interface ClassificationRule {
  keywords: string[];
  compoundPatterns: string[];
  sceneType: SceneType;
  priority: number;
}

/**
 * 场景分类器
 * 通过关键词匹配和 trace 数据分析确定场景类型
 */
export class SceneClassifier {
  private rules: ClassificationRule[] = [
    {
      keywords: ['scroll', 'sliding', 'swipe', '滑动', '滚动', 'fling', 'recyclerview'],
      compoundPatterns: ['frame drop', 'jank during scroll'],
      sceneType: 'scrolling',
      priority: 10,
    },
    {
      keywords: ['cold start', 'app launch', 'first launch', '冷启动', 'process start'],
      compoundPatterns: ['slow startup', 'launch time'],
      sceneType: 'startup_cold',
      priority: 10,
    },
    {
      keywords: ['warm start', 'resume', '热启动'],
      compoundPatterns: ['warm launch'],
      sceneType: 'startup_warm',
      priority: 9,
    },
    {
      keywords: ['hot start', 'quick resume'],
      compoundPatterns: [],
      sceneType: 'startup_hot',
      priority: 8,
    },
    {
      keywords: ['anr', 'not responding', 'application not responding', '无响应'],
      compoundPatterns: ['frozen ui', 'stuck'],
      sceneType: 'anr',
      priority: 15,
    },
    {
      keywords: ['lock', 'mutex', 'synchronized', 'contention', '锁'],
      compoundPatterns: ['lock contention', 'waiting for lock'],
      sceneType: 'lock_contention',
      priority: 12,
    },
    {
      keywords: ['binder', 'ipc', 'transaction', 'remote call'],
      compoundPatterns: ['binder delay', 'slow binder'],
      sceneType: 'binder_blocking',
      priority: 11,
    },
    {
      keywords: ['io', 'disk', 'file', 'database', 'network', 'read', 'write'],
      compoundPatterns: ['slow io', 'blocking io'],
      sceneType: 'io_analysis',
      priority: 9,
    },
    {
      keywords: ['cpu', 'load', 'high usage', 'performance', 'slow'],
      compoundPatterns: ['high cpu', 'cpu bound'],
      sceneType: 'high_load',
      priority: 7,
    },
    {
      keywords: ['screen on', 'screen off', 'display', 'wake'],
      compoundPatterns: [],
      sceneType: 'screen_on_off',
      priority: 6,
    },
    {
      keywords: ['unlock', 'keyguard', 'fingerprint', 'biometric'],
      compoundPatterns: [],
      sceneType: 'unlock',
      priority: 6,
    },
  ];

  /**
   * 分类用户输入的场景
   */
  async classify(userMessage: string, trace: Trace): Promise<SceneType> {
    const lowerMessage = userMessage.toLowerCase();
    
    // 1. 基于关键词匹配
    const keywordScores = this.calculateKeywordScores(lowerMessage);
    
    // 2. 基于复合模式匹配
    const patternScores = this.calculatePatternScores(lowerMessage);
    
    // 3. 合并分数
    const combinedScores = new Map<SceneType, number>();
    
    for (const [scene, score] of keywordScores) {
      combinedScores.set(scene, (combinedScores.get(scene) || 0) + score);
    }
    
    for (const [scene, score] of patternScores) {
      combinedScores.set(scene, (combinedScores.get(scene) || 0) + score * 1.5);
    }
    
    // 4. 如果没有明确匹配，尝试从 trace 数据推断
    if (combinedScores.size === 0 || Math.max(...combinedScores.values()) < 5) {
      const inferredScene = await this.inferFromTrace(trace);
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

  private calculateKeywordScores(message: string): Map<SceneType, number> {
    const scores = new Map<SceneType, number>();
    
    for (const rule of this.rules) {
      let score = 0;
      for (const keyword of rule.keywords) {
        if (message.includes(keyword)) {
          score += rule.priority;
        }
      }
      if (score > 0) {
        scores.set(rule.sceneType, (scores.get(rule.sceneType) || 0) + score);
      }
    }
    
    return scores;
  }

  private calculatePatternScores(message: string): Map<SceneType, number> {
    const scores = new Map<SceneType, number>();
    
    for (const rule of this.rules) {
      for (const pattern of rule.compoundPatterns) {
        if (message.includes(pattern)) {
          scores.set(
            rule.sceneType, 
            (scores.get(rule.sceneType) || 0) + rule.priority * 2
          );
        }
      }
    }
    
    return scores;
  }

  /**
   * 从 trace 数据推断场景类型
   */
  private async inferFromTrace(trace: Trace): Promise<SceneType | null> {
    try {
      // 检查是否有 ANR 相关数据
      const anrResult = await trace.engine.query(`
        SELECT COUNT(*) as cnt 
        FROM slice 
        WHERE name LIKE '%ANR%' OR name LIKE '%not responding%'
        LIMIT 1
      `);
      for (const it = anrResult.iter({cnt: 'number'}); it.valid(); it.next()) {
        if (it.cnt > 0) return 'anr';
      }
      
      // 检查是否有大量掉帧
      const jankResult = await trace.engine.query(`
        SELECT COUNT(*) as jank_count, COUNT(*) * 100.0 / 
          (SELECT COUNT(*) FROM actual_frame_timeline_slice) as jank_rate
        FROM actual_frame_timeline_slice
        WHERE jank_type != 'None' AND jank_type IS NOT NULL
      `);
      for (const it = jankResult.iter({
        jank_count: 'number',
        jank_rate: 'number',
      }); it.valid(); it.next()) {
        if (it.jank_rate > 10) return 'scrolling';
      }
      
      // 检查是否有启动相关的 slice
      const startupResult = await trace.engine.query(`
        SELECT COUNT(*) as cnt 
        FROM slice 
        WHERE name LIKE '%bindApplication%' 
           OR name LIKE '%activityStart%'
           OR name LIKE '%Choreographer%doFrame%'
        LIMIT 1
      `);
      for (const it = startupResult.iter({cnt: 'number'}); it.valid(); it.next()) {
        if (it.cnt > 0) return 'startup_cold';
      }
      
    } catch (error) {
      console.warn('Failed to infer scene from trace:', error);
    }
    
    return null;
  }
}
```

### 3.5 ArtifactStore 数据存储

```typescript
// agent/artifact_store.ts

import {
  Artifact, 
  ArtifactData, 
  ArtifactSummary, 
  ArtifactType,
  NumericStats,
  StringStats,
} from '../types/artifact';

/**
 * Artifact Store
 * 存储 Tool 返回的大量数据，并生成压缩摘要发送给 LLM
 */
export class ArtifactStore {
  private artifacts: Map<string, Artifact> = new Map();
  private idCounter = 0;

  /**
   * 存储完整数据并生成摘要
   */
  store(
    type: ArtifactType,
    data: ArtifactData,
    sourceTool: string,
    sourceQuery?: string
  ): Artifact {
    const id = `art_${++this.idCounter}`;
    
    const artifact: Artifact = {
      id,
      type,
      createdAt: Date.now(),
      fullData: data,
      summary: this.generateSummary(data),
      sourceTool,
      sourceQuery,
    };
    
    this.artifacts.set(id, artifact);
    return artifact;
  }

  /**
   * 获取指定 artifact
   */
  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  /**
   * 获取所有 artifacts
   */
  getAll(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * 分页获取数据
   */
  fetchPage(id: string, startRow: number, count: number): unknown[][] | null {
    const artifact = this.artifacts.get(id);
    if (!artifact) return null;
    
    return artifact.fullData.rows.slice(startRow, startRow + count);
  }

  /**
   * 获取存储的 artifact 数量
   */
  size(): number {
    return this.artifacts.size;
  }

  /**
   * 清空存储
   */
  clear(): void {
    this.artifacts.clear();
    this.idCounter = 0;
  }

  /**
   * 生成数据摘要
   * 
   * 采样策略改进（解决 M3 问题）：
   * - 目标 token 数提升到 800-1000（原 440）
   * - 使用分位数采样（p0, p25, p50, p75, p90, p95, p99, p99.9）
   * - 同时保留极值（Top 5 + Bottom 5）
   * - 保留长尾分布信息，避免 85% 数据丢失
   */
  private generateSummary(data: ArtifactData): ArtifactSummary {
    const summary: ArtifactSummary = {
      estimatedTokens: 0,
      rowCount: data.totalRowCount,
    };
    
    // 分析每一列
    const numericStats: Record<string, NumericStats> = {};
    const stringStats: Record<string, StringStats> = {};
    
    for (let colIdx = 0; colIdx < data.columns.length; colIdx++) {
      const col = data.columns[colIdx];
      const values = data.rows.map(row => row[colIdx]);
      
      if (col.type === 'integer' || col.type === 'float' || col.type === 'duration') {
        numericStats[col.name] = this.calculateNumericStats(
          values.filter(v => v !== null && v !== undefined) as number[]
        );
      } else if (col.type === 'string') {
        stringStats[col.name] = this.calculateStringStats(
          values.filter(v => v !== null && v !== undefined) as string[]
        );
      }
    }
    
    if (Object.keys(numericStats).length > 0) {
      summary.numericStats = numericStats;
    }
    
    if (Object.keys(stringStats).length > 0) {
      summary.stringStats = stringStats;
    }
    
    // 使用分位数采样 + 极值保留策略
    summary.sampleRows = this.getQuantileSampledRows(data);
    
    // 自动生成洞察
    summary.insights = this.generateInsights(data, numericStats, stringStats);
    
    // 估算 token 数量（目标 800-1000）
    summary.estimatedTokens = this.estimateTokens(summary);
    
    return summary;
  }

  /**
   * 计算数值列统计（包含完整分位数）
   */
  private calculateNumericStats(values: number[]): NumericStats {
    if (values.length === 0) {
      return { 
        min: 0, max: 0, avg: 0, 
        p0: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, p999: 0 
      };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p0: sorted[0],
      p25: this.percentile(sorted, 25),
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      p999: this.percentile(sorted, 99.9),
    };
  }

  private percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private calculateStringStats(values: string[]): StringStats {
    const counts = new Map<string, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    
    const topValues = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
    
    return {
      topValues,
      uniqueCount: counts.size,
    };
  }

  /**
   * 分位数采样 + 极值保留
   * 
   * 采样策略：
   * 1. Top 5（最大值）- 通常是性能问题最严重的行
   * 2. Bottom 5（最小值）- 作为基准对比
   * 3. 分位数采样点（p25, p50, p75, p90, p95）- 覆盖分布
   * 
   * 总共约 15-20 行，比原来的 10 行更全面
   */
  private getQuantileSampledRows(data: ArtifactData): unknown[][] {
    const rows = data.rows;
    if (rows.length <= 20) {
      return rows;  // 数据量小，全部返回
    }
    
    // 找到第一个数值列用于排序
    const numericColIdx = data.columns.findIndex(
      col => col.type === 'integer' || col.type === 'float' || col.type === 'duration'
    );
    
    if (numericColIdx < 0) {
      // 没有数值列，取前 15 行
      return rows.slice(0, 15);
    }
    
    // 按数值列排序
    const sortedRows = [...rows].sort((a, b) => {
      const aVal = a[numericColIdx] as number || 0;
      const bVal = b[numericColIdx] as number || 0;
      return bVal - aVal;  // 降序
    });
    
    const sampledRows: unknown[][] = [];
    const addedIndices = new Set<number>();
    
    // 1. Top 5（最大值）
    for (let i = 0; i < Math.min(5, sortedRows.length); i++) {
      sampledRows.push(sortedRows[i]);
      addedIndices.add(i);
    }
    
    // 2. Bottom 5（最小值）
    for (let i = sortedRows.length - 1; i >= Math.max(0, sortedRows.length - 5); i--) {
      if (!addedIndices.has(i)) {
        sampledRows.push(sortedRows[i]);
        addedIndices.add(i);
      }
    }
    
    // 3. 分位数采样点
    const percentiles = [25, 50, 75, 90, 95];
    for (const p of percentiles) {
      const idx = Math.floor((p / 100) * (sortedRows.length - 1));
      if (!addedIndices.has(idx)) {
        sampledRows.push(sortedRows[idx]);
        addedIndices.add(idx);
      }
    }
    
    // 按原始顺序排序返回
    return sampledRows.sort((a, b) => {
      const aVal = a[numericColIdx] as number || 0;
      const bVal = b[numericColIdx] as number || 0;
      return bVal - aVal;
    });
  }

  private generateInsights(
    data: ArtifactData,
    numericStats: Record<string, NumericStats>,
    stringStats: Record<string, StringStats>
  ): string[] {
    const insights: string[] = [];
    
    // 数值列洞察
    for (const [colName, stats] of Object.entries(numericStats)) {
      // P99 远大于 P50
      if (stats.p99 > stats.p50 * 5) {
        insights.push(`High variance in ${colName}: P99 (${stats.p99.toFixed(2)}) >> P50 (${stats.p50.toFixed(2)})`);
      }
      
      // 最大值异常
      if (stats.max > stats.p99 * 2) {
        insights.push(`Outlier detected in ${colName}: max (${stats.max.toFixed(2)}) >> P99`);
      }
    }
    
    // 字符串列洞察
    for (const [colName, stats] of Object.entries(stringStats)) {
      if (stats.topValues.length > 0) {
        const top = stats.topValues[0];
        const percentage = (top.count / data.totalRowCount * 100).toFixed(1);
        if (parseFloat(percentage) > 50) {
          insights.push(`Dominant value in ${colName}: "${top.value}" (${percentage}%)`);
        }
      }
    }
    
    return insights.slice(0, 5); // 最多 5 条洞察
  }

  private estimateTokens(summary: ArtifactSummary): number {
    // 简化估算
    let text = JSON.stringify(summary);
    return Math.ceil(text.length / 4);
  }

  /**
   * 格式化摘要为 LLM 可读的文本
   */
  formatSummaryForLLM(artifact: Artifact): string {
    const s = artifact.summary;
    const lines: string[] = [];
    
    lines.push(`[Artifact ${artifact.id}]`);
    lines.push(`Rows: ${s.rowCount}`);
    
    if (s.numericStats) {
      lines.push('Numeric columns:');
      for (const [col, stats] of Object.entries(s.numericStats)) {
        lines.push(`  ${col}: min=${stats.min.toFixed(2)}, max=${stats.max.toFixed(2)}, ` +
                   `avg=${stats.avg.toFixed(2)}, P50=${stats.p50.toFixed(2)}, ` +
                   `P90=${stats.p90.toFixed(2)}, P99=${stats.p99.toFixed(2)}`);
      }
    }
    
    if (s.stringStats) {
      lines.push('String columns:');
      for (const [col, stats] of Object.entries(s.stringStats)) {
        lines.push(`  ${col}: ${stats.uniqueCount} unique values`);
        lines.push(`    Top: ${stats.topValues.map(v => `${v.value}(${v.count})`).join(', ')}`);
      }
    }
    
    if (s.insights && s.insights.length > 0) {
      lines.push('Insights:');
      for (const insight of s.insights) {
        lines.push(`  - ${insight}`);
      }
    }
    
    lines.push(`(For full data: fetch_artifact('${artifact.id}', 0, 20))`);
    
    return lines.join('\n');
  }
}
```

### 3.6 Verifier 验证器

```typescript
// agent/verifier.ts

import {ChatMessage, AnalysisPlan} from '../types/plugin_state';
import {Artifact} from '../types/artifact';

/**
 * L1 启发式验证规则
 */
interface L1Rule {
  id: string;
  name: string;
  check: (messages: ChatMessage[], artifacts: Artifact[]) => string | null;
}

/**
 * L3 审查器接口（预留）
 */
export interface L3Reviewer {
  /**
   * 审查分析结论
   * @param conclusion 分析结论文本
   * @param evidence 支持证据
   * @returns 审查结果
   */
  review(conclusion: string, evidence: string[]): Promise<L3ReviewResult>;
}

export interface L3ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  confidence: number;
}

/**
 * 三层验证器
 * - L1: 启发式验证（规则匹配）
 * - L2: 计划遵从验证
 * - L3: 独立模型审查（预留接口）
 */
export class Verifier {
  /**
   * L1 启发式验证规则集
   * 
   * 规则设计原则：
   * - 每条规则检测一类常见误判模式
   * - 返回 null 表示通过，返回字符串表示问题描述
   * - 规则应有明确的触发条件和严重程度
   */
  private l1Rules: L1Rule[] = [
    // ============ 数据完整性规则 ============
    
    // R01: 时间戳递增性检查
    {
      id: 'timestamp_monotonic',
      name: 'Timestamp Monotonicity',
      check: (messages, artifacts) => {
        for (const artifact of artifacts) {
          const tsColIdx = artifact.fullData.columns.findIndex(c => c.type === 'timestamp');
          if (tsColIdx >= 0 && artifact.fullData.rows.length > 1) {
            let prevTs = artifact.fullData.rows[0][tsColIdx] as bigint;
            for (let i = 1; i < artifact.fullData.rows.length; i++) {
              const currTs = artifact.fullData.rows[i][tsColIdx] as bigint;
              if (currTs < prevTs) {
                return `Non-monotonic timestamps detected in artifact ${artifact.id}`;
              }
              prevTs = currTs;
            }
          }
        }
        return null;
      },
    },
    
    // R02: 线程存在性验证
    {
      id: 'thread_existence',
      name: 'Thread Existence Validation',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ');
        // 检查是否引用了可能不存在的线程
        const threadRefPattern = /thread\s+['"]?([^'"]+?)['"]?\s+(blocked|waiting|running)/gi;
        const toolResults = messages.filter(m => m.toolResult?.success);
        
        let match;
        while ((match = threadRefPattern.exec(content)) !== null) {
          const threadName = match[1];
          // 检查是否有工具结果提到这个线程
          const hasEvidence = toolResults.some(m => 
            JSON.stringify(m.toolResult?.data).includes(threadName)
          );
          if (!hasEvidence && threadName.length > 2) {
            return `Thread "${threadName}" referenced without query evidence`;
          }
        }
        return null;
      },
    },
    
    // R03: 进程状态一致性
    {
      id: 'process_state_consistency',
      name: 'Process State Consistency',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        // 检查进程状态矛盾
        if (content.includes('process not running') && content.includes('process is active')) {
          return 'Contradictory process state claims detected';
        }
        if (content.includes('process started') && content.includes('process never started')) {
          return 'Contradictory process startup claims detected';
        }
        return null;
      },
    },

    // ============ 性能指标规则 ============
    
    // R04: CPU频率异常检测
    {
      id: 'cpu_freq_anomaly',
      name: 'CPU Frequency Anomaly',
      check: (messages, artifacts) => {
        for (const artifact of artifacts) {
          const freqColIdx = artifact.fullData.columns.findIndex(
            c => c.name.toLowerCase().includes('freq') || c.name.toLowerCase().includes('frequency')
          );
          if (freqColIdx >= 0 && artifact.summary.numericStats) {
            const freqStats = Object.values(artifact.summary.numericStats).find(
              s => s.max > 0 && s.max < 10000000  // 合理的 CPU 频率范围 (Hz)
            );
            if (freqStats && freqStats.min < 100000) {  // 低于 100KHz 不合理
              return `Suspicious CPU frequency detected: ${freqStats.min} Hz`;
            }
          }
        }
        return null;
      },
    },
    
    // R05: GC暂停异常 (stop-the-world > 100ms)
    {
      id: 'gc_pause_anomaly',
      name: 'GC Pause Anomaly',
      check: (messages, artifacts) => {
        const content = messages.map(m => m.content).join(' ');
        const gcPattern = /gc\s+pause[d]?\s*[:\s]+(\d+\.?\d*)\s*ms/gi;
        let match;
        while ((match = gcPattern.exec(content)) !== null) {
          const pauseMs = parseFloat(match[1]);
          if (pauseMs > 100) {
            // 验证是否有对应的工具数据支持
            const hasEvidence = artifacts.some(a => 
              a.sourceTool === 'execute_sql' && 
              JSON.stringify(a.fullData.rows).includes('gc')
            );
            if (!hasEvidence) {
              return `GC pause of ${pauseMs}ms claimed without data support`;
            }
          }
        }
        return null;
      },
    },
    
    // R06: 主线程IO检测
    {
      id: 'main_thread_io',
      name: 'Main Thread I/O Detection',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        if (content.includes('main thread') && 
            (content.includes('disk io') || content.includes('file read') || content.includes('file write'))) {
          const hasEvidence = messages.some(m => 
            m.toolResult?.success && 
            (JSON.stringify(m.toolResult.data).includes('io') ||
             JSON.stringify(m.toolResult.data).includes('read') ||
             JSON.stringify(m.toolResult.data).includes('write'))
          );
          if (!hasEvidence) {
            return 'Main thread I/O claim without tool evidence';
          }
        }
        return null;
      },
    },
    
    // R07: Binder往返延迟检查 (单次 > 50ms)
    {
      id: 'binder_latency',
      name: 'Binder Latency Check',
      check: (messages, artifacts) => {
        const content = messages.map(m => m.content).join(' ');
        const binderPattern = /binder\s+(call|transaction|rtt|latency)[:\s]+(\d+\.?\d*)\s*ms/gi;
        let match;
        while ((match = binderPattern.exec(content)) !== null) {
          const latencyMs = parseFloat(match[2]);
          if (latencyMs > 50) {
            const hasEvidence = artifacts.some(a => 
              a.fullData.columns.some(c => 
                c.name.toLowerCase().includes('binder') || 
                c.name.toLowerCase().includes('round_trip')
              )
            );
            if (!hasEvidence) {
              return `Binder latency of ${latencyMs}ms claimed without trace evidence`;
            }
          }
        }
        return null;
      },
    },
    
    // R08: 系统调用负载检查
    {
      id: 'syscall_load',
      name: 'Syscall Load Check',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        // 检查是否声称高系统调用负载但没有数据支持
        if ((content.includes('syscall') || content.includes('system call')) && 
            (content.includes('high') || content.includes('excessive') || content.includes('too many'))) {
          const hasToolData = messages.some(m => m.toolResult?.success);
          if (!hasToolData) {
            return 'High syscall load claim without supporting query data';
          }
        }
        return null;
      },
    },

    // ============ 断言验证规则 ============
    
    // R09: VSync 偏移误判
    {
      id: 'vsync_offset',
      name: 'VSync Offset Misattribution',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        if (content.includes('vsync') && content.includes('problem')) {
          const hasEvidence = messages.some(m => 
            m.toolResult?.success && 
            JSON.stringify(m.toolResult.data).includes('vsync')
          );
          if (!hasEvidence) {
            return 'VSync issue mentioned without supporting data';
          }
        }
        return null;
      },
    },
    
    // R10: 空结果断言
    {
      id: 'empty_result_assertion',
      name: 'Empty Result Assertion',
      check: (messages, artifacts) => {
        const emptyArtifacts = artifacts.filter(a => a.fullData.totalRowCount === 0);
        if (emptyArtifacts.length > 0) {
          const lastAssistantMsg = messages
            .filter(m => m.role === 'assistant')
            .pop();
          
          if (lastAssistantMsg) {
            const assertionPatterns = [
              'clearly shows', 'indicates that', 'proves that',
              'demonstrates', 'confirms', 'the data shows',
            ];
            const hasAssertion = assertionPatterns.some(p => 
              lastAssistantMsg.content.toLowerCase().includes(p)
            );
            if (hasAssertion) {
              return 'Making assertions based on empty query results';
            }
          }
        }
        return null;
      },
    },
    
    // R11: 数值范围合理性
    {
      id: 'numeric_sanity',
      name: 'Numeric Value Sanity',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ');
        
        // 检查不合理的时间值
        const timePattern = /(\d+\.?\d*)\s*(ms|milliseconds?)/gi;
        let match;
        while ((match = timePattern.exec(content)) !== null) {
          const value = parseFloat(match[1]);
          if (value < 0 || value > 1000000) {
            return `Suspicious time value: ${value}ms`;
          }
        }
        
        // 检查不合理的百分比
        const percentPattern = /(\d+\.?\d*)\s*%/g;
        while ((match = percentPattern.exec(content)) !== null) {
          const value = parseFloat(match[1]);
          if (value < 0 || value > 100) {
            return `Invalid percentage: ${value}%`;
          }
        }
        
        return null;
      },
    },
    
    // R12: Buffer Stuffing 误判
    {
      id: 'buffer_stuffing',
      name: 'Buffer Stuffing Miscount',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        if (content.includes('buffer stuffing')) {
          const hasFrameCount = /\d+ frames/i.test(content);
          const hasEvidence = messages.some(m => 
            m.toolResult?.success && 
            m.toolResult.artifactRef
          );
          if (!hasFrameCount || !hasEvidence) {
            return 'Buffer stuffing claim without proper frame count evidence';
          }
        }
        return null;
      },
    },
    
    // R13: 单帧过度标记
    {
      id: 'single_frame_overmark',
      name: 'Single Frame Over-marking',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        const singleJankPattern = /1\s*(frame|帧).*(jank|drop|掉)/i;
        const severePattern = /(severe|critical|serious|严重)/i;
        
        if (singleJankPattern.test(content) && severePattern.test(content)) {
          return 'Single frame jank marked as severe issue';
        }
        return null;
      },
    },

    // ============ 因果关系规则 ============
    
    // R14: 无证据根因声明
    {
      id: 'unsupported_root_cause',
      name: 'Unsupported Root Cause Claim',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        const rootCausePatterns = ['root cause', 'caused by', 'reason is', 'due to', '根因', '原因是'];
        const hasRootCauseClaim = rootCausePatterns.some(p => content.includes(p));
        
        if (hasRootCauseClaim) {
          const toolCalls = messages.filter(m => m.toolCall);
          if (toolCalls.length < 2) {
            return 'Root cause claimed with insufficient tool investigation (< 2 tool calls)';
          }
        }
        return null;
      },
    },
    
    // R15: ANR原因不明确
    {
      id: 'anr_cause_unclear',
      name: 'ANR Cause Unclear',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        if (content.includes('anr') && !content.includes('input dispatch') && 
            !content.includes('broadcast') && !content.includes('service') &&
            !content.includes('content provider')) {
          return 'ANR mentioned but no specific cause type identified (input/broadcast/service/provider)';
        }
        return null;
      },
    },
    
    // R16: 锁竞争无持有者信息
    {
      id: 'lock_no_holder',
      name: 'Lock Contention Without Holder',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ').toLowerCase();
        if ((content.includes('lock contention') || content.includes('锁竞争')) &&
            !content.includes('held by') && !content.includes('owner') && !content.includes('持有者')) {
          return 'Lock contention mentioned without identifying lock holder';
        }
        return null;
      },
    },

    // ============ 帧分析规则 ============
    
    // R17: 帧率计算错误
    {
      id: 'fps_calculation',
      name: 'FPS Calculation Check',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ');
        const fpsPattern = /(\d+\.?\d*)\s*fps/gi;
        let match;
        while ((match = fpsPattern.exec(content)) !== null) {
          const fps = parseFloat(match[1]);
          // 合理的 FPS 范围：1-240
          if (fps < 1 || fps > 240) {
            return `Suspicious FPS value: ${fps}`;
          }
        }
        return null;
      },
    },
    
    // R18: 帧持续时间与帧率不一致
    {
      id: 'frame_duration_fps_mismatch',
      name: 'Frame Duration FPS Mismatch',
      check: (messages) => {
        const content = messages.map(m => m.content).join(' ');
        const fpsMatch = content.match(/(\d+)\s*fps/i);
        const durationMatch = content.match(/frame\s+duration[:\s]+(\d+\.?\d*)\s*ms/i);
        
        if (fpsMatch && durationMatch) {
          const fps = parseInt(fpsMatch[1]);
          const durationMs = parseFloat(durationMatch[1]);
          const expectedDuration = 1000 / fps;
          
          // 允许 20% 误差
          if (Math.abs(durationMs - expectedDuration) > expectedDuration * 0.2) {
            return `Frame duration ${durationMs}ms inconsistent with ${fps}fps (expected ~${expectedDuration.toFixed(1)}ms)`;
          }
        }
        return null;
      },
    },

    // ============ 工具使用规则 ============
    
    // R19: 未使用查询直接下结论
    {
      id: 'no_query_conclusion',
      name: 'Conclusion Without Query',
      check: (messages) => {
        const assistantMsgs = messages.filter(m => m.role === 'assistant');
        const toolCalls = messages.filter(m => m.toolCall);
        
        // 如果有助手消息但没有工具调用
        if (assistantMsgs.length > 0 && toolCalls.length === 0) {
          const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
          const conclusionPatterns = ['conclude', 'finding', 'analysis shows', 'result'];
          const hasConclusion = conclusionPatterns.some(p => 
            lastAssistant.content.toLowerCase().includes(p)
          );
          if (hasConclusion) {
            return 'Reaching conclusions without executing any queries';
          }
        }
        return null;
      },
    },
    
    // R20: SQL查询失败但继续分析
    {
      id: 'failed_query_continue',
      name: 'Continue After Failed Query',
      check: (messages) => {
        const failedTools = messages.filter(m => 
          m.toolResult && !m.toolResult.success
        );
        
        if (failedTools.length > 0) {
          const assistantAfterFail = messages.filter((m, idx) => {
            if (m.role !== 'assistant') return false;
            // 检查是否在失败查询之后
            const failIdx = messages.findIndex(fm => fm === failedTools[failedTools.length - 1]);
            return idx > failIdx;
          });
          
          if (assistantAfterFail.length > 0) {
            const content = assistantAfterFail[0].content.toLowerCase();
            if (!content.includes('error') && !content.includes('failed') && 
                !content.includes('retry') && !content.includes('alternative')) {
              return 'Analysis continues after query failure without acknowledgment';
            }
          }
        }
        return null;
      },
    },
  ];

  /**
   * 运行 L1 启发式验证
   */
  runL1Validation(messages: ChatMessage[], artifacts: Artifact[]): string[] {
    const issues: string[] = [];
    
    for (const rule of this.l1Rules) {
      const issue = rule.check(messages, artifacts);
      if (issue) {
        issues.push(`[L1:${rule.id}] ${issue}`);
      }
    }
    
    return issues;
  }

  /**
   * 运行 L2 计划遵从验证
   */
  runL2Validation(plan: AnalysisPlan, messages: ChatMessage[]): string[] {
    const issues: string[] = [];
    
    // 检查每个计划阶段是否完成
    for (const phase of plan.phases) {
      if (!phase.completed) {
        // 检查是否有对应的工具调用
        const hasToolCalls = messages.some(m => 
          m.toolCall && phase.requiredTools.includes(m.toolCall.name)
        );
        
        if (!hasToolCalls) {
          issues.push(`[L2:phase_missing] Phase "${phase.name}" not executed`);
        }
      }
      
      // 检查预期输出是否存在
      const content = messages.map(m => m.content).join(' ').toLowerCase();
      for (const output of phase.expectedOutputs) {
        const outputVariants = [output, output.replace(/_/g, ' ')];
        const hasOutput = outputVariants.some(v => content.includes(v));
        if (!hasOutput) {
          issues.push(`[L2:output_missing] Expected output "${output}" not found in phase "${phase.name}"`);
        }
      }
    }
    
    // 检查成功标准
    const content = messages.map(m => m.content).join(' ').toLowerCase();
    for (const criterion of plan.successCriteria) {
      // 简化检查：关键词是否出现
      const keywords = criterion.toLowerCase().split(' ').filter(w => w.length > 3);
      const matchCount = keywords.filter(k => content.includes(k)).length;
      
      if (matchCount < keywords.length * 0.5) {
        issues.push(`[L2:criterion_unmet] Success criterion may not be met: "${criterion}"`);
      }
    }
    
    return issues;
  }

  /**
   * L3 独立模型审查（预留接口）
   * 当前实现返回空实现，实际使用时需要注入 L3Reviewer
   */
  async runL3Review(
    reviewer: L3Reviewer | null,
    conclusion: string,
    evidence: string[]
  ): Promise<L3ReviewResult | null> {
    if (!reviewer) {
      // L3 未启用
      return null;
    }
    
    return await reviewer.review(conclusion, evidence);
  }

  /**
   * 创建 L3 审查器（工厂方法，预留）
   * 实际实现时需要调用轻量 LLM（如 Claude Haiku）
   */
  static createL3Reviewer(apiKey: string, model: string): L3Reviewer {
    // 预留实现
    return {
      async review(conclusion: string, evidence: string[]): Promise<L3ReviewResult> {
        // TODO: 实现实际的 LLM 调用
        console.warn('L3 Reviewer not implemented');
        return {
          approved: true,
          issues: [],
          suggestions: [],
          confidence: 0,
        };
      },
    };
  }
}
```

---

## 第4章：Tool系统详细设计

### 4.1 Tool注册和发现机制

```typescript
// tools/tool_registry.ts

import {Trace} from '../../../public/trace';
import {ArtifactStore} from '../agent/artifact_store';
import {Artifact, ArtifactData} from '../types/artifact';

/**
 * Tool 定义接口
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  category: 'query' | 'skill' | 'navigation' | 'mutation';
  concurrency: 'parallel' | 'serial';
}

/**
 * Tool 执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  artifactRef?: string;
  executionTimeMs: number;
}

/**
 * Tool 实现接口
 */
export interface Tool {
  readonly definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

type JSONSchema = Record<string, unknown>;

/**
 * Tool 注册表
 * 管理所有可用的 Agent Tools
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private trace: Trace;
  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
    
    // 注册所有内置 Tools
    this.registerBuiltinTools();
  }

  /**
   * 注册 Tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * 获取 Tool 定义列表（供 LLM 使用）
   */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * 执行 Tool
   */
  async execute(
    name: string, 
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        executionTimeMs: 0,
      };
    }

    const startTime = performance.now();
    try {
      const result = await tool.execute(args);
      result.executionTimeMs = performance.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * 注册内置 Tools
   */
  private registerBuiltinTools(): void {
    // 在下面的章节中详细定义每个 Tool
    this.register(new ExecuteSqlTool(this.trace, this.artifactStore));
    this.register(new InvokeSkillTool(this.trace, this.artifactStore));
    this.register(new ListSkillsTool());
    this.register(new TraceProcessFlowTool(this.trace, this.artifactStore));
    this.register(new LookupSqlSchemaTool(this.trace));
    this.register(new FetchArtifactTool(this.artifactStore));
    this.register(new SubmitPlanTool());
    this.register(new NavigateTimelineTool(this.trace));
    this.register(new MarkPositionTool(this.trace));
    this.register(new PinThreadTool(this.trace));
  }
}
```

### 4.2 完整Tool定义

#### 4.2.1 execute_sql

```typescript
// tools/execute_sql.ts

import {Trace} from '../../../public/trace';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {ArtifactData, ColumnDefinition} from '../types/artifact';

export class ExecuteSqlTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'execute_sql',
    description: `Execute a PerfettoSQL query against the loaded trace.
    
Use this for custom queries when no suitable Skill exists.
Results are automatically compressed and stored in ArtifactStore.

Important:
- Use LIMIT to avoid excessive results (max 5000 rows)
- Timestamps are in nanoseconds
- Include INCLUDE PERFETTO MODULE statements in separate calls`,
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'The PerfettoSQL query to execute',
        },
        maxRows: {
          type: 'number',
          description: 'Maximum rows to return (default: 200, max: 5000)',
          default: 200,
        },
      },
      required: ['sql'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;
  private artifactStore: ArtifactStore;
  
  private static readonly MAX_ROWS = 5000;
  private static readonly DEFAULT_ROWS = 200;
  private static readonly QUERY_TIMEOUT_MS = 30000;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sql = args.sql as string;
    const maxRows = Math.min(
      (args.maxRows as number) || ExecuteSqlTool.DEFAULT_ROWS,
      ExecuteSqlTool.MAX_ROWS
    );

    try {
      // 添加 LIMIT 如果没有的话
      let finalSql = sql.trim();
      if (!finalSql.toLowerCase().includes('limit')) {
        finalSql = `${finalSql} LIMIT ${maxRows}`;
      }

      // 执行查询（带超时）
      const result = await Promise.race([
        this.trace.engine.query(finalSql),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 
            ExecuteSqlTool.QUERY_TIMEOUT_MS)
        ),
      ]);

      // 解析结果
      const columns: ColumnDefinition[] = result.columns().map(name => ({
        name,
        type: this.inferColumnType(name),
      }));

      const rows: unknown[][] = [];
      const iter = result.iter({});
      
      while (iter.valid() && rows.length < maxRows) {
        const row: unknown[] = [];
        for (const col of columns) {
          row.push((iter as any)[col.name]);
        }
        rows.push(row);
        iter.next();
      }

      const data: ArtifactData = {
        columns,
        rows,
        totalRowCount: rows.length,
      };

      // 存储到 ArtifactStore
      const artifact = this.artifactStore.store(
        'table',
        data,
        'execute_sql',
        sql
      );

      // 返回压缩摘要
      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'execute_sql',
            rowCount: data.totalRowCount,
            columns: columns.map(c => c.name),
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
        },
        artifactRef: artifact.id,
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }

  private inferColumnType(name: string): ColumnDefinition['type'] {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('ts') || lowerName.includes('time')) {
      return 'timestamp';
    }
    if (lowerName.includes('dur')) {
      return 'duration';
    }
    if (lowerName.includes('name') || lowerName.includes('type')) {
      return 'string';
    }
    if (lowerName.includes('id') || lowerName.includes('count')) {
      return 'integer';
    }
    return 'string';
  }
}
```

#### 4.2.2 invoke_skill

```typescript
// tools/invoke_skill.ts

import {Trace} from '../../../public/trace';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {WebSocketClient} from '../services/websocket_client';

export class InvokeSkillTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'invoke_skill',
    description: `Invoke a predefined Skill from the backend.
    
Skills are reusable analysis patterns with optimized SQL queries.
Use list_skills to discover available Skills for the current scenario.

The skill will be executed on the backend and results returned.`,
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'The ID of the Skill to invoke',
        },
        params: {
          type: 'object',
          description: 'Parameters for the Skill',
          additionalProperties: true,
        },
      },
      required: ['skillId'],
    },
    category: 'skill',
    concurrency: 'serial',
  };

  private trace: Trace;
  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const skillId = args.skillId as string;
    const params = (args.params as Record<string, unknown>) || {};

    try {
      // 使用 Skill 标记协议
      const skillMarker = `skill:${skillId}|${JSON.stringify(params)}`;
      
      // 从后端获取 Skill 定义并执行 SQL
      const wsClient = WebSocketClient.getInstance();
      const response = await wsClient.invokeSkill(skillId, params);

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Skill execution failed',
          executionTimeMs: 0,
        };
      }

      // 将结果存储到 ArtifactStore
      const artifact = this.artifactStore.store(
        'table',
        response.data,
        `invoke_skill:${skillId}`,
        response.sql
      );

      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'invoke_skill',
            skillId,
            rowCount: response.data.totalRowCount,
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
          skillDescription: response.skillDescription,
        },
        artifactRef: artifact.id,
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }
}
```

#### 4.2.3 list_skills

```typescript
// tools/list_skills.ts

import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {WebSocketClient} from '../services/websocket_client';
import {SceneType} from '../types/plugin_state';

export class ListSkillsTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'list_skills',
    description: `List available Skills for the current analysis scenario.
    
Returns Skills filtered by scene type with descriptions.
Use this to discover what predefined analysis patterns are available.`,
    inputSchema: {
      type: 'object',
      properties: {
        sceneType: {
          type: 'string',
          description: 'Filter by scene type (scrolling, startup_cold, anr, etc.)',
          enum: [
            'scrolling', 'startup_cold', 'startup_warm', 'startup_hot',
            'anr', 'lock_contention', 'binder_blocking', 'io_analysis',
            'high_load', 'screen_on_off', 'unlock', 'general'
          ],
        },
        category: {
          type: 'string',
          description: 'Filter by Skill category',
          enum: ['atomic', 'composite', 'pipeline'],
        },
      },
    },
    category: 'skill',
    concurrency: 'parallel',
  };

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sceneType = args.sceneType as SceneType | undefined;
    const category = args.category as string | undefined;

    try {
      const wsClient = WebSocketClient.getInstance();
      const skills = await wsClient.listSkills(sceneType, category);

      // 格式化为易读的列表
      const formatted = skills.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        type: s.type,
        description: s.description,
        params: s.params.map(p => `${p.name}${p.required ? '*' : ''}: ${p.type}`),
      }));

      return {
        success: true,
        data: {
          status: 'success',
          skills: formatted,
          count: formatted.length,
          hint: 'Use invoke_skill(skillId, params) to execute a Skill',
        },
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }
}
```

#### 4.2.4 trace_process_flow

```typescript
// tools/trace_process_flow.ts

import {Trace} from '../../../public/trace';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';
import {ArtifactData} from '../types/artifact';

export class TraceProcessFlowTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'trace_process_flow',
    description: `Trace the execution flow from a specific slice.
    
Recursively finds:
- Child slices (nested calls)
- Parent slices (call stack)
- Blocking calls on the critical path
- Cross-process Binder transactions

Use this to understand the call chain that led to a performance issue.`,
    inputSchema: {
      type: 'object',
      properties: {
        sliceId: {
          type: 'number',
          description: 'The slice ID to trace from',
        },
        sliceName: {
          type: 'string',
          description: 'Alternative: slice name pattern to search',
        },
        processName: {
          type: 'string',
          description: 'Process name to filter (used with sliceName)',
        },
        direction: {
          type: 'string',
          description: 'Trace direction',
          enum: ['down', 'up', 'both'],
          default: 'down',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 5)',
          default: 5,
        },
      },
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;
  private artifactStore: ArtifactStore;

  constructor(trace: Trace, artifactStore: ArtifactStore) {
    this.trace = trace;
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sliceId = args.sliceId as number | undefined;
    const sliceName = args.sliceName as string | undefined;
    const processName = args.processName as string | undefined;
    const direction = (args.direction as string) || 'down';
    const maxDepth = (args.maxDepth as number) || 5;

    try {
      let targetSliceId = sliceId;

      // 如果提供了 sliceName，先查找对应的 slice
      if (!targetSliceId && sliceName) {
        const findSql = `
          SELECT s.id, s.name, s.ts, s.dur, t.name as thread_name, p.name as process_name
          FROM slice s
          JOIN thread_track tt ON s.track_id = tt.id
          JOIN thread t ON tt.utid = t.utid
          JOIN process p ON t.upid = p.upid
          WHERE s.name LIKE '%${sliceName}%'
          ${processName ? `AND p.name LIKE '%${processName}%'` : ''}
          ORDER BY s.dur DESC
          LIMIT 1
        `;
        
        const result = await this.trace.engine.query(findSql);
        for (const it = result.iter({id: 'number'}); it.valid(); it.next()) {
          targetSliceId = it.id;
          break;
        }
      }

      if (!targetSliceId) {
        return {
          success: false,
          error: 'Could not find target slice',
          executionTimeMs: 0,
        };
      }

      // 追踪调用流程
      const flowData = await this.traceFlow(targetSliceId, direction, maxDepth);

      // 存储结果
      const artifact = this.artifactStore.store(
        'trace_flow',
        flowData,
        'trace_process_flow'
      );

      return {
        success: true,
        data: {
          status: 'success',
          metadata: {
            tool: 'trace_process_flow',
            startSliceId: targetSliceId,
            direction,
            maxDepth,
            nodeCount: flowData.totalRowCount,
          },
          summary: artifact.summary,
          artifactRef: artifact.id,
        },
        artifactRef: artifact.id,
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }

  private async traceFlow(
    sliceId: number, 
    direction: string, 
    maxDepth: number
  ): Promise<ArtifactData> {
    const rows: unknown[][] = [];
    
    // 扩展列定义，包含 Binder 相关字段
    const columns = [
      { name: 'depth', type: 'integer' as const },
      { name: 'slice_id', type: 'integer' as const },
      { name: 'name', type: 'string' as const },
      { name: 'ts', type: 'timestamp' as const },
      { name: 'dur_ms', type: 'duration' as const },
      { name: 'thread', type: 'string' as const },
      { name: 'process', type: 'string' as const },
      { name: 'relation', type: 'string' as const },
      // Binder 相关字段
      { name: 'from_pid', type: 'integer' as const },
      { name: 'to_pid', type: 'integer' as const },
      { name: 'binder_reply_id', type: 'integer' as const },
      { name: 'round_trip_ms', type: 'duration' as const },
    ];

    // 获取起始 slice 信息
    const startInfo = await this.getSliceInfo(sliceId);
    if (startInfo) {
      rows.push([0, sliceId, startInfo.name, startInfo.ts, startInfo.dur_ms, 
                 startInfo.thread, startInfo.process, 'start',
                 null, null, null, null]);  // Binder 字段置空
    }

    // 向下追踪子调用
    if (direction === 'down' || direction === 'both') {
      await this.traceChildren(sliceId, 1, maxDepth, rows);
    }

    // 向上追踪父调用
    if (direction === 'up' || direction === 'both') {
      await this.traceParents(sliceId, -1, maxDepth, rows);
    }

    // 追踪 Binder 跨进程调用
    await this.traceBinderTransactions(sliceId, direction, maxDepth, rows);

    return {
      columns,
      rows,
      totalRowCount: rows.length,
    };
  }

  /**
   * 追踪 Binder 跨进程调用
   * 
   * Binder 是 Android 性能分析核心能力，通过以下表进行追踪：
   * - binder_transaction: 记录 Binder 事务
   * - binder_transaction_received: 记录事务接收
   * 
   * 输出包含：
   * - from_pid: 发起调用的进程 ID
   * - to_pid: 目标进程 ID
   * - round_trip_ms: 往返时间（发起到接收回复）
   */
  private async traceBinderTransactions(
    sliceId: number,
    direction: string,
    maxDepth: number,
    rows: unknown[][]
  ): Promise<void> {
    // 获取与当前 slice 时间范围重叠的 Binder 事务
    const sliceInfo = await this.getSliceInfo(sliceId);
    if (!sliceInfo) return;

    const ts = sliceInfo.ts;
    const dur = BigInt(Math.round(sliceInfo.dur_ms * 1e6));
    const endTs = ts + dur;

    // 查询发出的 Binder 事务（当前进程作为 client）
    if (direction === 'down' || direction === 'both') {
      const outgoingBinderSql = `
        WITH binder_pairs AS (
          SELECT
            req.id AS request_id,
            req.ts AS request_ts,
            req.dur AS request_dur,
            reply.id AS reply_id,
            reply.ts AS reply_ts,
            ROUND((COALESCE(reply.ts, req.ts + req.dur) - req.ts) / 1e6, 2) AS round_trip_ms,
            -- 发起方信息
            req_thread.tid AS from_tid,
            req_proc.pid AS from_pid,
            req_proc.name AS from_process,
            req_thread.name AS from_thread,
            -- 目标方信息
            reply_thread.tid AS to_tid,
            reply_proc.pid AS to_pid,
            reply_proc.name AS to_process,
            reply_thread.name AS to_thread,
            -- 事务信息
            req.name AS transaction_name
          FROM slice req
          JOIN thread_track req_tt ON req.track_id = req_tt.id
          JOIN thread req_thread ON req_tt.utid = req_thread.utid
          JOIN process req_proc ON req_thread.upid = req_proc.upid
          -- 关联 reply（通过 flow events 或名称匹配）
          LEFT JOIN slice reply ON (
            reply.name = 'binder reply' 
            AND reply.ts > req.ts 
            AND reply.ts < req.ts + req.dur + 100000000  -- 100ms 窗口
          )
          LEFT JOIN thread_track reply_tt ON reply.track_id = reply_tt.id
          LEFT JOIN thread reply_thread ON reply_tt.utid = reply_thread.utid
          LEFT JOIN process reply_proc ON reply_thread.upid = reply_proc.upid
          WHERE req.name LIKE 'binder transaction%'
            AND req.ts >= ${ts}
            AND req.ts <= ${endTs}
            AND req_proc.name = '${sliceInfo.process.replace(/'/g, "''")}'
          ORDER BY round_trip_ms DESC
          LIMIT 20
        )
        SELECT * FROM binder_pairs WHERE round_trip_ms IS NOT NULL
      `;

      try {
        const result = await this.trace.engine.query(outgoingBinderSql);
        for (const it = result.iter({
          request_id: 'number',
          request_ts: 'bigint',
          round_trip_ms: 'number',
          from_pid: 'number',
          from_process: 'str',
          from_thread: 'str',
          to_pid: 'number',
          to_process: 'str',
          to_thread: 'str',
          reply_id: 'number',
          transaction_name: 'str',
        }); it.valid(); it.next()) {
          rows.push([
            1,  // depth
            it.request_id,
            `${it.transaction_name} → ${it.to_process}`,
            it.request_ts,
            it.round_trip_ms,
            it.from_thread,
            it.from_process,
            'binder_outgoing',
            it.from_pid,
            it.to_pid,
            it.reply_id,
            it.round_trip_ms,
          ]);
        }
      } catch (e) {
        // Binder 表可能不存在，忽略错误
        console.warn('Binder tracing failed:', e);
      }
    }

    // 查询接收的 Binder 事务（当前进程作为 server）
    if (direction === 'up' || direction === 'both') {
      const incomingBinderSql = `
        SELECT
          s.id AS slice_id,
          s.ts,
          ROUND(s.dur / 1e6, 2) AS dur_ms,
          s.name,
          t.name AS thread_name,
          p.name AS process_name,
          p.pid,
          -- 尝试获取调用方信息
          COALESCE(caller_proc.pid, 0) AS caller_pid,
          COALESCE(caller_proc.name, 'unknown') AS caller_process
        FROM slice s
        JOIN thread_track tt ON s.track_id = tt.id
        JOIN thread t ON tt.utid = t.utid
        JOIN process p ON t.upid = p.upid
        -- 尝试通过 flow 关联调用方（如果有 flow 数据）
        LEFT JOIN flow f ON f.slice_in = s.id
        LEFT JOIN slice caller_slice ON f.slice_out = caller_slice.id
        LEFT JOIN thread_track caller_tt ON caller_slice.track_id = caller_tt.id
        LEFT JOIN thread caller_t ON caller_tt.utid = caller_t.utid
        LEFT JOIN process caller_proc ON caller_t.upid = caller_proc.upid
        WHERE s.name LIKE 'binder reply%'
          AND s.ts >= ${ts}
          AND s.ts <= ${endTs}
          AND p.name = '${sliceInfo.process.replace(/'/g, "''")}'
        ORDER BY s.dur DESC
        LIMIT 10
      `;

      try {
        const result = await this.trace.engine.query(incomingBinderSql);
        for (const it = result.iter({
          slice_id: 'number',
          ts: 'bigint',
          dur_ms: 'number',
          name: 'str',
          thread_name: 'str',
          process_name: 'str',
          pid: 'number',
          caller_pid: 'number',
          caller_process: 'str',
        }); it.valid(); it.next()) {
          rows.push([
            -1,  // depth (incoming)
            it.slice_id,
            `${it.caller_process} → ${it.name}`,
            it.ts,
            it.dur_ms,
            it.thread_name,
            it.process_name,
            'binder_incoming',
            it.caller_pid,
            it.pid,
            null,
            it.dur_ms,
          ]);
        }
      } catch (e) {
        console.warn('Binder incoming tracing failed:', e);
      }
    }
  }

  private async getSliceInfo(sliceId: number): Promise<{
    name: string;
    ts: bigint;
    dur_ms: number;
    thread: string;
    process: string;
  } | null> {
    const sql = `
      SELECT s.name, s.ts, ROUND(s.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE s.id = ${sliceId}
    `;
    
    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      return {
        name: it.name ?? '',
        ts: it.ts ?? 0n,
        dur_ms: it.dur_ms ?? 0,
        thread: it.thread ?? '',
        process: it.process ?? '',
      };
    }
    return null;
  }

  private async traceChildren(
    parentId: number,
    depth: number,
    maxDepth: number,
    rows: unknown[][]
  ): Promise<void> {
    if (depth > maxDepth) return;

    const sql = `
      SELECT s.id, s.name, s.ts, ROUND(s.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE s.parent_id = ${parentId}
      ORDER BY s.dur DESC
      LIMIT 10
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      id: 'number',
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      rows.push([depth, it.id, it.name, it.ts, it.dur_ms, it.thread, it.process, 'child',
                 null, null, null, null]);  // Binder 字段置空
      
      // 递归
      await this.traceChildren(it.id ?? 0, depth + 1, maxDepth, rows);
    }
  }

  private async traceParents(
    childId: number,
    depth: number,
    maxDepth: number,
    rows: unknown[][]
  ): Promise<void> {
    if (Math.abs(depth) > maxDepth) return;

    const sql = `
      SELECT parent.id, parent.name, parent.ts, ROUND(parent.dur / 1e6, 2) as dur_ms,
             t.name as thread, p.name as process
      FROM slice child
      JOIN slice parent ON child.parent_id = parent.id
      JOIN thread_track tt ON parent.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE child.id = ${childId}
    `;

    const result = await this.trace.engine.query(sql);
    for (const it = result.iter({
      id: 'number',
      name: 'str',
      ts: 'bigint',
      dur_ms: 'number',
      thread: 'str',
      process: 'str',
    }); it.valid(); it.next()) {
      rows.push([depth, it.id, it.name, it.ts, it.dur_ms, it.thread, it.process, 'parent',
                 null, null, null, null]);  // Binder 字段置空
      
      // 递归
      await this.traceParents(it.id ?? 0, depth - 1, maxDepth, rows);
    }
  }
}
```

#### 4.2.5 lookup_sql_schema

```typescript
// tools/lookup_sql_schema.ts

import {Trace} from '../../../public/trace';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class LookupSqlSchemaTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'lookup_sql_schema',
    description: `Look up PerfettoSQL table/view schema and available functions.
    
Use this to:
- Discover table columns before writing queries
- Find available stdlib functions
- Understand data types

Available lookups:
- table: Get columns and types for a table
- tables: List all tables matching a pattern
- functions: List stdlib functions`,
    inputSchema: {
      type: 'object',
      properties: {
        lookupType: {
          type: 'string',
          enum: ['table', 'tables', 'functions'],
          description: 'Type of lookup to perform',
        },
        pattern: {
          type: 'string',
          description: 'Table name or pattern to search',
        },
      },
      required: ['lookupType'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const lookupType = args.lookupType as string;
    const pattern = args.pattern as string | undefined;

    try {
      switch (lookupType) {
        case 'table':
          return await this.lookupTable(pattern || '');
        case 'tables':
          return await this.listTables(pattern);
        case 'functions':
          return await this.listFunctions(pattern);
        default:
          return {
            success: false,
            error: `Unknown lookup type: ${lookupType}`,
            executionTimeMs: 0,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }

  private async lookupTable(tableName: string): Promise<ToolExecutionResult> {
    const sql = `PRAGMA table_info('${tableName}')`;
    const result = await this.trace.engine.query(sql);

    const columns: Array<{name: string; type: string; notnull: boolean}> = [];
    
    for (const it = result.iter({
      name: 'str',
      type: 'str',
      notnull: 'number',
    }); it.valid(); it.next()) {
      columns.push({
        name: it.name ?? '',
        type: it.type ?? '',
        notnull: (it.notnull ?? 0) === 1,
      });
    }

    if (columns.length === 0) {
      return {
        success: false,
        error: `Table '${tableName}' not found`,
        executionTimeMs: 0,
      };
    }

    return {
      success: true,
      data: {
        table: tableName,
        columns,
        hint: `Use: SELECT ${columns.slice(0, 5).map(c => c.name).join(', ')} FROM ${tableName}`,
      },
      executionTimeMs: 0,
    };
  }

  private async listTables(pattern?: string): Promise<ToolExecutionResult> {
    const whereClause = pattern 
      ? `AND name LIKE '%${pattern}%'`
      : '';

    const sql = `
      SELECT name, type
      FROM sqlite_schema
      WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '\_%' ESCAPE '\\'
        ${whereClause}
      ORDER BY name
      LIMIT 50
    `;

    const result = await this.trace.engine.query(sql);
    const tables: Array<{name: string; type: string}> = [];

    for (const it = result.iter({
      name: 'str',
      type: 'str',
    }); it.valid(); it.next()) {
      tables.push({
        name: it.name ?? '',
        type: it.type ?? '',
      });
    }

    return {
      success: true,
      data: {
        tables,
        count: tables.length,
        hint: 'Use lookup_sql_schema(lookupType: "table", pattern: "table_name") to get columns',
      },
      executionTimeMs: 0,
    };
  }

  private async listFunctions(pattern?: string): Promise<ToolExecutionResult> {
    // 常用 stdlib 函数列表
    const functions = [
      { name: 'ROUND(x, n)', description: 'Round x to n decimal places' },
      { name: 'CAST(x AS type)', description: 'Convert x to type' },
      { name: 'COALESCE(x, y)', description: 'Return first non-null value' },
      { name: 'IIF(cond, x, y)', description: 'If cond then x else y' },
      { name: 'GROUP_CONCAT(x)', description: 'Concatenate values in group' },
      { name: 'LAG(x)', description: 'Previous row value (window function)' },
      { name: 'LEAD(x)', description: 'Next row value (window function)' },
      // Perfetto specific
      { name: 'DUR_FROM_NS(x)', description: 'Format duration from nanoseconds' },
      { name: 'TS_FROM_NS(x)', description: 'Format timestamp from nanoseconds' },
    ];

    const filtered = pattern 
      ? functions.filter(f => 
          f.name.toLowerCase().includes(pattern.toLowerCase()))
      : functions;

    return {
      success: true,
      data: {
        functions: filtered,
        note: 'For stdlib modules, use: INCLUDE PERFETTO MODULE android.* (or slices.*, viz.*, etc.)',
      },
      executionTimeMs: 0,
    };
  }
}
```

#### 4.2.6 fetch_artifact

```typescript
// tools/fetch_artifact.ts

import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';

export class FetchArtifactTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'fetch_artifact',
    description: `Fetch detailed data from an Artifact in the store.
    
Use this when you need more data than the summary provides.
Data is paginated for efficiency.`,
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The artifact ID (e.g., "art_1")',
        },
        startRow: {
          type: 'number',
          description: 'Starting row index (0-based)',
          default: 0,
        },
        count: {
          type: 'number',
          description: 'Number of rows to fetch (max: 50)',
          default: 20,
        },
      },
      required: ['artifactId'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private artifactStore: ArtifactStore;

  constructor(artifactStore: ArtifactStore) {
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const artifactId = args.artifactId as string;
    const startRow = (args.startRow as number) || 0;
    const count = Math.min((args.count as number) || 20, 50);

    const artifact = this.artifactStore.get(artifactId);
    if (!artifact) {
      return {
        success: false,
        error: `Artifact not found: ${artifactId}`,
        executionTimeMs: 0,
      };
    }

    const rows = this.artifactStore.fetchPage(artifactId, startRow, count);
    if (!rows) {
      return {
        success: false,
        error: 'Failed to fetch artifact data',
        executionTimeMs: 0,
      };
    }

    return {
      success: true,
      data: {
        artifactId,
        columns: artifact.fullData.columns.map(c => c.name),
        rows,
        pagination: {
          startRow,
          count: rows.length,
          totalRows: artifact.fullData.totalRowCount,
          hasMore: startRow + rows.length < artifact.fullData.totalRowCount,
        },
      },
      executionTimeMs: 0,
    };
  }
}
```

#### 4.2.7 submit_plan

```typescript
// tools/submit_plan.ts

import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {AnalysisPlan, AnalysisPhase, SceneType} from '../types/plugin_state';
import {PlanningGate} from '../agent/planning_gate';

export class SubmitPlanTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'submit_plan',
    description: `Submit an analysis plan before starting investigation.
    
This is REQUIRED before using other analysis tools.
The plan should outline:
- Analysis phases with required tools
- Expected outputs for each phase
- Success criteria

Example plan structure:
{
  sceneType: "scrolling",
  phases: [
    {
      id: "detect_jank",
      name: "Detect Jank Frames",
      description: "Find frames with jank",
      requiredTools: ["invoke_skill"],
      expectedOutputs: ["jank_rate", "worst_frames"]
    }
  ],
  successCriteria: ["Root cause identified with evidence"]
}`,
    inputSchema: {
      type: 'object',
      properties: {
        sceneType: {
          type: 'string',
          description: 'The identified scene type',
          enum: [
            'scrolling', 'startup_cold', 'startup_warm', 'startup_hot',
            'anr', 'lock_contention', 'binder_blocking', 'io_analysis',
            'high_load', 'screen_on_off', 'unlock', 'general'
          ],
        },
        phases: {
          type: 'array',
          description: 'Analysis phases',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              requiredTools: { type: 'array', items: { type: 'string' } },
              expectedOutputs: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        successCriteria: {
          type: 'array',
          description: 'Criteria for successful analysis',
          items: { type: 'string' },
        },
      },
      required: ['sceneType', 'phases', 'successCriteria'],
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sceneType = args.sceneType as SceneType;
    const phases = args.phases as AnalysisPhase[];
    const successCriteria = args.successCriteria as string[];

    // 构建计划对象
    const plan: AnalysisPlan = {
      id: `plan_${Date.now()}`,
      sceneType,
      phases: phases.map(p => ({
        ...p,
        completed: false,
      })),
      successCriteria,
      estimatedSteps: phases.length * 2,
      submittedAt: Date.now(),
    };

    // 验证计划
    const planningGate = new PlanningGate();
    const validation = planningGate.validatePlan(plan);

    if (!validation.valid) {
      return {
        success: false,
        error: `Plan validation failed:\n${validation.issues.join('\n')}`,
        executionTimeMs: 0,
      };
    }

    return {
      success: true,
      data: plan,
      executionTimeMs: 0,
    };
  }
}
```

#### 4.2.8 navigate_timeline

```typescript
// tools/navigate_timeline.ts

import {Trace} from '../../../public/trace';
import {Time} from '../../../base/time';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class NavigateTimelineTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'navigate_timeline',
    description: `Navigate the timeline view to a specific position.
    
Use this to show the user a relevant time range or slice.`,
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          description: 'Timestamp in nanoseconds (as string for bigint)',
        },
        sliceId: {
          type: 'number',
          description: 'Alternative: Navigate to a specific slice',
        },
        duration: {
          type: 'string',
          description: 'Visible window duration in nanoseconds',
        },
        align: {
          type: 'string',
          enum: ['center', 'start', 'zoom'],
          default: 'center',
        },
      },
    },
    category: 'navigation',
    concurrency: 'serial',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      if (args.sliceId) {
        // 导航到 slice
        const sliceId = args.sliceId as number;
        this.trace.selection.selectSqlEvent('slice', sliceId, {
          scrollToSelection: true,
          switchToCurrentSelectionTab: true,
        });

        return {
          success: true,
          data: { navigatedTo: 'slice', sliceId },
          executionTimeMs: 0,
        };
      }

      if (args.timestamp) {
        // 导航到时间戳
        const ts = BigInt(args.timestamp as string);
        const time = Time.fromRaw(ts);
        const align = (args.align as 'center' | 'start' | 'zoom') || 'center';

        if (args.duration) {
          const dur = BigInt(args.duration as string);
          const endTime = Time.fromRaw(ts + dur);
          this.trace.timeline.panSpanIntoView(time, endTime, { align });
        } else {
          this.trace.timeline.panIntoView(time, { align });
        }

        return {
          success: true,
          data: { navigatedTo: 'timestamp', timestamp: ts.toString() },
          executionTimeMs: 0,
        };
      }

      return {
        success: false,
        error: 'Either timestamp or sliceId must be provided',
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }
}
```

#### 4.2.9 mark_position

```typescript
// tools/mark_position.ts

import {Trace} from '../../../public/trace';
import {Time} from '../../../base/time';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class MarkPositionTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'mark_position',
    description: `Add a marker to the timeline at a specific position.
    
Markers help highlight important events for the user.
AI-created markers are visually distinguished.`,
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          description: 'Timestamp in nanoseconds (as string)',
        },
        sliceId: {
          type: 'number',
          description: 'Alternative: Mark a specific slice',
        },
        note: {
          type: 'string',
          description: 'Note to attach to the marker',
        },
        color: {
          type: 'string',
          description: 'Marker color (hex)',
          default: '#4285f4',
        },
      },
      required: ['note'],
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const note = args.note as string;
    const color = (args.color as string) || '#4285f4';

    try {
      let timestamp: bigint;

      if (args.sliceId) {
        // 获取 slice 的时间戳
        const sliceId = args.sliceId as number;
        const sql = `SELECT ts FROM slice WHERE id = ${sliceId}`;
        const result = await this.trace.engine.query(sql);
        
        for (const it = result.iter({ts: 'bigint'}); it.valid(); it.next()) {
          timestamp = it.ts ?? 0n;
          break;
        }
      } else if (args.timestamp) {
        timestamp = BigInt(args.timestamp as string);
      } else {
        return {
          success: false,
          error: 'Either timestamp or sliceId must be provided',
          executionTimeMs: 0,
        };
      }

      // 创建标记
      const noteId = this.trace.notes.addNote({
        timestamp: Time.fromRaw(timestamp!),
        color,
        text: `[AI] ${note}`,
      });

      return {
        success: true,
        data: {
          markerId: noteId,
          timestamp: timestamp!.toString(),
          note,
        },
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }
}
```

#### 4.2.10 pin_thread

```typescript
// tools/pin_thread.ts

import {Trace} from '../../../public/trace';
import {Tool, ToolDefinition, ToolExecutionResult} from './tool_registry';

export class PinThreadTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'pin_thread',
    description: `Pin a thread track to the top of the timeline.
    
Pinned tracks remain visible when scrolling.
AI-pinned tracks are visually distinguished.`,
    inputSchema: {
      type: 'object',
      properties: {
        utid: {
          type: 'number',
          description: 'The unique thread ID (utid)',
        },
        processName: {
          type: 'string',
          description: 'Alternative: Process name pattern',
        },
        threadName: {
          type: 'string',
          description: 'Thread name pattern (used with processName)',
        },
      },
    },
    category: 'mutation',
    concurrency: 'serial',
  };

  private trace: Trace;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      let utid = args.utid as number | undefined;

      // 如果提供了名称模式，先查找 utid
      if (!utid && args.processName) {
        const processName = args.processName as string;
        const threadName = args.threadName as string || '%';

        const sql = `
          SELECT t.utid, t.name as thread_name, p.name as process_name
          FROM thread t
          JOIN process p ON t.upid = p.upid
          WHERE p.name LIKE '%${processName}%'
            AND t.name LIKE '%${threadName}%'
          LIMIT 1
        `;

        const result = await this.trace.engine.query(sql);
        for (const it = result.iter({utid: 'number'}); it.valid(); it.next()) {
          utid = it.utid;
          break;
        }
      }

      if (!utid) {
        return {
          success: false,
          error: 'Thread not found',
          executionTimeMs: 0,
        };
      }

      // 查找对应的 track 并 pin
      const trackUri = `thread_${utid}`;
      const track = this.trace.currentWorkspace.getTrackByUri(trackUri);
      
      if (track) {
        track.pin();
        return {
          success: true,
          data: {
            utid,
            trackUri,
            pinned: true,
          },
          executionTimeMs: 0,
        };
      }

      return {
        success: false,
        error: `Track not found for utid: ${utid}`,
        executionTimeMs: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
      };
    }
  }
}
```

### 4.3 DataEnvelope 输出格式

```typescript
// types/data_envelope.ts

/**
 * Tool 返回给 LLM 的标准数据格式
 */
export interface DataEnvelope {
  /** 执行状态 */
  status: 'success' | 'error' | 'partial';
  
  /** 元数据 */
  metadata: {
    tool: string;
    execMs: number;
    rowCount?: number;
    columns?: string[];
  };
  
  /** 数据摘要（压缩后） */
  summary?: {
    numericStats?: Record<string, {
      min: number;
      max: number;
      avg: number;
      p50: number;
      p90: number;
      p99: number;
    }>;
    stringStats?: Record<string, {
      topValues: Array<{value: string; count: number}>;
      uniqueCount: number;
    }>;
    insights?: string[];
  };
  
  /** Artifact 引用 */
  artifactRef?: string;
  
  /** 使用提示 */
  hint?: string;
  
  /** 错误信息 */
  error?: string;
}
```

---

## 第5章：后端服务详细设计（Node.js Fastify）

### 5.1 项目结构

```
server/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                 # Fastify 入口
│   ├── config/
│   │   └── index.ts             # 配置加载
│   ├── types/
│   │   ├── shared.ts            # 前后端共享类型
│   │   ├── skill.ts             # Skill 类型
│   │   ├── protocol.ts          # 协议类型
│   │   └── session.ts           # 会话类型
│   ├── services/
│   │   ├── skill_processor.ts   # Skill YAML解析执行
│   │   ├── llm_proxy.ts         # LLM Provider抽象
│   │   ├── session_manager.ts   # 会话管理
│   │   └── skill_registry.ts    # Skill注册表
│   ├── routes/
│   │   ├── websocket.ts         # WebSocket路由
│   │   ├── skills.ts            # Skill REST API
│   │   └── config.ts            # 配置API
│   └── utils/
│       ├── yaml_parser.ts       # YAML解析
│       └── logger.ts            # 日志工具
├── skills/
│   └── library/
│       ├── atomic/              # 原子Skill
│       ├── composite/           # 组合Skill
│       ├── pipeline/            # 管线Skill
│       └── vendors/             # 厂商覆写
├── config/
│   ├── default.yaml
│   ├── llm_providers.yaml
│   └── feature_flags.yaml
└── tests/
```

### 5.2 Fastify 服务入口

```typescript
// server/src/index.ts

import Fastify, {FastifyInstance, FastifyRequest, FastifyReply} from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import {randomUUID} from 'crypto';
import {config} from './config';
import {setupWebSocketRoutes} from './routes/websocket';
import {setupSkillRoutes} from './routes/skills';
import {setupConfigRoutes} from './routes/config';
import {setupSessionRoutes} from './routes/sessions';
import {SessionManager} from './services/session_manager';
import {SkillRegistry} from './services/skill_registry';
import {LLMProxy} from './services/llm_proxy';
import {StructuredLogger, LogEntry} from './utils/logger';

const logger = new StructuredLogger('server');

// ============= 结构化日志格式 =============

interface RequestLogEntry extends LogEntry {
  traceId: string;
  agentId?: string;
  method: string;
  url: string;
  statusCode?: number;
  duration?: number;
  userAgent?: string;
  ip?: string;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

// 扩展 FastifyRequest 类型，添加 traceId 和 startTime
declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
    startTime: bigint;
    agentId?: string;
  }
}

// ============= 错误分类 =============

enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT = 'RATE_LIMIT',
  INTERNAL = 'INTERNAL',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
}

function categorizeError(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();
  if (message.includes('validation') || message.includes('invalid')) {
    return ErrorCategory.VALIDATION;
  }
  if (message.includes('unauthorized') || message.includes('api key')) {
    return ErrorCategory.AUTHENTICATION;
  }
  if (message.includes('forbidden') || message.includes('permission')) {
    return ErrorCategory.AUTHORIZATION;
  }
  if (message.includes('not found')) {
    return ErrorCategory.NOT_FOUND;
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return ErrorCategory.RATE_LIMIT;
  }
  if (message.includes('llm') || message.includes('provider')) {
    return ErrorCategory.EXTERNAL_SERVICE;
  }
  return ErrorCategory.INTERNAL;
}

function getStatusCodeForCategory(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.VALIDATION: return 400;
    case ErrorCategory.AUTHENTICATION: return 401;
    case ErrorCategory.AUTHORIZATION: return 403;
    case ErrorCategory.NOT_FOUND: return 404;
    case ErrorCategory.RATE_LIMIT: return 429;
    case ErrorCategory.EXTERNAL_SERVICE: return 502;
    default: return 500;
  }
}

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // 使用自定义结构化日志
    requestTimeout: config.server.requestTimeout || 30000, // 请求超时配置
    connectionTimeout: config.server.connectionTimeout || 10000,
  });

  // ============= 全局 onRequest 钩子 =============
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // 生成 traceId（优先使用请求头中的，否则生成新的）
    request.traceId = (request.headers['x-trace-id'] as string) || randomUUID();
    request.startTime = process.hrtime.bigint();
    
    // 从请求中提取 agentId（如果存在）
    request.agentId = request.headers['x-agent-id'] as string;
    
    // 设置响应头
    reply.header('X-Trace-Id', request.traceId);
  });

  // ============= 全局 onResponse 钩子 =============
  server.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const duration = Number(process.hrtime.bigint() - request.startTime) / 1e6; // 转换为毫秒
    
    const logEntry: RequestLogEntry = {
      level: reply.statusCode >= 400 ? 'error' : 'info',
      timestamp: Date.now(),
      module: 'http',
      message: `${request.method} ${request.url} ${reply.statusCode}`,
      traceId: request.traceId,
      agentId: request.agentId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: Math.round(duration * 100) / 100, // 保留2位小数
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    };
    
    logger.logStructured(logEntry);
  });

  // ============= 全局错误处理 setErrorHandler =============
  server.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const category = categorizeError(error);
    const statusCode = getStatusCodeForCategory(category);
    
    const logEntry: RequestLogEntry = {
      level: 'error',
      timestamp: Date.now(),
      module: 'error-handler',
      message: `Request failed: ${error.message}`,
      traceId: request.traceId,
      agentId: request.agentId,
      method: request.method,
      url: request.url,
      statusCode,
      error: {
        code: category,
        message: error.message,
        stack: config.logging.level === 'debug' ? error.stack : undefined,
      },
    };
    
    logger.logStructured(logEntry);
    
    return reply.status(statusCode).send({
      error: {
        code: category,
        message: error.message,
        traceId: request.traceId,
      },
    });
  });

  // ============= 注册插件 =============
  await server.register(fastifyCors, {
    origin: config.cors.origins,
    credentials: true,
  });

  await server.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  // ============= 初始化服务 =============
  const sessionManager = new SessionManager(config.session);
  const skillRegistry = new SkillRegistry();
  const llmProxy = new LLMProxy(config.llm);

  // 加载 Skills
  await skillRegistry.loadSkills(config.skills.libraryPath);
  logger.info(`Loaded ${skillRegistry.count()} skills`);

  // ============= 注册路由（带版本前缀） =============
  setupWebSocketRoutes(server, sessionManager, skillRegistry, llmProxy);
  setupSkillRoutes(server, skillRegistry);
  setupConfigRoutes(server);
  setupSessionRoutes(server, sessionManager);

  // 健康检查
  server.get('/api/v1/health', async (request) => ({
    status: 'ok',
    timestamp: Date.now(),
    traceId: request.traceId,
  }));

  return server;
}

async function start(): Promise<void> {
  try {
    const server = await buildServer();
    
    await server.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
  } catch (error) {
    logger.error('Server startup failed:', error);
    process.exit(1);
  }
}

start();
```

#### 5.2.1 结构化日志工具类

```typescript
// server/src/utils/logger.ts

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  timestamp: number;
  module: string;
  message: string;
  [key: string]: unknown;
}

export class StructuredLogger {
  private module: string;
  
  constructor(module: string) {
    this.module = module;
  }
  
  /**
   * 输出结构化日志（JSON格式）
   */
  logStructured(entry: LogEntry): void {
    const output = JSON.stringify({
      ...entry,
      module: entry.module || this.module,
    });
    
    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
  
  info(message: string, data?: Record<string, unknown>): void {
    this.logStructured({
      level: 'info',
      timestamp: Date.now(),
      module: this.module,
      message,
      ...data,
    });
  }
  
  error(message: string, error?: Error | unknown): void {
    this.logStructured({
      level: 'error',
      timestamp: Date.now(),
      module: this.module,
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : error,
    });
  }
  
  warn(message: string, data?: Record<string, unknown>): void {
    this.logStructured({
      level: 'warn',
      timestamp: Date.now(),
      module: this.module,
      message,
      ...data,
    });
  }
  
  debug(message: string, data?: Record<string, unknown>): void {
    this.logStructured({
      level: 'debug',
      timestamp: Date.now(),
      module: this.module,
      message,
      ...data,
    });
  }
}
```

### 5.3 配置管理

```typescript
// server/src/config/index.ts

import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import {z} from 'zod';

const ConfigSchema = z.object({
  server: z.object({
    port: z.number().default(3001),
    host: z.string().default('0.0.0.0'),
  }),
  cors: z.object({
    origins: z.array(z.string()).default(['http://localhost:10000']),
  }),
  llm: z.object({
    activeProvider: z.enum(['anthropic', 'openai', 'google']),
    providers: z.object({
      anthropic: z.object({
        apiKey: z.string(),
        defaultModel: z.string().default('claude-sonnet-4-20250514'),
        maxTokens: z.number().default(8192),
      }).optional(),
      openai: z.object({
        apiKey: z.string(),
        defaultModel: z.string().default('gpt-4o'),
        maxTokens: z.number().default(8192),
      }).optional(),
      google: z.object({
        apiKey: z.string(),
        defaultModel: z.string().default('gemini-2.5-pro'),
        maxTokens: z.number().default(8192),
      }).optional(),
    }),
  }),
  skills: z.object({
    libraryPath: z.string().default('./skills/library'),
  }),
  logging: z.object({
    enabled: z.boolean().default(true),
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    modules: z.record(z.enum(['debug', 'info', 'warn', 'error'])).optional(),
  }),
  features: z.object({
    l3ReviewEnabled: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const configPath = process.env.CONFIG_PATH || './config/default.yaml';
  const llmConfigPath = './config/llm_providers.yaml';
  const featuresPath = './config/feature_flags.yaml';

  const baseConfig = yaml.load(
    fs.readFileSync(path.resolve(configPath), 'utf8')
  ) as Record<string, unknown>;

  const llmConfig = yaml.load(
    fs.readFileSync(path.resolve(llmConfigPath), 'utf8')
  ) as Record<string, unknown>;

  const featuresConfig = yaml.load(
    fs.readFileSync(path.resolve(featuresPath), 'utf8')
  ) as Record<string, unknown>;

  // 合并配置
  const merged = {
    ...baseConfig,
    llm: {
      ...llmConfig,
      providers: substituteEnvVars(llmConfig.providers as Record<string, unknown>),
    },
    features: featuresConfig,
  };

  // 验证并返回
  return ConfigSchema.parse(merged);
}

function substituteEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      result[key] = process.env[envVar] || '';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = substituteEnvVars(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

export const config = loadConfig();
```

### 5.4 WebSocket 路由

```typescript
// server/src/routes/websocket.ts

import {FastifyInstance, FastifyRequest} from 'fastify';
import {WebSocket} from 'ws';
import {SessionManager} from '../services/session_manager';
import {SkillRegistry} from '../services/skill_registry';
import {LLMProxy} from '../services/llm_proxy';
import {SkillProcessor} from '../services/skill_processor';
import {StructuredLogger} from '../utils/logger';
import {
  WebSocketMessage,
  ChatRequest,
  StreamResponse,
} from '../types/protocol';

const logger = new StructuredLogger('websocket');

// ============= 连接池管理配置 =============

interface ConnectionPoolConfig {
  maxTotalConnections: number;      // 最大总连接数
  maxConnectionsPerUser: number;    // 每用户最大连接数
  heartbeatTimeout: number;         // 心跳超时（毫秒）
  heartbeatInterval: number;        // 心跳检测间隔（毫秒）
  zombieCleanupInterval: number;    // 僵尸连接清理间隔（毫秒）
  maxBufferedAmount: number;        // 背压阈值（字节）
}

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxTotalConnections: 1000,
  maxConnectionsPerUser: 5,
  heartbeatTimeout: 90000,          // 90秒超时
  heartbeatInterval: 30000,         // 30秒心跳检测
  zombieCleanupInterval: 30000,     // 30秒清理一次
  maxBufferedAmount: 1048576,       // 1MB 背压阈值
};

// ============= 连接状态机 =============

enum ConnectionState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  AUTHENTICATED = 'AUTHENTICATED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',       // 背压暂停状态
  CLOSING = 'CLOSING',
  CLOSED = 'CLOSED',
}

interface ConnectionInfo {
  socket: WebSocket;
  state: ConnectionState;
  agentId: string | null;
  userId: string | null;
  connectedAt: number;
  lastHeartbeat: number;
  lastActivity: number;
  traceId: string;
  messageQueue: PriorityMessageQueue;
  isPaused: boolean;
}

// ============= 消息优先级队列 =============

enum MessagePriority {
  HIGH = 0,      // error
  MEDIUM = 1,    // tool_result
  LOW = 2,       // text_delta
}

interface QueuedMessage {
  priority: MessagePriority;
  message: StreamResponse;
  timestamp: number;
}

class PriorityMessageQueue {
  private queue: QueuedMessage[] = [];
  
  enqueue(message: StreamResponse): void {
    const priority = this.getPriority(message);
    const queuedMessage: QueuedMessage = {
      priority,
      message,
      timestamp: Date.now(),
    };
    
    // 按优先级插入
    const insertIndex = this.queue.findIndex(m => m.priority > priority);
    if (insertIndex === -1) {
      this.queue.push(queuedMessage);
    } else {
      this.queue.splice(insertIndex, 0, queuedMessage);
    }
  }
  
  dequeue(): StreamResponse | undefined {
    const item = this.queue.shift();
    return item?.message;
  }
  
  isEmpty(): boolean {
    return this.queue.length === 0;
  }
  
  size(): number {
    return this.queue.length;
  }
  
  private getPriority(message: StreamResponse): MessagePriority {
    switch (message.type) {
      case 'error':
        return MessagePriority.HIGH;
      case 'tool_result':
      case 'skill_result':
        return MessagePriority.MEDIUM;
      default:
        return MessagePriority.LOW;
    }
  }
}

// ============= 连接池管理器 =============

class ConnectionPool {
  private connections: Map<string, ConnectionInfo> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private config: ConnectionPoolConfig;
  private heartbeatTimer: NodeJS.Timer | null = null;
  private cleanupTimer: NodeJS.Timer | null = null;
  
  constructor(config: ConnectionPoolConfig = DEFAULT_POOL_CONFIG) {
    this.config = config;
    this.startHeartbeatChecker();
    this.startZombieCleanup();
  }
  
  /**
   * 注册新连接
   */
  register(
    connectionId: string,
    socket: WebSocket,
    traceId: string
  ): {success: boolean; error?: string} {
    // 检查总连接数限制
    if (this.connections.size >= this.config.maxTotalConnections) {
      return {success: false, error: 'Connection pool exhausted'};
    }
    
    const now = Date.now();
    const info: ConnectionInfo = {
      socket,
      state: ConnectionState.CONNECTED,
      agentId: null,
      userId: null,
      connectedAt: now,
      lastHeartbeat: now,
      lastActivity: now,
      traceId,
      messageQueue: new PriorityMessageQueue(),
      isPaused: false,
    };
    
    this.connections.set(connectionId, info);
    return {success: true};
  }
  
  /**
   * 认证连接（设置 userId）
   */
  authenticate(connectionId: string, userId: string, agentId: string): boolean {
    const info = this.connections.get(connectionId);
    if (!info) return false;
    
    // 检查每用户连接限制
    const userConns = this.userConnections.get(userId) || new Set();
    if (userConns.size >= this.config.maxConnectionsPerUser) {
      logger.warn(`User ${userId} exceeded max connections limit`);
      return false;
    }
    
    info.userId = userId;
    info.agentId = agentId;
    info.state = ConnectionState.AUTHENTICATED;
    
    userConns.add(connectionId);
    this.userConnections.set(userId, userConns);
    
    return true;
  }
  
  /**
   * 更新心跳时间
   */
  updateHeartbeat(connectionId: string): void {
    const info = this.connections.get(connectionId);
    if (info) {
      info.lastHeartbeat = Date.now();
      info.lastActivity = Date.now();
    }
  }
  
  /**
   * 获取连接信息
   */
  get(connectionId: string): ConnectionInfo | undefined {
    return this.connections.get(connectionId);
  }
  
  /**
   * 移除连接
   */
  remove(connectionId: string): void {
    const info = this.connections.get(connectionId);
    if (info) {
      info.state = ConnectionState.CLOSED;
      
      if (info.userId) {
        const userConns = this.userConnections.get(info.userId);
        if (userConns) {
          userConns.delete(connectionId);
          if (userConns.size === 0) {
            this.userConnections.delete(info.userId);
          }
        }
      }
      
      this.connections.delete(connectionId);
    }
  }
  
  /**
   * 发送消息（带背压处理）
   */
  async sendMessage(connectionId: string, message: StreamResponse): Promise<boolean> {
    const info = this.connections.get(connectionId);
    if (!info || info.state === ConnectionState.CLOSED) {
      return false;
    }
    
    // 检查背压
    if (info.socket.bufferedAmount > this.config.maxBufferedAmount) {
      if (!info.isPaused) {
        info.isPaused = true;
        info.state = ConnectionState.PAUSED;
        logger.warn(`Connection ${connectionId} paused due to backpressure`, {
          bufferedAmount: info.socket.bufferedAmount,
          traceId: info.traceId,
        });
      }
      
      // 加入优先级队列
      info.messageQueue.enqueue(message);
      return true;
    }
    
    // 如果之前暂停了，恢复并清空队列
    if (info.isPaused) {
      info.isPaused = false;
      info.state = ConnectionState.ACTIVE;
      await this.flushMessageQueue(connectionId);
    }
    
    // 发送消息
    try {
      info.socket.send(JSON.stringify(message));
      info.lastActivity = Date.now();
      return true;
    } catch (error) {
      logger.error(`Failed to send message to ${connectionId}`, {error, traceId: info.traceId});
      return false;
    }
  }
  
  /**
   * 清空消息队列
   */
  private async flushMessageQueue(connectionId: string): Promise<void> {
    const info = this.connections.get(connectionId);
    if (!info) return;
    
    while (!info.messageQueue.isEmpty() && !info.isPaused) {
      const message = info.messageQueue.dequeue();
      if (message) {
        // 检查是否需要再次暂停
        if (info.socket.bufferedAmount > this.config.maxBufferedAmount) {
          info.isPaused = true;
          info.state = ConnectionState.PAUSED;
          info.messageQueue.enqueue(message); // 放回队列
          break;
        }
        
        info.socket.send(JSON.stringify(message));
        info.lastActivity = Date.now();
      }
    }
  }
  
  /**
   * 心跳超时检测
   */
  private startHeartbeatChecker(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatTimeout;
      
      for (const [connectionId, info] of this.connections) {
        if (now - info.lastHeartbeat > timeout) {
          logger.warn(`Connection ${connectionId} heartbeat timeout`, {
            lastHeartbeat: info.lastHeartbeat,
            traceId: info.traceId,
          });
          
          // 关闭超时连接
          info.state = ConnectionState.CLOSING;
          info.socket.close(1001, 'Heartbeat timeout');
          this.remove(connectionId);
        }
      }
    }, this.config.heartbeatInterval);
  }
  
  /**
   * 僵尸连接定期清理
   */
  private startZombieCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const zombieConnections: string[] = [];
      
      for (const [connectionId, info] of this.connections) {
        // 检查 WebSocket 状态
        if (info.socket.readyState === WebSocket.CLOSED ||
            info.socket.readyState === WebSocket.CLOSING) {
          zombieConnections.push(connectionId);
          continue;
        }
        
        // 检查是否长时间无活动（5分钟）
        const inactiveTimeout = 5 * 60 * 1000;
        if (Date.now() - info.lastActivity > inactiveTimeout) {
          zombieConnections.push(connectionId);
        }
      }
      
      if (zombieConnections.length > 0) {
        logger.info(`Cleaning up ${zombieConnections.length} zombie connections`);
        for (const connectionId of zombieConnections) {
          this.remove(connectionId);
        }
      }
    }, this.config.zombieCleanupInterval);
  }
  
  /**
   * 关闭连接池
   */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    for (const [connectionId, info] of this.connections) {
      info.socket.close(1001, 'Server shutdown');
      this.remove(connectionId);
    }
  }
  
  /**
   * 获取连接池统计信息
   */
  getStats(): {total: number; byState: Record<ConnectionState, number>} {
    const byState: Record<string, number> = {};
    
    for (const info of this.connections.values()) {
      byState[info.state] = (byState[info.state] || 0) + 1;
    }
    
    return {
      total: this.connections.size,
      byState: byState as Record<ConnectionState, number>,
    };
  }
}

// ============= WebSocket 路由设置 =============

// 全局连接池实例
const connectionPool = new ConnectionPool();

export function setupWebSocketRoutes(
  server: FastifyInstance,
  sessionManager: SessionManager,
  skillRegistry: SkillRegistry,
  llmProxy: LLMProxy
): void {
  const skillProcessor = new SkillProcessor(skillRegistry);

  server.get('/ws', {websocket: true}, (socket: WebSocket, req: FastifyRequest) => {
    const connectionId = (req as any).traceId || `conn_${Date.now()}`;
    const traceId = (req as any).traceId || connectionId;
    
    // 注册连接
    const registerResult = connectionPool.register(connectionId, socket, traceId);
    if (!registerResult.success) {
      logger.error('Connection registration failed', {error: registerResult.error, traceId});
      socket.close(1013, registerResult.error);
      return;
    }

    logger.info('New WebSocket connection', {connectionId, traceId});

    socket.on('message', async (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        
        // 更新活动时间
        connectionPool.updateHeartbeat(connectionId);
        
        switch (message.type) {
          case 'chat':
            await handleChatMessage(
              connectionId,
              message as ChatRequest,
              sessionManager,
              skillProcessor,
              llmProxy,
              traceId
            );
            break;
            
          case 'skill_invoke':
            await handleSkillInvoke(connectionId, message, skillProcessor, traceId);
            break;
            
          case 'ping':
            connectionPool.updateHeartbeat(connectionId);
            await connectionPool.sendMessage(connectionId, {type: 'pong'});
            break;
            
          default:
            await sendError(connectionId, 'Unknown message type', traceId);
        }
      } catch (error) {
        logger.error('WebSocket message error', {error, connectionId, traceId});
        await sendError(
          connectionId, 
          error instanceof Error ? error.message : 'Unknown error',
          traceId
        );
      }
    });

    socket.on('close', (code, reason) => {
      const info = connectionPool.get(connectionId);
      if (info?.agentId) {
        sessionManager.endSession(info.agentId);
      }
      connectionPool.remove(connectionId);
      logger.info('WebSocket connection closed', {connectionId, code, reason: reason.toString(), traceId});
    });

    socket.on('error', (error) => {
      logger.error('WebSocket error', {error, connectionId, traceId});
    });
  });
}

async function handleChatMessage(
  connectionId: string,
  request: ChatRequest,
  sessionManager: SessionManager,
  skillProcessor: SkillProcessor,
  llmProxy: LLMProxy,
  traceId: string
): Promise<void> {
  const {agentId, payload} = request;
  const {messages, tools, systemPrompt, stream} = payload;

  // 认证连接
  const info = connectionPool.get(connectionId);
  if (info && !info.agentId) {
    connectionPool.authenticate(connectionId, 'default_user', agentId);
  }

  // 确保会话存在
  let session = sessionManager.getSession(agentId);
  if (!session) {
    session = sessionManager.createSession(agentId);
  }

  // 处理 Skill 标记
  const processedPrompt = await skillProcessor.processSkillMarkers(systemPrompt);
  
  // 构建 LLM 请求
  const llmRequest = {
    systemPrompt: processedPrompt,
    messages,
    tools,
    stream: true,
    traceId,
  };

  // 流式调用 LLM
  try {
    for await (const chunk of llmProxy.streamChat(llmRequest)) {
      const response: StreamResponse = {
        type: chunk.type,
        data: chunk.data,
        traceId, // 添加 traceId 到消息中
      };
      
      const sent = await connectionPool.sendMessage(connectionId, response);
      if (!sent) {
        logger.warn('Failed to send chunk, connection may be closed', {connectionId, traceId});
        break;
      }
    }
    
    // 发送完成信号
    await connectionPool.sendMessage(connectionId, {type: 'done', traceId});
    
  } catch (error) {
    await sendError(
      connectionId,
      error instanceof Error ? error.message : 'LLM call failed',
      traceId
    );
  }
}

async function handleSkillInvoke(
  connectionId: string,
  message: WebSocketMessage,
  skillProcessor: SkillProcessor,
  traceId: string
): Promise<void> {
  const {skillId, params} = message.payload as {skillId: string; params: Record<string, unknown>};
  
  try {
    const result = await skillProcessor.executeSkill(skillId, params);
    await connectionPool.sendMessage(connectionId, {
      type: 'skill_result',
      data: result,
      traceId,
    });
  } catch (error) {
    await sendError(
      connectionId,
      error instanceof Error ? error.message : 'Skill execution failed',
      traceId
    );
  }
}

async function sendError(connectionId: string, message: string, traceId: string): Promise<void> {
  await connectionPool.sendMessage(connectionId, {
    type: 'error',
    data: {message, traceId},
    traceId,
  });
}

// 导出连接池统计接口
export function getWebSocketStats(): {total: number; byState: Record<ConnectionState, number>} {
  return connectionPool.getStats();
}
```

### 5.5 LLM Proxy

```typescript
// server/src/services/llm_proxy.ts

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {createHash} from 'crypto';
import {Config} from '../config';
import {StructuredLogger} from '../utils/logger';

const logger = new StructuredLogger('llm_proxy');

// ============= 接口定义 =============

export interface LLMRequest {
  systemPrompt: string;
  messages: Array<{role: string; content: string}>;
  tools: Array<{name: string; description: string; inputSchema: unknown}>;
  stream: boolean;
  traceId?: string; // 请求追踪ID
}

export interface LLMStreamChunk {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'error';
  data: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  timestamp: number;
}

// ============= 熔断器模式 =============

enum CircuitState {
  CLOSED = 'CLOSED',     // 正常状态
  OPEN = 'OPEN',         // 熔断状态（拒绝请求）
  HALF_OPEN = 'HALF_OPEN' // 半开状态（允许探测）
}

interface CircuitBreakerConfig {
  failureThreshold: number;    // 失败次数阈值
  recoveryTimeout: number;     // 恢复超时（毫秒）
  halfOpenMaxAttempts: number; // 半开状态最大尝试次数
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  
  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeout: 30000, // 30秒
      halfOpenMaxAttempts: 3,
    }
  ) {}
  
  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.state === CircuitState.OPEN) {
      // 检查是否超过恢复超时，转为半开状态
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenAttempts = 0;
        logger.info(`Circuit breaker ${this.name} transitioned to HALF_OPEN`);
        return true;
      }
      return false;
    }
    
    // HALF_OPEN 状态
    return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;
  }
  
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      logger.info(`Circuit breaker ${this.name} transitioned to CLOSED`);
    }
    this.failureCount = 0;
  }
  
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.state = CircuitState.OPEN;
        logger.warn(`Circuit breaker ${this.name} transitioned to OPEN after half-open failures`);
      }
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn(`Circuit breaker ${this.name} transitioned to OPEN`);
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
}

// ============= 速率限制器 =============

interface RateLimiterConfig {
  rpm: number;  // 每分钟请求数
  tpm: number;  // 每分钟Token数
}

class RateLimiter {
  private requestTimestamps: number[] = [];
  private tokenCounts: Array<{timestamp: number; tokens: number}> = [];
  
  constructor(private readonly config: RateLimiterConfig) {}
  
  canMakeRequest(): {allowed: boolean; retryAfterMs?: number} {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // 清理过期记录
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    this.tokenCounts = this.tokenCounts.filter(t => t.timestamp > oneMinuteAgo);
    
    // 检查 RPM
    if (this.requestTimestamps.length >= this.config.rpm) {
      const oldestRequest = this.requestTimestamps[0];
      return {allowed: false, retryAfterMs: oldestRequest + 60000 - now};
    }
    
    // 检查 TPM
    const totalTokens = this.tokenCounts.reduce((sum, t) => sum + t.tokens, 0);
    if (totalTokens >= this.config.tpm) {
      const oldestToken = this.tokenCounts[0];
      return {allowed: false, retryAfterMs: oldestToken.timestamp + 60000 - now};
    }
    
    return {allowed: true};
  }
  
  recordRequest(tokenCount: number): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.tokenCounts.push({timestamp: now, tokens: tokenCount});
  }
}

// ============= Token计量器 =============

interface UserQuota {
  userId: string;
  dailyLimit: number;
  usedToday: number;
  lastResetDate: string;
}

class TokenMeter {
  private usageHistory: TokenUsage[] = [];
  private userQuotas: Map<string, UserQuota> = new Map();
  
  recordUsage(usage: TokenUsage): void {
    this.usageHistory.push(usage);
    
    // 保留最近24小时的记录
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.usageHistory = this.usageHistory.filter(u => u.timestamp > oneDayAgo);
  }
  
  checkUserQuota(userId: string, estimatedTokens: number): {allowed: boolean; remaining?: number} {
    const quota = this.userQuotas.get(userId);
    if (!quota) {
      return {allowed: true}; // 无配额限制
    }
    
    // 检查日期是否需要重置
    const today = new Date().toISOString().split('T')[0];
    if (quota.lastResetDate !== today) {
      quota.usedToday = 0;
      quota.lastResetDate = today;
    }
    
    if (quota.usedToday + estimatedTokens > quota.dailyLimit) {
      return {allowed: false, remaining: quota.dailyLimit - quota.usedToday};
    }
    
    return {allowed: true, remaining: quota.dailyLimit - quota.usedToday};
  }
  
  updateUserUsage(userId: string, tokens: number): void {
    const quota = this.userQuotas.get(userId);
    if (quota) {
      quota.usedToday += tokens;
    }
  }
  
  setUserQuota(userId: string, dailyLimit: number): void {
    const today = new Date().toISOString().split('T')[0];
    this.userQuotas.set(userId, {
      userId,
      dailyLimit,
      usedToday: 0,
      lastResetDate: today,
    });
  }
  
  getUsageStats(): {total: number; byProvider: Record<string, number>} {
    const byProvider: Record<string, number> = {};
    let total = 0;
    
    for (const usage of this.usageHistory) {
      total += usage.inputTokens + usage.outputTokens;
      byProvider[usage.provider] = (byProvider[usage.provider] || 0) + 
        usage.inputTokens + usage.outputTokens;
    }
    
    return {total, byProvider};
  }
}

// ============= 请求缓存 =============

interface CacheEntry {
  response: LLMStreamChunk[];
  timestamp: number;
  ttl: number;
}

class RequestCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly defaultTtl = 60000; // 1分钟
  
  private generateKey(request: LLMRequest): string {
    const content = JSON.stringify({
      systemPrompt: request.systemPrompt,
      messages: request.messages,
      tools: request.tools.map(t => t.name),
    });
    return createHash('sha256').update(content).digest('hex');
  }
  
  get(request: LLMRequest): LLMStreamChunk[] | null {
    const key = this.generateKey(request);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.response;
  }
  
  set(request: LLMRequest, response: LLMStreamChunk[], ttl?: number): void {
    const key = this.generateKey(request);
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// ============= LLM Proxy 主类 =============

type ProviderName = 'anthropic' | 'openai' | 'google';

export class LLMProxy {
  private config: Config['llm'];
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  
  // 保护机制
  private circuitBreakers: Map<ProviderName, CircuitBreaker> = new Map();
  private rateLimiters: Map<ProviderName, RateLimiter> = new Map();
  private tokenMeter: TokenMeter;
  private requestCache: RequestCache;
  
  // 重试配置
  private readonly retryConfig = {
    maxAttempts: 3,
    baseDelayMs: 1000, // 1秒
    maxDelayMs: 8000,  // 最大8秒
  };

  constructor(config: Config['llm']) {
    this.config = config;
    this.initializeClients();
    this.initializeProtection();
    this.tokenMeter = new TokenMeter();
    this.requestCache = new RequestCache();
  }

  private initializeClients(): void {
    const providers = this.config.providers;
    
    if (providers.anthropic?.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: providers.anthropic.apiKey,
      });
    }
    
    if (providers.openai?.apiKey) {
      this.openai = new OpenAI({
        apiKey: providers.openai.apiKey,
      });
    }
  }
  
  private initializeProtection(): void {
    // 为每个 Provider 创建熔断器和速率限制器
    const providerNames: ProviderName[] = ['anthropic', 'openai', 'google'];
    
    for (const name of providerNames) {
      this.circuitBreakers.set(name, new CircuitBreaker(name));
      this.rateLimiters.set(name, new RateLimiter({
        rpm: 60,    // 每分钟60请求
        tpm: 100000, // 每分钟10万Token
      }));
    }
  }
  
  /**
   * 指数退避重试逻辑
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    provider: ProviderName
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        this.circuitBreakers.get(provider)?.recordSuccess();
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // 检查是否为不可重试错误
        if (this.isNonRetryableError(error)) {
          throw error;
        }
        
        if (attempt < this.retryConfig.maxAttempts) {
          // 指数退避：1s, 2s, 4s
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
            this.retryConfig.maxDelayMs
          );
          logger.warn(`Retry attempt ${attempt}/${this.retryConfig.maxAttempts} for ${provider}, waiting ${delay}ms`);
          await this.sleep(delay);
        }
      }
    }
    
    // 所有重试失败，记录熔断器失败
    this.circuitBreakers.get(provider)?.recordFailure();
    throw lastError;
  }
  
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // 认证错误、参数错误不应重试
      return message.includes('invalid api key') ||
             message.includes('authentication') ||
             message.includes('invalid_request');
    }
    return false;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 获取可用的 Provider（支持故障转移）
   */
  private getAvailableProvider(): ProviderName {
    const failoverOrder: ProviderName[] = this.config.failover?.order || 
      [this.config.activeProvider as ProviderName];
    
    for (const provider of failoverOrder) {
      const circuitBreaker = this.circuitBreakers.get(provider);
      const rateLimiter = this.rateLimiters.get(provider);
      
      // 检查熔断器状态
      if (circuitBreaker && !circuitBreaker.canExecute()) {
        logger.warn(`Provider ${provider} circuit breaker is OPEN, skipping`);
        continue;
      }
      
      // 检查速率限制
      if (rateLimiter) {
        const {allowed} = rateLimiter.canMakeRequest();
        if (!allowed) {
          logger.warn(`Provider ${provider} rate limited, skipping`);
          continue;
        }
      }
      
      // 检查是否有对应的客户端
      if (provider === 'anthropic' && this.anthropic) return provider;
      if (provider === 'openai' && this.openai) return provider;
      if (provider === 'google') return provider; // Google 待实现
    }
    
    throw new Error('No available LLM provider');
  }

  async *streamChat(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    // 1. 检查缓存
    const cachedResponse = this.requestCache.get(request);
    if (cachedResponse) {
      logger.debug('Cache hit for LLM request');
      for (const chunk of cachedResponse) {
        yield chunk;
      }
      return;
    }
    
    // 2. 获取可用 Provider（自动故障转移）
    const provider = this.getAvailableProvider();
    
    // 3. 检查速率限制
    const rateLimiter = this.rateLimiters.get(provider);
    if (rateLimiter) {
      const {allowed, retryAfterMs} = rateLimiter.canMakeRequest();
      if (!allowed) {
        yield {
          type: 'error',
          data: {
            code: 'RATE_LIMITED',
            message: `Rate limited. Retry after ${retryAfterMs}ms`,
            retryAfterMs,
          },
        };
        return;
      }
    }
    
    // 4. 执行请求（带重试和熔断）
    const chunks: LLMStreamChunk[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    
    try {
      const streamGenerator = await this.withRetry(async () => {
        switch (provider) {
          case 'anthropic':
            return this.streamAnthropic(request);
          case 'openai':
            return this.streamOpenAI(request);
          case 'google':
            return this.streamGoogle(request);
          default:
            throw new Error(`Unknown provider: ${provider}`);
        }
      }, provider);
      
      for await (const chunk of streamGenerator) {
        chunks.push(chunk);
        yield chunk;
        
        // 估算 token 消耗
        if (chunk.type === 'text_delta' && typeof chunk.data === 'string') {
          outputTokens += Math.ceil(chunk.data.length / 4); // 粗略估算
        }
      }
      
      // 5. 记录 Token 使用
      inputTokens = this.estimateInputTokens(request);
      rateLimiter?.recordRequest(inputTokens + outputTokens);
      
      this.tokenMeter.recordUsage({
        inputTokens,
        outputTokens,
        provider,
        model: this.getModelForProvider(provider),
        timestamp: Date.now(),
      });
      
      // 6. 缓存响应（非流式部分）
      if (chunks.length > 0) {
        this.requestCache.set(request, chunks);
      }
      
    } catch (error) {
      logger.error(`LLM request failed for ${provider}`, error);
      yield {
        type: 'error',
        data: {
          code: 'LLM_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          provider,
        },
      };
    }
  }
  
  private estimateInputTokens(request: LLMRequest): number {
    const text = request.systemPrompt + 
      request.messages.map(m => m.content).join(' ') +
      JSON.stringify(request.tools);
    return Math.ceil(text.length / 4);
  }
  
  private getModelForProvider(provider: ProviderName): string {
    switch (provider) {
      case 'anthropic':
        return this.config.providers.anthropic?.defaultModel || 'claude-sonnet-4-20250514';
      case 'openai':
        return this.config.providers.openai?.defaultModel || 'gpt-4o';
      case 'google':
        return this.config.providers.google?.defaultModel || 'gemini-2.5-pro';
      default:
        return 'unknown';
    }
  }

  private async *streamAnthropic(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const config = this.config.providers.anthropic!;

    const stream = await this.anthropic.messages.create({
      model: config.defaultModel,
      max_tokens: config.maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if ('text' in delta) {
          yield {type: 'text_delta', data: delta.text};
        }
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_use',
            data: {
              id: block.id,
              name: block.name,
            },
          };
        }
      }
    }
  }

  private async *streamOpenAI(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const config = this.config.providers.openai!;

    const stream = await this.openai.chat.completions.create({
      model: config.defaultModel,
      max_tokens: config.maxTokens,
      messages: [
        {role: 'system', content: request.systemPrompt},
        ...request.messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
      tools: request.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      
      if (delta?.content) {
        yield {type: 'text_delta', data: delta.content};
      }
      
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          yield {
            type: 'tool_use',
            data: {
              id: toolCall.id,
              name: toolCall.function?.name,
              arguments: toolCall.function?.arguments,
            },
          };
        }
      }
    }
  }

  private async *streamGoogle(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    // Google Gemini 实现
    // 使用 @google/generative-ai SDK
    throw new Error('Google provider not yet implemented');
  }
  
  // ============= 公开方法 =============
  
  getTokenUsageStats(): {total: number; byProvider: Record<string, number>} {
    return this.tokenMeter.getUsageStats();
  }
  
  setUserTokenQuota(userId: string, dailyLimit: number): void {
    this.tokenMeter.setUserQuota(userId, dailyLimit);
  }
  
  getCircuitBreakerStates(): Record<ProviderName, CircuitState> {
    const states: Record<string, CircuitState> = {};
    for (const [name, breaker] of this.circuitBreakers) {
      states[name] = breaker.getState();
    }
    return states as Record<ProviderName, CircuitState>;
  }
}
```

### 5.6 Skill处理器

```typescript
// server/src/services/skill_processor.ts

import {SkillRegistry, SkillDefinition} from './skill_registry';
import {ArtifactData} from '../types/shared';
import {StructuredLogger} from '../utils/logger';
import {SqlSanitizer, ParameterizedQuery, ValidationResult} from '../utils/sql_sanitizer';

const logger = new StructuredLogger('skill_processor');

// ============= 参数化查询接口 =============

export interface ParameterBinding {
  name: string;
  value: unknown;
  type: 'string' | 'integer' | 'float' | 'boolean';
}

export interface SafeQuery {
  sql: string;
  bindings: ParameterBinding[];
  originalParams: Record<string, unknown>;
}

export interface SkillExecutionResult {
  success: boolean;
  data?: ArtifactData;
  query?: SafeQuery; // 改为返回安全查询对象
  skillDescription?: string;
  error?: string;
  validationErrors?: string[];
}

// ============= 参数验证规则 =============

interface ParamValidationRule {
  type: 'string' | 'integer' | 'float' | 'boolean';
  required?: boolean;
  // 字符串验证
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  // 数字验证
  min?: number;
  max?: number;
  // 枚举验证
  allowedValues?: Array<string | number>;
}

const DEFAULT_VALIDATION_RULES: Record<string, ParamValidationRule> = {
  process_name: {
    type: 'string',
    maxLength: 256,
    minLength: 1,
    pattern: /^[a-zA-Z0-9._\-:]+$/,
  },
  time_range_start: {
    type: 'integer',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
  time_range_end: {
    type: 'integer',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
  frame_id: {
    type: 'integer',
    min: 0,
  },
  limit: {
    type: 'integer',
    min: 1,
    max: 10000,
  },
  thread_id: {
    type: 'integer',
    min: 0,
  },
  upid: {
    type: 'integer',
    min: 0,
  },
  utid: {
    type: 'integer',
    min: 0,
  },
};

export class SkillProcessor {
  private registry: SkillRegistry;
  private sanitizer: SqlSanitizer;
  
  // Skill 标记正则
  private static readonly SKILL_MARKER_REGEX = /skill:([a-z_]+)\|(\{[^}]*\})/g;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
    this.sanitizer = new SqlSanitizer();
  }

  /**
   * 处理系统提示中的 Skill 标记（安全版本）
   */
  async processSkillMarkers(systemPrompt: string): Promise<string> {
    let processed = systemPrompt;
    const matches = systemPrompt.matchAll(SkillProcessor.SKILL_MARKER_REGEX);

    for (const match of matches) {
      const [fullMatch, skillId, paramsJson] = match;
      
      try {
        const params = JSON.parse(paramsJson);
        const skill = this.registry.get(skillId);
        
        if (skill) {
          // 验证参数安全性
          const validation = this.validateAndSanitizeParams(skill, params);
          if (!validation.isValid) {
            logger.warn(`Skill marker validation failed: ${skillId}`, {
              errors: validation.errors,
            });
            continue;
          }
          
          // 将 Skill 内容注入到提示中（使用安全参数）
          const skillContent = this.formatSkillForPrompt(skill, validation.sanitizedParams!);
          processed = processed.replace(fullMatch, skillContent);
        }
      } catch (error) {
        logger.warn(`Failed to process skill marker: ${fullMatch}`, {error});
      }
    }

    return processed;
  }

  /**
   * 执行 Skill（安全版本）
   */
  async executeSkill(
    skillId: string, 
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    const skill = this.registry.get(skillId);
    
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    try {
      // 1. 验证并清理参数
      const validation = this.validateAndSanitizeParams(skill, params);
      if (!validation.isValid) {
        return {
          success: false,
          error: 'Parameter validation failed',
          validationErrors: validation.errors,
        };
      }
      
      // 2. 根据 Skill 类型执行
      switch (skill.type) {
        case 'atomic':
          return await this.executeAtomicSkill(skill, validation.sanitizedParams!);
        case 'composite':
          return await this.executeCompositeSkill(skill, validation.sanitizedParams!);
        case 'pipeline':
          return await this.executePipelineSkill(skill, validation.sanitizedParams!);
        case 'module':
          return await this.executeModuleSkill(skill, validation.sanitizedParams!);
        case 'deep':
          return await this.executeDeepSkill(skill, validation.sanitizedParams!);
        default:
          return {
            success: false,
            error: `Unknown skill type: ${skill.type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 参数验证与清理
   */
  private validateAndSanitizeParams(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): ValidationResult {
    const errors: string[] = [];
    const sanitizedParams: Record<string, unknown> = {};
    
    // 检查必需参数
    for (const paramDef of skill.params) {
      const value = params[paramDef.name];
      
      if (paramDef.required && (value === undefined || value === null)) {
        errors.push(`Missing required parameter: ${paramDef.name}`);
        continue;
      }
      
      if (value === undefined || value === null) {
        // 使用默认值
        if (paramDef.default !== undefined) {
          sanitizedParams[paramDef.name] = paramDef.default;
        }
        continue;
      }
      
      // 获取验证规则
      const rule = DEFAULT_VALIDATION_RULES[paramDef.name] || {type: paramDef.type};
      
      // 类型检查与清理
      const sanitized = this.sanitizeValue(value, rule, paramDef.name);
      if (sanitized.error) {
        errors.push(sanitized.error);
      } else {
        sanitizedParams[paramDef.name] = sanitized.value;
      }
    }
    
    // 检查是否有未定义的额外参数（防止注入）
    const definedParamNames = new Set(skill.params.map(p => p.name));
    for (const key of Object.keys(params)) {
      if (!definedParamNames.has(key)) {
        errors.push(`Unknown parameter: ${key}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitizedParams: errors.length === 0 ? sanitizedParams : undefined,
    };
  }
  
  /**
   * 单个值的类型检查与清理
   */
  private sanitizeValue(
    value: unknown,
    rule: ParamValidationRule,
    paramName: string
  ): {value?: unknown; error?: string} {
    // 类型检查
    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') {
          return {error: `${paramName} must be a string`};
        }
        // 长度检查
        if (rule.maxLength && value.length > rule.maxLength) {
          return {error: `${paramName} exceeds max length ${rule.maxLength}`};
        }
        if (rule.minLength && value.length < rule.minLength) {
          return {error: `${paramName} below min length ${rule.minLength}`};
        }
        // 模式检查
        if (rule.pattern && !rule.pattern.test(value)) {
          return {error: `${paramName} contains invalid characters`};
        }
        // 枚举检查
        if (rule.allowedValues && !rule.allowedValues.includes(value)) {
          return {error: `${paramName} must be one of: ${rule.allowedValues.join(', ')}`};
        }
        // 清理危险字符
        return {value: this.sanitizer.sanitizeString(value)};
        
      case 'integer':
        const intVal = typeof value === 'number' ? value : parseInt(String(value), 10);
        if (!Number.isInteger(intVal) || isNaN(intVal)) {
          return {error: `${paramName} must be an integer`};
        }
        if (rule.min !== undefined && intVal < rule.min) {
          return {error: `${paramName} must be >= ${rule.min}`};
        }
        if (rule.max !== undefined && intVal > rule.max) {
          return {error: `${paramName} must be <= ${rule.max}`};
        }
        return {value: intVal};
        
      case 'float':
        const floatVal = typeof value === 'number' ? value : parseFloat(String(value));
        if (isNaN(floatVal)) {
          return {error: `${paramName} must be a number`};
        }
        if (rule.min !== undefined && floatVal < rule.min) {
          return {error: `${paramName} must be >= ${rule.min}`};
        }
        if (rule.max !== undefined && floatVal > rule.max) {
          return {error: `${paramName} must be <= ${rule.max}`};
        }
        return {value: floatVal};
        
      case 'boolean':
        if (typeof value === 'boolean') {
          return {value};
        }
        if (value === 'true' || value === '1') {
          return {value: true};
        }
        if (value === 'false' || value === '0') {
          return {value: false};
        }
        return {error: `${paramName} must be a boolean`};
        
      default:
        return {error: `Unknown type for ${paramName}`};
    }
  }

  private formatSkillForPrompt(skill: SkillDefinition, params: Record<string, unknown>): string {
    return `
[Skill: ${skill.name}]
Category: ${skill.category}
Description: ${skill.description}

SQL Template (use parameterized query):
\`\`\`sql
${skill.sql}
\`\`\`

Safe Parameters: ${JSON.stringify(params)}
`;
  }

  /**
   * 执行原子 Skill（参数化查询版本）
   */
  private async executeAtomicSkill(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // 构建参数化查询
    const safeQuery = this.buildParameterizedQuery(skill.sql, params, skill.params);

    // 注意：实际 SQL 执行需要在前端通过 trace.engine.query() 完成
    // 这里只返回安全的参数化查询
    return {
      success: true,
      query: safeQuery,
      skillDescription: skill.description,
      data: {
        columns: skill.outputSchema?.columns || [],
        rows: [],
        totalRowCount: 0,
      },
    };
  }
  
  /**
   * 构建参数化查询（安全的SQL生成）
   */
  private buildParameterizedQuery(
    sqlTemplate: string,
    params: Record<string, unknown>,
    paramDefs: SkillDefinition['params']
  ): SafeQuery {
    const bindings: ParameterBinding[] = [];
    let sql = sqlTemplate;
    
    // 使用安全的条件构建器处理条件SQL
    sql = this.processConditionalSql(sql, params);
    
    // 替换参数占位符为安全绑定
    for (const paramDef of paramDefs) {
      const value = params[paramDef.name];
      if (value === undefined) continue;
      
      const placeholder = `\${${paramDef.name}}`;
      const bindingPlaceholder = `$${bindings.length + 1}`;
      
      // 对于 LIKE 操作，需要特殊处理
      if (sql.includes(`LIKE '%${placeholder}%'`)) {
        sql = sql.replace(
          `LIKE '%${placeholder}%'`,
          `LIKE '%' || ${bindingPlaceholder} || '%'`
        );
      } else {
        sql = sql.replace(new RegExp(placeholder.replace('$', '\\$'), 'g'), bindingPlaceholder);
      }
      
      bindings.push({
        name: paramDef.name,
        value,
        type: paramDef.type,
      });
    }
    
    return {
      sql,
      bindings,
      originalParams: params,
    };
  }
  
  /**
   * 安全的条件SQL构建器
   */
  private processConditionalSql(sql: string, params: Record<string, unknown>): string {
    // 处理形如 ${condition ? "SQL" : ""} 的条件表达式
    // 将其转换为安全的条件构建
    const conditionalPattern = /\$\{(\w+)\s*\?\s*"([^"]+)"\s*:\s*"([^"]*)"\}/g;
    
    return sql.replace(conditionalPattern, (match, paramName, trueClause, falseClause) => {
      const value = params[paramName];
      
      // 验证条件SQL不包含危险内容
      if (!this.sanitizer.isConditionSafe(trueClause) || 
          !this.sanitizer.isConditionSafe(falseClause)) {
        logger.warn(`Unsafe conditional SQL detected: ${match}`);
        return ''; // 移除不安全的条件
      }
      
      // 只有当参数存在且有效时才包含条件
      if (value !== undefined && value !== null && value !== '') {
        return trueClause;
      }
      return falseClause;
    });
  }

  private async executeCompositeSkill(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // 组合 Skill 由多个步骤组成
    // 返回步骤列表供前端依次执行
    return {
      success: true,
      skillDescription: skill.description,
      data: {
        columns: [
          {name: 'step_id', type: 'string'},
          {name: 'skill_id', type: 'string'},
          {name: 'params', type: 'string'},
        ],
        rows: skill.steps?.map(step => [
          step.id,
          step.skill,
          JSON.stringify(step.params),
        ]) || [],
        totalRowCount: skill.steps?.length || 0,
      },
    };
  }

  private async executePipelineSkill(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // Pipeline Skill 详细实现见 6.2.3 节
    return this.executeCompositeSkill(skill, params);
  }
  
  private async executeModuleSkill(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // Module Skill 详细实现见 6.2.4 节
    return {
      success: true,
      skillDescription: skill.description,
      data: {
        columns: [{name: 'module_config', type: 'string'}],
        rows: [[JSON.stringify(skill)]],
        totalRowCount: 1,
      },
    };
  }
  
  private async executeDeepSkill(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // Deep Skill 详细实现见 6.2.5 节
    return {
      success: true,
      skillDescription: skill.description,
      data: {
        columns: [{name: 'deep_config', type: 'string'}],
        rows: [[JSON.stringify(skill)]],
        totalRowCount: 1,
      },
    };
  }
}
```

#### 5.6.1 SQL安全工具类

```typescript
// server/src/utils/sql_sanitizer.ts

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedParams?: Record<string, unknown>;
}

export interface ParameterizedQuery {
  sql: string;
  params: Array<{name: string; value: unknown; type: string}>;
}

/**
 * SQL安全工具类
 * 提供参数清理、注入检测、安全验证功能
 */
export class SqlSanitizer {
  // 危险 SQL 关键字（用于条件SQL检测）
  private static readonly DANGEROUS_KEYWORDS = [
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE',
    'TRUNCATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
    '--', ';', '/*', '*/', 'UNION', 'INTO'
  ];
  
  // 允许在条件SQL中使用的安全关键字
  private static readonly SAFE_CONDITION_KEYWORDS = [
    'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL',
    '>=', '<=', '>', '<', '=', '!='
  ];
  
  /**
   * 清理字符串参数，移除潜在的SQL注入字符
   */
  sanitizeString(value: string): string {
    // 转义单引号
    let sanitized = value.replace(/'/g, "''");
    
    // 移除SQL注释
    sanitized = sanitized.replace(/--/g, '');
    sanitized = sanitized.replace(/\/\*/g, '');
    sanitized = sanitized.replace(/\*\//g, '');
    
    // 移除分号（防止语句注入）
    sanitized = sanitized.replace(/;/g, '');
    
    // 移除换行符（防止多行注入）
    sanitized = sanitized.replace(/[\r\n]/g, ' ');
    
    return sanitized;
  }
  
  /**
   * 检查条件SQL是否安全
   */
  isConditionSafe(condition: string): boolean {
    const upperCondition = condition.toUpperCase();
    
    // 检查是否包含危险关键字
    for (const keyword of SqlSanitizer.DANGEROUS_KEYWORDS) {
      if (upperCondition.includes(keyword.toUpperCase())) {
        return false;
      }
    }
    
    // 检查是否只包含安全的操作
    // 允许: AND f.ts >= $1, WHERE name LIKE $2, etc.
    const safePattern = /^(AND|OR|WHERE)?\s*[\w.]+\s*(>=|<=|>|<|=|!=|LIKE|IN|BETWEEN|IS\s+(NOT\s+)?NULL)\s*(\$\d+|'[^']*'|\d+)/i;
    
    // 简单条件检查
    const conditions = condition.split(/\s+AND\s+|\s+OR\s+/i);
    for (const cond of conditions) {
      const trimmed = cond.trim();
      if (trimmed && !this.isSimpleConditionSafe(trimmed)) {
        return false;
      }
    }
    
    return true;
  }
  
  private isSimpleConditionSafe(condition: string): boolean {
    // 允许空条件
    if (!condition || condition.trim() === '') return true;
    
    // 允许简单比较: column >= value, column LIKE pattern
    const simpleCompare = /^[\w.]+\s*(>=|<=|>|<|=|!=|LIKE|IS\s+(NOT\s+)?NULL)\s*.+$/i;
    if (simpleCompare.test(condition)) return true;
    
    // 允许 IN 子句: column IN (1, 2, 3)
    const inClause = /^[\w.]+\s+IN\s*\([^)]+\)$/i;
    if (inClause.test(condition)) return true;
    
    // 允许 BETWEEN: column BETWEEN a AND b
    const between = /^[\w.]+\s+BETWEEN\s+\S+\s+AND\s+\S+$/i;
    if (between.test(condition)) return true;
    
    return false;
  }
  
  /**
   * 验证标识符（表名、列名）是否安全
   */
  isIdentifierSafe(identifier: string): boolean {
    // 只允许字母、数字、下划线、点（用于table.column）
    return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(identifier);
  }
  
  /**
   * 创建参数化查询的占位符
   */
  createPlaceholder(index: number): string {
    return `$${index}`;
  }
}
```

### 5.7 Skill注册表

```typescript
// server/src/services/skill_registry.ts

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {Logger} from '../utils/logger';
import {SceneType} from '../types/shared';

const logger = new Logger('skill_registry');

export interface SkillParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  default?: unknown;
}

export interface SkillOutputColumn {
  name: string;
  type: string;
  unit?: string;
}

export interface SkillStep {
  id: string;
  skill: string;
  params: Record<string, unknown>;
  type?: 'iterator' | 'conditional';
  forEach?: string;
  filter?: string;
  maxItems?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  type: 'atomic' | 'composite' | 'pipeline' | 'module' | 'deep';
  description: string;
  version: string;
  params: SkillParam[];
  sql: string;
  outputSchema?: {
    columns: SkillOutputColumn[];
    displayLevel: 'summary' | 'detail';
  };
  steps?: SkillStep[];
  relatedTools?: string[];
  vendor?: string;
}

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsByCategory: Map<string, SkillDefinition[]> = new Map();
  private vendorOverrides: Map<string, Map<string, Partial<SkillDefinition>>> = new Map();

  /**
   * 加载 Skill 库
   */
  async loadSkills(libraryPath: string): Promise<void> {
    const categories = ['atomic', 'composite', 'pipeline'];
    
    for (const category of categories) {
      const categoryPath = path.join(libraryPath, category);
      
      if (!fs.existsSync(categoryPath)) {
        continue;
      }

      const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.yaml'));
      
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(categoryPath, file), 'utf8');
          const skill = yaml.load(content) as SkillDefinition;
          skill.id = skill.name || file.replace('.yaml', '');
          skill.type = category as SkillDefinition['type'];
          
          this.register(skill);
        } catch (error) {
          logger.warn(`Failed to load skill: ${file}`, error);
        }
      }
    }

    // 加载厂商覆写
    await this.loadVendorOverrides(path.join(libraryPath, 'vendors'));
  }

  /**
   * 注册 Skill
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
    
    // 按类别索引
    const categorySkills = this.skillsByCategory.get(skill.category) || [];
    categorySkills.push(skill);
    this.skillsByCategory.set(skill.category, categorySkills);
    
    logger.debug(`Registered skill: ${skill.id}`);
  }

  /**
   * 获取 Skill
   */
  get(id: string, vendor?: string): SkillDefinition | undefined {
    const skill = this.skills.get(id);
    
    if (!skill) return undefined;
    
    // 应用厂商覆写
    if (vendor) {
      const override = this.vendorOverrides.get(vendor)?.get(id);
      if (override) {
        return {...skill, ...override};
      }
    }
    
    return skill;
  }

  /**
   * 列出 Skills
   */
  list(sceneType?: SceneType, category?: string): SkillDefinition[] {
    let skills = Array.from(this.skills.values());
    
    if (sceneType) {
      skills = skills.filter(s => 
        s.category === sceneType || s.category === 'general'
      );
    }
    
    if (category) {
      skills = skills.filter(s => s.type === category);
    }
    
    return skills;
  }

  /**
   * 获取 Skill 数量
   */
  count(): number {
    return this.skills.size;
  }

  /**
   * 加载厂商覆写
   */
  private async loadVendorOverrides(vendorsPath: string): Promise<void> {
    if (!fs.existsSync(vendorsPath)) return;

    const files = fs.readdirSync(vendorsPath).filter(f => f.endsWith('.override.yaml'));
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(vendorsPath, file), 'utf8');
        const override = yaml.load(content) as {
          vendor: string;
          detectionPattern: string;
          overrides: Array<{
            skillId: string;
            sqlReplacements: Array<{pattern: string; replacement: string}>;
          }>;
        };

        const vendorOverrides = new Map<string, Partial<SkillDefinition>>();
        
        for (const o of override.overrides) {
          let sql = this.skills.get(o.skillId)?.sql || '';
          
          for (const rep of o.sqlReplacements) {
            sql = sql.replace(new RegExp(rep.pattern, 'g'), rep.replacement);
          }
          
          vendorOverrides.set(o.skillId, {sql});
        }
        
        this.vendorOverrides.set(override.vendor, vendorOverrides);
        logger.info(`Loaded vendor overrides for: ${override.vendor}`);
        
      } catch (error) {
        logger.warn(`Failed to load vendor override: ${file}`, error);
      }
    }
  }
}
```

---

## 第6章：Skill系统详细设计

### 6.1 Skill YAML Schema（JSON Schema格式）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OpenPerfetto Skill Definition",
  "type": "object",
  "required": ["name", "category", "type", "description", "params"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z_][a-z0-9_]*$",
      "description": "Unique skill identifier"
    },
    "category": {
      "type": "string",
      "enum": [
        "scrolling", "startup", "anr", "lock_contention", 
        "binder", "io", "cpu", "memory", "general"
      ]
    },
    "type": {
      "type": "string",
      "enum": ["atomic", "composite", "pipeline", "module", "deep"]
    },
    "description": {
      "type": "string",
      "maxLength": 500
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+(\\.\\d+)?$"
    },
    "params": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string", "enum": ["string", "integer", "float", "boolean"]},
          "required": {"type": "boolean", "default": false},
          "description": {"type": "string"},
          "default": {}
        }
      }
    },
    "sql": {
      "type": "string",
      "description": "PerfettoSQL query template with ${param} placeholders"
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "columns": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "type": {"type": "string", "enum": ["integer", "float", "string", "timestamp", "duration", "boolean", "enum"]},
              "unit": {"type": "string"},
              "values": {"type": "array", "items": {"type": "string"}}
            }
          }
        },
        "display_level": {
          "type": "string",
          "enum": ["summary", "detail"]
        }
      }
    },
    "steps": {
      "type": "array",
      "description": "For composite/pipeline skills",
      "items": {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "skill": {"type": "string"},
          "params": {"type": "object"},
          "type": {"type": "string", "enum": ["skill", "iterator", "conditional", "diagnostic"]},
          "for_each": {"type": "string"},
          "filter": {"type": "string"},
          "max_items": {"type": "integer"},
          "template": {"type": "string"}
        }
      }
    },
    "related_tools": {
      "type": "array",
      "items": {"type": "string"}
    },
    "keywords": {
      "type": "array",
      "items": {"type": "string"}
    }
  }
}
```

### 6.2 Skill类型执行逻辑

#### 6.2.1 Atomic Skill

```yaml
# skills/library/atomic/frame_jank_detection.yaml
name: frame_jank_detection
category: scrolling
type: atomic
description: "检测滚动过程中的掉帧，返回每帧的耗时、jank类型和责任方"
version: "1.0"

params:
  - name: process_name
    type: string
    required: true
    description: "目标进程名（模糊匹配）"
  - name: time_range_start
    type: integer
    required: false
    description: "分析起始时间（纳秒）"
  - name: time_range_end
    type: integer
    required: false
    description: "分析结束时间（纳秒）"

sql: |
  SELECT
    f.id as frame_id,
    f.ts,
    ROUND(f.dur / 1e6, 2) as dur_ms,
    f.jank_type,
    CASE
      WHEN f.jank_type = 'App Deadline Missed' THEN 'app'
      WHEN f.jank_type = 'SurfaceFlinger Deadline Missed' THEN 'sf'
      WHEN f.jank_type = 'Buffer Stuffing' THEN 'buffer'
      ELSE 'unknown'
    END as blame_layer,
    f.on_time_finish,
    f.layer_name
  FROM actual_frame_timeline_slice f
  JOIN process p ON f.upid = p.upid
  WHERE p.name LIKE '%${process_name}%'
    ${time_range_start ? "AND f.ts >= " + time_range_start : ""}
    ${time_range_end ? "AND f.ts <= " + time_range_end : ""}
  ORDER BY f.dur DESC
  LIMIT 200

output_schema:
  columns:
    - { name: frame_id, type: integer }
    - { name: ts, type: timestamp }
    - { name: dur_ms, type: duration, unit: ms }
    - { name: jank_type, type: enum, values: [None, "App Deadline Missed", "SurfaceFlinger Deadline Missed", "Buffer Stuffing"] }
    - { name: blame_layer, type: enum, values: [app, sf, buffer, unknown] }
    - { name: on_time_finish, type: boolean }
    - { name: layer_name, type: string }
  display_level: detail

related_tools:
  - fetch_artifact
  - frame_blocking_calls
```

#### 6.2.2 Composite Skill

```yaml
# skills/library/composite/scrolling_analysis.yaml
name: scrolling_analysis
category: scrolling
type: composite
description: "完整滑动分析：掉帧检测 → 阻塞链分析 → 根因归纳"
version: "1.0"

params:
  - name: process_name
    type: string
    required: true
    description: "目标应用进程名"
  - name: max_jank_frames
    type: integer
    required: false
    default: 10
    description: "最多分析的掉帧数量"

steps:
  # 步骤1：检测掉帧
  - id: detect_jank
    skill: frame_jank_detection
    params:
      process_name: "${process_name}"

  # 步骤2：对每个掉帧分析阻塞链
  - id: blocking_analysis
    type: iterator
    for_each: detect_jank
    filter: "jank_type IS NOT NULL AND jank_type != 'None'"
    max_items: ${max_jank_frames}
    body:
      - skill: frame_blocking_calls
        params:
          frame_id: "${.frame_id}"
          frame_ts: "${.ts}"

  # 步骤3：生成诊断摘要
  - id: summary
    type: diagnostic
    template: |
      ## 滑动分析摘要
      
      **帧统计**:
      - 总帧数: ${detect_jank.row_count}
      - 掉帧数: ${detect_jank.filtered_count}
      - 掉帧率: ${ROUND(detect_jank.filtered_count * 100.0 / detect_jank.row_count, 2)}%
      
      **掉帧类型分布**:
      ${detect_jank.group_by_jank_type}
      
      **Top 3 耗时最长的帧**:
      ${detect_jank.top_3_by_dur}

output_schema:
  columns:
    - { name: step, type: string }
    - { name: result, type: string }
  display_level: summary
```

#### 6.2.3 Pipeline Skill

Pipeline Skill 实现真正的流式执行，支持步骤间数据传递（前一步output作为后一步input）。

```yaml
# skills/library/pipeline/cold_startup_pipeline.yaml
name: cold_startup_pipeline
category: startup
type: pipeline
description: "冷启动完整分析流水线"
version: "1.0"

params:
  - name: package_name
    type: string
    required: true
    description: "应用包名"

# Pipeline 执行配置
pipeline_config:
  timeout_ms: 60000           # 总超时时间
  stage_timeout_ms: 15000     # 单阶段超时
  continue_on_error: false    # 错误时是否继续
  parallel_stages: false      # 是否允许并行阶段

stages:
  # 阶段1：识别启动边界
  - id: identify_boundaries
    name: "识别启动边界"
    skills:
      - process_creation_detection
      - first_frame_detection
    outputs:
      - start_ts
      - end_ts
      - total_duration_ms

  # 阶段2：分解启动阶段
  - id: breakdown_phases
    name: "分解启动阶段"
    depends_on: identify_boundaries
    # 前一阶段输出自动注入为本阶段参数
    input_mapping:
      time_range_start: "${identify_boundaries.start_ts}"
      time_range_end: "${identify_boundaries.end_ts}"
    skills:
      - app_init_phase
      - content_provider_init
      - activity_create_phase
    outputs:
      - phase_breakdown

  # 阶段3：识别瓶颈
  - id: identify_bottlenecks
    name: "识别瓶颈"
    depends_on: breakdown_phases
    skills:
      - main_thread_blocking
      - io_on_main_thread
      - binder_calls_analysis
    outputs:
      - bottleneck_list
      - blocking_calls

  # 阶段4：生成报告
  - id: generate_report
    name: "生成分析报告"
    depends_on: [identify_boundaries, breakdown_phases, identify_bottlenecks]
    type: diagnostic
    template: |
      # 冷启动分析报告
      
      ## 1. 启动时间
      - 总耗时: ${identify_boundaries.total_duration_ms} ms
      - 从进程创建到首帧
      
      ## 2. 阶段分解
      ${breakdown_phases.phase_breakdown}
      
      ## 3. 主要瓶颈
      ${identify_bottlenecks.bottleneck_list}
      
      ## 4. 优化建议
      ${generate_recommendations(identify_bottlenecks.blocking_calls)}
```

**Pipeline 执行引擎**:

```typescript
// server/src/services/pipeline_executor.ts

interface PipelineStage {
  id: string;
  name: string;
  skills: string[];
  dependsOn?: string | string[];
  inputMapping?: Record<string, string>;
  outputs: string[];
  type?: 'skill' | 'diagnostic';
}

interface PipelineContext {
  params: Record<string, unknown>;
  stageOutputs: Map<string, Record<string, unknown>>;
  errors: Array<{stageId: string; error: string}>;
}

export class PipelineExecutor {
  constructor(private skillProcessor: SkillProcessor) {}
  
  async executePipeline(
    stages: PipelineStage[],
    params: Record<string, unknown>,
    config: {timeoutMs: number; stageTimeoutMs: number; continueOnError: boolean}
  ): Promise<{success: boolean; outputs: Record<string, unknown>; errors: Array<{stageId: string; error: string}>}> {
    const context: PipelineContext = {
      params,
      stageOutputs: new Map(),
      errors: [],
    };
    
    // 构建依赖图并按拓扑排序
    const sortedStages = this.topologicalSort(stages);
    
    const startTime = Date.now();
    
    for (const stage of sortedStages) {
      // 检查总超时
      if (Date.now() - startTime > config.timeoutMs) {
        context.errors.push({stageId: stage.id, error: 'Pipeline timeout'});
        break;
      }
      
      // 检查依赖是否完成
      if (!this.checkDependencies(stage, context)) {
        if (!config.continueOnError) break;
        continue;
      }
      
      try {
        // 执行阶段
        const stageOutput = await this.executeStage(stage, context, config.stageTimeoutMs);
        context.stageOutputs.set(stage.id, stageOutput);
      } catch (error) {
        context.errors.push({
          stageId: stage.id,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!config.continueOnError) break;
      }
    }
    
    // 合并所有阶段输出
    const outputs: Record<string, unknown> = {};
    for (const [stageId, stageOutput] of context.stageOutputs) {
      outputs[stageId] = stageOutput;
    }
    
    return {
      success: context.errors.length === 0,
      outputs,
      errors: context.errors,
    };
  }
  
  private async executeStage(
    stage: PipelineStage,
    context: PipelineContext,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    // 解析输入映射，获取前一阶段的输出
    const stageParams = this.resolveInputMapping(stage, context);
    
    const stageOutputs: Record<string, unknown> = {};
    
    // 执行阶段中的所有 Skills
    for (const skillId of stage.skills) {
      const result = await Promise.race([
        this.skillProcessor.executeSkill(skillId, stageParams),
        this.timeout(timeoutMs),
      ]);
      
      if (result.success && result.data) {
        // 提取输出字段
        for (const outputKey of stage.outputs) {
          if (result.data[outputKey] !== undefined) {
            stageOutputs[outputKey] = result.data[outputKey];
          }
        }
      }
    }
    
    return stageOutputs;
  }
  
  private resolveInputMapping(
    stage: PipelineStage,
    context: PipelineContext
  ): Record<string, unknown> {
    const params = {...context.params};
    
    if (stage.inputMapping) {
      for (const [key, template] of Object.entries(stage.inputMapping)) {
        // 解析 ${stageId.outputKey} 模板
        const resolved = template.replace(
          /\$\{(\w+)\.(\w+)\}/g,
          (match, stageId, outputKey) => {
            const stageOutput = context.stageOutputs.get(stageId);
            return stageOutput?.[outputKey]?.toString() || '';
          }
        );
        params[key] = resolved;
      }
    }
    
    return params;
  }
  
  private topologicalSort(stages: PipelineStage[]): PipelineStage[] {
    // 简化实现：按依赖顺序排列
    const sorted: PipelineStage[] = [];
    const visited = new Set<string>();
    
    const visit = (stage: PipelineStage) => {
      if (visited.has(stage.id)) return;
      
      const deps = Array.isArray(stage.dependsOn) 
        ? stage.dependsOn 
        : stage.dependsOn ? [stage.dependsOn] : [];
      
      for (const depId of deps) {
        const depStage = stages.find(s => s.id === depId);
        if (depStage) visit(depStage);
      }
      
      visited.add(stage.id);
      sorted.push(stage);
    };
    
    for (const stage of stages) {
      visit(stage);
    }
    
    return sorted;
  }
  
  private checkDependencies(stage: PipelineStage, context: PipelineContext): boolean {
    const deps = Array.isArray(stage.dependsOn) 
      ? stage.dependsOn 
      : stage.dependsOn ? [stage.dependsOn] : [];
    
    return deps.every(depId => context.stageOutputs.has(depId));
  }
  
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Stage timeout')), ms)
    );
  }
}
```

#### 6.2.4 Module Skill

Module Skill 是可重用的 Skill 组合模块，支持参数化配置和组合复用。

```yaml
# skills/library/modules/blocking_analysis_module.yaml
name: blocking_analysis_module
category: general
type: module
description: "可重用的阻塞分析模块，支持任意时间范围和进程"
version: "1.0"

# Module 配置
module_config:
  reusable: true              # 可被其他 Skill 引用
  cacheable: true             # 结果可缓存
  cache_ttl_seconds: 300      # 缓存有效期

params:
  - name: target_upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: time_range_start
    type: integer
    required: true
  - name: time_range_end
    type: integer
    required: true
  - name: blocking_threshold_ms
    type: float
    default: 16.0
    description: "阻塞阈值（毫秒）"

# Module 组合的 Skills
components:
  - id: find_blocking_slices
    skill: atomic_slice_query
    params:
      upid: "${target_upid}"
      min_dur_ms: "${blocking_threshold_ms}"
      ts_start: "${time_range_start}"
      ts_end: "${time_range_end}"
    
  - id: categorize_blocking
    skill: slice_categorization
    input_from: find_blocking_slices
    params:
      categories:
        - {pattern: "binder.*", label: "Binder IPC"}
        - {pattern: "Lock.*|Monitor.*", label: "Lock Contention"}
        - {pattern: "IO.*|read|write", label: "I/O"}
        - {pattern: "GC.*", label: "GC"}
        - {pattern: ".*", label: "Other"}

  - id: aggregate_stats
    skill: aggregation
    input_from: categorize_blocking
    params:
      group_by: category
      aggregations:
        - {column: dur, function: SUM, as: total_dur}
        - {column: dur, function: COUNT, as: count}
        - {column: dur, function: AVG, as: avg_dur}

output_schema:
  columns:
    - {name: category, type: string}
    - {name: total_dur, type: duration, unit: ns}
    - {name: count, type: integer}
    - {name: avg_dur, type: duration, unit: ns}
```

**Module 执行引擎**:

```typescript
// server/src/services/module_executor.ts

interface ModuleComponent {
  id: string;
  skill: string;
  params: Record<string, unknown>;
  inputFrom?: string;
}

interface ModuleCache {
  key: string;
  result: unknown;
  expiresAt: number;
}

export class ModuleExecutor {
  private cache: Map<string, ModuleCache> = new Map();
  
  constructor(private skillProcessor: SkillProcessor) {}
  
  async executeModule(
    components: ModuleComponent[],
    params: Record<string, unknown>,
    config: {cacheable: boolean; cacheTtlSeconds: number}
  ): Promise<{success: boolean; data: unknown}> {
    // 检查缓存
    const cacheKey = this.generateCacheKey(components, params);
    if (config.cacheable) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return {success: true, data: cached.result};
      }
    }
    
    // 执行组件链
    const componentOutputs = new Map<string, unknown>();
    
    for (const component of components) {
      // 解析参数（包括从前一组件获取输入）
      const resolvedParams = this.resolveParams(component, params, componentOutputs);
      
      // 执行 Skill
      const result = await this.skillProcessor.executeSkill(component.skill, resolvedParams);
      
      if (!result.success) {
        return {success: false, data: {error: result.error, componentId: component.id}};
      }
      
      componentOutputs.set(component.id, result.data);
    }
    
    // 获取最后一个组件的输出作为 Module 输出
    const lastComponent = components[components.length - 1];
    const finalOutput = componentOutputs.get(lastComponent.id);
    
    // 缓存结果
    if (config.cacheable) {
      this.cache.set(cacheKey, {
        key: cacheKey,
        result: finalOutput,
        expiresAt: Date.now() + config.cacheTtlSeconds * 1000,
      });
    }
    
    return {success: true, data: finalOutput};
  }
  
  private resolveParams(
    component: ModuleComponent,
    moduleParams: Record<string, unknown>,
    componentOutputs: Map<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(component.params)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        // 解析模板变量
        const varName = value.slice(2, -1);
        resolved[key] = moduleParams[varName];
      } else {
        resolved[key] = value;
      }
    }
    
    // 如果有 inputFrom，将前一组件的输出作为输入
    if (component.inputFrom) {
      const prevOutput = componentOutputs.get(component.inputFrom);
      if (prevOutput) {
        resolved._input = prevOutput;
      }
    }
    
    return resolved;
  }
  
  private generateCacheKey(components: ModuleComponent[], params: Record<string, unknown>): string {
    return JSON.stringify({components: components.map(c => c.id), params});
  }
}
```

#### 6.2.5 Deep Skill

Deep Skill 是深层级多步分析，支持自适应步骤（根据中间结果决定下一步）。

```yaml
# skills/library/deep/adaptive_root_cause_analysis.yaml
name: adaptive_root_cause_analysis
category: general
type: deep
description: "自适应根因分析，根据中间结果动态调整分析路径"
version: "1.0"

# Deep 配置
deep_config:
  max_depth: 5                # 最大分析深度
  branch_threshold: 0.3       # 分支概率阈值
  timeout_ms: 120000          # 总超时时间
  exploration_strategy: "breadth_first"  # 探索策略: breadth_first | depth_first | priority

params:
  - name: anomaly_type
    type: string
    required: true
    description: "异常类型: jank | anr | slow_startup | high_cpu"
  - name: target_ts
    type: integer
    required: true
    description: "异常发生时间戳"
  - name: target_upid
    type: integer
    required: true
    description: "目标进程 UPID"

# 初始分析步骤
entry_step:
  id: initial_triage
  skill: anomaly_triage
  params:
    type: "${anomaly_type}"
    ts: "${target_ts}"
    upid: "${target_upid}"

# 条件分支规则
branching_rules:
  # 根据 triage 结果决定下一步
  - condition: "initial_triage.primary_cause == 'main_thread_blocking'"
    next_steps:
      - id: analyze_blocking
        skill: blocking_analysis_module
        priority: 1.0
      - id: check_locks
        skill: lock_contention_detection
        priority: 0.8
        
  - condition: "initial_triage.primary_cause == 'gc_pressure'"
    next_steps:
      - id: analyze_gc
        skill: gc_pause_analysis
        priority: 1.0
      - id: check_allocations
        skill: heap_allocation_hotspot
        priority: 0.7
        
  - condition: "initial_triage.primary_cause == 'io_blocking'"
    next_steps:
      - id: analyze_io
        skill: io_on_main_thread
        priority: 1.0
      - id: check_database
        skill: database_query_analysis
        priority: 0.6

  - condition: "initial_triage.primary_cause == 'binder_delay'"
    next_steps:
      - id: analyze_binder
        skill: binder_transaction_analysis
        priority: 1.0
      - id: check_server
        skill: binder_server_delay
        priority: 0.9

# 递归深入规则
deepening_rules:
  - step_pattern: "analyze_blocking"
    condition: "result.top_blocking.dur_ms > 100"
    next_step:
      id: drill_down_blocking
      skill: slice_call_stack
      params:
        slice_id: "${result.top_blocking.id}"

  - step_pattern: "analyze_gc"
    condition: "result.gc_pause_total_ms > 50"
    next_step:
      id: analyze_allocations
      skill: allocation_site_analysis

# 终止条件
termination_rules:
  - condition: "current_depth >= max_depth"
    action: "stop"
  - condition: "all_branches_exhausted"
    action: "stop"
  - condition: "confidence_score >= 0.9"
    action: "stop_with_result"

output_schema:
  columns:
    - {name: root_cause, type: string}
    - {name: confidence, type: float}
    - {name: evidence_chain, type: string}
    - {name: recommendations, type: string}
```

**Deep Skill 执行引擎**:

```typescript
// server/src/services/deep_executor.ts

interface DeepStep {
  id: string;
  skill: string;
  params: Record<string, unknown>;
  priority: number;
  result?: unknown;
  children: DeepStep[];
  depth: number;
}

interface DeepContext {
  steps: DeepStep[];
  currentDepth: number;
  maxDepth: number;
  confidenceScore: number;
  evidenceChain: string[];
}

export class DeepExecutor {
  constructor(private skillProcessor: SkillProcessor) {}
  
  async executeDeepAnalysis(
    entryStep: {id: string; skill: string; params: Record<string, unknown>},
    branchingRules: Array<{condition: string; nextSteps: Array<{id: string; skill: string; priority: number}>}>,
    deepeningRules: Array<{stepPattern: string; condition: string; nextStep: {id: string; skill: string; params: Record<string, unknown>}}>,
    config: {maxDepth: number; timeoutMs: number; explorationStrategy: string}
  ): Promise<{success: boolean; rootCause: string; confidence: number; evidenceChain: string[]}> {
    const context: DeepContext = {
      steps: [],
      currentDepth: 0,
      maxDepth: config.maxDepth,
      confidenceScore: 0,
      evidenceChain: [],
    };
    
    const startTime = Date.now();
    
    // 执行入口步骤
    const entryResult = await this.executeStep({
      ...entryStep,
      priority: 1.0,
      children: [],
      depth: 0,
    });
    
    context.steps.push(entryResult.step);
    
    // 根据策略探索分支
    const pendingSteps: DeepStep[] = [];
    
    // 评估分支规则
    for (const rule of branchingRules) {
      if (this.evaluateCondition(rule.condition, entryResult.step.result)) {
        for (const nextStep of rule.nextSteps) {
          pendingSteps.push({
            id: nextStep.id,
            skill: nextStep.skill,
            params: this.resolveParams(entryResult.step.result),
            priority: nextStep.priority,
            children: [],
            depth: 1,
          });
        }
      }
    }
    
    // 按优先级排序
    pendingSteps.sort((a, b) => b.priority - a.priority);
    
    // 迭代执行
    while (pendingSteps.length > 0 && Date.now() - startTime < config.timeoutMs) {
      const step = config.explorationStrategy === 'depth_first' 
        ? pendingSteps.pop()! 
        : pendingSteps.shift()!;
      
      if (step.depth >= config.maxDepth) continue;
      
      const result = await this.executeStep(step);
      context.steps.push(result.step);
      context.evidenceChain.push(`${step.skill}: ${this.summarizeResult(result.step.result)}`);
      
      // 更新置信度
      context.confidenceScore = this.calculateConfidence(context.steps);
      
      // 检查终止条件
      if (context.confidenceScore >= 0.9) {
        break;
      }
      
      // 评估深入规则
      for (const rule of deepeningRules) {
        if (step.id.includes(rule.stepPattern) && 
            this.evaluateCondition(rule.condition, result.step.result)) {
          pendingSteps.push({
            id: rule.nextStep.id,
            skill: rule.nextStep.skill,
            params: this.resolveParams(result.step.result, rule.nextStep.params),
            priority: step.priority * 0.9,
            children: [],
            depth: step.depth + 1,
          });
        }
      }
    }
    
    // 生成最终结果
    return {
      success: true,
      rootCause: this.determineRootCause(context.steps),
      confidence: context.confidenceScore,
      evidenceChain: context.evidenceChain,
    };
  }
  
  private async executeStep(step: DeepStep): Promise<{step: DeepStep}> {
    const result = await this.skillProcessor.executeSkill(step.skill, step.params);
    step.result = result.data;
    return {step};
  }
  
  private evaluateCondition(condition: string, result: unknown): boolean {
    // 简化的条件评估器
    // 实际实现需要更完整的表达式解析
    try {
      const fn = new Function('result', `return ${condition.replace(/(\w+)\.(\w+)/g, 'result.$2')}`);
      return fn(result);
    } catch {
      return false;
    }
  }
  
  private resolveParams(result: unknown, template?: Record<string, unknown>): Record<string, unknown> {
    if (!template) return {};
    
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string' && value.includes('${result.')) {
        const path = value.match(/\$\{result\.(\w+)\}/)?.[1];
        if (path && typeof result === 'object' && result !== null) {
          resolved[key] = (result as Record<string, unknown>)[path];
        }
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
  
  private calculateConfidence(steps: DeepStep[]): number {
    // 基于证据数量和质量计算置信度
    const baseConfidence = Math.min(steps.length * 0.15, 0.6);
    const depthBonus = steps.filter(s => s.depth > 1).length * 0.1;
    return Math.min(baseConfidence + depthBonus, 1.0);
  }
  
  private summarizeResult(result: unknown): string {
    if (typeof result === 'object' && result !== null) {
      const summary = Object.entries(result as Record<string, unknown>)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return summary || 'completed';
    }
    return String(result);
  }
  
  private determineRootCause(steps: DeepStep[]): string {
    // 根据执行路径确定根因
    const deepestStep = steps.reduce((a, b) => a.depth > b.depth ? a : b);
    return `${deepestStep.skill} identified issue`;
  }
}
```

### 6.3 Skill标记协议

**格式**: `skill:<skill_id>|<params_json>`

**解析规范**:

```typescript
// Skill 标记解析器
interface SkillMarker {
  skillId: string;
  params: Record<string, unknown>;
  position: {start: number; end: number};
}

function parseSkillMarkers(text: string): SkillMarker[] {
  const regex = /skill:([a-z_][a-z0-9_]*)\|(\{[^}]*\})/g;
  const markers: SkillMarker[] = [];
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    markers.push({
      skillId: match[1],
      params: JSON.parse(match[2]),
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }
  
  return markers;
}
```

### 6.4 初期Skill库清单

> **统计**: 初期 Skill 库共包含 **35+ 个 Skill**，覆盖 10 个分析领域。

#### 滚动场景 (scrolling) - 6个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `frame_jank_detection` | atomic | 检测掉帧和jank类型 |
| `frame_blocking_calls` | atomic | 分析帧期间的阻塞调用 |
| `vsync_analysis` | atomic | VSync信号分析 |
| `render_thread_analysis` | atomic | RenderThread工作负载分析 |
| `scrolling_analysis` | composite | 完整滑动分析流程 |
| `buffer_stuffing_detection` | atomic | Buffer Stuffing检测 |

#### 启动场景 (startup) - 8个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `process_creation_detection` | atomic | 进程创建检测 |
| `first_frame_detection` | atomic | 首帧渲染检测 |
| `app_init_phase` | atomic | Application初始化分析 |
| `content_provider_init` | atomic | ContentProvider初始化分析 |
| `activity_create_phase` | atomic | Activity创建阶段分析 |
| `cold_startup_analysis` | composite | 冷启动完整分析 |
| `warm_startup_analysis` | composite | 热启动分析 |
| `ttid_ttfd_calculation` | atomic | TTID/TTFD计算 |

#### ANR场景 (anr) - 5个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `main_thread_blocking_detection` | atomic | 主线程阻塞检测 |
| `anr_window_analysis` | atomic | ANR窗口分析（5秒） |
| `broadcast_timeout_detection` | atomic | 广播超时检测 |
| `service_timeout_detection` | atomic | Service超时检测 |
| `anr_root_cause` | composite | ANR根因分析 |

#### 锁竞争场景 (lock_contention) - 3个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `monitor_contention_detection` | atomic | Monitor竞争检测 |
| `lock_holder_identification` | atomic | 锁持有者识别 |
| `deadlock_detection` | atomic | 死锁检测 |

#### Binder场景 (binder) - 3个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `binder_transaction_analysis` | atomic | Binder事务分析 |
| `binder_server_delay` | atomic | Binder服务端延迟分析 |
| `binder_thread_pool` | atomic | Binder线程池使用分析 |

#### IO场景 (io) - 3个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `io_on_main_thread` | atomic | 主线程IO检测 |
| `file_io_analysis` | atomic | 文件IO分析 |
| `database_query_analysis` | atomic | 数据库查询分析 |

#### 内存分析 (memory) - 3个 [新增]

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `memory_leak_detection` | atomic | 内存泄漏检测，分析堆增长模式 |
| `gc_pause_analysis` | atomic | GC暂停分析，统计GC耗时分布 |
| `heap_allocation_hotspot` | atomic | 堆分配热点，识别高频分配调用栈 |

```yaml
# skills/library/atomic/memory_leak_detection.yaml
name: memory_leak_detection
category: memory
type: atomic
description: "检测内存泄漏，分析堆内存增长模式和可疑对象"
version: "1.0"

params:
  - name: upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: time_window_ms
    type: integer
    default: 60000
    description: "分析时间窗口（毫秒）"

sql: |
  WITH heap_samples AS (
    SELECT
      ts,
      CAST(value AS INTEGER) as heap_size
    FROM counter
    WHERE track_id IN (
      SELECT id FROM counter_track
      WHERE name = 'mem.rss' AND upid = $1
    )
    AND ts >= (SELECT MIN(ts) FROM counter) 
    AND ts <= (SELECT MIN(ts) FROM counter) + $2 * 1000000
  ),
  growth_analysis AS (
    SELECT
      ts,
      heap_size,
      heap_size - LAG(heap_size) OVER (ORDER BY ts) as growth,
      ROUND((heap_size - FIRST_VALUE(heap_size) OVER (ORDER BY ts)) / 1024.0 / 1024.0, 2) as cumulative_growth_mb
    FROM heap_samples
  )
  SELECT
    ts,
    ROUND(heap_size / 1024.0 / 1024.0, 2) as heap_mb,
    ROUND(growth / 1024.0, 2) as growth_kb,
    cumulative_growth_mb,
    CASE
      WHEN cumulative_growth_mb > 50 THEN 'high_risk'
      WHEN cumulative_growth_mb > 20 THEN 'medium_risk'
      ELSE 'low_risk'
    END as leak_risk
  FROM growth_analysis
  WHERE growth > 0
  ORDER BY growth DESC
  LIMIT 100

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: heap_mb, type: float, unit: MB}
    - {name: growth_kb, type: float, unit: KB}
    - {name: cumulative_growth_mb, type: float, unit: MB}
    - {name: leak_risk, type: enum, values: [low_risk, medium_risk, high_risk]}
  display_level: detail
```

```yaml
# skills/library/atomic/gc_pause_analysis.yaml
name: gc_pause_analysis
category: memory
type: atomic
description: "分析GC暂停时间，统计各类GC事件的耗时分布"
version: "1.0"

params:
  - name: upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: min_pause_ms
    type: float
    default: 1.0
    description: "最小GC暂停时间阈值（毫秒）"

sql: |
  SELECT
    s.ts,
    s.name as gc_type,
    ROUND(s.dur / 1e6, 2) as pause_ms,
    CASE
      WHEN s.name LIKE '%young%' OR s.name LIKE '%minor%' THEN 'minor_gc'
      WHEN s.name LIKE '%full%' OR s.name LIKE '%major%' THEN 'major_gc'
      WHEN s.name LIKE '%concurrent%' THEN 'concurrent_gc'
      ELSE 'other_gc'
    END as gc_category
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  WHERE t.upid = $1
    AND (s.name LIKE '%GC%' OR s.name LIKE '%gc%' OR s.name LIKE '%Gc%')
    AND s.dur / 1e6 >= $2
  ORDER BY s.dur DESC
  LIMIT 200

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: gc_type, type: string}
    - {name: pause_ms, type: duration, unit: ms}
    - {name: gc_category, type: enum, values: [minor_gc, major_gc, concurrent_gc, other_gc]}
  display_level: detail
```

```yaml
# skills/library/atomic/heap_allocation_hotspot.yaml
name: heap_allocation_hotspot
category: memory
type: atomic
description: "识别堆分配热点，找出高频内存分配的调用位置"
version: "1.0"

params:
  - name: upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: top_n
    type: integer
    default: 20
    description: "返回前N个热点"

sql: |
  SELECT
    h.callsite_id,
    f.name as function_name,
    f.mapping_name as library,
    SUM(h.size) as total_allocated_bytes,
    COUNT(*) as allocation_count,
    ROUND(SUM(h.size) / 1024.0 / 1024.0, 2) as total_mb,
    ROUND(AVG(h.size), 0) as avg_size_bytes
  FROM heap_profile_allocation h
  JOIN stack_profile_frame f ON h.callsite_id = f.id
  WHERE h.upid = $1
  GROUP BY h.callsite_id, f.name, f.mapping_name
  ORDER BY total_allocated_bytes DESC
  LIMIT $2

output_schema:
  columns:
    - {name: callsite_id, type: integer}
    - {name: function_name, type: string}
    - {name: library, type: string}
    - {name: total_allocated_bytes, type: integer, unit: bytes}
    - {name: allocation_count, type: integer}
    - {name: total_mb, type: float, unit: MB}
    - {name: avg_size_bytes, type: integer, unit: bytes}
  display_level: summary
```

#### 电量分析 (power) - 3个 [新增]

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `wakelock_analysis` | atomic | Wakelock分析，检测持锁过长的情况 |
| `cpu_wake_frequency` | atomic | CPU唤醒频率分析，检测频繁唤醒 |
| `background_service_drain` | atomic | 后台Service电量消耗分析 |

```yaml
# skills/library/atomic/wakelock_analysis.yaml
name: wakelock_analysis
category: power
type: atomic
description: "分析Wakelock持有情况，检测持锁时间过长的问题"
version: "1.0"

params:
  - name: upid
    type: integer
    required: false
    description: "目标进程 UPID（可选，不填则分析所有进程）"
  - name: min_duration_ms
    type: integer
    default: 1000
    description: "最小持锁时间阈值（毫秒）"

sql: |
  SELECT
    s.ts,
    s.name as wakelock_name,
    ROUND(s.dur / 1e6, 2) as duration_ms,
    p.name as process_name,
    p.pid,
    CASE
      WHEN s.dur / 1e6 > 60000 THEN 'critical'
      WHEN s.dur / 1e6 > 10000 THEN 'warning'
      ELSE 'normal'
    END as severity
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  JOIN process p ON t.upid = p.upid
  WHERE s.name LIKE '%wakelock%' OR s.name LIKE '%WakeLock%'
    AND s.dur / 1e6 >= $2
    ${upid ? "AND t.upid = " + upid : ""}
  ORDER BY s.dur DESC
  LIMIT 100

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: wakelock_name, type: string}
    - {name: duration_ms, type: duration, unit: ms}
    - {name: process_name, type: string}
    - {name: pid, type: integer}
    - {name: severity, type: enum, values: [normal, warning, critical]}
  display_level: detail
```

```yaml
# skills/library/atomic/cpu_wake_frequency.yaml
name: cpu_wake_frequency
category: power
type: atomic
description: "分析CPU唤醒频率，检测导致频繁唤醒的进程"
version: "1.0"

params:
  - name: time_bucket_ms
    type: integer
    default: 1000
    description: "统计时间桶大小（毫秒）"

sql: |
  WITH cpu_state_changes AS (
    SELECT
      ts,
      value as cpu_state,
      LAG(value) OVER (ORDER BY ts) as prev_state
    FROM counter
    WHERE track_id IN (
      SELECT id FROM counter_track WHERE name LIKE 'cpu%state%'
    )
  ),
  wakeups AS (
    SELECT
      ts,
      CAST(ts / ($1 * 1000000) AS INTEGER) as time_bucket
    FROM cpu_state_changes
    WHERE cpu_state > 0 AND (prev_state = 0 OR prev_state IS NULL)
  )
  SELECT
    time_bucket * $1 as bucket_start_ms,
    COUNT(*) as wakeup_count,
    CASE
      WHEN COUNT(*) > 100 THEN 'excessive'
      WHEN COUNT(*) > 50 THEN 'high'
      WHEN COUNT(*) > 20 THEN 'moderate'
      ELSE 'normal'
    END as frequency_level
  FROM wakeups
  GROUP BY time_bucket
  ORDER BY wakeup_count DESC
  LIMIT 100

output_schema:
  columns:
    - {name: bucket_start_ms, type: integer}
    - {name: wakeup_count, type: integer}
    - {name: frequency_level, type: enum, values: [normal, moderate, high, excessive]}
  display_level: summary
```

```yaml
# skills/library/atomic/background_service_drain.yaml
name: background_service_drain
category: power
type: atomic
description: "分析后台Service的电量消耗，识别异常耗电的Service"
version: "1.0"

params:
  - name: min_cpu_time_ms
    type: integer
    default: 100
    description: "最小CPU时间阈值（毫秒）"

sql: |
  SELECT
    p.name as process_name,
    p.pid,
    SUM(s.dur) / 1e6 as total_cpu_time_ms,
    COUNT(DISTINCT s.name) as unique_slices,
    COUNT(*) as total_slices,
    CASE
      WHEN SUM(s.dur) / 1e6 > 10000 THEN 'high_drain'
      WHEN SUM(s.dur) / 1e6 > 1000 THEN 'medium_drain'
      ELSE 'low_drain'
    END as drain_level
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  JOIN process p ON t.upid = p.upid
  WHERE p.name NOT LIKE '%launcher%'
    AND p.name NOT LIKE '%systemui%'
    AND p.name NOT LIKE '%system_server%'
    AND t.is_main_thread = 0
  GROUP BY p.upid, p.name, p.pid
  HAVING SUM(s.dur) / 1e6 >= $1
  ORDER BY total_cpu_time_ms DESC
  LIMIT 50

output_schema:
  columns:
    - {name: process_name, type: string}
    - {name: pid, type: integer}
    - {name: total_cpu_time_ms, type: duration, unit: ms}
    - {name: unique_slices, type: integer}
    - {name: total_slices, type: integer}
    - {name: drain_level, type: enum, values: [low_drain, medium_drain, high_drain]}
  display_level: summary
```

#### 网络分析 (network) - 2个 [新增]

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `network_request_latency` | atomic | 网络请求延迟分析 |
| `dns_resolution_delay` | atomic | DNS解析延迟检测 |

```yaml
# skills/library/atomic/network_request_latency.yaml
name: network_request_latency
category: network
type: atomic
description: "分析网络请求延迟，统计各请求的耗时分布"
version: "1.0"

params:
  - name: upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: min_latency_ms
    type: float
    default: 100.0
    description: "最小延迟阈值（毫秒）"

sql: |
  SELECT
    s.ts,
    s.name as request_name,
    ROUND(s.dur / 1e6, 2) as latency_ms,
    CASE
      WHEN s.name LIKE '%http%' OR s.name LIKE '%HTTP%' THEN 'http'
      WHEN s.name LIKE '%socket%' OR s.name LIKE '%Socket%' THEN 'socket'
      WHEN s.name LIKE '%ssl%' OR s.name LIKE '%SSL%' OR s.name LIKE '%tls%' THEN 'tls'
      ELSE 'other'
    END as request_type,
    CASE
      WHEN s.dur / 1e6 > 3000 THEN 'very_slow'
      WHEN s.dur / 1e6 > 1000 THEN 'slow'
      WHEN s.dur / 1e6 > 300 THEN 'moderate'
      ELSE 'fast'
    END as latency_category
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  WHERE t.upid = $1
    AND (s.name LIKE '%network%' OR s.name LIKE '%http%' OR s.name LIKE '%socket%' 
         OR s.name LIKE '%connect%' OR s.name LIKE '%request%')
    AND s.dur / 1e6 >= $2
  ORDER BY s.dur DESC
  LIMIT 100

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: request_name, type: string}
    - {name: latency_ms, type: duration, unit: ms}
    - {name: request_type, type: enum, values: [http, socket, tls, other]}
    - {name: latency_category, type: enum, values: [fast, moderate, slow, very_slow]}
  display_level: detail
```

```yaml
# skills/library/atomic/dns_resolution_delay.yaml
name: dns_resolution_delay
category: network
type: atomic
description: "检测DNS解析延迟，识别DNS解析慢的情况"
version: "1.0"

params:
  - name: upid
    type: integer
    required: false
    description: "目标进程 UPID（可选）"
  - name: min_delay_ms
    type: float
    default: 50.0
    description: "最小延迟阈值（毫秒）"

sql: |
  SELECT
    s.ts,
    s.name as dns_query,
    ROUND(s.dur / 1e6, 2) as resolution_time_ms,
    p.name as process_name,
    CASE
      WHEN s.dur / 1e6 > 1000 THEN 'timeout_risk'
      WHEN s.dur / 1e6 > 500 THEN 'very_slow'
      WHEN s.dur / 1e6 > 100 THEN 'slow'
      ELSE 'normal'
    END as delay_level
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  JOIN process p ON t.upid = p.upid
  WHERE (s.name LIKE '%dns%' OR s.name LIKE '%DNS%' OR s.name LIKE '%getaddrinfo%'
         OR s.name LIKE '%resolve%' OR s.name LIKE '%lookup%')
    AND s.dur / 1e6 >= $2
    ${upid ? "AND t.upid = " + upid : ""}
  ORDER BY s.dur DESC
  LIMIT 100

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: dns_query, type: string}
    - {name: resolution_time_ms, type: duration, unit: ms}
    - {name: process_name, type: string}
    - {name: delay_level, type: enum, values: [normal, slow, very_slow, timeout_risk]}
  display_level: detail
```

#### Choreographer分析 (choreographer) - 1个 [新增]

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `choreographer_frame_analysis` | atomic | Choreographer帧回调分析 |

```yaml
# skills/library/atomic/choreographer_frame_analysis.yaml
name: choreographer_frame_analysis
category: choreographer
type: atomic
description: "分析Choreographer帧回调，检测VSYNC与帧绘制的时序问题"
version: "1.0"

params:
  - name: upid
    type: integer
    required: true
    description: "目标进程 UPID"
  - name: frame_budget_ms
    type: float
    default: 16.67
    description: "帧预算时间（毫秒，60fps对应16.67ms）"

sql: |
  WITH choreographer_callbacks AS (
    SELECT
      s.ts,
      s.dur,
      s.name,
      CASE
        WHEN s.name LIKE '%doFrame%' THEN 'doFrame'
        WHEN s.name LIKE '%Choreographer%input%' THEN 'input_callback'
        WHEN s.name LIKE '%Choreographer%animation%' THEN 'animation_callback'
        WHEN s.name LIKE '%Choreographer%traversal%' THEN 'traversal_callback'
        ELSE 'other'
      END as callback_type
    FROM slice s
    JOIN thread_track tt ON s.track_id = tt.id
    JOIN thread t ON tt.utid = t.utid
    WHERE t.upid = $1
      AND t.is_main_thread = 1
      AND (s.name LIKE '%Choreographer%' OR s.name LIKE '%doFrame%')
  )
  SELECT
    ts,
    ROUND(dur / 1e6, 2) as duration_ms,
    callback_type,
    ROUND(dur / 1e6 - $2, 2) as over_budget_ms,
    CASE
      WHEN dur / 1e6 > $2 * 3 THEN 'severe_jank'
      WHEN dur / 1e6 > $2 * 2 THEN 'major_jank'
      WHEN dur / 1e6 > $2 THEN 'minor_jank'
      ELSE 'on_time'
    END as frame_status
  FROM choreographer_callbacks
  ORDER BY dur DESC
  LIMIT 200

output_schema:
  columns:
    - {name: ts, type: timestamp}
    - {name: duration_ms, type: duration, unit: ms}
    - {name: callback_type, type: enum, values: [doFrame, input_callback, animation_callback, traversal_callback, other]}
    - {name: over_budget_ms, type: float, unit: ms}
    - {name: frame_status, type: enum, values: [on_time, minor_jank, major_jank, severe_jank]}
  display_level: detail

related_tools:
  - fetch_artifact
  - frame_jank_detection
```

#### 通用 (general) - 4个

| Skill ID | 类型 | 描述 |
|----------|------|------|
| `cpu_utilization` | atomic | CPU使用率分析 |
| `memory_usage` | atomic | 内存使用分析 |
| `thread_state_analysis` | atomic | 线程状态分析 |
| `process_overview` | atomic | 进程概览 |

### 6.5 Vendor Override机制

```yaml
# skills/library/vendors/qualcomm.override.yaml
vendor: qualcomm
detection_pattern: "ro.board.platform=.*qualcomm|snapdragon|sm[0-9]+"

overrides:
  - skill_id: gpu_frequency_analysis
    sql_replacements:
      - pattern: "gpu_frequency"
        replacement: "qcom_gpu_freq"
      - pattern: "gpu_util"
        replacement: "qcom_gpu_utilization"
  
  - skill_id: cpu_topology
    sql_replacements:
      - pattern: "core_type"
        replacement: "cluster_type"
      - pattern: "cpu_cluster"
        replacement: "qcom_cpu_cluster"

additional_skills:
  - id: qcom_adsp_analysis
    description: "Qualcomm ADSP分析"
```

### 6.6 Skill版本管理

```typescript
interface SkillVersion {
  major: number;
  minor: number;
  patch?: number;
}

function parseVersion(versionStr: string): SkillVersion {
  const parts = versionStr.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2],
  };
}

function isCompatible(required: SkillVersion, current: SkillVersion): boolean {
  // 主版本必须匹配
  if (required.major !== current.major) return false;
  // 次版本当前必须 >= 要求
  if (current.minor < required.minor) return false;
  return true;
}
```

---

## 第7章：通信协议详细设计

### 7.1 WebSocket连接管理

#### 7.1.1 后端连接状态机

```
                    ┌──────────────┐
                    │  CONNECTING  │
                    └──────┬───────┘
                           │ onopen
                           ▼
                    ┌──────────────┐
                    │  CONNECTED   │
                    └──────┬───────┘
                           │ authenticate
                           ▼
                    ┌──────────────┐◄───────────┐
                    │AUTHENTICATED │            │ resume
                    └──────┬───────┘            │
                           │ first message      │
                           ▼                    │
                    ┌──────────────┐      ┌─────┴──────┐
                    │    ACTIVE    │─────►│   PAUSED   │
                    └──────┬───────┘      └────────────┘
                           │                   (backpressure)
                           │ close/timeout
                           ▼
                    ┌──────────────┐
                    │   CLOSING    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    CLOSED    │
                    └──────────────┘
```

#### 7.1.2 后端连接管理配置

```typescript
// server/src/config/websocket.ts

export interface WebSocketServerConfig {
  // 连接池配置
  maxTotalConnections: number;      // 最大总连接数（默认 1000）
  maxConnectionsPerUser: number;    // 每用户最大连接数（默认 5）
  
  // 心跳配置
  heartbeatTimeout: number;         // 心跳超时 90秒
  heartbeatCheckInterval: number;   // 心跳检测间隔 30秒
  
  // 清理配置
  zombieCleanupInterval: number;    // 僵尸连接清理间隔 30秒
  inactiveTimeout: number;          // 无活动超时 5分钟
  
  // 背压配置
  maxBufferedAmount: number;        // 背压阈值 1MB
  messageQueueLimit: number;        // 消息队列上限 1000
}

export const DEFAULT_WS_CONFIG: WebSocketServerConfig = {
  maxTotalConnections: 1000,
  maxConnectionsPerUser: 5,
  heartbeatTimeout: 90000,
  heartbeatCheckInterval: 30000,
  zombieCleanupInterval: 30000,
  inactiveTimeout: 300000,
  maxBufferedAmount: 1048576,
  messageQueueLimit: 1000,
};
```

#### 7.1.3 消息优先级

| 优先级 | 消息类型 | 说明 |
|--------|----------|------|
| HIGH (0) | `error` | 错误消息优先发送 |
| MEDIUM (1) | `tool_result`, `skill_result` | 工具执行结果 |
| LOW (2) | `text_delta`, `done`, `pong` | 流式文本和心跳 |

#### 7.1.4 前端 WebSocket 客户端

```typescript
// services/websocket_client.ts

export interface WebSocketConfig {
  url: string;
  reconnectAttempts: number;
  reconnectInterval: number;
  heartbeatInterval: number;
  messageTimeout: number;
}

export class WebSocketClient {
  private static instance: WebSocketClient;
  private socket: WebSocket | null = null;
  private config: WebSocketConfig;
  private agentId: string = '';
  private reconnectCount = 0;
  private heartbeatTimer: number | null = null;
  private lastPongTime: number = 0;
  private pendingRequests: Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeout: number;
  }> = new Map();

  private constructor() {
    this.config = {
      url: 'ws://localhost:3001/ws',
      reconnectAttempts: 5,
      reconnectInterval: 2000,
      heartbeatInterval: 30000,
      messageTimeout: 60000,
    };
  }

  static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }

  async connect(agentId: string): Promise<void> {
    this.agentId = agentId;
    
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.config.url);
      
      this.socket.onopen = () => {
        this.reconnectCount = 0;
        this.lastPongTime = Date.now();
        this.startHeartbeat();
        resolve();
      };
      
      this.socket.onclose = (event) => {
        this.stopHeartbeat();
        if (!event.wasClean && this.reconnectCount < this.config.reconnectAttempts) {
          this.scheduleReconnect();
        }
      };
      
      this.socket.onerror = (error) => {
        reject(new Error('WebSocket connection failed'));
      };
      
      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'pong') {
          this.lastPongTime = Date.now();
        }
        this.handleMessage(message);
      };
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      // 检查上次 pong 是否超时（90秒）
      if (Date.now() - this.lastPongTime > 90000) {
        console.warn('Heartbeat timeout, reconnecting...');
        this.socket?.close(4001, 'Heartbeat timeout');
        return;
      }
      
      this.send({type: 'ping', agentId: this.agentId, payload: {}});
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectCount++;
    setTimeout(() => {
      this.connect(this.agentId);
    }, this.config.reconnectInterval * this.reconnectCount);
  }

  private handleMessage(message: StreamResponse): void {
    // 处理不同类型的响应
    // 具体逻辑由 LLMStreamHandler 处理
  }

  async send(message: WebSocketMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.socket.send(JSON.stringify(message));
  }

  // ... 其他方法
}
```

### 7.2 完整消息类型定义

```typescript
// types/protocol.ts

/**
 * 前端 → 后端 消息类型
 */
export type WebSocketMessage = 
  | ChatRequest
  | SkillIndexRequest
  | SkillInvokeRequest
  | ConfigRequest
  | PingMessage;

export interface ChatRequest {
  type: 'chat';
  agentId: string;
  payload: {
    messages: ChatMessageDTO[];
    tools: ToolDefinitionDTO[];
    systemPrompt: string;
    stream: boolean;
    requirePlan?: boolean;
  };
}

export interface ChatMessageDTO {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    toolCallId: string;
    success: boolean;
    data?: unknown;
    error?: string;
  };
}

export interface ToolDefinitionDTO {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SkillIndexRequest {
  type: 'skill_index';
  agentId: string;
  payload: {
    sceneType?: string;
    category?: string;
  };
}

export interface SkillInvokeRequest {
  type: 'skill_invoke';
  agentId: string;
  payload: {
    skillId: string;
    params: Record<string, unknown>;
  };
}

export interface ConfigRequest {
  type: 'config';
  agentId: string;
  payload: {
    action: 'get' | 'set';
    key?: string;
    value?: unknown;
  };
}

export interface PingMessage {
  type: 'ping';
  agentId: string;
  payload: {};
}

/**
 * 后端 → 前端 响应类型
 * 所有响应消息都包含可选的 traceId 用于请求追踪
 */
export type StreamResponse = 
  | TextDeltaResponse
  | ToolUseResponse
  | ToolResultResponse
  | SkillIndexResponse
  | SkillResultResponse
  | ErrorResponse
  | DoneResponse
  | PongResponse;

/**
 * 响应消息基础接口，包含追踪ID
 */
interface BaseResponse {
  traceId?: string; // 请求追踪ID，用于日志关联
}

export interface TextDeltaResponse extends BaseResponse {
  type: 'text_delta';
  data: string;
}

export interface ToolUseResponse extends BaseResponse {
  type: 'tool_use';
  data: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
  };
}

export interface ToolResultResponse extends BaseResponse {
  type: 'tool_result';
  data: {
    toolCallId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  };
}

export interface SkillIndexResponse extends BaseResponse {
  type: 'skill_index';
  data: {
    skills: SkillSummary[];
  };
}

export interface SkillSummary {
  id: string;
  name: string;
  category: string;
  type: string;
  description: string;
  params: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
}

export interface SkillResultResponse extends BaseResponse {
  type: 'skill_result';
  data: {
    skillId: string;
    success: boolean;
    sql?: string;
    result?: unknown;
    error?: string;
  };
}

export interface ErrorResponse extends BaseResponse {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface DoneResponse extends BaseResponse {
  type: 'done';
  data?: {
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
  };
}

export interface PongResponse extends BaseResponse {
  type: 'pong';
}
```

### 7.3 REST API端点汇总

#### 7.3.1 API 版本与认证

所有 API 端点使用 `/api/v1/` 版本前缀。需要在请求头中携带 API Key 进行认证：

```
Authorization: Bearer <API_KEY>
X-Agent-Id: <agent_id>
X-Trace-Id: <optional_trace_id>
```

#### 7.3.2 分页参数

列表接口支持分页，参数如下：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码（从1开始）|
| `limit` | integer | 20 | 每页条数（最大100）|

响应中包含分页元数据：

```typescript
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

#### 7.3.3 端点列表

| 端点 | 方法 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| `/api/v1/health` | GET | 健康检查（无需认证）| - | `{status: "ok", timestamp, traceId}` |
| `/api/v1/skills` | GET | 列出Skills（分页）| Query: `page`, `limit`, `category`, `type` | `PaginatedResponse<SkillSummary>` |
| `/api/v1/skills/:id` | GET | 获取Skill详情 | - | `SkillDefinition` |
| `/api/v1/skills/:id/execute` | POST | 执行Skill | `{params: {...}}` | `SkillExecutionResult` |
| `/api/v1/config` | GET | 获取配置 | - | 配置对象 |
| `/api/v1/config` | PATCH | 部分更新配置 | 配置更新字段 | `{success: true}` |
| `/api/v1/sessions` | GET | 列出会话（分页）| Query: `page`, `limit`, `state` | `PaginatedResponse<SessionSummary>` |
| `/api/v1/sessions/:id` | GET | 获取会话详情 | - | `Session` |
| `/api/v1/sessions/:id` | DELETE | 结束会话 | - | `{success: true}` |
| `/api/v1/ws/stats` | GET | WebSocket连接统计 | - | `{total, byState}` |

#### 7.3.4 Skills API 示例

**列出 Skills（带分页和过滤）**

```http
GET /api/v1/skills?page=1&limit=20&category=scrolling HTTP/1.1
Authorization: Bearer sk-xxx
```

响应：
```json
{
  "data": [
    {
      "id": "frame_jank_detection",
      "name": "frame_jank_detection",
      "category": "scrolling",
      "type": "atomic",
      "description": "检测滚动过程中的掉帧",
      "params": [{"name": "process_name", "type": "string", "required": true}]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 35,
    "totalPages": 2
  }
}
```

**执行 Skill**

```http
POST /api/v1/skills/frame_jank_detection/execute HTTP/1.1
Authorization: Bearer sk-xxx
Content-Type: application/json

{
  "params": {
    "process_name": "com.example.app",
    "time_range_start": 1000000000,
    "time_range_end": 2000000000
  }
}
```

响应：
```json
{
  "success": true,
  "query": {
    "sql": "SELECT f.id as frame_id, f.ts, ... WHERE p.name LIKE '%' || $1 || '%' AND f.ts >= $2 ...",
    "bindings": [
      {"name": "process_name", "value": "com.example.app", "type": "string"},
      {"name": "time_range_start", "value": 1000000000, "type": "integer"}
    ]
  },
  "skillDescription": "检测滚动过程中的掉帧"
}
```

#### 7.3.5 Sessions API 示例

**列出会话**

```http
GET /api/v1/sessions?page=1&limit=20&state=active HTTP/1.1
Authorization: Bearer sk-xxx
```

**获取会话详情**

```http
GET /api/v1/sessions/session_abc123 HTTP/1.1
Authorization: Bearer sk-xxx
```

**删除会话**

```http
DELETE /api/v1/sessions/session_abc123 HTTP/1.1
Authorization: Bearer sk-xxx
```

#### 7.3.6 路由实现

```typescript
// server/src/routes/skills.ts

import {FastifyInstance, FastifyRequest} from 'fastify';
import {SkillRegistry} from '../services/skill_registry';
import {SkillProcessor} from '../services/skill_processor';

interface SkillListQuery {
  page?: number;
  limit?: number;
  category?: string;
  type?: string;
}

export function setupSkillRoutes(server: FastifyInstance, skillRegistry: SkillRegistry): void {
  const skillProcessor = new SkillProcessor(skillRegistry);
  
  // 列出 Skills（分页）
  server.get('/api/v1/skills', async (request: FastifyRequest<{Querystring: SkillListQuery}>) => {
    const {page = 1, limit = 20, category, type} = request.query;
    const offset = (page - 1) * limit;
    
    let skills = skillRegistry.getAll();
    
    // 过滤
    if (category) {
      skills = skills.filter(s => s.category === category);
    }
    if (type) {
      skills = skills.filter(s => s.type === type);
    }
    
    const total = skills.length;
    const paginatedSkills = skills.slice(offset, offset + limit);
    
    return {
      data: paginatedSkills.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        type: s.type,
        description: s.description,
        params: s.params,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });
  
  // 获取 Skill 详情
  server.get('/api/v1/skills/:id', async (request: FastifyRequest<{Params: {id: string}}>) => {
    const skill = skillRegistry.get(request.params.id);
    if (!skill) {
      throw new Error('Skill not found');
    }
    return skill;
  });
  
  // 执行 Skill
  server.post('/api/v1/skills/:id/execute', async (
    request: FastifyRequest<{
      Params: {id: string};
      Body: {params: Record<string, unknown>};
    }>
  ) => {
    const result = await skillProcessor.executeSkill(
      request.params.id,
      request.body.params
    );
    return result;
  });
}

// server/src/routes/sessions.ts

import {FastifyInstance, FastifyRequest} from 'fastify';
import {SessionManager} from '../services/session_manager';

interface SessionListQuery {
  page?: number;
  limit?: number;
  state?: string;
}

export function setupSessionRoutes(server: FastifyInstance, sessionManager: SessionManager): void {
  // 列出会话（分页）
  server.get('/api/v1/sessions', async (request: FastifyRequest<{Querystring: SessionListQuery}>) => {
    const {page = 1, limit = 20, state} = request.query;
    const offset = (page - 1) * limit;
    
    let sessions = sessionManager.getAllSessions();
    
    if (state) {
      sessions = sessions.filter(s => s.state === state);
    }
    
    const total = sessions.length;
    const paginatedSessions = sessions.slice(offset, offset + limit);
    
    return {
      data: paginatedSessions.map(s => ({
        id: s.id,
        agentId: s.agentId,
        state: s.state,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });
  
  // 获取会话详情
  server.get('/api/v1/sessions/:id', async (request: FastifyRequest<{Params: {id: string}}>) => {
    const session = sessionManager.getSessionById(request.params.id);
    if (!session) {
      throw new Error('Session not found');
    }
    return session;
  });
  
  // 删除会话
  server.delete('/api/v1/sessions/:id', async (request: FastifyRequest<{Params: {id: string}}>) => {
    const success = sessionManager.deleteSession(request.params.id);
    return {success};
  });
}
```

### 7.4 错误码定义

```typescript
// types/errors.ts

export enum ErrorCode {
  // 连接错误 (1xxx)
  CONNECTION_FAILED = 'E1001',
  CONNECTION_TIMEOUT = 'E1002',
  AUTHENTICATION_FAILED = 'E1003',
  
  // 请求错误 (2xxx)
  INVALID_MESSAGE = 'E2001',
  MISSING_PARAMETER = 'E2002',
  INVALID_PARAMETER = 'E2003',
  
  // 会话错误 (3xxx)
  SESSION_NOT_FOUND = 'E3001',
  SESSION_EXPIRED = 'E3002',
  
  // Skill错误 (4xxx)
  SKILL_NOT_FOUND = 'E4001',
  SKILL_EXECUTION_FAILED = 'E4002',
  SKILL_VALIDATION_FAILED = 'E4003',
  
  // LLM错误 (5xxx)
  LLM_PROVIDER_ERROR = 'E5001',
  LLM_RATE_LIMIT = 'E5002',
  LLM_CONTEXT_LENGTH_EXCEEDED = 'E5003',
  LLM_CONTENT_FILTERED = 'E5004',
  
  // 内部错误 (9xxx)
  INTERNAL_ERROR = 'E9001',
  NOT_IMPLEMENTED = 'E9002',
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  suggestion?: string;
}

export const ERROR_MESSAGES: Record<ErrorCode, ErrorDetails> = {
  [ErrorCode.CONNECTION_FAILED]: {
    code: ErrorCode.CONNECTION_FAILED,
    message: 'Failed to connect to server',
    retryable: true,
    suggestion: 'Check if the server is running',
  },
  [ErrorCode.SKILL_NOT_FOUND]: {
    code: ErrorCode.SKILL_NOT_FOUND,
    message: 'Skill not found',
    retryable: false,
    suggestion: 'Use list_skills to see available skills',
  },
  // ... 其他错误定义
};
```

---

## 第8章：数据模型

### 8.1 前后端共享类型（Zod Schema + TypeScript）

```typescript
// types/shared.ts

import {z} from 'zod';

// ============= 基础类型 =============

export const SceneTypeSchema = z.enum([
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
]);
export type SceneType = z.infer<typeof SceneTypeSchema>;

// ============= DataEnvelope =============

export const ColumnDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(['integer', 'float', 'string', 'timestamp', 'duration', 'boolean', 'enum']),
  unit: z.string().optional(),
  values: z.array(z.string()).optional(),
});
export type ColumnDefinition = z.infer<typeof ColumnDefinitionSchema>;

export const ArtifactDataSchema = z.object({
  columns: z.array(ColumnDefinitionSchema),
  rows: z.array(z.array(z.unknown())),
  totalRowCount: z.number(),
});
export type ArtifactData = z.infer<typeof ArtifactDataSchema>;

export const NumericStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  p50: z.number(),
  p90: z.number(),
  p99: z.number(),
});
export type NumericStats = z.infer<typeof NumericStatsSchema>;

export const StringStatsSchema = z.object({
  topValues: z.array(z.object({
    value: z.string(),
    count: z.number(),
  })),
  uniqueCount: z.number(),
});
export type StringStats = z.infer<typeof StringStatsSchema>;

export const ArtifactSummarySchema = z.object({
  estimatedTokens: z.number(),
  rowCount: z.number(),
  numericStats: z.record(NumericStatsSchema).optional(),
  stringStats: z.record(StringStatsSchema).optional(),
  sampleRows: z.array(z.array(z.unknown())).optional(),
  insights: z.array(z.string()).optional(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const DataEnvelopeSchema = z.object({
  status: z.enum(['success', 'error', 'partial']),
  metadata: z.object({
    tool: z.string(),
    execMs: z.number(),
    rowCount: z.number().optional(),
    columns: z.array(z.string()).optional(),
  }),
  summary: ArtifactSummarySchema.optional(),
  artifactRef: z.string().optional(),
  hint: z.string().optional(),
  error: z.string().optional(),
});
export type DataEnvelope = z.infer<typeof DataEnvelopeSchema>;

// ============= 分析计划 =============

export const AnalysisPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  requiredTools: z.array(z.string()),
  expectedOutputs: z.array(z.string()),
  completed: z.boolean(),
});
export type AnalysisPhase = z.infer<typeof AnalysisPhaseSchema>;

export const AnalysisPlanSchema = z.object({
  id: z.string(),
  sceneType: SceneTypeSchema,
  phases: z.array(AnalysisPhaseSchema),
  successCriteria: z.array(z.string()),
  estimatedSteps: z.number(),
  submittedAt: z.number(),
});
export type AnalysisPlan = z.infer<typeof AnalysisPlanSchema>;

// ============= 聊天消息 =============

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  artifactRef: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  timestamp: z.number(),
  toolCall: ToolCallSchema.optional(),
  toolResult: ToolResultSchema.optional(),
  metadata: z.object({
    isStreaming: z.boolean().optional(),
    clickableTimestamps: z.array(z.object({
      text: z.string(),
      tsNs: z.bigint(),
      startIndex: z.number(),
      endIndex: z.number(),
    })).optional(),
    clickableFrameIds: z.array(z.object({
      text: z.string(),
      frameId: z.number(),
      startIndex: z.number(),
      endIndex: z.number(),
    })).optional(),
  }).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
```

### 8.2 会话数据模型与存储策略

#### 8.2.1 会话数据模型

```typescript
// types/session.ts

import {z} from 'zod';
import {SceneTypeSchema, ChatMessageSchema, AnalysisPlanSchema} from './shared';

export const SessionStateSchema = z.enum([
  'created',
  'active',
  'analyzing',
  'completed',
  'error',
  'expired',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  userId: z.string().optional(),
  
  // 时间戳
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number(),           // 过期时间
  lastActiveAt: z.number(),        // 最后活跃时间
  
  state: SessionStateSchema,
  
  // Trace信息
  traceId: z.string().optional(),
  traceName: z.string().optional(),
  
  // 分析上下文
  sceneType: SceneTypeSchema.optional(),
  plan: AnalysisPlanSchema.optional(),
  
  // 对话历史
  messages: z.array(ChatMessageSchema),
  
  // 统计信息
  stats: z.object({
    toolCallCount: z.number(),
    totalInputTokens: z.number(),
    totalOutputTokens: z.number(),
    skillInvocations: z.record(z.number()),
    verificationResults: z.object({
      l1Issues: z.number(),
      l2Issues: z.number(),
      l3Triggered: z.boolean(),
    }),
  }),
  
  // 元数据
  metadata: z.record(z.unknown()).optional(),
});
export type Session = z.infer<typeof SessionSchema>;
```

#### 8.2.2 会话存储接口

```typescript
// server/src/services/session_store.ts

import {Session, SessionState} from '../types/session';

/**
 * 会话存储接口
 * 支持三种实现：内存（开发）、SQLite（生产单机）、Redis（生产分布式）
 */
export interface ISessionStore {
  /**
   * 创建会话
   */
  create(session: Session): Promise<Session>;
  
  /**
   * 获取会话
   */
  get(sessionId: string): Promise<Session | null>;
  
  /**
   * 通过 agentId 获取会话
   */
  getByAgentId(agentId: string): Promise<Session | null>;
  
  /**
   * 更新会话
   */
  update(sessionId: string, updates: Partial<Session>): Promise<Session | null>;
  
  /**
   * 删除会话
   */
  delete(sessionId: string): Promise<boolean>;
  
  /**
   * 列出所有会话
   */
  list(options?: {
    state?: SessionState;
    limit?: number;
    offset?: number;
  }): Promise<Session[]>;
  
  /**
   * 清理过期会话
   */
  cleanup(): Promise<number>;
  
  /**
   * 关闭存储连接
   */
  close(): Promise<void>;
}

/**
 * 会话存储配置
 */
export interface SessionStoreConfig {
  type: 'memory' | 'sqlite' | 'redis';
  // SQLite 配置
  sqlitePath?: string;
  // Redis 配置
  redisUrl?: string;
  // 通用配置
  defaultTtlMs: number;           // 默认过期时间（毫秒）
  cleanupIntervalMs: number;      // 清理间隔（毫秒）
  maxSessions?: number;           // 最大会话数
}

export const DEFAULT_SESSION_CONFIG: SessionStoreConfig = {
  type: 'sqlite',                 // 默认使用 SQLite（零配置、文件存储、重启不丢失）
  sqlitePath: './data/sessions.db',
  defaultTtlMs: 24 * 60 * 60 * 1000,  // 24小时
  cleanupIntervalMs: 60 * 60 * 1000,   // 每小时清理一次
  maxSessions: 10000,
};
```

#### 8.2.3 内存存储实现（开发环境）

```typescript
// server/src/services/stores/memory_session_store.ts

import {ISessionStore, SessionStoreConfig} from '../session_store';
import {Session, SessionState} from '../../types/session';

export class MemorySessionStore implements ISessionStore {
  private sessions: Map<string, Session> = new Map();
  private agentIdIndex: Map<string, string> = new Map(); // agentId -> sessionId
  private cleanupTimer: NodeJS.Timer | null = null;
  
  constructor(private readonly config: SessionStoreConfig) {
    this.startCleanupTimer();
  }
  
  async create(session: Session): Promise<Session> {
    // 设置过期时间
    const now = Date.now();
    const sessionWithExpiry: Session = {
      ...session,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      expiresAt: now + this.config.defaultTtlMs,
    };
    
    this.sessions.set(session.id, sessionWithExpiry);
    this.agentIdIndex.set(session.agentId, session.id);
    
    return sessionWithExpiry;
  }
  
  async get(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // 检查是否过期
    if (Date.now() > session.expiresAt) {
      await this.delete(sessionId);
      return null;
    }
    
    return session;
  }
  
  async getByAgentId(agentId: string): Promise<Session | null> {
    const sessionId = this.agentIdIndex.get(agentId);
    if (!sessionId) return null;
    return this.get(sessionId);
  }
  
  async update(sessionId: string, updates: Partial<Session>): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    
    const updated: Session = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    
    this.sessions.set(sessionId, updated);
    return updated;
  }
  
  async delete(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    this.sessions.delete(sessionId);
    this.agentIdIndex.delete(session.agentId);
    return true;
  }
  
  async list(options?: {state?: SessionState; limit?: number; offset?: number}): Promise<Session[]> {
    let sessions = Array.from(this.sessions.values());
    
    // 过滤过期会话
    const now = Date.now();
    sessions = sessions.filter(s => s.expiresAt > now);
    
    // 按状态过滤
    if (options?.state) {
      sessions = sessions.filter(s => s.state === options.state);
    }
    
    // 分页
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    
    return sessions.slice(offset, offset + limit);
  }
  
  async cleanup(): Promise<number> {
    const now = Date.now();
    let count = 0;
    
    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt) {
        await this.delete(sessionId);
        count++;
      }
    }
    
    return count;
  }
  
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.sessions.clear();
    this.agentIdIndex.clear();
  }
  
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      const cleaned = await this.cleanup();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired sessions`);
      }
    }, this.config.cleanupIntervalMs);
  }
}
```

#### 8.2.4 SQLite存储实现（生产单机）

```typescript
// server/src/services/stores/sqlite_session_store.ts

import Database from 'better-sqlite3';
import {ISessionStore, SessionStoreConfig} from '../session_store';
import {Session, SessionState} from '../../types/session';

export class SqliteSessionStore implements ISessionStore {
  private db: Database.Database;
  private cleanupTimer: NodeJS.Timer | null = null;
  
  constructor(private readonly config: SessionStoreConfig) {
    const dbPath = config.sqlitePath || './data/sessions.db';
    this.db = new Database(dbPath);
    this.initSchema();
    this.startCleanupTimer();
  }
  
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT UNIQUE NOT NULL,
        user_id TEXT,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        trace_id TEXT,
        trace_name TEXT,
        scene_type TEXT,
        plan_json TEXT,
        messages_json TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        metadata_json TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    `);
  }
  
  async create(session: Session): Promise<Session> {
    const now = Date.now();
    const sessionWithExpiry: Session = {
      ...session,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      expiresAt: now + this.config.defaultTtlMs,
    };
    
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, agent_id, user_id, state, created_at, updated_at, expires_at, 
        last_active_at, trace_id, trace_name, scene_type, plan_json, 
        messages_json, stats_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      sessionWithExpiry.id,
      sessionWithExpiry.agentId,
      sessionWithExpiry.userId,
      sessionWithExpiry.state,
      sessionWithExpiry.createdAt,
      sessionWithExpiry.updatedAt,
      sessionWithExpiry.expiresAt,
      sessionWithExpiry.lastActiveAt,
      sessionWithExpiry.traceId,
      sessionWithExpiry.traceName,
      sessionWithExpiry.sceneType,
      JSON.stringify(sessionWithExpiry.plan),
      JSON.stringify(sessionWithExpiry.messages),
      JSON.stringify(sessionWithExpiry.stats),
      JSON.stringify(sessionWithExpiry.metadata)
    );
    
    return sessionWithExpiry;
  }
  
  async get(sessionId: string): Promise<Session | null> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?');
    const row = stmt.get(sessionId, Date.now()) as Record<string, unknown> | undefined;
    
    if (!row) return null;
    
    return this.rowToSession(row);
  }
  
  async getByAgentId(agentId: string): Promise<Session | null> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE agent_id = ? AND expires_at > ?');
    const row = stmt.get(agentId, Date.now()) as Record<string, unknown> | undefined;
    
    if (!row) return null;
    
    return this.rowToSession(row);
  }
  
  async update(sessionId: string, updates: Partial<Session>): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    
    const updated: Session = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    
    const stmt = this.db.prepare(`
      UPDATE sessions SET 
        state = ?, updated_at = ?, last_active_at = ?,
        messages_json = ?, stats_json = ?, metadata_json = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updated.state,
      updated.updatedAt,
      updated.lastActiveAt,
      JSON.stringify(updated.messages),
      JSON.stringify(updated.stats),
      JSON.stringify(updated.metadata),
      sessionId
    );
    
    return updated;
  }
  
  async delete(sessionId: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(sessionId);
    return result.changes > 0;
  }
  
  async list(options?: {state?: SessionState; limit?: number; offset?: number}): Promise<Session[]> {
    let sql = 'SELECT * FROM sessions WHERE expires_at > ?';
    const params: unknown[] = [Date.now()];
    
    if (options?.state) {
      sql += ' AND state = ?';
      params.push(options.state);
    }
    
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(options?.limit || 100);
    params.push(options?.offset || 0);
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    
    return rows.map(row => this.rowToSession(row));
  }
  
  async cleanup(): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    const result = stmt.run(Date.now());
    return result.changes;
  }
  
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.db.close();
  }
  
  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      userId: row.user_id as string | undefined,
      state: row.state as SessionState,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      expiresAt: row.expires_at as number,
      lastActiveAt: row.last_active_at as number,
      traceId: row.trace_id as string | undefined,
      traceName: row.trace_name as string | undefined,
      sceneType: row.scene_type as Session['sceneType'],
      plan: row.plan_json ? JSON.parse(row.plan_json as string) : undefined,
      messages: JSON.parse(row.messages_json as string),
      stats: JSON.parse(row.stats_json as string),
      metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : undefined,
    };
  }
  
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      const cleaned = await this.cleanup();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired sessions from SQLite`);
      }
    }, this.config.cleanupIntervalMs);
  }
}
```

#### 8.2.5 SessionManager 更新

```typescript
// server/src/services/session_manager.ts

import {randomUUID} from 'crypto';
import {ISessionStore, SessionStoreConfig, DEFAULT_SESSION_CONFIG} from './session_store';
import {MemorySessionStore} from './stores/memory_session_store';
import {SqliteSessionStore} from './stores/sqlite_session_store';
import {Session, SessionState} from '../types/session';
import {StructuredLogger} from '../utils/logger';

const logger = new StructuredLogger('session_manager');

export class SessionManager {
  private store: ISessionStore;
  
  constructor(config: SessionStoreConfig = DEFAULT_SESSION_CONFIG) {
    // 根据配置选择存储实现
    switch (config.type) {
      case 'memory':
        this.store = new MemorySessionStore(config);
        logger.info('Using MemorySessionStore (development mode)');
        break;
      case 'sqlite':
        this.store = new SqliteSessionStore(config);
        logger.info('Using SqliteSessionStore', {path: config.sqlitePath});
        break;
      case 'redis':
        // Redis 实现可按需添加
        throw new Error('Redis session store not yet implemented');
      default:
        this.store = new SqliteSessionStore(config);
    }
  }
  
  createSession(agentId: string, userId?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: `session_${randomUUID()}`,
      agentId,
      userId,
      state: 'created',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DEFAULT_SESSION_CONFIG.defaultTtlMs,
      lastActiveAt: now,
      messages: [],
      stats: {
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        skillInvocations: {},
        verificationResults: {
          l1Issues: 0,
          l2Issues: 0,
          l3Triggered: false,
        },
      },
    };
    
    // 异步创建，同步返回
    this.store.create(session).catch(err => {
      logger.error('Failed to persist session', {error: err, sessionId: session.id});
    });
    
    return session;
  }
  
  getSession(agentId: string): Session | null {
    // 注意：这里为了兼容性使用同步接口
    // 实际应用中建议使用 async/await
    let result: Session | null = null;
    this.store.getByAgentId(agentId).then(s => result = s);
    return result;
  }
  
  async getSessionAsync(agentId: string): Promise<Session | null> {
    return this.store.getByAgentId(agentId);
  }
  
  async getSessionById(sessionId: string): Promise<Session | null> {
    return this.store.get(sessionId);
  }
  
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session | null> {
    return this.store.update(sessionId, updates);
  }
  
  endSession(agentId: string): void {
    this.store.getByAgentId(agentId).then(session => {
      if (session) {
        this.store.update(session.id, {state: 'completed'});
      }
    });
  }
  
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }
  
  async getAllSessions(): Promise<Session[]> {
    return this.store.list();
  }
  
  async cleanup(): Promise<number> {
    return this.store.cleanup();
  }
  
  async close(): Promise<void> {
    return this.store.close();
  }
}
```

### 8.3 Skill元数据模型

```typescript
// types/skill.ts

import {z} from 'zod';

export const SkillParamSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'integer', 'float', 'boolean']),
  required: z.boolean().default(false),
  description: z.string(),
  default: z.unknown().optional(),
});
export type SkillParam = z.infer<typeof SkillParamSchema>;

export const SkillOutputColumnSchema = z.object({
  name: z.string(),
  type: z.enum(['integer', 'float', 'string', 'timestamp', 'duration', 'boolean', 'enum']),
  unit: z.string().optional(),
  values: z.array(z.string()).optional(),
});
export type SkillOutputColumn = z.infer<typeof SkillOutputColumnSchema>;

export const SkillStepSchema = z.object({
  id: z.string(),
  skill: z.string().optional(),
  params: z.record(z.unknown()).optional(),
  type: z.enum(['skill', 'iterator', 'conditional', 'diagnostic']).optional(),
  forEach: z.string().optional(),
  filter: z.string().optional(),
  maxItems: z.number().optional(),
  template: z.string().optional(),
  body: z.array(z.lazy(() => SkillStepSchema)).optional(),
});
export type SkillStep = z.infer<typeof SkillStepSchema>;

export const SkillDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  type: z.enum(['atomic', 'composite', 'pipeline', 'module', 'deep']),
  description: z.string(),
  version: z.string(),
  params: z.array(SkillParamSchema),
  sql: z.string().optional(),
  outputSchema: z.object({
    columns: z.array(SkillOutputColumnSchema),
    displayLevel: z.enum(['summary', 'detail']),
  }).optional(),
  steps: z.array(SkillStepSchema).optional(),
  relatedTools: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  vendor: z.string().optional(),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
```

### 8.4 配置数据模型

```typescript
// types/config.ts

import {z} from 'zod';

export const LLMProviderConfigSchema = z.object({
  apiKey: z.string(),
  defaultModel: z.string(),
  maxTokens: z.number().default(8192),
  verificationModel: z.string().optional(),
});
export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;

export const ServerConfigSchema = z.object({
  server: z.object({
    port: z.number().default(3001),
    host: z.string().default('0.0.0.0'),
  }),
  cors: z.object({
    origins: z.array(z.string()),
  }),
  llm: z.object({
    activeProvider: z.enum(['anthropic', 'openai', 'google']),
    providers: z.object({
      anthropic: LLMProviderConfigSchema.optional(),
      openai: LLMProviderConfigSchema.optional(),
      google: LLMProviderConfigSchema.optional(),
    }),
  }),
  skills: z.object({
    libraryPath: z.string(),
  }),
  logging: z.object({
    enabled: z.boolean(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    modules: z.record(z.enum(['debug', 'info', 'warn', 'error'])).optional(),
  }),
  features: z.object({
    l3ReviewEnabled: z.boolean().default(false),
  }),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
```

---

## 第9章：开发阶段规划

### 9.1 Phase 1：基础骨架（2周）

**目标**：搭建前后端基础架构，实现插件注册和WebSocket连接

**前端交付物**：
- [ ] 插件注册入口 (`index.ts`)
- [ ] 侧边栏容器组件 (`sidebar_container.ts`)
- [ ] 顶部栏组件 (`top_bar.ts`)
- [ ] WebSocket客户端 (`websocket_client.ts`)
- [ ] 基础样式 (`openperfetto.scss`)
- [ ] 国际化基础 (`i18n/zh.ts`, `i18n/en.ts`)

**后端交付物**：
- [ ] Fastify服务入口
- [ ] WebSocket路由
- [ ] 配置加载
- [ ] 日志系统

**依赖关系**：无外部依赖

**预估工作量**：2人 × 2周

### 9.2 Phase 2：Agent核心（3周）

**目标**：实现Agent Loop状态机、上下文管理和Planning Gate

**前端交付物**：
- [ ] AgentLoop状态机 (`agent_loop.ts`)
- [ ] ContextManager (`context_manager.ts`)
- [ ] PlanningGate (`planning_gate.ts`)
- [ ] SceneClassifier (`scene_classifier.ts`)
- [ ] ArtifactStore (`artifact_store.ts`)
- [ ] AI对话模块 (`ai_chat.ts`)
- [ ] LLM流式处理 (`llm_stream_handler.ts`)

**后端交付物**：
- [ ] LLMProxy多Provider支持
- [ ] 会话管理器
- [ ] Skill标记解析

**依赖关系**：Phase 1

**预估工作量**：2人 × 3周

### 9.3 Phase 3：Tool和Skill系统（3周）

**目标**：实现10个前端Tool和初期Skill库

**前端交付物**：
- [ ] ToolRegistry (`tool_registry.ts`)
- [ ] 10个Tool实现
- [ ] Skill索引缓存

**后端交付物**：
- [ ] SkillRegistry
- [ ] SkillProcessor
- [ ] YAML解析器
- [ ] 初期Skill库（30+ YAML文件）
- [ ] Vendor Override机制

**依赖关系**：Phase 2

**预估工作量**：2人 × 3周

### 9.4 Phase 4：验证系统（1.5周）

**目标**：实现L1/L2验证器

**前端交付物**：
- [ ] Verifier (`verifier.ts`)
- [ ] L1启发式规则集
- [ ] L2计划遵从检查
- [ ] L3接口预留

**依赖关系**：Phase 3

**预估工作量**：1人 × 1.5周

### 9.5 Phase 5：UI完善（2周）

**目标**：完善搜索、标记、设置等UI模块

**前端交付物**：
- [ ] 搜索与Pin模块 (`search_pin.ts`)
- [ ] 标记与跳转模块 (`markers_jump.ts`)
- [ ] 设置模块 (`settings.ts`)
- [ ] AI标记/Pin可视化
- [ ] 响应式布局优化
- [ ] 主题完善

**依赖关系**：Phase 2, Phase 4

**预估工作量**：1人 × 2周

### 9.6 总体时间线

```
Week 1-2   : Phase 1 (基础骨架)
Week 3-5   : Phase 2 (Agent核心)
Week 6-8   : Phase 3 (Tool和Skill)
Week 9-10  : Phase 4 (验证系统) + Phase 5 开始
Week 11-12 : Phase 5 (UI完善) + 集成测试
```

**总计**：约12周（3个月），2-3人团队

---

## 第10章：测试策略

### 10.1 单元测试

**测试框架**：Vitest（前端）/ Jest（后端）

**覆盖范围**：
- Agent核心逻辑（状态机转换、上下文构建）
- Tool执行（参数验证、结果格式化）
- Skill解析（YAML解析、参数替换）
- 数据压缩（ArtifactStore摘要生成）
- 验证规则（L1规则、L2检查）

**示例测试**：

```typescript
// tests/agent/agent_loop.test.ts

import {describe, it, expect, beforeEach} from 'vitest';
import {AgentLoop, AgentLoopState} from '../../src/agent/agent_loop';

describe('AgentLoop', () => {
  let agentLoop: AgentLoop;
  
  beforeEach(() => {
    // Mock trace and state
    agentLoop = new AgentLoop(mockTrace, mockState, mockOnStateChange);
  });
  
  describe('State Transitions', () => {
    it('should transition from IDLE to CLASSIFYING on user message', async () => {
      expect(agentLoop.state).toBe(AgentLoopState.IDLE);
      
      await agentLoop.sendMessage('Analyze scrolling jank');
      
      // Eventually should be in AWAITING_PLAN
      expect(agentLoop.state).toBe(AgentLoopState.AWAITING_PLAN);
    });
    
    it('should not accept messages when not IDLE', async () => {
      agentLoop.state = AgentLoopState.AWAITING_LLM;
      
      await expect(agentLoop.sendMessage('test'))
        .rejects.toThrow('Cannot send message in state');
    });
  });
  
  describe('Scene Classification', () => {
    it('should classify scrolling scenario', () => {
      const classifier = new SceneClassifier();
      const scene = classifier.classifyFromKeywords('滑动卡顿');
      expect(scene).toBe('scrolling');
    });
  });
});
```

### 10.2 集成测试

**测试范围**：
- WebSocket连接和消息传递
- 前后端Skill调用流程
- LLM流式响应处理
- 端到端分析流程

**测试环境**：
- Mock LLM Provider（返回预定义响应）
- 测试用Trace文件

### 10.3 E2E测试场景

**测试框架**：Playwright

**关键场景**：

1. **新用户首次使用**
   - 打开侧边栏
   - 输入分析请求
   - 验证流式输出显示
   - 验证时间戳点击跳转

2. **滑动分析流程**
   - 加载测试Trace
   - 输入"分析滑动卡顿"
   - 验证Planning Gate触发
   - 验证Skill调用
   - 验证AI标记创建

3. **搜索和Pin**
   - 输入搜索查询
   - 验证结果显示
   - 点击Pin按钮
   - 验证Track置顶

4. **设置和主题**
   - 切换主题
   - 验证样式变化
   - 切换语言
   - 验证文本变化

### 10.4 测试工具

| 用途 | 工具 | 说明 |
|------|------|------|
| 单元测试 | Vitest | 前端TypeScript测试 |
| 单元测试 | Jest | 后端Node.js测试 |
| E2E测试 | Playwright | 浏览器自动化 |
| API测试 | Supertest | HTTP/WebSocket测试 |
| Mock | MSW | 网络请求Mock |
| 覆盖率 | c8 | 代码覆盖率报告 |

---

## 第11章：附录

### 11.1 SQL Schema参考（关键Perfetto表）

#### 帧时间线

```sql
-- 实际帧时间线
actual_frame_timeline_slice (
  id INTEGER,           -- Slice ID
  ts INTEGER,           -- 时间戳（纳秒）
  dur INTEGER,          -- 持续时间（纳秒）
  track_id INTEGER,     -- Track ID
  name TEXT,            -- Slice名称
  upid INTEGER,         -- 进程ID
  layer_name TEXT,      -- Layer名称
  jank_type TEXT,       -- Jank类型
  on_time_finish INTEGER -- 是否按时完成
)

-- 预期帧时间线
expected_frame_timeline_slice (
  id INTEGER,
  ts INTEGER,
  dur INTEGER,
  -- 类似字段
)
```

#### 进程和线程

```sql
process (
  upid INTEGER PRIMARY KEY,
  pid INTEGER,
  name TEXT,
  uid INTEGER,
  cmdline TEXT
)

thread (
  utid INTEGER PRIMARY KEY,
  tid INTEGER,
  name TEXT,
  upid INTEGER,
  is_main_thread INTEGER
)
```

#### Slice（事件）

```sql
slice (
  id INTEGER PRIMARY KEY,
  ts INTEGER,
  dur INTEGER,
  track_id INTEGER,
  category TEXT,
  name TEXT,
  depth INTEGER,
  parent_id INTEGER
)

thread_track (
  id INTEGER PRIMARY KEY,
  utid INTEGER,
  name TEXT
)
```

### 11.2 LLM Provider配置示例

```yaml
# config/llm_providers.yaml

providers:
  anthropic:
    api_key: "${ANTHROPIC_API_KEY}"
    default_model: "claude-sonnet-4-20250514"
    verification_model: "claude-3-haiku-20240307"
    max_tokens: 8192
    
  openai:
    api_key: "${OPENAI_API_KEY}"
    default_model: "gpt-4o"
    max_tokens: 8192
    
  google:
    api_key: "${GOOGLE_API_KEY}"
    default_model: "gemini-2.5-pro"
    max_tokens: 8192

# 当前活动的Provider
active_provider: "anthropic"

# 故障转移配置
failover:
  enabled: true
  order:
    - anthropic
    - openai
    - google
```

### 11.3 完整错误码表

| 错误码 | 类别 | 描述 | 可重试 | 建议操作 |
|--------|------|------|--------|----------|
| E1001 | 连接 | 连接服务器失败 | 是 | 检查网络连接 |
| E1002 | 连接 | 连接超时 | 是 | 重试或检查服务器状态 |
| E1003 | 连接 | 认证失败 | 否 | 检查API Key配置 |
| E2001 | 请求 | 消息格式无效 | 否 | 检查请求格式 |
| E2002 | 请求 | 缺少必要参数 | 否 | 补充缺失参数 |
| E2003 | 请求 | 参数值无效 | 否 | 修正参数值 |
| E3001 | 会话 | 会话不存在 | 否 | 重新建立会话 |
| E3002 | 会话 | 会话已过期 | 否 | 重新建立会话 |
| E4001 | Skill | Skill不存在 | 否 | 使用list_skills查看可用Skill |
| E4002 | Skill | Skill执行失败 | 是 | 检查参数或重试 |
| E4003 | Skill | Skill参数验证失败 | 否 | 修正参数 |
| E5001 | LLM | Provider错误 | 是 | 等待后重试 |
| E5002 | LLM | 请求频率限制 | 是 | 等待后重试 |
| E5003 | LLM | 上下文长度超限 | 否 | 减少消息长度 |
| E5004 | LLM | 内容被过滤 | 否 | 修改输入内容 |
| E9001 | 内部 | 内部错误 | 是 | 报告Bug |
| E9002 | 内部 | 功能未实现 | 否 | 等待后续版本 |

### 11.4 国际化字符串参考

```typescript
// i18n/zh.ts

export const zh = {
  // 顶栏
  'topbar.toggleTheme': '切换主题',
  'topbar.collapse': '收起侧边栏',
  
  // 搜索与Pin
  'searchPin.title': '搜索与Pin',
  'searchPin.placeholder': '输入 进程+线程，如 surf+vsync',
  'searchPin.history': '搜索历史',
  'searchPin.results': '搜索结果',
  'searchPin.presets': '预置场景',
  'searchPin.goTo': '跳转',
  'searchPin.pin': '置顶',
  'searchPin.managePresets': '管理预置',
  
  // 标记
  'markers.title': '标记列表',
  'markers.hint': '选中Slice后按E键添加标记',
  'markers.empty': '暂无标记',
  'markers.editNote': '编辑备注',
  'markers.remove': '删除标记',
  'markers.addNote': '添加备注...',
  
  // AI对话
  'aiChat.title': 'AI分析',
  'aiChat.inputPlaceholder': '描述你想分析的问题...',
  'aiChat.waitingResponse': '等待响应...',
  'aiChat.send': '发送',
  'aiChat.roleUser': '你',
  'aiChat.roleAssistant': 'AI',
  'aiChat.roleTool': '工具',
  'aiChat.roleSystem': '系统',
  'aiChat.toolCall': '调用工具',
  'aiChat.toolSuccess': '执行成功',
  'aiChat.toolError': '执行失败',
  'aiChat.welcomeTitle': '你好！我是你的AI分析助手',
  'aiChat.welcomeText': '我可以帮助你分析性能问题。试试这些示例：',
  'aiChat.welcomeHint1': '"分析这个trace的滑动卡顿问题"',
  'aiChat.welcomeHint2': '"这是冷启动场景，分析启动耗时"',
  'aiChat.welcomeHint3': '"为什么主线程被阻塞了？"',
  
  // 设置
  'settings.title': '设置',
  'settings.tabGeneral': '通用',
  'settings.tabPresets': '预置场景',
  'settings.tabAbout': '关于',
  'settings.theme': '主题',
  'settings.themeLight': '浅色',
  'settings.themeDark': '深色',
  'settings.language': '语言',
  'settings.editPreset': '编辑',
  'settings.deletePreset': '删除',
  'settings.addPreset': '添加预置场景',
  'settings.editPresetTitle': '编辑预置场景',
  'settings.presetName': '场景名称',
  'settings.presetThreads': '线程列表',
  'settings.addThread': '添加线程',
  'settings.cancel': '取消',
  'settings.save': '保存',
  'settings.version': '版本',
  'settings.aboutDescription': '基于Perfetto的AI增强性能分析工具',
};
```

---

## 文档版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0 | 2026-04-03 | OpenPerfetto Team | 初始版本 |
| 1.1 | 2026-04-03 | OpenPerfetto Team | 修订前端、Agent引擎、Tool系统相关章节（Task #10） |
| 1.2 | 2026-04-03 | OpenPerfetto Team | 修订后端服务、通信协议、数据模型、Skill系统相关章节（Task #11） |

---

## 修订记录（v1.1）

本次修订针对前端插件、Agent核心引擎、Tool系统三个模块进行了重大改进，修复了8个关键问题：

### 严重问题修复

| 问题编号 | 问题描述 | 修复内容 | 影响章节 |
|----------|----------|----------|----------|
| C2 | 侧边栏集成方式错误 | 将自建 SidebarContainer 改为 Page 组件方式，通过 `trace.pages.registerPage()` 注册，并使用 `trace.sidebar.addMenuItem()` 添加入口 | 2.3 |
| C3 | 插件状态管理错误 | 使用 `trace.mountStore()` API 替代 props 传递，添加 migration 函数，使用 `trace.trash` 进行资源清理 | 2.2.1 |
| C6 | Token预算过小且固定化 | 改为动态预算机制，基础预算 8192，复杂场景（ANR、冷启动）提升到 16384，按场景配置分配比例 | 3.2 |
| C7 | trace_process_flow缺Binder追踪 | 补充完整的 Binder transaction 追踪 SQL，输出包含 from_pid, to_pid, round_trip 时间 | 4.2.4 |

### 中等问题修复

| 问题编号 | 问题描述 | 修复内容 | 影响章节 |
|----------|----------|----------|----------|
| M1 | L1验证规则仅5条 | 扩展至20条规则，新增时间戳递增性、进程状态一致性、GC暂停异常、主线程IO、Binder延迟等检查 | 3.6 |
| M3 | Artifact压缩丢失率过高 | 改为分位数采样策略（p0-p99.9），保留极值（Top 5 + Bottom 5），目标 token 提升到 800-1000 | 3.5 |
| M4 | 流式LLM响应缺增量UI更新 | 添加 100ms 防抖缓冲机制，每次 buffer flush 触发 `m.redraw()` | 3.1 |
| M5 | Agent Loop UI线程阻塞 | 添加进度回调接口 `onProgress`，在 SQL 查询间添加 `scheduler.yield()` 让出 UI 线程 | 3.1 |

### 新增接口

1. **AgentProgress**: 进度信息接口，用于显示分析进度条
2. **scheduler.yield()**: UI 线程调度器，避免长时间阻塞
3. **migrateState()**: 状态版本迁移函数
4. **NumericStats 扩展**: 添加 p25, p75, p95, p99.9 分位数

### 废弃接口

1. **SidebarContainer**: 已替换为 OpenPerfettoPage
2. **sidebarExpanded 状态**: 改为 Page 模式后不再需要

### 与 Perfetto 源码对齐

本次修订参考了以下 Perfetto 源码文件，确保 API 调用方式 100% 一致：

- `ui/src/public/plugin.ts`: PerfettoPlugin 接口
- `ui/src/public/trace.ts`: Trace 接口（mountStore, trash 等）
- `ui/src/public/sidebar.ts`: SidebarManager 接口
- `ui/src/public/workspace.ts`: TrackNode 的 pin/reveal 方法
- `ui/src/plugins/com.google.PerfettoMcp/index.ts`: MCP 插件参考实现

---

## 修订记录（v1.2）

本次修订针对后端服务、通信协议、数据模型、Skill系统四个模块进行了重大改进，修复了8个关键问题：

### 严重问题修复

| 问题编号 | 问题描述 | 修复内容 | 影响章节 |
|----------|----------|----------|----------|
| C1 | SQL注入风险 | 将字符串替换改为参数化查询方案，设计 `ParameterizedQuery` 接口和 `SqlSanitizer` 工具类，添加白名单验证 | 5.6, 6.3 |
| C4 | WebSocket连接管理不完整 | 添加心跳超时检测（90秒）、僵尸连接清理（30秒扫描）、背压处理、连接池管理、消息优先级队列 | 5.4, 7.1 |
| C5 | LLM Proxy缺保护机制 | 添加指数退避重试（1s/2s/4s）、熔断器模式（关闭→半开→打开）、Provider故障转移、Token计量、速率限制、请求缓存 | 5.5 |
| C8 | 会话存储策略未定义 | 定义 `ISessionStore` 接口，提供三种实现（Memory/SQLite/Redis），默认使用 SQLite，添加过期策略（24小时） | 8.2 |

### 中等问题修复

| 问题编号 | 问题描述 | 修复内容 | 影响章节 |
|----------|----------|----------|----------|
| M2 | Skill库缺关键领域 | 补充9个新Skill：内存分析3个、电量分析3个、网络分析2个、Choreographer分析1个，总数从26个增至35+ | 6.4 |
| M6 | Fastify缺全局钩子和追踪链 | 添加 `onRequest` 钩子（生成traceId）、`onResponse` 钩子（结构化日志）、`setErrorHandler`（错误分类）、请求超时配置 | 5.2 |
| M7 | Pipeline/Module/Deep Skill类型未实现 | Pipeline实现流式执行和步骤间数据传递，Module实现可重用组合和缓存，Deep实现自适应分析路径 | 6.2 |
| M8 | REST API设计不规范 | 添加版本前缀 `/api/v1/`、分页参数（page/limit）、API Key认证、规范化端点设计 | 7.3 |

### 新增接口

1. **SqlSanitizer**: SQL安全工具类，提供参数清理和注入检测
2. **ParameterizedQuery**: 参数化查询接口，支持类型安全的参数绑定
3. **CircuitBreaker**: 熔断器类，实现服务保护模式
4. **RateLimiter**: 速率限制器，支持 RPM 和 TPM 限制
5. **TokenMeter**: Token计量器，支持用户配额管理
6. **ConnectionPool**: WebSocket连接池管理器
7. **PriorityMessageQueue**: 消息优先级队列
8. **ISessionStore**: 会话存储接口（Memory/SQLite/Redis实现）
9. **StructuredLogger**: 结构化日志工具类
10. **PipelineExecutor**: Pipeline Skill执行引擎
11. **ModuleExecutor**: Module Skill执行引擎
12. **DeepExecutor**: Deep Skill执行引擎

### 新增Skill

| 领域 | Skill ID | 描述 |
|------|----------|------|
| 内存 | `memory_leak_detection` | 内存泄漏检测，分析堆增长模式 |
| 内存 | `gc_pause_analysis` | GC暂停分析，统计GC耗时分布 |
| 内存 | `heap_allocation_hotspot` | 堆分配热点，识别高频分配调用栈 |
| 电量 | `wakelock_analysis` | Wakelock分析，检测持锁过长 |
| 电量 | `cpu_wake_frequency` | CPU唤醒频率分析，检测频繁唤醒 |
| 电量 | `background_service_drain` | 后台Service电量消耗分析 |
| 网络 | `network_request_latency` | 网络请求延迟分析 |
| 网络 | `dns_resolution_delay` | DNS解析延迟检测 |
| Choreographer | `choreographer_frame_analysis` | Choreographer帧回调分析 |

### REST API变更

所有API端点更新为带版本前缀：

| 旧端点 | 新端点 | 变更说明 |
|--------|--------|----------|
| `/health` | `/api/v1/health` | 添加版本前缀，返回traceId |
| `/api/skills` | `/api/v1/skills` | 添加分页参数、分类过滤 |
| `/api/skills/:id` | `/api/v1/skills/:id` | 无变化 |
| - | `/api/v1/skills/:id/execute` | 新增：执行Skill |
| `/api/config` | `/api/v1/config` | POST改为PATCH |
| `/api/sessions/:id` | `/api/v1/sessions/:id` | 无变化 |
| - | `/api/v1/sessions` | 新增：列出会话（分页） |
| - | `/api/v1/ws/stats` | 新增：WebSocket连接统计 |

### 配置变更

```typescript
// 新增会话存储配置
interface SessionStoreConfig {
  type: 'memory' | 'sqlite' | 'redis';
  sqlitePath?: string;
  redisUrl?: string;
  defaultTtlMs: number;        // 默认24小时
  cleanupIntervalMs: number;   // 默认1小时
}

// 新增WebSocket服务器配置
interface WebSocketServerConfig {
  maxTotalConnections: number;     // 默认1000
  maxConnectionsPerUser: number;   // 默认5
  heartbeatTimeout: number;        // 默认90秒
  maxBufferedAmount: number;       // 默认1MB
}

// 新增LLM故障转移配置
interface FailoverConfig {
  enabled: boolean;
  order: Array<'anthropic' | 'openai' | 'google'>;
}
```

---

**文档结束**
```

