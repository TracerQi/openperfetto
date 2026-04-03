/**
 * SessionManager 测试
 * 测试会话创建、获取、更新、删除和清理
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { SessionManager, MemorySessionStore } from '../../src/services/session_manager.js';
import { Session, SessionState } from '../../src/types/session.js';
import * as crypto from 'crypto';

// Mock crypto.randomUUID for Node.js < 19
if (!globalThis.crypto) {
  (globalThis as any).crypto = {
    randomUUID: () => crypto.randomUUID(),
  };
}

// Mock config 模块
jest.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    session: {
      store: 'memory',
      ttlMs: 1000, // 1秒 TTL，方便测试
      cleanupIntervalMs: 60000,
      maxSessions: 100,
    },
  }),
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  StructuredLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withTraceId: jest.fn().mockReturnThis(),
  })),
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new SessionManager({
      ttlMs: 1000,
      cleanupIntervalMs: 60000,
      maxSessions: 100,
    });
  });

  afterEach(async () => {
    await manager.destroy();
    jest.useRealTimers();
  });

  // ============= 创建会话测试 =============
  describe('createSession', () => {
    it('should create a new session', async () => {
      const agentId = '550e8400-e29b-41d4-a716-446655440000';
      const session = await manager.createSession(agentId);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.agentId).toBe(agentId);
      expect(session.state).toBe('created');
      expect(session.messages).toEqual([]);
    });

    it('should set correct timestamps', async () => {
      const now = Date.now();
      jest.setSystemTime(now);

      const session = await manager.createSession('agent-1');

      expect(session.createdAt).toBe(now);
      expect(session.updatedAt).toBe(now);
      expect(session.lastActiveAt).toBe(now);
      expect(session.expiresAt).toBe(now + 1000); // TTL = 1000ms
    });

    it('should initialize stats correctly', async () => {
      const session = await manager.createSession('agent-1');

      expect(session.stats).toEqual({
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        skillInvocations: {},
        verificationResults: {
          l1Issues: 0,
          l2Issues: 0,
          l3Triggered: false,
        },
      });
    });
  });

  // ============= 获取会话测试 =============
  describe('getSession', () => {
    it('should return existing session', async () => {
      const session = await manager.createSession('agent-1');
      const retrieved = await manager.getSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
    });

    it('should return null for non-existent session', async () => {
      const result = await manager.getSession('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const session = await manager.createSession('agent-1');

      // 前进时间超过 TTL
      jest.advanceTimersByTime(2000);

      const result = await manager.getSession(session.id);
      expect(result).toBeNull();
    });
  });

  // ============= getOrCreateSession 测试 =============
  describe('getOrCreateSession', () => {
    it('should return existing session if valid', async () => {
      const agentId = 'agent-1';
      const existing = await manager.createSession(agentId);

      const session = await manager.getOrCreateSession(existing.id, agentId);

      expect(session.id).toBe(existing.id);
    });

    it('should create new session if sessionId is undefined', async () => {
      const session = await manager.getOrCreateSession(undefined, 'agent-1');

      expect(session).toBeDefined();
      expect(session.agentId).toBe('agent-1');
    });

    it('should create new session if existing session has different agentId', async () => {
      const existing = await manager.createSession('agent-1');

      const session = await manager.getOrCreateSession(existing.id, 'agent-2');

      expect(session.id).not.toBe(existing.id);
      expect(session.agentId).toBe('agent-2');
    });

    it('should create new session if existing session expired', async () => {
      const existing = await manager.createSession('agent-1');
      jest.advanceTimersByTime(2000);

      const session = await manager.getOrCreateSession(existing.id, 'agent-1');

      expect(session.id).not.toBe(existing.id);
    });
  });

  // ============= 更新会话状态测试 =============
  describe('updateSessionState', () => {
    it('should update session state', async () => {
      const session = await manager.createSession('agent-1');

      await manager.updateSessionState(session.id, 'active');

      const updated = await manager.getSession(session.id);
      expect(updated?.state).toBe('active');
    });

    it('should update updatedAt timestamp', async () => {
      const session = await manager.createSession('agent-1');
      const originalUpdatedAt = session.updatedAt;

      jest.advanceTimersByTime(100);
      await manager.updateSessionState(session.id, 'analyzing');

      const updated = await manager.getSession(session.id);
      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  // ============= 添加消息测试 =============
  describe('addMessage', () => {
    it('should add message to session', async () => {
      const session = await manager.createSession('agent-1');

      const message = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now(),
      };

      await manager.addMessage(session.id, message);

      const updated = await manager.getSession(session.id);
      expect(updated?.messages).toHaveLength(1);
      expect(updated?.messages[0].content).toBe('Hello');
    });

    it('should update session activity on addMessage', async () => {
      const session = await manager.createSession('agent-1');
      const originalLastActive = session.lastActiveAt;

      jest.advanceTimersByTime(100);

      await manager.addMessage(session.id, {
        id: 'msg-1',
        role: 'user',
        content: 'test',
        timestamp: Date.now(),
      });

      const updated = await manager.getSession(session.id);
      expect(updated?.lastActiveAt).toBeGreaterThan(originalLastActive);
    });

    it('should throw for non-existent session', async () => {
      const message = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now(),
      };

      await expect(manager.addMessage('non-existent', message)).rejects.toThrow(
        /Session not found/
      );
    });

    it('should set session state to active', async () => {
      const session = await manager.createSession('agent-1');
      expect(session.state).toBe('created');

      await manager.addMessage(session.id, {
        id: 'msg-1',
        role: 'user',
        content: 'test',
        timestamp: Date.now(),
      });

      const updated = await manager.getSession(session.id);
      expect(updated?.state).toBe('active');
    });
  });

  // ============= 更新统计信息测试 =============
  describe('updateStats', () => {
    it('should increment tool call count', async () => {
      const session = await manager.createSession('agent-1');

      await manager.updateStats(session.id, { toolCallCount: 1 });

      const updated = await manager.getSession(session.id);
      expect(updated?.stats.toolCallCount).toBe(1);
    });

    it('should accumulate token counts', async () => {
      const session = await manager.createSession('agent-1');

      await manager.updateStats(session.id, { inputTokens: 100 });
      await manager.updateStats(session.id, { inputTokens: 50, outputTokens: 75 });

      const updated = await manager.getSession(session.id);
      expect(updated?.stats.totalInputTokens).toBe(150);
      expect(updated?.stats.totalOutputTokens).toBe(75);
    });

    it('should track skill invocations', async () => {
      const session = await manager.createSession('agent-1');

      await manager.updateStats(session.id, { skillInvocation: 'query-slices' });
      await manager.updateStats(session.id, { skillInvocation: 'query-slices' });
      await manager.updateStats(session.id, { skillInvocation: 'query-threads' });

      const updated = await manager.getSession(session.id);
      expect(updated?.stats.skillInvocations['query-slices']).toBe(2);
      expect(updated?.stats.skillInvocations['query-threads']).toBe(1);
    });
  });

  // ============= 关闭和删除会话测试 =============
  describe('closeSession', () => {
    it('should set session state to completed', async () => {
      const session = await manager.createSession('agent-1');

      await manager.closeSession(session.id);

      const updated = await manager.getSession(session.id);
      expect(updated?.state).toBe('completed');
    });
  });

  describe('deleteSession', () => {
    it('should remove session', async () => {
      const session = await manager.createSession('agent-1');

      await manager.deleteSession(session.id);

      const result = await manager.getSession(session.id);
      expect(result).toBeNull();
    });
  });

  // ============= 会话列表和计数测试 =============
  describe('getAllSessions', () => {
    it('should return all sessions', async () => {
      await manager.createSession('agent-1');
      await manager.createSession('agent-2');
      await manager.createSession('agent-3');

      const sessions = await manager.getAllSessions();
      expect(sessions).toHaveLength(3);
    });
  });

  describe('getSessionCount', () => {
    it('should return correct session count', async () => {
      expect(await manager.getSessionCount()).toBe(0);

      await manager.createSession('agent-1');
      await manager.createSession('agent-2');

      expect(await manager.getSessionCount()).toBe(2);

      await manager.deleteSession((await manager.getAllSessions())[0].id);

      expect(await manager.getSessionCount()).toBe(1);
    });
  });

  // ============= 清理任务测试 =============
  describe('Cleanup Task', () => {
    it('should stop cleanup task on destroy', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await manager.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should stop cleanup task manually', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      manager.stopCleanupTask();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});

// ============= MemorySessionStore 独立测试 =============
describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore(3); // 最大3个会话
  });

  describe('capacity management', () => {
    it('should evict oldest session when capacity exceeded', async () => {
      const now = Date.now();

      // 创建3个会话
      const session1: Session = {
        id: 'session-1',
        agentId: 'agent-1',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10000,
        lastActiveAt: now,
        state: 'created',
        messages: [],
        stats: {
          toolCallCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          skillInvocations: {},
          verificationResults: { l1Issues: 0, l2Issues: 0, l3Triggered: false },
        },
      };

      const session2 = { ...session1, id: 'session-2', lastActiveAt: now + 100 };
      const session3 = { ...session1, id: 'session-3', lastActiveAt: now + 200 };

      await store.create(session1);
      await store.create(session2);
      await store.create(session3);

      expect(await store.count()).toBe(3);

      // 添加第4个会话，应该驱逐 session1（最旧的）
      const session4 = { ...session1, id: 'session-4', lastActiveAt: now + 300 };
      await store.create(session4);

      expect(await store.count()).toBe(3);
      expect(await store.get('session-1')).toBeNull();
      expect(await store.get('session-4')).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired sessions', async () => {
      const now = Date.now();

      const activeSession: Session = {
        id: 'active',
        agentId: 'agent-1',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10000,
        lastActiveAt: now,
        state: 'created',
        messages: [],
        stats: {
          toolCallCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          skillInvocations: {},
          verificationResults: { l1Issues: 0, l2Issues: 0, l3Triggered: false },
        },
      };

      const expiredSession: Session = {
        ...activeSession,
        id: 'expired',
        expiresAt: now - 1000, // 已过期
        lastActiveAt: now - 5000,
      };

      await store.create(activeSession);
      await store.create(expiredSession);

      expect(await store.count()).toBe(2);

      const cleaned = await store.cleanup(1000);

      expect(cleaned).toBe(1);
      expect(await store.count()).toBe(1);
      expect(await store.get('active')).not.toBeNull();
      expect(await store.get('expired')).toBeNull();
    });
  });

  describe('update', () => {
    it('should throw for non-existent session', async () => {
      await expect(store.update('non-existent', { state: 'active' })).rejects.toThrow(
        /Session not found/
      );
    });
  });
});
