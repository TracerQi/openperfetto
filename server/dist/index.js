/**
 * OpenPerfetto Backend Service
 * Fastify 服务入口
 */
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { randomUUID } from 'crypto';
import { getConfig } from './utils/config.js';
import { StructuredLogger, initLogger } from './utils/logger.js';
import { setupWebSocketRoutes, connectionPool, setWebSocketDependencies } from './routes/websocket.js';
import { setupHealthRoutes } from './routes/health.js';
import { LLMProxy } from './services/llm_proxy.js';
import { SessionManager } from './services/session_manager.js';
import { SkillMarkerParser } from './services/skill_marker_parser.js';
// ============= 错误分类 =============
var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["VALIDATION"] = "VALIDATION";
    ErrorCategory["AUTHENTICATION"] = "AUTHENTICATION";
    ErrorCategory["AUTHORIZATION"] = "AUTHORIZATION";
    ErrorCategory["NOT_FOUND"] = "NOT_FOUND";
    ErrorCategory["RATE_LIMIT"] = "RATE_LIMIT";
    ErrorCategory["INTERNAL"] = "INTERNAL";
    ErrorCategory["EXTERNAL_SERVICE"] = "EXTERNAL_SERVICE";
})(ErrorCategory || (ErrorCategory = {}));
function categorizeError(error) {
    const message = error.message.toLowerCase();
    if (message.includes('validation') || message.includes('invalid')) {
        return ErrorCategory.VALIDATION;
    }
    if (message.includes('unauthorized') || message.includes('api key')) {
        return ErrorCategory.AUTHENTICATION;
    }
    if (message.includes('forbidden') || message.includes('permission')) {
        return ErrorCategory.AUTHORIZATION;
    }
    if (message.includes('not found')) {
        return ErrorCategory.NOT_FOUND;
    }
    if (message.includes('rate limit') || message.includes('too many')) {
        return ErrorCategory.RATE_LIMIT;
    }
    if (message.includes('llm') || message.includes('provider')) {
        return ErrorCategory.EXTERNAL_SERVICE;
    }
    return ErrorCategory.INTERNAL;
}
function getStatusCodeForCategory(category) {
    switch (category) {
        case ErrorCategory.VALIDATION:
            return 400;
        case ErrorCategory.AUTHENTICATION:
            return 401;
        case ErrorCategory.AUTHORIZATION:
            return 403;
        case ErrorCategory.NOT_FOUND:
            return 404;
        case ErrorCategory.RATE_LIMIT:
            return 429;
        case ErrorCategory.EXTERNAL_SERVICE:
            return 502;
        default:
            return 500;
    }
}
// ============= 服务构建 =============
async function buildServer(config) {
    const logger = new StructuredLogger('server');
    const server = Fastify({
        logger: false, // 使用自定义结构化日志
        requestTimeout: config.server.requestTimeout || 30000,
        connectionTimeout: config.server.connectionTimeout || 10000,
    });
    // ============= 全局 onRequest 钩子 =============
    server.addHook('onRequest', async (request, reply) => {
        // 生成 traceId（优先使用请求头中的，否则生成新的）
        request.traceId = request.headers['x-trace-id'] || randomUUID();
        request.startTime = process.hrtime.bigint();
        // 从请求中提取 agentId（如果存在）
        request.agentId = request.headers['x-agent-id'];
        // 设置响应头
        reply.header('X-Trace-Id', request.traceId);
    });
    // ============= 全局 onResponse 钩子 =============
    server.addHook('onResponse', async (request, reply) => {
        const duration = Number(process.hrtime.bigint() - request.startTime) / 1e6; // 转换为毫秒
        const logEntry = {
            level: reply.statusCode >= 400 ? 'error' : 'info',
            timestamp: Date.now(),
            module: 'http',
            message: `${request.method} ${request.url} ${reply.statusCode}`,
            traceId: request.traceId,
            agentId: request.agentId,
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            duration: Math.round(duration * 100) / 100, // 保留2位小数
            userAgent: request.headers['user-agent'],
            ip: request.ip,
        };
        logger.logRequest(logEntry);
    });
    // ============= 全局错误处理 setErrorHandler =============
    server.setErrorHandler(async (error, request, reply) => {
        const category = categorizeError(error);
        const statusCode = getStatusCodeForCategory(category);
        const logEntry = {
            level: 'error',
            timestamp: Date.now(),
            module: 'error-handler',
            message: `Request failed: ${error.message}`,
            traceId: request.traceId,
            agentId: request.agentId,
            method: request.method,
            url: request.url,
            statusCode,
            error: {
                code: category,
                message: error.message,
                stack: config.log.level === 'debug' ? error.stack : undefined,
            },
        };
        logger.logRequest(logEntry);
        return reply.status(statusCode).send({
            error: {
                code: category,
                message: error.message,
                traceId: request.traceId,
            },
        });
    });
    // ============= 注册插件 =============
    // CORS
    await server.register(fastifyCors, {
        origin: config.cors.origins,
        credentials: config.cors.credentials,
    });
    // WebSocket
    await server.register(fastifyWebsocket, {
        options: {
            maxPayload: 1048576, // 1MB
        },
    });
    // Rate Limit
    if (config.rateLimit.enabled) {
        await server.register(fastifyRateLimit, {
            max: config.rateLimit.max,
            timeWindow: config.rateLimit.timeWindow,
            errorResponseBuilder: (request, context) => ({
                error: {
                    code: 'RATE_LIMIT',
                    message: `Rate limit exceeded. Max ${context.max} requests per ${config.rateLimit.timeWindow}`,
                    traceId: request.traceId,
                },
            }),
        });
    }
    // ============= 注册路由 =============
    // 初始化服务
    const llmProxy = new LLMProxy(config.llm);
    const sessionManager = new SessionManager(config.session);
    const skillMarkerParser = new SkillMarkerParser();
    // 设置 WebSocket 路由依赖
    setWebSocketDependencies({
        llmProxy,
        sessionManager,
        skillMarkerParser,
    });
    setupWebSocketRoutes(server);
    setupHealthRoutes(server);
    return { server, sessionManager };
}
// ============= 服务启动 =============
async function start() {
    // 加载配置
    const config = getConfig();
    // 初始化日志
    initLogger({
        level: config.log.level,
        prettyPrint: config.log.prettyPrint,
    });
    const logger = new StructuredLogger('main');
    try {
        const { server, sessionManager } = await buildServer(config);
        // 优雅关机处理
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal}, starting graceful shutdown...`);
            // 关闭所有 WebSocket 连接
            connectionPool.closeAll();
            // 清理 SessionManager
            await sessionManager.destroy();
            // 关闭服务器
            await server.close();
            logger.info('Server shutdown complete');
            process.exit(0);
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        // 启动服务器
        await server.listen({
            port: config.server.port,
            host: config.server.host,
        });
        logger.info(`OpenPerfetto Server started`, {
            host: config.server.host,
            port: config.server.port,
            env: process.env.NODE_ENV || 'development',
        });
        logger.info(`WebSocket endpoint: ws://${config.server.host}:${config.server.port}/ws`);
        logger.info(`Health check: http://${config.server.host}:${config.server.port}/api/v1/health`);
    }
    catch (error) {
        logger.fatal('Server startup failed', error);
        process.exit(1);
    }
}
// ============= 入口点 =============
start();
//# sourceMappingURL=index.js.map