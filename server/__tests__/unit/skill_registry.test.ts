/**
 * SkillRegistry 测试
 * 测试 Skill 注册、查询、索引功能
 * 注意：由于 ESM + Jest 的 mock 限制，这里只测试内存操作，不测试文件系统
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SkillRegistry } from '../../src/services/skill_registry.js';
import { YamlParser, SkillDefinition } from '../../src/services/yaml_parser.js';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

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
    registry = new SkillRegistry();
  });

  afterEach(() => {
    registry.destroy();
  });

  // ============= 注册和注销测试 =============
  describe('register/unregister', () => {
    it('should register a skill', () => {
      const skill = createMockSkill({ id: 'my-skill' });

      registry.register(skill);

      expect(registry.has('my-skill')).toBe(true);
      expect(registry.count()).toBe(1);
    });

    it('should replace existing skill with same id', () => {
      const skill1 = createMockSkill({ id: 'skill', name: 'Version 1' });
      const skill2 = createMockSkill({ id: 'skill', name: 'Version 2' });

      registry.register(skill1);
      registry.register(skill2);

      expect(registry.count()).toBe(1);
      expect(registry.getById('skill')?.name).toBe('Version 2');
    });

    it('should unregister a skill', () => {
      const skill = createMockSkill({ id: 'to-remove' });

      registry.register(skill);
      expect(registry.has('to-remove')).toBe(true);

      const result = registry.unregister('to-remove');

      expect(result).toBe(true);
      expect(registry.has('to-remove')).toBe(false);
    });

    it('should return false when unregistering non-existent skill', () => {
      const result = registry.unregister('non-existent');
      expect(result).toBe(false);
    });

    it('should store file path mapping on register', () => {
      const skill = createMockSkill({ id: 'path-test' });

      registry.register(skill, '/path/to/skill.yaml');

      const info = registry.getAllInfo().find(s => s.id === 'path-test');
      expect(info?.filePath).toContain('skill.yaml');
    });
  });

  // ============= 查询测试 =============
  describe('getById', () => {
    it('should return skill by id', () => {
      const skill = createMockSkill({ id: 'find-me' });
      registry.register(skill);

      const result = registry.getById('find-me');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-me');
    });

    it('should return undefined for non-existent id', () => {
      const result = registry.getById('not-found');
      expect(result).toBeUndefined();
    });
  });

  describe('listByScene', () => {
    it('should return skills filtered by scene', () => {
      registry.register(createMockSkill({ id: 'scroll-1', scene: 'scrolling' }));
      registry.register(createMockSkill({ id: 'scroll-2', scene: 'scrolling' }));
      registry.register(createMockSkill({ id: 'startup-1', scene: 'startup' }));

      const scrollingSkills = registry.listByScene('scrolling');

      expect(scrollingSkills).toHaveLength(2);
      expect(scrollingSkills.every(s => s.scene === 'scrolling')).toBe(true);
    });

    it('should return empty array for scene with no skills', () => {
      const result = registry.listByScene('anr');
      expect(result).toEqual([]);
    });
  });

  describe('listByType', () => {
    it('should return skills filtered by type - sql_query', () => {
      registry.register(createMockSkill({ id: 'query-1', type: 'sql_query' }));
      registry.register(createMockSkill({ id: 'query-2', type: 'sql_query' }));
      registry.register(createMockSkill({ id: 'metric-1', type: 'sql_metric' }));

      expect(registry.listByType('sql_query')).toHaveLength(2);
      expect(registry.listByType('sql_metric')).toHaveLength(1);
    });

    it('should filter by composite type', () => {
      registry.register(createMockSkill({
        id: 'composite-1',
        type: 'composite',
        sqlTemplate: undefined,
        steps: [{ id: 'step1' }],
      }));

      expect(registry.listByType('composite')).toHaveLength(1);
    });

    it('should filter by pipeline type', () => {
      registry.register(createMockSkill({
        id: 'pipeline-1',
        type: 'pipeline',
        sqlTemplate: undefined,
        stages: [{ id: 'stage1', name: 'Stage 1', type: 'skill', outputs: [] }],
      }));

      expect(registry.listByType('pipeline')).toHaveLength(1);
    });

    it('should filter by diagnostic type', () => {
      registry.register(createMockSkill({
        id: 'diagnostic-1',
        type: 'diagnostic',
        sqlTemplate: undefined,
        diagnosticRules: [{
          id: 'rule1',
          name: 'Rule 1',
          condition: 'true',
          severity: 'info',
          message: 'test',
        }],
      }));

      expect(registry.listByType('diagnostic')).toHaveLength(1);
    });
  });

  describe('listByTag', () => {
    it('should return skills filtered by tag', () => {
      registry.register(createMockSkill({ id: 'perf-1', tags: ['performance'] }));
      registry.register(createMockSkill({ id: 'perf-2', tags: ['performance', 'cpu'] }));
      registry.register(createMockSkill({ id: 'mem-1', tags: ['memory'] }));

      const perfSkills = registry.listByTag('performance');

      expect(perfSkills).toHaveLength(2);
    });
  });

  describe('getAll', () => {
    it('should return all registered skills', () => {
      registry.register(createMockSkill({ id: 'skill-1' }));
      registry.register(createMockSkill({ id: 'skill-2' }));
      registry.register(createMockSkill({ id: 'skill-3' }));

      const all = registry.getAll();

      expect(all).toHaveLength(3);
    });

    it('should return empty array when no skills', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getAllInfo', () => {
    it('should return skill info with correct structure', () => {
      registry.register(createMockSkill({
        id: 'info-test',
        name: 'Info Test',
        description: 'Test description',
        type: 'sql_query',
        scene: 'general',
        tags: ['tag1', 'tag2'],
        parameters: [
          { name: 'param1', type: 'string', required: true },
          { name: 'param2', type: 'integer', required: false },
        ],
      }));

      const info = registry.getAllInfo();

      expect(info).toHaveLength(1);
      expect(info[0]).toEqual({
        id: 'info-test',
        name: 'Info Test',
        description: 'Test description',
        type: 'sql_query',
        scene: 'general',
        tags: ['tag1', 'tag2'],
        parameterCount: 2,
        filePath: '',
      });
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(createMockSkill({
        id: 'scroll-query',
        name: 'Scroll Analysis',
        description: 'Analyze scrolling performance',
        type: 'sql_query',
        scene: 'scrolling',
        tags: ['performance', 'jank'],
      }));
      registry.register(createMockSkill({
        id: 'startup-metric',
        name: 'Startup Metric',
        description: 'Measure app startup time',
        type: 'sql_metric',
        scene: 'startup',
        tags: ['performance'],
      }));
      registry.register(createMockSkill({
        id: 'memory-diag',
        name: 'Memory Diagnostic',
        description: 'Diagnose memory issues',
        type: 'diagnostic',
        scene: 'memory',
        tags: ['memory', 'leak'],
        sqlTemplate: undefined,
        diagnosticRules: [{
          id: 'rule1',
          name: 'Rule',
          condition: 'true',
          severity: 'warning',
          message: 'test',
        }],
      }));
    });

    it('should search by scene', () => {
      const results = registry.search({ scene: 'scrolling' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('scroll-query');
    });

    it('should search by type', () => {
      const results = registry.search({ type: 'sql_metric' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('startup-metric');
    });

    it('should search by tags', () => {
      const results = registry.search({ tags: ['performance'] });
      expect(results).toHaveLength(2);
    });

    it('should search by query string', () => {
      const results = registry.search({ query: 'startup' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('startup-metric');
    });

    it('should search by query string in description', () => {
      const results = registry.search({ query: 'scrolling' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('scroll-query');
    });

    it('should combine multiple filters', () => {
      const results = registry.search({
        scene: 'scrolling',
        type: 'sql_query',
        tags: ['jank'],
      });
      expect(results).toHaveLength(1);
    });

    it('should respect limit option', () => {
      const results = registry.search({ limit: 1 });
      expect(results).toHaveLength(1);
    });

    it('should return empty when no match', () => {
      const results = registry.search({ scene: 'anr' });
      expect(results).toEqual([]);
    });
  });

  // ============= 统计信息测试 =============
  describe('getStats', () => {
    it('should return correct statistics', () => {
      registry.register(createMockSkill({ id: 's1', type: 'sql_query', scene: 'scrolling' }));
      registry.register(createMockSkill({ id: 's2', type: 'sql_query', scene: 'scrolling' }));
      registry.register(createMockSkill({ id: 's3', type: 'sql_metric', scene: 'startup' }));

      const stats = registry.getStats();

      expect(stats.totalSkills).toBe(3);
      expect(stats.byType['sql_query']).toBe(2);
      expect(stats.byType['sql_metric']).toBe(1);
      expect(stats.byScene['scrolling']).toBe(2);
      expect(stats.byScene['startup']).toBe(1);
    });

    it('should return empty stats when no skills', () => {
      const stats = registry.getStats();
      expect(stats.totalSkills).toBe(0);
      expect(stats.loadErrors).toBe(0);
    });
  });

  describe('getScenes/getTypes/getTags', () => {
    beforeEach(() => {
      registry.register(createMockSkill({ id: 's1', scene: 'scrolling', type: 'sql_query', tags: ['a'] }));
      registry.register(createMockSkill({ id: 's2', scene: 'startup', type: 'sql_metric', tags: ['b'] }));
    });

    it('should return all scenes', () => {
      const scenes = registry.getScenes();
      expect(scenes).toContain('scrolling');
      expect(scenes).toContain('startup');
    });

    it('should return all types', () => {
      const types = registry.getTypes();
      expect(types).toContain('sql_query');
      expect(types).toContain('sql_metric');
    });

    it('should return all tags', () => {
      const tags = registry.getTags();
      expect(tags).toContain('a');
      expect(tags).toContain('b');
    });
  });

  // ============= 销毁测试 =============
  describe('destroy', () => {
    it('should clear all data', () => {
      registry.register(createMockSkill({ id: 'to-destroy' }));
      expect(registry.count()).toBe(1);

      registry.destroy();

      expect(registry.count()).toBe(0);
    });
  });

  // ============= 边界条件测试 =============
  describe('Edge Cases', () => {
    it('should handle skill with empty tags', () => {
      const skill = createMockSkill({ id: 'no-tags', tags: [] });
      registry.register(skill);

      expect(registry.listByTag('any')).toEqual([]);
    });

    it('should handle concurrent registrations', () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        createMockSkill({ id: `skill-${i}` })
      );

      skills.forEach(s => registry.register(s));

      expect(registry.count()).toBe(10);
    });

    it('should handle skill with multiple tags', () => {
      registry.register(createMockSkill({
        id: 'multi-tag',
        tags: ['tag1', 'tag2', 'tag3'],
      }));

      expect(registry.listByTag('tag1')).toHaveLength(1);
      expect(registry.listByTag('tag2')).toHaveLength(1);
      expect(registry.listByTag('tag3')).toHaveLength(1);
    });

    it('should update indexes when re-registering with different properties', () => {
      registry.register(createMockSkill({ id: 'update-test', scene: 'scrolling' }));
      expect(registry.listByScene('scrolling')).toHaveLength(1);

      registry.register(createMockSkill({ id: 'update-test', scene: 'startup' }));
      expect(registry.listByScene('scrolling')).toHaveLength(0);
      expect(registry.listByScene('startup')).toHaveLength(1);
    });

    it('should handle has() correctly', () => {
      expect(registry.has('nonexistent')).toBe(false);
      registry.register(createMockSkill({ id: 'exists' }));
      expect(registry.has('exists')).toBe(true);
    });
  });
});
