/**
 * Skill 处理器
 * 负责执行各类 Skill，验证参数，生成安全 SQL
 */

import { StructuredLogger } from '../utils/logger.js';
import { SqlSanitizer, ParamMatchConfig } from '../utils/sql_sanitizer.js';
import { SkillRegistry } from './skill_registry.js';
import {
  SkillDefinition,
  SkillParam,
  SkillType,
  SkillStep,
  PipelineStage,
  DiagnosticRule,
} from './yaml_parser.js';

const logger = new StructuredLogger('skill_processor');

// ============= 类型定义 =============

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
  
  // 对于 sql_query/sql_metric，返回生成的 SQL
  query?: string;
  
  // 对于 composite/pipeline，返回步骤列表
  steps?: Array<{
    id: string;
    skillId?: string;
    query?: string;
    params?: Record<string, unknown>;
  }>;
  
  // 对于 diagnostic，返回诊断规则
  diagnosticRules?: DiagnosticRule[];
  
  // 错误信息
  error?: string;
  validationErrors?: string[];
  
  // 元数据
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

// ============= SPEC-05: 模板预编译验证类型 =============

export interface TemplateWarning {
  code: string;       // 如 'LIKE_OVERUSE', 'MISSING_LIMIT', 'PARAM_MISMATCH', 'MISSING_ORDER_BY'
  message: string;
  severity: 'warn';
  skillName: string;
}

// ============= Skill 处理器类 =============

export class SkillProcessor {
  private registry: SkillRegistry;
  private sanitizer: SqlSanitizer;

  constructor(registry: SkillRegistry, sanitizer?: SqlSanitizer) {
    this.registry = registry;
    this.sanitizer = sanitizer || new SqlSanitizer();
  }

  // ============= SPEC-05: SQL 模板预编译验证 =============

  /**
   * SPEC-05: 验证单个 Skill 的 SQL 模板质量
   * 返回警告列表，不阻断加载
   */
  validateSqlTemplate(
    skillName: string,
    sqlTemplate: string,
    parameters: SkillParam[]
  ): TemplateWarning[] {
    const warnings: TemplateWarning[] = [];

    // 1. 检查 LIKE '%${param}%' 模式
    const likePattern = /LIKE\s+'%\$\{(\w+)\}%'/gi;
    for (const match of sqlTemplate.matchAll(likePattern)) {
      warnings.push({
        code: 'LIKE_OVERUSE',
        message: `Parameter '${match[1]}' uses LIKE '%...%' which may be overly broad. Consider using matchMode.`,
        severity: 'warn',
        skillName,
      });
    }

    // 2. 检查缺少 LIMIT
    if (!/\bLIMIT\b/i.test(sqlTemplate)) {
      warnings.push({
        code: 'MISSING_LIMIT',
        message: 'SQL template has no LIMIT clause, may return excessive rows.',
        severity: 'warn',
        skillName,
      });
    }

    // 3. 占位符一致性
    const placeholders = new Set([...sqlTemplate.matchAll(/\$\{(\w+)\}/g)].map(m => m[1]));
    const paramNames = new Set(parameters.map(p => p.name));
    for (const ph of placeholders) {
      if (!paramNames.has(ph)) {
        warnings.push({
          code: 'PARAM_MISMATCH',
          message: `Placeholder '${ph}' has no matching parameter definition.`,
          severity: 'warn',
          skillName,
        });
      }
    }

    // 4. 时间序列缺少 ORDER BY
    const hasTimeColumn = /\b(ts|timestamp|time)\b/i.test(sqlTemplate);
    const hasOrderBy = /\bORDER\s+BY\b/i.test(sqlTemplate);
    if (hasTimeColumn && !hasOrderBy) {
      warnings.push({
        code: 'MISSING_ORDER_BY',
        message: 'Query references time columns but has no ORDER BY clause.',
        severity: 'warn',
        skillName,
      });
    }

    return warnings;
  }

  /**
   * SPEC-05: 验证所有已注册 Skill 的 SQL 模板质量
   * 在 Skill 加载后调用，将警告通过 console.warn 输出
   */
  validateAllSkills(): TemplateWarning[] {
    const allWarnings: TemplateWarning[] = [];
    const skills = this.registry.getAll();

    for (const skill of skills) {
      if (skill.sqlTemplate) {
        const warnings = this.validateSqlTemplate(
          skill.name,
          skill.sqlTemplate,
          skill.parameters
        );
        if (warnings.length > 0) {
          for (const w of warnings) {
            logger.warn(`[SQL-TEMPLATE] ${w.code}: ${w.message}`, { skillName: w.skillName });
          }
          allWarnings.push(...warnings);
        }
      }
    }

    if (allWarnings.length > 0) {
      logger.warn(`SQL template validation complete: ${allWarnings.length} warning(s) found`);
    }

    return allWarnings;
  }

  /**
   * SPEC-05: 根据 Skill 参数定义构建 paramConfigs
   * 将含有 matchMode + columnRef 的参数转换为 ParamMatchConfig
   */
  private buildParamConfigs(parameters: SkillParam[]): Record<string, ParamMatchConfig> | undefined {
    const configs: Record<string, ParamMatchConfig> = {};
    let hasConfig = false;

    for (const param of parameters) {
      if (param.matchMode && param.columnRef) {
        configs[param.name] = {
          matchMode: param.matchMode,
          columnRef: param.columnRef,
        };
        hasConfig = true;
      }
    }

    return hasConfig ? configs : undefined;
  }

  /**
   * 执行 Skill
   */
  async execute(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const { skillId, parameters, traceId } = request;
    
    const loggerWithTrace = traceId ? logger.withTraceId(traceId) : logger;
    
    loggerWithTrace.debug('Executing skill', { skillId, parameters });
    
    // 1. 获取 Skill 定义
    const skill = this.registry.getById(skillId);
    
    if (!skill) {
      return {
        success: false,
        skillId,
        skillName: '',
        skillType: 'sql_query',
        error: `Skill not found: ${skillId}`,
      };
    }
    
    // 2. 验证参数
    const validation = this.validateParameters(skill, parameters);
    
    if (!validation.valid) {
      return {
        success: false,
        skillId,
        skillName: skill.name,
        skillType: skill.type,
        error: 'Parameter validation failed',
        validationErrors: validation.errors,
      };
    }
    
    // 3. 根据类型执行
    let result: SkillExecutionResult;
    
    try {
      switch (skill.type) {
        case 'sql_query':
          result = await this.executeSqlQuery(skill, validation.sanitizedParams);
          break;
        case 'sql_metric':
          result = await this.executeSqlMetric(skill, validation.sanitizedParams);
          break;
        case 'composite':
          result = await this.executeComposite(skill, validation.sanitizedParams);
          break;
        case 'pipeline':
          result = await this.executePipeline(skill, validation.sanitizedParams);
          break;
        case 'diagnostic':
          result = await this.executeDiagnostic(skill, validation.sanitizedParams);
          break;
        default:
          result = {
            success: false,
            skillId,
            skillName: skill.name,
            skillType: skill.type,
            error: `Unknown skill type: ${skill.type}`,
          };
      }
      
      // 添加元数据
      result.metadata = {
        description: skill.description,
        outputSchema: skill.outputSchema,
        executionTimeMs: Date.now() - startTime,
      };
      
      loggerWithTrace.info('Skill executed', {
        skillId,
        success: result.success,
        executionTimeMs: result.metadata.executionTimeMs,
      });
      
      return result;
      
    } catch (err) {
      loggerWithTrace.error('Skill execution failed', err as Error, { skillId });
      
      return {
        success: false,
        skillId,
        skillName: skill.name,
        skillType: skill.type,
        error: err instanceof Error ? err.message : String(err),
        metadata: {
          description: skill.description,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 验证参数
   */
  validateParameters(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): ParameterValidationResult {
    const errors: string[] = [];
    const sanitizedParams: Record<string, unknown> = {};
    const definedParamNames = new Set(skill.parameters.map(p => p.name));
    
    // 检查必需参数和验证类型
    for (const paramDef of skill.parameters) {
      const value = params[paramDef.name];
      
      // 检查必需参数
      if (paramDef.required && (value === undefined || value === null)) {
        errors.push(`Missing required parameter: ${paramDef.name}`);
        continue;
      }
      
      // 使用默认值
      if (value === undefined || value === null) {
        if (paramDef.default !== undefined) {
          sanitizedParams[paramDef.name] = paramDef.default;
        }
        continue;
      }
      
      // 类型验证和清理
      const sanitizeResult = this.sanitizeParameter(paramDef, value);
      
      if (sanitizeResult.error) {
        errors.push(sanitizeResult.error);
      } else {
        sanitizedParams[paramDef.name] = sanitizeResult.value;
      }
    }
    
    // 检查未定义的额外参数
    for (const key of Object.keys(params)) {
      if (!definedParamNames.has(key)) {
        errors.push(`Unknown parameter: ${key}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      sanitizedParams,
    };
  }

  /**
   * 清理单个参数
   */
  private sanitizeParameter(
    paramDef: SkillParam,
    value: unknown
  ): { value?: unknown; error?: string } {
    const { name, type, min, max, maxLength, allowedValues } = paramDef;
    
    switch (type) {
      case 'string': {
        if (typeof value !== 'string') {
          return { error: `${name} must be a string` };
        }
        
        // 长度检查
        if (maxLength && value.length > maxLength) {
          return { error: `${name} exceeds max length ${maxLength}` };
        }
        
        // 枚举检查
        if (allowedValues && !allowedValues.includes(value)) {
          return { error: `${name} must be one of: ${allowedValues.join(', ')}` };
        }
        
        // 清理危险字符
        return { value: this.sanitizer.sanitizeString(value) };
      }
      
      case 'integer': {
        const intVal = typeof value === 'number' ? value : parseInt(String(value), 10);
        
        if (!Number.isInteger(intVal) || isNaN(intVal)) {
          return { error: `${name} must be an integer` };
        }
        
        if (min !== undefined && intVal < min) {
          return { error: `${name} must be >= ${min}` };
        }
        
        if (max !== undefined && intVal > max) {
          return { error: `${name} must be <= ${max}` };
        }
        
        return { value: intVal };
      }
      
      case 'float': {
        const floatVal = typeof value === 'number' ? value : parseFloat(String(value));
        
        if (isNaN(floatVal)) {
          return { error: `${name} must be a number` };
        }
        
        if (min !== undefined && floatVal < min) {
          return { error: `${name} must be >= ${min}` };
        }
        
        if (max !== undefined && floatVal > max) {
          return { error: `${name} must be <= ${max}` };
        }
        
        return { value: floatVal };
      }
      
      case 'boolean': {
        if (typeof value === 'boolean') {
          return { value };
        }
        if (value === 'true' || value === '1' || value === 1) {
          return { value: true };
        }
        if (value === 'false' || value === '0' || value === 0) {
          return { value: false };
        }
        return { error: `${name} must be a boolean` };
      }
      
      case 'array': {
        if (!Array.isArray(value)) {
          return { error: `${name} must be an array` };
        }
        return { value };
      }
      
      default:
        return { error: `Unknown type for ${name}: ${type}` };
    }
  }

  /**
   * 格式化 Skill 定义为 LLM 可理解的 Prompt 文本
   * @param skillId Skill ID
   * @param params 可选参数（用于日志）
   * @returns 格式化的 Markdown 文本，Skill 不存在时返回 null
   */
  async formatSkillForPrompt(
    skillId: string,
    params?: Record<string, unknown>
  ): Promise<string | null> {
    const skill = this.registry.getById(skillId);
    
    if (!skill) {
      logger.warn('Skill not found for prompt formatting', { skillId });
      return null;
    }
    
    logger.debug('Formatting skill for prompt', { skillId, type: skill.type });
    
    const lines: string[] = [];
    
    // 基本信息
    lines.push(`### Skill: ${skill.id}`);
    lines.push(`- Description: ${skill.description}`);
    lines.push(`- Type: ${skill.type}`);
    
    // 参数列表
    if (skill.parameters.length > 0) {
      lines.push('- Parameters:');
      for (const p of skill.parameters) {
        const parts = [`${p.name} (${p.type}`];
        parts.push(p.required ? ', required)' : ', optional)');
        let line = `  - ${parts.join('')}`;
        if (p.default !== undefined) {
          line += `, default: ${JSON.stringify(p.default)}`;
        }
        if (p.description) {
          line += `: ${p.description}`;
        }
        lines.push(line);
      }
    }
    
    // SQL 模板（智能截断：保留关键结构信息）
    if (skill.sqlTemplate) {
      const sql = this.truncateSqlTemplate(skill.sqlTemplate, 1500);
      lines.push(`- SQL Template: ${sql.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}`);
    }
    
    // 前置依赖信息
    if (skill.prerequisites) {
      if (skill.prerequisites.description) {
        lines.push(`- Prerequisites: ${skill.prerequisites.description}`);
      }
      if (skill.prerequisites.dependsOn && skill.prerequisites.dependsOn.length > 0) {
        lines.push(`- Depends On: ${skill.prerequisites.dependsOn.join(', ')}`);
      }
    }
    
    // 输出列定义
    if (skill.outputSchema?.columns && skill.outputSchema.columns.length > 0) {
      const cols = skill.outputSchema.columns
        .map(c => `${c.name}(${c.type})`)
        .join(', ');
      lines.push(`- Output Columns: ${cols}`);
    }
    
    // composite 类型：steps 概要
    if (skill.type === 'composite' && skill.steps && skill.steps.length > 0) {
      lines.push(`- Steps (${skill.steps.length}):`);
      for (const step of skill.steps) {
        const stepDesc = step.skill ? `skill=${step.skill}` : `type=${step.type || 'unknown'}`;
        lines.push(`  - ${step.id}: ${stepDesc}`);
      }
    }
    
    // pipeline 类型：stages 概要
    if (skill.type === 'pipeline' && skill.stages && skill.stages.length > 0) {
      lines.push(`- Stages (${skill.stages.length}):`);
      for (const stage of skill.stages) {
        const skills = stage.skills?.join(', ') || 'none';
        lines.push(`  - ${stage.id} (${stage.name}): skills=[${skills}]`);
      }
    }
    
    // diagnostic 类型：rules 概要
    if (skill.type === 'diagnostic' && skill.diagnosticRules && skill.diagnosticRules.length > 0) {
      lines.push(`- Diagnostic Rules (${skill.diagnosticRules.length}):`);
      for (const rule of skill.diagnosticRules) {
        lines.push(`  - ${rule.id} (${rule.severity}): ${rule.name}`);
      }
    }
    
    const formatted = lines.join('\n');
    
    logger.debug('Skill formatted for prompt', {
      skillId,
      formattedLength: formatted.length,
    });
    
    return formatted;
  }

  /**
   * 智能截断 SQL 模板
   * 优先保留 SELECT 输出列 + JOIN 关系 + WHERE 条件，隐藏 CTE 内部逻辑
   */
  private truncateSqlTemplate(sql: string, maxLength: number): string {
    if (sql.length <= maxLength) {
      return sql;
    }

    // 策略：对于包含 CTE (WITH ... AS) 的 SQL，
    // 保留外层 SELECT 和 CTE 的 JOIN/WHERE 部分
    const cteMatch = sql.match(/WITH\s+\w+\s+AS\s*\(([\s\S]*?)\)\s*(SELECT[\s\S]*)/i);

    if (cteMatch) {
      const cteBody = cteMatch[1];
      const outerSelect = cteMatch[2];

      // 从 CTE body 中提取 JOIN 和 WHERE（关键结构信息）
      const joinLines = cteBody.match(/JOIN\s+.+/gi) || [];
      const whereLines = cteBody.match(/WHERE\s+[\s\S]*?(?=\)|$)/i) || [];

      const skeleton = [
        'WITH ... AS (',
        '  SELECT ... FROM slice s',
        ...joinLines.map(j => '  ' + j.trim()),
        ...whereLines.map(w => '  ' + w.trim()),
        ')',
        outerSelect.trim(),
      ].join('\n');

      if (skeleton.length <= maxLength) {
        return skeleton;
      }
    }

    // 回退：简单截断到 maxLength
    return sql.substring(0, maxLength) + '...';
  }

  // ============= 各类型 Skill 执行方法 =============

  /**
   * 执行 SQL 查询类型 Skill
   */
  private async executeSqlQuery(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    if (!skill.sqlTemplate) {
      return {
        success: false,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        error: 'Skill missing sqlTemplate',
      };
    }
    
    try {
      // 生成安全的 SQL（SPEC-05: 传入 paramConfigs）
      const paramConfigs = this.buildParamConfigs(skill.parameters);
      const query = this.sanitizer.sanitize(skill.sqlTemplate, params, paramConfigs);
      
      // 验证生成的 SQL
      const validation = this.sanitizer.validateQuery(query);
      
      if (!validation.valid) {
        return {
          success: false,
          skillId: skill.id,
          skillName: skill.name,
          skillType: skill.type,
          error: 'Generated SQL validation failed',
          validationErrors: validation.errors,
        };
      }
      
      return {
        success: true,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        query,
      };
      
    } catch (err) {
      return {
        success: false,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 执行 SQL 指标类型 Skill（与 sql_query 类似，但语义上是聚合指标）
   */
  private async executeSqlMetric(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    // 目前实现与 sql_query 相同
    return this.executeSqlQuery(skill, params);
  }

  /**
   * 执行组合类型 Skill
   */
  private async executeComposite(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    if (!skill.steps || skill.steps.length === 0) {
      return {
        success: false,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        error: 'Composite skill missing steps',
      };
    }
    
    const processedSteps: Array<{
      id: string;
      skillId?: string;
      query?: string;
      params?: Record<string, unknown>;
    }> = [];
    
    for (const step of skill.steps) {
      const processedStep = await this.processStep(step, params);
      processedSteps.push(processedStep);
    }
    
    return {
      success: true,
      skillId: skill.id,
      skillName: skill.name,
      skillType: skill.type,
      steps: processedSteps,
    };
  }

  /**
   * 处理单个步骤
   */
  private async processStep(
    step: SkillStep,
    parentParams: Record<string, unknown>
  ): Promise<{
    id: string;
    skillId?: string;
    query?: string;
    params?: Record<string, unknown>;
  }> {
    const result: {
      id: string;
      skillId?: string;
      query?: string;
      params?: Record<string, unknown>;
    } = {
      id: step.id,
    };
    
    // 解析步骤参数（支持 ${xxx} 引用父参数）
    const stepParams = this.resolveStepParams(step.params ?? {}, parentParams);
    result.params = stepParams;
    
    switch (step.type) {
      case 'skill':
        if (step.skill) {
          result.skillId = step.skill;
          
          // 获取子 Skill 并生成 SQL
          const subSkill = this.registry.getById(step.skill);
          if (subSkill && subSkill.sqlTemplate) {
            try {
              result.query = this.sanitizer.sanitize(subSkill.sqlTemplate, stepParams);
            } catch (err) {
              logger.warn('Failed to generate SQL for step', {
                stepId: step.id,
                skillId: step.skill,
                error: (err as Error).message,
              });
            }
          }
        }
        break;
        
      case 'iterator':
        // 迭代器步骤：返回迭代配置
        result.params = {
          ...stepParams,
          _type: 'iterator',
          _forEach: step.forEach,
          _filter: step.filter,
          _maxItems: step.maxItems,
        };
        break;
        
      case 'conditional':
        // 条件步骤：返回条件配置
        result.params = {
          ...stepParams,
          _type: 'conditional',
          _condition: step.condition,
        };
        break;
        
      case 'diagnostic':
        // 诊断步骤：返回模板
        result.params = {
          ...stepParams,
          _type: 'diagnostic',
          _template: step.template,
        };
        break;
    }
    
    return result;
  }

  /**
   * 解析步骤参数（支持模板变量）
   */
  private resolveStepParams(
    stepParams: Record<string, unknown>,
    parentParams: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(stepParams)) {
      if (typeof value === 'string') {
        // 解析 ${paramName} 模板
        resolved[key] = value.replace(
          /\$\{(\w+)\}/g,
          (_, paramName) => String(parentParams[paramName] ?? '')
        );
      } else {
        resolved[key] = value;
      }
    }
    
    return resolved;
  }

  /**
   * 执行 Pipeline 类型 Skill
   */
  private async executePipeline(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    if (!skill.stages || skill.stages.length === 0) {
      return {
        success: false,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        error: 'Pipeline skill missing stages',
      };
    }
    
    const processedSteps: Array<{
      id: string;
      skillId?: string;
      query?: string;
      params?: Record<string, unknown>;
    }> = [];
    
    // 按依赖顺序排序阶段
    const sortedStages = this.topologicalSort(skill.stages);
    
    for (const stage of sortedStages) {
      const stageStep = await this.processStage(stage, params);
      processedSteps.push(stageStep);
    }
    
    return {
      success: true,
      skillId: skill.id,
      skillName: skill.name,
      skillType: skill.type,
      steps: processedSteps,
    };
  }

  /**
   * 处理 Pipeline 阶段
   */
  private async processStage(
    stage: PipelineStage,
    params: Record<string, unknown>
  ): Promise<{
    id: string;
    skillId?: string;
    query?: string;
    params?: Record<string, unknown>;
  }> {
    const result: {
      id: string;
      skillId?: string;
      query?: string;
      params?: Record<string, unknown>;
    } = {
      id: stage.id,
      params: {
        _stageName: stage.name,
        _outputs: stage.outputs,
        _dependsOn: stage.dependsOn,
      },
    };
    
    if (stage.skills && stage.skills.length > 0) {
      result.skillId = stage.skills[0];
      
      // 解析输入映射
      const stageParams = stage.inputMapping
        ? this.resolveStepParams(stage.inputMapping as Record<string, unknown>, params)
        : params;
      
      // 获取第一个 Skill 的 SQL
      const subSkill = this.registry.getById(stage.skills[0]);
      if (subSkill && subSkill.sqlTemplate) {
        try {
          result.query = this.sanitizer.sanitize(subSkill.sqlTemplate, stageParams);
        } catch (err) {
          logger.warn('Failed to generate SQL for stage', {
            stageId: stage.id,
            skillId: stage.skills[0],
            error: (err as Error).message,
          });
        }
      }
    }
    
    return result;
  }

  /**
   * 拓扑排序 Pipeline 阶段
   */
  private topologicalSort(stages: PipelineStage[]): PipelineStage[] {
    const sorted: PipelineStage[] = [];
    const visited = new Set<string>();
    
    const visit = (stage: PipelineStage) => {
      if (visited.has(stage.id)) return;
      
      const deps = Array.isArray(stage.dependsOn)
        ? stage.dependsOn
        : stage.dependsOn ? [stage.dependsOn] : [];
      
      for (const depId of deps) {
        const depStage = stages.find(s => s.id === depId);
        if (depStage) visit(depStage);
      }
      
      visited.add(stage.id);
      sorted.push(stage);
    };
    
    for (const stage of stages) {
      visit(stage);
    }
    
    return sorted;
  }

  /**
   * 执行诊断类型 Skill
   */
  private async executeDiagnostic(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    if (!skill.diagnosticRules || skill.diagnosticRules.length === 0) {
      return {
        success: false,
        skillId: skill.id,
        skillName: skill.name,
        skillType: skill.type,
        error: 'Diagnostic skill missing rules',
      };
    }
    
    // 诊断类型：返回诊断规则供前端执行
    return {
      success: true,
      skillId: skill.id,
      skillName: skill.name,
      skillType: skill.type,
      diagnosticRules: skill.diagnosticRules,
    };
  }
}

// ============= 导出 =============

export default SkillProcessor;
