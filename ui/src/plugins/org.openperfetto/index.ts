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

import m from 'mithril';
import {PerfettoPlugin} from '../../public/plugin';
import {App} from '../../public/app';
import {RouteArgs} from '../../public/route_schema';
import {Trace} from '../../public/trace';
import {Store} from '../../base/store';
import {OpenPerfettoPage} from './sidebar/openperfetto_page';
import {WebSocketClient} from './services/websocket_client';
import {AgentLoop} from './agent/agent_loop';
import {focusSearchInput} from './sidebar/search_pin';
import {syncMarkerRegistry} from './sidebar/marker_registry';
import {opLogger} from './utils/logger';
import {
  OpenPerfettoState,
  createDefaultState,
  migrateState,
  AIMarker,
} from './types/plugin_state';
import {Time, time} from '../../base/time';
import {LONG, NUM} from '../../trace_processor/query_result';

// ─────────────────────────────────────────────────────────────
// 模块级侧边栏状态（全局单例）
// ─────────────────────────────────────────────────────────────

type SidebarState = 'open' | 'closed';
let sidebarState: SidebarState = 'open';
let sidebarContainer: HTMLDivElement | null = null;
let toggleButton: HTMLButtonElement | null = null;
let sidebarWidth = 0;
let isResizing = false;
let mutationObserver: MutationObserver | null = null;

type TraceContext = {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  agentLoop: AgentLoop;
};
let currentTraceCtx: TraceContext | null = null;

// ─────────────────────────────────────────────────────────────
// Mithril 侧边栏根组件（检查 currentTraceCtx 决定渲染内容）
// ─────────────────────────────────────────────────────────────

const SidebarRootComponent: m.Component = {
  view(): m.Children {
    if (!currentTraceCtx) {
      return m('.openperfetto-no-trace', [
        m(
          'i.pf-icon',
          {style: 'font-size: 48px; opacity: 0.3;'},
          'psychology',
        ),
        m(
          'p',
          {},
          'Load a trace to start OpenPerfetto AI analysis',
        ),
      ]);
    }
    return m(OpenPerfettoPage, {
      trace: currentTraceCtx.trace,
      store: currentTraceCtx.store,
      agentLoop: currentTraceCtx.agentLoop,
      onCollapse: closeSidebar,
    });
  },
};

// ─────────────────────────────────────────────────────────────
// 宽度工具函数
// ─────────────────────────────────────────────────────────────

function clampWidth(w: number): number {
  const vw = window.innerWidth;
  return Math.max(vw * 0.25, Math.min(vw * 0.5, w));
}

function applySidebarWidth(px: number): void {
  document.documentElement.style.setProperty(
    '--openperfetto-sidebar-width',
    `${px}px`,
  );
}

// ─────────────────────────────────────────────────────────────
// 拖拽调整宽度
// ─────────────────────────────────────────────────────────────

function onResizeStart(e: MouseEvent): void {
  isResizing = true;
  e.preventDefault();
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent): void {
  if (!isResizing) return;
  sidebarWidth = clampWidth(e.clientX);
  applySidebarWidth(sidebarWidth);
}

function onResizeEnd(): void {
  isResizing = false;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
}

// ─────────────────────────────────────────────────────────────
// 侧边栏开关控制
// ─────────────────────────────────────────────────────────────

function openSidebar(): void {
  sidebarState = 'open';
  if (sidebarContainer) {
    sidebarContainer.style.display = 'flex';
  }
  document
    .querySelector('.pf-ui-main')
    ?.classList.add('pf-ui-main--openperfetto-active');
  updateToggleButton();
  m.redraw();
}

function closeSidebar(): void {
  sidebarState = 'closed';
  if (sidebarContainer) {
    sidebarContainer.style.display = 'none';
  }
  document
    .querySelector('.pf-ui-main')
    ?.classList.remove('pf-ui-main--openperfetto-active');
  updateToggleButton();
  m.redraw();
}

function updateToggleButton(): void {
  if (!toggleButton) return;
  if (sidebarState === 'open') {
    toggleButton.style.display = 'none';
    document.body.classList.remove('openperfetto-toggle-active');
  } else {
    toggleButton.style.display = 'flex';
    document.body.classList.add('openperfetto-toggle-active');
    toggleButton.style.top = '6px';

    const pfSidebar = document.querySelector('.pf-sidebar');
    const isOldVisible =
      pfSidebar != null &&
      !pfSidebar.classList.contains('pf-sidebar--hidden');

    if (isOldVisible) {
      // 旧侧边栏展开：从 CSS 变量直接计算最终位置，避免依赖动画中间帧的 getBoundingClientRect()
      // --sidebar-width 定义在 :root，直接从 documentElement 读取
      const rawWidth = getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-width')
        .trim();
      const parsedWidth = parseInt(rawWidth, 10);
      const finalWidth = isNaN(parsedWidth) ? 256 : parsedWidth;
      // 菜单按钮 left = sidebarWidth - 44px（参见 sidebar.scss line 197）
      // toggle 按钮放在菜单按钮左侧：menuBtnLeft - 36（按钮宽32 + 间距4）
      const menuBtnLeft = finalWidth - 44;
      toggleButton.style.left = `${menuBtnLeft - 36}px`;
    } else {
      // 旧侧边栏折叠：放在左侧边缘，菜单按钮会被 CSS 右移
      toggleButton.style.left = '10px';
    }
  }
}

// syncMarkerRegistry 已移至 ./sidebar/marker_registry.ts 以避免循环依赖

/**
 * 处理快捷键 E 标记逻辑
 * - 已选中 slice: 查询 slice 详细信息并创建标记
 * - 未选中: 使用鼠标悬停时间戳创建位置标记
 */
async function handleMarkerShortcut(): Promise<void> {
  if (!currentTraceCtx) return;

  const {trace, store} = currentTraceCtx;
  const selection = trace.selection.selection;

  try {
    let marker: AIMarker;

    if (selection.kind === 'track_event') {
      // 已选中 slice：查询详细信息
      const eventId = selection.eventId;
      const sql = `
        SELECT
          s.id, s.ts, s.dur, s.name AS slice_name,
          s.track_id,
          t.name AS thread_name,
          p.name AS process_name
        FROM slice s
        JOIN thread_track tt ON s.track_id = tt.id
        JOIN thread t ON tt.utid = t.utid
        LEFT JOIN process p ON t.upid = p.upid
        WHERE s.id = ${eventId}
      `;

      const result = await trace.engine.query(sql);
      let ts = 0n;
      let dur = 0n;
      let sliceName = '';
      let threadName = '';
      let processName = '';
      let trackId = 0;

      opLogger.debug('handleMarkerShortcut: querying slice', {eventId});

      for (const it = result.iter({
        ts: LONG,
        dur: LONG,
        slice_name: 'str',
        track_id: NUM,
        thread_name: 'str',
        process_name: 'str',
      }); it.valid(); it.next()) {
        ts = it.ts as unknown as bigint;
        dur = it.dur as unknown as bigint;
        sliceName = it.slice_name;
        trackId = Number(it.track_id);
        threadName = it.thread_name;
        processName = it.process_name;
        opLogger.debug('handleMarkerShortcut: slice result', {ts: ts.toString(), dur: dur.toString(), trackId, sliceName, threadName, processName});
        break;
      }

      if (ts === 0n) {
        // 查询失败，降级使用 selection 自身的 ts
        ts = selection.ts as unknown as bigint;
        dur = (selection.dur ?? 0n) as unknown as bigint;
      }

      // 记录当前 timeline 缩放状态
      const visWindow = trace.timeline.visibleWindow;
      const timelineState = {
        visibleWindowStart: visWindow.start.toTime().toString(),
        visibleWindowEnd: visWindow.end.toTime().toString(),
      };

      // 通过 trackIds tag 查找正确的 track URI（原 /thread_track_${id} 格式在 workspace 中不存在）
      let relatedTrackUri = '';
      if (trackId > 0) {
        const matchingTrack = trace.tracks
          .getAllTracks()
          .find((t) => t.tags?.trackIds?.includes(trackId));
        if (matchingTrack) {
          relatedTrackUri = matchingTrack.uri;
          opLogger.debug('handleMarkerShortcut: found relatedTrackUri', {trackId, uri: relatedTrackUri});
        } else {
          opLogger.warn(`handleMarkerShortcut: no track found for trackId=${trackId}`);
        }
      }

      // 创建 Perfetto Note
      const noteId = createPerfettoNote(trace, ts, dur);

      marker = {
        id: noteId,
        sliceId: eventId,
        timestamp: ts,
        duration: dur,
        name: sliceName || 'User Marker',
        note: '',
        severity: 'info',
        createdAt: Date.now(),
        isAI: false,
        processName: processName || '',
        threadName: threadName || '',
        sliceName: sliceName || '',
        color: '#34a853',
        timelineState,
        relatedTrackUri,
      };
    } else {
      // 未选中 slice：优先使用鼠标悬停时间戳，降级使用可视窗口中点
      const hoverTs = trace.timeline.hoverCursorTimestamp;
      const visWindow = trace.timeline.visibleWindow;
      let ts: time;
      if (hoverTs !== undefined) {
        ts = hoverTs;
        opLogger.debug('handleMarkerShortcut: using hover timestamp', {ts: ts.toString()});
      } else {
        // 降级：使用当前可视窗口的中间时间点
        const start = visWindow.start.toTime();
        const end = visWindow.end.toTime();
        ts = Time.fromRaw(start + (end - start) / 2n);
        opLogger.info('handleMarkerShortcut: no hover, using visible window midpoint', {ts: ts.toString()});
      }

      // 记录当前 timeline 缩放状态
      const timelineState = {
        visibleWindowStart: visWindow.start.toTime().toString(),
        visibleWindowEnd: visWindow.end.toTime().toString(),
      };

      // 创建 Perfetto Note
      const noteId = createPerfettoNote(trace, ts, 0n);

      marker = {
        id: noteId,
        sliceId: 0,
        timestamp: ts,
        duration: 0n,
        name: 'Position Marker',
        note: '',
        severity: 'info',
        createdAt: Date.now(),
        isAI: false,
        processName: '',
        threadName: '',
        sliceName: '',
        color: '#34a853',
        timelineState,
        relatedTrackUri: '',
      };
    }

    // 写入 Store（先计算新数组，再 edit，最后同步注册表——避免依赖 store.state 的时序）
    const updatedMarkers = [...store.state.markers, marker];
    store.edit((draft) => {
      draft.markers = updatedMarkers;
    });
    syncMarkerRegistry(updatedMarkers);
    opLogger.info('handleMarkerShortcut: marker created', {
      id: marker.id,
      timestamp: marker.timestamp.toString(),
      sliceId: marker.sliceId,
      relatedTrackUri: marker.relatedTrackUri,
      totalMarkers: updatedMarkers.length,
    });

    // 如果侧边栏关闭则打开
    if (sidebarState === 'closed') {
      openSidebar();
    }

    m.redraw();
  } catch (error) {
    console.error('Failed to create marker:', error);
  }
}

/**
 * 创建 Perfetto 原生 Note（在时间轴上显示标记旗帜）
 *
 * 注意：始终使用 addNote（DEFAULT 类型）而非 addSpanNote。
 * 原因：notes_panel.ts 对 SPAN 类型的 Note 直接走 drawAreaMarker 分支，
 * 不查询 __openperfettoMarkerRegistry，导致圆形序号永远不会显示。
 */
function createPerfettoNote(trace: Trace, ts: bigint, _dur: bigint): string {
  try {
    const time = Time.fromRaw(ts);
    const noteId = trace.notes.addNote({
      timestamp: time,
      color: '#34a853',
      text: 'User Marker',
    });
    opLogger.debug('createPerfettoNote: note created', {noteId, ts: ts.toString()});
    return noteId;
  } catch (e) {
    opLogger.warn('createPerfettoNote: Notes API error', e);
    return `marker_${Date.now()}`;
  }
}

/**
 * OpenPerfetto 插件
 *
 * AI-enhanced Android performance trace analyzer.
 * Integrates intelligent Agent for automated trace analysis.
 *
 * Phase 1: 基础骨架实现
 * Phase 2: Agent核心引擎和AI对话模块
 * - 插件注册和生命周期
 * - Store 状态管理
 * - WebSocket 连接管理
 * - AgentLoop 状态机
 * - AIChat 对话组件
 * - 国际化支持
 * - 主题切换
 */
export default class OpenPerfettoPlugin implements PerfettoPlugin {
  static readonly id = 'org.openperfetto';
  static readonly description = `
    OpenPerfetto - AI-enhanced Android performance trace analyzer.
    Integrates intelligent Agent for automated trace analysis.
  `;

  // Reference to trace - will be used in Phase 3+ for Tool execution
  readonly trace: Trace;
  private store: Store<OpenPerfettoState> | null = null;
  private wsClient: WebSocketClient | null = null;
  private agentLoop: AgentLoop | null = null;
  private unsubscribeWsState: (() => void) | null = null;
  private aiPinObserver: MutationObserver | null = null;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  /**
   * 应用级别激活钉子 - 在应用启动时调用（trace加载前）
   * 创建永久 DOM 侧边栏，初始化宽度、拖拽、toggle 按钮
   */
  static onActivate(_app: App, _args: RouteArgs): void {
    // Phase 1: 初始化 WebSocket 连接
    const wsClient = WebSocketClient.getInstance();
    wsClient.setUrl('ws://localhost:3001/ws');
    wsClient.connect();

    // Ctrl+F 快捷键拦截：将浏览器默认搜索转向新搜索框
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        // 如果侧边栏关闭则打开
        if (sidebarState === 'closed') {
          openSidebar();
        }
        // 延迟聚焦，确保 DOM 已更新
        setTimeout(() => focusSearchInput(), 50);
      }
    });

    // 快捷键 E：在当前选中位置或鼠标悬停位置添加标记
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // 跳过输入控件中的按键
      const target = e.target as HTMLElement;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'e' || e.key === 'E') {
        if (e.ctrlKey || e.metaKey || e.altKey) return; // 不拦截组合键
        e.preventDefault();
        handleMarkerShortcut();
      }
    });

    // 初始化侧边栏宽度（黄金比互补）
    sidebarWidth = clampWidth(window.innerWidth * (1 - 0.618));
    applySidebarWidth(sidebarWidth);

    // 创建侧边栏容器（仅一次，全生命周期持续存在）
    if (!sidebarContainer) {
      sidebarContainer = document.createElement('div');
      sidebarContainer.className = 'openperfetto-sidebar';
      sidebarContainer.style.display = 'flex'; // 初始状态：open

      // Mithril 挂载点（填满剩余空间）
      const mRoot = document.createElement('div');
      mRoot.className = 'openperfetto-sidebar-mroot';
      sidebarContainer.appendChild(mRoot);
      m.mount(mRoot, SidebarRootComponent);

      // 拖拽手柄（右边缘 6px 可拖拽内容）
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'openperfetto-sidebar__resize-handle';
      resizeHandle.addEventListener('mousedown', onResizeStart);
      sidebarContainer.appendChild(resizeHandle);

      document.body.appendChild(sidebarContainer);
    }

    // 创建独立展开按钮（仅一次，新侧边栏关闭时可见）
    if (!toggleButton) {
      toggleButton = document.createElement('button');
      toggleButton.className = 'openperfetto-toggle-btn';
      toggleButton.title = 'Open OpenPerfetto AI';
      toggleButton.style.display = 'none'; // 侧边栏开启时隐藏
      toggleButton.innerHTML = '<i class="pf-icon">psychology</i>';
      toggleButton.addEventListener('click', openSidebar);
      document.body.appendChild(toggleButton);
    }

    // 窗口大小变化时重新 clamp 宽度
    window.addEventListener('resize', () => {
      sidebarWidth = clampWidth(sidebarWidth);
      applySidebarWidth(sidebarWidth);
      updateToggleButton();
    });

    // 延迟到首次渲染后，应用 active class 并设置 MutationObserver
    setTimeout(() => {
      document
        .querySelector('.pf-ui-main')
        ?.classList.add('pf-ui-main--openperfetto-active');
      updateToggleButton();

      // 监听旧侧边栏可见性变化，动态更新 toggle 按钮位置
      const pfSidebar = document.querySelector('.pf-sidebar');
      if (pfSidebar) {
        mutationObserver = new MutationObserver(() => updateToggleButton());
        mutationObserver.observe(pfSidebar, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }
    }, 0);

    console.log(`${OpenPerfettoPlugin.id}::onActivate()`);
  }

  /**
   * Trace级别加载钉子 - 在trace加载完成后调用
   * 初始化 trace 相关功能，更新侧边栏 trace 上下文
   */
  async onTraceLoad(ctx: Trace): Promise<void> {
    console.log(
      `${OpenPerfettoPlugin.id}::onTraceLoad()`,
      ctx.traceInfo.traceTitle,
    );

    // 1. 挂载状态 Store
    this.store = ctx.mountStore<OpenPerfettoState>(
      'openperfetto_state',
      migrateState,
    );

    // 初始化默认状态（如果是新会话）
    if (!this.store.state.initialized) {
      this.store.edit((draft) => {
        Object.assign(draft, createDefaultState());
        draft.initialized = true;
      });
    }

    // 初始化全局标记注册表
    syncMarkerRegistry(this.store.state.markers);

    // 2. 获取 WebSocket 客户端并绑定状态
    this.wsClient = WebSocketClient.getInstance();
    this.unsubscribeWsState = this.wsClient.onStateChange((state) => {
      if (this.store) {
        this.store.edit((draft) => {
          draft.connectionState = state;
        });
      }
    });

    // 3. 创建 AgentLoop 实例
    this.agentLoop = new AgentLoop(ctx, this.store, {
      onProgress: (_progress) => {
        m.redraw();
      },
    });

    // 4. 更新侧边栏 trace 上下文 → 侧边栏重新渲染
    currentTraceCtx = {
      trace: ctx,
      store: this.store,
      agentLoop: this.agentLoop,
    };
    m.redraw();

    // 5. 注册备用页面路由（可通过 URL 直接访问）
    ctx.pages.registerPage({
      route: '/openperfetto',
      render: (_subpage) => {
        return m(OpenPerfettoPage, {
          trace: ctx,
          store: this.store!,
          agentLoop: this.agentLoop!,
          onCollapse: closeSidebar,
        });
      },
    });

    // 6. 在旧侧边栏 "Current Trace" 区域添加菜单入口
    ctx.sidebar.addMenuItem({
      section: 'current_trace',
      text: 'OpenPerfetto AI',
      href: '#!/openperfetto',
      icon: 'psychology',
      sortOrder: 5,
      tooltip: 'AI-powered trace analysis',
    });

    // 7. 注册资源清理（trace 卸载时执行）
    ctx.trash.defer(() => {
      this.cleanup();
    });

    // 8. 监听 trace ready 事件
    ctx.onTraceReady.addListener(async () => {
      console.log(`${OpenPerfettoPlugin.id}::traceready`);
      // 启动 AI Pin badge 注入（延迟确保 DOM 已渲染）
      this.setupAIPinBadgeObserver();
    });
  }

  /**
   * 清理资源
   * 注意：侧边栏 DOM 元素在全应用生命周期内持续存在，不在此删除
   */
  private cleanup(): void {
    // 清理 AI Pin Badge Observer
    if (this.aiPinObserver) {
      this.aiPinObserver.disconnect();
      this.aiPinObserver = null;
    }
    // 清理 AgentLoop
    if (this.agentLoop) {
      this.agentLoop.dispose();
      this.agentLoop = null;
    }

    // 取消订阅 WebSocket 状态
    if (this.unsubscribeWsState) {
      this.unsubscribeWsState();
      this.unsubscribeWsState = null;
    }

    // 注意：不在这里断开 WebSocket 连接
    // 因为 WebSocket 是全局单例，可能被其他 trace 使用

    // 清除 trace 上下文（侧边栏显示 no-trace 状态）
    currentTraceCtx = null;
    m.redraw();

    this.store = null;
    console.log(`${OpenPerfettoPlugin.id}::cleanup()`);
  }

  /**
   * AI Pin Badge DOM 注入
   * 使用 MutationObserver 监听 workspace 变化，
   * 当检测到 AI pinned track 的 DOM 出现时，注入圆形 AI 图标
   */
  private setupAIPinBadgeObserver(): void {
    // 断开旧的 observer
    if (this.aiPinObserver) {
      this.aiPinObserver.disconnect();
    }

    const injectBadges = () => {
      if (!this.store) return;
      const aiUris = this.store.state.aiPinnedTrackUris;
      if (aiUris.length === 0) return;

      // 查找所有 pinned track 的 title 元素
      const pinnedArea = document.querySelector('.pf-pinned-panel');
      if (!pinnedArea) return;

      const trackPanels = pinnedArea.querySelectorAll('[data-track-uri]');
      trackPanels.forEach((panel) => {
        const uri = panel.getAttribute('data-track-uri');
        if (!uri || !aiUris.includes(uri)) return;

        // 检查是否已注入
        if (panel.querySelector('.openperfetto-ai-pin-badge')) return;

        // 查找 track title 元素
        const titleEl = panel.querySelector('.pf-track-title');
        if (!titleEl) return;

        // 注入 AI badge
        const badge = document.createElement('span');
        badge.className = 'openperfetto-ai-pin-badge';
        badge.title = 'AI Pinned';
        badge.innerHTML = '<i class="pf-icon" style="font-size:12px">psychology</i>';
        titleEl.insertBefore(badge, titleEl.firstChild);
      });
    };

    // 初始执行一次
    setTimeout(injectBadges, 500);

    // 设置 MutationObserver 监听 DOM 变化
    const targetNode = document.querySelector('.pf-panels-container') || document.body;
    this.aiPinObserver = new MutationObserver(() => {
      // 防抖：避免频繁触发
      requestAnimationFrame(injectBadges);
    });

    this.aiPinObserver.observe(targetNode, {
      childList: true,
      subtree: true,
    });
  }
}
