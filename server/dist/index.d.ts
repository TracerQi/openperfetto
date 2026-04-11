/**
 * OpenPerfetto Backend Service
 * Fastify 服务入口
 */
import 'dotenv/config';
declare module 'fastify' {
    interface FastifyRequest {
        traceId: string;
        startTime: bigint;
        agentId?: string;
    }
}
//# sourceMappingURL=index.d.ts.map