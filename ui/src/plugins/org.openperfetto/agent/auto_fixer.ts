// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * SPEC-04: AutoFixer — 自动修正机制
 *
 * 尝试自动修正 ValidationFailure，形成"验证 → 诊断 → 修正"的闭环。
 * 仅处理 autoFixAvailable=true 的失败项。
 */

import {ValidationFailure, AutoFixResult} from '../types/agent';

/**
 * 自动修正器
 *
 * 根据 ValidationFailure 的 fixGuidance 尝试自动修正。
 * 调用方根据返回的 AutoFixResult 决定是否跳过该失败项。
 */
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
      actionTaken: `Skipped rule '${failure.ruleId}': ${failure.fixGuidance.reason ?? 'rule not applicable'}`,
      requiresRevalidation: false,
    };
  }

  private handleModifySqlOrderBy(failure: ValidationFailure): AutoFixResult {
    // 生成修正建议（不直接修改，而是提供建议给 LLM）
    const suggestedOrderBy = (failure.fixGuidance.suggestedParams?.orderBy as string) ?? 'ts ASC';
    return {
      success: false, // SQL 修改需要 LLM 执行
      actionTaken: `Suggested adding ORDER BY ${suggestedOrderBy}`,
      requiresRevalidation: true,
      failureReason: 'SQL modification requires LLM re-execution',
    };
  }
}
