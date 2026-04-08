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
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {TopBar} from './top_bar';
import {AIChat} from './ai_chat';
import {SearchPin} from './search_pin';
import {MarkersJump} from './markers_jump';
import {Settings} from './settings';
import {OpenPerfettoState} from '../types/plugin_state';
import {AgentLoop} from '../agent/agent_loop';
import {t} from '../i18n';
import {Button} from '../../../widgets/button';
import {Icon} from '../../../widgets/icon';

export interface OpenPerfettoPageAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  agentLoop: AgentLoop;
  onCollapse?: () => void; // 可选回调：折叠侧边栏
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
export class OpenPerfettoPage
  implements m.ClassComponent<OpenPerfettoPageAttrs>
{
  /** 模块折叠状态（页面局部状态，不持久化） */
  private moduleCollapsed = {
    searchPin: false,
    markers: true,
    aiChat: false,
  };

  /** 设置面板是否打开 */
  private settingsOpen: boolean = false;
  /** 设置面板初始打开的tab */
  private settingsInitialTab: string = 'general';

  view({attrs}: m.CVnode<OpenPerfettoPageAttrs>): m.Children {
    const {trace, store, agentLoop} = attrs;
    const state = store.state;

    return m(
      '.openperfetto-page',
      {
        class: state.theme === 'dark' ? 'openperfetto-page--dark' : '',
      },
      [
        // 顶部栏
        m(TopBar, {
          store,
          onThemeToggle: () =>
            store.edit((draft) => {
              draft.theme = draft.theme === 'light' ? 'dark' : 'light';
            }),
          onCollapse: attrs.onCollapse,
        }),

        // 可滚动内容区域
        m('.openperfetto-page__content', [
          // 搜索与 Pin 模块
          this.renderModule(
            'searchPin',
            t(state.locale, 'searchPin.title'),
            'search',
            state.locale,
            m(SearchPin, {
              trace,
              store,
              collapsed: this.moduleCollapsed.searchPin,
              onToggleCollapse: () => this.toggleModule('searchPin'),
              onOpenSettingsPreset: () => {
                this.settingsInitialTab = 'presets';
                this.settingsOpen = true;
                m.redraw();
              },
            }),
          ),

          // 标记与跳转模块
          this.renderModule(
            'markers',
            t(state.locale, 'markers.title'),
            'bookmark',
            state.locale,
            m(MarkersJump, {
              trace,
              store,
              collapsed: this.moduleCollapsed.markers,
              onToggleCollapse: () => this.toggleModule('markers'),
            }),
          ),

          // AI 对话模块
          this.renderModule(
            'aiChat',
            t(state.locale, 'aiChat.title'),
            'smart_toy',
            state.locale,
            m(AIChat, {
              trace,
              store,
              agentLoop,
              collapsed: this.moduleCollapsed.aiChat,
              onToggleCollapse: () => this.toggleModule('aiChat'),
            }),
            true, // isFlexGrow
          ),
        ]),

        // 设置按钮
        m('.openperfetto-page__footer', [
          m(Button, {
            icon: 'settings',
            label: t(state.locale, 'settings.title'),
            onclick: () => {
              this.settingsOpen = true;
              m.redraw();
            },
          }),
        ]),

        // 设置面板（模态框）
        m(Settings, {
          store,
          isOpen: this.settingsOpen,
          initialTab: this.settingsInitialTab,
          onClose: () => {
            this.settingsOpen = false;
            this.settingsInitialTab = 'general';
            m.redraw();
          },
        }),
      ],
    );
  }

  /**
   * 渲染可折叠模块
   */
  private renderModule(
    moduleKey: keyof typeof this.moduleCollapsed,
    title: string,
    icon: string,
    // Reserved for future i18n support
    _locale: 'zh' | 'en',
    content: m.Children,
    isFlexGrow = false,
  ): m.Children {
    const collapsed = this.moduleCollapsed[moduleKey];

    return m(
      '.openperfetto-module',
      {
        class: [
          collapsed ? 'openperfetto-module--collapsed' : '',
          isFlexGrow ? 'openperfetto-module--flex' : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
      [
        // 模块标题栏
        m(
          '.openperfetto-module__header',
          {
            onclick: () => this.toggleModule(moduleKey),
          },
          [
            m(Icon, {icon, className: 'openperfetto-module__icon'}),
            m('span.openperfetto-module__title', title),
            m(Icon, {
              icon: collapsed ? 'expand_more' : 'expand_less',
              className: 'openperfetto-module__toggle',
            }),
          ],
        ),

        // 模块内容
        !collapsed &&
          m(
            '.openperfetto-module__content',
            {
              class: isFlexGrow ? 'openperfetto-module__content--flex' : '',
            },
            content,
          ),
      ],
    );
  }

  private toggleModule(module: keyof typeof this.moduleCollapsed): void {
    this.moduleCollapsed[module] = !this.moduleCollapsed[module];
  }
}
