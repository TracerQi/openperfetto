/**
 * Skills REST API 路由
 * 提供 Skill 列表、详情、执行接口
 */
import { FastifyInstance } from 'fastify';
import { SkillRegistry } from '../services/skill_registry.js';
import { SkillProcessor } from '../services/skill_processor.js';
export interface SkillsRouteDependencies {
    skillRegistry: SkillRegistry;
    skillProcessor: SkillProcessor;
}
/**
 * 设置 Skills 路由依赖
 */
export declare function setSkillsRouteDependencies(deps: SkillsRouteDependencies): void;
/**
 * 注册 Skills REST API 路由
 */
export declare function setupSkillsRoutes(server: FastifyInstance): void;
export default setupSkillsRoutes;
//# sourceMappingURL=skills.d.ts.map