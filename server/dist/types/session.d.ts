/**
 * 会话数据模型定义
 * 使用 Zod 进行运行时类型验证
 */
import { z } from 'zod';
export declare const SessionStateSchema: z.ZodEnum<["created", "active", "analyzing", "completed", "error", "expired"]>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export declare const SessionStatsSchema: z.ZodObject<{
    toolCallCount: z.ZodDefault<z.ZodNumber>;
    totalInputTokens: z.ZodDefault<z.ZodNumber>;
    totalOutputTokens: z.ZodDefault<z.ZodNumber>;
    skillInvocations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    verificationResults: z.ZodDefault<z.ZodObject<{
        l1Issues: z.ZodDefault<z.ZodNumber>;
        l2Issues: z.ZodDefault<z.ZodNumber>;
        l3Triggered: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        l1Issues: number;
        l2Issues: number;
        l3Triggered: boolean;
    }, {
        l1Issues?: number | undefined;
        l2Issues?: number | undefined;
        l3Triggered?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    toolCallCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    skillInvocations: Record<string, number>;
    verificationResults: {
        l1Issues: number;
        l2Issues: number;
        l3Triggered: boolean;
    };
}, {
    toolCallCount?: number | undefined;
    totalInputTokens?: number | undefined;
    totalOutputTokens?: number | undefined;
    skillInvocations?: Record<string, number> | undefined;
    verificationResults?: {
        l1Issues?: number | undefined;
        l2Issues?: number | undefined;
        l3Triggered?: boolean | undefined;
    } | undefined;
}>;
export type SessionStats = z.infer<typeof SessionStatsSchema>;
export declare const ChatMessageSchema: z.ZodObject<{
    id: z.ZodString;
    role: z.ZodEnum<["user", "assistant", "system", "tool"]>;
    content: z.ZodString;
    timestamp: z.ZodNumber;
    toolCall: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }>>;
    toolResult: z.ZodOptional<z.ZodObject<{
        toolCallId: z.ZodString;
        success: z.ZodBoolean;
        data: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        artifactRef: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
        artifactRef?: string | undefined;
    }, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
        artifactRef?: string | undefined;
    }>>;
    metadata: z.ZodOptional<z.ZodObject<{
        isStreaming: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        isStreaming?: boolean | undefined;
    }, {
        isStreaming?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    id: string;
    toolCall?: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    } | undefined;
    toolResult?: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
        artifactRef?: string | undefined;
    } | undefined;
    metadata?: {
        isStreaming?: boolean | undefined;
    } | undefined;
}, {
    timestamp: number;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    id: string;
    toolCall?: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    } | undefined;
    toolResult?: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
        artifactRef?: string | undefined;
    } | undefined;
    metadata?: {
        isStreaming?: boolean | undefined;
    } | undefined;
}>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export declare const SessionSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
    expiresAt: z.ZodNumber;
    lastActiveAt: z.ZodNumber;
    state: z.ZodEnum<["created", "active", "analyzing", "completed", "error", "expired"]>;
    traceId: z.ZodOptional<z.ZodString>;
    traceName: z.ZodOptional<z.ZodString>;
    messages: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        role: z.ZodEnum<["user", "assistant", "system", "tool"]>;
        content: z.ZodString;
        timestamp: z.ZodNumber;
        toolCall: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        }, {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        }>>;
        toolResult: z.ZodOptional<z.ZodObject<{
            toolCallId: z.ZodString;
            success: z.ZodBoolean;
            data: z.ZodOptional<z.ZodUnknown>;
            error: z.ZodOptional<z.ZodString>;
            artifactRef: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        }, {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        }>>;
        metadata: z.ZodOptional<z.ZodObject<{
            isStreaming: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            isStreaming?: boolean | undefined;
        }, {
            isStreaming?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        timestamp: number;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        id: string;
        toolCall?: {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        } | undefined;
        toolResult?: {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        } | undefined;
        metadata?: {
            isStreaming?: boolean | undefined;
        } | undefined;
    }, {
        timestamp: number;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        id: string;
        toolCall?: {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        } | undefined;
        toolResult?: {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        } | undefined;
        metadata?: {
            isStreaming?: boolean | undefined;
        } | undefined;
    }>, "many">>;
    stats: z.ZodDefault<z.ZodObject<{
        toolCallCount: z.ZodDefault<z.ZodNumber>;
        totalInputTokens: z.ZodDefault<z.ZodNumber>;
        totalOutputTokens: z.ZodDefault<z.ZodNumber>;
        skillInvocations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        verificationResults: z.ZodDefault<z.ZodObject<{
            l1Issues: z.ZodDefault<z.ZodNumber>;
            l2Issues: z.ZodDefault<z.ZodNumber>;
            l3Triggered: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            l1Issues: number;
            l2Issues: number;
            l3Triggered: boolean;
        }, {
            l1Issues?: number | undefined;
            l2Issues?: number | undefined;
            l3Triggered?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        toolCallCount: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        skillInvocations: Record<string, number>;
        verificationResults: {
            l1Issues: number;
            l2Issues: number;
            l3Triggered: boolean;
        };
    }, {
        toolCallCount?: number | undefined;
        totalInputTokens?: number | undefined;
        totalOutputTokens?: number | undefined;
        skillInvocations?: Record<string, number> | undefined;
        verificationResults?: {
            l1Issues?: number | undefined;
            l2Issues?: number | undefined;
            l3Triggered?: boolean | undefined;
        } | undefined;
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    agentId: string;
    id: string;
    messages: {
        timestamp: number;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        id: string;
        toolCall?: {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        } | undefined;
        toolResult?: {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        } | undefined;
        metadata?: {
            isStreaming?: boolean | undefined;
        } | undefined;
    }[];
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    lastActiveAt: number;
    state: "error" | "created" | "active" | "analyzing" | "completed" | "expired";
    stats: {
        toolCallCount: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        skillInvocations: Record<string, number>;
        verificationResults: {
            l1Issues: number;
            l2Issues: number;
            l3Triggered: boolean;
        };
    };
    traceId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    userId?: string | undefined;
    traceName?: string | undefined;
}, {
    agentId: string;
    id: string;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    lastActiveAt: number;
    state: "error" | "created" | "active" | "analyzing" | "completed" | "expired";
    traceId?: string | undefined;
    messages?: {
        timestamp: number;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        id: string;
        toolCall?: {
            name: string;
            id: string;
            arguments: Record<string, unknown>;
        } | undefined;
        toolResult?: {
            toolCallId: string;
            success: boolean;
            error?: string | undefined;
            data?: unknown;
            artifactRef?: string | undefined;
        } | undefined;
        metadata?: {
            isStreaming?: boolean | undefined;
        } | undefined;
    }[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    userId?: string | undefined;
    traceName?: string | undefined;
    stats?: {
        toolCallCount?: number | undefined;
        totalInputTokens?: number | undefined;
        totalOutputTokens?: number | undefined;
        skillInvocations?: Record<string, number> | undefined;
        verificationResults?: {
            l1Issues?: number | undefined;
            l2Issues?: number | undefined;
            l3Triggered?: boolean | undefined;
        } | undefined;
    } | undefined;
}>;
export type Session = z.infer<typeof SessionSchema>;
export declare const SessionStoreConfigSchema: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<["memory", "sqlite"]>>;
    sqlitePath: z.ZodOptional<z.ZodString>;
    defaultTtlMs: z.ZodDefault<z.ZodNumber>;
    cleanupIntervalMs: z.ZodDefault<z.ZodNumber>;
    maxSessions: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    type: "memory" | "sqlite";
    cleanupIntervalMs: number;
    maxSessions: number;
    defaultTtlMs: number;
    sqlitePath?: string | undefined;
}, {
    type?: "memory" | "sqlite" | undefined;
    cleanupIntervalMs?: number | undefined;
    maxSessions?: number | undefined;
    sqlitePath?: string | undefined;
    defaultTtlMs?: number | undefined;
}>;
export type SessionStoreConfig = z.infer<typeof SessionStoreConfigSchema>;
/**
 * 创建新会话
 */
export declare function createSession(agentId: string, ttlMs: number): Session;
/**
 * 检查会话是否过期
 */
export declare function isSessionExpired(session: Session): boolean;
/**
 * 更新会话活跃时间
 */
export declare function touchSession(session: Session, ttlMs: number): Session;
//# sourceMappingURL=session.d.ts.map