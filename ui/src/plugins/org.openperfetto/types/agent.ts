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
