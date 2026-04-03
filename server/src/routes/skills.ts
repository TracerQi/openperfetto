/**
 * Skills REST API 路由
 * 提供 Skill 列表、详情、执行接口
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { StructuredLogger } from '../utils/logger.js';
import { SkillRegistry, SearchOptions } from '../services/skill_registry.js';
import { SkillProcessor, SkillExecutionRequest } from '../services/skill_processor.js';
import { SceneTypeEnum, SkillTypeEnum } from '../services/yaml_parser.js';

const logger = new StructuredLogger('skills_api');

// ============= 请求参数 Schema =============

const ListSkillsQuerySchema = z.object({
  scene: SceneTypeEnum.optional(),
  type: SkillTypeEnum.optional(),
  tags: z.string().optional(), // 逗号分隔
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ExecuteSkillBodySchema = z.object({
  parameters: z.record(z.unknown()).default({}),
});

// ============= 路由依赖 =============

export interface SkillsRouteDependencies {
  skillRegistry: SkillRegistry;
  skillProcessor: SkillProcessor;
}

let dependencies: SkillsRouteDependencies | null = null;

/**
 * 设置 Skills 路由依赖
 */
export function setSkillsRouteDependencies(deps: SkillsRouteDependencies): void {
  dependencies = deps;
  logger.info('Skills route dependencies configured');
}

// ============= 路由注册 =============

/**
 * 注册 Skills REST API 路由
 */
export function setupSkillsRoutes(server: FastifyInstance): void {
  const prefix = '/api/v1/skills';

  /**
   * GET /api/v1/skills - 列出所有 Skill
   */
  server.get(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    try {
      // 解析查询参数
      const queryResult = ListSkillsQuerySchema.safeParse(request.query);
      
      if (!queryResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: queryResult.error.issues,
          },
        });
      }

      const { scene, type, tags, query, limit } = queryResult.data;

      // 构建搜索选项
      const searchOptions: SearchOptions = {};
      
      if (scene) searchOptions.scene = scene;
      if (type) searchOptions.type = type;
      if (tags) searchOptions.tags = tags.split(',').map(t => t.trim());
      if (query) searchOptions.query = query;
      if (limit) searchOptions.limit = limit;

      // 执行搜索
      const skills = dependencies.skillRegistry.search(searchOptions);

      // 返回简要信息
      const results = skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        type: skill.type,
        scene: skill.scene,
        tags: skill.tags,
        parameterCount: skill.parameters.length,
      }));

      return reply.send({
        data: results,
        meta: {
          total: results.length,
          filters: {
            scene: scene || null,
            type: type || null,
            tags: tags ? tags.split(',') : null,
            query: query || null,
          },
        },
      });

    } catch (err) {
      logger.error('Failed to list skills', err as Error);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list skills',
        },
      });
    }
  });

  /**
   * GET /api/v1/skills/stats - 获取统计信息
   */
  server.get(`${prefix}/stats`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    try {
      const stats = dependencies.skillRegistry.getStats();
      
      return reply.send({
        data: {
          ...stats,
          scenes: dependencies.skillRegistry.getScenes(),
          types: dependencies.skillRegistry.getTypes(),
          tags: dependencies.skillRegistry.getTags(),
        },
      });

    } catch (err) {
      logger.error('Failed to get skills stats', err as Error);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get skills stats',
        },
      });
    }
  });

  /**
   * GET /api/v1/skills/:id - 获取单个 Skill 详情
   */
  server.get<{
    Params: { id: string };
  }>(`${prefix}/:id`, async (request, reply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    const { id } = request.params;

    try {
      const skill = dependencies.skillRegistry.getById(id);

      if (!skill) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Skill not found: ${id}`,
          },
        });
      }

      return reply.send({
        data: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          type: skill.type,
          scene: skill.scene,
          tags: skill.tags,
          parameters: skill.parameters.map(p => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
            default: p.default,
          })),
          outputSchema: skill.outputSchema,
          relatedSkills: skill.relatedSkills,
          relatedTools: skill.relatedTools,
        },
      });

    } catch (err) {
      logger.error('Failed to get skill', err as Error, { skillId: id });
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get skill',
        },
      });
    }
  });

  /**
   * POST /api/v1/skills/:id/execute - 执行 Skill
   */
  server.post<{
    Params: { id: string };
    Body: { parameters?: Record<string, unknown> };
  }>(`${prefix}/:id/execute`, async (request, reply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    const { id } = request.params;
    const traceId = request.traceId;

    // 验证请求体
    const bodyResult = ExecuteSkillBodySchema.safeParse(request.body || {});
    
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: bodyResult.error.issues,
        },
      });
    }

    const { parameters } = bodyResult.data;

    try {
      // 检查 Skill 是否存在
      if (!dependencies.skillRegistry.has(id)) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Skill not found: ${id}`,
          },
        });
      }

      // 执行 Skill
      const executionRequest: SkillExecutionRequest = {
        skillId: id,
        parameters,
        traceId,
      };

      const result = await dependencies.skillProcessor.execute(executionRequest);

      if (!result.success) {
        // 根据错误类型返回不同状态码
        const statusCode = result.validationErrors ? 400 : 500;
        
        return reply.status(statusCode).send({
          error: {
            code: result.validationErrors ? 'VALIDATION_ERROR' : 'EXECUTION_ERROR',
            message: result.error || 'Skill execution failed',
            details: result.validationErrors,
          },
        });
      }

      return reply.send({
        data: {
          skillId: result.skillId,
          skillName: result.skillName,
          skillType: result.skillType,
          query: result.query,
          steps: result.steps,
          diagnosticRules: result.diagnosticRules,
          metadata: result.metadata,
        },
      });

    } catch (err) {
      logger.error('Failed to execute skill', err as Error, { skillId: id });
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to execute skill',
        },
      });
    }
  });

  /**
   * POST /api/v1/skills/reload - 重新加载所有 Skill
   */
  server.post(`${prefix}/reload`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    try {
      await dependencies.skillRegistry.reload();
      const stats = dependencies.skillRegistry.getStats();

      logger.info('Skills reloaded via API', { ...stats });

      return reply.send({
        data: {
          message: 'Skills reloaded successfully',
          stats,
        },
      });

    } catch (err) {
      logger.error('Failed to reload skills', err as Error);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reload skills',
        },
      });
    }
  });

  /**
   * GET /api/v1/skills/scenes - 列出所有场景
   */
  server.get(`${prefix}/scenes`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    try {
      const scenes = dependencies.skillRegistry.getScenes();
      const sceneStats: Record<string, number> = {};
      
      for (const scene of scenes) {
        sceneStats[scene] = dependencies.skillRegistry.listByScene(scene).length;
      }

      return reply.send({
        data: scenes.map(scene => ({
          id: scene,
          skillCount: sceneStats[scene] || 0,
        })),
      });

    } catch (err) {
      logger.error('Failed to list scenes', err as Error);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list scenes',
        },
      });
    }
  });

  /**
   * GET /api/v1/skills/types - 列出所有类型
   */
  server.get(`${prefix}/types`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Skills service not initialized',
        },
      });
    }

    try {
      const types = dependencies.skillRegistry.getTypes();
      const typeStats: Record<string, number> = {};
      
      for (const type of types) {
        typeStats[type] = dependencies.skillRegistry.listByType(type).length;
      }

      return reply.send({
        data: types.map(type => ({
          id: type,
          skillCount: typeStats[type] || 0,
        })),
      });

    } catch (err) {
      logger.error('Failed to list types', err as Error);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list types',
        },
      });
    }
  });

  logger.info('Skills REST API routes registered', { prefix });
}

// ============= 导出 =============

export default setupSkillsRoutes;
