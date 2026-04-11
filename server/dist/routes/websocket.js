/**
 * WebSocket 路由
 * 处理 WebSocket 连接、消息分发、心跳检测、LLM 转发
 */
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { StructuredLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { safeValidateClientMessage, getMessagePriority, MessagePriority, } from '../types/protocol.js';
const logger = new StructuredLogger('websocket');
let dependencies = null;
/**
 * 设置 WebSocket 路由依赖
 */
export function setWebSocketDependencies(deps) {
    dependencies = deps;
    logger.info('WebSocket dependencies configured');
}
// ============= 连接池 =============
class ConnectionPool {
    connections = new Map();
    agentConnections = new Map(); // agentId -> connectionIds
    heartbeatTimer = null;
    cleanupTimer = null;
    config = getConfig().websocket;
    constructor() {
        this.startHeartbeatCheck();
        this.startZombieCleanup();
    }
    /**
     * 添加新连接
     */
    add(socket, traceId) {
        // 检查是否超过最大连接数
        if (this.connections.size >= this.config.maxConnections) {
            logger.warn('Max connections reached', {
                current: this.connections.size,
                max: this.config.maxConnections,
            });
            throw new Error('Maximum connections reached');
        }
        const connectionId = uuidv4();
        const now = Date.now();
        const info = {
            id: connectionId,
            socket,
            agentId: null,
            traceId,
            createdAt: now,
            lastPongAt: now,
            state: 'connecting',
        };
        this.connections.set(connectionId, info);
        logger.info('Connection added', {
            connectionId,
            traceId,
            totalConnections: this.connections.size,
        });
        return info;
    }
    /**
     * 设置连接的 agentId
     */
    setAgentId(connectionId, agentId) {
        const info = this.connections.get(connectionId);
        if (!info)
            return false;
        // 检查该 agent 的连接数
        const agentConns = this.agentConnections.get(agentId) || new Set();
        if (agentConns.size >= this.config.maxConnectionsPerUser) {
            logger.warn('Max connections per agent reached', {
                agentId,
                current: agentConns.size,
                max: this.config.maxConnectionsPerUser,
            });
            return false;
        }
        info.agentId = agentId;
        info.state = 'connected';
        agentConns.add(connectionId);
        this.agentConnections.set(agentId, agentConns);
        return true;
    }
    /**
     * 更新连接的 pong 时间
     */
    updatePong(connectionId) {
        const info = this.connections.get(connectionId);
        if (info) {
            info.lastPongAt = Date.now();
        }
    }
    /**
     * 设置连接为活跃状态
     */
    setActive(connectionId) {
        const info = this.connections.get(connectionId);
        if (info && info.state === 'connected') {
            info.state = 'active';
        }
    }
    /**
     * 移除连接
     */
    remove(connectionId) {
        const info = this.connections.get(connectionId);
        if (!info)
            return;
        // 从 agent 连接映射中移除
        if (info.agentId) {
            const agentConns = this.agentConnections.get(info.agentId);
            if (agentConns) {
                agentConns.delete(connectionId);
                if (agentConns.size === 0) {
                    this.agentConnections.delete(info.agentId);
                }
            }
        }
        this.connections.delete(connectionId);
        logger.info('Connection removed', {
            connectionId,
            traceId: info.traceId,
            agentId: info.agentId,
            totalConnections: this.connections.size,
        });
    }
    /**
     * 获取连接信息
     */
    get(connectionId) {
        return this.connections.get(connectionId);
    }
    /**
     * 获取连接总数
     */
    size() {
        return this.connections.size;
    }
    /**
     * 启动心跳检测
     */
    startHeartbeatCheck() {
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            const timeout = this.config.heartbeatTimeout;
            for (const [connectionId, info] of this.connections) {
                if (now - info.lastPongAt > timeout) {
                    logger.warn('Connection heartbeat timeout', {
                        connectionId,
                        traceId: info.traceId,
                        agentId: info.agentId,
                        lastPongAt: info.lastPongAt,
                    });
                    // 关闭超时连接
                    this.closeConnection(connectionId, 4001, 'Heartbeat timeout');
                }
            }
        }, this.config.heartbeatInterval);
    }
    /**
     * 启动僵尸连接清理
     */
    startZombieCleanup() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            for (const [connectionId, info] of this.connections) {
                // 清理处于 closing/closed 状态的连接
                if (info.state === 'closing' || info.state === 'closed') {
                    this.remove(connectionId);
                    cleanedCount++;
                    continue;
                }
                // 清理长时间未激活的 connecting 状态连接
                if (info.state === 'connecting' && now - info.createdAt > 30000) {
                    this.closeConnection(connectionId, 4002, 'Connection timeout');
                    cleanedCount++;
                }
            }
            if (cleanedCount > 0) {
                logger.info('Zombie connections cleaned', { cleanedCount });
            }
        }, this.config.zombieCleanupInterval);
    }
    /**
     * 关闭连接
     */
    closeConnection(connectionId, code, reason) {
        const info = this.connections.get(connectionId);
        if (!info)
            return;
        info.state = 'closing';
        try {
            if (info.socket.readyState === WebSocket.OPEN) {
                info.socket.close(code, reason);
            }
        }
        catch (err) {
            logger.error('Error closing connection', err, { connectionId });
        }
        this.remove(connectionId);
    }
    /**
     * 关闭所有连接
     */
    closeAll() {
        for (const [connectionId] of this.connections) {
            this.closeConnection(connectionId, 1001, 'Server shutdown');
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }
}
// ============= 全局连接池实例 =============
const connectionPool = new ConnectionPool();
// ============= 消息发送 =============
/**
 * 发送消息到客户端（带背压检测）
 */
function sendMessage(info, message) {
    const { socket } = info;
    const config = getConfig().websocket;
    // 检查连接状态
    if (socket.readyState !== WebSocket.OPEN) {
        logger.warn('Cannot send message, socket not open', {
            connectionId: info.id,
            readyState: socket.readyState,
        });
        return false;
    }
    // 背压检测
    if (socket.bufferedAmount > config.maxBufferedAmount) {
        const priority = getMessagePriority(message);
        // 高优先级消息（error）仍然发送
        if (priority !== MessagePriority.HIGH) {
            logger.warn('Backpressure detected, message dropped', {
                connectionId: info.id,
                bufferedAmount: socket.bufferedAmount,
                messageType: message.type,
            });
            return false;
        }
    }
    try {
        const data = JSON.stringify(message);
        socket.send(data);
        return true;
    }
    catch (err) {
        logger.error('Error sending message', err, {
            connectionId: info.id,
            messageType: message.type,
        });
        return false;
    }
}
// ============= 消息处理 =============
/**
 * 处理 ping 消息
 */
function handlePing(info, timestamp) {
    connectionPool.updatePong(info.id);
    sendMessage(info, {
        type: 'pong',
        timestamp,
        traceId: info.traceId,
    });
}
/**
 * 处理 chat 消息（Phase 2: LLM 转发模式）
 */
async function handleChat(info, message) {
    const { agentId, traceId, payload } = message;
    // 设置 agentId（如果尚未设置）
    if (!info.agentId) {
        if (!connectionPool.setAgentId(info.id, agentId)) {
            sendMessage(info, {
                type: 'error',
                traceId,
                data: {
                    code: 'CONNECTION_LIMIT',
                    message: 'Maximum connections per agent reached',
                },
            });
            return;
        }
    }
    connectionPool.setActive(info.id);
    const loggerWithTrace = logger.withTraceId(traceId);
    loggerWithTrace.info('Chat message received', {
        agentId,
        messageCount: payload.messages.length,
        hasTools: !!payload.tools?.length,
    });
    // 检查依赖是否已配置
    if (!dependencies) {
        loggerWithTrace.warn('WebSocket dependencies not configured, using echo mode');
        handleChatEchoMode(info, message);
        return;
    }
    const { llmProxy, sessionManager, skillMarkerParser } = dependencies;
    // 检查是否有可用的 LLM Provider
    if (!llmProxy.hasAvailableProvider()) {
        loggerWithTrace.warn('No LLM provider available, using echo mode');
        handleChatEchoMode(info, message);
        return;
    }
    try {
        // 1. 获取或创建会话
        // 使用 agentId 作为 session 标识（简化版，实际可能需要 sessionId 参数）
        const session = await sessionManager.getOrCreateSession(undefined, agentId);
        loggerWithTrace.debug('Session retrieved/created', {
            sessionId: session.id,
            messageCount: session.messages.length,
        });
        // 2. 解析消息中的 Skill 标记
        let systemPrompt = payload.systemPrompt || '';
        // 检查 systemPrompt 中是否有 Skill 标记
        if (systemPrompt && skillMarkerParser.hasMarkers(systemPrompt)) {
            const parseResult = skillMarkerParser.parse(systemPrompt);
            if (parseResult.markers.length > 0) {
                loggerWithTrace.info('Skill markers found in system prompt', {
                    count: parseResult.markers.length,
                    skillIds: parseResult.markers.map(m => m.skillId),
                });
                // Phase 2: 记录标记到会话统计
                for (const marker of parseResult.markers) {
                    await sessionManager.updateStats(session.id, {
                        skillInvocation: marker.skillId,
                    });
                }
                // Phase 3: Skill 标记融合 — 替换标记为格式化的 Skill 描述
                if (dependencies.skillProcessor) {
                    try {
                        const originalLength = systemPrompt.length;
                        let fusedCount = 0;
                        const enrichedSystemPrompt = await skillMarkerParser.replaceAsync(systemPrompt, async (marker) => {
                            const formatted = await dependencies.skillProcessor.formatSkillForPrompt(marker.skillId, marker.params);
                            if (formatted) {
                                fusedCount++;
                                return formatted;
                            }
                            return `[Skill not found: ${marker.skillId}]`;
                        });
                        loggerWithTrace.info('Skill markers fused into system prompt', {
                            markersDetected: parseResult.markers.length,
                            markersFused: fusedCount,
                            originalLength,
                            enrichedLength: enrichedSystemPrompt.length,
                        });
                        systemPrompt = enrichedSystemPrompt;
                    }
                    catch (fusionError) {
                        loggerWithTrace.error('Skill marker fusion failed, using original systemPrompt', fusionError, {
                            markersDetected: parseResult.markers.length,
                        });
                        // 降级：保持原始 systemPrompt 不变
                    }
                }
                else {
                    loggerWithTrace.debug('SkillProcessor not available, skipping marker fusion');
                }
            }
        }
        // 3. 构建 LLM 请求
        const llmRequest = {
            messages: payload.messages.map(m => ({
                role: m.role,
                content: m.content,
                toolCallId: m.toolResult?.toolCallId,
                toolResult: m.toolResult?.data,
            })),
            systemPrompt,
            tools: payload.tools?.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            })),
        };
        // 4. 添加用户消息到会话历史
        const lastUserMessage = payload.messages.filter(m => m.role === 'user').pop();
        if (lastUserMessage) {
            const chatMessage = {
                id: uuidv4(),
                role: 'user',
                content: lastUserMessage.content,
                timestamp: Date.now(),
            };
            await sessionManager.addMessage(session.id, chatMessage);
        }
        // 5. 调用 LLM 获取流式响应
        let fullResponseText = '';
        let inputTokens = 0;
        let outputTokens = 0;
        for await (const chunk of llmProxy.chat(llmRequest)) {
            switch (chunk.type) {
                case 'text_delta':
                    fullResponseText += chunk.text;
                    sendMessage(info, {
                        type: 'text_delta',
                        traceId,
                        data: { text: chunk.text },
                    });
                    break;
                case 'tool_use':
                    await sessionManager.updateStats(session.id, { toolCallCount: 1 });
                    sendMessage(info, {
                        type: 'tool_use',
                        traceId,
                        data: {
                            id: chunk.id,
                            name: chunk.name,
                            arguments: chunk.arguments,
                        },
                    });
                    break;
                case 'done':
                    if (chunk.usage) {
                        inputTokens = chunk.usage.inputTokens;
                        outputTokens = chunk.usage.outputTokens;
                    }
                    break;
                case 'error':
                    loggerWithTrace.error('LLM error', { message: chunk.message });
                    sendMessage(info, {
                        type: 'error',
                        traceId,
                        data: {
                            code: 'LLM_ERROR',
                            message: chunk.message,
                        },
                    });
                    return;
            }
        }
        // 6. 添加助手响应到会话历史
        if (fullResponseText) {
            const assistantMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: fullResponseText,
                timestamp: Date.now(),
            };
            await sessionManager.addMessage(session.id, assistantMessage);
        }
        // 7. 更新会话统计
        await sessionManager.updateStats(session.id, {
            inputTokens,
            outputTokens,
        });
        // 8. 发送完成消息
        sendMessage(info, {
            type: 'done',
            traceId,
            data: {
                agentId,
                usage: {
                    inputTokens,
                    outputTokens,
                },
            },
        });
        loggerWithTrace.info('Chat response completed', {
            agentId,
            sessionId: session.id,
            inputTokens,
            outputTokens,
        });
    }
    catch (error) {
        loggerWithTrace.error('Chat handling failed', error);
        sendMessage(info, {
            type: 'error',
            traceId,
            data: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
        });
    }
}
/**
 * 处理 chat 消息（Echo 模式 - 无 LLM 配置时的降级）
 */
function handleChatEchoMode(info, message) {
    const { agentId, traceId, payload } = message;
    const lastUserMessage = payload.messages
        .filter(m => m.role === 'user')
        .pop();
    const responseText = lastUserMessage
        ? `[Echo] Received: "${lastUserMessage.content.substring(0, 100)}${lastUserMessage.content.length > 100 ? '...' : ''}"`
        : '[Echo] No user message found';
    // 发送 text_delta 响应
    sendMessage(info, {
        type: 'text_delta',
        traceId,
        data: {
            text: responseText,
        },
    });
    // 发送 done 响应
    sendMessage(info, {
        type: 'done',
        traceId,
        data: {
            agentId,
            usage: {
                inputTokens: 0,
                outputTokens: 0,
            },
        },
    });
    logger.withTraceId(traceId).info('Chat response sent (echo mode)', { agentId });
}
/**
 * 处理 invoke_skill 消息
 */
async function handleInvokeSkill(info, message) {
    const { agentId, skillId, params: parameters = {}, requestId, traceId: msgTraceId } = message;
    const traceId = msgTraceId || info.traceId;
    const loggerWithTrace = logger.withTraceId(traceId);
    loggerWithTrace.info('Invoke skill request received', { skillId, agentId });
    // 检查依赖是否已配置
    if (!dependencies?.skillProcessor || !dependencies?.skillRegistry) {
        loggerWithTrace.warn('Skill dependencies not configured');
        sendMessage(info, {
            type: 'error',
            traceId,
            data: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Skill service not available',
            },
        });
        return;
    }
    const { skillProcessor } = dependencies;
    try {
        // 执行 Skill
        const executionRequest = {
            skillId,
            parameters,
            traceId,
        };
        const result = await skillProcessor.execute(executionRequest);
        if (!result.success) {
            sendMessage(info, {
                type: 'error',
                traceId,
                data: {
                    code: 'SKILL_EXECUTION_ERROR',
                    message: result.error || 'Skill execution failed',
                    details: result.validationErrors,
                },
            });
            return;
        }
        // 发送 tool_result 响应，透传 requestId
        const toolCallId = requestId || `skill_${skillId}_${Date.now()}`;
        sendMessage(info, {
            type: 'tool_result',
            traceId,
            data: {
                toolCallId,
                requestId,
                success: true,
                result: {
                    skillId: result.skillId,
                    skillName: result.skillName,
                    skillType: result.skillType,
                    query: result.query,
                    steps: result.steps,
                    diagnosticRules: result.diagnosticRules,
                    metadata: result.metadata,
                },
            },
        });
        loggerWithTrace.info('Skill executed successfully', {
            skillId,
            hasQuery: !!result.query,
            stepsCount: result.steps?.length,
        });
    }
    catch (err) {
        loggerWithTrace.error('Skill execution failed', err, { skillId });
        sendMessage(info, {
            type: 'error',
            traceId,
            data: {
                code: 'INTERNAL_ERROR',
                message: err instanceof Error ? err.message : 'Unknown error',
            },
        });
    }
}
/**
 * 处理客户端消息
 */
async function handleMessage(info, rawData) {
    const loggerWithTrace = logger.withTraceId(info.traceId);
    let data;
    try {
        data = JSON.parse(rawData);
    }
    catch (err) {
        loggerWithTrace.warn('Invalid JSON message', { rawData: rawData.substring(0, 100) });
        sendMessage(info, {
            type: 'error',
            traceId: info.traceId,
            data: {
                code: 'INVALID_JSON',
                message: 'Failed to parse JSON message',
            },
        });
        return;
    }
    // 验证消息格式
    const message = safeValidateClientMessage(data);
    if (!message) {
        loggerWithTrace.warn('Invalid message format', { data });
        sendMessage(info, {
            type: 'error',
            traceId: info.traceId,
            data: {
                code: 'INVALID_MESSAGE',
                message: 'Invalid message format',
            },
        });
        return;
    }
    // 成功解析有效消息后更新 pong 时间（C5: 心跳改善）
    connectionPool.updatePong(info.id);
    // 分发消息
    switch (message.type) {
        case 'ping':
            handlePing(info, message.timestamp);
            break;
        case 'chat':
            await handleChat(info, message);
            break;
        case 'invoke_skill':
            await handleInvokeSkill(info, message);
            break;
        default:
            loggerWithTrace.warn('Unknown message type', { type: message.type });
            sendMessage(info, {
                type: 'error',
                traceId: info.traceId,
                data: {
                    code: 'UNKNOWN_MESSAGE_TYPE',
                    message: `Unknown message type: ${message.type}`,
                },
            });
    }
}
// ============= WebSocket 路由注册 =============
/**
 * 注册 WebSocket 路由
 */
export function setupWebSocketRoutes(server) {
    server.get('/ws', { websocket: true }, (socket, req) => {
        // 从请求头获取 traceId 或生成新的
        const traceId = req.headers['x-trace-id'] || uuidv4();
        const loggerWithTrace = logger.withTraceId(traceId);
        loggerWithTrace.info('WebSocket connection attempt', {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });
        // 添加到连接池
        let info;
        try {
            info = connectionPool.add(socket, traceId);
        }
        catch (err) {
            loggerWithTrace.error('Failed to add connection', err);
            socket.close(4003, 'Connection pool full');
            return;
        }
        // 连接成功
        info.state = 'connected';
        loggerWithTrace.info('WebSocket connected', { connectionId: info.id });
        // 消息处理
        socket.on('message', (rawData) => {
            const message = rawData.toString('utf8');
            handleMessage(info, message).catch((err) => {
                logger.withTraceId(info.traceId).error('Message handling failed', err);
            });
        });
        // 连接关闭
        socket.on('close', (code, reason) => {
            loggerWithTrace.info('WebSocket closed', {
                connectionId: info.id,
                code,
                reason: reason.toString('utf8'),
            });
            connectionPool.remove(info.id);
        });
        // 错误处理
        socket.on('error', (err) => {
            loggerWithTrace.error('WebSocket error', err, { connectionId: info.id });
            connectionPool.remove(info.id);
        });
    });
}
// ============= 导出 =============
export { connectionPool };
export default setupWebSocketRoutes;
//# sourceMappingURL=websocket.js.map