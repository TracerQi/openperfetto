/**
 * Skill 处理器
 * 负责执行各类 Skill，验证参数，生成安全 SQL
 */
import { SqlSanitizer } from '../utils/sql_sanitizer.js';
import { SkillRegistry } from './skill_registry.js';
import { SkillDefinition, SkillType, DiagnosticRule } from './yaml_parser.js';
export interface SkillExecutionRequest {
    skillId: string;
    parameters: Record<string, unknown>;
    traceId?: string;
}
export interface SkillExecutionResult {
    success: boolean;
    skillId: string;
    skillName: string;
    skillType: SkillType;
    query?: string;
    steps?: Array<{
        id: string;
        skillId?: string;
        query?: string;
        params?: Record<string, unknown>;
    }>;
    diagnosticRules?: DiagnosticRule[];
    error?: string;
    validationErrors?: string[];
    metadata?: {
        description: string;
        outputSchema?: unknown;
        executionTimeMs?: number;
    };
}
export interface ParameterValidationResult {
    valid: boolean;
    errors: string[];
    sanitizedParams: Record<string, unknown>;
}
export declare class SkillProcessor {
    private registry;
    private sanitizer;
    constructor(registry: SkillRegistry, sanitizer?: SqlSanitizer);
    /**
     * 执行 Skill
     */
    execute(request: SkillExecutionRequest): Promise<SkillExecutionResult>;
    /**
     * 验证参数
     */
    validateParameters(skill: SkillDefinition, params: Record<string, unknown>): ParameterValidationResult;
    /**
     * 清理单个参数
     */
    private sanitizeParameter;
    /**
     * 格式化 Skill 定义为 LLM 可理解的 Prompt 文本
     * @param skillId Skill ID
     * @param params 可选参数（用于日志）
     * @returns 格式化的 Markdown 文本，Skill 不存在时返回 null
     */
    formatSkillForPrompt(skillId: string, params?: Record<string, unknown>): Promise<string | null>;
    /**
     * 执行 SQL 查询类型 Skill
     */
    private executeSqlQuery;
    /**
     * 执行 SQL 指标类型 Skill（与 sql_query 类似，但语义上是聚合指标）
     */
    private executeSqlMetric;
    /**
     * 执行组合类型 Skill
     */
    private executeComposite;
    /**
     * 处理单个步骤
     */
    private processStep;
    /**
     * 解析步骤参数（支持模板变量）
     */
    private resolveStepParams;
    /**
     * 执行 Pipeline 类型 Skill
     */
    private executePipeline;
    /**
     * 处理 Pipeline 阶段
     */
    private processStage;
    /**
     * 拓扑排序 Pipeline 阶段
     */
    private topologicalSort;
    /**
     * 执行诊断类型 Skill
     */
    private executeDiagnostic;
}
export default SkillProcessor;
//# sourceMappingURL=skill_processor.d.ts.map