/**
 * SkillProcessor 测试
 * 测试 Skill 执行、参数验证、SQL 生成
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { SkillProcessor, SkillExecutionRequest } from '../../src/services/skill_processor.js';
import { SkillRegistry } from '../../src/services/skill_registry.js';
import { SqlSanitizer } from '../../src/utils/sql_sanitizer.js';
import { SkillDefinition, SkillType } from '../../src/services/yaml_parser.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  StructuredLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withTraceId: jest.fn().mockReturnThis(),
  })),
}));

describe('SkillProcessor', () => {
  let processor: SkillProcessor;
  let mockRegistry: jest.Mocked<SkillRegistry>;
  let sanitizer: SqlSanitizer;

  // 测试用的 Skill 定义工厂
  const createMockSkill = (overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    version: '1.0',
    type: 'sql_query',
    scene: 'general',
    tags: ['test'],
    parameters: [],
    sqlTemplate: 'SELECT * FROM slice',
    relatedSkills: [],
    relatedTools: [],
    ...overrides,
  });

  beforeEach(() => {
    // 创建 mock registry
    mockRegistry = {
      getById: jest.fn(),
      has: jest.fn(),
      getAll: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<SkillRegistry>;

    sanitizer = new SqlSanitizer();
    processor = new SkillProcessor(mockRegistry, sanitizer);
  });

  // ============= sql_query 类型测试 =============
  describe('sql_query type', () => {
    it('should execute sql_query skill successfully', async () => {
      const skill = createMockSkill({
        id: 'query-slices',
        type: 'sql_query',
        sqlTemplate: 'SELECT * FROM slice WHERE dur > ${minDur}',
        parameters: [
          { name: 'minDur', type: 'integer', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'query-slices',
        parameters: { minDur: 1000 },
      });

      expect(result.success).toBe(true);
      expect(result.skillType).toBe('sql_query');
      expect(result.query).toBe('SELECT * FROM slice WHERE dur > 1000');
    });

    it('should handle missing sqlTemplate', async () => {
      const skill = createMockSkill({
        id: 'no-template',
        type: 'sql_query',
        sqlTemplate: undefined,
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'no-template',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing sqlTemplate');
    });

    it('should validate generated SQL', async () => {
      // 模板会生成危险的 SQL
      const skill = createMockSkill({
        id: 'dangerous',
        type: 'sql_query',
        sqlTemplate: 'DROP TABLE ${table}',
        parameters: [
          { name: 'table', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'dangerous',
        parameters: { table: 'slice' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous');
    });
  });

  // ============= sql_metric 类型测试 =============
  describe('sql_metric type', () => {
    it('should execute sql_metric skill', async () => {
      const skill = createMockSkill({
        id: 'count-slices',
        type: 'sql_metric',
        sqlTemplate: 'SELECT COUNT(*) as total FROM slice WHERE name LIKE ${pattern}',
        parameters: [
          { name: 'pattern', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'count-slices',
        parameters: { pattern: '%test%' },
      });

      expect(result.success).toBe(true);
      expect(result.skillType).toBe('sql_metric');
      expect(result.query).toContain('SELECT COUNT(*)');
    });
  });

  // ============= composite 类型测试 =============
  describe('composite type', () => {
    it('should execute composite skill with steps', async () => {
      const subSkill = createMockSkill({
        id: 'sub-skill',
        sqlTemplate: 'SELECT * FROM process WHERE name = ${name}',
      });

      const compositeSkill = createMockSkill({
        id: 'composite-test',
        type: 'composite',
        sqlTemplate: undefined,
        steps: [
          {
            id: 'step1',
            type: 'skill',
            skill: 'sub-skill',
            params: { name: '${processName}' },
          },
          {
            id: 'step2',
            type: 'skill',
            skill: 'sub-skill',
          },
        ],
        parameters: [
          { name: 'processName', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockImplementation((id) => {
        if (id === 'composite-test') return compositeSkill;
        if (id === 'sub-skill') return subSkill;
        return undefined;
      });

      const result = await processor.execute({
        skillId: 'composite-test',
        parameters: { processName: 'system_server' },
      });

      expect(result.success).toBe(true);
      expect(result.skillType).toBe('composite');
      expect(result.steps).toHaveLength(2);
      expect(result.steps?.[0].id).toBe('step1');
      expect(result.steps?.[0].skillId).toBe('sub-skill');
    });

    it('should fail if composite has no steps', async () => {
      const skill = createMockSkill({
        id: 'empty-composite',
        type: 'composite',
        sqlTemplate: undefined,
        steps: [],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'empty-composite',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing steps');
    });
  });

  // ============= pipeline 类型测试 =============
  describe('pipeline type', () => {
    it('should execute pipeline skill with stages', async () => {
      const subSkill = createMockSkill({
        id: 'stage-skill',
        sqlTemplate: 'SELECT * FROM slice',
      });

      const pipelineSkill = createMockSkill({
        id: 'pipeline-test',
        type: 'pipeline',
        sqlTemplate: undefined,
        stages: [
          {
            id: 'stage1',
            name: 'First Stage',
            type: 'skill',
            skills: ['stage-skill'],
            outputs: ['result1'],
          },
          {
            id: 'stage2',
            name: 'Second Stage',
            type: 'skill',
            skills: ['stage-skill'],
            dependsOn: 'stage1',
            outputs: ['result2'],
          },
        ],
      });

      mockRegistry.getById.mockImplementation((id) => {
        if (id === 'pipeline-test') return pipelineSkill;
        if (id === 'stage-skill') return subSkill;
        return undefined;
      });

      const result = await processor.execute({
        skillId: 'pipeline-test',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.skillType).toBe('pipeline');
      expect(result.steps).toHaveLength(2);
    });

    it('should sort stages by dependencies', async () => {
      const subSkill = createMockSkill({ id: 'dep-skill', sqlTemplate: 'SELECT 1' });

      const pipelineSkill = createMockSkill({
        id: 'dep-pipeline',
        type: 'pipeline',
        sqlTemplate: undefined,
        stages: [
          // 声明顺序：B 依赖 A，但 B 先声明
          { id: 'B', name: 'Stage B', type: 'skill', dependsOn: 'A', skills: ['dep-skill'], outputs: [] },
          { id: 'A', name: 'Stage A', type: 'skill', skills: ['dep-skill'], outputs: [] },
        ],
      });

      mockRegistry.getById.mockImplementation((id) => {
        if (id === 'dep-pipeline') return pipelineSkill;
        if (id === 'dep-skill') return subSkill;
        return undefined;
      });

      const result = await processor.execute({
        skillId: 'dep-pipeline',
        parameters: {},
      });

      expect(result.success).toBe(true);
      // A 应该在 B 之前（拓扑排序）
      expect(result.steps?.[0].id).toBe('A');
      expect(result.steps?.[1].id).toBe('B');
    });

    it('should fail if pipeline has no stages', async () => {
      const skill = createMockSkill({
        id: 'empty-pipeline',
        type: 'pipeline',
        sqlTemplate: undefined,
        stages: [],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'empty-pipeline',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing stages');
    });
  });

  // ============= diagnostic 类型测试 =============
  describe('diagnostic type', () => {
    it('should execute diagnostic skill', async () => {
      const skill = createMockSkill({
        id: 'diag-test',
        type: 'diagnostic',
        sqlTemplate: undefined,
        diagnosticRules: [
          {
            id: 'rule1',
            name: 'Long Frame Rule',
            condition: 'dur > 16000000',
            severity: 'warning',
            message: 'Frame took longer than 16ms',
            recommendation: 'Check for main thread blocking',
          },
          {
            id: 'rule2',
            name: 'Critical Frame Rule',
            condition: 'dur > 100000000',
            severity: 'critical',
            message: 'Frame took longer than 100ms',
          },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'diag-test',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.skillType).toBe('diagnostic');
      expect(result.diagnosticRules).toHaveLength(2);
      expect(result.diagnosticRules?.[0].severity).toBe('warning');
    });

    it('should fail if diagnostic has no rules', async () => {
      const skill = createMockSkill({
        id: 'empty-diag',
        type: 'diagnostic',
        sqlTemplate: undefined,
        diagnosticRules: [],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'empty-diag',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing rules');
    });
  });

  // ============= 参数验证测试 =============
  describe('Parameter Validation', () => {
    it('should fail if required parameter is missing', async () => {
      const skill = createMockSkill({
        id: 'required-param',
        parameters: [
          { name: 'mustHave', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'required-param',
        parameters: {}, // 缺少 mustHave
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('Missing required parameter: mustHave');
    });

    it('should use default value for optional parameter', async () => {
      const skill = createMockSkill({
        id: 'default-param',
        sqlTemplate: 'SELECT * FROM slice LIMIT ${limit}',
        parameters: [
          { name: 'limit', type: 'integer', required: false, default: 100 },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'default-param',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.query).toContain('LIMIT 100');
    });

    it('should validate string type', async () => {
      const skill = createMockSkill({
        id: 'string-param',
        parameters: [
          { name: 'name', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'string-param',
        parameters: { name: 123 }, // 传入数字
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('must be a string'))).toBe(true);
    });

    it('should validate integer type', async () => {
      const skill = createMockSkill({
        id: 'int-param',
        parameters: [
          { name: 'count', type: 'integer', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'int-param',
        parameters: { count: 'not-a-number' },
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('must be an integer'))).toBe(true);
    });

    it('should validate min/max constraints', async () => {
      const skill = createMockSkill({
        id: 'range-param',
        parameters: [
          { name: 'value', type: 'integer', required: true, min: 0, max: 100 },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      // 超过 max
      let result = await processor.execute({
        skillId: 'range-param',
        parameters: { value: 150 },
      });
      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('<= 100'))).toBe(true);

      // 低于 min
      result = await processor.execute({
        skillId: 'range-param',
        parameters: { value: -10 },
      });
      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('>= 0'))).toBe(true);
    });

    it('should validate maxLength for strings', async () => {
      const skill = createMockSkill({
        id: 'length-param',
        parameters: [
          { name: 'text', type: 'string', required: true, maxLength: 10 },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'length-param',
        parameters: { text: 'this is a very long string' },
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('max length'))).toBe(true);
    });

    it('should validate allowedValues enum', async () => {
      const skill = createMockSkill({
        id: 'enum-param',
        parameters: [
          {
            name: 'severity',
            type: 'string',
            required: true,
            allowedValues: ['low', 'medium', 'high'],
          },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'enum-param',
        parameters: { severity: 'invalid' },
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('must be one of'))).toBe(true);
    });

    it('should validate boolean type', async () => {
      const skill = createMockSkill({
        id: 'bool-param',
        sqlTemplate: 'SELECT * FROM slice WHERE is_main = ${isMain}',
        parameters: [
          { name: 'isMain', type: 'boolean', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      // 有效的 boolean 值
      let result = await processor.execute({
        skillId: 'bool-param',
        parameters: { isMain: true },
      });
      expect(result.success).toBe(true);

      result = await processor.execute({
        skillId: 'bool-param',
        parameters: { isMain: 'true' },
      });
      expect(result.success).toBe(true);

      // 无效的值
      result = await processor.execute({
        skillId: 'bool-param',
        parameters: { isMain: 'invalid' },
      });
      expect(result.success).toBe(false);
    });

    it('should validate array type', async () => {
      const skill = createMockSkill({
        id: 'array-param',
        parameters: [
          { name: 'ids', type: 'array', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      // 有效的数组
      let result = await processor.execute({
        skillId: 'array-param',
        parameters: { ids: [1, 2, 3] },
      });
      expect(result.success).toBe(true);

      // 非数组
      result = await processor.execute({
        skillId: 'array-param',
        parameters: { ids: 'not-array' },
      });
      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('must be an array'))).toBe(true);
    });

    it('should reject unknown parameters', async () => {
      const skill = createMockSkill({
        id: 'strict-params',
        parameters: [
          { name: 'known', type: 'string', required: false },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'strict-params',
        parameters: { known: 'value', unknown: 'extra' },
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.some(e => e.includes('Unknown parameter'))).toBe(true);
    });
  });

  // ============= 错误处理测试 =============
  describe('Error Handling', () => {
    it('should return error for non-existent skill', async () => {
      mockRegistry.getById.mockReturnValue(undefined);

      const result = await processor.execute({
        skillId: 'not-found',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });

    it('should handle execution errors gracefully', async () => {
      const skill = createMockSkill({
        id: 'error-skill',
        sqlTemplate: 'SELECT * FROM ${table}',
        parameters: [
          { name: 'table', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      // 传入会导致错误的参数
      const result = await processor.execute({
        skillId: 'error-skill',
        parameters: { table: 'a'.repeat(60000) }, // 超长
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include skill info even on validation error', async () => {
      const skill = createMockSkill({
        id: 'meta-error',
        name: 'Test Skill Name',
        description: 'Test description',
        parameters: [
          { name: 'required', type: 'string', required: true },
        ],
      });

      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'meta-error',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.skillName).toBe('Test Skill Name');
      expect(result.skillType).toBe('sql_query');
      expect(result.error).toBe('Parameter validation failed');
    });
  });

  // ============= 执行时间追踪测试 =============
  describe('Execution Time Tracking', () => {
    it('should track execution time in metadata', async () => {
      const skill = createMockSkill({ id: 'timed-skill' });
      mockRegistry.getById.mockReturnValue(skill);

      const result = await processor.execute({
        skillId: 'timed-skill',
        parameters: {},
      });

      expect(result.metadata?.executionTimeMs).toBeDefined();
      expect(typeof result.metadata?.executionTimeMs).toBe('number');
      expect(result.metadata?.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ============= validateParameters 公开方法测试 =============
  describe('validateParameters', () => {
    it('should validate and sanitize parameters', () => {
      const skill = createMockSkill({
        id: 'validate-test',
        parameters: [
          { name: 'name', type: 'string', required: true },
          { name: 'count', type: 'integer', required: false, default: 10 },
        ],
      });

      const result = processor.validateParameters(skill, {
        name: "test's value",
        count: '5',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // 字符串被清理，单引号被转义
      expect(result.sanitizedParams.name).toBe("test''s value");
      // 数字被解析
      expect(result.sanitizedParams.count).toBe(5);
    });
  });
});
