/**
 * 健康检查路由
 * GET /api/v1/health - 返回服务状态信息
 */
import { connectionPool } from './websocket.js';
// ============= 服务启动时间 =============
const startTime = Date.now();
// ============= 版本信息 =============
const VERSION = process.env.npm_package_version || '0.1.0';
// ============= 辅助函数 =============
/**
 * 格式化运行时间
 */
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}
/**
 * 获取内存使用情况
 */
function getMemoryUsage() {
    const mem = process.memoryUsage();
    return {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100, // MB
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100, // MB
        external: Math.round(mem.external / 1024 / 1024 * 100) / 100, // MB
        rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100, // MB
    };
}
// ============= 路由注册 =============
/**
 * 注册健康检查路由
 */
export function setupHealthRoutes(server) {
    // 主健康检查端点
    server.get('/api/v1/health', async (request, reply) => {
        const now = Date.now();
        const uptime = now - startTime;
        const response = {
            status: 'ok',
            timestamp: now,
            traceId: request.traceId || 'unknown',
            version: VERSION,
            uptime,
            uptimeFormatted: formatUptime(uptime),
            connections: {
                websocket: connectionPool.size(),
            },
            memory: getMemoryUsage(),
        };
        return reply.send(response);
    });
    // 简单的存活探针（用于 k8s liveness probe）
    server.get('/api/v1/health/live', async (_request, reply) => {
        return reply.send({ status: 'ok' });
    });
    // 就绪探针（用于 k8s readiness probe）
    server.get('/api/v1/health/ready', async (_request, reply) => {
        // 在这里可以添加更多就绪检查，比如数据库连接等
        // Phase 1 简单返回 ok
        return reply.send({ status: 'ok' });
    });
}
export default setupHealthRoutes;
//# sourceMappingURL=health.js.map