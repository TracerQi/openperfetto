/**
 * 结构化日志系统
 * 基于 pino 的高性能日志，支持 traceId 上下文
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LogEntry {
    level: LogLevel;
    timestamp: number;
    module: string;
    message: string;
    traceId?: string;
    agentId?: string;
    [key: string]: unknown;
}
export interface RequestLogEntry extends LogEntry {
    method: string;
    url: string;
    statusCode?: number;
    duration?: number;
    userAgent?: string;
    ip?: string;
    error?: {
        code: string;
        message: string;
        stack?: string;
    };
}
export interface LoggerConfig {
    level: LogLevel;
    prettyPrint: boolean;
}
/**
 * 初始化全局 logger
 */
export declare function initLogger(config: LoggerConfig): void;
export declare class StructuredLogger {
    private module;
    private defaultContext;
    constructor(module: string, defaultContext?: Record<string, unknown>);
    /**
     * 创建带有额外上下文的子 logger
     */
    child(context: Record<string, unknown>): StructuredLogger;
    /**
     * 创建带有 traceId 的子 logger
     */
    withTraceId(traceId: string): StructuredLogger;
    /**
     * 输出结构化日志
     */
    logStructured(entry: LogEntry): void;
    /**
     * Debug 级别日志
     */
    debug(message: string, data?: Record<string, unknown>): void;
    /**
     * Info 级别日志
     */
    info(message: string, data?: Record<string, unknown>): void;
    /**
     * Warn 级别日志
     */
    warn(message: string, data?: Record<string, unknown>): void;
    /**
     * Error 级别日志
     */
    error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;
    /**
     * Fatal 级别日志
     */
    fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;
    /**
     * 记录请求日志
     */
    logRequest(entry: RequestLogEntry): void;
}
export declare const logger: StructuredLogger;
export default StructuredLogger;
//# sourceMappingURL=logger.d.ts.map