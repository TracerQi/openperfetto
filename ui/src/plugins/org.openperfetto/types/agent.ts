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

import {SceneType} from './plugin_state';

/**
 * 对话消息类型
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;

  /** 如果是工具调用消息 */
  toolCall?: ToolCall;

  /** 如果是工具结果消息 */
  toolResult?: ToolResult;

  /** 渲染相关元数据 */
  metadata?: {
    /** 是否正在流式输出 */
    isStreaming?: boolean;
    /** 包含的可点击时间戳 */
    clickableTimestamps?: ClickableTimestamp[];
    /** 包含的可点击帧 ID */
    clickableFrameIds?: ClickableFrameId[];
  };
}

export interface ClickableTimestamp {
  text: string;
  tsNs: bigint;
  startIndex: number;
  endIndex: number;
}

export interface ClickableFrameId {
  text: string;
  frameId: number;
  startIndex: number;
  endIndex: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  artifactRef?: string;
}

/**
 * 分析计划（Planning Gate 输出）
 */
export interface AnalysisPlan {
  id: string;
  sceneType: SceneType;
  phases: AnalysisPhase[];
  successCriteria: string[];
  estimatedSteps: number;
  submittedAt: number;
}

export interface AnalysisPhase {
  id: string;
  name: string;
  description: string;
  requiredTools: string[];
  expectedOutputs: string[];
  completed: boolean;
}

// ============================================================================
// SPEC-04: 验证-修正结构化闭环 类型定义
// ============================================================================

/**
 * 修正动作类型
 */
export type FixAction =
  | 'RE_EXECUTE_SKILL'        // 重新执行某个 Skill
  | 'MODIFY_SQL_ORDER_BY'     // 修改 SQL 的 ORDER BY 子句
  | 'SKIP_VALIDATION_RULE'    // 跳过不适用的验证规则
  | 'CHANGE_PARAMETER'        // 修改工具调用参数
  | 'MANUAL_FIX_REQUIRED';    // 需要 LLM 手动修正

/**
 * 结构化验证失败信息
 */
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

/**
 * 自动修正结果
 */
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
