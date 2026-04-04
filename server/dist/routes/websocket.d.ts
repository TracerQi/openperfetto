/**
 * WebSocket 路由
 * 处理 WebSocket 连接、消息分发、心跳检测、LLM 转发
 */
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { LLMProxy } from '../services/llm_proxy.js';
import { SessionManager } from '../services/session_manager.js';
import { SkillMarkerParser } from '../services/skill_marker_parser.js';
import { SkillRegistry } from '../services/skill_registry.js';
import { SkillProcessor } from '../services/skill_processor.js';
interface WebSocketDependencies {
    llmProxy: LLMProxy;
    sessionManager: SessionManager;
    skillMarkerParser: SkillMarkerParser;
    skillRegistry?: SkillRegistry;
    skillProcessor?: SkillProcessor;
}
/**
 * 设置 WebSocket 路由依赖
 */
export declare function setWebSocketDependencies(deps: WebSocketDependencies): void;
interface ConnectionInfo {
    id: string;
    socket: WebSocket;
    agentId: string | null;
    traceId: string;
    createdAt: number;
    lastPongAt: number;
    state: 'connecting' | 'connected' | 'active' | 'closing' | 'closed';
}
declare class ConnectionPool {
    private connections;
    private agentConnections;
    private heartbeatTimer;
    private cleanupTimer;
    private readonly config;
    constructor();
    /**
     * 添加新连接
     */
    add(socket: WebSocket, traceId: string): ConnectionInfo;
    /**
     * 设置连接的 agentId
     */
    setAgentId(connectionId: string, agentId: string): boolean;
    /**
     * 更新连接的 pong 时间
     */
    updatePong(connectionId: string): void;
    /**
     * 设置连接为活跃状态
     */
    setActive(connectionId: string): void;
    /**
     * 移除连接
     */
    remove(connectionId: string): void;
    /**
     * 获取连接信息
     */
    get(connectionId: string): ConnectionInfo | undefined;
    /**
     * 获取连接总数
     */
    size(): number;
    /**
     * 启动心跳检测
     */
    private startHeartbeatCheck;
    /**
     * 启动僵尸连接清理
     */
    private startZombieCleanup;
    /**
     * 关闭连接
     */
    closeConnection(connectionId: string, code: number, reason: string): void;
    /**
     * 关闭所有连接
     */
    closeAll(): void;
}
declare const connectionPool: ConnectionPool;
/**
 * 注册 WebSocket 路由
 */
export declare function setupWebSocketRoutes(server: FastifyInstance): void;
export { connectionPool };
export default setupWebSocketRoutes;
//# sourceMappingURL=websocket.d.ts.map