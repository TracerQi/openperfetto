/**
 * 配置加载器
 * 支持 YAML 配置文件、环境变量替换、Zod 验证
 */
import { z } from 'zod';
export declare const LLMProviderConfigSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    model: z.ZodString;
    maxTokens: z.ZodDefault<z.ZodNumber>;
    baseUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    maxTokens: number;
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
}, {
    model: string;
    apiKey?: string | undefined;
    maxTokens?: number | undefined;
    baseUrl?: string | undefined;
}>;
export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;
export declare const ServerConfigSchema: z.ZodObject<{
    server: z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        requestTimeout: z.ZodDefault<z.ZodNumber>;
        connectionTimeout: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        host: string;
        port: number;
        requestTimeout: number;
        connectionTimeout: number;
    }, {
        host?: string | undefined;
        port?: number | undefined;
        requestTimeout?: number | undefined;
        connectionTimeout?: number | undefined;
    }>;
    cors: z.ZodDefault<z.ZodObject<{
        origins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        credentials: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        origins: string[];
        credentials: boolean;
    }, {
        origins?: string[] | undefined;
        credentials?: boolean | undefined;
    }>>;
    websocket: z.ZodDefault<z.ZodObject<{
        heartbeatInterval: z.ZodDefault<z.ZodNumber>;
        heartbeatTimeout: z.ZodDefault<z.ZodNumber>;
        maxConnections: z.ZodDefault<z.ZodNumber>;
        maxConnectionsPerUser: z.ZodDefault<z.ZodNumber>;
        maxBufferedAmount: z.ZodDefault<z.ZodNumber>;
        zombieCleanupInterval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        heartbeatInterval: number;
        heartbeatTimeout: number;
        maxConnections: number;
        maxConnectionsPerUser: number;
        maxBufferedAmount: number;
        zombieCleanupInterval: number;
    }, {
        heartbeatInterval?: number | undefined;
        heartbeatTimeout?: number | undefined;
        maxConnections?: number | undefined;
        maxConnectionsPerUser?: number | undefined;
        maxBufferedAmount?: number | undefined;
        zombieCleanupInterval?: number | undefined;
    }>>;
    llm: z.ZodDefault<z.ZodObject<{
        defaultProvider: z.ZodDefault<z.ZodString>;
        providers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodString;
            maxTokens: z.ZodDefault<z.ZodNumber>;
            baseUrl: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            maxTokens: number;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
        }, {
            model: string;
            apiKey?: string | undefined;
            maxTokens?: number | undefined;
            baseUrl?: string | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        defaultProvider: string;
        providers: Record<string, {
            model: string;
            maxTokens: number;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
        }>;
    }, {
        defaultProvider?: string | undefined;
        providers?: Record<string, {
            model: string;
            apiKey?: string | undefined;
            maxTokens?: number | undefined;
            baseUrl?: string | undefined;
        }> | undefined;
    }>>;
    skills: z.ZodDefault<z.ZodObject<{
        libraryPath: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        libraryPath: string;
    }, {
        libraryPath?: string | undefined;
    }>>;
    session: z.ZodDefault<z.ZodObject<{
        store: z.ZodDefault<z.ZodEnum<["memory", "sqlite"]>>;
        ttlMs: z.ZodDefault<z.ZodNumber>;
        cleanupIntervalMs: z.ZodDefault<z.ZodNumber>;
        maxSessions: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        store: "memory" | "sqlite";
        ttlMs: number;
        cleanupIntervalMs: number;
        maxSessions: number;
    }, {
        store?: "memory" | "sqlite" | undefined;
        ttlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        maxSessions?: number | undefined;
    }>>;
    log: z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>>;
        prettyPrint: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        level: "debug" | "info" | "warn" | "error" | "fatal";
        prettyPrint: boolean;
    }, {
        level?: "debug" | "info" | "warn" | "error" | "fatal" | undefined;
        prettyPrint?: boolean | undefined;
    }>>;
    rateLimit: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max: z.ZodDefault<z.ZodNumber>;
        timeWindow: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        max: number;
        timeWindow: string;
    }, {
        enabled?: boolean | undefined;
        max?: number | undefined;
        timeWindow?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    server: {
        host: string;
        port: number;
        requestTimeout: number;
        connectionTimeout: number;
    };
    cors: {
        origins: string[];
        credentials: boolean;
    };
    websocket: {
        heartbeatInterval: number;
        heartbeatTimeout: number;
        maxConnections: number;
        maxConnectionsPerUser: number;
        maxBufferedAmount: number;
        zombieCleanupInterval: number;
    };
    llm: {
        defaultProvider: string;
        providers: Record<string, {
            model: string;
            maxTokens: number;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
        }>;
    };
    skills: {
        libraryPath: string;
    };
    session: {
        store: "memory" | "sqlite";
        ttlMs: number;
        cleanupIntervalMs: number;
        maxSessions: number;
    };
    log: {
        level: "debug" | "info" | "warn" | "error" | "fatal";
        prettyPrint: boolean;
    };
    rateLimit: {
        enabled: boolean;
        max: number;
        timeWindow: string;
    };
}, {
    server: {
        host?: string | undefined;
        port?: number | undefined;
        requestTimeout?: number | undefined;
        connectionTimeout?: number | undefined;
    };
    cors?: {
        origins?: string[] | undefined;
        credentials?: boolean | undefined;
    } | undefined;
    websocket?: {
        heartbeatInterval?: number | undefined;
        heartbeatTimeout?: number | undefined;
        maxConnections?: number | undefined;
        maxConnectionsPerUser?: number | undefined;
        maxBufferedAmount?: number | undefined;
        zombieCleanupInterval?: number | undefined;
    } | undefined;
    llm?: {
        defaultProvider?: string | undefined;
        providers?: Record<string, {
            model: string;
            apiKey?: string | undefined;
            maxTokens?: number | undefined;
            baseUrl?: string | undefined;
        }> | undefined;
    } | undefined;
    skills?: {
        libraryPath?: string | undefined;
    } | undefined;
    session?: {
        store?: "memory" | "sqlite" | undefined;
        ttlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        maxSessions?: number | undefined;
    } | undefined;
    log?: {
        level?: "debug" | "info" | "warn" | "error" | "fatal" | undefined;
        prettyPrint?: boolean | undefined;
    } | undefined;
    rateLimit?: {
        enabled?: boolean | undefined;
        max?: number | undefined;
        timeWindow?: string | undefined;
    } | undefined;
}>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
/**
 * 加载并验证配置
 */
export declare function loadConfig(configPath?: string): ServerConfig;
/**
 * 获取配置实例（单例模式）
 */
export declare function getConfig(): ServerConfig;
/**
 * 重新加载配置
 */
export declare function reloadConfig(): ServerConfig;
export declare const config: {
    server: {
        host: string;
        port: number;
        requestTimeout: number;
        connectionTimeout: number;
    };
    cors: {
        origins: string[];
        credentials: boolean;
    };
    websocket: {
        heartbeatInterval: number;
        heartbeatTimeout: number;
        maxConnections: number;
        maxConnectionsPerUser: number;
        maxBufferedAmount: number;
        zombieCleanupInterval: number;
    };
    llm: {
        defaultProvider: string;
        providers: Record<string, {
            model: string;
            maxTokens: number;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
        }>;
    };
    skills: {
        libraryPath: string;
    };
    session: {
        store: "memory" | "sqlite";
        ttlMs: number;
        cleanupIntervalMs: number;
        maxSessions: number;
    };
    log: {
        level: "debug" | "info" | "warn" | "error" | "fatal";
        prettyPrint: boolean;
    };
    rateLimit: {
        enabled: boolean;
        max: number;
        timeWindow: string;
    };
};
export default config;
//# sourceMappingURL=config.d.ts.map