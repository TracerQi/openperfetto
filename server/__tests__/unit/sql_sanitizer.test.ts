/**
 * SQL Sanitizer 测试
 * 测试 SQL 安全防护功能
 */

import { SqlSanitizer, sqlSanitizer } from '../../src/utils/sql_sanitizer.js';

describe('SqlSanitizer', () => {
  let sanitizer: SqlSanitizer;

  beforeEach(() => {
    sanitizer = new SqlSanitizer();
  });

  // ============= validateQuery 白名单/黑名单测试 =============
  describe('validateQuery - Whitelist/Blacklist', () => {
    it('should accept SELECT queries', () => {
      const sql = 'SELECT * FROM slice WHERE dur > 1000';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept WITH (CTE) queries', () => {
      const sql = `
        WITH cte AS (SELECT id FROM process)
        SELECT * FROM cte
      `;
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept INCLUDE PERFETTO MODULE queries', () => {
      const sql = 'INCLUDE PERFETTO MODULE android.startup';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(true);
    });

    it('should reject DROP statements', () => {
      const sql = 'DROP TABLE slice';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('dangerous'))).toBe(true);
    });

    it('should reject DELETE statements', () => {
      const sql = 'DELETE FROM slice WHERE id = 1';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
    });

    it('should reject INSERT statements', () => {
      const sql = "INSERT INTO slice VALUES (1, 'test')";
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
    });

    it('should reject UPDATE statements', () => {
      const sql = "UPDATE slice SET name = 'test' WHERE id = 1";
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
    });

    it('should reject ALTER statements', () => {
      const sql = 'ALTER TABLE slice ADD COLUMN test INTEGER';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
    });

    it('should reject queries not starting with SELECT/WITH', () => {
      const sql = 'PRAGMA table_info(slice)';
      const result = sanitizer.validateQuery(sql);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must start with'))).toBe(true);
    });
  });

  // ============= sanitize 参数替换测试 =============
  describe('sanitize - Parameter Substitution', () => {
    it('should substitute string parameters with quotes', () => {
      const template = "SELECT * FROM slice WHERE name = ${name}";
      const params = { name: 'my_slice' };
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe("SELECT * FROM slice WHERE name = 'my_slice'");
    });

    it('should substitute number parameters', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${minDur}';
      const params = { minDur: 1000000 };
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('SELECT * FROM slice WHERE dur > 1000000');
    });

    it('should substitute boolean parameters as 0/1', () => {
      const template = 'SELECT * FROM slice WHERE is_main = ${isMain}';
      const params = { isMain: true };
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('SELECT * FROM slice WHERE is_main = 1');
    });

    it('should substitute null parameters', () => {
      const template = 'SELECT * FROM slice WHERE parent_id = ${parentId}';
      const params = { parentId: null };
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('SELECT * FROM slice WHERE parent_id = NULL');
    });

    it('should substitute array parameters for IN clause', () => {
      const template = 'SELECT * FROM slice WHERE id IN ${ids}';
      const params = { ids: [1, 2, 3] };
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('SELECT * FROM slice WHERE id IN (1, 2, 3)');
    });

    it('should handle conditional expressions', () => {
      const template = 'SELECT * FROM slice ${filter ? "WHERE name LIKE \'test%\'" : ""}';
      const params = { filter: true };
      const result = sanitizer.sanitize(template, params);
      expect(result).toContain('WHERE name LIKE');
    });

    it('should cleanup unused placeholders', () => {
      const template = 'SELECT * FROM slice ${unusedParam}';
      const params = {};
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('SELECT * FROM slice');
    });
  });

  // ============= sanitizeString 特殊字符转义测试 =============
  describe('sanitizeString - Character Escaping', () => {
    it('should escape single quotes', () => {
      const input = "O'Brien";
      const result = sanitizer.sanitizeString(input);
      expect(result).toBe("O''Brien");
    });

    it('should remove SQL comments (--)', () => {
      const input = 'test--comment';
      const result = sanitizer.sanitizeString(input);
      expect(result).not.toContain('--');
    });

    it('should remove block comment markers', () => {
      const input = 'test/* comment */end';
      const result = sanitizer.sanitizeString(input);
      expect(result).not.toContain('/*');
      expect(result).not.toContain('*/');
    });

    it('should remove semicolons', () => {
      const input = 'test;injection';
      const result = sanitizer.sanitizeString(input);
      expect(result).not.toContain(';');
    });

    it('should replace newlines with spaces', () => {
      const input = 'line1\nline2\rline3';
      const result = sanitizer.sanitizeString(input);
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\r');
      expect(result).toContain(' ');
    });

    it('should handle complex injection attempts', () => {
      const input = "'; DROP TABLE slice; --";
      const result = sanitizer.sanitizeString(input);
      expect(result).not.toContain(';');
      expect(result).not.toContain('--');
    });
  });

  // ============= buildParameterizedQuery 参数绑定测试 =============
  describe('buildParameterizedQuery', () => {
    it('should create parameterized query with bindings', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${minDur}';
      const params = { minDur: 1000 };
      const paramDefs = [{ name: 'minDur', type: 'integer' }];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.sql).toBe('SELECT * FROM slice WHERE dur > $1');
      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0]).toEqual({
        name: 'minDur',
        value: 1000,
        type: 'integer',
      });
    });

    it('should handle LIKE with contains pattern', () => {
      const template = "SELECT * FROM slice WHERE name LIKE '%${pattern}%'";
      const params = { pattern: 'test' };
      const paramDefs = [{ name: 'pattern', type: 'string' }];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.sql).toContain("LIKE '%' || $1 || '%'");
      expect(result.bindings[0].value).toBe('test');
    });

    it('should handle LIKE with prefix pattern', () => {
      const template = "SELECT * FROM slice WHERE name LIKE '${prefix}%'";
      const params = { prefix: 'start' };
      const paramDefs = [{ name: 'prefix', type: 'string' }];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.sql).toContain("LIKE $1 || '%'");
    });

    it('should handle LIKE with suffix pattern', () => {
      const template = "SELECT * FROM slice WHERE name LIKE '%${suffix}'";
      const params = { suffix: 'end' };
      const paramDefs = [{ name: 'suffix', type: 'string' }];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.sql).toContain("LIKE '%' || $1");
    });

    it('should handle multiple parameters', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${minDur} AND name = ${name}';
      const params = { minDur: 1000, name: 'test' };
      const paramDefs = [
        { name: 'minDur', type: 'integer' },
        { name: 'name', type: 'string' },
      ];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.bindings).toHaveLength(2);
      expect(result.sql).toContain('$1');
      expect(result.sql).toContain('$2');
    });

    it('should skip undefined parameters', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${minDur}';
      const params = {};
      const paramDefs = [{ name: 'minDur', type: 'integer' }];

      const result = sanitizer.buildParameterizedQuery(template, params, paramDefs);

      expect(result.bindings).toHaveLength(0);
    });
  });

  // ============= isIdentifierSafe 标识符验证测试 =============
  describe('isIdentifierSafe', () => {
    it('should accept valid table names', () => {
      expect(sanitizer.isIdentifierSafe('slice')).toBe(true);
      expect(sanitizer.isIdentifierSafe('process_table')).toBe(true);
      expect(sanitizer.isIdentifierSafe('_private')).toBe(true);
    });

    it('should accept dotted identifiers', () => {
      expect(sanitizer.isIdentifierSafe('schema.table')).toBe(true);
      expect(sanitizer.isIdentifierSafe('a.b.c')).toBe(true);
    });

    it('should reject identifiers starting with numbers', () => {
      expect(sanitizer.isIdentifierSafe('123table')).toBe(false);
    });

    it('should reject identifiers with special characters', () => {
      expect(sanitizer.isIdentifierSafe('table-name')).toBe(false);
      expect(sanitizer.isIdentifierSafe('table name')).toBe(false);
      expect(sanitizer.isIdentifierSafe('table;drop')).toBe(false);
    });
  });

  // ============= isConditionSafe 条件安全检查测试 =============
  describe('isConditionSafe', () => {
    it('should accept safe conditions', () => {
      expect(sanitizer.isConditionSafe('id = 1')).toBe(true);
      expect(sanitizer.isConditionSafe("name LIKE 'test%'")).toBe(true);
      expect(sanitizer.isConditionSafe('dur BETWEEN 1000 AND 5000')).toBe(true);
    });

    it('should reject conditions with DROP', () => {
      expect(sanitizer.isConditionSafe('1=1; DROP TABLE slice')).toBe(false);
    });

    it('should reject conditions with DELETE', () => {
      expect(sanitizer.isConditionSafe('DELETE FROM slice')).toBe(false);
    });

    it('should reject conditions with SQL comments', () => {
      expect(sanitizer.isConditionSafe('1=1 -- comment')).toBe(false);
    });
  });

  // ============= 边界条件测试 =============
  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const template = '';
      const params = {};
      const result = sanitizer.sanitize(template, params);
      expect(result).toBe('');
    });

    it('should reject queries exceeding max length', () => {
      const longQuery = 'SELECT * FROM slice WHERE ' + 'a'.repeat(60000);
      expect(() => sanitizer.sanitize(longQuery, {})).toThrow(/exceeds maximum length/);
    });

    it('should handle NaN number values', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${value}';
      expect(() => sanitizer.sanitize(template, { value: NaN })).toThrow(/Invalid number/);
    });

    it('should handle Infinity number values', () => {
      const template = 'SELECT * FROM slice WHERE dur > ${value}';
      expect(() => sanitizer.sanitize(template, { value: Infinity })).toThrow(/Invalid number/);
    });

    it('should sanitize dangerous characters in parameters', () => {
      const template = 'SELECT * FROM slice WHERE name = ${name}';
      // sanitizeString 会清理危险字符
      const params = { name: "O'Brien--test" };
      const result = sanitizer.sanitize(template, params);
      // 单引号被转义，--被移除
      expect(result).toContain("O''Brien");
      expect(result).not.toContain('--');
    });

    it('should handle bigint values', () => {
      const template = 'SELECT * FROM slice WHERE ts = ${timestamp}';
      const params = { timestamp: BigInt(9007199254740991) };
      const result = sanitizer.sanitize(template, params);
      expect(result).toContain('9007199254740991');
    });

    it('should handle object values by stringifying', () => {
      const template = 'SELECT * FROM slice WHERE data = ${obj}';
      const params = { obj: { key: 'value' } };
      const result = sanitizer.sanitize(template, params);
      expect(result).toContain('[object Object]');
    });
  });

  // ============= 默认实例测试 =============
  describe('Default Instance', () => {
    it('should export a default sqlSanitizer instance', () => {
      expect(sqlSanitizer).toBeInstanceOf(SqlSanitizer);
    });

    it('should work with the default instance', () => {
      const sql = 'SELECT * FROM slice WHERE dur > ${dur}';
      const result = sqlSanitizer.sanitize(sql, { dur: 1000 });
      expect(result).toBe('SELECT * FROM slice WHERE dur > 1000');
    });
  });
});
