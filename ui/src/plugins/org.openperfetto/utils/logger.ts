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

import {featureFlags} from '../../../core/feature_flags';

/**
 * OpenPerfetto 调试日志 Feature Flag
 *
 * 通过 Feature Flag 系统控制，可在浏览器设置页面或命令行动态开关。
 * 默认关闭，生产环境不输出调试日志。
 *
 * 开启方式（任选其一）：
 *   1. 浏览器控制台 → Flags 页面 → 搜索 "openperfettoDebugLogging" → 开启
 *   2. localStorage.setItem('openperfetto.debug', 'true')
 *   3. window.__openperfettoDebug = true
 *
 * 关闭调试日志：
 *   1. Flags 页面关闭
 *   2. localStorage.removeItem('openperfetto.debug')
 *
 * warn / error 级别的日志无论开关状态都会输出。
 */
export const OPENPERFETTO_DEBUG_LOGGING_FLAG = featureFlags.register({
  id: 'openperfettoDebugLogging',
  name: 'OpenPerfetto Debug Logging',
  description:
    'Enable debug/info logging for OpenPerfetto AI agent workflow. ' +
    'Shows state transitions, tool calls, LLM messages in browser console.',
  defaultValue: false,
  devOnly: true,
});

const LOG_PREFIX = '[OpenPerfetto]';

/**
 * 检查调试日志是否开启
 * 优先级：Feature Flag > localStorage > 全局变量
 */
function isDebugEnabled(): boolean {
  // 1. Feature Flag 控制（最高优先级）
  if (OPENPERFETTO_DEBUG_LOGGING_FLAG.get()) {
    return true;
  }
  // 2. 向后兼容：localStorage / 全局变量
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
