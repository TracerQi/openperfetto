# Harness 优化方案实施计划

## 用户决策确认

1. **不执行**: 后端包名查询服务、后端去重层
2. **方案2重新定义**: 从"语义级工具去重"改为"提示词优化防止重复调用"，现有去重机制仅作为保底安全网
3. **代码修改后不编译**，等待用户确认后才进行编译验证

## 关于方案2的补充分析

> 用户问：查询 "settings" 和 "com.android.settings" 获得的查询是一样的吗？

**回答**：不完全一样。SQL 模板使用 `WHERE p.name LIKE '%${package_name}%'`：
- `"settings"` → `LIKE '%settings%'` — 匹配所有包含 "settings" 的进程（可能匹配到多个进程）
- `"com.android.settings"` → `LIKE '%com.android.settings%'` — 仅精确匹配 Settings 应用

实际效果中，对于启动分析场景，两者返回的有效数据**基本一致**（因为 Settings 启动时通常只有一个主进程），但 "settings" 可能捕获到更多无关进程的噪声数据。根因是 **System Prompt 未指导 LLM 使用完整包名**，也未在 Skill 参数描述中标注包名格式要求。

---

## 任务分组（按文件隔离原则避免冲突）

### Task A — 方案1 + 方案6：Schema 注入与工具调用工作流编排
**涉及文件**（独占）：
- `ui/src/plugins/org.openperfetto/agent/context_manager.ts` — 注入 Schema 摘要 + 工作流指导
- `server/src/services/skill_processor.ts` — 改进 `formatSkillForPrompt()` 的 SQL 截断逻辑
- `server/skills/library/startup/*.yaml` — 增加 `prerequisites` 字段
- 新增 `server/config/perfetto_schema_summary.ts` — 核心表 Schema 定义

**改动要点**：
1. **取消 500 字符硬截断**（`skill_processor.ts` L365-369）：改为智能截断，保留完整的 SELECT/JOIN 关系
2. **在 System Prompt 注入 Perfetto 核心表 Schema 摘要**（`context_manager.ts` L243 区域）：包含 `slice/thread/thread_track/process` 表的列名、类型和 JOIN 关系
3. **System Prompt 增加工具调用工作流指导**：明确 "先 lookup_sql_schema 确认表结构 → 再 execute_sql" 的顺序
4. **YAML 增加 `prerequisites` 字段**：表示 Skill 间依赖（如 startup_blocking_calls depends_on app_startup_breakdown）
5. **`formatSkillForPrompt()` 增加 prerequisites 输出**

### Task B — 方案2（修订版）：提示词优化防止重复调用
**涉及文件**（独占）：
- `ui/src/plugins/org.openperfetto/agent/planning_gate.ts` — 增强计划阶段中的工具约束提示

**改动要点**（纯提示词优化，不改去重机制）：
1. **在 `context_manager.ts` 的 `getCoreRolePrompt()` 中**：增加"工具调用黄金规则"段落 — 但这个文件在 Task A 中，所以 Task B 需要在 Task A 之后
2. 实际上，因为 `context_manager.ts` 已被 Task A 占用，Task B 的提示词优化需要通过 `planning_gate.ts` 注入：
   - 在计划验证通过后注入的 softWarnings 中增加包名规范指导
   - 增加"参数使用规范"提示：对 `package_name` 类参数，明确要求使用完整 Android 包名（如 `com.android.settings`）
3. **Skill YAML 参数描述增强**：在 `app_startup_breakdown.yaml` 等的 `parameters.package_name.description` 中补充"请使用完整包名格式，如 com.android.settings"

等等，YAML 文件也在 Task A 中。让我重新分组。

**重新分组决策**：Task A 和 Task B 涉及共同文件（`context_manager.ts`、YAML），应合并为一个任务或串行执行。合并为 **Task A+B**。

### Task C — 方案3：修复流式输出竞争条件
**涉及文件**（独占）：
- `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` — 仅修改 L674 区域的 `LLM_TOOL_USE` 分支
- `ui/src/plugins/org.openperfetto/services/llm_stream_handler.ts` — 评估双重防抖

**改动要点**：
1. **在 `handleAwaitingLLMState` 的 `LLM_TOOL_USE` 分支**（`agent_loop.ts` L674）：对所有非 `submit_plan` 的工具调用，在 `executeToolCall()` 前增加 `this.flushStreamBuffer()`
2. **在 `handleExecutingToolState` 注入验证系统消息前**（`agent_loop.ts` L869-881）：增加 `this.flushStreamBuffer()`
3. **评估是否合并双重防抖**：如果 `LLMStreamHandler` 的 100ms 防抖与 `AgentLoop` 的 100ms 防抖功能重叠，考虑移除一层

### Task D — 方案4 + 方案5：验证规则增强与 Artifact 数据访问改进
**涉及文件**（独占）：
- `ui/src/plugins/org.openperfetto/agent/verifier.ts` — 新增 L1 验证规则
- `ui/src/plugins/org.openperfetto/agent/artifact_store.ts` — 改进采样策略

**改动要点**：
1. **提高采样保留阈值**（`artifact_store.ts` L248）：从 20 行提高到 50 行
2. **增加采样分位数覆盖**：增加 P10, P40, P60 分位点
3. **摘要中标注采样信息**：明确告知"此为采样摘要，完整数据共 N 行"
4. **新增 L1 规则 `artifact_conclusion_consistency`**：交叉验证 AI 结论中的百分比与 Artifact 原始数据
5. **新增 L1 规则 `unit_consistency`**：检查时间单位一致性（防止 ns/ms/s 混用）
6. **新增 L1 规则 `aggregation_completeness`**：检查"占 X%"声明是否基于完整数据集

---

## 执行顺序与依赖

```
Task A+B (Schema + 提示词优化)  ─┐
                                  │
Task C (流式竞争条件修复)        ─┼─→ 等待用户确认 → 编译验证
                                  │
Task D (验证 + Artifact)         ─┘
```

三个任务**互不冲突**，可并行执行：
- Task A+B：`context_manager.ts` / `skill_processor.ts` / `planning_gate.ts` / YAML
- Task C：`agent_loop.ts`（L674 区域）/ `llm_stream_handler.ts`
- Task D：`verifier.ts` / `artifact_store.ts`

## 每个任务的 Spec 文档输出路径

- Task A+B Spec: `D:\1aLq\ProFile\other\03-llm-debug\specs\spec-schema-prompt-workflow.md`
- Task C Spec: `D:\1aLq\ProFile\other\03-llm-debug\specs\spec-streaming-fix.md`
- Task D Spec: `D:\1aLq\ProFile\other\03-llm-debug\specs\spec-verification-artifact.md`

## 实施步骤

1. **Task 1-3**: 三个 Coding Agent 并行编写 Spec 文档（不写代码）
2. **用户审阅 Spec** → 确认或调整
3. **Task 4-6**: 三个 Coding Agent 并行实施代码修改（不编译）
4. **用户确认** → 编译验证
