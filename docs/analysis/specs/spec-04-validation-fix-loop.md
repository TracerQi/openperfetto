# SPEC-04: 验证-修正结构化闭环

## 1. 概述

当前 L1 验证规则的 `check()` 方法仅返回 `string`（问题描述），缺乏结构化的修正指引。验证失败后 LLM 只能看到模糊的错误信息，无法知道如何修正，导致修正效率低下、循环重试。

本 Spec 增强 L1 验证规则，使其返回结构化的 `ValidationFailure`（含修正指引），并新增 `AutoFixer` 自动修正机制，形成"验证 → 诊断 → 修正"的闭环。

## 2. 修改文件清单

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `ui/src/plugins/org.openperfetto/types/agent.ts` | 修改 | 新增 `ValidationFailure`、`FixAction` 等类型定义 |
| `ui/src/plugins/org.openperfetto/agent/verifier.ts` | 修改 | 新增 `L1RuleEnhanced` 接口，修改 `runL1Validation`，`VerificationResult` 新增字段 |
| `ui/src/plugins/org.openperfetto/agent/auto_fixer.ts` | 新建 | `AutoFixer` 类，自动修正机制 |
| `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` | 修改 | VERIFYING 状态集成 AutoFixer |

## 3. 新增类型定义（types/agent.ts）

### 3.1 FixAction 类型

```typescript
export type FixAction =
  | 'RE_EXECUTE_SKILL'        // 重新执行某个 Skill
  | 'MODIFY_SQL_ORDER_BY'     // 修改 SQL 的 ORDER BY 子句
  | 'SKIP_VALIDATION_RULE'    // 跳过不适用的验证规则
  | 'CHANGE_PARAMETER'        // 修改工具调用参数
  | 'MANUAL_FIX_REQUIRED';    // 需要 LLM 手动修正
```

### 3.2 ValidationFailure 接口

```typescript
export interface ValidationFailure {
  /** 触发失败的规则 ID，如 'timestamp_monotonic' */
  ruleId: string;

  /** 关联的 Artifact ID（可选，若验证与特定 Artifact 相关） */
  artifactId: string;

  /** 严重程度 */
  severity: 'error' | 'warning';

  /** 人类可读的问题描述（兼容现有 l1Issues 的字符串） */
  description: string;

  /** 结构化修正指引 */
  fixGuidance: {
    /** 建议的修正动作 */
    action: FixAction;
    /** 需要重新执行的 Skill ID（仅 RE_EXECUTE_SKILL 时有效） */
    targetSkillId?: string;
    /** 建议的参数修改（仅 CHANGE_PARAMETER / RE_EXECUTE_SKILL 时有效） */
    suggestedParams?: Record<string, unknown>;
    /** 是否支持自动修正（AutoFixer 可处理） */
    autoFixAvailable: boolean;
    /** 修正原因说明（注入 LLM 上下文时使用） */
    reason?: string;
  };

  /** 诊断详情，帮助 LLM 理解问题根因 */
  diagnostics: {
    /** 实际值 */
    actualValue?: string | number;
    /** 期望值 */
    expectedValue?: string | number;
    /** 受影响的数据行范围 */
    affectedRows?: number;
    /** 相关的 SQL 子句 */
    relevantSqlClause?: string;
  };
}
```

### 3.3 AutoFixResult 接口

```typescript
export interface AutoFixResult {
  /** 是否修正成功 */
  success: boolean;
  /** 修正动作描述 */
  actionTaken: string;
  /** 修正后是否需要重新验证 */
  requiresRevalidation: boolean;
  /** 失败原因（success=false 时） */
  failureReason?: string;
}
```

## 4. verifier.ts 修改

### 4.1 新增 L1RuleEnhanced 接口

```typescript
export interface L1RuleEnhanced extends L1Rule {
  /**
   * 增强版检查方法，返回结构化的 ValidationFailure。
   * 与现有 check() 并行存在，优先使用 checkEnhanced。
   */
  checkEnhanced(
    messages: ChatMessage[],
    artifacts: Artifact[]
  ): ValidationFailure | null;
}
```

- `L1RuleEnhanced` 继承 `L1Rule`，新增 `checkEnhanced` 方法。
- 现有 `L1Rule` 接口**不修改**，所有已有规则继续通过 `check()` 工作。

### 4.2 修改 runL1Validation 方法

```typescript
runL1Validation(messages: ChatMessage[], artifacts: Artifact[]): {
  issues: string[];
  structuredFailures: ValidationFailure[];
} {
  const issues: string[] = [];
  const structuredFailures: ValidationFailure[] = [];

  for (const rule of this.l1Rules) {
    // 优先使用 checkEnhanced
    if ('checkEnhanced' in rule) {
      const failure = (rule as L1RuleEnhanced).checkEnhanced(messages, artifacts);
      if (failure) {
        structuredFailures.push(failure);
        issues.push(failure.description); // 向后兼容
      }
    } else {
      // 回退到现有 check()
      const issue = rule.check(messages, artifacts);
      if (issue) {
        issues.push(issue);
      }
    }
  }

  return { issues, structuredFailures };
}
```

### 4.3 VerificationResult 新增字段

```typescript
export interface VerificationResult {
  passed: boolean;
  l1Issues: string[];
  l2Issues: string[];
  softWarnings: string[];
  l3Result: L3ReviewResult | null;
  totalIssues: number;
  timestamp: number;
  /** 新增：结构化的失败信息列表（optional，向后兼容） */
  structuredFailures?: ValidationFailure[];
}
```

### 4.4 关键规则增强

#### timestamp_monotonic 规则

增强逻辑：检查最近的 SQL 查询是否包含 `ORDER BY dur DESC`，若是则判定该规则不适用（时间戳非递增是预期行为）。

```typescript
checkEnhanced(messages, artifacts): ValidationFailure | null {
  // 1. 执行原有 check() 逻辑
  const issue = this.check(messages, artifacts);
  if (!issue) return null;

  // 2. 检查最近 SQL 是否包含 ORDER BY dur DESC
  const lastSql = extractLastSqlFromMessages(messages);
  const hasDurDescOrder = lastSql && /ORDER\s+BY\s+dur\s+DESC/i.test(lastSql);

  return {
    ruleId: 'timestamp_monotonic',
    artifactId: findRelevantArtifactId(artifacts),
    severity: hasDurDescOrder ? 'warning' : 'error',
    description: issue,
    fixGuidance: {
      action: hasDurDescOrder ? 'SKIP_VALIDATION_RULE' : 'MODIFY_SQL_ORDER_BY',
      autoFixAvailable: hasDurDescOrder,
      suggestedParams: hasDurDescOrder ? undefined : { orderBy: 'ts ASC' },
      reason: hasDurDescOrder
        ? '查询按 dur DESC 排序，时间戳非递增为预期行为'
        : '建议添加 ORDER BY ts ASC 确保时间戳递增',
    },
    diagnostics: {
      relevantSqlClause: lastSql ?? undefined,
    },
  };
}
```

#### 其他规则逐步增强

后续迭代中逐步为以下规则添加 `checkEnhanced`：
- `data_row_count`: 诊断返回实际行数 vs 预期行数
- `assertion_present`: 建议 RE_EXECUTE_SKILL 重新查询
- `causality_chain`: 提供因果链断裂的具体位置

## 5. 新建 AutoFixer 类（agent/auto_fixer.ts）

```typescript
export class AutoFixer {
  /**
   * 尝试自动修正一个 ValidationFailure。
   * 返回修正结果，调用方根据结果决定是否跳过该失败项。
   */
  attemptAutoFix(failure: ValidationFailure): AutoFixResult {
    switch (failure.fixGuidance.action) {
      case 'SKIP_VALIDATION_RULE':
        return this.handleSkipRule(failure);
      case 'MODIFY_SQL_ORDER_BY':
        return this.handleModifySqlOrderBy(failure);
      default:
        return {
          success: false,
          actionTaken: 'none',
          requiresRevalidation: false,
          failureReason: `AutoFix not supported for action: ${failure.fixGuidance.action}`,
        };
    }
  }

  private handleSkipRule(failure: ValidationFailure): AutoFixResult {
    // 标记该规则在当前上下文中不适用
    return {
      success: true,
      actionTaken: `Skipped rule '${failure.ruleId}': ${failure.fixGuidance.reason}`,
      requiresRevalidation: false,
    };
  }

  private handleModifySqlOrderBy(failure: ValidationFailure): AutoFixResult {
    // 生成修正建议（不直接修改，而是提供建议给 LLM）
    const suggestedOrderBy = failure.fixGuidance.suggestedParams?.orderBy ?? 'ts ASC';
    return {
      success: false, // SQL 修改需要 LLM 执行
      actionTaken: `Suggested adding ORDER BY ${suggestedOrderBy}`,
      requiresRevalidation: true,
      failureReason: 'SQL modification requires LLM re-execution',
    };
  }
}
```

## 6. agent_loop.ts VERIFYING 状态集成

在 VERIFYING 状态处理逻辑中，验证失败后调用 AutoFixer：

```typescript
// VERIFYING 状态处理（伪代码）
case 'VERIFYING': {
  const result = this.verifier.runFullVerification(messages, artifacts);

  if (!result.passed && result.structuredFailures?.length) {
    const autoFixer = new AutoFixer();
    const remainingFailures: ValidationFailure[] = [];

    for (const failure of result.structuredFailures) {
      if (failure.fixGuidance.autoFixAvailable) {
        const fixResult = autoFixer.attemptAutoFix(failure);
        if (fixResult.success) {
          // 自动修正成功，跳过该失败项
          logger.info(`AutoFixed: ${fixResult.actionTaken}`);
          continue;
        }
      }
      remainingFailures.push(failure);
    }

    if (remainingFailures.length === 0) {
      // 所有失败项都被自动修正，视为通过
      result.passed = true;
    } else {
      // 将结构化指引注入 LLM 上下文
      const fixGuidanceText = remainingFailures.map(f =>
        `[${f.ruleId}] ${f.description}\n` +
        `  修正建议: ${f.fixGuidance.action} - ${f.fixGuidance.reason ?? ''}\n` +
        `  诊断: ${JSON.stringify(f.diagnostics)}`
      ).join('\n\n');

      this.injectFixGuidanceToContext(fixGuidanceText);
    }
  }
  break;
}
```

### 关键行为：
1. **自动修正成功** → 从失败列表中移除该项，不计入最终失败数
2. **自动修正失败** → 将结构化指引（含 fixGuidance + diagnostics）注入 LLM 上下文
3. **所有失败项都被自动修正** → 验证视为通过，不触发重试

## 7. 约束

- 现有 `L1Rule.check()` 接口**不删除**，`checkEnhanced` 为新增方法
- `L2`/`L3` 验证逻辑**不修改**
- `VerificationResult.l1Issues` 继续填充（向后兼容，值来源于 `ValidationFailure.description` 或原 `check()` 返回值）
- `structuredFailures` 字段为 optional，不影响现有消费方
- AutoFixer 仅处理 `autoFixAvailable=true` 的失败项

## 8. 验收标准

| ID | 标准 | 验证方式 |
|----|------|---------|
| SPEC-04-AC01 | `timestamp_monotonic` 在 `ORDER BY dur DESC` 时返回 `fixGuidance.action = 'SKIP_VALIDATION_RULE'` 且 `autoFixAvailable = true` | 单元测试 |
| SPEC-04-AC02 | `AutoFixer.attemptAutoFix()` 对 `SKIP_VALIDATION_RULE` 类型返回 `success = true` | 单元测试 |
| SPEC-04-AC03 | 现有验证流程不受影响：仅有 `check()` 的规则继续正常工作，`l1Issues` 继续填充 | 回归测试 |
| SPEC-04-AC04 | 结构化失败信息包含 `diagnostics` 详情（`actualValue`/`expectedValue`/`relevantSqlClause`） | 单元测试 |
| SPEC-04-AC05 | VERIFYING 状态中，AutoFixer 成功修正后失败项从列表移除 | 集成测试 |
| SPEC-04-AC06 | AutoFixer 无法修正时，结构化指引文本被注入 LLM 上下文 | 集成测试 |
