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

import m from 'mithril';
import {Trace} from '../../../public/trace';
import {Store} from '../../../base/store';
import {
  OpenPerfettoState,
  AnalysisSession,
  SceneType,
} from '../types/plugin_state';
import {ChatMessage, ToolCall, ToolResult, AnalysisPlan} from '../types/agent';
import {ContextManager} from './context_manager';
import {PlanningGate} from './planning_gate';
import {SceneClassifier} from './scene_classifier';
import {ArtifactStore} from './artifact_store';
import {WebSocketClient} from '../services/websocket_client';
import {LLMStreamHandler} from '../services/llm_stream_handler';
import {ToolRegistry, createAllTools} from '../tools';
import {Verifier, VerificationResult} from './verifier';
import {opLogger} from '../utils/logger';

/**
 * Agent Loop 状态枚举
 */
export enum AgentLoopState {
  /** 空闲状态，等待用户输入 */
  IDLE = 'IDLE',
  /** 场景分类中 */
  CLASSIFYING = 'CLASSIFYING',
  /** 构建上下文中 */
  BUILDING_CONTEXT = 'BUILDING_CONTEXT',
  /** 等待分析计划 */
  AWAITING_PLAN = 'AWAITING_PLAN',
  /** 等待 LLM 响应 */
  AWAITING_LLM = 'AWAITING_LLM',
  /** 执行工具调用 */
  EXECUTING_TOOL = 'EXECUTING_TOOL',
  /** 验证结果中 */
  VERIFYING = 'VERIFYING',
  /** 完成 */
  COMPLETE = 'COMPLETE',
  /** 错误状态 */
  ERROR = 'ERROR',
  /** 已取消 */
  CANCELLED = 'CANCELLED',
}

/**
 * Agent Loop 状态转换事件
 */
export type AgentLoopEvent =
  | {type: 'USER_MESSAGE'; message: string}
  | {type: 'SCENE_CLASSIFIED'; scene: SceneType}
  | {type: 'CONTEXT_BUILT'}
  | {type: 'PLAN_SUBMITTED'; plan: AnalysisPlan}
  | {type: 'LLM_TEXT_DELTA'; text: string}
  | {type: 'LLM_TOOL_USE'; toolCall: ToolCall}
  | {type: 'TOOL_RESULT'; result: ToolResult}
  | {type: 'LLM_DONE'; usage?: {inputTokens?: number; outputTokens?: number}}
  | {type: 'VERIFICATION_PASSED'; result: VerificationResult}
  | {type: 'VERIFICATION_FAILED'; issues: string[]; result: VerificationResult}
  | {type: 'ERROR'; error: string}
  | {type: 'CANCEL'};

/**
 * Agent 进度信息
 */
export interface AgentProgress {
  state: AgentLoopState;
  stateLabel: string;
  percentage: number;
  currentStep?: string;
  elapsedMs: number;
}

/**
 * AgentLoop 配置选项
 */
export interface AgentLoopOptions {
  onProgress?: (progress: AgentProgress) => void;
}

/**
 * UI 线程调度器
 * 在长时间操作期间让出 UI 线程
 */
const scheduler = {
  yield: (): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  },
};

/**
 * 状态标签映射
 */
const STATE_LABELS: Record<AgentLoopState, string> = {
  [AgentLoopState.IDLE]: '空闲',
  [AgentLoopState.CLASSIFYING]: '场景分类中...',
  [AgentLoopState.BUILDING_CONTEXT]: '构建上下文...',
  [AgentLoopState.AWAITING_PLAN]: '等待分析计划...',
  [AgentLoopState.AWAITING_LLM]: '等待AI响应...',
  [AgentLoopState.EXECUTING_TOOL]: '执行工具...',
  [AgentLoopState.VERIFYING]: '验证结果...',
  [AgentLoopState.COMPLETE]: '分析完成',
  [AgentLoopState.ERROR]: '发生错误',
  [AgentLoopState.CANCELLED]: '已取消',
};

/**
 * AgentLoop 核心实现 - 状态机控制分析流程
 *
 * 状态机流程：
 *   IDLE → CLASSIFYING → BUILDING_CONTEXT → AWAITING_PLAN
 *   → AWAITING_LLM ⇄ EXECUTING_TOOL → VERIFYING → COMPLETE
 */
export class AgentLoop {
  private state: AgentLoopState = AgentLoopState.IDLE;
  private readonly trace: Trace;
  private readonly store: Store<OpenPerfettoState>;

  // 核心组件
  private contextManager: ContextManager;
  private planningGate: PlanningGate;
  private sceneClassifier: SceneClassifier;
  private artifactStore: ArtifactStore;
  private wsClient: WebSocketClient;
  private streamHandler: LLMStreamHandler;
  private toolRegistry: ToolRegistry;

  // 当前会话状态
  private currentSceneType: SceneType = 'general';
  private currentPlan: AnalysisPlan | null = null;
  private toolCallCount = 0;
  private pendingToolCalls: Map<string, ToolCall> = new Map();
  private startTime: number = 0;

  // 流式响应防抖缓冲
  private streamBuffer: string = '';
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly STREAM_DEBOUNCE_MS = 100;

  // 验证器
  private verifier: Verifier;
  private verificationRetries = 0;
  private zeroToolCallRetries = 0;
  private static readonly MAX_VERIFICATION_RETRIES = 3;

  // 进度回调
  private onProgress?: (progress: AgentProgress) => void;

  // 配置
  static readonly MAX_ITERATIONS = 20;
  static readonly MAX_DURATION_MS = 420000; // 7分钟（硬超时上限）
  static readonly DURATION_WARN_LEVEL1 = 180000; // 3分钟：首次提醒
  static readonly DURATION_WARN_LEVEL2 = 300000; // 5分钟：再次提醒
  // Reserved for Phase 3 tool execution timeout (mark as used)
  static readonly TOOL_TIMEOUT_MS = 30000;

  // 工具调用去重（按工具类型差异化阈值）
  private recentToolCalls: Array<{name: string; argsKey: string; timestamp: number}> = [];
  private static readonly DEDUP_WINDOW_MS = 60000; // 60秒去重窗口
  private static readonly TOOL_DEDUP_LIMITS: Record<string, number> = {
    'execute_sql': 5,        // SQL查询型：相同SQL 5次以内合理（不同SQL不会命中去重）
    'lookup_sql_schema': 4,  // 探索型：反复查看表结构4次以内合理
  };
  private static readonly DEFAULT_DEDUP_LIMIT = 3; // 其他工具默认阈值

  // 取消处理回调
  private unsubscribeStreamHandler: (() => void) | null = null;
  private unsubscribeWsMessage: (() => void) | null = null;

  // 流代次（防止旧流的残留回调影响新流）
  private streamGeneration = 0;

  // 超时提醒标志（防止同一阈值重复提醒）
  private durationWarnLevel1Fired = false;
  private durationWarnLevel2Fired = false;

  // 计划提交后等待旧流结束的标志
  // true: PLAN_SUBMITTED 已触发但旧流 LLM_DONE 未到达，应忽略旧流 DONE
  private waitingForPlanStreamDone = false;

  // 计划验证的软性警告，在下一次 sendToLLM 时注入系统提示引导 LLM 补全
  private planSoftWarnings: string[] = [];

  constructor(
    trace: Trace,
    store: Store<OpenPerfettoState>,
    options?: AgentLoopOptions,
  ) {
    this.trace = trace;
    this.store = store;
    this.onProgress = options?.onProgress;

    // 初始化组件
    this.contextManager = new ContextManager(trace);
    this.planningGate = new PlanningGate();
    this.sceneClassifier = new SceneClassifier();
    this.artifactStore = new ArtifactStore();
    this.wsClient = WebSocketClient.getInstance();
    this.streamHandler = new LLMStreamHandler();

    // 初始化 Tool Registry 并注册所有 Tools
    this.toolRegistry = new ToolRegistry(trace, this.artifactStore);
    this.toolRegistry.registerAll(createAllTools(trace, this.artifactStore, store));

    // 初始化验证器
    this.verifier = new Verifier();

    // 设置流式处理回调
    this.setupStreamHandlers();
  }

  /**
   * 获取当前状态
   */
  getState(): AgentLoopState {
    return this.state;
  }

  /**
   * 获取状态标签
   */
  getStateLabel(): string {
    return STATE_LABELS[this.state];
  }

  /**
   * 获取 ArtifactStore 实例
   */
  getArtifactStore(): ArtifactStore {
    return this.artifactStore;
  }

  /**
   * 发送用户消息，启动分析流程
   */
  async sendMessage(userMessage: string): Promise<void> {
    // 从终态自动恢复
    if (
      this.state === AgentLoopState.ERROR ||
      this.state === AgentLoopState.CANCELLED ||
      this.state === AgentLoopState.COMPLETE
    ) {
      opLogger.info('[AgentLoop] Auto-resetting from terminal state', {from: this.state});
      this.reset();
    }

    if (this.state !== AgentLoopState.IDLE) {
      opLogger.warn('[AgentLoop] Cannot send message in non-IDLE state', {state: this.state});
      throw new Error(`Cannot send message in state: ${this.state}`);
    }

    this.startTime = Date.now();
    this.toolCallCount = 0;

    opLogger.notice('[AgentLoop] === User message received ===', {
      message: userMessage.substring(0, 100),
      messageLength: userMessage.length,
    });

    // 创建或更新会话
    this.ensureSession();

    // 添加用户消息
    this.addMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // 触发状态转换
    await this.transition({type: 'USER_MESSAGE', message: userMessage});
  }

  /**
   * 取消当前分析
   */
  cancel(): void {
    if (
      this.state !== AgentLoopState.IDLE &&
      this.state !== AgentLoopState.COMPLETE &&
      this.state !== AgentLoopState.CANCELLED &&
      this.state !== AgentLoopState.ERROR
    ) {
      this.streamHandler.stopStream();
      this.flushStreamBuffer();
      this.state = AgentLoopState.CANCELLED;
      this.updateProgress('已取消');
      this.addMessage({
        id: `system_${Date.now()}`,
        role: 'system',
        content: '分析已被用户取消',
        timestamp: Date.now(),
      });
      m.redraw();
    }
  }

  /**
   * 重置到空闲状态
   */
  reset(): void {
    this.state = AgentLoopState.IDLE;
    this.toolCallCount = 0;
    this.verificationRetries = 0;
    this.currentPlan = null;
    this.pendingToolCalls.clear();
    this.recentToolCalls = [];
    this.streamBuffer = '';
    this.durationWarnLevel1Fired = false;
    this.durationWarnLevel2Fired = false;
    this.waitingForPlanStreamDone = false;
    this.planSoftWarnings = [];
    this.zeroToolCallRetries = 0;
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    this.flushStreamBuffer();
    if (this.unsubscribeStreamHandler) {
      this.unsubscribeStreamHandler();
    }
    if (this.unsubscribeWsMessage) {
      this.unsubscribeWsMessage();
    }
  }

  /**
   * 状态转换处理
   */
  private async transition(event: AgentLoopEvent): Promise<void> {
    // 检查超时和迭代限制
    if (this.checkLimits()) {
      return;
    }

    // 统一处理 ERROR 事件：任何非终态状态收到错误都切换到 ERROR 状态
    // 防止状态卡死（如 AWAITING_LLM 收到后端错误后无处理分支导致永久卡住）
    if (event.type === 'ERROR') {
      const errorMsg = event.error || 'Unknown error';
      opLogger.error('[AgentLoop] ERROR event received, transitioning to ERROR state', {
        currentState: this.state,
        error: errorMsg,
      });
      this.streamHandler.stopStream();
      this.flushStreamBuffer();
      this.state = AgentLoopState.ERROR;
      this.addMessage({
        id: `error_${Date.now()}`,
        role: 'system',
        content: `分析错误: ${errorMsg}`,
        timestamp: Date.now(),
      });
      this.updateProgress(`错误: ${errorMsg}`);
      m.redraw();
      return;
    }

    opLogger.debug(`State transition: ${this.state} ← ${event.type}`);
    try {
      switch (this.state) {
        case AgentLoopState.IDLE:
          await this.handleIdleState(event);
          break;
        case AgentLoopState.CLASSIFYING:
          await this.handleClassifyingState(event);
          break;
        case AgentLoopState.BUILDING_CONTEXT:
          await this.handleBuildingContextState(event);
          break;
        case AgentLoopState.AWAITING_PLAN:
          await this.handleAwaitingPlanState(event);
          break;
        case AgentLoopState.AWAITING_LLM:
          await this.handleAwaitingLLMState(event);
          break;
        case AgentLoopState.EXECUTING_TOOL:
          await this.handleExecutingToolState(event);
          break;
        case AgentLoopState.VERIFYING:
          await this.handleVerifyingState(event);
          break;
        case AgentLoopState.COMPLETE:
        case AgentLoopState.ERROR:
        case AgentLoopState.CANCELLED:
          // 终态，不处理事件
          break;
      }
    } catch (error) {
      opLogger.error('State transition error:', error);
      this.state = AgentLoopState.ERROR;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.addMessage({
        id: `error_${Date.now()}`,
        role: 'system',
        content: `分析错误: ${errorMsg}`,
        timestamp: Date.now(),
      });
      this.updateProgress(`错误: ${errorMsg}`);
      m.redraw();
    }
  }

  private async handleIdleState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'USER_MESSAGE') return;

    opLogger.notice('[AgentLoop] State: IDLE → CLASSIFYING', {message: event.message?.substring(0, 80)});
    this.state = AgentLoopState.CLASSIFYING;
    this.updateProgress('场景分类中...');
    m.redraw();

    // 执行场景分类
    const sceneType = await this.sceneClassifier.classify(
      event.message,
      this.trace,
    );
    opLogger.notice('[AgentLoop] Scene classified', {sceneType});

    await this.transition({type: 'SCENE_CLASSIFIED', scene: sceneType});
  }

  private async handleClassifyingState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'SCENE_CLASSIFIED') return;

    this.currentSceneType = event.scene;
    opLogger.notice('[AgentLoop] State: CLASSIFYING → BUILDING_CONTEXT', {scene: event.scene});
    this.state = AgentLoopState.BUILDING_CONTEXT;
    this.updateProgress(`构建 ${event.scene} 场景上下文...`);
    m.redraw();

    // 让出 UI 线程
    await scheduler.yield();

    // 构建上下文
    await this.contextManager.buildContext(event.scene);

    await scheduler.yield();
    await this.transition({type: 'CONTEXT_BUILT'});
  }

  private async handleBuildingContextState(
    event: AgentLoopEvent,
  ): Promise<void> {
    if (event.type !== 'CONTEXT_BUILT') return;

    opLogger.notice('[AgentLoop] State: BUILDING_CONTEXT → AWAITING_PLAN');
    this.state = AgentLoopState.AWAITING_PLAN;
    this.updateProgress('等待分析计划...');
    m.redraw();

    // 更新会话的场景类型
    this.store.edit((draft) => {
      if (draft.currentSession) {
        draft.currentSession.sceneType = this.currentSceneType;
      }
    });

    // 发送到 LLM，要求提交分析计划
    await this.sendToLLM(true);
  }

  private async handleAwaitingPlanState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'PLAN_SUBMITTED':
        // 先刷新流式缓冲区，确保 AI 文本在系统消息之前渲染到 UI
        // 避免双重防抖（LLMStreamHandler 100ms + AgentLoop 100ms）导致系统消息插入 AI 文本中间
        this.flushStreamBuffer();

        this.currentPlan = event.plan;
        opLogger.notice('[AgentLoop] Plan submitted', {
          phaseCount: event.plan.phases.length,
          phases: event.plan.phases.map((p) => p.name),
          sceneType: event.plan.sceneType,
        });
        // 验证计划
        const validation = this.planningGate.validatePlan(event.plan);
        // 只有硬性问题（结构缺陷）才插入系统消息，软性警告仅日志记录
        if (validation.hardIssues.length > 0) {
          opLogger.warn('[AgentLoop] Plan validation hard issues', {issues: validation.hardIssues});
          this.addMessage({
            id: `system_${Date.now()}`,
            role: 'system',
            content: `计划验证问题: ${validation.hardIssues.join('; ')}`,
            timestamp: Date.now(),
          });
        }
        if (validation.softWarnings.length > 0) {
          opLogger.info('[AgentLoop] Plan validation soft warnings', {warnings: validation.softWarnings});
          // 存储软性警告，在下一次 sendToLLM 时注入系统提示引导 LLM 补全
          // 不以系统消息形式插入对话，避免打断 AI 输出
          this.planSoftWarnings = validation.softWarnings;
        }

        // 更新会话计划
        this.store.edit((draft) => {
          if (draft.currentSession) {
            draft.currentSession.plan = event.plan;
          }
        });

        // 注意：不在这里调用 sendToLLM(false)！
        // 因为此时当前 LLM 流的 done 消息可能还没到达。
        // 设置标志，等 LLM_DONE 事件到达后再发起新请求，避免旧流的 done 被误判为新流的完成。
        this.waitingForPlanStreamDone = true;
        this.updateProgress('计划已提交，等待当前流结束...');
        m.redraw();

        opLogger.notice('[AgentLoop] State: AWAITING_PLAN → AWAITING_PLAN (waiting for LLM_DONE before next request)');
        break;

      case 'LLM_TEXT_DELTA':
        this.handleStreamChunk(event.text);
        break;

      case 'LLM_TOOL_USE':
        if (event.toolCall.name === 'submit_plan') {
          // 刷新流式缓冲区，确保 AI 文本在工具调用消息之前渲染
          this.flushStreamBuffer();

          // 添加 tool_call 消息（UI 显示 + LLM 协议必需）
          this.addMessage({
            id: `tool_call_${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            toolCall: event.toolCall,
          });

          // 构建分析计划
          const planData = event.toolCall.arguments as {
            phases?: Array<{
              id: string;
              name: string;
              description?: string;
              requiredTools?: string[];
              expectedOutputs?: string[];
            }>;
            successCriteria?: string[];
          };
          // 优先使用 LLM 识别的场景类型（语义理解更准确），
          // 兜底使用前端关键词分类的结果
          const llmSceneType = (event.toolCall.arguments as {sceneType?: string}).sceneType as SceneType | undefined;
          const effectiveSceneType = llmSceneType || this.currentSceneType;
          if (llmSceneType && llmSceneType !== this.currentSceneType) {
            opLogger.notice('[AgentLoop] LLM overrides scene classification', {
              frontendScene: this.currentSceneType,
              llmScene: llmSceneType,
              reason: 'LLM semantic understanding overrides frontend keyword matching',
            });
            this.currentSceneType = effectiveSceneType;
          }
          const plan: AnalysisPlan = {
            id: `plan_${Date.now()}`,
            sceneType: effectiveSceneType,
            phases: (planData.phases ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description ?? '',
              requiredTools: p.requiredTools ?? [],
              expectedOutputs: p.expectedOutputs ?? [],
              completed: false,
            })),
            successCriteria: planData.successCriteria ?? [],
            estimatedSteps: planData.phases?.length ?? 3,
            submittedAt: Date.now(),
          };
          await this.transition({type: 'PLAN_SUBMITTED', plan});

          // 添加 tool_result 消息（LLM 协议必需）
          // 让 LLM 知道计划已被接受，不需要再调用 submit_plan
          this.addMessage({
            id: `tool_result_${Date.now()}`,
            role: 'tool',
            content: `计划已接受（ID: ${plan.id}，${plan.phases.length} 个阶段）。请按照计划执行分析，使用 execute_sql、invoke_skill 等工具。`,
            timestamp: Date.now(),
            toolResult: {
              toolCallId: event.toolCall.id,
              success: true,
              data: {
                planId: plan.id,
                phaseCount: plan.phases.length,
                phases: plan.phases.map((p) => p.name),
              },
            },
          });
        } else {
          // AWAITING_PLAN 阶段不允许执行非 submit_plan 的工具调用
          // 因为 LLM 流的 tool_use 后面紧跟 done，工具结果无法在同一轮返回给 LLM
          // 添加系统消息引导 LLM 先提交分析计划
          opLogger.warn('[AgentLoop] Tool call rejected in AWAITING_PLAN state', {
            toolName: event.toolCall.name,
            hint: 'LLM should submit_plan first',
          });
          this.addMessage({
            id: `system_${Date.now()}`,
            role: 'system',
            content: this.currentPlan
              ? `分析计划已提交，工具 ${event.toolCall.name} 将在后续分析阶段使用。请等待当前流完成后再执行其他工具。`
              : `当前阶段需要先提交分析计划（使用 submit_plan 工具），之后才能使用 ${event.toolCall.name} 等工具。`,
            timestamp: Date.now(),
          });
        }
        break;

      case 'LLM_DONE':
        // 如果没有提交计划，使用模板
        if (!this.currentPlan) {
          const templatePlan =
            this.planningGate.createPlanTemplate(this.currentSceneType);
          await this.transition({type: 'PLAN_SUBMITTED', plan: templatePlan});
          // 如果模板计划也设置了 waitingForPlanStreamDone，等待下一次 LLM_DONE
          // 但模板路径不会触发 waitingForPlanStreamDone（因为没有提前收到 submit_plan），所以这里直接继续
          if (!this.waitingForPlanStreamDone) {
            // 模板路径：计划刚创建，直接发起新请求
            this.state = AgentLoopState.AWAITING_LLM;
            this.updateProgress('执行分析计划...');
            m.redraw();
            opLogger.notice('[AgentLoop] Template plan created, sending next LLM request');
            await this.sendToLLM(false);
          }
          // 如果 waitingForPlanStreamDone 为 true，下面的逻辑会处理
        }
        // 计划已提交且当前流已结束，发起新的 LLM 请求执行分析
        if (this.waitingForPlanStreamDone && this.currentPlan) {
          this.waitingForPlanStreamDone = false;
          this.state = AgentLoopState.AWAITING_LLM;
          this.updateProgress('执行分析计划...');
          m.redraw();
          opLogger.notice('[AgentLoop] Plan stream done, sending next LLM request');
          await this.sendToLLM(false);
        }
        break;
    }
  }

  private async handleAwaitingLLMState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'LLM_TEXT_DELTA':
        opLogger.debug('[AgentLoop] LLM text delta received', {length: event.text.length, preview: event.text.substring(0, 50)});
        this.handleStreamChunk(event.text);
        break;

      case 'LLM_TOOL_USE':
        // 如果计划已存在，忽略 LLM 重复调用的 submit_plan
        // 场景：第1次 LLM 流已提交计划，第2次 LLM 流中 LLM 又尝试提交计划
        if (event.toolCall.name === 'submit_plan') {
          if (this.currentPlan) {
            opLogger.warn('[AgentLoop] submit_plan called again but plan already exists, skipping (fallback)', {
              existingPlanId: this.currentPlan.id,
              toolCallId: event.toolCall.id,
            });
            // 刷新当前流式文本缓冲，确保之前的 AI 文本先渲染
            this.flushStreamBuffer();
            // 添加工具调用消息（UI 显示）
            this.addMessage({
              id: `tool_call_${Date.now()}`,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              toolCall: event.toolCall,
            });
            // 添加 tool_result 消息（LLM 协议必需，告知计划已存在）
            this.addMessage({
              id: `tool_result_${Date.now()}`,
              role: 'tool',
              content: `计划已存在（ID: ${this.currentPlan.id}），无需重复提交。请使用 execute_sql、invoke_skill 等工具开始分析。`,
              timestamp: Date.now(),
              toolResult: {
                toolCallId: event.toolCall.id,
                success: true,
                data: {note: 'Plan already exists. Proceed with analysis tools.'},
              },
            });
            m.redraw();
            // 注意：不增加 toolCallCount，不改变状态
            // submit_plan 不是分析工具调用，此处重复调用不应计数
          } else {
            // 计划不存在（理论上不应该发生），正常处理
            this.state = AgentLoopState.EXECUTING_TOOL;
            this.pendingToolCalls.set(event.toolCall.id, event.toolCall);
            this.updateProgress(`执行工具: ${event.toolCall.name}`);
            m.redraw();
            opLogger.notice('[AgentLoop] State: AWAITING_LLM → EXECUTING_TOOL', {
              toolName: event.toolCall.name,
              toolCallId: event.toolCall.id,
              args: event.toolCall.arguments,
            });
            await this.executeToolCall(event.toolCall);
          }
        } else {
          // 刷新流式缓冲区，确保 AI 文本在工具调用消息之前渲染到 UI
          // 防止双重防抖（LLMStreamHandler 100ms + AgentLoop 100ms）导致工具消息插入文本中间
          this.flushStreamBuffer();

          this.state = AgentLoopState.EXECUTING_TOOL;
          this.pendingToolCalls.set(event.toolCall.id, event.toolCall);
          this.updateProgress(`执行工具: ${event.toolCall.name}`);
          m.redraw();
          opLogger.notice('[AgentLoop] State: AWAITING_LLM → EXECUTING_TOOL', {
            toolName: event.toolCall.name,
            toolCallId: event.toolCall.id,
            args: event.toolCall.arguments,
          });
          await this.executeToolCall(event.toolCall);
        }
        break;

      case 'LLM_DONE':
        this.finalizeStreamingMessage();
        opLogger.notice('[AgentLoop] LLM_DONE received', {
          toolCallCount: this.toolCallCount,
          usage: event.usage,
        });
        // 记录 token 使用量
        if (event.usage) {
          opLogger.info('[AgentLoop] Token usage', event.usage);
          this.store.edit((draft) => {
            if (draft.currentSession) {
              draft.currentSession.totalInputTokens =
                (draft.currentSession.totalInputTokens || 0) + (event.usage?.inputTokens || 0);
              draft.currentSession.totalOutputTokens =
                (draft.currentSession.totalOutputTokens || 0) + (event.usage?.outputTokens || 0);
            }
          });
        }

        // 零工具调用：LLM 只输出了文本但没有调用分析工具，继续请求
        // 保护：限制连续零工具调用的重试次数，避免无限循环
        if (this.toolCallCount === 0) {
          this.zeroToolCallRetries++;
          if (this.zeroToolCallRetries >= 3) {
            opLogger.warn('[AgentLoop] Max zero-tool-call retries reached, completing analysis');
            this.state = AgentLoopState.COMPLETE;
            this.updateProgress('分析完成');
            this.finalizeAnalysis();
            m.redraw();
            break;
          }
          opLogger.notice('[AgentLoop] No tool calls yet, sending next LLM request to continue analysis', {
            zeroToolCallRetries: this.zeroToolCallRetries,
          });
          this.updateProgress('继续分析...');
          m.redraw();
          await this.sendToLLM(false);
          break;
        }
        // 有实际工具调用后重置计数器
        this.zeroToolCallRetries = 0;

        // 统一进入验证流程
        // 之前 toolCallCount < 2 跳过验证直接完成的逻辑已移除：
        // 工具调用不足时不应直接完成，验证器会根据实际情况判断分析充分性
        // L2 验证中 progressRatio < 阈值时会降低要求，不会误判
        this.state = AgentLoopState.VERIFYING;
        this.updateProgress('验证结果...');
        m.redraw();
        await this.runVerification();
        break;
    }
  }

  private async handleExecutingToolState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'TOOL_RESULT') return;

    // 移除已完成的工具调用
    this.pendingToolCalls.delete(event.result.toolCallId);

    // 添加工具结果消息
    this.addMessage({
      id: `tool_result_${Date.now()}`,
      role: 'tool',
      content: event.result.success
        ? `工具执行成功`
        : `工具错误: ${event.result.error}`,
      timestamp: Date.now(),
      toolResult: event.result,
    });

    opLogger.info('[AgentLoop] Tool result received', {
      toolCallId: event.result.toolCallId,
      success: event.result.success,
      hasData: !!(event.result as any).data,
      error: event.result.error || undefined,
    });

    // 检查工具调用次数限制
    this.toolCallCount++;
    if (this.toolCallCount >= AgentLoop.MAX_ITERATIONS) {
      this.addMessage({
        id: `warning_${Date.now()}`,
        role: 'system',
        content: `已达到最大工具调用次数 (${AgentLoop.MAX_ITERATIONS})`,
        timestamp: Date.now(),
      });
    }

    m.redraw();

    // 如果没有待处理的工具调用，返回 AWAITING_LLM
    if (this.pendingToolCalls.size === 0) {
      this.state = AgentLoopState.AWAITING_LLM;
      this.updateProgress('等待AI响应...');
      m.redraw();

      opLogger.notice('[AgentLoop] State: EXECUTING_TOOL → AWAITING_LLM (all tools done, continuing)');
      // 发送工具结果，继续对话
      await this.sendToLLM(false);
    }
  }

  private async handleVerifyingState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'VERIFICATION_PASSED':
        this.state = AgentLoopState.COMPLETE;
        this.updateProgress('分析完成');
        this.addMessage({
          id: `verify_pass_${Date.now()}`,
          role: 'system',
          content: `验证通过 (${event.result.l1Issues.length} L1, ${event.result.l2Issues.length} L2)`,
          timestamp: Date.now(),
        });
        this.finalizeAnalysis();
        m.redraw();
        break;

      case 'VERIFICATION_FAILED':
        this.verificationRetries++;
        if (this.verificationRetries >= AgentLoop.MAX_VERIFICATION_RETRIES) {
          // 超过重试次数，强制完成并警告
          this.state = AgentLoopState.COMPLETE;
          this.updateProgress('分析完成（验证警告）');
          this.addMessage({
            id: `verify_warn_${Date.now()}`,
            role: 'system',
            content: `验证未通过（已达最大重试次数 ${AgentLoop.MAX_VERIFICATION_RETRIES}）:\n` +
              event.issues.map((i) => `  - ${i}`).join('\n'),
            timestamp: Date.now(),
          });
          this.finalizeAnalysis();
        } else {
          // 防御性 flush：确保流式文本在系统消息之前完成渲染
          this.flushStreamBuffer();
          // 添加验证问题消息，返回 AWAITING_LLM 重新请求
          this.addMessage({
            id: `verify_fail_${Date.now()}`,
            role: 'system',
            content:
              `验证发现问题（第 ${this.verificationRetries}/${AgentLoop.MAX_VERIFICATION_RETRIES} 次重试）:\n` +
              event.issues.map((i) => `  - ${i}`).join('\n') +
              '\n\n请执行以下操作来修正:' +
              '\n1. 不要重复调用已执行过的工具' +
              '\n2. 调用计划中尚未执行的工具 (如 execute_sql, invoke_skill)' +
              '\n3. 基于工具返回的数据进行分析' +
              '\n4. 确保所有结论都有工具查询结果支持',
            timestamp: Date.now(),
          });
          this.state = AgentLoopState.AWAITING_LLM;
          this.updateProgress('等待AI修正响应...');
          await this.sendToLLM(false);
        }
        m.redraw();
        break;
    }
  }

  /**
   * 执行工具调用
   * 通过 ToolRegistry 执行实际的 Tool 实现
   */
  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    // 去重检测：防止 LLM 以相同参数重复调用同一工具
    const argsKey = JSON.stringify(toolCall.arguments || {});
    const recentCalls = this.recentToolCalls.filter(
      (c) =>
        c.name === toolCall.name &&
        c.argsKey === argsKey &&
        Date.now() - c.timestamp < AgentLoop.DEDUP_WINDOW_MS,
    );

    const dedupLimit = AgentLoop.TOOL_DEDUP_LIMITS[toolCall.name] ?? AgentLoop.DEFAULT_DEDUP_LIMIT;
    if (recentCalls.length >= dedupLimit) {
      opLogger.warn('Duplicate tool call detected, skipping', {
        toolName: toolCall.name,
        callCount: recentCalls.length,
        dedupLimit,
      });

      // 注入系统消息提示 LLM 不要重复
      this.addMessage({
        id: `dedup_${Date.now()}`,
        role: 'system',
        content:
          `你已经连续调用 ${toolCall.name} ${recentCalls.length} 次且参数相同（该工具上限${dedupLimit}次）。` +
          `请不要再重复调用同一工具，改用其他工具继续分析。` +
          `建议下一步: 执行计划中尚未调用的工具 (如 execute_sql, invoke_skill 等)。`,
        timestamp: Date.now(),
      });

      // 返回“成功但提示”的结果，避免 LLM 因失败而重试
      await this.transition({
        type: 'TOOL_RESULT',
        result: {
          toolCallId: toolCall.id,
          success: true,
          data: {note: 'Skipped duplicate call. Please proceed with other tools.'},
        },
      });
      return;
    }

    // 记录本次调用
    this.recentToolCalls.push({
      name: toolCall.name,
      argsKey,
      timestamp: Date.now(),
    });

    // 清理过期记录
    const cutoff = Date.now() - AgentLoop.DEDUP_WINDOW_MS;
    this.recentToolCalls = this.recentToolCalls.filter((c) => c.timestamp > cutoff);

    // 添加工具调用消息
    this.addMessage({
      id: `tool_call_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCall,
    });

    m.redraw();

    try {
      // 通过 ToolRegistry 执行 Tool
      const result = await this.toolRegistry.execute(toolCall);
      opLogger.info('[AgentLoop] Tool executed', {
        toolName: toolCall.name,
        success: result.success,
        hasData: !!(result as any).data,
        error: result.error || undefined,
      });
      await this.transition({type: 'TOOL_RESULT', result});
    } catch (error) {
      await this.transition({
        type: 'TOOL_RESULT',
        result: {
          toolCallId: toolCall.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * 获取 ToolRegistry 实例
   * 用于外部访问 Tool 定义等
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 生成 UUID
   * 使用 crypto.randomUUID() 或回退到简单实现
   */
  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // 回退实现：简单的 UUID v4 格式
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 发送消息到 LLM（通过 WebSocket）
   */
  private async sendToLLM(requirePlan: boolean): Promise<void> {
    let systemPrompt = this.contextManager.getSystemPrompt();
    const messages = this.getSessionMessages();

    // 计划已提交后动态切换系统提示，告知 LLM 执行分析而非提交计划
    if (!requirePlan && this.currentPlan) {
      systemPrompt += `\n\n[计划状态]\n分析计划已提交并被接受（ID: ${this.currentPlan.id}，${this.currentPlan.phases.length} 个阶段）。\n请直接按照计划执行分析，不要再调用 submit_plan。\n使用 execute_sql、invoke_skill 等工具开始各阶段的分析。`;
    }

    // 将计划验证的软性警告注入系统提示，引导 LLM 自行补全
    // 不以对话系统消息形式展示，避免打断 AI 输出
    if (this.planSoftWarnings.length > 0) {
      const warningHints = this.planSoftWarnings
        .map((w, i) => `${i + 1}. ${w}`)
        .join('\n');
      systemPrompt += `\n\n[计划改进建议]\n你的分析计划有以下可改进之处，请在后续分析中注意：\n${warningHints}`;
      // 注入后清空，避免重复注入
      this.planSoftWarnings = [];
    }

    opLogger.notice('[AgentLoop] >>> Sending to LLM', {
      requirePlan,
      messageCount: messages.length,
      scene: this.currentSceneType,
      state: this.state,
      toolCallCount: this.toolCallCount,
      systemPromptLength: systemPrompt.length,
    });

    // 获取 agentId（使用 session ID 或生成 UUID）
    const connState = this.store.state.connectionState;
    const agentId =
      connState.status === 'connected' && connState.agentId
        ? connState.agentId
        : this.generateUUID();

    // 每次请求生成新的 traceId
    const traceId = this.generateUUID();

    // 构建符合后端 ChatRequestSchema 的 payload
    const payload = {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCall: m.toolCall,
        toolResult: m.toolResult,
      })),
      tools: requirePlan
        ? this.toolRegistry.getToolDefinitions().filter((t) => t.name === 'submit_plan')
        : this.toolRegistry.getToolDefinitions().filter((t) => t.name !== 'submit_plan'),
      systemPrompt,
      stream: true,
      requirePlan,
    };

    // 启动流式处理：先停止旧流并递增 generation，防止旧流残留回调干扰
    this.streamHandler.stopStream();
    this.streamGeneration++;
    const currentGeneration = this.streamGeneration;

    this.streamHandler.startStream(agentId, {
      onTextDelta: (text) => {
        if (this.streamGeneration !== currentGeneration) return; // 忽略旧流回调
        opLogger.debug('[AgentLoop] <<< onTextDelta callback', {length: text.length});
        this.transition({type: 'LLM_TEXT_DELTA', text});
      },
      onToolUse: (toolCall) => {
        if (this.streamGeneration !== currentGeneration) return; // 忽略旧流回调
        opLogger.notice('[AgentLoop] <<< onToolUse callback', {toolName: toolCall.name, toolCallId: toolCall.id});
        this.transition({type: 'LLM_TOOL_USE', toolCall});
      },
      onDone: (usage) => {
        if (this.streamGeneration !== currentGeneration) { // 忽略旧流回调
          opLogger.notice('[AgentLoop] <<< Stale onDone ignored', {generation: currentGeneration, current: this.streamGeneration});
          return;
        }
        opLogger.notice('[AgentLoop] <<< onDone callback', {usage});
        this.transition({type: 'LLM_DONE', usage});
      },
      onError: (error) => {
        if (this.streamGeneration !== currentGeneration) return; // 忽略旧流回调
        opLogger.error('[AgentLoop] <<< onError callback', error);
        this.transition({type: 'ERROR', error});
      },
    });

    // 发送请求：符合后端 ChatRequestSchema 格式
    opLogger.notice('[AgentLoop] >>> WebSocket send (chat)', {
      agentId,
      traceId,
      messageType: 'chat',
      toolCount: this.toolRegistry.getToolDefinitions().length,
    });
    this.wsClient.send({
      type: 'chat',
      agentId,
      traceId,
      payload,
    } as import('../services/websocket_client').WebSocketMessage);
  }

  /**
   * 运行验证
   * 执行三层验证系统（L1 启发式 + L2 计划遵从 + L3 预留）
   */
  private async runVerification(): Promise<void> {
    await scheduler.yield();

    try {
      const messages = this.getSessionMessages();
      const artifacts = this.artifactStore.getAll();

      // 计算分析进度比例，用于L2验证的进度感知
      const completedPhases = this.currentPlan
        ? this.currentPlan.phases.filter((p) => p.completed).length
        : 0;
      const totalPhases = this.currentPlan
        ? this.currentPlan.phases.length
        : 1;
      const progressRatio = totalPhases > 0 ? completedPhases / totalPhases : 0;

      const result = await this.verifier.runFullVerification(
        messages,
        artifacts,
        this.currentPlan,
        progressRatio,
      );

      opLogger.notice('[AgentLoop] Verification result', {
        passed: result.passed,
        l1Issues: result.l1Issues.length,
        l2Issues: result.l2Issues.length,
        softWarnings: result.softWarnings.length,
        progressRatio,
      });

      if (result.passed) {
        await this.transition({type: 'VERIFICATION_PASSED', result});
      } else {
        const allIssues = [...result.l1Issues, ...result.l2Issues];
        await this.transition({
          type: 'VERIFICATION_FAILED',
          issues: allIssues,
          result,
        });
      }
    } catch (error) {
      // 验证出错不应阻塞流程，视为通过
      opLogger.warn('Verification failed:', error);
      await this.transition({
        type: 'VERIFICATION_PASSED',
        result: {
          passed: true,
          l1Issues: [],
          l2Issues: [],
          softWarnings: [],
          l3Result: null,
          totalIssues: 0,
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * 最终化分析
   */
  private finalizeAnalysis(): void {
    opLogger.notice('[AgentLoop] === Analysis completed ===', {
      sceneType: this.currentSceneType,
      toolCallCount: this.toolCallCount,
      verificationRetries: this.verificationRetries,
      artifactCount: this.artifactStore.size(),
      durationMs: Date.now() - this.startTime,
    });

    // 标记最后一条流式消息为完成
    this.finalizeStreamingMessage();

    // 重置状态以准备下一次分析
    this.state = AgentLoopState.IDLE;
    this.toolCallCount = 0;
    this.verificationRetries = 0;
    this.currentPlan = null;
    this.pendingToolCalls.clear();
    this.durationWarnLevel1Fired = false;
    this.durationWarnLevel2Fired = false;
    this.waitingForPlanStreamDone = false;
    this.planSoftWarnings = [];
    this.zeroToolCallRetries = 0;
  }

  /**
   * 检查限制（超时和迭代次数）
   * 超时策略：3分钟提醒 → 5分钟再提醒 → 7分钟强管控
   */
  private checkLimits(): boolean {
    const elapsed = Date.now() - this.startTime;

    // Level 1: 3分钟首次提醒
    if (elapsed > AgentLoop.DURATION_WARN_LEVEL1 && !this.durationWarnLevel1Fired) {
      this.durationWarnLevel1Fired = true;
      this.flushStreamBuffer();
      const seconds = Math.round(elapsed / 1000);
      this.addMessage({
        id: `duration_warn1_${Date.now()}`,
        role: 'system',
        content: `当前分析已执行 ${seconds} 秒，耗时较长，请关注当前对话进展。`,
        timestamp: Date.now(),
      });
      opLogger.notice('[AgentLoop] Duration warning level 1', {elapsedMs: elapsed});
      m.redraw();
    }

    // Level 2: 5分钟再次提醒
    if (elapsed > AgentLoop.DURATION_WARN_LEVEL2 && !this.durationWarnLevel2Fired) {
      this.durationWarnLevel2Fired = true;
      this.flushStreamBuffer();
      const seconds = Math.round(elapsed / 1000);
      this.addMessage({
        id: `duration_warn2_${Date.now()}`,
        role: 'system',
        content: `当前分析已执行 ${seconds} 秒，耗时较久，建议检查对话内容是否正常，或考虑取消重新提问。`,
        timestamp: Date.now(),
      });
      opLogger.notice('[AgentLoop] Duration warning level 2', {elapsedMs: elapsed});
      m.redraw();
    }

    // 硬超时：7分钟强制终止
    if (elapsed > AgentLoop.MAX_DURATION_MS) {
      this.flushStreamBuffer();
      this.state = AgentLoopState.ERROR;
      const seconds = Math.round(elapsed / 1000);
      this.addMessage({
        id: `timeout_${Date.now()}`,
        role: 'system',
        content: `分析超时（已执行 ${seconds} 秒，超过 ${AgentLoop.MAX_DURATION_MS / 1000} 秒上限），已强制终止。`,
        timestamp: Date.now(),
      });
      this.updateProgress('超时');
      opLogger.warn('[AgentLoop] Analysis timed out', {elapsedMs: elapsed});
      m.redraw();
      return true;
    }

    if (this.toolCallCount >= AgentLoop.MAX_ITERATIONS) {
      this.state = AgentLoopState.ERROR;
      this.updateProgress('达到最大迭代次数');
      m.redraw();
      return true;
    }

    return false;
  }

  /**
   * 设置流式处理回调
   */
  private setupStreamHandlers(): void {
    // WebSocket 消息监听由 LLMStreamHandler 处理
    this.unsubscribeWsMessage = this.wsClient.onMessage((message) => {
      this.streamHandler.handleMessage(message);
    });
  }

  /**
   * 流式响应处理（带防抖缓冲）
   */
  private handleStreamChunk(text: string): void {
    this.streamBuffer += text;

    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
    }

    this.streamFlushTimer = setTimeout(() => {
      this.flushStreamBuffer();
    }, AgentLoop.STREAM_DEBOUNCE_MS);
  }

  /**
   * 刷新流式缓冲区到 UI
   */
  private flushStreamBuffer(): void {
    if (this.streamBuffer.length === 0) return;

    const textToFlush = this.streamBuffer;
    this.streamBuffer = '';

    const session = this.store.state.currentSession;
    if (!session) return;

    const messages = session.messages;
    const lastMessage = messages[messages.length - 1];

    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.toolCall) {
      // 追加到现有的assistant消息
      this.store.edit((draft) => {
        if (draft.currentSession) {
          const lastMsg =
            draft.currentSession.messages[
              draft.currentSession.messages.length - 1
            ];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content += textToFlush;
            lastMsg.metadata = {...lastMsg.metadata, isStreaming: true};
          }
        }
      });
    } else {
      // 创建新的assistant消息
      this.addMessage({
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: textToFlush,
        timestamp: Date.now(),
        metadata: {isStreaming: true},
      });
    }

    m.redraw();
  }

  /**
   * 标记流式响应完成
   */
  private finalizeStreamingMessage(): void {
    this.flushStreamBuffer();

    this.store.edit((draft) => {
      if (draft.currentSession) {
        const messages = draft.currentSession.messages;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.metadata = {...lastMessage.metadata, isStreaming: false};
        }
      }
    });
  }

  /**
   * 更新进度状态
   */
  private updateProgress(currentStep: string): void {
    if (this.onProgress) {
      const percentage = this.calculatePercentage();
      this.onProgress({
        state: this.state,
        stateLabel: STATE_LABELS[this.state],
        percentage,
        currentStep,
        elapsedMs: Date.now() - this.startTime,
      });
    }
  }

  /**
   * 计算进度百分比
   */
  private calculatePercentage(): number {
    const statePercentages: Record<AgentLoopState, number> = {
      [AgentLoopState.IDLE]: 0,
      [AgentLoopState.CLASSIFYING]: 10,
      [AgentLoopState.BUILDING_CONTEXT]: 20,
      [AgentLoopState.AWAITING_PLAN]: 30,
      [AgentLoopState.AWAITING_LLM]: 50,
      [AgentLoopState.EXECUTING_TOOL]: 60,
      [AgentLoopState.VERIFYING]: 90,
      [AgentLoopState.COMPLETE]: 100,
      [AgentLoopState.ERROR]: 100,
      [AgentLoopState.CANCELLED]: 100,
    };
    return statePercentages[this.state];
  }

  /**
   * 确保会话存在
   */
  private ensureSession(): void {
    if (!this.store.state.currentSession) {
      const session: AnalysisSession = {
        id: `session_${Date.now()}`,
        startTime: Date.now(),
        sceneType: 'general',
        messages: [],
        artifacts: new Map(),
        plan: null,
        pinnedTracks: [],
      };
      this.store.edit((draft) => {
        draft.currentSession = session;
      });
    }
  }

  /**
   * 添加消息到会话
   */
  private addMessage(message: ChatMessage): void {
    this.store.edit((draft) => {
      if (draft.currentSession) {
        draft.currentSession.messages.push(message);
      }
    });
  }

  /**
   * 获取会话消息
   */
  private getSessionMessages(): ChatMessage[] {
    return this.store.state.currentSession?.messages ?? [];
  }
}
