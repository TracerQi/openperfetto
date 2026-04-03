/**
 * 会话管理服务
 * 支持内存存储、定期清理、会话状态管理
 */
import { Session, ChatMessage, SessionState } from '../types/session.js';
export interface ISessionStore {
    /**
     * 创建新会话
     */
    create(session: Session): Promise<void>;
    /**
     * 获取会话
     */
    get(sessionId: string): Promise<Session | null>;
    /**
     * 更新会话
     */
    update(sessionId: string, updates: Partial<Session>): Promise<void>;
    /**
     * 删除会话
     */
    delete(sessionId: string): Promise<void>;
    /**
     * 清理过期会话
     * @param olderThanMs 清理多久之前的会话（毫秒）
     * @returns 清理的会话数量
     */
    cleanup(olderThanMs: number): Promise<number>;
    /**
     * 获取所有会话
     */
    getAll(): Promise<Session[]>;
    /**
     * 获取会话数量
     */
    count(): Promise<number>;
}
export declare class MemorySessionStore implements ISessionStore {
    private sessions;
    private readonly maxSessions;
    constructor(maxSessions?: number);
    create(session: Session): Promise<void>;
    get(sessionId: string): Promise<Session | null>;
    update(sessionId: string, updates: Partial<Session>): Promise<void>;
    delete(sessionId: string): Promise<void>;
    cleanup(olderThanMs: number): Promise<number>;
    getAll(): Promise<Session[]>;
    count(): Promise<number>;
    private findOldestSession;
}
export interface SessionManagerConfig {
    store?: 'memory' | 'sqlite';
    ttlMs?: number;
    cleanupIntervalMs?: number;
    maxSessions?: number;
}
export declare class SessionManager {
    private store;
    private cleanupTimer;
    private readonly config;
    constructor(config?: SessionManagerConfig);
    /**
     * 创建新会话
     */
    createSession(agentId: string): Promise<Session>;
    /**
     * 获取会话
     */
    getSession(sessionId: string): Promise<Session | null>;
    /**
     * 获取或创建会话
     */
    getOrCreateSession(sessionId: string | undefined, agentId: string): Promise<Session>;
    /**
     * 更新会话状态
     */
    updateSessionState(sessionId: string, state: SessionState): Promise<void>;
    /**
     * 添加消息到会话
     */
    addMessage(sessionId: string, message: ChatMessage): Promise<void>;
    /**
     * 更新会话统计
     */
    updateStats(sessionId: string, updates: {
        toolCallCount?: number;
        inputTokens?: number;
        outputTokens?: number;
        skillInvocation?: string;
    }): Promise<void>;
    /**
     * 关闭会话
     */
    closeSession(sessionId: string): Promise<void>;
    /**
     * 删除会话
     */
    deleteSession(sessionId: string): Promise<void>;
    /**
     * 获取所有会话
     */
    getAllSessions(): Promise<Session[]>;
    /**
     * 获取会话数量
     */
    getSessionCount(): Promise<number>;
    /**
     * 启动清理定时任务
     */
    private startCleanupTask;
    /**
     * 停止清理定时任务
     */
    stopCleanupTask(): void;
    /**
     * 销毁会话管理器
     */
    destroy(): Promise<void>;
}
export default SessionManager;
//# sourceMappingURL=session_manager.d.ts.map