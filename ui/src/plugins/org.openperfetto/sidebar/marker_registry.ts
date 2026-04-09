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
 * 全局标记注册表工具
 *
 * 将 AIMarker 列表同步到 window.__openperfettoMarkerRegistry，
 * 供 notes_panel.ts (核心插件) 读取以实现圆形序号渲染。
 *
 * 独立模块的原因：避免 index.ts → openperfetto_page.ts → markers_jump.ts
 * 的循环依赖，使 markers_jump.ts 可以直接 import 此函数。
 */

import {AIMarker} from '../types/plugin_state';
import {opLogger} from '../utils/logger';

/**
 * 同步标记注册表到全局 window.__openperfettoMarkerRegistry，
 * 供 notes_panel.ts 读取
 */
export function syncMarkerRegistry(markers: AIMarker[]): void {
  const sorted = [...markers].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  const registry = new Map<
    string,
    {index: number; isAI: boolean; note: string; color: string}
  >();
  sorted.forEach((m, i) => {
    registry.set(m.id, {
      index: i + 1,
      isAI: m.isAI,
      note: m.note || m.name,
      color: m.color || '#4285f4',
    });
  });
  (window as any).__openperfettoMarkerRegistry = registry;
  opLogger.debug('syncMarkerRegistry: updated', {
    total: markers.length,
    entries: sorted.map((m, i) => ({id: m.id, index: i + 1, ts: m.timestamp.toString()})),
  });
}
