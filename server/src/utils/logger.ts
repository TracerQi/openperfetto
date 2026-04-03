/**
 * 结构化日志系统
 * 基于 pino 的高性能日志，支持 traceId 上下文
 */

import pino, { Logger as PinoLogger } from 'pino';

// ============= 日志级别 =============

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ============= 日志条目接口 =============

export interface LogEntry {
  level: LogLevel;
  timestamp: number;
  module: string;
  message: string;
  traceId?: string;
  agentId?: string;
  [key: string]: unknown;
}

// ============= 请求日志条目接口 =============

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

// ============= Logger 配置 =============

export interface LoggerConfig {
  level: LogLevel;
  prettyPrint: boolean;
}

// ============= 全局 logger 实例 =============

let globalLogger: PinoLogger;

/**
 * 初始化全局 logger
 */
export function initLogger(config: LoggerConfig): void {
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
function getLogger(): PinoLogger {
  if (!globalLogger) {
    // 默认初始化
    initLogger({
      level: (process.env.LOG_LEVEL as LogLevel) || 'info',
      prettyPrint: process.env.NODE_ENV !== 'production',
    });
  }
  return globalLogger;
}

// ============= 结构化日志类 =============

export class StructuredLogger {
  private module: string;
  private defaultContext: Record<string, unknown>;
  
  constructor(module: string, defaultContext: Record<string, unknown> = {}) {
    this.module = module;
    this.defaultContext = defaultContext;
  }
  
  /**
   * 创建带有额外上下文的子 logger
   */
  child(context: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.module, {
      ...this.defaultContext,
      ...context,
    });
  }
  
  /**
   * 创建带有 traceId 的子 logger
   */
  withTraceId(traceId: string): StructuredLogger {
    return this.child({ traceId });
  }
  
  /**
   * 输出结构化日志
   */
  logStructured(entry: LogEntry): void {
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
  debug(message: string, data?: Record<string, unknown>): void {
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
  info(message: string, data?: Record<string, unknown>): void {
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
  warn(message: string, data?: Record<string, unknown>): void {
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
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
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
  fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
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
  logRequest(entry: RequestLogEntry): void {
    this.logStructured(entry);
  }
}

// ============= 导出默认 logger =============

export const logger = new StructuredLogger('server');

export default StructuredLogger;
