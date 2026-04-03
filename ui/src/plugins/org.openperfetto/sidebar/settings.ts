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
 * Settings Component - 设置面板模块
 *
 * 功能：
 * - General 标签页：主题切换、语言切换
 * - Presets 标签页：预置 Pin 场景的 CRUD
 * - About 标签页：版本信息、项目描述
 */

import m from 'mithril';
import {Store} from '../../../base/store';
import {
  OpenPerfettoState,
  PresetPinScene,
  PresetPinThread,
} from '../types/plugin_state';
import {t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {Button} from '../../../widgets/button';

const PRESET_SCENES_KEY = 'openperfetto_preset_scenes';

export interface SettingsAttrs {
  store: Store<OpenPerfettoState>;
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'presets' | 'about';

/**
 * Settings Mithril.js ClassComponent
 */
export class Settings implements m.ClassComponent<SettingsAttrs> {
  private activeTab: SettingsTab = 'general';
  private editingPreset: PresetPinScene | null = null;
  private newPresetName: string = '';
  private newPresetThreads: PresetPinThread[] = [];
  private isCreatingPreset: boolean = false;

  view({attrs}: m.CVnode<SettingsAttrs>): m.Children {
    const {store, isOpen, onClose} = attrs;

    if (!isOpen) {
      return null;
    }

    const state = store.state;

    return m('.openperfetto-settings__overlay', {onclick: onClose}, [
      m(
        '.openperfetto-settings__panel',
        {
          onclick: (e: Event) => e.stopPropagation(),
        },
        [
          // 标题栏
          this.renderHeader(state.locale, onClose),

          // 标签页导航
          this.renderTabs(state.locale),

          // 内容区域
          m('.openperfetto-settings__content', [
            this.activeTab === 'general' && this.renderGeneralTab(store, state.locale),
            this.activeTab === 'presets' && this.renderPresetsTab(store, state.locale),
            this.activeTab === 'about' && this.renderAboutTab(state.locale),
          ]),
        ],
      ),
    ]);
  }

  /**
   * 渲染标题栏
   */
  private renderHeader(locale: 'zh' | 'en', onClose: () => void): m.Children {
    return m('.openperfetto-settings__header', [
      m('.openperfetto-settings__title', [
        m(Icon, {icon: 'settings'}),
        m('span', t(locale, 'settings.title')),
      ]),
      m(Button, {
        icon: 'close',
        onclick: onClose,
        compact: true,
      }),
    ]);
  }

  /**
   * 渲染标签页导航
   */
  private renderTabs(locale: 'zh' | 'en'): m.Children {
    const tabs: Array<{key: SettingsTab; label: string; icon: string}> = [
      {
        key: 'general',
        label: locale === 'zh' ? '常规' : 'General',
        icon: 'tune',
      },
      {
        key: 'presets',
        label: t(locale, 'searchPin.presets'),
        icon: 'bookmark',
      },
      {
        key: 'about',
        label: locale === 'zh' ? '关于' : 'About',
        icon: 'info',
      },
    ];

    return m(
      '.openperfetto-settings__tabs',
      tabs.map((tab) =>
        m(
          '.openperfetto-settings__tab',
          {
            class: this.activeTab === tab.key ? 'openperfetto-settings__tab--active' : '',
            onclick: () => {
              this.activeTab = tab.key;
            },
          },
          [m(Icon, {icon: tab.icon}), m('span', tab.label)],
        ),
      ),
    );
  }

  /**
   * 渲染常规设置标签页
   */
  private renderGeneralTab(
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
  ): m.Children {
    const state = store.state;

    return m('.openperfetto-settings__section', [
      // 主题设置
      m('.openperfetto-settings__group', [
        m('.openperfetto-settings__group-title', t(locale, 'settings.theme')),
        m('.openperfetto-settings__option-row', [
          m(
            '.openperfetto-settings__option',
            {
              class: state.theme === 'light' ? 'openperfetto-settings__option--selected' : '',
              onclick: () => {
                store.edit((draft) => {
                  draft.theme = 'light';
                });
              },
            },
            [
              m(Icon, {icon: 'light_mode'}),
              m('span', t(locale, 'settings.theme.light')),
            ],
          ),
          m(
            '.openperfetto-settings__option',
            {
              class: state.theme === 'dark' ? 'openperfetto-settings__option--selected' : '',
              onclick: () => {
                store.edit((draft) => {
                  draft.theme = 'dark';
                });
              },
            },
            [
              m(Icon, {icon: 'dark_mode'}),
              m('span', t(locale, 'settings.theme.dark')),
            ],
          ),
        ]),
      ]),

      // 语言设置
      m('.openperfetto-settings__group', [
        m('.openperfetto-settings__group-title', t(locale, 'settings.language')),
        m('.openperfetto-settings__option-row', [
          m(
            '.openperfetto-settings__option',
            {
              class: state.locale === 'zh' ? 'openperfetto-settings__option--selected' : '',
              onclick: () => {
                store.edit((draft) => {
                  draft.locale = 'zh';
                });
              },
            },
            [m('span', '中文')],
          ),
          m(
            '.openperfetto-settings__option',
            {
              class: state.locale === 'en' ? 'openperfetto-settings__option--selected' : '',
              onclick: () => {
                store.edit((draft) => {
                  draft.locale = 'en';
                });
              },
            },
            [m('span', 'English')],
          ),
        ]),
      ]),
    ]);
  }

  /**
   * 渲染预置场景标签页
   */
  private renderPresetsTab(
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
  ): m.Children {
    const presets = store.state.presetPinScenes;

    return m('.openperfetto-settings__section', [
      // 工具栏
      m('.openperfetto-settings__presets-toolbar', [
        m(Button, {
          icon: 'add',
          label: locale === 'zh' ? '新建场景' : 'New Preset',
          onclick: () => this.startCreatePreset(),
        }),
      ]),

      // 创建/编辑表单
      (this.isCreatingPreset || this.editingPreset) &&
        this.renderPresetForm(store, locale),

      // 预置列表
      m(
        '.openperfetto-settings__presets-list',
        presets.length === 0
          ? m(
              '.openperfetto-settings__presets-empty',
              locale === 'zh' ? '暂无预置场景' : 'No preset scenes',
            )
          : presets.map((preset) =>
              this.renderPresetItem(store, preset, locale),
            ),
      ),
    ]);
  }

  /**
   * 渲染预置场景项
   */
  private renderPresetItem(
    store: Store<OpenPerfettoState>,
    preset: PresetPinScene,
    locale: 'zh' | 'en',
  ): m.Children {
    return m('.openperfetto-settings__preset-item', {key: preset.id}, [
      m('.openperfetto-settings__preset-info', [
        m('.openperfetto-settings__preset-name', preset.name),
        m(
          '.openperfetto-settings__preset-count',
          `${preset.threads.length} ${locale === 'zh' ? '个线程规则' : 'thread rules'}`,
        ),
        m(
          '.openperfetto-settings__preset-date',
          new Date(preset.updatedAt).toLocaleDateString(),
        ),
      ]),
      m('.openperfetto-settings__preset-actions', [
        m(Button, {
          icon: 'edit',
          onclick: () => this.startEditPreset(preset),
          title: t(locale, 'common.edit'),
          compact: true,
        }),
        m(Button, {
          icon: 'delete',
          onclick: () => this.deletePreset(store, preset.id),
          title: t(locale, 'searchPin.deletePreset'),
          compact: true,
        }),
      ]),
    ]);
  }

  /**
   * 渲染预置场景表单
   */
  private renderPresetForm(
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
  ): m.Children {
    const isEditing = this.editingPreset !== null;

    return m('.openperfetto-settings__preset-form', [
      m('.openperfetto-settings__form-header', [
        m(
          'span',
          isEditing
            ? locale === 'zh'
              ? '编辑场景'
              : 'Edit Preset'
            : locale === 'zh'
              ? '新建场景'
              : 'New Preset',
        ),
      ]),

      // 场景名称
      m('.openperfetto-settings__form-group', [
        m(
          'label',
          locale === 'zh' ? '场景名称' : 'Preset Name',
        ),
        m('input.openperfetto-settings__form-input', {
          type: 'text',
          value: this.newPresetName,
          placeholder: locale === 'zh' ? '输入场景名称...' : 'Enter preset name...',
          oninput: (e: Event) => {
            this.newPresetName = (e.target as HTMLInputElement).value;
          },
        }),
      ]),

      // 线程规则列表
      m('.openperfetto-settings__form-group', [
        m('label', locale === 'zh' ? '线程规则' : 'Thread Rules'),
        m(
          '.openperfetto-settings__thread-rules',
          this.newPresetThreads.map((thread, index) =>
            this.renderThreadRuleRow(thread, index, locale),
          ),
        ),
        m(Button, {
          icon: 'add',
          label: locale === 'zh' ? '添加规则' : 'Add Rule',
          onclick: () => this.addThreadRule(),
          compact: true,
        }),
      ]),

      // 表单按钮
      m('.openperfetto-settings__form-actions', [
        m(Button, {
          label: t(locale, 'common.cancel'),
          onclick: () => this.cancelPresetForm(),
        }),
        m(Button, {
          label: t(locale, 'common.save'),
          onclick: () => this.savePreset(store),
          disabled: !this.newPresetName.trim() || this.newPresetThreads.length === 0,
        }),
      ]),
    ]);
  }

  /**
   * 渲染线程规则行
   */
  private renderThreadRuleRow(
    thread: PresetPinThread,
    index: number,
    locale: 'zh' | 'en',
  ): m.Children {
    return m('.openperfetto-settings__thread-rule', {key: index}, [
      m('input.openperfetto-settings__form-input', {
        type: 'text',
        value: thread.processPattern,
        placeholder: locale === 'zh' ? '进程名模式' : 'Process pattern',
        oninput: (e: Event) => {
          this.newPresetThreads[index].processPattern = (
            e.target as HTMLInputElement
          ).value;
        },
      }),
      m('input.openperfetto-settings__form-input', {
        type: 'text',
        value: thread.threadPattern,
        placeholder: locale === 'zh' ? '线程名模式' : 'Thread pattern',
        oninput: (e: Event) => {
          this.newPresetThreads[index].threadPattern = (
            e.target as HTMLInputElement
          ).value;
        },
      }),
      m(Button, {
        icon: 'remove',
        onclick: () => this.removeThreadRule(index),
        compact: true,
      }),
    ]);
  }

  /**
   * 渲染关于标签页
   */
  private renderAboutTab(locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-settings__section', [
      m('.openperfetto-settings__about', [
        m('.openperfetto-settings__about-logo', [
          m(Icon, {icon: 'psychology', className: 'openperfetto-settings__about-icon'}),
        ]),
        m('.openperfetto-settings__about-title', 'OpenPerfetto'),
        m('.openperfetto-settings__about-version', 'Version 1.0.0 (Phase 5)'),
        m(
          '.openperfetto-settings__about-description',
          locale === 'zh'
            ? 'AI 增强的 Android 性能追踪分析工具。集成智能 Agent 实现自动化 trace 分析。'
            : 'AI-enhanced Android performance trace analyzer. Integrates intelligent Agent for automated trace analysis.',
        ),
        m('.openperfetto-settings__about-links', [
          m(
            'a.openperfetto-settings__about-link',
            {
              href: 'https://perfetto.dev',
              target: '_blank',
            },
            [m(Icon, {icon: 'open_in_new'}), 'Perfetto Documentation'],
          ),
          m(
            'a.openperfetto-settings__about-link',
            {
              href: 'https://github.com/nicekwell',
              target: '_blank',
            },
            [m(Icon, {icon: 'code'}), 'Source Code'],
          ),
        ]),
        m(
          '.openperfetto-settings__about-copyright',
          '© 2026 The Android Open Source Project',
        ),
      ]),
    ]);
  }

  /**
   * 开始创建新预置
   */
  private startCreatePreset(): void {
    this.isCreatingPreset = true;
    this.editingPreset = null;
    this.newPresetName = '';
    this.newPresetThreads = [];
    m.redraw();
  }

  /**
   * 开始编辑预置
   */
  private startEditPreset(preset: PresetPinScene): void {
    this.isCreatingPreset = false;
    this.editingPreset = preset;
    this.newPresetName = preset.name;
    this.newPresetThreads = [...preset.threads];
    m.redraw();
  }

  /**
   * 取消预置表单
   */
  private cancelPresetForm(): void {
    this.isCreatingPreset = false;
    this.editingPreset = null;
    this.newPresetName = '';
    this.newPresetThreads = [];
    m.redraw();
  }

  /**
   * 添加线程规则
   */
  private addThreadRule(): void {
    this.newPresetThreads.push({
      processPattern: '',
      threadPattern: '',
      order: this.newPresetThreads.length,
    });
    m.redraw();
  }

  /**
   * 移除线程规则
   */
  private removeThreadRule(index: number): void {
    this.newPresetThreads.splice(index, 1);
    // 更新 order
    this.newPresetThreads.forEach((t, i) => {
      t.order = i;
    });
    m.redraw();
  }

  /**
   * 保存预置
   */
  private savePreset(store: Store<OpenPerfettoState>): void {
    const name = this.newPresetName.trim();
    if (!name || this.newPresetThreads.length === 0) return;

    // 过滤空规则
    const validThreads = this.newPresetThreads.filter(
      (t) => t.processPattern.trim() || t.threadPattern.trim(),
    );

    if (validThreads.length === 0) return;

    const now = Date.now();

    if (this.editingPreset) {
      // 更新现有预置
      store.edit((draft) => {
        const index = draft.presetPinScenes.findIndex(
          (p) => p.id === this.editingPreset!.id,
        );
        if (index !== -1) {
          draft.presetPinScenes[index] = {
            ...draft.presetPinScenes[index],
            name,
            threads: validThreads,
            updatedAt: now,
          };
        }
        // 在回调内持久化，确保使用 draft 的最终值
        this.persistPresets(draft.presetPinScenes);
      });
    } else {
      // 创建新预置
      const newPreset: PresetPinScene = {
        id: `preset_${now}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        threads: validThreads,
        createdAt: now,
        updatedAt: now,
      };

      store.edit((draft) => {
        draft.presetPinScenes.push(newPreset);
        // 在回调内持久化，确保使用 draft 的最终值
        this.persistPresets(draft.presetPinScenes);
      });
    }

    // 关闭表单
    this.cancelPresetForm();
  }

  /**
   * 删除预置
   */
  private deletePreset(store: Store<OpenPerfettoState>, presetId: string): void {
    store.edit((draft) => {
      draft.presetPinScenes = draft.presetPinScenes.filter((p) => p.id !== presetId);
      // 在回调内持久化，确保使用 draft 的最终值
      this.persistPresets(draft.presetPinScenes);
    });
    m.redraw();
  }

  /**
   * 持久化预置到 localStorage
   */
  private persistPresets(presets: PresetPinScene[]): void {
    try {
      localStorage.setItem(PRESET_SCENES_KEY, JSON.stringify(presets));
    } catch (error) {
      console.warn('Failed to persist presets:', error);
    }
  }
}
