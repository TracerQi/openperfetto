/**
 * OpenPerfetto Backend Service
 * Fastify 服务入口
 */
declare module 'fastify' {
    interface FastifyRequest {
        traceId: string;
        startTime: bigint;
        agentId?: string;
    }
}
export {};
//# sourceMappingURL=index.d.ts.map