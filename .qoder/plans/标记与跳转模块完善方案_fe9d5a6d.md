# 标记与跳转模块完善方案

## 当前状态分析

### 已实现（正常工作）
- 侧边栏标记列表渲染（序号、名称、时间戳、severity、备注）
- 备注行内编辑（Enter/Esc快捷键）
- 标记导航跳转（panIntoView + slice选中）
- 删除与清空标记
- AI标记从会话同步（extractSessionMarkers）
- 样式与深色主题、国际化

### 缺失/不完整（需要补齐）

| 缺失功能 | 需求描述 | 优先级 |
|---------|---------|--------|
| 快捷键"E"标记 | 选中slice按E标记该slice；未选中则标记鼠标悬停位置 | P0 |
| 用户标记创建入口 | 当前只有AI能通过mark_position创建标记，用户无法手动创建 | P0 |
| 进程/线程/Tag显示 | 侧边栏列表应显示"标记序号+进程+线程+Tag+分析内容" | P0 |
| AI标记图标区分 | AI标记需在序号后显示圆形AI图标(smart_toy)，区别于用户标记 | P1 |
| AIMarker数据模型 | 缺少 isAI、processName、threadName、sliceName、color 字段 | P0 |
| mark_position返回值 | AI Tool不返回process/thread信息，同步时无法显示 | P1 |
| 空状态提示 | 应提示"选中Slice后按E键添加标记"而非仅"暂无标记" | P2 |

---

## 实施方案

### Task 1: 扩展 AIMarker 数据模型

**文件**: `ui/src/plugins/org.openperfetto/types/plugin_state.ts`

在 `AIMarker` 接口中添加缺失字段：

```typescript
export interface AIMarker {
  id: string;
  sliceId: number;
  timestamp: bigint;
  duration: bigint;
  name: string;
  note: string;
  severity: 'info' | 'warning' | 'error';
  createdAt: number;
  // 新增字段
  isAI: boolean;           // 是否为AI创建的标记
  processName: string;     // 进程名
  threadName: string;      // 线程名
  sliceName: string;       // Slice的Tag/名称
  color: string;           // 标记颜色
}
```

同步更新 `createDefaultState()` 和 `migrateState()`（版本 4->5），为旧数据补充默认值。

---

### Task 2: 实现快捷键"E"标记功能

**文件**: `ui/src/plugins/org.openperfetto/index.ts`

在 `onActivate()` 中，紧跟 Ctrl+F 快捷键之后，添加全局 keydown 监听 "E" 键：

```typescript
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // 跳过输入框中的按键
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
  
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    handleMarkerShortcut();
  }
});
```

`handleMarkerShortcut()` 逻辑：
1. 检查 `currentTraceCtx` 是否存在
2. 获取当前选中状态 `trace.selection.selection`
3. **已选中 slice（kind === 'track_event'）**：用 SQL 查询该 slice 的 ts、dur、name、进程名、线程名，创建标记并添加 Perfetto Note
4. **未选中**：使用 `trace.timeline.hoverCursorTimestamp` 获取鼠标悬停时间戳，创建无slice关联的位置标记
5. 标记创建后自动写入 Store 的 `markers[]`，设置 `isAI: false`
6. 如果侧边栏关闭则自动打开，并展开标记模块

SQL查询进程/线程信息（用于选中slice场景）：
```sql
SELECT
  s.id, s.ts, s.dur, s.name AS slice_name,
  t.name AS thread_name, t.utid,
  p.name AS process_name, p.upid
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
LEFT JOIN process p ON t.upid = p.upid
WHERE s.id = <sliceId>
```

---

### Task 3: 完善侧边栏标记列表渲染

**文件**: `ui/src/plugins/org.openperfetto/sidebar/markers_jump.ts`

改造 `renderMarkerItem()` 方法，按需求格式渲染每个标记项：

**改造后的列表项结构**：
```
[#序号] [AI图标?]  进程名 / 线程名
                    Tag(sliceName) · 时间戳
                    备注内容（可编辑）
                                      [编辑] [删除]
```

具体改动：
1. **序号区域**：圆形UI包裹的序号（现有 `#index` 改为圆形样式），AI标记在序号后显示 `smart_toy` 图标
2. **信息区**：第一行显示 `processName / threadName`；第二行显示 `sliceName`（Tag）+ 时间戳；第三行显示备注
3. **空状态提示**：改为显示 "选中Slice后按E键添加标记，或由AI自动标记"
4. **同步逻辑**：`extractSessionMarkers()` 解析时增加 `isAI: true` 标记

**AI 标记从 mark_position 同步时的处理**：
- `extractSessionMarkers()` 中创建标记时设 `isAI: true`，对于 processName/threadName/sliceName 可从 tool result data 取值，若无则标注"AI分析标记"

---

### Task 4: 增强 mark_position Tool 返回数据

**文件**: `ui/src/plugins/org.openperfetto/tools/mark_position.ts`

当通过 sliceId 创建标记时，SQL查询同时获取进程/线程信息，并在返回结果中包含：

```typescript
return {
  success: true,
  data: {
    markerId,
    timestamp: timestamp.toString(),
    duration: duration?.toString() ?? '0',
    sliceId: args.sliceId,
    note: noteText,
    color,
    processName,   // 新增
    threadName,     // 新增
    sliceName,      // 新增
  },
  ...
};
```

修改查询SQL：
```sql
SELECT s.ts, s.dur, s.name AS slice_name,
       t.name AS thread_name, p.name AS process_name
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
LEFT JOIN process p ON t.upid = p.upid
WHERE s.id = <sliceId>
```

---

## 需要同步更新的文件清单

| 文件 | 改动内容 |
|-----|---------|
| `types/plugin_state.ts` | AIMarker 接口扩展、migrateState 版本升级 |
| `index.ts` | 添加键盘监听"E"、handleMarkerShortcut 函数 |
| `sidebar/markers_jump.ts` | renderMarkerItem 重构、空状态改文案、extractSessionMarkers 增加 isAI |
| `tools/mark_position.ts` | SQL 查询扩展、返回值增加进程/线程/Tag |
| `styles/openperfetto.scss` | 圆形序号样式、AI badge 样式 |
| `i18n/zh.ts` | 添加 markers.hint 等新文案 |
| `i18n/en.ts` | 对应英文文案 |

---

## 暂不实现（后续迭代）

- **时间轴Canvas上的圆形序号可视化**：涉及 `notes_panel.ts` 的Canvas绘制改造，复杂度高，建议独立Task
- **标记localStorage持久化**：当前Store已支持状态恢复，后续可增加
- **Undo/Redo**：低优先级

---

## 风险与注意事项

1. **键盘事件冲突**：E键监听需排除所有输入控件（input、textarea、contenteditable），避免与输入冲突
2. **Selection API兼容**：`trace.selection.selection` 获取选中的 slice 时，需处理 `kind === 'track_event'` 的情况，其他 kind 需降级到鼠标位置
3. **BigInt序列化**：mark_position 返回的 duration 为 string 格式，extractSessionMarkers 解析时需用 `BigInt()` 转换
4. **状态迁移安全**：新增字段的 migration 需要保证旧版本数据兼容，所有新字段都提供默认值
5. **SQL查询安全**：sliceId参数化处理，避免注入风险（当前使用字符串拼接，需确认输入已校验）