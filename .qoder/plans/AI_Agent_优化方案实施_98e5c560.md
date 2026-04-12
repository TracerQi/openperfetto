# AI Agent 优化方案实施计划

## 前置发现：现有代码已有部分实现

研究员调查发现现有代码已具备以下能力，spec 和实施必须在此基础上**增强**而非重写：

| 方案 | 现有实现 | 需要增强的点 |
|-----|---------|------------|
| 方案二 | ArtifactStore 有 LRU、采样、压缩 | **缺少** status/version/lifecycle 状态管理 |
| 方案三 | 60秒窗口 + 差异化阈值去重 | **缺少** 结果复用（当前只是阻止，不返回已有 artifact） |
| 方案四 | L1(23规则)+L2(计划遵从)+L3(预留) | **缺少** 结构化修正指引和自动修正 |
| 方案五 | Zod Schema + SqlSanitizer | **缺少** 模板预编译验证、matchMode 支持 |
| 方案六 | 后端背压检测 + 前端防抖 + 流代管理 | **缺少** 背压缓冲队列（当前直接丢弃） |
| 方案七 | 动态预算分配、历史裁剪 | **缺少** Artifact 状态和工具历史注入 |

## 文件修改隔离分析

| 方案 | 修改的文件 | 冲突风险 |
|-----|----------|---------|
| 方案二 | `types/artifact.ts`, `agent/artifact_store.ts` | 无 |
| 方案三 | `agent/agent_loop.ts`, 新建 `agent/tool_call_interceptor.ts` | 与方案四共享 agent_loop.ts |
| 方案四 | `agent/verifier.ts`, 新建 `agent/auto_fixer.ts` | 与方案三共享 agent_loop.ts |
| 方案五 | `server/.../skill_processor.ts`, `server/.../yaml_parser.ts`, `server/.../sql_sanitizer.ts` | 无（后端独立） |
| 方案六 | `server/.../websocket.ts`, `services/llm_stream_handler.ts` | 无 |
| 方案七 | `agent/context_manager.ts` | 依赖方案二/三的新接口 |

## 依赖关系

```
方案二 (Artifact lifecycle) ──┬──> 方案三 (Tool dedup) ──> 方案七 (Context)
                              └──> 方案四 (Validation)  ──/
方案五 (SQL template) ────────> 独立
方案六 (Streaming) ───────────> 独立
```

---

## Task 0: 更新分析文档（标记方案一不可行）

修改 `docs/analysis/ai-agent-optimization-analysis.md`：
- 在 6.1 方案一标题后添加 **[不可行 - 与架构约束冲突]** 标注
- 添加说明：当前架构在前端执行 trace 解析和 SQL 查询，将 SQL 执行移至后端违反架构设计

---

## Task 1: 生成6份 Spec 文档

在 `docs/analysis/specs/` 目录下生成以下 spec 文件：

### SPEC-02: Artifact 生命周期管理
- 文件: `docs/analysis/specs/spec-02-artifact-lifecycle.md`
- 修改文件:
  - `ui/src/plugins/org.openperfetto/types/artifact.ts` — 扩展 Artifact 接口（添加 status, version, sourceParams, validationResult 等字段）
  - `ui/src/plugins/org.openperfetto/agent/artifact_store.ts` — 添加 createPending(), markValid(), markFailed(), markInvalidated(), getValidArtifactSummaries(), getStatusReport() 方法
- 约束: 现有 store()/get()/getAll()/fetchPage()/compress()/formatForLLM() 签名和行为不变
- 验收: 新建 artifact 经历 PENDING->VALID 流转；重复 skillId+params 自动 invalidate 旧版本

### SPEC-03: 工具调用去重增强
- 文件: `docs/analysis/specs/spec-03-tool-dedup-enhance.md`
- 修改文件:
  - `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` — 在 executeToolCall() 中增加 artifact 有效性检查和结果复用逻辑
  - 新建 `ui/src/plugins/org.openperfetto/agent/tool_call_interceptor.ts` — ToolCallInterceptor 类（EXECUTE/REUSE/BLOCK）
- 约束: 保留现有 60秒窗口和差异化阈值逻辑，在其基础上增加复用能力
- 验收: 相同 skillId+params 的第二次调用直接返回已有 artifactRef 而非重新执行

### SPEC-04: 验证-修正结构化闭环
- 文件: `docs/analysis/specs/spec-04-validation-fix-loop.md`
- 修改文件:
  - `ui/src/plugins/org.openperfetto/agent/verifier.ts` — L1 规则返回结构化 ValidationFailure（含 fixGuidance）
  - 新建 `ui/src/plugins/org.openperfetto/agent/auto_fixer.ts` — AutoFixer 类
  - `ui/src/plugins/org.openperfetto/types/agent.ts` — 添加 ValidationFailure, FixAction 等类型
- 约束: 现有 L1Rule.check() 签名兼容（通过重载或新方法），L2/L3 不修改
- 验收: timestamp_monotonic 规则在 ORDER BY dur DESC 时自动跳过而非报错

### SPEC-05: SQL 模板质量强化
- 文件: `docs/analysis/specs/spec-05-sql-template-quality.md`
- 修改文件:
  - `server/src/services/yaml_parser.ts` — SkillParamSchema 添加 matchMode, columnRef 字段
  - `server/src/services/skill_processor.ts` — 添加模板预编译验证逻辑（在 Skill 注册时运行）
  - `server/src/utils/sql_sanitizer.ts` — 增强参数替换支持 matchMode (exact/contains/prefix/glob)
  - 修改受影响的 YAML Skill 文件（如 process_overview.yaml, memory_trend_analysis.yaml）
- 约束: 新增字段为 optional，现有 YAML 无需修改即可继续工作
- 验收: Skill 加载时检测到 LIKE 过度泛化发出 warning；使用 matchMode=exact 时生成精确匹配 SQL

### SPEC-06: 流式输出可靠性增强
- 文件: `docs/analysis/specs/spec-06-stream-reliability.md`
- 修改文件:
  - `server/src/routes/websocket.ts` — sendMessage() 从丢弃改为缓冲队列 + 优先级淘汰
  - `ui/src/plugins/org.openperfetto/services/llm_stream_handler.ts` — 添加 5 个强制刷新时机（工具调用前后、状态转换、LLM完成、缓冲阈值）
- 约束: 保持现有 MessagePriority 体系和背压检测逻辑
- 验收: 背压时低优先级消息进入队列而非丢弃；工具调用前后文本缓冲区被强制刷新

### SPEC-07: LLM 上下文增强
- 文件: `docs/analysis/specs/spec-07-context-enhancement.md`
- 修改文件:
  - `ui/src/plugins/org.openperfetto/agent/context_manager.ts` — buildContext() 新增注入 artifactStore.getStatusReport() 和 toolCallHistory.getSummary()
  - 新建 `ui/src/plugins/org.openperfetto/agent/analysis_progress.ts` — AnalysisProgress 类
- 约束: 新注入内容从 history 预算中划拨（约 5-8%），不增加总 Token 预算
- 验收: LLM 系统提示中包含"已获取的分析数据"和"已调用的分析工具"两节

---

## Task 2-4: 第一轮实施（独立模块，可并行）

### Task 2: 实施 SPEC-02（Artifact 生命周期）
- 范围: `types/artifact.ts` + `agent/artifact_store.ts`
- 前端独立修改，无后端依赖

### Task 3: 实施 SPEC-05（SQL 模板质量）
- 范围: `server/` 下的 yaml_parser.ts, skill_processor.ts, sql_sanitizer.ts + YAML 文件
- 后端独立修改，无前端依赖

### Task 4: 实施 SPEC-06（流式输出可靠性）
- 范围: `server/.../websocket.ts` + `services/llm_stream_handler.ts`
- 前后端各自独立的修改点，互不影响

## Task 5-6: 第二轮实施（依赖第一轮）

### Task 5: 实施 SPEC-03（工具调用去重增强）
- 依赖: SPEC-02 完成（需要 ArtifactStore 新接口）
- 范围: `agent/agent_loop.ts` + 新建 `agent/tool_call_interceptor.ts`

### Task 6: 实施 SPEC-04（验证-修正闭环）
- 依赖: SPEC-02 完成（需要 Artifact status 概念）
- 范围: `agent/verifier.ts` + 新建 `agent/auto_fixer.ts` + `types/agent.ts`
- 注意: 与 Task 5 都触及 agent_loop.ts，需串行执行

## Task 7: 第三轮实施

### Task 7: 实施 SPEC-07（LLM 上下文增强）
- 依赖: SPEC-02 + SPEC-03 完成
- 范围: `agent/context_manager.ts` + 新建 `agent/analysis_progress.ts`

## Task 8: 验证与代码审查

- 对所有修改执行 TypeScript 编译检查
- 代码审查确认无引入新问题
- 验证现有功能未被破坏
