# SPEC-05: SQL 模板质量强化

## 1. 概述

增强 SQL 模板的预编译验证能力，添加 `matchMode` 参数支持，修复已知 YAML 质量问题。

**目标**：
- 为字符串类型参数引入 `matchMode` 和 `columnRef`，精确控制 SQL WHERE 条件生成方式
- 增强 `SqlSanitizer` 的字符串转义能力，防止 SQL 注入
- 新增模板预编译验证，在 Skill 加载阶段发现潜在质量问题
- 修复已知 YAML Skill 文件中的 SQL 质量缺陷

**已知 YAML 质量问题**：
1. `process_overview.yaml`：`processName` 直接拼入 SQL，无转义
2. `memory_trend_analysis.yaml`：`name LIKE '%${processName}%'` 过度泛化
3. `anr_root_cause.yaml`：复杂条件表达式解析风险
4. `startup_blocking_calls.yaml`：无 `dur` 过滤，可能返回微秒级噪声数据
5. `frame_rendering_analysis.yaml`：`dur/1e6` 无 `ROUND`，精度问题

## 2. 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `server/src/skills/yaml_parser.ts` | 修改 | 扩展 `SkillParamSchema`，新增 `matchMode`、`columnRef` 字段 |
| `server/src/skills/sql_sanitizer.ts` | 修改 | 支持 `matchMode` 参数替换逻辑，增强字符串转义 |
| `server/src/skills/skill_processor.ts` | 修改 | 新增 `SQLTemplateValidator` 预编译验证逻辑 |
| `server/skills/library/process_overview.yaml` | 修改 | 添加 `matchMode`、`columnRef` |
| `server/skills/library/memory_trend_analysis.yaml` | 修改 | 修复 LIKE 过度泛化 |
| `server/skills/library/frame_rendering_analysis.yaml` | 修改 | SQL 中添加 `ROUND` |
| `server/skills/library/startup_blocking_calls.yaml` | 修改 | 添加 `dur` 过滤条件 |

## 3. yaml_parser.ts 修改

### 3.1 SkillParamSchema 扩展

在现有 `SkillParamSchema` 基础上新增两个 optional 字段：

```typescript
export const SkillParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'integer', 'float', 'boolean', 'array']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  allowedValues: z.array(z.string()).optional(),
  // --- 新增字段 ---
  matchMode: z.enum(['exact', 'contains', 'prefix', 'glob']).optional(),
  columnRef: z.string().optional(),
});
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `matchMode` | `'exact' \| 'contains' \| 'prefix' \| 'glob'` | 控制字符串参数在 SQL WHERE 中的匹配方式 |
| `columnRef` | `string` | 指定该参数对应的 SQL 列引用（如 `'p.name'`） |

**约束**：
- 两个字段均为 optional，现有 YAML 无需修改即可继续工作
- `matchMode` 仅对 `type: 'string'` 的参数生效
- 如果指定了 `matchMode`，建议同时指定 `columnRef`；若未指定 `columnRef`，则 `matchMode` 不生效（回退到原有行为）

## 4. sql_sanitizer.ts 增强

### 4.1 matchMode 支持

在 `SqlSanitizer.sanitize()` 方法的参数替换逻辑中，当参数定义了 `matchMode` **且** `columnRef` 时，将 `${param_name}` 占位符替换为完整的 SQL 条件表达式：

| matchMode | 生成的 SQL 片段 | 示例（columnRef=`p.name`, value=`com.example`） |
|-----------|-----------------|------------------------------------------------|
| `exact` | `columnRef = 'escaped_value'` | `p.name = 'com.example'` |
| `contains` | `columnRef LIKE '%escaped_value%'` | `p.name LIKE '%com.example%'` |
| `prefix` | `columnRef LIKE 'escaped_value%'` | `p.name LIKE 'com.example%'` |
| `glob` | `columnRef GLOB 'escaped_value'` | `p.name GLOB 'com.example'` |

**未定义 `matchMode` 时**：行为完全不变，仍按原有逻辑进行直接替换。

### 4.2 增强 SQL 字符串转义

对所有 `type: 'string'` 类型参数值执行单引号转义：

```typescript
function escapeStringValue(value: string): string {
  return value.replace(/'/g, "''");
}
```

**转义时机**：在 `sanitize()` 方法执行参数替换 **之前**，对所有 string 类型的参数值统一调用 `escapeStringValue()`。

**注意**：此转义逻辑适用于所有 string 参数，不限于定义了 `matchMode` 的参数。

## 5. skill_processor.ts 新增模板预编译验证

### 5.1 SQLTemplateValidator

新增验证逻辑（可作为 `SkillProcessor` 的私有方法或独立工具类），在 Skill 注册/加载时执行以下检查：

| 检查项 | 检测模式 | 级别 | 说明 |
|--------|----------|------|------|
| LIKE 过度泛化 | `LIKE '%${param}%'` | `warn` | 建议使用 `matchMode` 替代硬编码 LIKE |
| 缺少 LIMIT 子句 | SQL 不含 `LIMIT` | `warn` | 可能返回过多数据 |
| 占位符一致性 | `${param}` 与 `parameters` 定义不匹配 | `warn` | 存在未定义的占位符或多余的参数定义 |
| 时间序列缺少排序 | 含时间列但无 `ORDER BY` | `warn` | 时间序列查询应有排序 |

**实现伪代码**：

```typescript
interface TemplateWarning {
  code: string;       // 如 'LIKE_OVERUSE', 'MISSING_LIMIT', 'PARAM_MISMATCH', 'MISSING_ORDER_BY'
  message: string;
  severity: 'warn';
  skillName: string;
}

function validateSqlTemplate(
  skillName: string,
  sqlTemplate: string,
  parameters: SkillParam[]
): TemplateWarning[] {
  const warnings: TemplateWarning[] = [];

  // 1. 检查 LIKE '%${param}%' 模式
  const likePattern = /LIKE\s+'%\$\{(\w+)\}%'/gi;
  for (const match of sqlTemplate.matchAll(likePattern)) {
    warnings.push({
      code: 'LIKE_OVERUSE',
      message: `Parameter '${match[1]}' uses LIKE '%...%' which may be overly broad. Consider using matchMode.`,
      severity: 'warn',
      skillName,
    });
  }

  // 2. 检查缺少 LIMIT
  if (!/\bLIMIT\b/i.test(sqlTemplate)) {
    warnings.push({
      code: 'MISSING_LIMIT',
      message: 'SQL template has no LIMIT clause, may return excessive rows.',
      severity: 'warn',
      skillName,
    });
  }

  // 3. 占位符一致性
  const placeholders = new Set([...sqlTemplate.matchAll(/\$\{(\w+)\}/g)].map(m => m[1]));
  const paramNames = new Set(parameters.map(p => p.name));
  for (const ph of placeholders) {
    if (!paramNames.has(ph)) {
      warnings.push({
        code: 'PARAM_MISMATCH',
        message: `Placeholder '${ph}' has no matching parameter definition.`,
        severity: 'warn',
        skillName,
      });
    }
  }

  // 4. 时间序列缺少 ORDER BY
  const hasTimeColumn = /\b(ts|timestamp|time)\b/i.test(sqlTemplate);
  const hasOrderBy = /\bORDER\s+BY\b/i.test(sqlTemplate);
  if (hasTimeColumn && !hasOrderBy) {
    warnings.push({
      code: 'MISSING_ORDER_BY',
      message: 'Query references time columns but has no ORDER BY clause.',
      severity: 'warn',
      skillName,
    });
  }

  return warnings;
}
```

**调用时机**：在 `SkillProcessor` 加载/注册 Skill 时调用，将 warnings 通过 `console.warn` 或 `logger.warn` 输出。

**重要**：验证结果 **不阻断** Skill 加载，仅作为诊断信息输出。

## 6. YAML Skill 文件修复

### 6.1 process_overview.yaml

**问题**：`processName` 直接拼入 SQL，无转义。

**修改**：为 `processName` 参数添加 `matchMode` 和 `columnRef`。

```yaml
parameters:
  - name: processName
    type: string
    required: true
    description: "进程名称"
    matchMode: exact
    columnRef: p.name
```

SQL 模板中的 `WHERE p.name = '${processName}'` 将由 `matchMode: exact` 自动生成，模板本身可简化为使用 `${processName}` 占位符。

### 6.2 memory_trend_analysis.yaml

**问题**：`name LIKE '%${processName}%'` 过度泛化，可能匹配非目标进程。

**修改**：根据实际需求选择合适的 matchMode。

```yaml
parameters:
  - name: processName
    type: string
    required: true
    description: "进程名称"
    matchMode: exact       # 或 contains（如果确实需要模糊匹配）
    columnRef: p.name
```

如业务确实需要模糊匹配，使用 `matchMode: contains`；否则改为 `matchMode: exact` 精确匹配。

### 6.3 frame_rendering_analysis.yaml

**问题**：`dur/1e6` 无 `ROUND`，浮点精度问题。

**修改**：SQL 模板中所有 `dur/1e6` 改为 `ROUND(dur/1e6, 2)`。

```sql
-- 修改前
SELECT dur/1e6 AS duration_ms FROM ...

-- 修改后
SELECT ROUND(dur/1e6, 2) AS duration_ms FROM ...
```

### 6.4 startup_blocking_calls.yaml

**问题**：无 `dur` 过滤，返回大量微秒级噪声调用。

**修改**：SQL 模板的 WHERE 子句中添加 `dur > 1000000`（过滤 1ms 以下调用）。

```sql
-- 修改前
SELECT name, dur FROM slice WHERE ...

-- 修改后
SELECT name, dur FROM slice WHERE dur > 1000000 AND ...
```

## 7. 约束

- **向后兼容**：新增字段（`matchMode`、`columnRef`）全部为 optional，现有 YAML 无需任何修改即可继续正常工作
- **非阻断验证**：模板预编译验证只输出 `warning`，不阻断 Skill 加载流程
- **行为不变**：`SqlSanitizer.sanitize()` 对未定义 `matchMode` 的参数保持原有替换行为
- **最小侵入**：字符串转义增强对所有 string 参数生效，但不改变非 string 类型参数的处理逻辑

## 8. 验收标准

| ID | 验收条件 | 验证方式 |
|----|----------|----------|
| SPEC-05-AC01 | 新增 `matchMode=exact` 的参数生成 `= 'value'` 而非 LIKE | 单元测试：构造带 `matchMode: exact` 的参数，验证 `sanitize()` 输出 |
| SPEC-05-AC02 | Skill 加载时 LIKE 过度泛化模式产生 `console.warn` | 单元测试：加载含 `LIKE '%${param}%'` 的模板，验证 warnings 包含 `LIKE_OVERUSE` |
| SPEC-05-AC03 | 未定义 `matchMode` 的参数替换行为不变 | 回归测试：现有 Skill 加载和执行结果与修改前一致 |
| SPEC-05-AC04 | 字符串参数值中的单引号被正确转义（`'` → `''`） | 单元测试：传入含单引号的参数值，验证生成的 SQL 中单引号被双写 |
