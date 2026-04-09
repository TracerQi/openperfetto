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
 * OpenPerfetto 统一日志工具
 *
 * 使用特性开关控制调试日志输出，生产环境默认关闭。
 *
 * 开启调试日志（浏览器控制台）：
 *   localStorage.setItem('openperfetto.debug', 'true')
 *   // 或
 *   window.__openperfettoDebug = true
 *
 * 关闭调试日志：
 *   localStorage.removeItem('openperfetto.debug')
 *
 * warn / error 级别的日志无论开关状态都会输出。
 */

const LOG_PREFIX = '[OpenPerfetto]';

/**
 * 检查调试日志是否开启
 * 通过 localStorage 或全局变量控制，不污染生产日志
 */
function isDebugEnabled(): boolean {
  try {
    return (
      localStorage.getItem('openperfetto.debug') === 'true' ||
      (window as any).__openperfettoDebug === true
    );
  } catch {
    // localStorage 不可用（如 iframe sandbox 限制）时默认关闭
    return false;
  }
}

export const opLogger = {
  /**
   * 调试级别日志 — 仅在 debug 开关打开时输出
   */
  debug(msg: string, ...args: unknown[]): void {
    if (isDebugEnabled()) {
      console.log(`${LOG_PREFIX}[debug] ${msg}`, ...args);
    }
  },

  /**
   * 信息级别日志 — 仅在 debug 开关打开时输出
   */
  info(msg: string, ...args: unknown[]): void {
    if (isDebugEnabled()) {
      console.info(`${LOG_PREFIX}[info] ${msg}`, ...args);
    }
  },

  /**
   * 警告级别日志 — 始终输出（用于预期外的降级行为）
   */
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`${LOG_PREFIX}[warn] ${msg}`, ...args);
  },

  /**
   * 错误级别日志 — 始终输出
   */
  error(msg: string, ...args: unknown[]): void {
    console.error(`${LOG_PREFIX}[error] ${msg}`, ...args);
  },
};
