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
 * Mock Plugin Store
 *
 * 模拟 OpenPerfettoState Store，用于单元测试。
 * 基于 types/plugin_state.ts 定义。
 */

import {
  OpenPerfettoState,
  ConnectionState,
  AnalysisSession,
  SceneType,
  CURRENT_STATE_VERSION,
} from '../../types/plugin_state';
import { ChatMessage, AnalysisPlan } from '../../types/agent';
import { Artifact } from '../../types/artifact';

/**
 * Mock Store 接口
 */
export interface MockStore<T> {
  state: T;
  edit: jest.Mock<void, [(draft: T) => void]>;
}

/**
 * 创建默认的 OpenPerfettoState
 */
export function createDefaultMockState(): OpenPerfettoState {
  return {
    version: CURRENT_STATE_VERSION,
    initialized: true,
    connectionState: { status: 'disconnected' },
    currentSession: null,
    theme: 'light',
    locale: 'zh',
    presetPinScenes: [],
    searchHistory: [],
    markers: [],
    aiPinnedTrackUris: [],
  };
}

/**
 * 创建 Mock AnalysisSession
 */
export function createMockSession(options?: {
  id?: string;
  sceneType?: SceneType;
  messages?: ChatMessage[];
  plan?: AnalysisPlan | null;
}): AnalysisSession {
  return {
    id: options?.id ?? `session_${Date.now()}`,
    startTime: Date.now(),
    sceneType: options?.sceneType ?? 'general',
    messages: options?.messages ?? [],
    artifacts: new Map<string, Artifact>(),
    plan: options?.plan ?? null,
    pinnedTracks: [],
  };
}

/**
 * 创建 Mock ChatMessage
 */
export function createMockMessage(options?: {
  id?: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  timestamp?: number;
}): ChatMessage {
  return {
    id: options?.id ?? `msg_${Date.now()}`,
    role: options?.role ?? 'user',
    content: options?.content ?? 'Test message',
    timestamp: options?.timestamp ?? Date.now(),
  };
}

/**
 * 创建 Mock AnalysisPlan
 */
export function createMockPlan(options?: {
  id?: string;
  sceneType?: SceneType;
  phases?: Array<{
    id: string;
    name: string;
    description?: string;
    requiredTools?: string[];
    expectedOutputs?: string[];
  }>;
  successCriteria?: string[];
}): AnalysisPlan {
  return {
    id: options?.id ?? `plan_${Date.now()}`,
    sceneType: options?.sceneType ?? 'general',
    phases: (options?.phases ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      requiredTools: p.requiredTools ?? [],
      expectedOutputs: p.expectedOutputs ?? [],
      completed: false,
    })),
    successCriteria: options?.successCriteria ?? [],
    estimatedSteps: options?.phases?.length ?? 3,
    submittedAt: Date.now(),
  };
}

/**
 * 创建 Mock Store
 *
 * @param initialState 初始状态（可部分覆盖）
 * @returns Mock Store 对象
 *
 * @example
 * ```typescript
 * const store = createMockStore({
 *   connectionState: { status: 'connected', agentId: 'test-agent' },
 * });
 *
 * // 使用 store
 * store.edit((draft) => {
 *   draft.theme = 'dark';
 * });
 * ```
 */
export function createMockStore(
  initialState?: Partial<OpenPerfettoState>,
): MockStore<OpenPerfettoState> {
  const state: OpenPerfettoState = {
    ...createDefaultMockState(),
    ...initialState,
  };

  return {
    state,
    edit: jest.fn((cb: (draft: OpenPerfettoState) => void) => {
      cb(state);
    }),
  };
}

/**
 * 创建带有活动会话的 Mock Store
 */
export function createMockStoreWithSession(options?: {
  sessionOptions?: Parameters<typeof createMockSession>[0];
  connectionState?: ConnectionState;
}): MockStore<OpenPerfettoState> {
  const session = createMockSession(options?.sessionOptions);

  return createMockStore({
    connectionState: options?.connectionState ?? {
      status: 'connected',
      agentId: 'test-agent-id',
    },
    currentSession: session,
  });
}

/**
 * 类型断言辅助函数
 */
export function asMockStore(
  store: MockStore<OpenPerfettoState>,
): unknown {
  return store;
}
