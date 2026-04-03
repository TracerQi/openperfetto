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
 * Artifact Store 中的数据项
 */
export interface Artifact {
  id: string;
  type: ArtifactType;
  createdAt: number;

  /** 原始完整数据（供 UI 渲染） */
  fullData: ArtifactData;

  /** 压缩摘要（供 LLM 使用） */
  summary: ArtifactSummary;

  /** 来源 Tool */
  sourceTool: string;

  /** 原始 SQL 查询（如适用） */
  sourceQuery?: string;
}

export type ArtifactType = 'table' | 'scalar' | 'chart' | 'trace_flow';

export interface ArtifactData {
  columns: ColumnDefinition[];
  rows: unknown[][];
  totalRowCount: number;
}

export interface ColumnDefinition {
  name: string;
  type: 'integer' | 'float' | 'string' | 'timestamp' | 'duration' | 'boolean';
  unit?: string;
}

/**
 * 数据摘要（压缩后发送给 LLM）
 */
export interface ArtifactSummary {
  /** 估算的 token 数量 */
  estimatedTokens: number;

  /** 行数统计 */
  rowCount: number;

  /** 数值列统计 */
  numericStats?: Record<string, NumericStats>;

  /** 字符串列统计 */
  stringStats?: Record<string, StringStats>;

  /** 样本行（最严重的 N 行） */
  sampleRows?: unknown[][];

  /** 自动识别的洞察 */
  insights?: string[];
}

export interface NumericStats {
  min: number;
  max: number;
  avg: number;
  /** 分位数采样：覆盖完整分布 */
  p0: number; // 最小值（同 min）
  p25: number; // 25分位
  p50: number; // 中位数
  p75: number; // 75分位
  p90: number;
  p95: number;
  p99: number;
  p999: number; // 99.9分位，捕获极端长尾
}

export interface StringStats {
  topValues: Array<{value: string; count: number}>;
  uniqueCount: number;
}
