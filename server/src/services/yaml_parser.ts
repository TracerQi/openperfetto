/**
 * YAML Skill 解析器
 * 解析和验证 Skill YAML 定义文件
 */

import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { StructuredLogger } from '../utils/logger.js';

const logger = new StructuredLogger('yaml_parser');

// ============= Zod Schema 定义 =============

/**
 * Skill 参数定义 Schema
 */
export const SkillParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'integer', 'float', 'boolean', 'array']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  allowedValues: z.array(z.string()).optional(),
});

export type SkillParam = z.infer<typeof SkillParamSchema>;

/**
 * 输出列定义 Schema
 */
export const OutputColumnSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

export type OutputColumn = z.infer<typeof OutputColumnSchema>;

/**
 * 输出模式 Schema
 */
export const OutputSchemaSchema = z.object({
  columns: z.array(OutputColumnSchema),
  displayLevel: z.enum(['summary', 'detail']).default('detail'),
});

export type OutputSchema = z.infer<typeof OutputSchemaSchema>;

/**
 * Skill 步骤定义 Schema (用于 composite/pipeline)
 */

// 定义基础 Schema（不含递归字段）
const BaseSkillStepSchema = z.object({
  id: z.string().min(1),
  skill: z.string().optional(),
  type: z.enum(['skill', 'iterator', 'conditional', 'diagnostic']).optional(),
  params: z.record(z.unknown()).optional(),
  forEach: z.string().optional(),
  filter: z.string().optional(),
  maxItems: z.number().optional(),
  condition: z.string().optional(),
  template: z.string().optional(),
  inputFrom: z.string().optional(),
  dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
});

// 定义递归类型
export interface SkillStep {
  id: string;
  skill?: string;
  type?: 'skill' | 'iterator' | 'conditional' | 'diagnostic';
  params?: Record<string, unknown>;
  forEach?: string;
  filter?: string;
  maxItems?: number;
  body?: SkillStep[];
  condition?: string;
  template?: string;
  inputFrom?: string;
  dependsOn?: string | string[];
}

// 创建包含递归字段的完整 Schema
export const SkillStepSchema: z.ZodType<SkillStep> = BaseSkillStepSchema.extend({
  body: z.lazy(() => z.array(SkillStepSchema)).optional(),
});

/**
 * Pipeline 阶段定义 Schema
 */
export const PipelineStageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  skills: z.array(z.string()).optional(),
  dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
  inputMapping: z.record(z.string()).optional(),
  outputs: z.array(z.string()).default([]),
  type: z.enum(['skill', 'diagnostic']).default('skill'),
  template: z.string().optional(),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

/**
 * Pipeline 配置 Schema
 */
export const PipelineConfigSchema = z.object({
  timeoutMs: z.number().default(60000),
  stageTimeoutMs: z.number().default(15000),
  continueOnError: z.boolean().default(false),
  parallelStages: z.boolean().default(false),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * 诊断规则 Schema
 */
export const DiagnosticRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  condition: z.string(),
  severity: z.enum(['info', 'warning', 'error', 'critical']).default('info'),
  message: z.string(),
  recommendation: z.string().optional(),
});

export type DiagnosticRule = z.infer<typeof DiagnosticRuleSchema>;

/**
 * Skill 类型枚举
 */
export const SkillTypeEnum = z.enum([
  'sql_query',    // 单条 SQL 查询
  'sql_metric',   // SQL 聚合指标
  'composite',    // 多步骤组合
  'pipeline',     // 管道式执行
  'diagnostic',   // 诊断型分析
]);

export type SkillType = z.infer<typeof SkillTypeEnum>;

/**
 * 场景类型枚举
 */
export const SceneTypeEnum = z.enum([
  'scrolling',    // 滚动卡顿
  'startup',      // 应用启动
  'anr',          // ANR 分析
  'memory',       // 内存分析
  'power',        // 功耗分析
  'lock',         // 锁竞争
  'binder',       // Binder 分析
  'network',      // 网络分析
  'io',           // IO 分析
  'general',      // 通用分析
]);

export type SceneType = z.infer<typeof SceneTypeEnum>;

/**
 * 完整 Skill 定义 Schema
 */
export const SkillDefinitionSchema = z.object({
  // 基础信息
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string().default('1.0'),
  
  // 分类信息
  type: SkillTypeEnum,
  scene: SceneTypeEnum,
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  
  // 参数定义
  parameters: z.array(SkillParamSchema).default([]),
  
  // SQL 模板 (用于 sql_query, sql_metric)
  sqlTemplate: z.string().optional(),
  
  // 步骤定义 (用于 composite)
  steps: z.array(SkillStepSchema).optional(),
  
  // Pipeline 定义
  pipelineConfig: PipelineConfigSchema.optional(),
  stages: z.array(PipelineStageSchema).optional(),
  
  // 诊断规则 (用于 diagnostic)
  diagnosticRules: z.array(DiagnosticRuleSchema).optional(),
  
  // 输出模式
  outputSchema: OutputSchemaSchema.optional(),
  
  // 关联信息
  relatedSkills: z.array(z.string()).default([]),
  relatedTools: z.array(z.string()).default([]),
  
  // 厂商特定
  vendor: z.string().optional(),
  
  // 元数据
  metadata: z.record(z.unknown()).optional(),
});

export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ============= 解析结果类型 =============

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
}

// ============= YAML 解析器类 =============

export class YamlParser {
  /**
   * 解析 Skill YAML 内容
   */
  parseSkill(yamlContent: string, filePath?: string): ParseResult<SkillDefinition> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 解析 YAML
    let rawData: unknown;
    try {
      rawData = parseYaml(yamlContent);
    } catch (err) {
      if (err instanceof YAMLParseError) {
        errors.push(`YAML parse error at line ${err.linePos?.[0]?.line}: ${err.message}`);
      } else {
        errors.push(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { success: false, errors, warnings };
    }

    if (!rawData || typeof rawData !== 'object') {
      errors.push('YAML content must be an object');
      return { success: false, errors, warnings };
    }

    // 2. 预处理：转换字段名（snake_case -> camelCase）
    const processedData = this.preprocessYamlData(rawData as Record<string, unknown>);

    // 3. Zod 验证
    const result = SkillDefinitionSchema.safeParse(processedData);

    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        errors.push(`Validation error at '${path}': ${issue.message}`);
      }
      return { success: false, errors, warnings };
    }

    // 4. 业务规则验证
    const businessValidation = this.validateBusinessRules(result.data);
    errors.push(...businessValidation.errors);
    warnings.push(...businessValidation.warnings);

    if (errors.length > 0) {
      return { success: false, errors, warnings };
    }

    logger.debug('Skill parsed successfully', {
      skillId: result.data.id,
      type: result.data.type,
      filePath,
    });

    return {
      success: true,
      data: result.data,
      errors: [],
      warnings,
    };
  }

  /**
   * 批量解析多个 Skill
   */
  parseMultiple(
    yamlContents: Array<{ content: string; filePath: string }>
  ): Array<{ filePath: string; result: ParseResult<SkillDefinition> }> {
    return yamlContents.map(({ content, filePath }) => ({
      filePath,
      result: this.parseSkill(content, filePath),
    }));
  }

  /**
   * 验证 Skill 定义（不解析 YAML）
   */
  validateSkillDefinition(skill: unknown): ParseResult<SkillDefinition> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const result = SkillDefinitionSchema.safeParse(skill);

    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        errors.push(`Validation error at '${path}': ${issue.message}`);
      }
      return { success: false, errors, warnings };
    }

    const businessValidation = this.validateBusinessRules(result.data);
    errors.push(...businessValidation.errors);
    warnings.push(...businessValidation.warnings);

    if (errors.length > 0) {
      return { success: false, errors, warnings };
    }

    return { success: true, data: result.data, errors: [], warnings };
  }

  // ============= 私有方法 =============

  /**
   * 预处理 YAML 数据：转换字段名
   */
  private preprocessYamlData(data: Record<string, unknown>): Record<string, unknown> {
    const fieldMapping: Record<string, string> = {
      'sql_template': 'sqlTemplate',
      'output_schema': 'outputSchema',
      'display_level': 'displayLevel',
      'related_skills': 'relatedSkills',
      'related_tools': 'relatedTools',
      'pipeline_config': 'pipelineConfig',
      'timeout_ms': 'timeoutMs',
      'stage_timeout_ms': 'stageTimeoutMs',
      'continue_on_error': 'continueOnError',
      'parallel_stages': 'parallelStages',
      'diagnostic_rules': 'diagnosticRules',
      'for_each': 'forEach',
      'max_items': 'maxItems',
      'input_from': 'inputFrom',
      'depends_on': 'dependsOn',
      'input_mapping': 'inputMapping',
      'allowed_values': 'allowedValues',
      'max_length': 'maxLength',
    };

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const newKey = fieldMapping[key] || key;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[newKey] = this.preprocessYamlData(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[newKey] = value.map(item => {
          if (item && typeof item === 'object') {
            return this.preprocessYamlData(item as Record<string, unknown>);
          }
          return item;
        });
      } else {
        result[newKey] = value;
      }
    }

    return result;
  }

  /**
   * 业务规则验证
   */
  private validateBusinessRules(skill: SkillDefinition): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. sql_query/sql_metric 必须有 sqlTemplate
    if ((skill.type === 'sql_query' || skill.type === 'sql_metric') && !skill.sqlTemplate) {
      errors.push(`Skill type '${skill.type}' requires 'sqlTemplate' field`);
    }

    // 2. composite 必须有 steps
    if (skill.type === 'composite' && (!skill.steps || skill.steps.length === 0)) {
      errors.push("Skill type 'composite' requires 'steps' field with at least one step");
    }

    // 3. pipeline 必须有 stages
    if (skill.type === 'pipeline' && (!skill.stages || skill.stages.length === 0)) {
      errors.push("Skill type 'pipeline' requires 'stages' field with at least one stage");
    }

    // 4. diagnostic 必须有 diagnosticRules
    if (skill.type === 'diagnostic' && (!skill.diagnosticRules || skill.diagnosticRules.length === 0)) {
      errors.push("Skill type 'diagnostic' requires 'diagnosticRules' field");
    }

    // 5. SQL 模板中的参数必须在 parameters 中定义
    if (skill.sqlTemplate) {
      const templateParams = this.extractTemplateParams(skill.sqlTemplate);
      const definedParams = new Set(skill.parameters.map(p => p.name));

      for (const param of templateParams) {
        if (!definedParams.has(param)) {
          warnings.push(`Parameter '${param}' used in sqlTemplate but not defined in parameters`);
        }
      }
    }

    // 6. 检查必需参数是否有默认值（警告）
    for (const param of skill.parameters) {
      if (param.required && param.default !== undefined) {
        warnings.push(`Parameter '${param.name}' is required but has a default value`);
      }
    }

    return { errors, warnings };
  }

  /**
   * 从 SQL 模板中提取参数名
   */
  private extractTemplateParams(template: string): string[] {
    const params: Set<string> = new Set();
    
    // 匹配 ${paramName}
    const simplePattern = /\$\{(\w+)\}/g;
    let match;
    while ((match = simplePattern.exec(template)) !== null) {
      params.add(match[1]);
    }

    // 匹配条件表达式中的参数 ${paramName ? "..." : "..."}
    const conditionalPattern = /\$\{(\w+)\s*\?/g;
    while ((match = conditionalPattern.exec(template)) !== null) {
      params.add(match[1]);
    }

    return Array.from(params);
  }
}

// ============= 导出默认实例 =============

export const yamlParser = new YamlParser();

export default YamlParser;
