# Agent 沟通对话模块完善方案

## 一、当前现状总结

当前代码已实现的基础骨架：
- 前端: AIChat 组件、AgentLoop 状态机、WebSocketClient、LLMStreamHandler、ContextManager、ToolRegistry 等核心模块
- 后端: Fastify 服务、WebSocket 路由、LLMProxy 多 Provider 抽象、SessionManager、SkillProcessor
- 通信: WebSocket 双向通信、心跳机制、自动重连

## 二、对话模块核心缺陷分析（按严重程度排序）

### 缺陷 P0（流程阻断 - 对话完全无法正常工作）

**P0-1: LLMStreamHandler tool_use 消息解析失败**
- 文件: `ui/src/plugins/org.openperfetto/services/llm_stream_handler.ts` 第 135 行
- 问题: 后端发送 `{ type: 'tool_use', data: { id, name, arguments } }`，经 WebSocketClient 映射为 `payload: { id, name, arguments }`。但 LLMStreamHandler 检查的是 `streamMsg.payload?.toolCall`，而 payload 中并没有 `toolCall` 子对象，导致所有 tool_use 消息被静默丢弃
- 影响: **Agent 的工具调用链路完全中断**，LLM 返回的任何 tool_use 指令都无法到达 AgentLoop

**P0-2: Agent 在 ERROR/CANCELLED 状态下永久卡死**
- 文件: `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` 第 320-346 行、第 413-419 行
- 问题: ERROR 和 CANCELLED 是终态（transition 中不处理任何事件），但 `sendMessage()` 要求状态必须是 IDLE。一旦进入 ERROR（网络超时、LLM 报错、工具异常等任何错误），用户无法发送新消息，只能刷新页面
- 影响: **任何一次分析失败后，对话模块变为不可用状态**

**P0-3: 发送按钮不检查 WebSocket 连接状态**
- 文件: `ui/src/plugins/org.openperfetto/sidebar/ai_chat.ts` 第 400 行
- 问题: 按钮 disabled 仅判断 `isProcessing || !this.inputText.trim()`，未检查 `connectionState.status !== 'connected'`。当后端服务未启动或连接断开时，用户可以点击发送，但消息进入 AgentLoop → WebSocket 发送失败 → 消息被缓存或丢失 → 状态机卡在等待 LLM 响应
- 影响: **后端未连接时发送消息会导致状态机挂起**

### 缺陷 P1（功能缺失 - 影响正常使用体验）

**P1-1: 无 WebSocket 连接状态展示**
- 问题: AIChat 的 statusBar 只显示 AgentLoop 状态（空闲/分类中/等待AI响应等），**完全不显示 WebSocket 连接状态**（已连接/连接中/断开/错误）。用户无法判断系统是否在线
- spec 要求: `renderConnectionStatus()` 方法应渲染连接状态指示点

**P1-2: 无"重新开始/重置"机制**
- 问题: 当 Agent 进入 ERROR 或 CANCELLED 后，以及用户想清空对话重新分析时，没有任何 UI 按钮触发 `agentLoop.reset()` 和清空会话消息
- spec/需求要求: "重新打开加载解析新trace时，也会是一个新的agent" — 但同一个 trace 上的错误恢复没有入口

**P1-3: ERROR/CANCELLED 状态下按钮视觉误导**
- 问题: 在 ERROR 状态下，`isProcessing = false`（因为 ERROR 被排除在外），按钮视觉上可用。用户输入文字点击发送，`sendMessage()` 因为 `getState() !== IDLE` 静默返回，没有任何错误提示
- 影响: 用户以为消息已发送但实际被忽略

**P1-4: 流式输出的 done 消息未传递 usage 信息**
- 问题: 后端发送 `{ type: 'done', data: { agentId, usage: { inputTokens, outputTokens } } }`，但 LLMStreamHandler 的 `onDone` 回调不带参数，AgentLoop 无法获取 token 用量统计

### 缺陷 P2（体验优化）

**P2-1: 简易 Markdown 渲染器功能不足**
- 问题: 当前自定义渲染器只支持 `**bold**`, `` `code` ``, ` ```block``` `, `*italic*`, `\n`，不支持列表、标题、表格、链接等。AI 输出中大量使用这些格式
- spec 要求: 使用 `markdown-it` 库

**P2-2: 无消息发送失败反馈**
- 问题: `sendMessage()` catch 块仅 `console.error`，用户 UI 上无任何失败提示

## 三、前端 Agent 架构梳理

```
┌─ OpenPerfettoPlugin (index.ts)
│   ├─ onActivate(): 创建 WebSocket 连接、侧边栏 DOM、快捷键绑定
│   └─ onTraceLoad(): 创建 Store + AgentLoop + 挂载 Page
│
├─ OpenPerfettoPage (sidebar/openperfetto_page.ts)
│   ├─ TopBar (sidebar/top_bar.ts)
│   ├─ SearchPin (sidebar/search_pin.ts)
│   ├─ MarkersJump (sidebar/markers_jump.ts)
│   ├─ AIChat (sidebar/ai_chat.ts)  ◄── 对话模块核心
│   └─ Settings (sidebar/settings.ts)
│
├─ AgentLoop (agent/agent_loop.ts)  ◄── 状态机核心
│   ├─ SceneClassifier → 场景分类
│   ├─ ContextManager → 上下文构建 + System Prompt
│   ├─ PlanningGate → 分析计划验证
│   ├─ ArtifactStore → 工具数据存储
│   ├─ Verifier → 三层验证
│   └─ ToolRegistry → 工具注册表 + 执行
│
├─ WebSocketClient (services/websocket_client.ts)  ◄── 通信层
│   └─ 单例、自动重连、心跳、消息队列
│
└─ LLMStreamHandler (services/llm_stream_handler.ts)  ◄── 流式解析
    └─ text_delta / tool_use / done / error 解析
```

**对话消息流:**
```
用户输入 → AIChat.sendMessage()
  → AgentLoop.sendMessage(text)
    → 添加 user 消息到 Store
    → 状态: IDLE → CLASSIFYING → BUILDING_CONTEXT → AWAITING_PLAN
    → sendToLLM() → WebSocketClient.send({type:'chat', ...})
      → 后端处理 → LLM 流式响应
        → WebSocket onmessage → LLMStreamHandler.handleMessage()
          → text_delta → AgentLoop.handleStreamChunk() → 更新 Store 中的 assistant 消息
          → tool_use → AgentLoop.executeToolCall() → ToolRegistry.execute()
          → done → AgentLoop 进入 VERIFYING → COMPLETE → IDLE
```

## 四、完善方案（精确到文件和修改点）

### Task 1: 修复 LLMStreamHandler tool_use 解析 (P0-1)

**文件:** `ui/src/plugins/org.openperfetto/services/llm_stream_handler.ts`

**修改 `handleMessage` 中 `tool_use` 分支:** 后端发送的 tool_use 数据直接在 payload 顶层（`{id, name, arguments}`），而非嵌套在 `payload.toolCall` 中。需要同时兼容两种格式：

```typescript
case 'tool_use':
  this.flushTextBuffer();
  // 兼容两种格式：
  // 1. payload.toolCall (spec 格式)
  // 2. payload 本身就是 {id, name, arguments} (后端实际格式)
  const toolPayload = streamMsg.payload as Record<string, unknown>;
  const toolCallData = toolPayload?.toolCall ?? toolPayload;
  if (toolCallData && typeof toolCallData === 'object' && 'id' in toolCallData && 'name' in toolCallData) {
    this.callbacks.onToolUse({
      id: (toolCallData as {id: string}).id,
      name: (toolCallData as {name: string}).name,
      arguments: (toolCallData as {arguments: Record<string, unknown>}).arguments || {},
    });
  }
  break;
```

同时修改 `done` 分支，让 `onDone` 回调携带 usage 信息（修改 `LLMStreamCallbacks` 接口）。

### Task 2: 修复 Agent ERROR/CANCELLED 卡死问题 (P0-2)

**文件:** `ui/src/plugins/org.openperfetto/agent/agent_loop.ts`

**修改方案:**
1. `sendMessage()` 方法：当状态为 ERROR、CANCELLED、COMPLETE 时，自动调用 `reset()` 回到 IDLE，而不是抛出异常
2. 确保 `reset()` 清理所有中间状态

```typescript
async sendMessage(userMessage: string): Promise<void> {
  // 从终态自动恢复
  if (this.state === AgentLoopState.ERROR ||
      this.state === AgentLoopState.CANCELLED ||
      this.state === AgentLoopState.COMPLETE) {
    this.reset();
  }
  
  if (this.state !== AgentLoopState.IDLE) {
    throw new Error(`Cannot send message in state: ${this.state}`);
  }
  // ...existing code
}
```

### Task 3: 修复发送按钮连接状态检查 (P0-3) + 连接状态展示 (P1-1) + 错误状态视觉修复 (P1-3)

**文件:** `ui/src/plugins/org.openperfetto/sidebar/ai_chat.ts`

**修改方案:**

1. 在 `view()` 中增加连接状态判断用于 disabled：
```typescript
const connectionState = store.state.connectionState;
const isConnected = connectionState.status === 'connected';
const canSend = !isProcessing && isConnected && 
  (agentState === AgentLoopState.IDLE || 
   agentState === AgentLoopState.COMPLETE ||
   agentState === AgentLoopState.ERROR ||
   agentState === AgentLoopState.CANCELLED);
```

2. 在 statusBar 区域增加连接状态指示器：
```typescript
private renderConnectionIndicator(state: ConnectionState): m.Children {
  const statusMap = {
    connected: { class: '--connected', label: '已连接' },
    connecting: { class: '--connecting', label: '连接中...' },
    disconnected: { class: '--disconnected', label: '未连接' },
    error: { class: '--error', label: '连接错误' },
  };
  const info = statusMap[state.status];
  return m('.ai-chat__connection-indicator', { class: `ai-chat__connection-indicator${info.class}` }, info.label);
}
```

3. 在 ERROR/CANCELLED 状态时，输入区显示"重新开始"提示或按钮。

### Task 4: 增加"重置/新对话"按钮 (P1-2)

**文件:** `ui/src/plugins/org.openperfetto/sidebar/ai_chat.ts`

在状态栏或输入区域增加重置按钮：
- 当 AgentLoop 处于 ERROR/CANCELLED/COMPLETE 状态时显示
- 点击后调用 `agentLoop.reset()` 并可选清空消息历史
- 同时在 `store.edit()` 中重置 `currentSession` 或创建新 session

### Task 5: 消息发送失败 UI 反馈 (P2-2)

**文件:** `ui/src/plugins/org.openperfetto/sidebar/ai_chat.ts`

`sendMessage()` catch 块中添加系统消息到对话：
```typescript
catch (error) {
  // 添加错误消息到对话中
  const store = attrs.store; // 需要在外层捕获引用
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
```

## 五、前端完善接口清单（供后端对照）

### 前端发送给后端的消息格式（无变化，保持现有协议）

| 消息类型 | 格式 | 说明 |
|---------|------|------|
| `chat` | `{type:'chat', agentId:UUID, traceId:UUID, payload:{messages, tools, systemPrompt, stream, requirePlan}}` | 对话请求 |
| `ping` | `{type:'ping', timestamp:number}` | 心跳 |
| `invoke_skill` | `{type:'invoke_skill', skillId, params, requestId, traceId}` | 技能调用 |

### 前端期望后端返回的消息格式（需确认/对齐）

| 消息类型 | 期望格式 | 当前后端格式 | 差异 |
|---------|---------|-------------|------|
| text_delta | `{type:'text_delta', traceId, data:{text}}` | 一致 | 无 |
| tool_use | `{type:'tool_use', traceId, data:{id,name,arguments}}` | 一致 | **前端解析有 bug，见 Task 1** |
| done | `{type:'done', traceId, data:{agentId, usage:{inputTokens,outputTokens}}}` | 一致 | **前端未提取 usage，见 Task 1** |
| error | `{type:'error', traceId, data:{code,message}}` | 一致 | 无 |
| pong | `{type:'pong', timestamp}` | 一致 | 无 |
| tool_result | `{type:'tool_result', traceId, data:{toolCallId,requestId,success,result,error}}` | 一致 | 无 |

### 后端无需修改的确认项

- WebSocket 路由 `/ws` 的消息分发逻辑正确
- LLMProxy 的流式 chunk 格式正确
- SessionManager 的会话管理正确
- SkillMarkerParser 的标记解析正确
- 配置文件结构正确（支持环境变量替换）

## 六、实施顺序

1. **Task 1** (P0-1): 修复 LLMStreamHandler - 这是最关键的数据通路修复
2. **Task 2** (P0-2): 修复 AgentLoop 状态卡死 - 恢复对话可用性
3. **Task 3** (P0-3 + P1-1 + P1-3): 修复发送按钮+连接状态展示 - 防止无效操作
4. **Task 4** (P1-2): 增加重置按钮 - 提供错误恢复入口
5. **Task 5** (P2-2): 发送失败反馈 - 完善用户体验

所有修改集中在 **2 个前端文件**：
- `llm_stream_handler.ts` (Task 1)
- `ai_chat.ts` (Task 3, 4, 5)
- `agent_loop.ts` (Task 2)

后端代码 **当前无需修改**，协议格式已对齐。
