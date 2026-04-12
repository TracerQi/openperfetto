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

import {AnalysisPlan} from '../types/agent';

/**
 * 分析阶段定义
 */
export interface AnalysisPhase {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  artifactId?: string; // 关联的 Artifact ID
  startTime?: number;
  endTime?: number;
}

/**
 * 分析进度追踪器
 * 从分析计划中提取阶段并追踪执行状态，
 * 生成紧凑的进度报告供 LLM 上下文使用。
 */
export class AnalysisProgress {
  private phases: Map<string, AnalysisPhase> = new Map();

  /**
   * 从分析计划中提取阶段。
   * 每个计划步骤映射为一个 AnalysisPhase。
   */
  registerPhases(plan: AnalysisPlan): void {
    for (const phase of plan.phases) {
      this.phases.set(phase.id, {
        id: phase.id,
        name: phase.name,
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
    artifactId?: string,
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
   * 输出控制在 200 tokens 以内，使用紧凑格式。
   */
  getProgressReport(): string {
    const lines: string[] = [];
    const total = this.phases.size;
    const completed = [...this.phases.values()].filter(
      (p) => p.status === 'completed',
    ).length;

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

  /**
   * 获取所有阶段
   */
  getPhases(): AnalysisPhase[] {
    return [...this.phases.values()];
  }

  /**
   * 重置所有阶段
   */
  reset(): void {
    this.phases.clear();
  }
}
