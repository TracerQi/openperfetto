# 新侧边栏 Cursor 风格 UI 优化

## 设计方向总结

将当前的 Material Design 蓝色冷调风格，改为 DESIGN.md 定义的 **暖色极简** 风格：
- 暖奶油色背景 (`#f2f1ed`) 替代纯白
- 暖近黑文字 (`#26251e`) 替代纯黑/灰
- 橙色强调 (`#f54e00`) 替代蓝色主色
- 暖棕边框 `rgba(38, 37, 30, 0.1)` 替代灰色分隔线
- 8px 圆角系统，药丸按钮 `9999px`
- 暖色悬停状态 (`#cf2d56` 暖红)
- 大模糊扩散阴影替代硬边阴影

## 修改范围

**仅修改文件**: `ui/src/plugins/org.openperfetto/styles/openperfetto.scss`（2213行）
**不修改**: 原始侧边栏样式(sidebar.scss)、主布局(ui_main.scss)、trace显示区域、任何TS功能逻辑

## Task 1: 新增 CSS 自定义属性块

在 SCSS 变量区域后，为 `.openperfetto-page` 添加作用域 CSS 变量，隔离新侧边栏配色：

```scss
.openperfetto-page {
  // Cursor-inspired warm color palette
  --op-bg: #f2f1ed;
  --op-bg-secondary: #ebeae5;
  --op-bg-tertiary: #e6e5e0;
  --op-bg-hover: #e1e0db;
  --op-surface-100: #f7f7f4;
  --op-text: #26251e;
  --op-text-secondary: rgba(38, 37, 30, 0.55);
  --op-text-muted: rgba(38, 37, 30, 0.4);
  --op-accent: #f54e00;
  --op-accent-hover: #cf2d56;
  --op-border: rgba(38, 37, 30, 0.1);
  --op-border-medium: rgba(38, 37, 30, 0.2);
  --op-success: #1f8a65;
  --op-error: #cf2d56;
  --op-warning: #c08532;
  --op-radius: 8px;
  --op-radius-sm: 4px;
  --op-radius-pill: 9999px;
  --op-font-ui: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --op-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --op-shadow-ambient: rgba(0,0,0,0.02) 0px 0px 16px, rgba(0,0,0,0.008) 0px 0px 8px;
  --op-shadow-elevated: rgba(0,0,0,0.14) 0px 28px 70px, rgba(0,0,0,0.1) 0px 14px 32px;
}
```

同时更新 SCSS 变量: `$border-radius: 8px`，调整间距变量匹配8px基础系统。

暗色主题变量在 `--dark` 修饰符中覆盖（保持暖色调偏移）。

## Task 2: 主页面布局 + TopBar 样式重构

**`.openperfetto-page`**: 背景改为 `var(--op-bg)`，字体改为 `var(--op-font-ui)`
**`.openperfetto-topbar`**: 从蓝色实底改为暖奶油色 + 底部边框

```scss
.openperfetto-topbar {
  background-color: var(--op-bg);
  color: var(--op-text);
  border-bottom: 1px solid var(--op-border);
  // 保持 48px 高度和 flex 布局不变
}
.openperfetto-topbar__logo {
  color: var(--op-accent); // 橙色 logo
}
```

**`.openperfetto-page__footer`**: 背景改为 `var(--op-surface-100)`，边框暖色化
**`.openperfetto-page__content`**: 背景改为 `var(--op-bg)`

## Task 3: 模块(Module)折叠面板样式重构

```scss
.openperfetto-module {
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background-color: var(--op-bg);
}
.openperfetto-module__header {
  background-color: var(--op-surface-100);
  // hover -> var(--op-bg-secondary)
}
.openperfetto-module__icon {
  color: var(--op-accent); // 橙色图标替代蓝色
}
.openperfetto-module__toggle {
  color: var(--op-text-secondary);
}
```

## Task 4: AI Chat 组件样式重构

这是最大的样式块（约700行），需要全面暖色化：

- **消息背景**: 用户消息用 `var(--op-bg-secondary)` + 暖文字（非蓝底白字），助手消息用 `var(--op-surface-100)`
- **输入框**: 背景 `var(--op-surface-100)`，边框 `var(--op-border)`，聚焦 `var(--op-border-medium)`，8px 圆角
- **发送按钮**: 背景 `var(--op-bg-secondary)`，图标 `var(--op-text)`，hover 文字变 `var(--op-accent-hover)`
- **状态指示器**: idle 灰 -> 处理中 `var(--op-accent)` -> 完成 `var(--op-success)` -> 错误 `var(--op-error)`
- **工具调用卡片**: 左边框 `var(--op-accent)` 替代蓝色，暖色背景
- **取消/新对话按钮**: 暖色边框和悬停
- **欢迎页面**: 暖色文字，示例悬停 -> 橙色
- **代码块**: `var(--op-font-mono)` 字体，暖灰背景
- **加载 spinner**: accent 颜色替代蓝色

## Task 5: SearchPin 组件样式重构

- **搜索输入框**: 暖色背景/边框，8px 圆角
- **搜索结果列表**: 暖色边框和背景
- **预设场景 chip**: 药丸形 (`9999px`)，背景 `var(--op-bg-tertiary)`，hover 文字变暖红
- **历史记录下拉**: 暖色背景阴影
- **匹配导航**: 暖色 surface
- **通知提示**: 使用 `var(--op-warning)` 替代硬编码橙色

## Task 6: MarkersJump 组件样式重构

- **标记卡片**: 8px 圆角，暖色边框，hover 边框 -> `var(--op-accent)`
- **严重度指示器**: info=accent, warning=gold, error=crimson
- **AI badge**: accent 橙色替代蓝色
- **时间戳/持续时间**: `var(--op-font-mono)` 字体

## Task 7: Settings 面板样式重构

- **Overlay 遮罩**: 保持半透明黑
- **面板容器**: 8px 圆角，暖色阴影 `var(--op-shadow-elevated)`
- **Tab 导航**: 底部边框暖色，active tab -> `var(--op-accent)` 替代蓝色
- **选项按钮**: 暖色边框，selected -> accent 橙色
- **About 页面 logo**: accent 橙色背景

## Task 8: 侧边栏容器 + 拖拽手柄 + Toggle 按钮

- **`.openperfetto-sidebar`**: 背景 `var(--op-bg, #f2f1ed)`，右边框暖色
- **拖拽手柄**: hover 颜色 `var(--op-accent)` 替代蓝色
- **Toggle 按钮**: hover 背景暖色化
- **无 trace 占位**: 暖色文字和图标

## Task 9: 暗色主题适配

在 `.openperfetto-page--dark` 中覆盖 CSS 变量为暖色暗色值：

```scss
&--dark {
  --op-bg: #1e1c18;
  --op-bg-secondary: #2a2820;
  --op-bg-tertiary: #353228;
  --op-text: #e8e6e0;
  --op-text-secondary: rgba(232, 230, 224, 0.55);
  --op-border: rgba(232, 230, 224, 0.12);
  // ... 其余暗色变量
}
```

所有组件的 `.openperfetto-page--dark &` 规则同步更新为引用新的 CSS 变量。

## Task 10: 验证与微调

- 执行前端快速编译，确认无 SCSS 编译错误
- 检查窗口 resize 时侧边栏宽度计算不受影响（纯样式更改，不涉及 JS 宽度逻辑）
- 确认原始侧边栏和 trace 显示区样式未受影响（全部改动都在 openperfetto 命名空间内）

## 实施策略

由于 openperfetto.scss 有 2213 行，修改量大，采用**分区域替换**策略：
1. 先修改文件头部 SCSS 变量 + 页面布局 + CSS 变量块
2. 再依次修改 TopBar -> Module -> AIChat -> SearchPin -> Markers -> Settings -> Sidebar 容器
3. 最后修改暗色主题覆盖规则
4. 每个区域使用 search_replace 精确替换，避免全文覆盖
