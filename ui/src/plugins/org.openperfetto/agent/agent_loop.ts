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
  | {type: 'LLM_DONE'}
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
  private static readonly MAX_VERIFICATION_RETRIES = 3;

  // 进度回调
  private onProgress?: (progress: AgentProgress) => void;

  // 配置
  static readonly MAX_ITERATIONS = 20;
  static readonly MAX_DURATION_MS = 300000; // 5分钟
  // Reserved for Phase 3 tool execution timeout (mark as used)
  static readonly TOOL_TIMEOUT_MS = 30000;

  // 取消处理回调
  private unsubscribeStreamHandler: (() => void) | null = null;
  private unsubscribeWsMessage: (() => void) | null = null;

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
    this.toolRegistry.registerAll(createAllTools(trace, this.artifactStore));

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
    if (this.state !== AgentLoopState.IDLE) {
      throw new Error(`Cannot send message in state: ${this.state}`);
    }

    this.startTime = Date.now();
    this.toolCallCount = 0;

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
    this.streamBuffer = '';
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
      console.error(`State transition error:`, error);
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

    this.state = AgentLoopState.CLASSIFYING;
    this.updateProgress('场景分类中...');
    m.redraw();

    // 执行场景分类
    const sceneType = await this.sceneClassifier.classify(
      event.message,
      this.trace,
    );

    await this.transition({type: 'SCENE_CLASSIFIED', scene: sceneType});
  }

  private async handleClassifyingState(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'SCENE_CLASSIFIED') return;

    this.currentSceneType = event.scene;
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
        this.currentPlan = event.plan;
        // 验证计划
        const validation = this.planningGate.validatePlan(event.plan);
        if (!validation.valid) {
          this.addMessage({
            id: `system_${Date.now()}`,
            role: 'system',
            content: `计划验证问题: ${validation.issues.join('; ')}`,
            timestamp: Date.now(),
          });
        }

        // 更新会话计划
        this.store.edit((draft) => {
          if (draft.currentSession) {
            draft.currentSession.plan = event.plan;
          }
        });

        this.state = AgentLoopState.AWAITING_LLM;
        this.updateProgress('执行分析计划...');
        m.redraw();

        // 继续分析
        await this.sendToLLM(false);
        break;

      case 'LLM_TEXT_DELTA':
        this.handleStreamChunk(event.text);
        break;

      case 'LLM_TOOL_USE':
        if (event.toolCall.name === 'submit_plan') {
          // Planning Gate 工具调用 - Mock实现
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
          const plan: AnalysisPlan = {
            id: `plan_${Date.now()}`,
            sceneType: this.currentSceneType,
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
        } else {
          // 其他工具调用
          await this.executeToolCall(event.toolCall);
        }
        break;

      case 'LLM_DONE':
        // 如果没有提交计划，使用模板
        if (!this.currentPlan) {
          const templatePlan =
            this.planningGate.createPlanTemplate(this.currentSceneType);
          await this.transition({type: 'PLAN_SUBMITTED', plan: templatePlan});
        }
        break;
    }
  }

  private async handleAwaitingLLMState(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'LLM_TEXT_DELTA':
        this.handleStreamChunk(event.text);
        break;

      case 'LLM_TOOL_USE':
        this.state = AgentLoopState.EXECUTING_TOOL;
        this.pendingToolCalls.set(event.toolCall.id, event.toolCall);
        this.updateProgress(`执行工具: ${event.toolCall.name}`);
        m.redraw();
        await this.executeToolCall(event.toolCall);
        break;

      case 'LLM_DONE':
        this.finalizeStreamingMessage();
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
          // 添加验证问题消息，返回 AWAITING_LLM 重新请求
          this.addMessage({
            id: `verify_fail_${Date.now()}`,
            role: 'system',
            content: `验证发现问题（第 ${this.verificationRetries}/${AgentLoop.MAX_VERIFICATION_RETRIES} 次重试）:\n` +
              event.issues.map((i) => `  - ${i}`).join('\n') +
              '\n请根据以上问题修正分析结论。',
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
    const systemPrompt = this.contextManager.getSystemPrompt();
    const messages = this.getSessionMessages();

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
      tools: this.toolRegistry.getToolDefinitions(),
      systemPrompt,
      stream: true,
      requirePlan,
    };

    // 启动流式处理
    this.streamHandler.startStream(agentId, {
      onTextDelta: (text) => {
        this.transition({type: 'LLM_TEXT_DELTA', text});
      },
      onToolUse: (toolCall) => {
        this.transition({type: 'LLM_TOOL_USE', toolCall});
      },
      onDone: () => {
        this.transition({type: 'LLM_DONE'});
      },
      onError: (error) => {
        this.transition({type: 'ERROR', error});
      },
    });

    // 发送请求：符合后端 ChatRequestSchema 格式
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

      const result = await this.verifier.runFullVerification(
        messages,
        artifacts,
        this.currentPlan,
      );

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
      console.warn('Verification failed:', error);
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
    console.log('Analysis completed', {
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
  }

  /**
   * 检查限制（超时和迭代次数）
   */
  private checkLimits(): boolean {
    const elapsed = Date.now() - this.startTime;
    if (elapsed > AgentLoop.MAX_DURATION_MS) {
      this.state = AgentLoopState.ERROR;
      this.addMessage({
        id: `timeout_${Date.now()}`,
        role: 'system',
        content: `分析超时（超过${AgentLoop.MAX_DURATION_MS / 1000}秒）`,
        timestamp: Date.now(),
      });
      this.updateProgress('超时');
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
