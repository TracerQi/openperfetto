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
import {App, RouteArgs} from '../../public/app';
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

// Import styles (will be bundled by Rollup)
import './styles/openperfetto.scss';

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

  private readonly trace: Trace;
  private store: Store<OpenPerfettoState> | null = null;
  private wsClient: WebSocketClient | null = null;
  private agentLoop: AgentLoop | null = null;
  private unsubscribeWsState: (() => void) | null = null;

  constructor(trace: Trace) {
    this.trace = trace;
  }

  /**
   * 应用级别激活钩子 - 在应用启动时调用（trace加载前）
   * 用于注册全局命令、设置、侧边栏菜单项等
   */
  static onActivate(_app: App, _args: RouteArgs): void {
    // Phase 1: 初始化 WebSocket 连接（可配置）
    const wsClient = WebSocketClient.getInstance();
    // TODO: Phase 5 - 从设置中读取 URL
    wsClient.setUrl('ws://localhost:8765');

    // 尝试连接（如果后端可用）
    // 注意：Phase 1 中后端可能不存在，连接会失败并自动重试
    wsClient.connect();

    console.log(`${OpenPerfettoPlugin.id}::onActivate()`);
  }

  /**
   * Trace级别加载钩子 - 在trace加载完成后调用
   * 用于初始化trace相关的功能
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
      onProgress: (progress) => {
        // 进度回调，触发 UI 更新
        m.redraw();
      },
    });

    // 4. 注册 OpenPerfetto Page
    ctx.pages.registerPage({
      route: '/openperfetto',
      render: (_subpage) => {
        return m(OpenPerfettoPage, {
          trace: ctx,
          store: this.store!,
          agentLoop: this.agentLoop!,
        });
      },
    });

    // 5. 在侧边栏 "Current Trace" 区域添加菜单入口
    ctx.sidebar.addMenuItem({
      section: 'current_trace',
      text: 'OpenPerfetto AI',
      href: '#!/openperfetto',
      icon: 'psychology',
      sortOrder: 5,
      tooltip: 'AI-powered trace analysis',
    });

    // 6. 注册资源清理（trace 卸载时执行）
    ctx.trash.defer(() => {
      this.cleanup();
    });

    // 7. 监听 trace ready 事件
    ctx.onTraceReady.addListener(async () => {
      console.log(`${OpenPerfettoPlugin.id}::traceready`);
      // 可以在这里触发自动场景分类
    });
  }

  /**
   * 清理资源
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
    // 只有在应用关闭时才断开

    this.store = null;
    console.log(`${OpenPerfettoPlugin.id}::cleanup()`);
  }
}
