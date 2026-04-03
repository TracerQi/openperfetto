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
 * Mock 模块导出
 *
 * 统一导出所有测试 Mock，方便测试文件导入使用。
 *
 * @example
 * ```typescript
 * import {
 *   createMockTrace,
 *   createMockStore,
 *   createMockWebSocketClient,
 * } from '../mocks';
 * ```
 */

// Trace Mocks
export {
  createMockTrace,
  createEmptyQueryResult,
  createQueryResult,
  asMockTrace,
  type MockTrace,
  type MockEngine,
  type MockQueryResult,
  type MockQueryResultIter,
} from './trace.mock';

// Store Mocks
export {
  createMockStore,
  createMockStoreWithSession,
  createMockSession,
  createMockMessage,
  createMockPlan,
  createDefaultMockState,
  asMockStore,
  type MockStore,
} from './store.mock';

// WebSocket Mocks
export {
  createMockWebSocketClient,
  createWebSocketClientModuleMock,
  asMockWebSocketClient,
  type MockWebSocketClient,
  type WebSocketMessage,
} from './websocket.mock';
