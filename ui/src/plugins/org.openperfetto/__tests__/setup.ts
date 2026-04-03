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
 * Jest 测试设置文件
 *
 * 在每个测试文件执行前运行，用于：
 * - 设置全局 mock
 * - 配置测试环境
 * - 扩展 Jest matchers
 */

// Mock requestAnimationFrame (jsdom doesn't provide it)
if (typeof requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  };
}

if (typeof cancelAnimationFrame === 'undefined') {
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

// Mock crypto.randomUUID if not available
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: (): string => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      },
    },
  });
}

// Mock performance.now if not available
if (typeof performance === 'undefined') {
  Object.defineProperty(global, 'performance', {
    value: {
      now: (): number => Date.now(),
    },
  });
}

// Suppress console.warn and console.error in tests (optional)
// Uncomment if needed:
// global.console.warn = jest.fn();
// global.console.error = jest.fn();

// 清理函数，每个测试后调用
afterEach(() => {
  jest.clearAllMocks();
});
