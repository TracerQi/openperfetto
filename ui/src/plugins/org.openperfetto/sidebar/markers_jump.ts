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
 * MarkersJump Component - 标记与跳转模块
 *
 * 功能：
 * - 显示所有 AIMarker 列表
 * - 序号、名称、severity、时间戳、备注
 * - 点击标记导航到时间点
 * - 备注行内编辑
 * - 删除标记
 */

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Time} from '../../../base/time';
import {Store} from '../../../base/store';
import {OpenPerfettoState, AIMarker} from '../types/plugin_state';
import {t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {Button} from '../../../widgets/button';

export interface MarkersJumpAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * 格式化时间戳（纳秒 → 毫秒级可读格式）
 */
function formatTimestamp(ts: bigint): string {
  const ms = Number(ts / 1000000n);
  const s = Math.floor(ms / 1000);
  const remainder = ms % 1000;
  return `${s}.${remainder.toString().padStart(3, '0')}s`;
}

/**
 * 格式化持续时间（纳秒 → 可读格式）
 */
function formatDuration(dur: bigint): string {
  const ns = Number(dur);
  if (ns < 1000) {
    return `${ns}ns`;
  }
  if (ns < 1000000) {
    return `${(ns / 1000).toFixed(1)}µs`;
  }
  if (ns < 1000000000) {
    return `${(ns / 1000000).toFixed(2)}ms`;
  }
  return `${(ns / 1000000000).toFixed(3)}s`;
}

/**
 * MarkersJump Mithril.js ClassComponent
 */
export class MarkersJump implements m.ClassComponent<MarkersJumpAttrs> {
  private editingMarkerId: string | null = null;
  private editingNote: string = '';

  view({attrs}: m.CVnode<MarkersJumpAttrs>): m.Children {
    const {trace, store, collapsed} = attrs;
    const state = store.state;
    const markers = state.markers;

    if (collapsed) {
      return null;
    }

    return m('.openperfetto-markers', [
      // 工具栏
      this.renderToolbar(store, state.locale),

      // 标记列表
      markers.length === 0
        ? this.renderEmpty(state.locale)
        : this.renderMarkerList(trace, store, markers, state.locale),
    ]);
  }

  /**
   * 渲染工具栏
   */
  private renderToolbar(
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
  ): m.Children {
    const markers = store.state.markers;
    const session = store.state.currentSession;

    // 检查是否有新的 AI 标记需要同步
    const sessionMarkers = this.extractSessionMarkers(session);
    const newMarkers = sessionMarkers.filter(
      (sm) => !markers.some((m) => m.id === sm.id),
    );

    return m('.openperfetto-markers__toolbar', [
      m(
        '.openperfetto-markers__count',
        `${markers.length} ${locale === 'zh' ? '个标记' : 'markers'}`,
      ),
      newMarkers.length > 0 &&
        m(Button, {
          icon: 'sync',
          label: locale === 'zh' ? `同步 ${newMarkers.length} 个` : `Sync ${newMarkers.length}`,
          onclick: () => this.syncMarkersFromSession(store),
          compact: true,
        }),
      markers.length > 0 &&
        m(Button, {
          icon: 'delete_sweep',
          onclick: () => this.clearAllMarkers(store),
          title: locale === 'zh' ? '清空所有标记' : 'Clear all markers',
          compact: true,
        }),
    ]);
  }

  /**
   * 渲染空状态
   */
  private renderEmpty(locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-markers__empty', [
      m(Icon, {icon: 'bookmark_border'}),
      m('span', t(locale, 'markers.noMarkers')),
    ]);
  }

  /**
   * 渲染标记列表
   */
  private renderMarkerList(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    markers: AIMarker[],
    locale: 'zh' | 'en',
  ): m.Children {
    // 按时间戳排序
    const sortedMarkers = [...markers].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );

    return m(
      '.openperfetto-markers__list',
      sortedMarkers.map((marker, index) =>
        this.renderMarkerItem(trace, store, marker, index + 1, locale),
      ),
    );
  }

  /**
   * 渲染单个标记项
   */
  private renderMarkerItem(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    marker: AIMarker,
    index: number,
    locale: 'zh' | 'en',
  ): m.Children {
    const isEditing = this.editingMarkerId === marker.id;
    const severityClass = `openperfetto-markers__severity--${marker.severity}`;

    return m(
      '.openperfetto-markers__item',
      {
        key: marker.id,
        onclick: () => this.navigateToMarker(trace, marker),
      },
      [
        // 序号和严重性指示器
        m('.openperfetto-markers__item-left', [
          m('.openperfetto-markers__index', `#${index}`),
          m(`.openperfetto-markers__severity ${severityClass}`, {
            title: t(locale, `markers.severity.${marker.severity}`),
          }),
        ]),

        // 主要信息区
        m('.openperfetto-markers__item-main', [
          m('.openperfetto-markers__name', marker.name),
          m('.openperfetto-markers__meta', [
            m('span.openperfetto-markers__timestamp', formatTimestamp(marker.timestamp)),
            marker.duration > 0n &&
              m('span.openperfetto-markers__duration', formatDuration(marker.duration)),
          ]),
          // 备注区域
          isEditing
            ? this.renderNoteEditor(store, marker)
            : marker.note &&
              m(
                '.openperfetto-markers__note',
                {
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    this.startEditNote(marker);
                  },
                  title: locale === 'zh' ? '点击编辑' : 'Click to edit',
                },
                marker.note,
              ),
        ]),

        // 操作按钮
        m('.openperfetto-markers__item-actions', [
          !marker.note &&
            !isEditing &&
            m(Button, {
              icon: 'edit_note',
              onclick: (e: Event) => {
                e.stopPropagation();
                this.startEditNote(marker);
              },
              title: locale === 'zh' ? '添加备注' : 'Add note',
              compact: true,
            }),
          m(Button, {
            icon: 'delete',
            onclick: (e: Event) => {
              e.stopPropagation();
              this.deleteMarker(store, marker.id);
            },
            title: t(locale, 'markers.deleteMarker'),
            compact: true,
          }),
        ]),
      ],
    );
  }

  /**
   * 渲染备注编辑器
   */
  private renderNoteEditor(
    store: Store<OpenPerfettoState>,
    marker: AIMarker,
  ): m.Children {
    return m('.openperfetto-markers__note-editor', [
      m('input.openperfetto-markers__note-input', {
        type: 'text',
        value: this.editingNote,
        onclick: (e: Event) => e.stopPropagation(),
        oninput: (e: Event) => {
          this.editingNote = (e.target as HTMLInputElement).value;
        },
        onkeydown: (e: KeyboardEvent) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            this.saveNote(store, marker.id);
          } else if (e.key === 'Escape') {
            this.cancelEditNote();
          }
        },
        oncreate: (vnode: m.VnodeDOM) => {
          (vnode.dom as HTMLInputElement).focus();
        },
      }),
      m(Button, {
        icon: 'check',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.saveNote(store, marker.id);
        },
        compact: true,
      }),
      m(Button, {
        icon: 'close',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.cancelEditNote();
        },
        compact: true,
      }),
    ]);
  }

  /**
   * 导航到标记位置
   */
  private navigateToMarker(trace: Trace, marker: AIMarker): void {
    try {
      const startTime = Time.fromRaw(marker.timestamp);
      const endTime = Time.fromRaw(marker.timestamp + marker.duration);

      // 使用 panSpanIntoView 显示完整范围
      if (marker.duration > 0n) {
        trace.timeline.panSpanIntoView(startTime, endTime);
      } else {
        trace.timeline.panIntoView(startTime);
      }

      // 如果有 sliceId，选择该 slice
      if (marker.sliceId) {
        trace.selection.selectSqlEvent('slice', marker.sliceId, {
          scrollToSelection: true,
          switchToCurrentSelectionTab: true,
        });
      }

      m.redraw();
    } catch (error) {
      console.error('Navigate to marker failed:', error);
    }
  }

  /**
   * 开始编辑备注
   */
  private startEditNote(marker: AIMarker): void {
    this.editingMarkerId = marker.id;
    this.editingNote = marker.note || '';
    m.redraw();
  }

  /**
   * 保存备注
   */
  private saveNote(store: Store<OpenPerfettoState>, markerId: string): void {
    store.edit((draft) => {
      const marker = draft.markers.find((m) => m.id === markerId);
      if (marker) {
        marker.note = this.editingNote;
      }
    });
    this.editingMarkerId = null;
    this.editingNote = '';
    m.redraw();
  }

  /**
   * 取消编辑备注
   */
  private cancelEditNote(): void {
    this.editingMarkerId = null;
    this.editingNote = '';
    m.redraw();
  }

  /**
   * 删除标记
   */
  private deleteMarker(store: Store<OpenPerfettoState>, markerId: string): void {
    store.edit((draft) => {
      draft.markers = draft.markers.filter((m) => m.id !== markerId);
    });
    m.redraw();
  }

  /**
   * 清空所有标记
   */
  private clearAllMarkers(store: Store<OpenPerfettoState>): void {
    store.edit((draft) => {
      draft.markers = [];
    });
    m.redraw();
  }

  /**
   * 从当前会话提取标记
   */
  private extractSessionMarkers(
    session: OpenPerfettoState['currentSession'],
  ): AIMarker[] {
    // 从 session 的 messages 中提取 AI 创建的标记
    // 这里需要解析 tool call 结果
    if (!session) return [];

    const markers: AIMarker[] = [];

    for (const msg of session.messages) {
      if (msg.toolResult && msg.toolResult.success) {
        const data = msg.toolResult.data as Record<string, unknown> | undefined;
        if (data && data.markerId) {
          // 这是一个 mark_position 的结果，保留 sliceId 和 duration
          markers.push({
            id: data.markerId as string,
            sliceId: (data.sliceId as number) ?? 0,
            timestamp: BigInt((data.timestamp as string) ?? '0'),
            duration: BigInt((data.duration as string) ?? '0'),
            name: (data.note as string) || 'AI Marker',
            note: '',
            severity: 'info',
            createdAt: Date.now(),
          });
        }
      }
    }

    return markers;
  }

  /**
   * 从会话同步标记
   */
  private syncMarkersFromSession(store: Store<OpenPerfettoState>): void {
    const session = store.state.currentSession;
    const sessionMarkers = this.extractSessionMarkers(session);
    const existingIds = new Set(store.state.markers.map((m) => m.id));

    const newMarkers = sessionMarkers.filter((m) => !existingIds.has(m.id));

    if (newMarkers.length > 0) {
      store.edit((draft) => {
        draft.markers = [...draft.markers, ...newMarkers];
      });
      m.redraw();
    }
  }
}
