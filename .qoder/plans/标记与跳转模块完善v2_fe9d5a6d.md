# 标记与跳转模块完善方案 v2

## 一、现状分析与需求差距

### 已实现
- E键快捷键标记（选中slice或鼠标位置）
- 侧边栏标记列表（圆形序号 + 进程/线程 + Tag + 备注编辑）
- Perfetto Note 创建（时间轴上显示 flag 旗帜）
- 基础跳转（panIntoView/panSpanIntoView + selectSqlEvent）

### 未实现（需求差距）

| 需求 | 现状 | 差距 |
|------|------|------|
| 时间轴显示**圆形序号**（非flag旗帜） | 使用 Perfetto 原生 flag 图标 | 需修改 `notes_panel.ts` Canvas 渲染逻辑 |
| 圆形序号后可**输入备注** | 仅显示 "User Marker" 文字 | 需在 note.text 中显示实际备注，支持点击编辑 |
| 跳转时**展开折叠的进程Track** | 仅 pan + selectSqlEvent | 需记录 trackUri，调用 `scrollTo({track:{uri, expandGroup:true}})` |
| 跳转时**恢复标记时的timeline缩放** | 仅 pan 到时间点 | 需记录 visibleWindow，跳转时调用 `setVisibleWindow()` |
| **记录标记时的缩放状态** | AIMarker 无 zoom 字段 | 需扩展数据模型，创建标记时捕获 visibleWindow |
| AI标记使用**默认缩放大小** | 无此逻辑 | 需定义默认缩放窗口宽度常量 |

---

## 二、技术方案

### 关键架构决策

**时间轴圆形标记渲染方案** — 修改 `notes_panel.ts` Canvas 渲染：
- 在 `renderPanel()` 中识别 OpenPerfetto 标记（通过全局注册表 `window.__openperfettoMarkerRegistry`）
- 对匹配的 note 调用新方法 `drawCircleMarker()` 替代 `drawFlag()`
- 圆形标记绘制：填充圆 + 白色序号文字 + 备注文本
- 点击圆形标记时，通过已有 `selectNote` 流程联动侧边栏编辑
- 原因：notes_panel.ts 是 Canvas 面板，圆形渲染必须在 Canvas 层完成；DOM overlay 方案需要复杂的位置同步且架构侵入性更大

**全局注册表** — `window.__openperfettoMarkerRegistry`:
- 类型: `Map<string, {index: number, isAI: boolean, note: string, color: string}>`
- 由 OpenPerfetto 插件维护，notes_panel.ts 只读
- 松耦合：notes_panel.ts 仅在该 map 存在时才应用自定义渲染，不存在时完全保持原有行为

**zoom 状态存储** — 序列化为字符串：
- `visibleWindow.start.integral` 和 `visibleWindow.end` 是 `HighPrecisionTime`
- 存储为字符串 `start.toTime().toString()` / `end.toTime().toString()`（bigint 序列化）
- 恢复时通过 `HighPrecisionTimeSpan.fromTime(Time.fromRaw(BigInt(s)), Time.fromRaw(BigInt(e)))` 重建

---

## 三、分Task实现

### Task 1: 扩展 AIMarker 数据模型

**文件**: `ui/src/plugins/org.openperfetto/types/plugin_state.ts`

**改动**:
1. AIMarker 接口新增字段：
```typescript
export interface AIMarker {
  // ... 现有字段不变
  /** 标记时的 timeline 缩放状态 */
  timelineState?: {
    visibleWindowStart: string;  // bigint 序列化
    visibleWindowEnd: string;
  };
  /** 关联的 Track URI（用于跳转时展开） */
  relatedTrackUri?: string;
}
```
2. `CURRENT_STATE_VERSION` 从 5 升至 6
3. 新增版本 5→6 迁移逻辑：为现有 marker 补充 `timelineState: undefined`, `relatedTrackUri: undefined`
4. 新增常量 `DEFAULT_AI_ZOOM_DURATION_NS = 500_000_000`（500ms，AI 标记默认缩放窗口宽度）

---

### Task 2: 修改 notes_panel.ts 支持圆形标记渲染

**文件**: `ui/src/core_plugins/dev.perfetto.Timeline/notes_panel.ts`

**改动**:
1. 在 `renderPanel()` 的 note 遍历循环中，检查全局注册表：
```typescript
const registry = (window as any).__openperfettoMarkerRegistry as
  Map<string, {index: number; isAI: boolean; note: string; color: string}> | undefined;
const markerInfo = registry?.get(note.id);
```

2. 若 `markerInfo` 存在，调用新方法 `drawCircleMarker()` 替代 `drawFlag()`：
```typescript
if (markerInfo) {
  this.drawCircleMarker(ctx, left, size.height, markerInfo.color, markerInfo.index, isSelected);
} else {
  // 保持原有 drawFlag 逻辑
}
```

3. 新增 `drawCircleMarker()` 方法：
```typescript
private drawCircleMarker(
  ctx: CanvasRenderingContext2D,
  x: number, height: number,
  color: string, index: number,
  isSelected: boolean,
) {
  const radius = 9;
  const cy = height / 2;
  // 偏移12px，不遮挡标记位置
  const cx = x + 12;
  // 绘制填充圆
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  if (isSelected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // 绘制序号文字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${index}`, cx, cy);
  // 恢复对齐设置
  ctx.textAlign = 'start';
}
```

4. 修改 note.text 渲染逻辑：对 OpenPerfetto 标记，显示注册表中的 `note` 字段（而非 note.text 中的 "User Marker"），显示在圆形右侧偏移位置

5. 修改 `hitTestNote()` 方法：对 OpenPerfetto 标记使用圆形碰撞检测（圆心 + 半径），而非 flag 矩形碰撞

---

### Task 3: 增强E键标记逻辑 + 全局注册表管理

**文件**: `ui/src/plugins/org.openperfetto/index.ts`

**改动**:

1. **全局注册表初始化** — 在 `onTraceLoad()` 中初始化并在标记变更时同步：
```typescript
function syncMarkerRegistry(markers: AIMarker[]) {
  const sorted = [...markers].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
  );
  const registry = new Map<string, {index: number; isAI: boolean; note: string; color: string}>();
  sorted.forEach((m, i) => {
    registry.set(m.id, {
      index: i + 1,
      isAI: m.isAI,
      note: m.note || m.name,
      color: m.color || '#4285f4',
    });
  });
  (window as any).__openperfettoMarkerRegistry = registry;
}
```
在所有修改 markers 的地方（创建、删除、清空、同步、编辑备注）后调用 `syncMarkerRegistry()`。

2. **记录 timeline 状态** — 在 `handleMarkerShortcut()` 中，创建 marker 时捕获 visibleWindow：
```typescript
const visWindow = trace.timeline.visibleWindow;
const timelineState = {
  visibleWindowStart: visWindow.start.toTime().toString(),
  visibleWindowEnd: visWindow.end.toTime().toString(),
};
```
将 `timelineState` 写入新创建的 marker 对象。

3. **记录关联 Track URI** — 当选中 slice 时，查询其所属 track_id 并尝试找到对应 TrackNode 的 URI：
```sql
SELECT s.track_id FROM slice s WHERE s.id = ${eventId}
```
然后遍历 `trace.workspace.currentWorkspace` 的 tracks 查找匹配的 URI（track URI 通常包含 track_id 信息，格式如 `/thread_track_${id}`）。如果找不到精确匹配，存储空字符串。

4. **更新 store.edit 后同步注册表**：
```typescript
store.edit((draft) => {
  draft.markers = [...draft.markers, marker];
});
syncMarkerRegistry(store.state.markers);
```

---

### Task 4: 完善跳转逻辑

**文件**: `ui/src/plugins/org.openperfetto/sidebar/markers_jump.ts`

**改动**: 重写 `navigateToMarker()` 方法：

```typescript
private navigateToMarker(trace: Trace, marker: AIMarker): void {
  try {
    // 1. 恢复 timeline 缩放状态
    if (marker.timelineState) {
      const start = Time.fromRaw(BigInt(marker.timelineState.visibleWindowStart));
      const end = Time.fromRaw(BigInt(marker.timelineState.visibleWindowEnd));
      const span = HighPrecisionTimeSpan.fromTime(start, end);
      trace.timeline.setVisibleWindow(span);
    } else if (marker.isAI) {
      // AI 标记：使用默认缩放窗口（以标记为中心，宽度 DEFAULT_AI_ZOOM_DURATION_NS）
      const halfDur = BigInt(DEFAULT_AI_ZOOM_DURATION_NS) / 2n;
      const start = Time.fromRaw(marker.timestamp - halfDur);
      const end = Time.fromRaw(marker.timestamp + halfDur);
      trace.timeline.setVisibleWindow(HighPrecisionTimeSpan.fromTime(start, end));
    } else {
      // Fallback: 居中导航
      const startTime = Time.fromRaw(marker.timestamp);
      if (marker.duration > 0n) {
        trace.timeline.panSpanIntoView(startTime, Time.fromRaw(marker.timestamp + marker.duration), {align: 'zoom', margin: 0.1});
      } else {
        trace.timeline.panIntoView(startTime, {align: 'center'});
      }
    }

    // 2. 展开折叠的 Track + 滚动到对应 track
    if (marker.sliceId) {
      trace.selection.selectSqlEvent('slice', marker.sliceId, {
        scrollToSelection: true,
        switchToCurrentSelectionTab: false,
      });
    } else if (marker.relatedTrackUri) {
      trace.scrollTo({
        track: {uri: marker.relatedTrackUri, expandGroup: true},
      });
    }

    m.redraw();
  } catch (error) {
    console.error('Navigate to marker failed:', error);
  }
}
```

**新增 import**:
```typescript
import {HighPrecisionTimeSpan} from '../../../base/high_precision_time_span';
import {DEFAULT_AI_ZOOM_DURATION_NS} from '../types/plugin_state';
```

注意：`selectSqlEvent` 的 `scrollToSelection: true` 选项本身会调用 `scrollTo({track:{uri, expandGroup: true}})`，会自动展开折叠的 track 组。因此对于有 sliceId 的 marker，展开逻辑已内置于 Perfetto 的 selection 流程中。

---

### Task 5: 适配 mark_position Tool（AI标记）

**文件**: `ui/src/plugins/org.openperfetto/tools/mark_position.ts`

**改动**:
1. 在 `execute()` 成功创建标记后，记录默认 timeline 状态：
```typescript
// AI 标记使用默认缩放窗口
const halfDur = BigInt(DEFAULT_AI_ZOOM_DURATION_NS) / 2n;
const defaultTimelineState = {
  visibleWindowStart: (timestamp - halfDur).toString(),
  visibleWindowEnd: (timestamp + halfDur).toString(),
};
```

2. 在返回的 `data` 中新增 `timelineState` 字段，供 `extractSessionMarkers()` 同步时使用

3. 更新 `markers_jump.ts` 中的 `extractSessionMarkers()` 方法，解析新的 `timelineState` 字段

---

## 四、文件变更清单

| 文件 | 变更类型 | 主要改动 |
|------|---------|---------|
| `types/plugin_state.ts` | 修改 | AIMarker 接口 +2 字段，版本 5→6 迁移，新增常量 |
| `notes_panel.ts` | 修改 | 新增 drawCircleMarker()，renderPanel() 判断逻辑，hitTest 适配 |
| `index.ts` | 修改 | syncMarkerRegistry()，handleMarkerShortcut() 记录状态 |
| `markers_jump.ts` | 修改 | navigateToMarker() 重写，extractSessionMarkers() 适配 |
| `mark_position.ts` | 修改 | 返回 timelineState，使用默认缩放常量 |

---

## 五、依赖关系

```
Task 1 (数据模型) ──┬──> Task 2 (notes_panel 渲染)
                    ├──> Task 3 (E键增强 + 注册表)
                    ├──> Task 4 (跳转逻辑)
                    └──> Task 5 (AI Tool 适配)
```

Task 2/3/4/5 均依赖 Task 1 完成后才能开始。Task 2 和 Task 3 之间有隐含依赖（Task 3 提供注册表数据，Task 2 消费），建议 Task 3 先于 Task 2 完成。Task 4 和 Task 5 独立于 Task 2/3。

推荐执行顺序：Task 1 → Task 3 + Task 4 + Task 5（并行）→ Task 2
