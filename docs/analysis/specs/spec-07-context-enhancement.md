# SPEC-07: LLM 上下文增强

## 1. 概述

当前 `ContextManager.buildContext()` 构建的系统提示包含 5 个部分（核心角色提示、场景策略、Trace 元数据、核心表 Schema、Skill 标记），但缺少对已获取分析数据（Artifact 状态）和已执行工具调用历史的感知。

本 Spec 在 `ContextManager` 的系统提示中注入 **Artifact 状态报告**和**工具调用历史摘要**，让 LLM 具备完整的分析状态感知能力，从而减少重复查询、提升分析连贯性。

## 2. 修改文件清单

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `ui/src/plugins/org.openperfetto/agent/context_manager.ts` | 修改 | `buildContext` 签名变更，新增 Part 6/7，调整 Token 预算 |
| `ui/src/plugins/org.openperfetto/agent/analysis_progress.ts` | 新建 | `AnalysisProgress` 类，分析进度追踪 |
| `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` | 修改 | 集成新参数传入 `buildContext` |

## 3. context_manager.ts 修改

### 3.1 buildContext 签名变更

新增两个可选参数：

```typescript
async buildContext(
  sceneType: SceneType,
  artifactStatusReport?: string,    // 新增：来自 artifactStore.getStatusReport()（SPEC-02）
  toolCallHistorySummary?: string   // 新增：工具调用历史摘要
): Promise<void>
```

- 两个参数均为 `optional`，不传时行为与现有完全一致。
- 参数为已格式化的文本字符串，`ContextManager` 不依赖 `ArtifactStore` 或 `ToolCallHistory` 的具体类型。

### 3.2 buildContext() 新增两个上下文部分

在现有 5 部分之后追加：

```typescript
async buildContext(
  sceneType: SceneType,
  artifactStatusReport?: string,
  toolCallHistorySummary?: string
): Promise<void> {
  const parts: string[] = [];

  // Part 1-5: 现有部分（不变）
  parts.push(getCoreRolePrompt());
  parts.push(getSceneStrategyPrompt(sceneType));
  parts.push(getTraceMetadataPrompt());
  parts.push(getCoreTableSchemaPrompt());
  parts.push(getSkillMarkersForScene(sceneType));

  // Part 6: Artifact 状态报告（新增）
  if (artifactStatusReport) {
    const truncated = this.truncateToTokenBudget(
      artifactStatusReport,
      this.getArtifactStatusBudget(sceneType)
    );
    parts.push(this.formatArtifactStatusSection(truncated));
  }

  // Part 7: 工具调用历史摘要（新增）
  if (toolCallHistorySummary) {
    const truncated = this.truncateToTokenBudget(
      toolCallHistorySummary,
      this.getToolCallHistoryBudget(sceneType)
    );
    parts.push(this.formatToolCallHistorySection(truncated));
  }

  this.systemPrompt = parts.join('\n\n---\n\n');
}
```

### 3.3 新增格式化方法

```typescript
private formatArtifactStatusSection(content: string): string {
  return [
    '## 已获取的分析数据',
    '',
    '以下是当前分析会话中已获取的数据摘要，请基于这些已有数据继续分析，避免重复查询：',
    '',
    content,
  ].join('\n');
}

private formatToolCallHistorySection(content: string): string {
  return [
    '## 已调用的分析工具',
    '',
    '以下是本次分析中已执行的工具调用摘要，请参考执行结果规划后续步骤：',
    '',
    content,
  ].join('\n');
}
```

### 3.4 Token 预算调整

从 `history` 预算中划拨 6% 给新增内容，修改 `SCENE_BUDGETS`：

```typescript
private static readonly SCENE_BUDGETS: Record<SceneType, SceneBudgetConfig> = {
  anr: {
    total: 16384,
    allocation: {
      systemPrompt: 0.10,       // 不变
      sceneStrategy: 0.08,      // 不变
      traceMetadata: 0.12,      // 不变
      artifactStatus: 0.03,     // 新增：约 491 tokens
      toolCallHistory: 0.03,    // 新增：约 491 tokens
      history: 0.64,            // 从 0.70 降为 0.64
    },
  },
  // 其他场景类型同理调整
};
```

各场景 Token 预算示例（以 total=16384 为例）：

| 部分 | 占比 | Tokens |
|------|------|--------|
| systemPrompt | 10% | ~1638 |
| sceneStrategy | 8% | ~1311 |
| traceMetadata | 12% | ~1966 |
| **artifactStatus** | **3%** | **~491** |
| **toolCallHistory** | **3%** | **~491** |
| history | **64%** | **~10486** |

### 3.5 新增预算获取方法

```typescript
private getArtifactStatusBudget(sceneType: SceneType): number {
  const config = ContextManager.SCENE_BUDGETS[sceneType];
  return Math.floor(config.total * (config.allocation.artifactStatus ?? 0));
}

private getToolCallHistoryBudget(sceneType: SceneType): number {
  const config = ContextManager.SCENE_BUDGETS[sceneType];
  return Math.floor(config.total * (config.allocation.toolCallHistory ?? 0));
}
```

### 3.6 truncateToTokenBudget 方法

```typescript
/**
 * 将文本截断到指定 Token 预算内。
 * 优先保留最新内容（从末尾截断）。
 */
private truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = this.estimateTokens(text);
  if (estimated <= maxTokens) return text;

  // 按行截断，保留尾部（最新内容）
  const lines = text.split('\n');
  let result = '';
  let tokens = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = this.estimateTokens(lines[i]);
    if (tokens + lineTokens > maxTokens) break;
    result = lines[i] + (result ? '\n' + result : '');
    tokens += lineTokens;
  }

  return result || text.slice(-maxTokens * 2); // fallback
}
```

## 4. 新建 AnalysisProgress 类

**文件**: `ui/src/plugins/org.openperfetto/agent/analysis_progress.ts`

```typescript
export interface AnalysisPhase {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  artifactId?: string;  // 关联的 Artifact ID
  startTime?: number;
  endTime?: number;
}

export class AnalysisProgress {
  private phases: Map<string, AnalysisPhase> = new Map();

  /**
   * 从分析计划中提取阶段。
   * 每个计划步骤映射为一个 AnalysisPhase。
   */
  registerPhases(plan: AnalysisPlan): void {
    for (const step of plan.steps) {
      this.phases.set(step.id, {
        id: step.id,
        name: step.description,
        status: 'pending',
      });
    }
  }

  /**
   * 更新指定阶段的状态。
   */
  updatePhase(
    phaseId: string,
    status: AnalysisPhase['status'],
    artifactId?: string
  ): void {
    const phase = this.phases.get(phaseId);
    if (!phase) return;

    phase.status = status;
    if (artifactId) phase.artifactId = artifactId;
    if (status === 'in_progress' && !phase.startTime) {
      phase.startTime = Date.now();
    }
    if (status === 'completed' || status === 'failed') {
      phase.endTime = Date.now();
    }
  }

  /**
   * 生成进度报告文本。
   * 输出控制在 200 tokens 以内。
   */
  getProgressReport(): string {
    const lines: string[] = [];
    const total = this.phases.size;
    const completed = [...this.phases.values()].filter(p => p.status === 'completed').length;

    lines.push(`分析进度: ${completed}/${total} 阶段已完成`);
    lines.push('');

    for (const phase of this.phases.values()) {
      const icon = {
        pending: '○',
        in_progress: '●',
        completed: '✓',
        failed: '✗',
      }[phase.status];

      let line = `${icon} ${phase.name}`;
      if (phase.artifactId) {
        line += ` → artifact:${phase.artifactId}`;
      }
      lines.push(line);
    }

    return lines.join('\n');
  }
}
```

### 设计说明：
- `getProgressReport()` 使用紧凑格式，单行一个阶段，确保在 ~200 tokens 以内。
- 状态图标（○/●/✓/✗）提供一目了然的视觉区分。
- `artifactId` 关联让 LLM 可以引用已有数据。

## 5. agent_loop.ts 集成

在调用 `buildContext` 时传入新参数：

```typescript
// 在 agent_loop.ts 的上下文构建阶段
private async prepareContext(sceneType: SceneType): Promise<void> {
  // 获取 Artifact 状态报告（来自 SPEC-02 的 ArtifactStore）
  const statusReport = this.artifactStore?.getStatusReport() ?? undefined;

  // 获取工具调用历史摘要
  const historySummary = this.getToolCallHistorySummary() ?? undefined;

  // 传入新参数
  await this.contextManager.buildContext(
    sceneType,
    statusReport,
    historySummary
  );
}
```

### getToolCallHistorySummary 实现

```typescript
private getToolCallHistorySummary(): string | undefined {
  const recentCalls = this.toolCallHistory.slice(-10); // 最近 10 次调用
  if (recentCalls.length === 0) return undefined;

  return recentCalls.map(call => {
    const status = call.success ? '✓' : '✗';
    const duration = call.endTime
      ? `${((call.endTime - call.startTime) / 1000).toFixed(1)}s`
      : 'running';
    return `${status} ${call.skillId}(${call.briefParams}) [${duration}]`;
  }).join('\n');
}
```

## 6. 约束

- **不增加总 Token 预算**：新增内容的 Token 从 `history` 分配中划拨（70% → 64%）
- **`buildContext` 新参数为 optional**：不传时行为与现有完全一致，不影响任何现有调用方
- **`getProgressReport()` 输出控制在 200 tokens 以内**：使用紧凑格式，避免冗长
- **不引入新的外部依赖**：`ContextManager` 仅接收字符串参数，不依赖 `ArtifactStore` 类型
- **`SceneBudgetConfig` 类型需兼容新增字段**：`artifactStatus` 和 `toolCallHistory` 为 optional 字段

## 7. 验收标准

| ID | 标准 | 验证方式 |
|----|------|---------|
| SPEC-07-AC01 | LLM 系统提示中包含"已获取的分析数据"区块（`## 已获取的分析数据`） | 单元测试：传入 `artifactStatusReport` 后检查 `systemPrompt` 包含该标题 |
| SPEC-07-AC02 | LLM 系统提示中包含"已调用的分析工具"区块（`## 已调用的分析工具`） | 单元测试：传入 `toolCallHistorySummary` 后检查 `systemPrompt` 包含该标题 |
| SPEC-07-AC03 | 不传新参数时 `buildContext` 行为不变（系统提示仅含原 5 部分） | 回归测试：对比不传参前后的 `systemPrompt` 内容一致 |
| SPEC-07-AC04 | 历史消息预算从 70% 降为 64%（`SCENE_BUDGETS` 中 `history` 字段） | 单元测试：检查 `SCENE_BUDGETS.anr.allocation.history === 0.64` |
| SPEC-07-AC05 | `AnalysisProgress.getProgressReport()` 输出不超过 200 tokens | 单元测试：使用 `estimateTokens` 验证输出长度 |
| SPEC-07-AC06 | 新增内容超出预算时被正确截断 | 单元测试：传入超长文本，验证不超过 `artifactStatus` 预算 |
