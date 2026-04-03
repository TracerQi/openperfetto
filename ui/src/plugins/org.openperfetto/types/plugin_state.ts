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

import {Migrate} from '../../../base/store';
import {ChatMessage, AnalysisPlan} from './agent';
import {Artifact} from './artifact';

/**
 * OpenPerfetto 插件的全局状态
 *
 * 状态管理规范：
 * - 使用 trace.mountStore() 挂载状态，而非通过 props 传递
 * - 所有组件通过 Store 读写状态
 * - 使用 migration 函数处理状态版本升级
 * - 使用 trace.trash 注册资源清理回调
 */
export interface OpenPerfettoState {
  /** 状态版本，用于 migration */
  version: number;

  /** 是否已初始化 */
  initialized: boolean;

  /** 当前连接状态 */
  connectionState: ConnectionState;

  /** 当前分析会话 */
  currentSession: AnalysisSession | null;

  /** 当前主题 */
  theme: 'light' | 'dark';

  /** 当前语言 */
  locale: 'zh' | 'en';

  /** 预置 Pin 场景列表 */
  presetPinScenes: PresetPinScene[];

  /** 搜索历史（最近20条） */
  searchHistory: string[];

  /** AI标记列表 */
  markers: AIMarker[];
}

/** 当前状态版本 */
export const CURRENT_STATE_VERSION = 2;

/**
 * 创建默认状态
 * 替代 localStorage 初始化，确保状态结构一致性
 */
export function createDefaultState(): OpenPerfettoState {
  return {
    version: CURRENT_STATE_VERSION,
    initialized: false,
    connectionState: {status: 'disconnected'},
    currentSession: null,
    theme: 'light',
    locale: 'zh',
    presetPinScenes: [],
    searchHistory: [],
    markers: [],
  };
}

/**
 * 状态 Migration 函数
 * 处理状态版本升级，确保向后兼容
 *
 * @param oldState 旧状态（可能是任意版本或undefined）
 * @returns 升级后的状态
 *
 * 使用方式：
 * ```typescript
 * const store = trace.mountStore<OpenPerfettoState>(
 *   'openperfetto_state',
 *   migrateState
 * );
 * ```
 */
export const migrateState: Migrate<OpenPerfettoState> = (
  oldState: unknown,
): OpenPerfettoState => {
  // 如果没有旧状态，返回默认状态
  if (!oldState || typeof oldState !== 'object') {
    return createDefaultState();
  }

  const state = oldState as Partial<OpenPerfettoState>;
  const version = state.version ?? 0;

  // 版本 0 -> 1: 添加 searchHistory
  if (version < 1) {
    state.searchHistory = state.searchHistory ?? [];
    state.version = 1;
  }

  // 版本 1 -> 2: 添加 markers, 移除 sidebarExpanded (改为Page模式)
  if (version < 2) {
    state.markers = state.markers ?? [];
    state.version = 2;
    // 清理废弃字段
    delete (state as Record<string, unknown>).sidebarExpanded;
  }

  // 确保所有必需字段存在
  return {
    ...createDefaultState(),
    ...state,
    version: CURRENT_STATE_VERSION,
  };
};

export type ConnectionState =
  | {status: 'disconnected'}
  | {status: 'connecting'}
  | {status: 'connected'; agentId: string}
  | {status: 'error'; message: string};

export interface AnalysisSession {
  id: string;
  startTime: number;
  sceneType: SceneType;
  messages: ChatMessage[];
  artifacts: Map<string, Artifact>;
  plan: AnalysisPlan | null;
  pinnedTracks: AIPinnedTrack[];
}

export type SceneType =
  | 'scrolling'
  | 'startup_cold'
  | 'startup_warm'
  | 'startup_hot'
  | 'anr'
  | 'lock_contention'
  | 'binder_blocking'
  | 'io_analysis'
  | 'high_load'
  | 'screen_on_off'
  | 'unlock'
  | 'general';

export interface AIMarker {
  id: string;
  sliceId: number;
  timestamp: bigint;
  duration: bigint;
  name: string;
  note: string;
  severity: 'info' | 'warning' | 'error';
  createdAt: number;
}

export interface AIPinnedTrack {
  trackId: string;
  processName: string;
  threadName: string;
  order: number;
}

export interface PresetPinScene {
  id: string;
  name: string;
  threads: PresetPinThread[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetPinThread {
  processPattern: string;
  threadPattern: string;
  order: number;
}
