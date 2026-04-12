# SPEC-02: Artifact 生命周期管理

## 1. 概述

为现有的 Artifact 系统增加 **status / version / lifecycle** 状态管理能力，使 Agent 能够：

1. 以 PENDING → VALID / FAILED 的两阶段方式创建 artifact（先占位、再填充）；
2. 对同一 skill + params 的多次调用自动管理版本，invalidate 旧版本；
3. 通过状态报告向 LLM 注入当前可用 artifact 上下文。

**设计原则**：所有新增字段均为 `optional`，所有现有方法签名和行为保持不变，实现完全向后兼容。

---

## 2. 修改文件清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `ui/src/plugins/org.openperfetto/types/artifact.ts` | 修改 | 扩展 `Artifact` 接口，新增 `ArtifactStatus`、`ValidationResult` 类型 |
| `ui/src/plugins/org.openperfetto/agent/artifact_store.ts` | 修改 | 新增 8 个方法，`store()` 方法添加默认字段赋值 |
| `ui/src/plugins/org.openperfetto/__tests__/unit/artifact_store.test.ts` | 修改 | 新增生命周期管理相关测试用例 |

---

## 3. 接口变更

### 3.1 新增类型定义（artifact.ts）

```typescript
/**
 * Artifact 生命周期状态
 */
export type ArtifactStatus = 'PENDING' | 'VALID' | 'FAILED' | 'INVALIDATED';

/**
 * Artifact 验证结果
 */
export interface ValidationResult {
  /** 验证是否通过 */
  passed: boolean;
  /** 失败原因列表 */
  failures: string[];
  /** 验证时间戳 */
  checkedAt: number;
}
```

### 3.2 Artifact 接口扩展（artifact.ts）

在现有 `Artifact` 接口中新增以下 **optional** 字段：

```typescript
export interface Artifact {
  // ========== 现有字段（不变） ==========
  id: string;                    // 格式: art_${counter}
  type: ArtifactType;            // 'table' | 'scalar' | 'chart' | 'trace_flow'
  createdAt: number;
  fullData: ArtifactData;
  summary: ArtifactSummary;
  sourceTool: string;
  sourceQuery?: string;

  // ========== 新增字段（全部 optional） ==========

  /** 生命周期状态，默认 'VALID' */
  status?: ArtifactStatus;

  /** 版本号，默认 1 */
  version?: number;

  /** 来源 Skill ID（如 'app_startup_breakdown'） */
  sourceSkillId?: string;

  /** 来源 Skill 参数 */
  sourceParams?: Record<string, unknown>;

  /** 前一版本的 artifact ID */
  previousVersion?: string;

  /** 被替换为的新版本 artifact ID */
  replacedBy?: string;

  /** 验证结果 */
  validationResult?: ValidationResult;
}
```

### 3.3 ArtifactStore 新增方法（artifact_store.ts）

#### 3.3.1 `createPending(skillId, params, sourceTool): Artifact`

创建一个 PENDING 状态的占位 artifact。

```typescript
/**
 * 创建 PENDING 状态的占位 artifact
 *
 * @param skillId - 来源技能 ID
 * @param params - 技能参数
 * @param sourceTool - 来源工具名称
 * @returns 创建的 PENDING artifact（fullData 和 summary 为空占位）
 *
 * 行为：
 * 1. 生成新 id（art_${++counter}）
 * 2. status = 'PENDING'
 * 3. version = 1（如果存在同 skillId+params 的旧版本，则 version = 旧版本.version + 1）
 * 4. fullData = { columns: [], rows: [], totalRowCount: 0 }
 * 5. summary = { estimatedTokens: 0, rowCount: 0 }
 * 6. 自动调用 invalidatePreviousVersions(skillId, params)
 * 7. LRU 淘汰策略继续生效
 */
createPending(
  skillId: string,
  params: Record<string, unknown>,
  sourceTool: string,
): Artifact;
```

#### 3.3.2 `markValid(id, data): void`

将 PENDING artifact 填充数据并标记为 VALID。

```typescript
/**
 * 将 PENDING artifact 标记为 VALID 并填充数据
 *
 * @param id - artifact ID
 * @param data - 完整的 ArtifactData
 * @throws 如果 artifact 不存在或状态不是 PENDING
 *
 * 行为：
 * 1. 校验 artifact 存在且 status === 'PENDING'
 * 2. 设置 fullData = data
 * 3. 设置 summary = this.compress(data)
 * 4. 设置 status = 'VALID'
 */
markValid(id: string, data: ArtifactData): void;
```

#### 3.3.3 `markFailed(id, error): void`

将 PENDING artifact 标记为 FAILED。

```typescript
/**
 * 将 PENDING artifact 标记为 FAILED
 *
 * @param id - artifact ID
 * @param error - 错误信息
 * @throws 如果 artifact 不存在或状态不是 PENDING
 *
 * 行为：
 * 1. 校验 artifact 存在且 status === 'PENDING'
 * 2. 设置 status = 'FAILED'
 * 3. 设置 validationResult = { passed: false, failures: [error], checkedAt: Date.now() }
 */
markFailed(id: string, error: string): void;
```

#### 3.3.4 `markInvalidated(id, reason): void`

将 artifact 标记为 INVALIDATED（已被新版本替代）。

```typescript
/**
 * 将 artifact 标记为 INVALIDATED
 *
 * @param id - artifact ID
 * @param reason - 失效原因
 *
 * 行为：
 * 1. 校验 artifact 存在
 * 2. 设置 status = 'INVALIDATED'
 * 3. 设置 validationResult = { passed: false, failures: [reason], checkedAt: Date.now() }
 */
markInvalidated(id: string, reason: string): void;
```

#### 3.3.5 `invalidatePreviousVersions(skillId, params): void`

将同 skillId + params 的所有旧版本标记为 INVALIDATED。

```typescript
/**
 * 将同 skillId+params 的所有旧 VALID 版本标记为 INVALIDATED
 *
 * @param skillId - 技能 ID
 * @param params - 技能参数
 *
 * 行为：
 * 1. 遍历所有 artifacts
 * 2. 查找 sourceSkillId === skillId
 *    且 JSON.stringify(sourceParams) === JSON.stringify(params)
 *    且 status === 'VALID'
 * 3. 对匹配的 artifact 调用 markInvalidated(id, 'Replaced by newer version')
 * 4. 设置旧 artifact 的 replacedBy = 新版本 ID（调用方负责设置）
 */
invalidatePreviousVersions(skillId: string, params: Record<string, unknown>): void;
```

#### 3.3.6 `getValidArtifactSummaries(): ArtifactSummary[]`

获取所有 VALID 状态的 artifact 摘要。

```typescript
/**
 * 获取所有 VALID 状态的 artifact 摘要
 *
 * @returns VALID artifact 的 summary 数组
 *
 * 行为：
 * 1. 过滤 status === 'VALID' 或 status === undefined（兼容旧数据）
 * 2. 返回匹配 artifact 的 summary 数组
 */
getValidArtifactSummaries(): ArtifactSummary[];
```

#### 3.3.7 `getStatusReport(): string`

生成人类可读的状态报告，用于 LLM 上下文注入。

```typescript
/**
 * 生成当前所有 artifact 的状态报告
 *
 * @returns 多行字符串，包含每个 artifact 的状态图标和摘要
 *
 * 输出格式示例：
 * ```
 * === Artifact 状态报告 ===
 * ✅ art_1 [VALID]   table  (120行) via invoke_skill
 * ⏳ art_2 [PENDING]  table  (0行)  via invoke_skill
 * ❌ art_3 [FAILED]   table  (0行)  via invoke_skill — Error: timeout
 * 🚫 art_4 [INVALIDATED] table (120行) via invoke_skill — Replaced by newer version
 * ```
 *
 * 状态图标映射：
 * - VALID:       ✅
 * - PENDING:     ⏳
 * - FAILED:      ❌
 * - INVALIDATED: 🚫
 * - undefined:   ✅ （兼容旧数据，视为 VALID）
 */
getStatusReport(): string;
```

#### 3.3.8 `findBySkillAndParams(skillId, params): Artifact | undefined`

查找匹配 skillId + params 的 VALID artifact。

```typescript
/**
 * 查找匹配 skillId+params 的 VALID artifact
 *
 * @param skillId - 技能 ID
 * @param params - 技能参数
 * @returns 匹配的 VALID artifact，不存在则返回 undefined
 *
 * 行为：
 * 1. 遍历所有 artifacts
 * 2. 查找 sourceSkillId === skillId
 *    且 JSON.stringify(sourceParams) === JSON.stringify(params)
 *    且 (status === 'VALID' 或 status === undefined)
 * 3. 如果有多个匹配，返回 version 最高的（或 createdAt 最新的）
 */
findBySkillAndParams(
  skillId: string,
  params: Record<string, unknown>,
): Artifact | undefined;
```

### 3.4 现有方法的兼容性保证

#### `store()` 方法

```typescript
store(
  type: ArtifactType,
  data: ArtifactData,
  sourceTool: string,
  sourceQuery?: string,
): Artifact;
```

**行为变更**：在创建 artifact 对象时，自动添加默认值：
- `status: 'VALID'`
- `version: 1`

**签名不变**，返回值类型不变。旧调用方无需任何修改。

#### 其他方法（无变更）

| 方法 | 签名 | 行为 |
|------|------|------|
| `get(id)` | `get(id: string): Artifact \| undefined` | 不变 |
| `getAll()` | `getAll(): Artifact[]` | 不变（返回所有状态的 artifact） |
| `fetchPage(id, startRow, count)` | `fetchPage(id: string, startRow: number, count: number): unknown[][] \| null` | 不变 |
| `compress(data)` | `compress(data: ArtifactData): ArtifactSummary` | 不变 |
| `formatForLLM(artifactRef)` | `formatForLLM(artifactRef: string): string` | 不变 |
| `size()` | `size(): number` | 不变 |
| `clear()` | `clear(): void` | 不变 |

---

## 4. 实现约束

1. **向后兼容**：所有新增字段为 `optional`，旧代码创建或读取 artifact 时无需修改。
2. **签名不变**：现有 `store()` / `get()` / `getAll()` / `fetchPage()` / `compress()` / `formatForLLM()` 方法签名和返回值类型不变。
3. **LRU 策略**：`createPending()` 与 `store()` 共享同一个 `MAX_ARTIFACTS = 100` 的 LRU 淘汰策略。
4. **参数比较**：`skillId + params` 的匹配使用 `JSON.stringify()` 进行深度比较。
5. **状态流转**：
   - `PENDING` → `VALID`（通过 `markValid()`）
   - `PENDING` → `FAILED`（通过 `markFailed()`）
   - `VALID` → `INVALIDATED`（通过 `markInvalidated()` 或 `invalidatePreviousVersions()`）
   - 不允许其他状态流转（如 FAILED → VALID）。

---

## 5. 验收标准

| ID | 描述 | 验证方式 |
|----|------|----------|
| SPEC-02-AC01 | 通过 `createPending()` 创建的 artifact，`status === 'PENDING'`，`fullData.rows` 为空数组，`summary.rowCount === 0` | 单元测试 |
| SPEC-02-AC02 | 对 PENDING artifact 调用 `markValid(data)` 后，`status === 'VALID'`，`fullData` 和 `summary` 被正确填充 | 单元测试 |
| SPEC-02-AC03 | 同 `skillId + params` 重复调用 `createPending()` 时，旧版本自动变为 `INVALIDATED`，新版本 `version = 旧版本.version + 1` | 单元测试 |
| SPEC-02-AC04 | `getStatusReport()` 返回包含 ✅/⏳/❌/🚫 状态图标的人类可读多行字符串 | 单元测试 |
| SPEC-02-AC05 | 现有 `store()` 方法创建的 artifact，`status === 'VALID'`，`version === 1`，所有旧有测试继续通过 | 回归测试 |
| SPEC-02-AC06 | `findBySkillAndParams()` 仅返回 VALID 状态的 artifact，INVALIDATED/FAILED/PENDING 的不返回 | 单元测试 |
| SPEC-02-AC07 | `getValidArtifactSummaries()` 返回所有 VALID（含 `status === undefined` 的旧数据）的摘要 | 单元测试 |
