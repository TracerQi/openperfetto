# SPEC-03: 工具调用去重增强

## 1. 概述

在现有 `AgentLoop` 的 60 秒窗口 + 差异化阈值去重机制基础上，增加 **artifact 结果复用** 能力：

- 对 `invoke_skill` 类型的工具调用，检查 `ArtifactStore` 中是否已存在相同 `skillId + params` 的 VALID artifact；
- 若存在，直接复用已有结果（REUSE），避免重复执行；
- 现有的 `recentToolCalls` 去重逻辑保留，作为**二级保护**。

**前置依赖**：SPEC-02（Artifact 生命周期管理）必须先实现。

---

## 2. 修改文件清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `ui/src/plugins/org.openperfetto/agent/tool_call_interceptor.ts` | **新建** | `ToolCallInterceptor` 类和 `InterceptResult` 接口 |
| `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` | 修改 | 在 `executeToolCall()` 中集成拦截器 |
| `ui/src/plugins/org.openperfetto/__tests__/unit/tool_call_interceptor.test.ts` | **新建** | 拦截器单元测试 |

---

## 3. 新建 ToolCallInterceptor 类

**文件**: `ui/src/plugins/org.openperfetto/agent/tool_call_interceptor.ts`

### 3.1 InterceptResult 接口

```typescript
/**
 * 工具调用拦截结果
 */
export interface InterceptResult {
  /** 拦截决策 */
  action: 'EXECUTE' | 'REUSE' | 'BLOCK';

  /** 复用时返回的已有 artifact ID */
  artifactId?: string;

  /** 决策原因（用于日志和调试） */
  reason?: string;
}
```

### 3.2 ToolCallInterceptor 类

```typescript
import {ArtifactStore} from './artifact_store';

/**
 * 工具调用拦截器
 *
 * 在工具实际执行前检查是否可以复用已有 artifact 结果，
 * 仅对 invoke_skill 类型的调用生效。
 */
export class ToolCallInterceptor {
  constructor(private readonly artifactStore: ArtifactStore) {}

  /**
   * 拦截工具调用，决定执行策略
   *
   * @param toolName - 工具名称（如 'invoke_skill', 'execute_sql'）
   * @param args - 工具参数（原始 JSON 对象）
   * @returns InterceptResult 拦截决策
   *
   * 逻辑：
   * 1. 如果 toolName !== 'invoke_skill'，直接返回 EXECUTE（不拦截）
   * 2. 从 args 中提取 skillId 和 params：
   *    - skillId = args.skill_id (string)
   *    - params = args.params (Record<string, unknown>) 或 {}
   * 3. 如果 skillId 为空或不存在，返回 EXECUTE
   * 4. 调用 artifactStore.findBySkillAndParams(skillId, params)
   * 5. 如果找到 VALID artifact：
   *    - 返回 { action: 'REUSE', artifactId: artifact.id, reason: `Reusing existing artifact ${artifact.id} for skill ${skillId}` }
   * 6. 如果未找到：
   *    - 返回 { action: 'EXECUTE', reason: `No valid artifact found for skill ${skillId}` }
   */
  intercept(
    toolName: string,
    args: Record<string, unknown>,
  ): InterceptResult;
}
```

### 3.3 方法签名汇总

| 方法 | 签名 | 描述 |
|------|------|------|
| `constructor` | `constructor(artifactStore: ArtifactStore)` | 注入 ArtifactStore 依赖 |
| `intercept` | `intercept(toolName: string, args: Record<string, unknown>): InterceptResult` | 拦截并返回决策 |

---

## 4. agent_loop.ts 修改

### 4.1 新增成员

```typescript
// 在 AgentLoop 类中新增：
private toolCallInterceptor: ToolCallInterceptor;
```

### 4.2 构造函数修改

```typescript
// 在构造函数中初始化拦截器（artifactStore 为现有成员）：
this.toolCallInterceptor = new ToolCallInterceptor(this.artifactStore);
```

### 4.3 `executeToolCall()` 方法修改

在现有去重检查**之前**，插入拦截器调用：

```typescript
private async executeToolCall(toolCall: ToolCall): Promise<void> {
  // ===== 新增：artifact 复用拦截（一级保护） =====
  const interceptResult = this.toolCallInterceptor.intercept(
    toolCall.name,
    (toolCall.arguments || {}) as Record<string, unknown>,
  );

  if (interceptResult.action === 'REUSE' && interceptResult.artifactId) {
    opLogger.info('Reusing existing artifact', {
      toolName: toolCall.name,
      artifactId: interceptResult.artifactId,
      reason: interceptResult.reason,
    });

    // 生成复用结果消息
    const artifact = this.artifactStore.get(interceptResult.artifactId);
    const summaryText = artifact
      ? this.artifactStore.formatForLLM(interceptResult.artifactId)
      : `Artifact ${interceptResult.artifactId} available`;

    await this.transition({
      type: 'TOOL_RESULT',
      result: {
        toolCallId: toolCall.id,
        success: true,
        data: {
          reused: true,
          artifactId: interceptResult.artifactId,
          note: `Reused existing result. ${interceptResult.reason}`,
          summary: summaryText,
        },
      },
    });
    return;
  }

  // ===== 现有：去重检测（二级保护，完全保留） =====
  const argsKey = JSON.stringify(toolCall.arguments || {});
  const recentCalls = this.recentToolCalls.filter(
    (c) =>
      c.name === toolCall.name &&
      c.argsKey === argsKey &&
      Date.now() - c.timestamp < AgentLoop.DEDUP_WINDOW_MS,
  );
  // ... 现有逻辑完全不变 ...
}
```

### 4.4 新增 import

```typescript
import {ToolCallInterceptor} from './tool_call_interceptor';
```

### 4.5 变更范围限定

- 仅在 `executeToolCall()` 方法开头插入拦截逻辑
- 现有去重代码（`recentToolCalls` / `DEDUP_WINDOW_MS` / `TOOL_DEDUP_LIMITS`）**完全不变**
- 不修改任何现有类型、常量、其他方法

---

## 5. 约束

1. **拦截范围**：`ToolCallInterceptor` 仅对 `invoke_skill` 工具生效。`execute_sql`、`lookup_sql_schema`、`fetch_artifact` 等其他工具**不受拦截器影响**，直接返回 `EXECUTE`。
2. **状态校验**：复用结果时必须确认 artifact `status === 'VALID'`（或 `status === undefined` 兼容旧数据）。`PENDING` / `FAILED` / `INVALIDATED` 状态的 artifact 不可复用。
3. **保留现有去重**：现有 60 秒窗口 + 差异化阈值逻辑作为二级保护，不做任何修改。即使拦截器返回 EXECUTE，后续仍走现有去重流程。
4. **幂等性**：`intercept()` 方法为纯查询操作，不修改任何状态，可安全重复调用。
5. **参数提取约定**：从 `invoke_skill` 的 `args` 中提取字段：
   - `args.skill_id` → `skillId: string`
   - `args.params` → `params: Record<string, unknown>`（缺省为 `{}`）

---

## 6. 现有去重机制参考（不变）

以下为 `agent_loop.ts` 中现有的去重实现，SPEC-03 不做任何修改：

```typescript
// 去重窗口
private static readonly DEDUP_WINDOW_MS = 60000;  // 60秒

// 差异化阈值
private static readonly TOOL_DEDUP_LIMITS: Record<string, number> = {
  'execute_sql': 5,        // SQL查询型
  'lookup_sql_schema': 4,  // 探索型
};
private static readonly DEFAULT_DEDUP_LIMIT = 3; // 其他工具默认阈值

// 去重逻辑（在 executeToolCall 中）：
// 1. 计算 argsKey = JSON.stringify(toolCall.arguments)
// 2. 过滤 recentToolCalls 中 name + argsKey 相同且在窗口内的记录
// 3. 超过阈值 → 注入系统消息提示 LLM 停止重复
// 4. 未超过 → 记录本次调用，清理过期记录
```

---

## 7. 验收标准

| ID | 描述 | 验证方式 |
|----|------|----------|
| SPEC-03-AC01 | 相同 `skillId + params` 第二次调用 `invoke_skill` 时，拦截器返回 `REUSE` 并附带已有 `artifactId` | 单元测试 |
| SPEC-03-AC02 | artifact 被 `markInvalidated()` 后，拦截器对相同 `skillId + params` 返回 `EXECUTE`（不再复用） | 单元测试 |
| SPEC-03-AC03 | 非 `invoke_skill` 工具（如 `execute_sql`、`lookup_sql_schema`）调用时，拦截器始终返回 `EXECUTE` | 单元测试 |
| SPEC-03-AC04 | 现有去重逻辑继续作为二级保护：即使拦截器放行，相同参数超过阈值仍被去重系统拦截 | 集成测试 |
| SPEC-03-AC05 | 复用时返回的 tool result 包含 `reused: true`、`artifactId`、`summary` 字段 | 单元测试 |
| SPEC-03-AC06 | `PENDING` 和 `FAILED` 状态的 artifact 不被复用，拦截器返回 `EXECUTE` | 单元测试 |
