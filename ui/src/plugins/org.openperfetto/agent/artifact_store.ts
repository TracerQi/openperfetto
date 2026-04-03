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

import {
  Artifact,
  ArtifactData,
  ArtifactSummary,
  ArtifactType,
  NumericStats,
  StringStats,
} from '../types/artifact';

/**
 * Artifact Store
 * 存储 Tool 返回的大量数据，并生成压缩摘要发送给 LLM
 *
 * 采样策略：
 * - 目标 token 数：800-1000
 * - 分位数采样（p0, p25, p50, p75, p90, p95, p99, p99.9）
 * - 极值保留（Top 5 + Bottom 5）
 * - 自动识别洞察
 */
export class ArtifactStore {
  private static readonly MAX_ARTIFACTS = 100;
  private artifacts: Map<string, Artifact> = new Map();
  private idCounter = 0;

  /**
   * 存储完整数据并生成摘要
   * 使用 LRU 策略限制存储大小
   */
  store(
    type: ArtifactType,
    data: ArtifactData,
    sourceTool: string,
    sourceQuery?: string,
  ): Artifact {
    // LRU: 如果达到上限，删除最早的条目
    if (this.artifacts.size >= ArtifactStore.MAX_ARTIFACTS) {
      const firstKey = this.artifacts.keys().next().value;
      if (firstKey !== undefined) {
        this.artifacts.delete(firstKey);
      }
    }

    const id = `art_${++this.idCounter}`;

    const artifact: Artifact = {
      id,
      type,
      createdAt: Date.now(),
      fullData: data,
      summary: this.compress(data),
      sourceTool,
      sourceQuery,
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  /**
   * 获取指定 artifact
   */
  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  /**
   * 获取所有 artifacts
   */
  getAll(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * 分页获取数据
   */
  fetchPage(id: string, startRow: number, count: number): unknown[][] | null {
    const artifact = this.artifacts.get(id);
    if (!artifact) return null;

    return artifact.fullData.rows.slice(startRow, startRow + count);
  }

  /**
   * 获取存储的 artifact 数量
   */
  size(): number {
    return this.artifacts.size;
  }

  /**
   * 清空存储
   */
  clear(): void {
    this.artifacts.clear();
    this.idCounter = 0;
  }

  /**
   * 压缩数据生成摘要
   */
  compress(data: ArtifactData): ArtifactSummary {
    const summary: ArtifactSummary = {
      estimatedTokens: 0,
      rowCount: data.totalRowCount,
    };

    // 分析每一列
    const numericStats: Record<string, NumericStats> = {};
    const stringStats: Record<string, StringStats> = {};

    for (let colIdx = 0; colIdx < data.columns.length; colIdx++) {
      const col = data.columns[colIdx];
      const values = data.rows.map((row) => row[colIdx]);

      if (
        col.type === 'integer' ||
        col.type === 'float' ||
        col.type === 'duration'
      ) {
        const numericValues = values.filter(
          (v) => v !== null && v !== undefined && typeof v === 'number',
        ) as number[];
        if (numericValues.length > 0) {
          numericStats[col.name] = this.calculateNumericStats(numericValues);
        }
      } else if (col.type === 'string') {
        const stringValues = values.filter(
          (v) => v !== null && v !== undefined && typeof v === 'string',
        ) as string[];
        if (stringValues.length > 0) {
          stringStats[col.name] = this.calculateStringStats(stringValues);
        }
      }
    }

    if (Object.keys(numericStats).length > 0) {
      summary.numericStats = numericStats;
    }

    if (Object.keys(stringStats).length > 0) {
      summary.stringStats = stringStats;
    }

    // 使用分位数采样 + 极值保留策略
    summary.sampleRows = this.getQuantileSampledRows(data);

    // 自动生成洞察
    summary.insights = this.generateInsights(data, numericStats, stringStats);

    // 估算 token 数量（目标 800-1000）
    summary.estimatedTokens = this.estimateTokens(summary);

    return summary;
  }

  /**
   * 计算数值列统计（包含完整分位数）
   */
  private calculateNumericStats(values: number[]): NumericStats {
    if (values.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        p0: 0,
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        p999: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p0: sorted[0],
      p25: this.percentile(sorted, 25),
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      p999: this.percentile(sorted, 99.9),
    };
  }

  /**
   * 计算分位数
   */
  private percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  /**
   * 计算字符串列统计
   */
  private calculateStringStats(values: string[]): StringStats {
    const counts = new Map<string, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }

    const topValues = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({value, count}));

    return {
      topValues,
      uniqueCount: counts.size,
    };
  }

  /**
   * 分位数采样 + 极值保留
   *
   * 采样策略：
   * 1. Top 5（最大值）- 通常是性能问题最严重的行
   * 2. Bottom 5（最小值）- 作为基准对比
   * 3. 分位数采样点（p25, p50, p75, p90, p95）- 覆盖分布
   *
   * 总共约 15-20 行
   */
  private getQuantileSampledRows(data: ArtifactData): unknown[][] {
    const rows = data.rows;
    if (rows.length <= 20) {
      return rows; // 数据量小，全部返回
    }

    // 找到第一个数值列用于排序
    const numericColIdx = data.columns.findIndex(
      (col) =>
        col.type === 'integer' ||
        col.type === 'float' ||
        col.type === 'duration',
    );

    if (numericColIdx < 0) {
      // 没有数值列，取前 15 行
      return rows.slice(0, 15);
    }

    // 按数值列排序（降序）
    const sortedRows = [...rows].sort((a, b) => {
      const aVal = (a[numericColIdx] as number) || 0;
      const bVal = (b[numericColIdx] as number) || 0;
      return bVal - aVal;
    });

    const sampledRows: unknown[][] = [];
    const addedIndices = new Set<number>();

    // 1. Top 5（最大值）
    for (let i = 0; i < Math.min(5, sortedRows.length); i++) {
      sampledRows.push(sortedRows[i]);
      addedIndices.add(i);
    }

    // 2. Bottom 5（最小值）
    for (
      let i = sortedRows.length - 1;
      i >= Math.max(0, sortedRows.length - 5);
      i--
    ) {
      if (!addedIndices.has(i)) {
        sampledRows.push(sortedRows[i]);
        addedIndices.add(i);
      }
    }

    // 3. 分位数采样点
    const percentiles = [25, 50, 75, 90, 95];
    for (const p of percentiles) {
      const idx = Math.floor((p / 100) * (sortedRows.length - 1));
      if (!addedIndices.has(idx)) {
        sampledRows.push(sortedRows[idx]);
        addedIndices.add(idx);
      }
    }

    // 按原始顺序排序返回（降序，最严重的在前）
    return sampledRows.sort((a, b) => {
      const aVal = (a[numericColIdx] as number) || 0;
      const bVal = (b[numericColIdx] as number) || 0;
      return bVal - aVal;
    });
  }

  /**
   * 自动生成洞察
   */
  private generateInsights(
    data: ArtifactData,
    numericStats: Record<string, NumericStats>,
    stringStats: Record<string, StringStats>,
  ): string[] {
    const insights: string[] = [];

    // 数值列洞察
    for (const [colName, stats] of Object.entries(numericStats)) {
      // P99 远大于 P50（高方差）
      if (stats.p99 > stats.p50 * 5 && stats.p50 > 0) {
        insights.push(
          `${colName} 存在高方差: P99 (${this.formatNumber(stats.p99)}) >> P50 (${this.formatNumber(stats.p50)})`,
        );
      }

      // 最大值异常（outlier）
      if (stats.max > stats.p99 * 2 && stats.p99 > 0) {
        insights.push(
          `${colName} 检测到异常值: max (${this.formatNumber(stats.max)}) >> P99`,
        );
      }

      // 大部分数据在某个阈值以下
      if (stats.p90 < stats.max * 0.5 && stats.max > 0) {
        const belowP90Percent = 90;
        insights.push(
          `${belowP90Percent}% 的 ${colName} 在 ${this.formatNumber(stats.p90)} 以下`,
        );
      }
    }

    // 字符串列洞察
    for (const [colName, stats] of Object.entries(stringStats)) {
      if (stats.topValues.length > 0) {
        const top = stats.topValues[0];
        const percentage = ((top.count / data.totalRowCount) * 100).toFixed(1);
        if (parseFloat(percentage) > 50) {
          insights.push(
            `${colName} 主要值: "${top.value}" (${percentage}%)`,
          );
        }
      }
    }

    return insights.slice(0, 5); // 最多 5 条洞察
  }

  /**
   * 格式化数字
   */
  private formatNumber(value: number): string {
    if (Math.abs(value) >= 1000000) {
      return (value / 1000000).toFixed(2) + 'M';
    } else if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(2) + 'K';
    } else if (Math.abs(value) < 0.01 && value !== 0) {
      return value.toExponential(2);
    } else {
      return value.toFixed(2);
    }
  }

  /**
   * 估算摘要的 token 数量
   */
  private estimateTokens(summary: ArtifactSummary): number {
    let text = JSON.stringify(summary);
    // 简化估算：约 4 字符 = 1 token
    return Math.ceil(text.length / 4);
  }

  /**
   * 格式化摘要为 LLM 可读的文本
   */
  formatForLLM(artifactRef: string): string {
    const artifact = this.artifacts.get(artifactRef);
    if (!artifact) {
      return `[Artifact ${artifactRef} not found]`;
    }

    const s = artifact.summary;
    const lines: string[] = [];

    lines.push(`[Artifact ${artifact.id}]`);
    lines.push(`类型: ${artifact.type}`);
    lines.push(`行数: ${s.rowCount}`);
    lines.push(`来源: ${artifact.sourceTool}`);

    if (s.numericStats) {
      lines.push('');
      lines.push('数值列统计:');
      for (const [col, stats] of Object.entries(s.numericStats)) {
        lines.push(
          `  ${col}: min=${this.formatNumber(stats.min)}, max=${this.formatNumber(stats.max)}, ` +
            `avg=${this.formatNumber(stats.avg)}, P50=${this.formatNumber(stats.p50)}, ` +
            `P90=${this.formatNumber(stats.p90)}, P99=${this.formatNumber(stats.p99)}`,
        );
      }
    }

    if (s.stringStats) {
      lines.push('');
      lines.push('字符串列统计:');
      for (const [col, stats] of Object.entries(s.stringStats)) {
        lines.push(`  ${col}: ${stats.uniqueCount} 个唯一值`);
        lines.push(
          `    Top: ${stats.topValues.map((v) => `${v.value}(${v.count})`).join(', ')}`,
        );
      }
    }

    if (s.insights && s.insights.length > 0) {
      lines.push('');
      lines.push('洞察:');
      for (const insight of s.insights) {
        lines.push(`  - ${insight}`);
      }
    }

    lines.push('');
    lines.push(`(完整数据: fetch_artifact('${artifact.id}', 0, 20))`);

    return lines.join('\n');
  }
}
