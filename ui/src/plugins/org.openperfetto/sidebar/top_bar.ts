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
import {Store} from '../../../base/store';
import {OpenPerfettoState, ConnectionState} from '../types/plugin_state';
import {t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {Button} from '../../../widgets/button';

export interface TopBarAttrs {
  store: Store<OpenPerfettoState>;
  onThemeToggle: () => void;
}

/**
 * TopBar 组件
 *
 * 包含：
 * - Logo + 项目名
 * - 主题切换按钮
 * - 语言切换按钮
 * - 连接状态指示器
 */
export class TopBar implements m.ClassComponent<TopBarAttrs> {
  view({attrs}: m.CVnode<TopBarAttrs>): m.Children {
    const {store, onThemeToggle} = attrs;
    const state = store.state;

    return m('.openperfetto-topbar', [
      // Logo 和项目名
      m('.openperfetto-topbar__brand', [
        m(Icon, {
          icon: 'psychology',
          className: 'openperfetto-topbar__logo',
        }),
        m('span.openperfetto-topbar__title', t(state.locale, 'topbar.title')),
      ]),

      // 操作按钮组
      m('.openperfetto-topbar__actions', [
        // 主题切换
        m(Button, {
          icon: state.theme === 'light' ? 'dark_mode' : 'light_mode',
          onclick: onThemeToggle,
          title: t(state.locale, 'topbar.toggleTheme'),
          compact: true,
        }),

        // 语言切换
        m(Button, {
          icon: 'translate',
          onclick: () => {
            store.edit((draft) => {
              draft.locale = draft.locale === 'zh' ? 'en' : 'zh';
            });
          },
          title: t(state.locale, 'topbar.toggleLanguage'),
          compact: true,
        }),

        // 连接状态指示器
        m(
          '.openperfetto-topbar__connection',
          {
            title: this.getConnectionTooltip(state.connectionState, state.locale),
          },
          [
            m('.openperfetto-topbar__connection-indicator', {
              class: this.getConnectionClass(state.connectionState),
            }),
          ],
        ),
      ]),
    ]);
  }

  private getConnectionClass(state: ConnectionState): string {
    switch (state.status) {
      case 'connected':
        return 'openperfetto-topbar__connection-indicator--connected';
      case 'connecting':
        return 'openperfetto-topbar__connection-indicator--connecting';
      case 'disconnected':
        return 'openperfetto-topbar__connection-indicator--disconnected';
      case 'error':
        return 'openperfetto-topbar__connection-indicator--error';
    }
  }

  private getConnectionTooltip(
    state: ConnectionState,
    locale: 'zh' | 'en',
  ): string {
    switch (state.status) {
      case 'connected':
        return t(locale, 'topbar.connectionStatus.connected');
      case 'connecting':
        return t(locale, 'topbar.connectionStatus.connecting');
      case 'disconnected':
        return t(locale, 'topbar.connectionStatus.disconnected');
      case 'error':
        return `${t(locale, 'topbar.connectionStatus.error')}: ${state.message}`;
    }
  }
}
