# SPEC-06: 流式输出可靠性增强

## 1. 概述

将后端 WebSocket 背压从"丢弃"改为"缓冲队列+优先级淘汰"，增强前端流式文本的刷新控制。

**目标**：
- 背压场景下低优先级消息不再被直接丢弃，而是进入缓冲队列等待发送
- 队列满时按优先级和时间淘汰，确保高优先级消息始终可送达
- 增加流式文本的强制刷新时机，避免用户看到不完整的输出

**现有行为**：
- `websocket.ts`：背压时非 HIGH 优先级消息直接丢弃
- `llm_stream_handler.ts`：100ms 防抖缓冲，`tool_use` 前会 flush

## 2. 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `server/src/websocket/websocket.ts` | 修改 | 新增 `MessageQueue` 内部类，修改 `sendMessage()` 背压逻辑 |
| `server/src/llm/llm_stream_handler.ts` | 修改 | 新增 `forceFlush()` 方法，增加缓冲区阈值刷新 |
| `server/src/agent/agent_loop.ts` | 修改 | 在状态转换和工具结果处理时调用 `forceFlush()` |

## 3. websocket.ts 修改

### 3.1 新增 MessageQueue 内部类

```typescript
class MessageQueue {
  private queue: Array<{
    message: ServerMessage;
    priority: MessagePriority;
    timestamp: number;
  }> = [];
  private readonly maxSize = 500;

  /**
   * 入队消息。
   * 队满时淘汰最旧的低优先级消息。
   * @returns true 表示成功入队，false 表示队列满且无法淘汰（全是 HIGH）
   */
  enqueue(message: ServerMessage, priority: MessagePriority): boolean {
    if (this.queue.length >= this.maxSize) {
      // 找到最旧的、优先级最低的消息进行淘汰
      const evictIndex = this.findEvictCandidate(priority);
      if (evictIndex === -1) {
        return false; // 无法淘汰，队列中全是同等或更高优先级
      }
      this.queue.splice(evictIndex, 1);
    }
    this.queue.push({ message, priority, timestamp: Date.now() });
    return true;
  }

  /**
   * 出队（FIFO）
   */
  dequeue(): { message: ServerMessage; priority: MessagePriority } | null {
    const item = this.queue.shift();
    return item ? { message: item.message, priority: item.priority } : null;
  }

  /**
   * 尝试发送队列中的所有消息
   * @returns 成功发送的消息数
   */
  drain(socket: WebSocket): number {
    let sent = 0;
    while (this.queue.length > 0) {
      if (socket.readyState !== WebSocket.OPEN) break;
      if (socket.bufferedAmount > config.maxBufferedAmount) break;
      const item = this.dequeue();
      if (!item) break;
      socket.send(JSON.stringify(item.message));
      sent++;
    }
    return sent;
  }

  get size(): number {
    return this.queue.length;
  }

  /**
   * 查找可淘汰的消息索引：优先淘汰优先级低于 incomingPriority 的最旧消息
   */
  private findEvictCandidate(incomingPriority: MessagePriority): number {
    let candidateIndex = -1;
    let candidatePriority = incomingPriority;

    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < candidatePriority) {
        candidatePriority = this.queue[i].priority;
        candidateIndex = i;
      } else if (
        this.queue[i].priority === candidatePriority &&
        candidateIndex === -1
      ) {
        candidateIndex = i;
      }
    }

    return candidateIndex;
  }
}
```

### 3.2 修改 sendMessage()

将现有的"直接丢弃"改为"入队缓冲"：

```typescript
function sendMessage(info: ConnectionInfo, message: ServerMessage): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;

  if (socket.bufferedAmount > config.maxBufferedAmount) {
    const priority = getMessagePriority(message);

    // HIGH 优先级消息仍然尝试立即发送
    if (priority === MessagePriority.HIGH) {
      socket.send(JSON.stringify(message));
      return true;
    }

    // 非 HIGH 消息入队缓冲，不再直接丢弃
    const enqueued = info.messageQueue.enqueue(message, priority);
    if (!enqueued) {
      logger.warn('Message queue full, message dropped', {
        priority,
        queueSize: info.messageQueue.size,
      });
      return false;
    }

    logger.debug('Backpressure detected, message queued', {
      priority,
      queueSize: info.messageQueue.size,
    });
    return true;
  }

  socket.send(JSON.stringify(message));
  return true;
}
```

### 3.3 ConnectionInfo 扩展

在 `ConnectionInfo` 类型/接口中新增 `messageQueue` 字段：

```typescript
interface ConnectionInfo {
  // ... 现有字段 ...
  messageQueue: MessageQueue;
}
```

在连接创建时初始化：

```typescript
const info: ConnectionInfo = {
  // ... 现有初始化 ...
  messageQueue: new MessageQueue(),
};
```

### 3.4 定时 drain 机制

为每个连接注册定时器，尝试清空队列：

```typescript
const DRAIN_INTERVAL_MS = 200;

// 连接创建时启动 drain 定时器
const drainTimer = setInterval(() => {
  if (info.messageQueue.size > 0 && socket.readyState === WebSocket.OPEN) {
    const sent = info.messageQueue.drain(socket);
    if (sent > 0) {
      logger.debug(`Drained ${sent} queued messages`);
    }
  }
}, DRAIN_INTERVAL_MS);

// 连接关闭时清理定时器
socket.on('close', () => {
  clearInterval(drainTimer);
});
```

## 4. llm_stream_handler.ts 修改

### 4.1 增加强制刷新时机

在现有 `tool_use` 处理中的 `flushTextBuffer()` 基础上，新增以下刷新触发点：

| 触发时机 | 方法 | 状态 | 说明 |
|----------|------|------|------|
| tool_use 开始前 | `onBeforeToolCall()` | 已有 | 保持现有行为 |
| 工具结果返回后 | `onAfterToolResult()` | **新增** | 确保工具输出后立即可见 |
| Agent 状态转换时 | `onStateTransition()` | **新增** | 确保状态切换前文本完整 |
| LLM 完成时 | `onLLMComplete()` | 已有 | done 消息处理时 flush |
| 缓冲区阈值超限 | `handleTextDelta()` 内 | **新增** | `textBuffer.length > 500` 时立即刷新 |

### 4.2 新增 forceFlush 方法

```typescript
/**
 * 强制刷新文本缓冲区，忽略防抖计时器。
 * @param reason 刷新原因（用于日志记录）
 */
public forceFlush(reason: string): void {
  this.flushTextBuffer();
  logger.debug(`Force flushed text buffer, reason: ${reason}`);
}
```

### 4.3 缓冲区阈值刷新

修改 `handleTextDelta()` 方法，增加阈值判断：

```typescript
private static readonly BUFFER_THRESHOLD = 500;

handleTextDelta(text: string): void {
  this.textBuffer += text;

  // 缓冲区超过阈值时立即刷新
  if (this.textBuffer.length > LLMStreamHandler.BUFFER_THRESHOLD) {
    this.flushTextBuffer();
    return;
  }

  // 现有防抖逻辑
  if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => this.flushTextBuffer(), LLMStreamHandler.DEBOUNCE_MS);
  }
}
```

### 4.4 agent_loop.ts 调用点

在 `agent_loop.ts` 中的以下位置调用 `forceFlush()`：

```typescript
// 工具执行结果返回后
async function handleToolResult(result: ToolResult): Promise<void> {
  // ... 现有逻辑 ...
  this.streamHandler.forceFlush('after_tool_result');
}

// Agent 状态转换时
function transitionState(newState: AgentState): void {
  // ... 现有逻辑 ...
  this.streamHandler.forceFlush('state_transition');
}
```

## 5. 约束

- **优先级体系不变**：保持现有 `MessagePriority { LOW = 0, MEDIUM = 1, HIGH = 2 }` 不变
- **防抖间隔不变**：保持 `DEBOUNCE_MS = 100` 不变
- **消息队列上限**：每个连接的消息队列大小限制为 500 条
- **drain 间隔**：不小于 200ms，避免过于频繁的发送尝试
- **HIGH 消息特权**：HIGH 优先级消息在背压时仍尝试立即发送，不进入队列
- **连接生命周期**：`MessageQueue` 随连接创建而创建，随连接关闭而销毁（清理 drain 定时器）

## 6. 验收标准

| ID | 验收条件 | 验证方式 |
|----|----------|----------|
| SPEC-06-AC01 | 背压时低优先级消息进入队列而非被丢弃 | 单元测试：模拟 `bufferedAmount` 超限，发送 LOW 消息，验证 `messageQueue.size > 0` |
| SPEC-06-AC02 | 队列满时淘汰最旧的低优先级消息 | 单元测试：填满队列后入队 MEDIUM 消息，验证最旧的 LOW 消息被移除 |
| SPEC-06-AC03 | 背压解除后队列自动 drain | 集成测试：先触发背压入队消息，恢复 `bufferedAmount`，等待 200ms+，验证队列为空且消息已发送 |
| SPEC-06-AC04 | Agent 状态转换时文本缓冲区被强制刷新 | 单元测试：调用 `forceFlush('state_transition')`，验证 `textBuffer` 为空且 `onTextDelta` 被调用 |
| SPEC-06-AC05 | 缓冲区超过 500 字符时立即刷新 | 单元测试：连续调用 `handleTextDelta()` 使缓冲区超过 500 字符，验证 `flushTextBuffer()` 被立即调用 |
