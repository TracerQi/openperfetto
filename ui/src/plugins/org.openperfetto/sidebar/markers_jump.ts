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
import {HighPrecisionTimeSpan} from '../../../base/high_precision_time_span';
import {OpenPerfettoState, AIMarker, DEFAULT_AI_ZOOM_DURATION_NS} from '../types/plugin_state';
import {syncMarkerRegistry} from './marker_registry';
import {opLogger} from '../utils/logger';
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
      this.renderToolbar(trace, store, state.locale),

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
    trace: Trace,
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
          onclick: () => this.clearAllMarkers(store, trace),
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
      m('.openperfetto-markers__empty-title', [
        m(Icon, {icon: 'near_me'}),
        m('span', t(locale, 'markers.noMarkers')),
      ]),
      m(
        '.openperfetto-markers__hint',
        locale === 'zh'
          ? '选中Slice/鼠标位置 按E键添加标记；或由AI自动标记'
          : 'Select a Slice or hover, press E to add a marker; or let AI mark automatically',
      ),
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

    return m(
      '.openperfetto-markers__item',
      {
        key: marker.id,
        onclick: () => this.navigateToMarker(trace, marker),
      },
      [
        // 左侧：圆形序号 + AI图标
        m('.openperfetto-markers__item-left', [
          m('.openperfetto-markers__index-circle', {
            style: {backgroundColor: marker.color || '#525252'}
          }, `${index}`),
          marker.isAI &&
            m('.openperfetto-markers__ai-badge', {
              title: 'AI Marker',
            }, [
              m(Icon, {icon: 'robot_2'}),
            ]),
        ]),

        // 主要信息区
        m('.openperfetto-markers__item-main', [
          // 第一行：进程 / 线程
          (marker.processName || marker.threadName) &&
            m('.openperfetto-markers__location', [
              marker.processName &&
                m('span.openperfetto-markers__process', marker.processName),
              marker.processName && marker.threadName && m('span', ' / '),
              marker.threadName &&
                m('span.openperfetto-markers__thread', marker.threadName),
            ]),
          // 第二行：Tag (sliceName) + 时间戳
          m('.openperfetto-markers__meta', [
            marker.sliceName &&
              m('span.openperfetto-markers__slice-tag', marker.sliceName),
            m('span.openperfetto-markers__timestamp', formatTimestamp(marker.timestamp)),
            marker.duration > 0n &&
              m('span.openperfetto-markers__duration', formatDuration(marker.duration)),
          ]),
          // 第三行：备注区域
          isEditing
            ? this.renderNoteEditor(store, marker)
            : marker.note
              ? m(
                  '.openperfetto-markers__note',
                  {
                    onclick: (e: Event) => {
                      e.stopPropagation();
                      this.startEditNote(marker);
                    },
                    title: locale === 'zh' ? '点击编辑' : 'Click to edit',
                  },
                  marker.note,
                )
              : !isEditing &&
                m(
                  '.openperfetto-markers__note-placeholder',
                  {
                    onclick: (e: Event) => {
                      e.stopPropagation();
                      this.startEditNote(marker);
                    },
                  },
                  locale === 'zh' ? '添加备注...' : 'Add note...',
                ),
        ]),

        // 操作按钮
        m('.openperfetto-markers__item-actions', [
          m(Button, {
            icon: 'delete',
            onclick: (e: Event) => {
              e.stopPropagation();
              this.deleteMarker(store, trace, marker.id);
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
      opLogger.info('navigateToMarker', {
        id: marker.id,
        sliceId: marker.sliceId,
        relatedTrackUri: marker.relatedTrackUri,
        timestamp: marker.timestamp.toString(),
      });

      // 1. 恢复 timeline 缩放状态
      if (marker.timelineState) {
        const start = Time.fromRaw(
          BigInt(marker.timelineState.visibleWindowStart),
        );
        const end = Time.fromRaw(
          BigInt(marker.timelineState.visibleWindowEnd),
        );
        const span = HighPrecisionTimeSpan.fromTime(start, end);
        trace.timeline.setVisibleWindow(span);
      } else if (marker.isAI) {
        // AI 标记：使用默认缩放窗口（以标记为中心，宽度 DEFAULT_AI_ZOOM_DURATION_NS）
        const halfDur = BigInt(DEFAULT_AI_ZOOM_DURATION_NS) / 2n;
        const start = Time.fromRaw(marker.timestamp - halfDur);
        const end = Time.fromRaw(marker.timestamp + halfDur);
        trace.timeline.setVisibleWindow(
          HighPrecisionTimeSpan.fromTime(start, end),
        );
      } else {
        // Fallback: 居中导航
        const startTime = Time.fromRaw(marker.timestamp);
        if (marker.duration > 0n) {
          trace.timeline.panSpanIntoView(
            startTime,
            Time.fromRaw(marker.timestamp + marker.duration),
            {align: 'zoom', margin: 0.1},
          );
        } else {
          trace.timeline.panIntoView(startTime, {align: 'center'});
        }
      }

      // 2. 选中 slice（不依赖 selectSqlEvent 的 scrollToSelection，改由我们显式控制展开+滚动）
      if (marker.sliceId) {
        opLogger.debug('navigateToMarker: selecting slice', {sliceId: marker.sliceId});
        trace.selection.selectSqlEvent('slice', marker.sliceId, {
          // scrollToSelection: false —— 不依赖内部滚动，下方显式调用确保展开
          scrollToSelection: false,
          switchToCurrentSelectionTab: false,
        });
      }

      // 3. 展开折叠的 Track group 并滚动到对应线程位置
      //    selectSqlEvent 内部的 scrollToSelection 在折叠组场景下可能无法可靠展开，
      //    此处显式传入 relatedTrackUri + expandGroup: true 确保行为一致
      if (marker.relatedTrackUri) {
        opLogger.debug('navigateToMarker: scrollTo with expandGroup', {uri: marker.relatedTrackUri});
        trace.scrollTo({
          track: {uri: marker.relatedTrackUri, expandGroup: true},
        });
      } else if (marker.sliceId) {
        // relatedTrackUri 为空时回退：由 selectSqlEvent 负责展开
        opLogger.debug('navigateToMarker: no relatedTrackUri, falling back to selectSqlEvent scrollToSelection');
        trace.selection.selectSqlEvent('slice', marker.sliceId, {
          scrollToSelection: true,
          switchToCurrentSelectionTab: false,
        });
      }

      m.redraw();
    } catch (error) {
      opLogger.error('navigateToMarker: failed', error);
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
    // 同步注册表，更新时间轴上显示的备注文本
    syncMarkerRegistry(store.state.markers);
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
  private deleteMarker(
    store: Store<OpenPerfettoState>,
    trace: Trace,
    markerId: string,
  ): void {
    opLogger.info('deleteMarker', {markerId});
    // 移除 Perfetto 原生 Note（公开 NoteManager 接口未暴露 removeNote，通过 any 安全调用）
    (trace.notes as any).removeNote?.(markerId);
    const updatedMarkers = store.state.markers.filter((m) => m.id !== markerId);
    store.edit((draft) => {
      draft.markers = updatedMarkers;
    });
    syncMarkerRegistry(updatedMarkers);
    m.redraw();
  }

  /**
   * 清空所有标记
   */
  private clearAllMarkers(
    store: Store<OpenPerfettoState>,
    trace: Trace,
  ): void {
    opLogger.info('clearAllMarkers', {count: store.state.markers.length});
    // 移除所有 Perfetto 原生 Note（公开 NoteManager 接口未暴露 removeNote，通过 any 安全调用）
    for (const marker of store.state.markers) {
      (trace.notes as any).removeNote?.(marker.id);
    }
    store.edit((draft) => {
      draft.markers = [];
    });
    syncMarkerRegistry([]);
    m.redraw();
  }

  /**
   * 从当前会话提取标记
   */
  private extractSessionMarkers(
    session: OpenPerfettoState['currentSession'],
  ): AIMarker[] {
    if (!session) return [];

    const markers: AIMarker[] = [];

    for (const msg of session.messages) {
      if (msg.toolResult && msg.toolResult.success) {
        const data = msg.toolResult.data as Record<string, unknown> | undefined;
        if (data && data.markerId) {
          markers.push({
            id: data.markerId as string,
            sliceId: (data.sliceId as number) ?? 0,
            timestamp: BigInt((data.timestamp as string) ?? '0'),
            duration: BigInt((data.duration as string) ?? '0'),
            name: (data.note as string) || 'AI Marker',
            note: '',
            severity: 'info',
            createdAt: Date.now(),
            isAI: true,
            processName: (data.processName as string) ?? '',
            threadName: (data.threadName as string) ?? '',
            sliceName: (data.sliceName as string) ?? '',
            color: (data.color as string) ?? '#525252',
            timelineState: data.timelineState
              ? {
                  visibleWindowStart: (data.timelineState as any).visibleWindowStart as string,
                  visibleWindowEnd: (data.timelineState as any).visibleWindowEnd as string,
                }
              : undefined,
            relatedTrackUri: (data.relatedTrackUri as string) ?? '',
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
      syncMarkerRegistry(store.state.markers);
      m.redraw();
    }
  }
}
