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
 * - 搜索框：支持 "进程名+线程名" 格式搜索
 * - 搜索结果列表：显示匹配的进程/线程
 * - Pin/Go 操作
 * - 搜索历史
 * - 预置 Pin 场景
 */

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {OpenPerfettoState, PresetPinScene} from '../types/plugin_state';
import {t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {Button} from '../../../widgets/button';
import {NUM, STR, LONG} from '../../../trace_processor/query_result';
import {Time} from '../../../base/time';

const SEARCH_HISTORY_KEY = 'openperfetto_search_history';
const MAX_HISTORY_SIZE = 10;

export interface SearchPinAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  collapsed: boolean;
  onToggleCollapse: () => void;
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
  private showHistory: boolean = false;
  private showPresets: boolean = true;

  oninit(): void {
    // 从 localStorage 加载搜索历史
    this.loadSearchHistory();
  }

  view({attrs}: m.CVnode<SearchPinAttrs>): m.Children {
    const {trace, store, collapsed} = attrs;
    const state = store.state;

    if (collapsed) {
      return null;
    }

    return m('.openperfetto-search-pin', [
      // 搜索框区域
      this.renderSearchBox(trace, state.locale),

      // 搜索历史（下拉）
      this.showHistory &&
        this.searchHistory.length > 0 &&
        this.renderSearchHistory(state.locale),

      // 搜索中 loading 提示
      this.isSearching &&
        m('.openperfetto-search-pin__loading', t(state.locale, 'searchPin.searching')),

      // 搜索结果列表
      this.searchResults.length > 0 &&
        this.renderSearchResults(trace, state.locale),

      // 无结果提示
      !this.isSearching &&
        this.searchQuery.trim() !== '' &&
        this.searchResults.length === 0 &&
        m('.openperfetto-search-pin__no-results', t(state.locale, 'searchPin.noResults')),

      // 预置场景列表
      this.renderPresetScenes(trace, store, state.locale),
    ]);
  }

  /**
   * 渲染搜索框
   */
  private renderSearchBox(trace: Trace, locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-search-pin__search-box', [
      m('input.openperfetto-search-pin__input', {
        type: 'text',
        placeholder: t(locale, 'searchPin.placeholder'),
        value: this.searchQuery,
        oninput: (e: Event) => {
          this.searchQuery = (e.target as HTMLInputElement).value;
        },
        onfocus: () => {
          this.showHistory = true;
        },
        onblur: () => {
          // 延迟隐藏，让点击事件先触发
          setTimeout(() => {
            this.showHistory = false;
            m.redraw();
          }, 200);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.doSearch(trace);
          }
        },
      }),
      m(Button, {
        icon: 'search',
        onclick: () => this.doSearch(trace),
        title: locale === 'zh' ? '搜索' : 'Search',
        compact: true,
        disabled: this.isSearching,
      }),
    ]);
  }

  /**
   * 渲染搜索历史
   */
  private renderSearchHistory(locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-search-pin__history', [
      m(
        '.openperfetto-search-pin__history-header',
        locale === 'zh' ? '搜索历史' : 'Search History',
      ),
      this.searchHistory.map((query) =>
        m(
          '.openperfetto-search-pin__history-item',
          {
            onclick: () => {
              this.searchQuery = query;
              this.showHistory = false;
            },
          },
          [m(Icon, {icon: 'history'}), m('span', query)],
        ),
      ),
    ]);
  }

  /**
   * 渲染搜索结果
   */
  private renderSearchResults(trace: Trace, locale: 'zh' | 'en'): m.Children {
    return m('.openperfetto-search-pin__results', [
      m(
        '.openperfetto-search-pin__results-header',
        `${locale === 'zh' ? '搜索结果' : 'Results'} (${this.searchResults.length})`,
      ),
      m(
        '.openperfetto-search-pin__results-list',
        this.searchResults.map((result) =>
          m('.openperfetto-search-pin__result-item', [
            m('.openperfetto-search-pin__result-info', [
              m('.openperfetto-search-pin__result-process', result.processName),
              m('.openperfetto-search-pin__result-thread', result.threadName),
              m(
                '.openperfetto-search-pin__result-ids',
                `upid:${result.upid} utid:${result.utid}`,
              ),
            ]),
            m('.openperfetto-search-pin__result-actions', [
              m(Button, {
                icon: 'push_pin',
                onclick: () => this.pinThread(trace, result),
                title: locale === 'zh' ? '置顶' : 'Pin',
                compact: true,
              }),
              m(Button, {
                icon: 'my_location',
                onclick: () => this.goToThread(trace, result),
                title: locale === 'zh' ? '跳转' : 'Go',
                compact: true,
              }),
            ]),
          ]),
        ),
      ),
    ]);
  }

  /**
   * 渲染预置场景
   */
  private renderPresetScenes(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    locale: 'zh' | 'en',
  ): m.Children {
    const presets = store.state.presetPinScenes;

    return m('.openperfetto-search-pin__presets', [
      m(
        '.openperfetto-search-pin__presets-header',
        {
          onclick: () => {
            this.showPresets = !this.showPresets;
          },
        },
        [
          m(Icon, {icon: 'bookmark'}),
          m('span', t(locale, 'searchPin.presets')),
          m(Icon, {
            icon: this.showPresets ? 'expand_less' : 'expand_more',
            className: 'openperfetto-search-pin__presets-toggle',
          }),
        ],
      ),
      this.showPresets &&
        m('.openperfetto-search-pin__presets-list', [
          presets.length === 0 &&
            m(
              '.openperfetto-search-pin__presets-empty',
              locale === 'zh' ? '暂无预置场景' : 'No preset scenes',
            ),
          presets.map((preset) =>
            m('.openperfetto-search-pin__preset-item', [
              m('.openperfetto-search-pin__preset-info', [
                m('.openperfetto-search-pin__preset-name', preset.name),
                m(
                  '.openperfetto-search-pin__preset-count',
                  `${preset.threads.length} ${locale === 'zh' ? '个线程' : 'threads'}`,
                ),
              ]),
              m('.openperfetto-search-pin__preset-actions', [
                m(Button, {
                  icon: 'play_arrow',
                  onclick: () => this.applyPreset(trace, preset),
                  title: locale === 'zh' ? '应用' : 'Apply',
                  compact: true,
                }),
              ]),
            ]),
          ),
        ]),
    ]);
  }

  /**
   * 执行搜索
   */
  private async doSearch(trace: Trace): Promise<void> {
    const query = this.searchQuery.trim();
    if (!query) return;

    this.isSearching = true;
    this.searchResults = [];
    m.redraw();

    try {
      // 解析搜索模式：进程名+线程名 或 单独匹配
      let processPattern = '';
      let threadPattern = '';

      if (query.includes('+')) {
        const parts = query.split('+');
        processPattern = parts[0].trim();
        threadPattern = parts[1]?.trim() || '';
      } else {
        // 单独输入视为同时匹配进程名和线程名
        processPattern = query;
        threadPattern = query;
      }

      const escapedProcess = escapeSqlLike(processPattern);
      const escapedThread = escapeSqlLike(threadPattern);

      // 构建 SQL 查询
      let sql: string;
      if (query.includes('+')) {
        sql = `
          SELECT 
            p.name AS process_name,
            t.name AS thread_name,
            p.upid,
            t.utid
          FROM thread t
          JOIN process p ON t.upid = p.upid
          WHERE p.name LIKE '%${escapedProcess}%'
            AND t.name LIKE '%${escapedThread}%'
          ORDER BY p.name, t.name
          LIMIT 50
        `;
      } else {
        // 单独输入：匹配进程名或线程名
        sql = `
          SELECT 
            p.name AS process_name,
            t.name AS thread_name,
            p.upid,
            t.utid
          FROM thread t
          JOIN process p ON t.upid = p.upid
          WHERE p.name LIKE '%${escapedProcess}%'
             OR t.name LIKE '%${escapedThread}%'
          ORDER BY p.name, t.name
          LIMIT 50
        `;
      }

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

      this.searchResults = results;

      // 添加到搜索历史
      this.addToHistory(query);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      this.isSearching = false;
      m.redraw();
    }
  }

  /**
   * 置顶线程
   */
  private async pinThread(trace: Trace, result: SearchResult): Promise<void> {
    try {
      const workspace = trace.currentWorkspace;
      if (!workspace) return;

      const tracks = workspace.flatTracks;
      for (const track of tracks) {
        if (track.uri && track.uri.includes(`thread_${result.utid}`)) {
          track.pin();
          break;
        }
      }
      m.redraw();
    } catch (error) {
      console.error('Pin thread failed:', error);
    }
  }

  /**
   * 跳转到线程
   */
  private async goToThread(trace: Trace, result: SearchResult): Promise<void> {
    try {
      // 查询线程的第一个 slice 的时间戳，使用 thread_track 等值匹配 utid
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
   */
  private async applyPreset(
    trace: Trace,
    preset: PresetPinScene,
  ): Promise<void> {
    try {
      for (const threadConfig of preset.threads) {
        const escapedProcess = escapeSqlLike(threadConfig.processPattern);
        const escapedThread = escapeSqlLike(threadConfig.threadPattern);

        const sql = `
          SELECT t.utid
          FROM thread t
          JOIN process p ON t.upid = p.upid
          WHERE p.name LIKE '%${escapedProcess}%'
            AND t.name LIKE '%${escapedThread}%'
          LIMIT 10
        `;

        const result = await trace.engine.query(sql);
        const workspace = trace.currentWorkspace;
        if (!workspace) continue;

        for (const it = result.iter({utid: NUM}); it.valid(); it.next()) {
          const utid = it.utid;
          if (utid === undefined) continue;

          const tracks = workspace.flatTracks;
          for (const track of tracks) {
            if (track.uri && track.uri.includes(`thread_${utid}`)) {
              track.pin();
              break;
            }
          }
        }
      }
      m.redraw();
    } catch (error) {
      console.error('Apply preset failed:', error);
    }
  }

  /**
   * 加载搜索历史
   */
  private loadSearchHistory(): void {
    try {
      const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (stored) {
        this.searchHistory = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load search history:', error);
    }
  }

  /**
   * 添加到搜索历史
   */
  private addToHistory(query: string): void {
    // 移除重复项
    this.searchHistory = this.searchHistory.filter((h) => h !== query);
    // 添加到开头
    this.searchHistory.unshift(query);
    // 限制数量
    if (this.searchHistory.length > MAX_HISTORY_SIZE) {
      this.searchHistory = this.searchHistory.slice(0, MAX_HISTORY_SIZE);
    }
    // 保存到 localStorage
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
