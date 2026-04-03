/**
 * 会话管理服务
 * 支持内存存储、定期清理、会话状态管理
 */

import { StructuredLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import {
  Session,
  ChatMessage,
  SessionState,
  createSession as createSessionHelper,
  isSessionExpired,
  touchSession,
} from '../types/session.js';

const logger = new StructuredLogger('session_manager');

// ============= 会话存储接口 =============

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

// ============= 内存会话存储实现 =============

export class MemorySessionStore implements ISessionStore {
  private sessions: Map<string, Session> = new Map();
  private readonly maxSessions: number;
  
  constructor(maxSessions = 10000) {
    this.maxSessions = maxSessions;
  }
  
  async create(session: Session): Promise<void> {
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
  
  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }
  
  async update(sessionId: string, updates: Partial<Session>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    const updatedSession: Session = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };
    
    this.sessions.set(sessionId, updatedSession);
  }
  
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    logger.debug('Session deleted', { sessionId });
  }
  
  async cleanup(olderThanMs: number): Promise<number> {
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
  
  async getAll(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }
  
  async count(): Promise<number> {
    return this.sessions.size;
  }
  
  private findOldestSession(): Session | null {
    let oldest: Session | null = null;
    
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastActiveAt < oldest.lastActiveAt) {
        oldest = session;
      }
    }
    
    return oldest;
  }
}

// ============= 会话管理器配置 =============

export interface SessionManagerConfig {
  store?: 'memory' | 'sqlite';
  ttlMs?: number;           // 会话 TTL（毫秒）
  cleanupIntervalMs?: number; // 清理间隔（毫秒）
  maxSessions?: number;     // 最大会话数
}

// ============= 会话管理器 =============

export class SessionManager {
  private store: ISessionStore;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly config: Required<SessionManagerConfig>;
  
  constructor(config?: SessionManagerConfig) {
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
  async createSession(agentId: string): Promise<Session> {
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
  async getSession(sessionId: string): Promise<Session | null> {
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
  async getOrCreateSession(sessionId: string | undefined, agentId: string): Promise<Session> {
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
  async updateSessionState(sessionId: string, state: SessionState): Promise<void> {
    await this.store.update(sessionId, {
      state,
      updatedAt: Date.now(),
    });
  }
  
  /**
   * 添加消息到会话
   */
  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
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
  async updateStats(
    sessionId: string,
    updates: {
      toolCallCount?: number;
      inputTokens?: number;
      outputTokens?: number;
      skillInvocation?: string;
    }
  ): Promise<void> {
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
  async closeSession(sessionId: string): Promise<void> {
    await this.store.update(sessionId, {
      state: 'completed',
      updatedAt: Date.now(),
    });
    
    logger.info('Session closed', { sessionId });
  }
  
  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }
  
  /**
   * 获取所有会话
   */
  async getAllSessions(): Promise<Session[]> {
    return this.store.getAll();
  }
  
  /**
   * 获取会话数量
   */
  async getSessionCount(): Promise<number> {
    return this.store.count();
  }
  
  /**
   * 启动清理定时任务
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        const cleanedCount = await this.store.cleanup(this.config.ttlMs);
        if (cleanedCount > 0) {
          logger.debug('Cleanup task completed', { cleanedCount });
        }
      } catch (error) {
        logger.error('Cleanup task failed', error as Error);
      }
    }, this.config.cleanupIntervalMs);
  }
  
  /**
   * 停止清理定时任务
   */
  stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('Cleanup task stopped');
    }
  }
  
  /**
   * 销毁会话管理器
   */
  async destroy(): Promise<void> {
    this.stopCleanupTask();
    logger.info('SessionManager destroyed');
  }
}

export default SessionManager;
