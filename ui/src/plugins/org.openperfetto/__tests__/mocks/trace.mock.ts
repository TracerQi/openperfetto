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
 * Mock Perfetto Trace API
 *
 * 模拟 Trace 对象，用于单元测试。
 * 基于 ui/src/public/trace.ts 和实际源码使用情况定义。
 */

/**
 * Mock QueryResult 迭代器
 */
export interface MockQueryResultIter {
  valid: () => boolean;
  next: () => void;
  [key: string]: unknown;
}

/**
 * Mock QueryResult
 */
export interface MockQueryResult {
  numRows: () => number;
  columns: () => string[];
  firstRow: (spec: Record<string, unknown>) => Record<string, unknown>;
  iter: (spec: Record<string, unknown>) => MockQueryResultIter;
}

/**
 * Mock Engine
 */
export interface MockEngine {
  query: jest.Mock<Promise<MockQueryResult>, [string]>;
}

/**
 * Mock Timeline
 */
export interface MockTimeline {
  panIntoView: jest.Mock;
  panSpanIntoView: jest.Mock;
}

/**
 * Mock Workspace
 */
export interface MockWorkspace {
  pinnedTracks: unknown[];
}

/**
 * Mock Notes
 */
export interface MockNotes {
  addNote: jest.Mock;
}

/**
 * Mock Store (from mountStore)
 */
export interface MockMountedStore<T> {
  state: T;
  edit: jest.Mock<void, [(draft: T) => void]>;
}

/**
 * Mock Pages
 */
export interface MockPages {
  registerPage: jest.Mock;
}

/**
 * Mock Sidebar
 */
export interface MockSidebar {
  addMenuItem: jest.Mock;
}

/**
 * Mock Trash (cleanup registration)
 */
export interface MockTrash {
  defer: jest.Mock<void, [() => void]>;
}

/**
 * Mock TraceInfo
 */
export interface MockTraceInfo {
  traceTitle: string;
  traceUrl: string;
  start: bigint;
  end: bigint;
  realtimeOffset: bigint;
  utcOffset: number;
  traceTzOffset: number;
  cpus: number[];
  importErrors: number;
  traceType: string;
  hasFtrace: boolean;
  uuid: string;
  cached: boolean;
  downloadable: boolean;
  source: { type: string; [key: string]: unknown };
}

/**
 * Mock OnTraceReady
 */
export interface MockOnTraceReady {
  addListener: jest.Mock<void, [() => void | Promise<void>]>;
}

/**
 * Mock Trace 对象
 */
export interface MockTrace {
  engine: MockEngine;
  timeline: MockTimeline;
  currentWorkspace: MockWorkspace;
  notes: MockNotes;
  mountStore: jest.Mock<MockMountedStore<unknown>, [string, unknown?]>;
  pages: MockPages;
  sidebar: MockSidebar;
  trash: MockTrash;
  traceInfo: MockTraceInfo;
  onTraceReady: MockOnTraceReady;
}

/**
 * 创建空的 QueryResult Mock
 */
export function createEmptyQueryResult(): MockQueryResult {
  return {
    numRows: jest.fn().mockReturnValue(0),
    columns: jest.fn().mockReturnValue([]),
    firstRow: jest.fn().mockReturnValue({}),
    iter: jest.fn().mockReturnValue({
      valid: jest.fn().mockReturnValue(false),
      next: jest.fn(),
    }),
  };
}

/**
 * 创建带数据的 QueryResult Mock
 */
export function createQueryResult(
  rows: Record<string, unknown>[],
  columns?: string[],
): MockQueryResult {
  const cols = columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  let iterIndex = 0;

  return {
    numRows: jest.fn().mockReturnValue(rows.length),
    columns: jest.fn().mockReturnValue(cols),
    firstRow: jest.fn().mockReturnValue(rows[0] ?? {}),
    iter: jest.fn().mockImplementation((spec: Record<string, unknown>) => {
      iterIndex = 0;
      const iter: MockQueryResultIter = {
        valid: jest.fn().mockImplementation(() => iterIndex < rows.length),
        next: jest.fn().mockImplementation(() => {
          iterIndex++;
        }),
      };

      // 添加动态属性访问
      for (const key of Object.keys(spec)) {
        Object.defineProperty(iter, key, {
          get: () => (rows[iterIndex] ? rows[iterIndex][key] : undefined),
          enumerable: true,
        });
      }

      return iter;
    }),
  };
}

/**
 * 创建 Mock Trace 对象
 *
 * @param options 可选配置
 * @returns Mock Trace 对象
 *
 * @example
 * ```typescript
 * const trace = createMockTrace();
 *
 * // 配置 query 返回值
 * trace.engine.query.mockResolvedValueOnce(createQueryResult([
 *   { cnt: 5 },
 * ]));
 *
 * // 使用 trace
 * const result = await someFunction(trace);
 * ```
 */
export function createMockTrace(options?: {
  traceTitle?: string;
  initialState?: Record<string, unknown>;
}): MockTrace {
  const defaultState = options?.initialState ?? {};

  return {
    engine: {
      query: jest.fn().mockResolvedValue(createEmptyQueryResult()),
    },
    timeline: {
      panIntoView: jest.fn(),
      panSpanIntoView: jest.fn(),
    },
    currentWorkspace: {
      pinnedTracks: [],
    },
    notes: {
      addNote: jest.fn(),
    },
    mountStore: jest.fn().mockImplementation((_key: string, _migrate?: unknown) => {
      const state = { ...defaultState };
      return {
        state,
        edit: jest.fn((cb: (draft: Record<string, unknown>) => void) => {
          cb(state);
        }),
      };
    }),
    pages: {
      registerPage: jest.fn(),
    },
    sidebar: {
      addMenuItem: jest.fn(),
    },
    trash: {
      defer: jest.fn(),
    },
    traceInfo: {
      traceTitle: options?.traceTitle ?? 'test-trace.perfetto-trace',
      traceUrl: 'file:///test-trace.perfetto-trace',
      start: BigInt(0),
      end: BigInt(1000000000),
      realtimeOffset: BigInt(0),
      utcOffset: 0,
      traceTzOffset: 0,
      cpus: [0, 1, 2, 3],
      importErrors: 0,
      traceType: 'proto',
      hasFtrace: true,
      uuid: 'test-uuid-1234',
      cached: false,
      downloadable: true,
      source: { type: 'FILE' },
    },
    onTraceReady: {
      addListener: jest.fn(),
    },
  };
}

/**
 * 类型断言辅助函数
 * 将 MockTrace 转换为 any 类型以适配实际 Trace 类型
 */
export function asMockTrace(trace: MockTrace): unknown {
  return trace;
}
