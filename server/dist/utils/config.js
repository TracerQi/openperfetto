/**
 * 配置加载器
 * 支持 YAML 配置文件、环境变量替换、Zod 验证
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
// ============= LLM Provider 配置 Schema =============
export const LLMProviderConfigSchema = z.object({
    apiKey: z.string().optional(),
    model: z.string(),
    maxTokens: z.number().default(16384),
    baseUrl: z.string().optional(),
});
// ============= 完整配置 Schema =============
export const ServerConfigSchema = z.object({
    server: z.object({
        host: z.string().default('0.0.0.0'),
        port: z.number().default(3001),
        requestTimeout: z.number().default(30000),
        connectionTimeout: z.number().default(10000),
    }),
    cors: z.object({
        origins: z.array(z.string()).default(['http://localhost:10000']),
        credentials: z.boolean().default(true),
    }).default({
        origins: ['http://localhost:10000'],
        credentials: true,
    }),
    websocket: z.object({
        heartbeatInterval: z.number().default(30000), // 30秒
        heartbeatTimeout: z.number().default(90000), // 90秒
        maxConnections: z.number().default(100),
        maxConnectionsPerUser: z.number().default(5),
        maxBufferedAmount: z.number().default(1048576), // 1MB
        zombieCleanupInterval: z.number().default(30000),
    }).default({}),
    llm: z.object({
        defaultProvider: z.string().default('openai'),
        providers: z.record(LLMProviderConfigSchema).default({}),
    }).default({}),
    skills: z.object({
        libraryPath: z.string().default('./skills/library'),
    }).default({}),
    session: z.object({
        store: z.enum(['memory', 'sqlite']).default('memory'),
        ttlMs: z.number().default(86400000), // 24小时
        cleanupIntervalMs: z.number().default(3600000), // 1小时
        maxSessions: z.number().default(10000),
    }).default({}),
    log: z.object({
        level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
        prettyPrint: z.boolean().default(true),
    }).default({}),
    rateLimit: z.object({
        enabled: z.boolean().default(true),
        max: z.number().default(100),
        timeWindow: z.string().default('1 minute'),
    }).default({}),
});
// ============= 环境变量替换 =============
/**
 * 递归替换对象中的环境变量占位符
 * 格式: ${ENV_VAR} 或 ${ENV_VAR:-default}
 */
function substituteEnvVars(obj) {
    if (typeof obj === 'string') {
        // 匹配 ${VAR} 或 ${VAR:-default}
        return obj.replace(/\$\{([^}:-]+)(?::-([^}]*))?\}/g, (_, envVar, defaultValue) => {
            const value = process.env[envVar];
            if (value !== undefined) {
                return value;
            }
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return '';
        });
    }
    if (Array.isArray(obj)) {
        return obj.map(substituteEnvVars);
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = substituteEnvVars(value);
        }
        return result;
    }
    return obj;
}
// ============= 配置加载 =============
/**
 * 加载 YAML 配置文件
 */
function loadYamlFile(filePath) {
    try {
        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
            return null;
        }
        const content = fs.readFileSync(absolutePath, 'utf8');
        return parseYaml(content);
    }
    catch (error) {
        console.error(`Failed to load config file ${filePath}:`, error);
        return null;
    }
}
/**
 * 深度合并对象
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            if (result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key])) {
                result[key] = deepMerge(result[key], value);
            }
            else {
                result[key] = value;
            }
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
/**
 * 加载并验证配置
 */
export function loadConfig(configPath) {
    // 确定配置文件路径
    const defaultConfigPath = process.env.CONFIG_PATH || './config/default.yaml';
    const primaryPath = configPath || defaultConfigPath;
    // 加载主配置文件
    let rawConfig = {};
    const primaryConfig = loadYamlFile(primaryPath);
    if (primaryConfig) {
        rawConfig = primaryConfig;
    }
    // 尝试加载环境特定配置
    const nodeEnv = process.env.NODE_ENV || 'development';
    const envConfigPath = primaryPath.replace('.yaml', `.${nodeEnv}.yaml`);
    const envConfig = loadYamlFile(envConfigPath);
    if (envConfig) {
        rawConfig = deepMerge(rawConfig, envConfig);
    }
    // 替换环境变量
    const configWithEnv = substituteEnvVars(rawConfig);
    // 使用 Zod 验证并返回
    try {
        return ServerConfigSchema.parse(configWithEnv);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Configuration validation failed:');
            for (const issue of error.issues) {
                console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
            }
        }
        throw error;
    }
}
// ============= 配置单例 =============
let configInstance = null;
/**
 * 获取配置实例（单例模式）
 */
export function getConfig() {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}
/**
 * 重新加载配置
 */
export function reloadConfig() {
    configInstance = loadConfig();
    return configInstance;
}
// ============= 默认导出 =============
export const config = getConfig();
export default config;
//# sourceMappingURL=config.js.map