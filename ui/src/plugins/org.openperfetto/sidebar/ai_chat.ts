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
import {OpenPerfettoState} from '../types/plugin_state';
import {ChatMessage} from '../types/agent';
import {AgentLoop, AgentLoopState} from '../agent/agent_loop';
// t() function will be used when i18n is implemented
import {t as _t} from '../i18n';
import {Icon} from '../../../widgets/icon';
import {opLogger} from '../utils/logger';

/**
 * AIChat 组件属性
 */
export interface AIChatAttrs {
  trace: Trace;
  store: Store<OpenPerfettoState>;
  agentLoop: AgentLoop;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * AIChat Mithril.js ClassComponent
 *
 * 功能：
 * - 消息列表（可滚动，自动滚动到底部）
 * - 输入框（底部固定，支持 Shift+Enter 换行，Enter 发送）
 * - 消息渲染（用户/Assistant/Tool调用/Tool结果）
 * - 流式输出显示
 * - 进度条和状态显示
 * - 取消按钮
 */
export class AIChat implements m.ClassComponent<AIChatAttrs> {
  private inputText: string = '';
  private messagesContainer: HTMLElement | null = null;
  private shouldScrollToBottom: boolean = true;

  oninit(_vnode: m.Vnode<AIChatAttrs>): void {
    // AgentLoop's onProgress is set in the plugin constructor
    // Future: may use vnode.attrs.agentLoop for additional setup
  }

  oncreate(vnode: m.VnodeDOM<AIChatAttrs>): void {
    this.messagesContainer = vnode.dom.querySelector(
      '.ai-chat__messages',
    ) as HTMLElement;
    this.scrollToBottom();
  }

  onupdate(_vnode: m.VnodeDOM<AIChatAttrs>): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
    }
  }

  view({attrs}: m.CVnode<AIChatAttrs>): m.Children {
    const {store, agentLoop, collapsed} = attrs;
    const state = store.state;
    const session = state.currentSession;
    const messages = session?.messages ?? [];
    const agentState = agentLoop.getState();
    const isProcessing =
      agentState !== AgentLoopState.IDLE &&
      agentState !== AgentLoopState.COMPLETE &&
      agentState !== AgentLoopState.ERROR &&
      agentState !== AgentLoopState.CANCELLED;

    // 连接状态检查
    const connectionState = state.connectionState;
    const isConnected = connectionState.status === 'connected';
    const canSend =
      !isProcessing &&
      isConnected &&
      (agentState === AgentLoopState.IDLE ||
        agentState === AgentLoopState.COMPLETE ||
        agentState === AgentLoopState.ERROR ||
        agentState === AgentLoopState.CANCELLED);

    if (collapsed) {
      return null;
    }

    return m('.ai-chat', [
      // 消息列表
      m(
        '.ai-chat__messages',
        {
          onscroll: (e: Event) => this.handleScroll(e),
        },
        [
          // 欢迎消息（无消息时显示）
          messages.length === 0 && this.renderWelcome(state.locale),

          // 消息列表
          messages.map((msg) => this.renderMessage(msg, state.locale)),

          // 加载指示器
          isProcessing && this.renderLoadingIndicator(agentLoop),
        ],
      ),

      // 状态栏（位于输入区上方，方便用户看到 AI 状态）
      this.renderStatusBar(agentLoop, state.locale, store),

      // 输入区域
      this.renderInputArea(agentLoop, state.locale, isProcessing, canSend, store),
    ]);
  }

  /**
   * 渲染状态栏
   */
  private renderStatusBar(
    agentLoop: AgentLoop,
    locale: 'zh' | 'en',
    store?: Store<OpenPerfettoState>,
  ): m.Children {
    const agentState = agentLoop.getState();
    const stateLabel = agentLoop.getStateLabel();

    const isIdle = agentState === AgentLoopState.IDLE;
    const isComplete = agentState === AgentLoopState.COMPLETE;
    const isError = agentState === AgentLoopState.ERROR;
    const isCancelled = agentState === AgentLoopState.CANCELLED;

    let statusClass = 'ai-chat__status--idle';
    if (isComplete) statusClass = 'ai-chat__status--complete';
    else if (isError) statusClass = 'ai-chat__status--error';
    else if (isCancelled) statusClass = 'ai-chat__status--cancelled';
    else if (!isIdle) statusClass = 'ai-chat__status--processing';

    return m('.ai-chat__status-bar', {class: statusClass}, [
      m('.ai-chat__status-text', stateLabel),
      // 处理中显示取消按钮
      !isIdle &&
        !isComplete &&
        !isError &&
        !isCancelled &&
        m(
          '.ai-chat__cancel-btn',
          {
            onclick: () => agentLoop.cancel(),
            title: locale === 'zh' ? '取消分析' : 'Cancel analysis',
          },
          [m(Icon, {icon: 'close'}), locale === 'zh' ? '取消' : 'Cancel'],
        ),
      // 终态显示“新对话”按钮
      (isComplete || isError || isCancelled) &&
        store &&
        m(
          '.ai-chat__new-chat-btn',
          {
            onclick: () => {
              agentLoop.reset();
              store.edit((draft) => {
                draft.currentSession = null;
              });
              m.redraw();
            },
            title: locale === 'zh' ? '开始新对话' : 'New conversation',
          },
          [
            m(Icon, {icon: 'refresh'}),
            locale === 'zh' ? '新对话' : 'New Chat',
          ],
        ),
    ]);
  }


  /**
   * 渲染欢迎消息
   */
  private renderWelcome(locale: 'zh' | 'en'): m.Children {
    return m('.ai-chat__welcome', [
      m(
        '.ai-chat__welcome-text',
        locale === 'zh'
          ? '描述你想分析的性能问题，我将帮助你找到根因。'
          : 'Describe the performance issue you want to analyze, and I will help you find the root cause.',
      ),
      m('.ai-chat__welcome-examples', [
        m(
          '.ai-chat__welcome-examples-title',
          locale === 'zh' ? '示例问题：' : 'Example questions:',
        ),
        m('.ai-chat__welcome-example', [
          m('span', locale === 'zh' ? '• 分析这个 trace 中的滑动卡顿' : '• Analyze the scroll jank in this trace'),
        ]),
        m('.ai-chat__welcome-example', [
          m('span', locale === 'zh' ? '• 查找冷启动慢的原因' : '• Find the cause of slow cold startup'),
        ]),
        m('.ai-chat__welcome-example', [
          m('span', locale === 'zh' ? '• 这个 ANR 是什么导致的' : '• What caused this ANR'),
        ]),
      ]),
    ]);
  }

  /**
   * 渲染单条消息
   */
  private renderMessage(msg: ChatMessage, locale: 'zh' | 'en'): m.Children {
    const roleClass = `ai-chat__message--${msg.role}`;
    const isStreaming = msg.metadata?.isStreaming;

    return m(
      '.ai-chat__message',
      {
        key: msg.id,
        class: roleClass,
      },
      [
        // 消息头
        this.renderMessageHeader(msg, locale),

        // 消息内容
        msg.toolCall
          ? this.renderToolCall(msg, locale)
          : msg.toolResult
            ? this.renderToolResult(msg, locale)
            : this.renderMessageContent(msg.content, isStreaming),
      ],
    );
  }

  /**
   * 渲染消息头
   */
  private renderMessageHeader(
    msg: ChatMessage,
    locale: 'zh' | 'en',
  ): m.Children {
    const roleLabels: Record<string, string> = {
      user: locale === 'zh' ? '用户' : 'User',
      assistant: locale === 'zh' ? 'AI 助手' : 'AI Assistant',
      system: locale === 'zh' ? '系统' : 'System',
      tool: locale === 'zh' ? '工具' : 'Tool',
    };

    const roleIcons: Record<string, string> = {
      user: 'person',
      assistant: 'smart_toy',
      system: 'info',
      tool: 'build',
    };

    return m('.ai-chat__message-header', [
      m(Icon, {icon: roleIcons[msg.role] || 'chat', className: 'ai-chat__message-icon'}),
      m('.ai-chat__message-role', roleLabels[msg.role] || msg.role),
      m(
        '.ai-chat__message-time',
        new Date(msg.timestamp).toLocaleTimeString(),
      ),
    ]);
  }

  /**
   * 渲染消息内容（支持简易 Markdown）
   */
  private renderMessageContent(
    content: string,
    isStreaming?: boolean,
  ): m.Children {
    const html = this.renderMarkdown(content);

    return m('.ai-chat__message-content', [
      m.trust(html),
      isStreaming && m('span.ai-chat__cursor', '▊'),
    ]);
  }

  /**
   * 简易 Markdown 渲染
   * 支持：**bold**, `code`, ```block```, \n
   */
  private renderMarkdown(text: string): string {
    if (!text) return '';

    let html = this.escapeHtml(text);

    // 代码块 ```...```
    html = html.replace(
      /```(\w*)\n?([\s\S]*?)```/g,
      '<pre><code class="language-$1">$2</code></pre>',
    );

    // 行内代码 `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体 **...**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *...*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 换行
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 渲染工具调用
   */
  private renderToolCall(msg: ChatMessage, locale: 'zh' | 'en'): m.Children {
    const toolCall = msg.toolCall!;

    return m('.ai-chat__tool-call', [
      m('.ai-chat__tool-call-header', [
        m(Icon, {icon: 'play_arrow', className: 'ai-chat__tool-icon'}),
        m(
          '.ai-chat__tool-call-title',
          `${locale === 'zh' ? '调用工具' : 'Calling tool'}: ${toolCall.name}`,
        ),
      ]),
      m('.ai-chat__tool-call-args', [
        m('pre', JSON.stringify(toolCall.arguments, null, 2)),
      ]),
    ]);
  }

  /**
   * 渲染工具结果
   */
  private renderToolResult(msg: ChatMessage, locale: 'zh' | 'en'): m.Children {
    const result = msg.toolResult!;
    const isSuccess = result.success;

    return m(
      '.ai-chat__tool-result',
      {
        class: isSuccess
          ? 'ai-chat__tool-result--success'
          : 'ai-chat__tool-result--error',
      },
      [
        m('.ai-chat__tool-result-header', [
          m(Icon, {
            icon: isSuccess ? 'check_circle' : 'error',
            className: 'ai-chat__tool-icon',
          }),
          m(
            '.ai-chat__tool-result-title',
            isSuccess
              ? locale === 'zh'
                ? '工具执行成功'
                : 'Tool executed successfully'
              : locale === 'zh'
                ? '工具执行失败'
                : 'Tool execution failed',
          ),
        ]),
        result.artifactRef &&
          m('.ai-chat__tool-result-artifact', [
            m(Icon, {icon: 'data_object'}),
            `Artifact: ${result.artifactRef}`,
          ]),
        result.error &&
          m('.ai-chat__tool-result-error', result.error),
      ],
    );
  }

  /**
   * 渲染加载指示器
   */
  private renderLoadingIndicator(agentLoop: AgentLoop): m.Children {
    return m('.ai-chat__loading', [
      m('.ai-chat__loading-spinner'),
      m('.ai-chat__loading-text', agentLoop.getStateLabel()),
    ]);
  }

  /**
   * 渲染输入区域
   */
  private renderInputArea(
    agentLoop: AgentLoop,
    locale: 'zh' | 'en',
    isProcessing: boolean,
    canSend: boolean,
    store: Store<OpenPerfettoState>,
  ): m.Children {
    const agentState = agentLoop.getState();
    const isTerminalState =
      agentState === AgentLoopState.ERROR ||
      agentState === AgentLoopState.CANCELLED;

    return m('.ai-chat__input-area', [
      // ERROR/CANCELLED 状态提示
      isTerminalState &&
        m('.ai-chat__reset-hint', {
          onclick: () => {
            agentLoop.reset();
            m.redraw();
          },
        }, locale === 'zh' ? '点击重新开始' : 'Click to restart'),
      m('textarea.ai-chat__input', {
        placeholder:
          locale === 'zh'
            ? '描述你想分析的性能问题...'
            : 'Describe the performance issue...',
        value: this.inputText,
        disabled: isProcessing,
        oninput: (e: Event) => {
          this.inputText = (e.target as HTMLTextAreaElement).value;
        },
        onkeydown: (e: KeyboardEvent) => {
          // Enter 发送，Shift+Enter 换行
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(agentLoop, store);
          }
        },
      }),
      m(
        '.ai-chat__send-btn',
        {
          onclick: () => this.sendMessage(agentLoop, store),
          class: !canSend || !this.inputText.trim()
            ? 'ai-chat__send-btn--disabled'
            : '',
          title: locale === 'zh' ? '发送' : 'Send',
        },
        m(Icon, {icon: 'send'}),
      ),
    ]);
  }

  /**
   * 发送消息
   */
  private async sendMessage(
    agentLoop: AgentLoop,
    store: Store<OpenPerfettoState>,
  ): Promise<void> {
    const text = this.inputText.trim();
    if (!text) return;

    // 检查连接状态
    const connectionState = store.state.connectionState;
    if (connectionState.status !== 'connected') {
      opLogger.warn('[AIChat] Cannot send: not connected', {status: connectionState.status});
      store.edit((draft) => {
        if (draft.currentSession) {
          draft.currentSession.messages.push({
            id: `error_${Date.now()}`,
            role: 'system',
            content: '发送失败: 未连接到服务器',
            timestamp: Date.now(),
          });
        }
      });
      return;
    }

    // AgentLoop.sendMessage 已内置终态自动恢复，
    // 非 IDLE 的活跃状态静默返回
    const agentState = agentLoop.getState();
    if (
      agentState !== AgentLoopState.IDLE &&
      agentState !== AgentLoopState.COMPLETE &&
      agentState !== AgentLoopState.ERROR &&
      agentState !== AgentLoopState.CANCELLED
    ) {
      opLogger.warn('[AIChat] Cannot send: agent busy', {state: agentState});
      return;
    }

    opLogger.info('[AIChat] >>> User sending message', {
      length: text.length,
      preview: text.substring(0, 80),
      agentState,
      connectionStatus: connectionState.status,
    });

    this.inputText = '';
    this.shouldScrollToBottom = true;

    try {
      await agentLoop.sendMessage(text);
      opLogger.info('[AIChat] Message sent successfully');
    } catch (error) {
      opLogger.error('[AIChat] Failed to send message', error);
      // 添加错误消息到对话中
      store.edit((draft) => {
        if (draft.currentSession) {
          draft.currentSession.messages.push({
            id: `error_${Date.now()}`,
            role: 'system',
            content: `发送失败: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now(),
          });
        }
      });
    }
  }

  /**
   * 滚动到底部
   */
  private scrollToBottom(): void {
    if (this.messagesContainer) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }

  /**
   * 处理滚动事件
   */
  private handleScroll(e: Event): void {
    const container = e.target as HTMLElement;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    this.shouldScrollToBottom = isAtBottom;
  }
}
