/**
 * 会话管理服务
 * 支持内存存储、定期清理、会话状态管理
 */
import { StructuredLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { createSession as createSessionHelper, isSessionExpired, touchSession, } from '../types/session.js';
const logger = new StructuredLogger('session_manager');
// ============= 内存会话存储实现 =============
export class MemorySessionStore {
    sessions = new Map();
    maxSessions;
    constructor(maxSessions = 10000) {
        this.maxSessions = maxSessions;
    }
    async create(session) {
        // 检查是否超过最大会话数
        if (this.sessions.size >= this.maxSessions) {
            // 清理最旧的会话
            const oldestSession = this.findOldestSession();
            if (oldestSession) {
                this.sessions.delete(oldestSession.id);
                logger.debug('Evicted oldest session due to capacity', {
                    evictedSessionId: oldestSession.id,
                });
            }
        }
        this.sessions.set(session.id, session);
        logger.debug('Session created', { sessionId: session.id });
    }
    async get(sessionId) {
        return this.sessions.get(sessionId) || null;
    }
    async update(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const updatedSession = {
            ...session,
            ...updates,
            updatedAt: Date.now(),
        };
        this.sessions.set(sessionId, updatedSession);
    }
    async delete(sessionId) {
        this.sessions.delete(sessionId);
        logger.debug('Session deleted', { sessionId });
    }
    async cleanup(olderThanMs) {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [sessionId, session] of this.sessions) {
            // 清理过期会话或长时间不活跃的会话
            if (isSessionExpired(session) || now - session.lastActiveAt > olderThanMs) {
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            logger.info('Sessions cleaned up', { cleanedCount });
        }
        return cleanedCount;
    }
    async getAll() {
        return Array.from(this.sessions.values());
    }
    async count() {
        return this.sessions.size;
    }
    findOldestSession() {
        let oldest = null;
        for (const session of this.sessions.values()) {
            if (!oldest || session.lastActiveAt < oldest.lastActiveAt) {
                oldest = session;
            }
        }
        return oldest;
    }
}
// ============= 会话管理器 =============
export class SessionManager {
    store;
    cleanupTimer = null;
    config;
    constructor(config) {
        const serverConfig = getConfig().session;
        this.config = {
            store: config?.store ?? serverConfig.store,
            ttlMs: config?.ttlMs ?? serverConfig.ttlMs,
            cleanupIntervalMs: config?.cleanupIntervalMs ?? serverConfig.cleanupIntervalMs,
            maxSessions: config?.maxSessions ?? serverConfig.maxSessions,
        };
        // 初始化存储
        this.store = new MemorySessionStore(this.config.maxSessions);
        // 启动清理定时任务
        this.startCleanupTask();
        logger.info('SessionManager initialized', {
            store: this.config.store,
            ttlMs: this.config.ttlMs,
            cleanupIntervalMs: this.config.cleanupIntervalMs,
            maxSessions: this.config.maxSessions,
        });
    }
    /**
     * 创建新会话
     */
    async createSession(agentId) {
        const session = createSessionHelper(agentId, this.config.ttlMs);
        await this.store.create(session);
        logger.info('Session created', {
            sessionId: session.id,
            agentId,
        });
        return session;
    }
    /**
     * 获取会话
     */
    async getSession(sessionId) {
        const session = await this.store.get(sessionId);
        if (!session) {
            return null;
        }
        // 检查是否过期
        if (isSessionExpired(session)) {
            await this.store.delete(sessionId);
            return null;
        }
        return session;
    }
    /**
     * 获取或创建会话
     */
    async getOrCreateSession(sessionId, agentId) {
        if (sessionId) {
            const session = await this.getSession(sessionId);
            if (session && session.agentId === agentId) {
                return session;
            }
        }
        return this.createSession(agentId);
    }
    /**
     * 更新会话状态
     */
    async updateSessionState(sessionId, state) {
        await this.store.update(sessionId, {
            state,
            updatedAt: Date.now(),
        });
    }
    /**
     * 添加消息到会话
     */
    async addMessage(sessionId, message) {
        const session = await this.store.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const updatedMessages = [...session.messages, message];
        // 更新会话活跃时间
        const updatedSession = touchSession(session, this.config.ttlMs);
        await this.store.update(sessionId, {
            messages: updatedMessages,
            updatedAt: updatedSession.updatedAt,
            lastActiveAt: updatedSession.lastActiveAt,
            expiresAt: updatedSession.expiresAt,
            state: 'active',
        });
    }
    /**
     * 更新会话统计
     */
    async updateStats(sessionId, updates) {
        const session = await this.store.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const stats = { ...session.stats };
        if (updates.toolCallCount !== undefined) {
            stats.toolCallCount += updates.toolCallCount;
        }
        if (updates.inputTokens !== undefined) {
            stats.totalInputTokens += updates.inputTokens;
        }
        if (updates.outputTokens !== undefined) {
            stats.totalOutputTokens += updates.outputTokens;
        }
        if (updates.skillInvocation) {
            stats.skillInvocations[updates.skillInvocation] =
                (stats.skillInvocations[updates.skillInvocation] || 0) + 1;
        }
        await this.store.update(sessionId, { stats });
    }
    /**
     * 关闭会话
     */
    async closeSession(sessionId) {
        await this.store.update(sessionId, {
            state: 'completed',
            updatedAt: Date.now(),
        });
        logger.info('Session closed', { sessionId });
    }
    /**
     * 删除会话
     */
    async deleteSession(sessionId) {
        await this.store.delete(sessionId);
    }
    /**
     * 获取所有会话
     */
    async getAllSessions() {
        return this.store.getAll();
    }
    /**
     * 获取会话数量
     */
    async getSessionCount() {
        return this.store.count();
    }
    /**
     * 启动清理定时任务
     */
    startCleanupTask() {
        this.cleanupTimer = setInterval(async () => {
            try {
                const cleanedCount = await this.store.cleanup(this.config.ttlMs);
                if (cleanedCount > 0) {
                    logger.debug('Cleanup task completed', { cleanedCount });
                }
            }
            catch (error) {
                logger.error('Cleanup task failed', error);
            }
        }, this.config.cleanupIntervalMs);
    }
    /**
     * 停止清理定时任务
     */
    stopCleanupTask() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            logger.info('Cleanup task stopped');
        }
    }
    /**
     * 销毁会话管理器
     */
    async destroy() {
        this.stopCleanupTask();
        logger.info('SessionManager destroyed');
    }
}
export default SessionManager;
//# sourceMappingURL=session_manager.js.map