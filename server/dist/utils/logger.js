/**
 * 结构化日志系统
 * 基于 pino 的高性能日志，支持 traceId 上下文
 */
import pino from 'pino';
// ============= 全局 logger 实例 =============
let globalLogger;
/**
 * 初始化全局 logger
 */
export function initLogger(config) {
    const isDev = process.env.NODE_ENV !== 'production';
    globalLogger = pino({
        level: config.level || 'info',
        transport: (isDev && config.prettyPrint) ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        } : undefined,
        formatters: {
            level: (label) => ({ level: label }),
        },
        timestamp: () => `,"timestamp":${Date.now()}`,
    });
}
/**
 * 获取全局 logger
 */
function getLogger() {
    if (!globalLogger) {
        // 默认初始化
        initLogger({
            level: process.env.LOG_LEVEL || 'info',
            prettyPrint: process.env.NODE_ENV !== 'production',
        });
    }
    return globalLogger;
}
// ============= 结构化日志类 =============
export class StructuredLogger {
    module;
    defaultContext;
    constructor(module, defaultContext = {}) {
        this.module = module;
        this.defaultContext = defaultContext;
    }
    /**
     * 创建带有额外上下文的子 logger
     */
    child(context) {
        return new StructuredLogger(this.module, {
            ...this.defaultContext,
            ...context,
        });
    }
    /**
     * 创建带有 traceId 的子 logger
     */
    withTraceId(traceId) {
        return this.child({ traceId });
    }
    /**
     * 输出结构化日志
     */
    logStructured(entry) {
        const logger = getLogger();
        const { module: entryModule, ...restEntry } = entry;
        const logData = {
            ...this.defaultContext,
            ...restEntry,
            module: entryModule || this.module,
        };
        // 移除 level、message 和 timestamp，因为 pino 会自动处理
        const { level, message, timestamp, ...rest } = logData;
        switch (entry.level) {
            case 'debug':
                logger.debug(rest, message);
                break;
            case 'info':
                logger.info(rest, message);
                break;
            case 'warn':
                logger.warn(rest, message);
                break;
            case 'error':
                logger.error(rest, message);
                break;
            case 'fatal':
                logger.fatal(rest, message);
                break;
        }
    }
    /**
     * Debug 级别日志
     */
    debug(message, data) {
        this.logStructured({
            level: 'debug',
            timestamp: Date.now(),
            module: this.module,
            message,
            ...data,
        });
    }
    /**
     * Info 级别日志
     */
    info(message, data) {
        this.logStructured({
            level: 'info',
            timestamp: Date.now(),
            module: this.module,
            message,
            ...data,
        });
    }
    /**
     * Warn 级别日志
     */
    warn(message, data) {
        this.logStructured({
            level: 'warn',
            timestamp: Date.now(),
            module: this.module,
            message,
            ...data,
        });
    }
    /**
     * Error 级别日志
     */
    error(message, error, data) {
        const errorData = error instanceof Error ? {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        } : error ? { error } : {};
        this.logStructured({
            level: 'error',
            timestamp: Date.now(),
            module: this.module,
            message,
            ...errorData,
            ...data,
        });
    }
    /**
     * Fatal 级别日志
     */
    fatal(message, error, data) {
        const errorData = error instanceof Error ? {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        } : error ? { error } : {};
        this.logStructured({
            level: 'fatal',
            timestamp: Date.now(),
            module: this.module,
            message,
            ...errorData,
            ...data,
        });
    }
    /**
     * 记录请求日志
     */
    logRequest(entry) {
        this.logStructured(entry);
    }
}
// ============= 导出默认 logger =============
export const logger = new StructuredLogger('server');
export default StructuredLogger;
//# sourceMappingURL=logger.js.map