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
 * Verifier Module - 三层验证系统
 *
 * 实现 OpenPerfetto 的验证框架，确保 AI 分析结论的准确性：
 * - L1: 启发式规则验证（20条规则）
 * - L2: 计划遵从验证（检查是否执行了计划中的阶段）
 * - L3: LLM 审查（预留接口，可选注入）
 *
 * 验证流程：
 * 1. L1 规则检查所有消息和 artifact
 * 2. L2 检查计划遵从情况
 * 3. L3 可选的 LLM 审查
 * 4. 汇总所有问题返回 VerificationResult
 */

import {ChatMessage, ToolCall, ToolResult, AnalysisPlan} from '../types/agent';
import {Artifact} from '../types/artifact';

/**
 * L1 规则类别
 */
export type L1RuleCategory =
  | 'data_integrity'
  | 'performance_metrics'
  | 'assertion'
  | 'causality'
  | 'frame_analysis'
  | 'tool_usage'
  | 'overmark';

/**
 * L1 规则定义
 */
export interface L1Rule {
  id: string;
  name: string;
  category: L1RuleCategory;
  /**
   * 检查规则
   * @param messages 会话消息
   * @param artifacts 所有 artifact
   * @returns 问题描述字符串，null 表示通过
   */
  check: (messages: ChatMessage[], artifacts: Artifact[]) => string | null;
}

/**
 * L3 审查器接口（可选注入）
 */
export interface L3Reviewer {
  review(conclusion: string, evidence: string[]): Promise<L3ReviewResult>;
}

/**
 * L3 审查结果
 */
export interface L3ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  confidence: number;
}

/**
 * L2 验证结果（区分硬性问题和软警告）
 */
export interface L2ValidationResult {
  hardIssues: string[];
  softWarnings: string[];
}

/**
 * 完整验证结果
 */
export interface VerificationResult {
  passed: boolean;
  l1Issues: string[];
  l2Issues: string[];
  softWarnings: string[];
  l3Result: L3ReviewResult | null;
  totalIssues: number;
  timestamp: number;
}

/**
 * 辅助函数：合并所有消息内容
 */
function getAllMessageContent(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'assistant' || m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .toLowerCase();
}

/**
 * 辅助函数：获取所有工具调用
 */
function getToolCalls(messages: ChatMessage[]): ToolCall[] {
  return messages
    .filter((m) => m.toolCall)
    .map((m) => m.toolCall as ToolCall);
}

/**
 * 辅助函数：获取所有工具结果
 */
function getToolResults(messages: ChatMessage[]): ToolResult[] {
  return messages
    .filter((m) => m.toolResult)
    .map((m) => m.toolResult as ToolResult);
}

/**
 * 辅助函数：检查是否有成功的工具调用
 */
function hasSuccessfulToolCall(messages: ChatMessage[]): boolean {
  const results = getToolResults(messages);
  return results.some((r) => r.success);
}

/**
 * 辅助函数：获取成功工具调用的数量
 */
function getSuccessfulToolCallCount(messages: ChatMessage[]): number {
  const results = getToolResults(messages);
  return results.filter((r) => r.success).length;
}

/**
 * 辅助函数：检查是否有 SQL 查询工具调用
 * @internal 保留用于将来的规则扩展
 */
export function hasSqlQuery(messages: ChatMessage[]): boolean {
  const toolCalls = getToolCalls(messages);
  return toolCalls.some(
    (tc) => tc.name === 'execute_sql' || tc.name === 'lookup_sql_schema',
  );
}

/**
 * 辅助函数：检查是否有失败的 SQL 查询
 */
function hasFailedSqlQuery(messages: ChatMessage[]): boolean {
  const results = getToolResults(messages);
  return results.some(
    (r) => !r.success && r.error?.toLowerCase().includes('sql'),
  );
}

/**
 * 辅助函数：从消息中提取数值
 * @internal 保留用于将来的规则扩展
 */
export function extractNumbers(text: string): number[] {
  const matches = text.match(/[\d.]+/g) || [];
  return matches.map((m) => parseFloat(m)).filter((n) => !isNaN(n));
}

// ============================================================================
// L1 规则定义
// ============================================================================

/**
 * 规则 1: timestamp_monotonic - 检查时间戳是否递增
 * 分析 artifact 中的时间戳字段，确保时间序列单调递增
 */
const rule_timestamp_monotonic: L1Rule = {
  id: 'L1-001',
  name: 'timestamp_monotonic',
  category: 'data_integrity',
  check: (_messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    for (const artifact of artifacts) {
      const timestampColIdx = artifact.fullData.columns.findIndex(
        (col) => col.type === 'timestamp' || col.name.toLowerCase().includes('ts'),
      );
      if (timestampColIdx < 0) continue;

      const rows = artifact.fullData.rows;
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1][timestampColIdx] as number | bigint;
        const curr = rows[i][timestampColIdx] as number | bigint;
        if (prev !== null && curr !== null && curr < prev) {
          return `Artifact ${artifact.id} 中时间戳不单调递增（行 ${i}）`;
        }
      }
    }
    return null;
  },
};

/**
 * 规则 2: thread_existence - 检查线程名/ID 是否有工具结果支持
 */
const rule_thread_existence: L1Rule = {
  id: 'L1-002',
  name: 'thread_existence',
  category: 'data_integrity',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测线程引用模式：如 "RenderThread", "Thread-123", "tid: 1234"
    const threadRefs = content.match(
      /\b(renderthread|uithread|main\s*thread|thread[- ]?\d+|tid[:\s]+\d+|worker\s*thread)/gi,
    );
    if (!threadRefs || threadRefs.length === 0) return null;

    // 检查是否有工具调用或 artifact 支持
    const hasToolSupport = hasSuccessfulToolCall(messages);
    const hasArtifactSupport = artifacts.length > 0;

    if (!hasToolSupport && !hasArtifactSupport) {
      return `消息中引用了线程 (${threadRefs[0]})，但没有工具调用或数据支持`;
    }
    return null;
  },
};

/**
 * 规则 3: process_state_consistency - 检查进程状态声明是否矛盾
 */
const rule_process_state_consistency: L1Rule = {
  id: 'L1-003',
  name: 'process_state_consistency',
  category: 'data_integrity',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测矛盾的进程状态声明
    const isRunning = /进程.*正在运行|process.*running|进程.*活跃/i.test(content);
    const isStopped = /进程.*停止|process.*stopped|进程.*终止|进程.*killed/i.test(content);

    if (isRunning && isStopped) {
      return '检测到矛盾的进程状态声明：同时声称进程正在运行和已停止';
    }
    return null;
  },
};

/**
 * 规则 4: cpu_freq_anomaly - CPU频率声明是否在合理范围
 */
const rule_cpu_freq_anomaly: L1Rule = {
  id: 'L1-004',
  name: 'cpu_freq_anomaly',
  category: 'performance_metrics',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 匹配 CPU 频率声明：如 "2.4GHz", "1800MHz", "freq: 2400000"
    const freqPatterns = [
      /(\d+(?:\.\d+)?)\s*ghz/gi,
      /(\d+(?:\.\d+)?)\s*mhz/gi,
      /freq[:\s]+(\d+)/gi,
      /频率[:\s]+(\d+)/gi,
    ];

    for (const pattern of freqPatterns) {
      const matches = Array.from(content.matchAll(pattern));
      for (const match of matches) {
        let freqKHz: number;
        const value = parseFloat(match[1]);

        if (pattern.source.includes('ghz')) {
          freqKHz = value * 1_000_000;
        } else if (pattern.source.includes('mhz')) {
          freqKHz = value * 1_000;
        } else {
          // 假设是 KHz
          freqKHz = value;
        }

        // 合理范围：100KHz - 10GHz (100,000 - 10,000,000 KHz)
        if (freqKHz < 100 || freqKHz > 10_000_000) {
          return `CPU 频率 ${match[0]} 超出合理范围 (100KHz-10GHz)`;
        }
      }
    }
    return null;
  },
};

/**
 * 规则 5: gc_pause_anomaly - GC暂停时间声明是否有数据支持
 */
const rule_gc_pause_anomaly: L1Rule = {
  id: 'L1-005',
  name: 'gc_pause_anomaly',
  category: 'performance_metrics',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测 GC 暂停声明 >100ms
    const gcPatterns = [
      /gc.*?(\d+(?:\.\d+)?)\s*ms/gi,
      /garbage\s*collection.*?(\d+(?:\.\d+)?)\s*ms/gi,
      /垃圾回收.*?(\d+(?:\.\d+)?)\s*ms/gi,
    ];

    for (const pattern of gcPatterns) {
      const matches = Array.from(content.matchAll(pattern));
      for (const match of matches) {
        const pauseMs = parseFloat(match[1]);
        if (pauseMs > 100) {
          // 检查是否有 artifact 支持
          const hasEvidence = artifacts.some((a) => {
            const summary = JSON.stringify(a.summary).toLowerCase();
            return summary.includes('gc') || summary.includes('garbage');
          });

          if (!hasEvidence) {
            return `声称 GC 暂停 ${pauseMs}ms (>100ms) 但没有 artifact 数据支持`;
          }
        }
      }
    }
    return null;
  },
};

/**
 * 规则 6: main_thread_io - 主线程 I/O 声明是否有工具调用证据
 */
const rule_main_thread_io: L1Rule = {
  id: 'L1-006',
  name: 'main_thread_io',
  category: 'performance_metrics',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测主线程 I/O 声明
    const ioPatterns = [
      /主线程.*?i\/o/gi,
      /main\s*thread.*?i\/o/gi,
      /ui\s*thread.*?(read|write|io)/gi,
      /主线程.*?(读|写|磁盘)/gi,
    ];

    const hasIOClaim = ioPatterns.some((p) => p.test(content));
    if (!hasIOClaim) return null;

    // 检查是否有工具调用证据
    if (!hasSuccessfulToolCall(messages)) {
      return '声称主线程存在 I/O 问题，但没有工具调用证据';
    }
    return null;
  },
};

/**
 * 规则 7: binder_latency - Binder RTT >50ms 声明是否有 trace 证据
 */
const rule_binder_latency: L1Rule = {
  id: 'L1-007',
  name: 'binder_latency',
  category: 'performance_metrics',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测 Binder 延迟声明
    const binderPatterns = [
      /binder.*?(\d+(?:\.\d+)?)\s*ms/gi,
      /rtt.*?(\d+(?:\.\d+)?)\s*ms/gi,
      /binder.*?延迟.*?(\d+(?:\.\d+)?)/gi,
    ];

    for (const pattern of binderPatterns) {
      const matches = Array.from(content.matchAll(pattern));
      for (const match of matches) {
        const latencyMs = parseFloat(match[1]);
        if (latencyMs > 50) {
          // 检查是否有 binder 相关的证据
          const hasBinderEvidence =
            artifacts.some((a) => {
              const toolLower = a.sourceTool.toLowerCase();
              const queryLower = (a.sourceQuery || '').toLowerCase();
              const summaryStr = JSON.stringify(a.summary).toLowerCase();
              return (
                toolLower.includes('binder') ||
                queryLower.includes('binder') ||
                summaryStr.includes('binder')
              );
            }) ||
            messages.some(
              (m) =>
                m.toolCall &&
                ((typeof m.toolResult?.data === 'string'
                  ? m.toolResult.data.toLowerCase().includes('binder')
                  : false) ||
                  JSON.stringify(m.toolCall.arguments || {})
                    .toLowerCase()
                    .includes('binder')),
            );

          if (!hasBinderEvidence) {
            return `声称 Binder 延迟 ${latencyMs}ms (>50ms) 但没有 trace 证据`;
          }
        }
      }
    }
    return null;
  },
};

/**
 * 规则 8: syscall_load - 系统调用负载声明是否有查询数据支持
 */
const rule_syscall_load: L1Rule = {
  id: 'L1-008',
  name: 'syscall_load',
  category: 'performance_metrics',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测系统调用负载声明
    const syscallPatterns = [
      /syscall.*?(高|heavy|频繁|frequent)/gi,
      /系统调用.*?(高|负载|频繁)/gi,
      /system\s*call.*?(high|heavy|load)/gi,
    ];

    const hasSyscallClaim = syscallPatterns.some((p) => p.test(content));
    if (!hasSyscallClaim) return null;

    // 检查是否有 syscall 相关的证据
    const hasSyscallEvidence =
      artifacts.some((a) => {
        const toolLower = a.sourceTool.toLowerCase();
        const queryLower = (a.sourceQuery || '').toLowerCase();
        const summaryStr = JSON.stringify(a.summary).toLowerCase();
        return (
          toolLower.includes('syscall') ||
          queryLower.includes('syscall') ||
          summaryStr.includes('syscall') ||
          summaryStr.includes('system call')
        );
      }) ||
      messages.some(
        (m) =>
          m.toolCall &&
          (JSON.stringify(m.toolCall.arguments || {})
            .toLowerCase()
            .includes('syscall') ||
            (typeof m.toolResult?.data === 'string' &&
              m.toolResult.data.toLowerCase().includes('syscall'))),
      );

    if (!hasSyscallEvidence) {
      return '声称系统调用负载高，但没有执行相关查询';
    }
    return null;
  },
};

/**
 * 规则 9: vsync_offset - VSync 问题声明是否有数据支持
 */
const rule_vsync_offset: L1Rule = {
  id: 'L1-009',
  name: 'vsync_offset',
  category: 'assertion',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测 VSync 问题声明
    const vsyncPatterns = [
      /vsync.*?(miss|错过|偏移|offset|问题)/gi,
      /垂直同步.*?(问题|错过|miss)/gi,
    ];

    const hasVsyncClaim = vsyncPatterns.some((p) => p.test(content));
    if (!hasVsyncClaim) return null;

    // 检查是否有 vsync 相关的证据
    const hasVsyncEvidence =
      artifacts.some((a) => {
        const toolLower = a.sourceTool.toLowerCase();
        const queryLower = (a.sourceQuery || '').toLowerCase();
        const summaryStr = JSON.stringify(a.summary).toLowerCase();
        return (
          toolLower.includes('vsync') ||
          queryLower.includes('vsync') ||
          summaryStr.includes('vsync') ||
          summaryStr.includes('frame_timeline')
        );
      }) ||
      messages.some(
        (m) =>
          m.toolCall &&
          (JSON.stringify(m.toolCall.arguments || {})
            .toLowerCase()
            .includes('vsync') ||
            JSON.stringify(m.toolCall.arguments || {})
              .toLowerCase()
              .includes('frame_timeline')),
      );

    if (!hasVsyncEvidence) {
      return '声称 VSync 存在问题，但没有数据支持';
    }
    return null;
  },
};

/**
 * 规则 10: empty_result_assertion - 是否在空查询结果上做强断言
 */
const rule_empty_result_assertion: L1Rule = {
  id: 'L1-010',
  name: 'empty_result_assertion',
  category: 'assertion',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    // 检查是否有空结果的 artifact
    const emptyArtifacts = artifacts.filter((a) => a.summary.rowCount === 0);
    if (emptyArtifacts.length === 0) return null;

    const content = getAllMessageContent(messages);

    // 检测强断言模式
    const strongAssertions = [
      /明确|确定|definitely|clearly|obviously|肯定/gi,
      /根因是|root\s*cause\s*is|主要原因/gi,
    ];

    const hasStrongAssertion = strongAssertions.some((p) => p.test(content));
    if (hasStrongAssertion) {
      return '在空查询结果的情况下做了强断言，请重新验证';
    }
    return null;
  },
};

/**
 * 规则 11: numeric_sanity - 数值范围合理性检查
 */
const rule_numeric_sanity: L1Rule = {
  id: 'L1-011',
  name: 'numeric_sanity',
  category: 'assertion',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检查百分比范围 (0-100%)
    const percentMatches = Array.from(content.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
    for (const match of percentMatches) {
      const value = parseFloat(match[1]);
      if (value < 0 || value > 100) {
        return `百分比 ${value}% 超出合理范围 (0-100%)`;
      }
    }

    // 检查时间值范围 (0-1,000,000ms)
    const timeMatches = Array.from(content.matchAll(/(\d+(?:\.\d+)?)\s*ms/g));
    for (const match of timeMatches) {
      const value = parseFloat(match[1]);
      if (value < 0 || value > 1_000_000) {
        return `时间值 ${value}ms 超出合理范围 (0-1,000,000ms)`;
      }
    }
    return null;
  },
};

/**
 * 规则 12: buffer_stuffing - Buffer Stuffing 声明是否有帧数据和证据
 */
const rule_buffer_stuffing: L1Rule = {
  id: 'L1-012',
  name: 'buffer_stuffing',
  category: 'assertion',
  check: (messages: ChatMessage[], artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测 Buffer Stuffing 声明
    const stuffingPatterns = [
      /buffer\s*stuffing/gi,
      /缓冲区填充/gi,
      /triple\s*buffer/gi,
    ];

    const hasStuffingClaim = stuffingPatterns.some((p) => p.test(content));
    if (!hasStuffingClaim) return null;

    // 检查是否有帧数据支持
    const hasFrameData = artifacts.some((a) => {
      const summary = JSON.stringify(a.summary).toLowerCase();
      return summary.includes('frame') || summary.includes('帧');
    });

    if (!hasFrameData) {
      return '声称存在 Buffer Stuffing，但没有帧数据支持';
    }
    return null;
  },
};

/**
 * 规则 13: unsupported_root_cause - 根因声明是否执行了足够的工具调用
 */
const rule_unsupported_root_cause: L1Rule = {
  id: 'L1-013',
  name: 'unsupported_root_cause',
  category: 'causality',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测根因声明
    const rootCausePatterns = [
      /root\s*cause/gi,
      /根因|根本原因|主要原因/gi,
      /caused\s*by|导致.*?的原因/gi,
    ];

    const hasRootCauseClaim = rootCausePatterns.some((p) => p.test(content));
    if (!hasRootCauseClaim) return null;

    // 检查工具调用次数（至少 2 次）
    const successfulToolCount = getSuccessfulToolCallCount(messages);
    if (successfulToolCount < 2) {
      return `声称找到根因，但只执行了 ${successfulToolCount} 次工具调用（需要 ≥2 次）`;
    }
    return null;
  },
};

/**
 * 规则 14: anr_cause_unclear - ANR 提及时是否说明原因类型
 */
const rule_anr_cause_unclear: L1Rule = {
  id: 'L1-014',
  name: 'anr_cause_unclear',
  category: 'causality',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测 ANR 提及
    const hasANRMention = /\banr\b|application\s*not\s*responding/gi.test(content);
    if (!hasANRMention) return null;

    // 检查是否说明了原因类型
    const anrCauseTypes = [
      /input.*?(dispatch|timeout)/gi,
      /broadcast.*?(timeout|receiver)/gi,
      /service.*?(timeout|start)/gi,
      /content\s*provider/gi,
      /输入.*?(超时|分发)/gi,
      /广播.*?(超时|接收)/gi,
      /服务.*?(超时|启动)/gi,
    ];

    const hasCauseType = anrCauseTypes.some((p) => p.test(content));
    if (!hasCauseType) {
      return 'ANR 分析中未说明具体原因类型（input/broadcast/service/provider）';
    }
    return null;
  },
};

/**
 * 规则 15: lock_no_holder - 锁竞争声明时是否识别了持有者
 */
const rule_lock_no_holder: L1Rule = {
  id: 'L1-015',
  name: 'lock_no_holder',
  category: 'causality',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测锁竞争声明
    const lockPatterns = [
      /lock\s*contention/gi,
      /锁竞争|锁等待/gi,
      /mutex.*?(wait|block)/gi,
      /monitor.*?(contention|wait)/gi,
    ];

    const hasLockClaim = lockPatterns.some((p) => p.test(content));
    if (!hasLockClaim) return null;

    // 检查是否识别了持有者
    const holderPatterns = [
      /held\s*by|持有者|holder|持有/gi,
      /owner.*?thread|线程.*?持有/gi,
      /blocking\s*thread/gi,
    ];

    const hasHolder = holderPatterns.some((p) => p.test(content));
    if (!hasHolder) {
      return '声称存在锁竞争，但未识别锁持有者';
    }
    return null;
  },
};

/**
 * 规则 16: fps_calculation - FPS 值是否在合理范围
 */
const rule_fps_calculation: L1Rule = {
  id: 'L1-016',
  name: 'fps_calculation',
  category: 'frame_analysis',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 匹配 FPS 值
    const fpsMatches = Array.from(content.matchAll(/(\d+(?:\.\d+)?)\s*fps/gi));
    for (const match of fpsMatches) {
      const fps = parseFloat(match[1]);
      // 合理范围：1-240 fps
      if (fps < 1 || fps > 240) {
        return `FPS 值 ${fps} 超出合理范围 (1-240)`;
      }
    }
    return null;
  },
};

/**
 * 规则 17: frame_duration_fps_mismatch - 帧持续时间与 FPS 是否匹配
 */
const rule_frame_duration_fps_mismatch: L1Rule = {
  id: 'L1-017',
  name: 'frame_duration_fps_mismatch',
  category: 'frame_analysis',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 提取 FPS 和帧持续时间
    const fpsMatch = content.match(/(\d+(?:\.\d+)?)\s*fps/i);
    const durationMatch = content.match(/帧.*?(\d+(?:\.\d+)?)\s*ms|frame.*?(\d+(?:\.\d+)?)\s*ms/i);

    if (!fpsMatch || !durationMatch) return null;

    const fps = parseFloat(fpsMatch[1]);
    const durationMs = parseFloat(durationMatch[1] || durationMatch[2]);

    if (fps <= 0 || durationMs <= 0) return null;

    // 计算期望帧持续时间
    const expectedDurationMs = 1000 / fps;

    // 允许 20% 误差
    const tolerance = 0.2;
    const minExpected = expectedDurationMs * (1 - tolerance);
    const maxExpected = expectedDurationMs * (1 + tolerance);

    if (durationMs < minExpected || durationMs > maxExpected) {
      return `帧持续时间 ${durationMs}ms 与 ${fps} FPS 不匹配（期望 ${expectedDurationMs.toFixed(1)}ms ±20%）`;
    }
    return null;
  },
};

/**
 * 规则 18: no_query_conclusion - 是否在无工具调用的情况下做结论性声明
 */
const rule_no_query_conclusion: L1Rule = {
  id: 'L1-018',
  name: 'no_query_conclusion',
  category: 'tool_usage',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    // 检查是否有成功的工具调用
    if (hasSuccessfulToolCall(messages)) return null;

    const content = getAllMessageContent(messages);

    // 检测结论性声明
    const conclusionPatterns = [
      /结论|conclusion|总结|summary|分析结果/gi,
      /建议|recommendation|suggest|优化方案/gi,
      /发现.*?问题|found.*?issue|检测到/gi,
    ];

    const hasConclusion = conclusionPatterns.some((p) => p.test(content));
    if (hasConclusion) {
      return '在没有执行工具调用的情况下做了结论性声明';
    }
    return null;
  },
};

/**
 * 规则 19: failed_query_continue - SQL 查询失败后是否有适当的错误处理
 */
const rule_failed_query_continue: L1Rule = {
  id: 'L1-019',
  name: 'failed_query_continue',
  category: 'tool_usage',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    // 检查是否有失败的 SQL 查询
    if (!hasFailedSqlQuery(messages)) return null;

    const content = getAllMessageContent(messages);

    // 检查是否有错误处理/说明
    const errorHandlingPatterns = [
      /查询失败|query\s*failed|error|错误/gi,
      /尝试.*?替代|try.*?alternative|换.*?方式/gi,
      /无法获取|cannot\s*get|unable\s*to/gi,
    ];

    const hasErrorHandling = errorHandlingPatterns.some((p) => p.test(content));
    if (!hasErrorHandling) {
      return 'SQL 查询失败后没有适当的错误处理或说明';
    }
    return null;
  },
};

/**
 * 规则 20: single_frame_overmark - 是否将单帧 jank 标记为严重问题
 */
const rule_single_frame_overmark: L1Rule = {
  id: 'L1-020',
  name: 'single_frame_overmark',
  category: 'overmark',
  check: (messages: ChatMessage[], _artifacts: Artifact[]): string | null => {
    const content = getAllMessageContent(messages);

    // 检测单帧问题的严重性标记
    const singleFramePatterns = [
      /单.*?帧.*?(严重|critical|high|紧急)/gi,
      /single.*?frame.*?(severe|critical|high)/gi,
      /1.*?帧.*?jank.*?(严重|紧急)/gi,
    ];

    const hasOvermark = singleFramePatterns.some((p) => p.test(content));
    if (hasOvermark) {
      return '将单帧 jank 标记为严重问题，可能过度标记';
    }
    return null;
  },
};

// ============================================================================
// 所有 L1 规则
// ============================================================================

const ALL_L1_RULES: L1Rule[] = [
  // 数据完整性规则 (3)
  rule_timestamp_monotonic,
  rule_thread_existence,
  rule_process_state_consistency,
  // 性能指标规则 (5)
  rule_cpu_freq_anomaly,
  rule_gc_pause_anomaly,
  rule_main_thread_io,
  rule_binder_latency,
  rule_syscall_load,
  // 断言验证规则 (4)
  rule_vsync_offset,
  rule_empty_result_assertion,
  rule_numeric_sanity,
  rule_buffer_stuffing,
  // 因果关系规则 (3)
  rule_unsupported_root_cause,
  rule_anr_cause_unclear,
  rule_lock_no_holder,
  // 帧分析规则 (2)
  rule_fps_calculation,
  rule_frame_duration_fps_mismatch,
  // 工具使用规则 (2)
  rule_no_query_conclusion,
  rule_failed_query_continue,
  // 单帧过度标记规则 (1)
  rule_single_frame_overmark,
];

// ============================================================================
// Verifier 类
// ============================================================================

/**
 * 三层验证器
 *
 * 验证 AI 分析结论的准确性：
 * - L1: 20条启发式规则
 * - L2: 计划遵从验证
 * - L3: LLM 审查（可选）
 */
export class Verifier {
  private l1Rules: L1Rule[];
  private l3Reviewer: L3Reviewer | null = null;

  constructor() {
    this.l1Rules = this.initializeL1Rules();
  }

  /**
   * 设置 L3 审查器（可选注入）
   */
  setL3Reviewer(reviewer: L3Reviewer): void {
    this.l3Reviewer = reviewer;
  }

  /**
   * L1 启发式验证
   * 运行所有 L1 规则，返回问题列表
   */
  runL1Validation(messages: ChatMessage[], artifacts: Artifact[]): string[] {
    const issues: string[] = [];

    for (const rule of this.l1Rules) {
      try {
        const issue = rule.check(messages, artifacts);
        if (issue) {
          issues.push(`[${rule.id}] ${rule.name}: ${issue}`);
        }
      } catch (error) {
        // 规则执行出错不应该阻塞验证流程
        console.warn(`L1 rule ${rule.id} failed:`, error);
      }
    }

    return issues;
  }

  /**
   * L2 计划遵从验证
   * 检查是否执行了计划中的阶段
   * 返回硬性问题（影响 passed）和软警告（successCriteria 相关）
   */
  runL2Validation(plan: AnalysisPlan, messages: ChatMessage[]): L2ValidationResult {
    const hardIssues: string[] = [];
    const softWarnings: string[] = [];

    if (!plan || !plan.phases || plan.phases.length === 0) {
      return {hardIssues, softWarnings}; // 没有计划，不检查
    }

    // 获取已执行的工具调用
    const executedTools = new Set(
      getToolCalls(messages).map((tc) => tc.name.toLowerCase()),
    );

    // 检查每个阶段（硬性问题：阶段未执行、工具未调用）
    for (const phase of plan.phases) {
      // 检查是否有必需工具未执行
      const missingTools = phase.requiredTools.filter(
        (tool) => !executedTools.has(tool.toLowerCase()),
      );

      if (missingTools.length > 0) {
        hardIssues.push(
          `[L2:tool_missing] 计划阶段 "${phase.name}" 中的工具未执行: ${missingTools.join(', ')}`,
        );
      }
    }

    // 检查成功标准（软警告：不影响 passed 判定）
    const content = getAllMessageContent(messages);
    for (const criterion of plan.successCriteria) {
      const criterionLower = criterion.toLowerCase();

      // 改进的关键词提取：支持中文（按字符切分）和英文（按空格切分）
      // 检测是否包含中文字符
      const hasChinese = /[\u4e00-\u9fa5]/.test(criterion);

      let hasRelatedContent = false;

      if (hasChinese) {
        // 中文文本：提取所有中文词语（2字及以上），以及整体模糊匹配
        const chineseWords = criterionLower.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        // 保留短词（1-2字符的关键词也可能重要）
        const allChineseChars = criterionLower.match(/[\u4e00-\u9fa5]+/g) || [];

        // 检查是否有任何中文词语在内容中
        hasRelatedContent =
          chineseWords.some((word) => content.includes(word)) ||
          allChineseChars.some((chars) => chars.length >= 2 && content.includes(chars));
      } else {
        // 英文文本：按空格切分，保留所有词（不过滤短词）
        const keywords = criterionLower
          .split(/\s+/)
          .filter((w) => w.length >= 1); // 保留所有词，包括短词

        // 至少有一个关键词匹配
        hasRelatedContent = keywords.some((kw) => content.includes(kw));
      }

      if (!hasRelatedContent) {
        softWarnings.push(`[L2:soft] 未达成成功标准: "${criterion}"`);
      }
    }

    return {hardIssues, softWarnings};
  }

  /**
   * L3 审查（预留）
   * 如果设置了 L3 审查器，调用 LLM 进行交叉审查
   */
  async runL3Review(
    conclusion: string,
    evidence: string[],
  ): Promise<L3ReviewResult | null> {
    if (!this.l3Reviewer) {
      return null;
    }

    try {
      return await this.l3Reviewer.review(conclusion, evidence);
    } catch (error) {
      console.warn('L3 review failed:', error);
      return null;
    }
  }

  /**
   * 完整验证流程
   */
  async runFullVerification(
    messages: ChatMessage[],
    artifacts: Artifact[],
    plan: AnalysisPlan | null,
  ): Promise<VerificationResult> {
    // L1 验证
    const l1Issues = this.runL1Validation(messages, artifacts);

    // L2 验证（区分硬性问题和软警告）
    const l2Result = plan
      ? this.runL2Validation(plan, messages)
      : {hardIssues: [], softWarnings: []};

    // L3 验证（可选）
    let l3Result: L3ReviewResult | null = null;
    if (this.l3Reviewer) {
      // 提取结论和证据
      const conclusion = this.extractConclusion(messages);
      const evidence = this.extractEvidence(messages, artifacts);
      l3Result = await this.runL3Review(conclusion, evidence);
    }

    // passed 只由 L1 issues + L2 硬性问题决定，softWarnings 不影响
    const totalIssues =
      l1Issues.length +
      l2Result.hardIssues.length +
      (l3Result && !l3Result.approved ? l3Result.issues.length : 0);

    return {
      passed: totalIssues === 0,
      l1Issues,
      l2Issues: l2Result.hardIssues,
      softWarnings: l2Result.softWarnings,
      l3Result,
      totalIssues,
      timestamp: Date.now(),
    };
  }

  /**
   * 获取规则数量统计
   */
  getRuleStats(): {total: number; byCategory: Record<string, number>} {
    const byCategory: Record<string, number> = {};

    for (const rule of this.l1Rules) {
      byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    }

    return {
      total: this.l1Rules.length,
      byCategory,
    };
  }

  /**
   * 工厂方法：创建 L3 审查器
   * 预留接口，实际 LLM 调用需要后端支持
   */
  static createL3Reviewer(_apiKey: string, _model: string): L3Reviewer {
    // TODO: 实现实际的 LLM 审查器
    return {
      async review(_conclusion: string, _evidence: string[]): Promise<L3ReviewResult> {
        // 预留实现：总是通过
        return {
          approved: true,
          issues: [],
          suggestions: [],
          confidence: 1.0,
        };
      },
    };
  }

  /**
   * 初始化 L1 规则
   */
  private initializeL1Rules(): L1Rule[] {
    return ALL_L1_RULES;
  }

  /**
   * 从消息中提取结论
   */
  private extractConclusion(messages: ChatMessage[]): string {
    // 获取最后一条 assistant 消息作为结论
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) return '';

    const lastMsg = assistantMessages[assistantMessages.length - 1];
    return lastMsg.content;
  }

  /**
   * 从消息和 artifact 中提取证据
   */
  private extractEvidence(
    messages: ChatMessage[],
    artifacts: Artifact[],
  ): string[] {
    const evidence: string[] = [];

    // 工具调用结果作为证据
    const toolResults = getToolResults(messages);
    for (const result of toolResults) {
      if (result.success && result.data) {
        evidence.push(JSON.stringify(result.data).slice(0, 500));
      }
    }

    // Artifact 摘要作为证据
    for (const artifact of artifacts) {
      if (artifact.summary.insights) {
        evidence.push(...artifact.summary.insights);
      }
    }

    return evidence;
  }
}
