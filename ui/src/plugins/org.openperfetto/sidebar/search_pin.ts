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
 * SearchPin Component - 搜索与置顶模块
 *
 * 功能：
 * - 搜索框：进程名+线程名搜索，接替浏览器Ctrl+F
 * - 正常文本搜索：标色匹配轨道，回车跳转下一匹配
 * - 进程+线程搜索（"+"格式）：精确定位指定进程下的线程
 * - Pin/Go 操作
 * - 搜索历史：仅搜索框聚焦时显示，点击即搜，文本缩略+tooltip
 * - 预置 Pin 场景：应用失败提示
 * - Ctrl+F 快捷键拦截（当前已禁用，恢复见 index.ts onActivate 中注释块）
 * - AI 置顶接口预留
 */

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {OpenPerfettoState, PresetPinScene} from '../types/plugin_state';
import {t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {Button} from '../../../widgets/button';
import {Spinner} from '../../../widgets/spinner';
import {NUM, STR, LONG} from '../../../trace_processor/query_result';
import {Time} from '../../../base/time';
import {TrackNode} from '../../../public/workspace';

const SEARCH_HISTORY_KEY = 'openperfetto_search_history';
const MAX_HISTORY_SIZE = 10;

/**
 * 全局输入框引用，供 Ctrl+F 外部调用聚焦
 * 注意：Ctrl+F 拦截当前已禁用，此引用在恢复后重新启用
 */
let globalSearchInputEl: HTMLInputElement | null = null;

/**
 * 外部聚焦搜索框的静态方法
 */
export function focusSearchInput(): void {
  if (globalSearchInputEl) {
    globalSearchInputEl.focus();
  }
}

/**
 * 全局搜索高亮 nodeIds（用于 trace 主区域 DOM 高亮）
 */
const searchHighlightedNodeIds = new Set<string>();

/**
 * 在 trace 主区域应用搜索高亮（黄色底色）
 */
function applySearchHighlight(trace: Trace, uris: string[]): void {
  clearSearchHighlight();
  if (uris.length === 0) return;

  const workspace = trace.currentWorkspace;
  if (!workspace) return;

  for (const uri of uris) {
    const track = workspace.getTrackByUri(uri);
    if (track) {
      searchHighlightedNodeIds.add(track.id);
    }
  }

  // 延迟应用 DOM 高亮，等待 Mithril 渲染完成
  const applyDom = () => {
    for (const nodeId of searchHighlightedNodeIds) {
      const el = document.getElementById(nodeId);
      if (el) {
        const shell = el.querySelector('.pf-track__shell');
        if (shell) {
          shell.classList.add('openperfetto-search-highlight');
        }
      }
    }
  };

  requestAnimationFrame(applyDom);
  // 再次延迟应用，确保展开的轨道已渲染
  setTimeout(applyDom, 150);
}

/**
 * 清除 trace 主区域搜索高亮
 */
function clearSearchHighlight(): void {
  if (searchHighlightedNodeIds.size > 0) {
    document
      .querySelectorAll('.openperfetto-search-highlight')
      .forEach((el) => {
        el.classList.remove('openperfetto-search-highlight');
      });
    searchHighlightedNodeIds.clear();
  }
}

export interface SearchPinAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 打开设置页并跳转到预设场景tab */
  onOpenSettingsPreset?: () => void;
}

interface SearchResult {
  processName: string;
  threadName: string;
  upid: number;
  utid: number;
  trackUri?: string;
}

/**
 * SQL LIKE 转义函数，防止 SQL 注入
 */
function escapeSqlLike(input: string): string {
  return input.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * SearchPin Mithril.js ClassComponent
 */
export class SearchPin implements m.ClassComponent<SearchPinAttrs> {
  private searchQuery: string = '';
  private searchResults: SearchResult[] = [];
  private isSearching: boolean = false;
  private searchHistory: string[] = [];
  /** 上次搜索是否是 进程+线程 格式 */
  private lastSearchWasProcessThread: boolean = false;
  /** 上次搜索是否已执行过（用于控制无结果提示） */
  private hasSearched: boolean = false;
  /** 临时通知消息 */
  private notification: string = '';
  /** 通知定时器 */
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;
  /** 搜索框是否聚焦（控制搜索历史显示） */
  private inputFocused: boolean = false;

  /** 正常文本搜索：匹配的轨道URI列表 */
  private matchedTrackUris: string[] = [];
  /** 当前跳转到的匹配索引 */
  private currentMatchIndex: number = -1;
  /** store 引用（在 view 中更新，供 doSearch 等方法使用） */
  private store: Store<OpenPerfettoState> | null = null;

  oninit(vnode: m.CVnode<SearchPinAttrs>): void {
    // 从 store 的搜索历史初始化（store 已从 localStorage 恢复）
    this.searchHistory = [...vnode.attrs.store.state.searchHistory];
  }

  view({attrs}: m.CVnode<SearchPinAttrs>): m.Children {
    const {trace, store, collapsed, onOpenSettingsPreset} = attrs;
    const state = store.state;
    // 缓存 store 引用，供 doSearch 等方法使用
    this.store = store;

    if (collapsed) {
      return null;
    }

    return m('.openperfetto-search-pin', [
      // 搜索框区域
      this.renderSearchBox(trace, state.locale),

      // 临时通知
      this.notification &&
        m('.openperfetto-search-pin__notification', [
          m(Icon, {icon: 'warning'}),
          m('span', this.notification),
        ]),

      // 正常文本搜索：匹配计数 & 导航
      !this.lastSearchWasProcessThread &&
        this.hasSearched &&
        this.matchedTrackUris.length > 0 &&
        m('.openperfetto-search-pin__match-nav', [
          m(
            'span',
            `${this.currentMatchIndex + 1}/${this.matchedTrackUris.length} ${
              state.locale === 'zh' ? '个匹配' : 'matches'
            }`,
          ),
        ]),

      // 搜索历史（仅搜索框聚焦时显示）
      this.inputFocused &&
        this.searchHistory.length > 0 &&
        this.renderSearchHistory(trace, state.locale),

      // 搜索中 loading 提示
      this.isSearching &&
        m('.openperfetto-search-pin__loading', [
          m(Spinner),
          m('span', t(state.locale, 'searchPin.searching')),
        ]),

      // 搜索结果列表（仅“+”格式搜索显示）
      this.lastSearchWasProcessThread &&
        this.searchResults.length > 0 &&
        this.renderSearchResults(trace, state.locale),

      // 无结果提示（区分 + 格式和普通搜索）
      !this.isSearching &&
        this.hasSearched &&
        this.searchResults.length === 0 &&
        this.matchedTrackUris.length === 0 &&
        m(
          '.openperfetto-search-pin__no-results',
          this.lastSearchWasProcessThread
            ? t(state.locale, 'searchPin.noResultsProcessThread')
            : t(state.locale, 'searchPin.noResults'),
        ),

      // 预设场景列表
      this.renderPresetScenes(trace, store, state.locale, onOpenSettingsPreset),
    ]);
  }

  /**
   * 渲染搜索框
   */
  private renderSearchBox(trace: Trace, locale: 'zh' | 'en'): m.Children {
    const placeholder = t(locale, 'searchPin.placeholder');
    // 取消按钮：搜索框有内容或搜索中时显示
    const showCancel =
      this.searchQuery.trim().length > 0 || this.isSearching;
  
    return m('.openperfetto-search-pin__search-box', [
      // 取消按钮（搜索框左侧）
      showCancel &&
        m(Button, {
          icon: 'close',
          onclick: () => {
            this.clearSearch();
          },
          title: locale === 'zh' ? '取消' : 'Cancel',
          compact: true,
          className: 'openperfetto-search-pin__cancel-btn',
        }),
      m('input.openperfetto-search-pin__input', {
        type: 'text',
        placeholder,
        value: this.searchQuery,
        oninput: (e: Event) => {
          this.searchQuery = (e.target as HTMLInputElement).value;
          // 手动删除所有内容后，自动清空搜索状态
          if (this.searchQuery.trim().length === 0) {
            this.clearSearch();
          }
        },
        onfocus: () => {
          this.inputFocused = true;
        },
        onblur: () => {
          this.inputFocused = false;
          m.redraw();
        },
        oncreate: (vnode: m.VnodeDOM) => {
          globalSearchInputEl = vnode.dom as HTMLInputElement;
        },
        onremove: () => {
          globalSearchInputEl = null;
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            // 正常文本搜索且有匹配结果：跳转到下一匹配
            if (
              !this.searchQuery.includes('+') &&
              this.matchedTrackUris.length > 0
            ) {
              this.navigateToNextMatch(trace);
            } else {
              // 首次搜索或"+"格式搜索
              this.doSearch(trace);
            }
          }
          // Escape 清除搜索状态
          if (e.key === 'Escape') {
            this.clearSearch();
            (e.target as HTMLInputElement).blur();
          }
        },
      }),
      // 搜索按钮
      m(Button, {
        icon: 'search',
        onclick: () => {
          this.doSearch(trace);
        },
        title: locale === 'zh' ? '搜索' : 'Search',
        compact: true,
        disabled: this.isSearching,
      }),
    ]);
  }

  /**
   * 渲染搜索历史（仅搜索框聚焦时显示，点击即搜）
   */
  private renderSearchHistory(
    trace: Trace,
    locale: 'zh' | 'en',
  ): m.Children {
    return m('.openperfetto-search-pin__history', [
      m(
        '.openperfetto-search-pin__history-header',
        t(locale, 'searchPin.history'),
      ),
      this.searchHistory.map((query) =>
        m(
          '.openperfetto-search-pin__history-item',
          {
            onmousedown: (e: MouseEvent) => {
              // 使用 onmousedown 替代 onclick，在 blur 之前触发
              e.preventDefault(); // 阻止输入框失去焦点
              this.searchQuery = query;
              this.inputFocused = false; // 折叠历史记录
              this.doSearch(trace);
            },
            title: query, // tooltip 显示完整文本
          },
          [
            m(Icon, {icon: 'history'}),
            m('span.openperfetto-search-pin__history-text', query),
          ],
        ),
      ),
    ]);
  }

  /**
   * 渲染搜索结果（两行布局：进程>线程 + IDs）
   */
  private renderSearchResults(trace: Trace, locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-search-pin__results', [
      m(
        '.openperfetto-search-pin__results-header',
        `${locale === 'zh' ? '搜索结果' : 'Results'} (${this.searchResults.length})`,
      ),
      m(
        '.openperfetto-search-pin__results-list',
        this.searchResults.map((result) => {
          const isPinned = this.isResultPinned(trace, result);
          return m('.openperfetto-search-pin__result-item', [
            m('.openperfetto-search-pin__result-info', [
              // 第一行：进程 › 线程
              m('.openperfetto-search-pin__result-main', [
                m(
                  '.openperfetto-search-pin__result-process',
                  result.processName,
                ),
                m(
                  'span.openperfetto-search-pin__result-separator',
                  ' › ',
                ),
                m(
                  '.openperfetto-search-pin__result-thread',
                  result.threadName,
                ),
              ]),
              // 第二行：IDs
              m(
                '.openperfetto-search-pin__result-ids',
                `upid:${result.upid} utid:${result.utid}`,
              ),
            ]),
            m('.openperfetto-search-pin__result-actions', [
              m(Button, {
                icon: 'push_pin',
                iconFilled: isPinned,
                onclick: () => this.pinThread(trace, result),
                title: isPinned
                  ? locale === 'zh'
                    ? '取消置顶'
                    : 'Unpin'
                  : locale === 'zh'
                    ? '置顶'
                    : 'Pin',
                compact: true,
              }),
              m(Button, {
                icon: 'my_location',
                onclick: () => this.goToThread(trace, result),
                title: locale === 'zh' ? '跳转' : 'Go',
                compact: true,
              }),
            ]),
          ]);
        }),
      ),
    ]);
  }

  /**
   * 渲染预置场景（chip 卡片式横向排列，点击直接触发搜索+pin）
   */
  private renderPresetScenes(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
    onOpenSettingsPreset?: () => void,
  ): m.Children {
    const presets = store.state.presetPinScenes;
  
    return m('.openperfetto-search-pin__presets', [
      // bookmark 图标（hover 提示"预设场景"，使用 data-tooltip 实现即时提示）
      m(Icon, {
        icon: 'bookmark',
        'data-tooltip': t(locale, 'searchPin.presets'),
        className: 'openperfetto-search-pin__presets-icon',
      }),
      // 预设场景 chip 列表
      ...presets.map((preset) =>
        m(
          '.openperfetto-search-pin__preset-chip',
          {
            onclick: () => this.applyPreset(trace, preset, locale),
            title: preset.threads
              .map((t) => `${t.processPattern}+${t.threadPattern}`)
              .join(', '),
          },
          preset.name,
        ),
      ),
      // 新建按钮
      m(Button, {
        icon: 'add',
        onclick: () => {
          if (onOpenSettingsPreset) {
            onOpenSettingsPreset();
          }
        },
        title: locale === 'zh' ? '新建场景' : 'New Preset',
        compact: true,
        className: 'openperfetto-search-pin__presets-add-btn',
      }),
    ]);
  }

  /**
   * 执行搜索
   *
   * 两种模式：
   * 1. 正常文本搜索（无"+"）：搜索所有轨道，标色匹配，回车跳转下一匹配
   * 2. 进程+线程搜索（有"+"）：精确定位指定进程下的线程
   */
  private async doSearch(trace: Trace): Promise<void> {
    const query = this.searchQuery.trim();
    if (!query) return;

    this.isSearching = true;
    this.searchResults = [];
    this.hasSearched = true;
    this.lastSearchWasProcessThread = query.includes('+');
    this.matchedTrackUris = [];
    this.currentMatchIndex = -1;
    // 清除旧的高亮状态
    clearSearchHighlight();
    m.redraw();

    try {
      if (query.includes('+')) {
        // ===== 进程+线程搜索 =====
        const parts = query.split('+');
        const processPattern = parts[0].trim();
        const threadPattern = parts[1]?.trim() || '';

        const escapedProcess = escapeSqlLike(processPattern);
        const escapedThread = escapeSqlLike(threadPattern);

        // 使用 LEFT JOIN，确保没有 process 关联的线程也能被搜索到
        const sql = `
          SELECT
            COALESCE(p.name, '(unknown)') AS process_name,
            t.name AS thread_name,
            t.upid,
            t.utid
          FROM thread t
          LEFT JOIN process p ON t.upid = p.upid
          WHERE (p.name LIKE '%${escapedProcess}%' OR t.upid IS NULL OR t.upid = 0)
            AND t.name LIKE '%${escapedThread}%'
          ORDER BY p.name, t.name
          LIMIT 50
        `;

        const result = await trace.engine.query(sql);
        const results: SearchResult[] = [];

        for (const it = result.iter({
          process_name: STR,
          thread_name: STR,
          upid: NUM,
          utid: NUM,
        }); it.valid(); it.next()) {
          results.push({
            processName: it.process_name ?? '',
            threadName: it.thread_name ?? '',
            upid: it.upid ?? 0,
            utid: it.utid ?? 0,
          });
        }

        // 如果SQL未找到结果，尝试从workspace轨道中搜索
        if (results.length === 0) {
          this.searchTracksForProcessThread(trace, processPattern, threadPattern, results);
        }

        // 为 SQL 结果补充 trackUri
        const workspace = trace.currentWorkspace;
        if (workspace) {
          for (const r of results) {
            if (!r.trackUri) {
              for (const track of workspace.flatTracks) {
                if (
                  track.uri &&
                  (track.uri.includes(`thread_${r.utid}`) ||
                    track.uri.includes(`/utid_${r.utid}/`))
                ) {
                  r.trackUri = track.uri;
                  break;
                }
              }
            }
          }
        }

        this.searchResults = results;

        // +格式搜索：聚焦并高亮第一个结果
        if (results.length > 0) {
          const firstUri = results[0].trackUri;
          if (firstUri) {
            trace.scrollTo({track: {uri: firstUri, expandGroup: true}});
          }
          const uris = results
            .map((r) => r.trackUri)
            .filter((u): u is string => u !== undefined);
          applySearchHighlight(trace, uris);
        }
      } else {
        // ===== 正常文本搜索（浏览器式搜索） =====
        await this.doNormalSearch(trace, query);
      }

      // 添加到搜索历史
      this.addToHistory(query, this.store ?? undefined);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      this.isSearching = false;
      m.redraw();
    }
  }

  /**
   * 正常文本搜索：搜索所有轨道，匹配轨道标黄色底色
   */
  private async doNormalSearch(trace: Trace, query: string): Promise<void> {
    const escapedQuery = escapeSqlLike(query);

    // 1. 通过SQL查找匹配的进程/线程
    const sql = `
      SELECT
        COALESCE(p.name, '(unknown)') AS process_name,
        t.name AS thread_name,
        t.upid,
        t.utid
      FROM thread t
      LEFT JOIN process p ON t.upid = p.upid
      WHERE p.name LIKE '%${escapedQuery}%'
         OR t.name LIKE '%${escapedQuery}%'
      ORDER BY p.name, t.name
      LIMIT 200
    `;

    const result = await trace.engine.query(sql);
    const matchedUris: string[] = new Array<string>();
    const seenUris = new Set<string>();

    // 收集SQL匹配结果对应的轨道URI
    const workspace = trace.currentWorkspace;
    if (workspace) {
      for (const it = result.iter({
        process_name: STR,
        thread_name: STR,
        upid: NUM,
        utid: NUM,
      }); it.valid(); it.next()) {
        const utid = it.utid ?? 0;
        // 在workspace中查找对应轨道
        for (const track of workspace.flatTracks) {
          if (
            track.uri &&
            !seenUris.has(track.uri) &&
            (track.uri.includes(`thread_${utid}`) ||
              track.uri.includes(`/utid_${utid}/`))
          ) {
            seenUris.add(track.uri);
            matchedUris.push(track.uri);
          }
        }
      }

      // 2. 额外搜索：遍历workspace轨道，匹配标题
      const queryLower = query.toLowerCase();
      for (const track of workspace.flatTracks) {
        if (
          track.uri &&
          !seenUris.has(track.uri) &&
          ((track.name && track.name.toLowerCase().includes(queryLower)) ||
            (track.subtitle && track.subtitle.toLowerCase().includes(queryLower)))
        ) {
          seenUris.add(track.uri);
          matchedUris.push(track.uri);
        }
      }
    }

    this.matchedTrackUris = matchedUris;

    // 3. 如果有匹配结果，立即跳转到第一个并高亮
    if (matchedUris.length > 0) {
      this.currentMatchIndex = 0;
      this.scrollToMatchedTrack(trace, 0);
      applySearchHighlight(trace, matchedUris);
    }
  }

  /**
   * 从workspace轨道结构中搜索匹配的进程+线程
   * 兜底策略：当SQL查询未找到结果时，遍历轨道树
   */
  private searchTracksForProcessThread(
    trace: Trace,
    processPattern: string,
    threadPattern: string,
    results: SearchResult[],
  ): void {
    const workspace = trace.currentWorkspace;
    if (!workspace) return;

    const processLower = processPattern.toLowerCase();
    const threadLower = threadPattern.toLowerCase();

    // 遍历workspace轨道树，寻找匹配的进程组和线程轨道
    const processGroups = workspace.tracks.children;
    for (const group of processGroups) {
      const groupName = (group.name || '').toLowerCase();
      if (!groupName.includes(processLower)) continue;

      // 找到匹配的进程组，遍历其下线程轨道
      for (const track of group.flatTracks) {
        const trackName = (track.name || '').toLowerCase();
        if (!trackName.includes(threadLower)) continue;

        // 尝试从URI中提取utid
        const utidMatch = track.uri?.match(/thread_(\d+)/);
        const utid = utidMatch ? parseInt(utidMatch[1], 10) : 0;

        results.push({
          processName: group.name || '(unknown)',
          threadName: track.name || '',
          upid: 0,
          utid,
          trackUri: track.uri,
        });

        if (results.length >= 50) return;
      }
    }
  }

  /**
   * 跳转到下一个匹配轨道
   */
  private navigateToNextMatch(trace: Trace): void {
    if (this.matchedTrackUris.length === 0) return;

    this.currentMatchIndex =
      (this.currentMatchIndex + 1) % this.matchedTrackUris.length;
    this.scrollToMatchedTrack(trace, this.currentMatchIndex);
    m.redraw();
  }

  /**
   * 清空搜索状态（搜索框内容、搜索结果、trace 区域高亮）
   */
  private clearSearch(): void {
    this.searchQuery = '';
    this.matchedTrackUris = [];
    this.currentMatchIndex = -1;
    this.searchResults = [];
    this.hasSearched = false;
    this.lastSearchWasProcessThread = false;
    this.isSearching = false;
    clearSearchHighlight();
    m.redraw();
  }

  /**
   * 滚动到指定匹配的轨道
   */
  private scrollToMatchedTrack(trace: Trace, index: number): void {
    if (index < 0 || index >= this.matchedTrackUris.length) return;

    const uri = this.matchedTrackUris[index];
    trace.scrollTo({
      track: {uri, expandGroup: true},
    });
  }

  /**
   * 置顶/取消置顶线程（与 trace 主区域 pin 状态联动）
   */
  private async pinThread(trace: Trace, result: SearchResult): Promise<void> {
    try {
      const track = this.findTrackForResult(trace, result);
      if (track) {
        if (track.isPinned) {
          track.unpin();
        } else {
          track.pin();
        }
      }
      m.redraw();
    } catch (error) {
      console.error('Pin thread failed:', error);
    }
  }

  /**
   * 检查搜索结果对应的轨道是否已置顶
   */
  private isResultPinned(trace: Trace, result: SearchResult): boolean {
    const track = this.findTrackForResult(trace, result);
    return track?.isPinned ?? false;
  }

  /**
   * 根据 SearchResult 查找对应的 TrackNode
   */
  private findTrackForResult(
    trace: Trace,
    result: SearchResult,
  ): TrackNode | undefined {
    const workspace = trace.currentWorkspace;
    if (!workspace) return undefined;

    // 优先使用 trackUri 精确查找
    if (result.trackUri) {
      const track = workspace.getTrackByUri(result.trackUri);
      if (track) return track;
    }

    // 兜底：按 utid 在 flatTracks 中搜索
    for (const track of workspace.flatTracks) {
      if (
        track.uri &&
        (track.uri.includes(`thread_${result.utid}`) ||
          track.uri.includes(`/utid_${result.utid}/`))
      ) {
        return track;
      }
    }

    return undefined;
  }

  /**
   * 跳转到线程
   */
  private async goToThread(trace: Trace, result: SearchResult): Promise<void> {
    try {
      // 优先使用 trackUri 直接跳转
      if (result.trackUri) {
        trace.scrollTo({
          track: {uri: result.trackUri, expandGroup: true},
        });
        m.redraw();
        return;
      }

      // 兜底：从workspace中查找线程轨道
      const workspace = trace.currentWorkspace;
      if (workspace) {
        for (const track of workspace.flatTracks) {
          if (track.uri && track.uri.includes(`thread_${result.utid}`)) {
            trace.scrollTo({
              track: {uri: track.uri, expandGroup: true},
            });
            break;
          }
        }
      }

      // 查询线程的第一个 slice 的时间戳，滚动时间轴
      const sql = `
        SELECT ts FROM slice
        WHERE track_id IN (
          SELECT id FROM thread_track WHERE utid = ${result.utid}
        )
        ORDER BY ts
        LIMIT 1
      `;

      const queryResult = await trace.engine.query(sql);
      for (const it = queryResult.iter({ts: LONG}); it.valid(); it.next()) {
        const ts = it.ts;
        if (ts !== undefined && ts !== null) {
          trace.timeline.panIntoView(Time.fromRaw(ts));
        }
        break;
      }
      m.redraw();
    } catch (error) {
      console.error('Go to thread failed:', error);
    }
  }

  /**
   * 应用预置场景
   *
   * 走"进程+线程"搜索逻辑：
   * 1. 将每个线程配置拼接为"进程名+线程名"格式，执行搜索逻辑查找线程
   * 2. 将所有搜索到的轨道按顺序 pin 住
   * 3. 高亮搜索到的轨道，通知未找到的线程
   * 不修改搜索框内容和搜索结果列表
   */
  private async applyPreset(
    trace: Trace,
    preset: PresetPinScene,
    locale: 'zh' | 'en',
  ): Promise<void> {
    const failedThreads: string[] = [];

    try {
      // 收集所有预设线程配置对应的搜索结果
      const allResults: SearchResult[] = [];

      for (const threadConfig of preset.threads) {
        const searchQuery = `${threadConfig.processPattern}+${threadConfig.threadPattern}`;
        const escapedProcess = escapeSqlLike(threadConfig.processPattern);
        const escapedThread = escapeSqlLike(threadConfig.threadPattern);

        // 使用与 doSearch 相同的"进程+线程"SQL查询逻辑
        const sql = `
          SELECT
            COALESCE(p.name, '(unknown)') AS process_name,
            t.name AS thread_name,
            t.upid,
            t.utid
          FROM thread t
          LEFT JOIN process p ON t.upid = p.upid
          WHERE (p.name LIKE '%${escapedProcess}%' OR t.upid IS NULL OR t.upid = 0)
            AND t.name LIKE '%${escapedThread}%'
          ORDER BY p.name, t.name
          LIMIT 50
        `;

        const result = await trace.engine.query(sql);
        const results: SearchResult[] = [];

        for (const it = result.iter({
          process_name: STR,
          thread_name: STR,
          upid: NUM,
          utid: NUM,
        }); it.valid(); it.next()) {
          results.push({
            processName: it.process_name ?? '',
            threadName: it.thread_name ?? '',
            upid: it.upid ?? 0,
            utid: it.utid ?? 0,
          });
        }

        // SQL未找到结果时，从workspace轨道中搜索（兜底）
        if (results.length === 0) {
          this.searchTracksForProcessThread(
            trace,
            threadConfig.processPattern,
            threadConfig.threadPattern,
            results,
          );
        }

        // 为结果补充 trackUri
        const workspace = trace.currentWorkspace;
        if (workspace) {
          for (const r of results) {
            if (!r.trackUri) {
              for (const track of workspace.flatTracks) {
                if (
                  track.uri &&
                  (track.uri.includes(`thread_${r.utid}`) ||
                    track.uri.includes(`/utid_${r.utid}/`))
                ) {
                  r.trackUri = track.uri;
                  break;
                }
              }
            }
          }
        }

        if (results.length > 0) {
          allResults.push(...results);
        } else {
          failedThreads.push(searchQuery);
        }
      }

      // 按顺序 pin 住所有搜索到的轨道
      for (const r of allResults) {
        const track = this.findTrackForResult(trace, r);
        if (track && !track.isPinned) {
          track.pin();
        }
      }

      // 高亮搜索到的轨道
      if (allResults.length > 0) {
        const uris = allResults
          .map((r) => r.trackUri)
          .filter((u): u is string => u !== undefined);
        applySearchHighlight(trace, uris);

        const pinnedCount = allResults.filter(
          (r) => this.findTrackForResult(trace, r)?.isPinned,
        ).length;
        const successMsg =
          locale === 'zh'
            ? `已置顶 ${pinnedCount} 个线程`
            : `Pinned ${pinnedCount} thread(s)`;
        this.showNotification(successMsg);
      }

      // 显示失败提示
      if (failedThreads.length > 0) {
        const prefix =
          locale === 'zh' ? '未找到以下线程: ' : 'Threads not found: ';
        this.showNotification(`${prefix}${failedThreads.join(', ')}`);
      }

      m.redraw();
    } catch (error) {
      console.error('Apply preset failed:', error);
    }
  }

  /**
   * 显示临时通知（3秒后自动消失）
   */
  private showNotification(msg: string, durationMs = 3000): void {
    this.notification = msg;
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer);
    }
    this.notificationTimer = setTimeout(() => {
      this.notification = '';
      this.notificationTimer = null;
      m.redraw();
    }, durationMs);
    m.redraw();
  }

  /**
   * AI 置顶线程的公共接口
   * 供 PinThreadTool 调用，pin 后记录到 state.currentSession.pinnedTracks
   */
  static async pinThreadByAI(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    utid: number,
    processName: string,
    threadName: string,
  ): Promise<boolean> {
    const workspace = trace.currentWorkspace;
    if (!workspace) return false;

    const tracks = workspace.flatTracks;
    for (const track of tracks) {
      if (track.uri && track.uri.includes(`thread_${utid}`)) {
        track.pin();
        // 记录到 AI pinned tracks
        store.edit((draft) => {
          if (draft.currentSession) {
            const exists = draft.currentSession.pinnedTracks.some(
              (p) => p.trackId === track.uri,
            );
            if (!exists) {
              draft.currentSession.pinnedTracks.push({
                trackId: track.uri || '',
                processName,
                threadName,
                order: draft.currentSession.pinnedTracks.length,
              });
            }
          }
          // 同时记录到 aiPinnedTrackUris
          if (!draft.aiPinnedTrackUris.includes(track.uri || '')) {
            draft.aiPinnedTrackUris.push(track.uri || '');
          }
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 取消 AI 置顶标记
   * 仅移除 AI 标识，不取消 pin
   */
  static unpinAITrack(
    store: Store<OpenPerfettoState>,
    trackUri: string,
  ): void {
    store.edit((draft) => {
      draft.aiPinnedTrackUris = draft.aiPinnedTrackUris.filter(
        (uri) => uri !== trackUri,
      );
    });
  }

  /**
   * 检查轨道是否是 AI 置顶的
   */
  static isAIPinned(
    store: Store<OpenPerfettoState>,
    trackUri: string,
  ): boolean {
    return store.state.aiPinnedTrackUris.includes(trackUri);
  }


  /**
   * 添加到搜索历史（同步更新组件状态、store 和 localStorage）
   */
  private addToHistory(query: string, store?: Store<OpenPerfettoState>): void {
    // 移除重复项
    this.searchHistory = this.searchHistory.filter((h) => h !== query);
    // 添加到开头
    this.searchHistory.unshift(query);
    // 限制数量
    if (this.searchHistory.length > MAX_HISTORY_SIZE) {
      this.searchHistory = this.searchHistory.slice(0, MAX_HISTORY_SIZE);
    }
    // 同步到 store 和 localStorage
    if (store) {
      store.edit((draft) => {
        draft.searchHistory = [...this.searchHistory];
      });
    }
    this.saveSearchHistory();
  }

  /**
   * 保存搜索历史
   */
  private saveSearchHistory(): void {
    try {
      localStorage.setItem(
        SEARCH_HISTORY_KEY,
        JSON.stringify(this.searchHistory),
      );
    } catch (error) {
      console.warn('Failed to save search history:', error);
    }
  }
}
