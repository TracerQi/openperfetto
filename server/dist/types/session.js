/**
 * 会话数据模型定义
 * 使用 Zod 进行运行时类型验证
 */
import { z } from 'zod';
// ============= 会话状态 =============
export const SessionStateSchema = z.enum([
    'created', // 刚创建
    'active', // 活跃中
    'analyzing', // 分析中
    'completed', // 已完成
    'error', // 错误状态
    'expired', // 已过期
]);
// ============= 会话统计 =============
export const SessionStatsSchema = z.object({
    toolCallCount: z.number().default(0),
    totalInputTokens: z.number().default(0),
    totalOutputTokens: z.number().default(0),
    skillInvocations: z.record(z.number()).default({}),
    verificationResults: z.object({
        l1Issues: z.number().default(0),
        l2Issues: z.number().default(0),
        l3Triggered: z.boolean().default(false),
    }).default({
        l1Issues: 0,
        l2Issues: 0,
        l3Triggered: false,
    }),
});
// ============= 聊天消息 =============
export const ChatMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    timestamp: z.number(),
    toolCall: z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.unknown()),
    }).optional(),
    toolResult: z.object({
        toolCallId: z.string(),
        success: z.boolean(),
        data: z.unknown().optional(),
        error: z.string().optional(),
        artifactRef: z.string().optional(),
    }).optional(),
    metadata: z.object({
        isStreaming: z.boolean().optional(),
    }).optional(),
});
// ============= 会话定义 =============
export const SessionSchema = z.object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    userId: z.string().optional(),
    // 时间戳
    createdAt: z.number(),
    updatedAt: z.number(),
    expiresAt: z.number(),
    lastActiveAt: z.number(),
    // 状态
    state: SessionStateSchema,
    // Trace信息
    traceId: z.string().optional(),
    traceName: z.string().optional(),
    // 对话历史
    messages: z.array(ChatMessageSchema).default([]),
    // 统计信息
    stats: SessionStatsSchema.default({
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        skillInvocations: {},
        verificationResults: {
            l1Issues: 0,
            l2Issues: 0,
            l3Triggered: false,
        },
    }),
    // 元数据
    metadata: z.record(z.unknown()).optional(),
});
// ============= 会话存储配置 =============
export const SessionStoreConfigSchema = z.object({
    type: z.enum(['memory', 'sqlite']).default('memory'),
    sqlitePath: z.string().optional(),
    defaultTtlMs: z.number().default(24 * 60 * 60 * 1000), // 24小时
    cleanupIntervalMs: z.number().default(60 * 60 * 1000), // 1小时
    maxSessions: z.number().optional().default(10000),
});
// ============= 辅助函数 =============
/**
 * 创建新会话
 */
export function createSession(agentId, ttlMs) {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        agentId,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ttlMs,
        lastActiveAt: now,
        state: 'created',
        messages: [],
        stats: {
            toolCallCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            skillInvocations: {},
            verificationResults: {
                l1Issues: 0,
                l2Issues: 0,
                l3Triggered: false,
            },
        },
    };
}
/**
 * 检查会话是否过期
 */
export function isSessionExpired(session) {
    return Date.now() > session.expiresAt;
}
/**
 * 更新会话活跃时间
 */
export function touchSession(session, ttlMs) {
    const now = Date.now();
    return {
        ...session,
        updatedAt: now,
        lastActiveAt: now,
        expiresAt: now + ttlMs,
    };
}
//# sourceMappingURL=session.js.map