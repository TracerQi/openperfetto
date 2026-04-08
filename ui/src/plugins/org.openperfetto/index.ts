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
import {
  OpenPerfettoState,
  createDefaultState,
  migrateState,
} from './types/plugin_state';

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
    });
  }

  /**
   * 清理资源
   * 注意：侧边栏 DOM 元素在全应用生命周期内持续存在，不在此删除
   */
  private cleanup(): void {
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
}
