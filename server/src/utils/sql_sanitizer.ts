/**
 * SQL 安全防护工具
 * 提供参数化查询构建、SQL注入防护、白名单验证
 */

import { StructuredLogger } from './logger.js';

const logger = new StructuredLogger('sql_sanitizer');

// ============= 类型定义 =============

export interface ParameterBinding {
  name: string;
  value: unknown;
  type: string;
}

export interface SafeQuery {
  sql: string;
  bindings: ParameterBinding[];
  originalParams: Record<string, unknown>;
}

export interface SanitizeResult {
  success: boolean;
  query?: string;
  error?: string;
}

/**
 * SPEC-05: 参数匹配模式配置
 * 用于控制 string 参数在 SQL WHERE 中的匹配方式
 */
export interface ParamMatchConfig {
  matchMode?: 'exact' | 'contains' | 'prefix' | 'glob';
  columnRef?: string;
}

// ============= SQL 安全防护类 =============

export class SqlSanitizer {
  // 允许的 SQL 关键字白名单（仅查询操作）
  private static readonly ALLOWED_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
    'LIKE', 'GLOB', 'IS', 'NULL', 'AS', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT',
    'OFFSET', 'HAVING', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN',
    'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'ROUND',
    'COALESCE', 'IIF', 'WITH', 'UNION', 'ALL', 'EXCEPT', 'INTERSECT',
    'EXISTS', 'INCLUDE', 'PERFETTO', 'MODULE', 'LAG', 'LEAD', 'OVER',
    'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'FIRST_VALUE',
    'LAST_VALUE', 'NTH_VALUE', 'NTILE', 'PERCENT_RANK', 'CUME_DIST',
    'GROUP_CONCAT', 'SUBSTR', 'LENGTH', 'UPPER', 'LOWER', 'TRIM',
    'REPLACE', 'INSTR', 'ABS', 'IFNULL', 'NULLIF', 'TYPEOF', 'HEX',
    'PRINTF', 'ZEROBLOB', 'TOTAL', 'JSON_EXTRACT', 'JSON_ARRAY',
  ]);

  // 危险操作黑名单
  private static readonly DANGEROUS_KEYWORDS = new Set([
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE',
    'TRUNCATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE', 'ATTACH',
    'DETACH', 'VACUUM', 'REINDEX', 'ANALYZE', 'PRAGMA',
  ]);

  // 危险字符模式
  private static readonly DANGEROUS_PATTERNS = [
    /--/g,           // SQL 单行注释
    /\/\*/g,         // SQL 块注释开始
    /\*\//g,         // SQL 块注释结束
    /;\s*$/g,        // 语句结束符（末尾）
    /;\s*[A-Za-z]/g, // 语句分隔（多语句注入）
    /\bDROP\b/gi,
    /\bDELETE\b/gi,
    /\bINSERT\b/gi,
    /\bUPDATE\b/gi,
    /\bALTER\b/gi,
    /\bCREATE\b/gi,
    /\bTRUNCATE\b/gi,
    /\bEXEC\b/gi,
    /\bEXECUTE\b/gi,
  ];

  // 查询长度限制
  private static readonly MAX_QUERY_LENGTH = 50000;

  // 标识符验证正则（表名、列名）
  private static readonly IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

  /**
   * 主入口：将模板和参数组合成安全的 SQL
   * @param template SQL 模板，使用 ${param} 占位符
   * @param params 参数对象
   * @param paramConfigs SPEC-05: 可选的参数匹配模式配置（matchMode + columnRef）
   * @returns 安全的 SQL 字符串
   */
  sanitize(
    template: string,
    params: Record<string, unknown>,
    paramConfigs?: Record<string, ParamMatchConfig>
  ): string {
    // 1. 检查查询长度
    if (template.length > SqlSanitizer.MAX_QUERY_LENGTH) {
      throw new Error(`Query exceeds maximum length of ${SqlSanitizer.MAX_QUERY_LENGTH} characters`);
    }

    // 2. 检查是否包含危险关键字
    if (this.containsDangerousKeywords(template)) {
      throw new Error('Query contains dangerous SQL keywords');
    }

    // 3. 替换参数占位符
    let sql = template;
    
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `\${${key}}`;
      
      if (!sql.includes(placeholder)) {
        continue;
      }

      // SPEC-05: 检查是否有 matchMode + columnRef 配置
      const config = paramConfigs?.[key];
      if (config?.matchMode && config?.columnRef && typeof value === 'string') {
        const replacement = this.buildMatchExpression(config.matchMode, config.columnRef, value);
        sql = sql.split(placeholder).join(replacement);
      } else {
        // 根据值类型进行安全转换（原有逻辑）
        const safeValue = this.sanitizeValue(value);
        sql = sql.split(placeholder).join(safeValue);
      }
    }

    // 4. 处理条件表达式 ${condition ? "sql" : ""}
    sql = this.processConditionalExpressions(sql, params);

    // 5. 清理未替换的占位符
    sql = this.cleanupUnusedPlaceholders(sql);

    // 6. 最终安全检查
    if (this.containsDangerousPatterns(sql)) {
      throw new Error('Generated SQL contains potentially dangerous patterns');
    }

    return sql.trim();
  }

  /**
   * 构建参数化查询（返回 SQL + 绑定参数）
   */
  buildParameterizedQuery(
    template: string,
    params: Record<string, unknown>,
    paramDefs: Array<{ name: string; type: string }>
  ): SafeQuery {
    const bindings: ParameterBinding[] = [];
    let sql = template;
    let bindingIndex = 1;

    // 处理条件表达式
    sql = this.processConditionalExpressions(sql, params);

    // 替换参数为绑定占位符
    for (const paramDef of paramDefs) {
      const value = params[paramDef.name];
      if (value === undefined) continue;

      const placeholder = `\${${paramDef.name}}`;
      
      if (sql.includes(placeholder)) {
        // 对于 LIKE 操作，需要特殊处理
        if (sql.includes(`LIKE '%${placeholder}%'`)) {
          sql = sql.replace(
            `LIKE '%${placeholder}%'`,
            `LIKE '%' || $${bindingIndex} || '%'`
          );
        } else if (sql.includes(`LIKE '${placeholder}%'`)) {
          sql = sql.replace(
            `LIKE '${placeholder}%'`,
            `LIKE $${bindingIndex} || '%'`
          );
        } else if (sql.includes(`LIKE '%${placeholder}'`)) {
          sql = sql.replace(
            `LIKE '%${placeholder}'`,
            `LIKE '%' || $${bindingIndex}`
          );
        } else {
          // 普通替换
          sql = sql.split(placeholder).join(`$${bindingIndex}`);
        }

        bindings.push({
          name: paramDef.name,
          value,
          type: paramDef.type,
        });
        bindingIndex++;
      }
    }

    return {
      sql,
      bindings,
      originalParams: params,
    };
  }

  /**
   * 清理字符串参数，移除潜在的 SQL 注入字符
   */
  sanitizeString(value: string): string {
    // 转义单引号
    let sanitized = value.replace(/'/g, "''");
    
    // 移除 SQL 注释
    sanitized = sanitized.replace(/--/g, '');
    sanitized = sanitized.replace(/\/\*/g, '');
    sanitized = sanitized.replace(/\*\//g, '');
    
    // 移除分号
    sanitized = sanitized.replace(/;/g, '');
    
    // 移除换行符（防止多行注入）
    sanitized = sanitized.replace(/[\r\n]/g, ' ');
    
    return sanitized;
  }

  /**
   * 验证标识符（表名、列名）是否安全
   */
  isIdentifierSafe(identifier: string): boolean {
    return SqlSanitizer.IDENTIFIER_PATTERN.test(identifier);
  }

  /**
   * 检查条件 SQL 是否安全
   */
  isConditionSafe(condition: string): boolean {
    const upperCondition = condition.toUpperCase();

    // 检查是否包含危险关键字
    for (const keyword of SqlSanitizer.DANGEROUS_KEYWORDS) {
      if (upperCondition.includes(keyword)) {
        return false;
      }
    }

    // 检查危险模式
    for (const pattern of SqlSanitizer.DANGEROUS_PATTERNS) {
      if (pattern.test(condition)) {
        pattern.lastIndex = 0; // 重置正则状态
        return false;
      }
    }

    return true;
  }

  /**
   * 验证完整 SQL 语句是否为安全的查询
   */
  validateQuery(sql: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 长度检查
    if (sql.length > SqlSanitizer.MAX_QUERY_LENGTH) {
      errors.push(`Query exceeds maximum length of ${SqlSanitizer.MAX_QUERY_LENGTH}`);
    }

    // 危险关键字检查
    if (this.containsDangerousKeywords(sql)) {
      errors.push('Query contains dangerous SQL keywords (DROP, DELETE, INSERT, UPDATE, etc.)');
    }

    // 危险模式检查
    if (this.containsDangerousPatterns(sql)) {
      errors.push('Query contains potentially dangerous patterns');
    }

    // 必须以 SELECT 或 WITH 开头（忽略空白和 INCLUDE PERFETTO MODULE）
    const trimmedSql = sql.trim().toUpperCase();
    const startsWithSelect = trimmedSql.startsWith('SELECT') || 
                             trimmedSql.startsWith('WITH') ||
                             trimmedSql.startsWith('INCLUDE PERFETTO MODULE');
    
    if (!startsWithSelect) {
      errors.push('Query must start with SELECT, WITH, or INCLUDE PERFETTO MODULE');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ============= 私有方法 =============

  /**
   * SPEC-05: 根据 matchMode 构建 SQL 条件表达式
   */
  private buildMatchExpression(
    matchMode: 'exact' | 'contains' | 'prefix' | 'glob',
    columnRef: string,
    value: string
  ): string {
    // 验证 columnRef 是合法标识符
    if (!this.isIdentifierSafe(columnRef)) {
      logger.warn('Unsafe columnRef, falling back to escaped value', { columnRef });
      return `'${this.escapeStringValue(value)}'`;
    }

    const escaped = this.escapeStringValue(value);

    switch (matchMode) {
      case 'exact':
        return `${columnRef} = '${escaped}'`;
      case 'contains':
        return `${columnRef} LIKE '%${escaped}%'`;
      case 'prefix':
        return `${columnRef} LIKE '${escaped}%'`;
      case 'glob':
        return `${columnRef} GLOB '${escaped}'`;
      default:
        return `'${escaped}'`;
    }
  }

  /**
   * SPEC-05: SQL 字符串值转义（单引号 -> 双单引号）
   */
  private escapeStringValue(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * 根据值类型进行安全转换
   */
  private sanitizeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('Invalid number value (NaN or Infinity)');
      }
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (typeof value === 'bigint') {
      return String(value);
    }

    if (typeof value === 'string') {
      // 字符串需要转义并加引号
      const sanitized = this.sanitizeString(value);
      return `'${sanitized}'`;
    }

    if (Array.isArray(value)) {
      // 数组转换为 IN 子句格式
      const sanitizedItems = value.map(item => this.sanitizeValue(item));
      return `(${sanitizedItems.join(', ')})`;
    }

    // 其他类型转换为字符串
    const stringValue = String(value);
    const sanitized = this.sanitizeString(stringValue);
    return `'${sanitized}'`;
  }

  /**
   * 处理条件表达式 ${condition ? "trueValue" : "falseValue"}
   */
  private processConditionalExpressions(
    sql: string,
    params: Record<string, unknown>
  ): string {
    // 匹配 ${paramName ? "trueClause" : "falseClause"}
    const conditionalPattern = /\$\{(\w+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\}/g;

    return sql.replace(conditionalPattern, (match, paramName, trueClause, falseClause) => {
      const value = params[paramName];

      // 验证条件 SQL 不包含危险内容
      if (!this.isConditionSafe(trueClause) || !this.isConditionSafe(falseClause)) {
        logger.warn(`Unsafe conditional SQL detected`, { match });
        return ''; // 移除不安全的条件
      }

      // 只有当参数存在且有效时才包含条件
      if (value !== undefined && value !== null && value !== '') {
        return trueClause;
      }
      return falseClause;
    });
  }

  /**
   * 清理未替换的占位符
   */
  private cleanupUnusedPlaceholders(sql: string): string {
    // 移除形如 ${xxx} 的未替换占位符
    return sql.replace(/\$\{[^}]+\}/g, '');
  }

  /**
   * 检查是否包含危险关键字
   */
  private containsDangerousKeywords(sql: string): boolean {
    const upperSql = sql.toUpperCase();
    const words = upperSql.split(/\s+/);

    for (const word of words) {
      // 清理标点符号
      const cleanWord = word.replace(/[^A-Z]/g, '');
      if (SqlSanitizer.DANGEROUS_KEYWORDS.has(cleanWord)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否包含危险模式
   */
  private containsDangerousPatterns(sql: string): boolean {
    for (const pattern of SqlSanitizer.DANGEROUS_PATTERNS) {
      if (pattern.test(sql)) {
        pattern.lastIndex = 0; // 重置正则状态
        return true;
      }
    }
    return false;
  }
}

// ============= 导出默认实例 =============

export const sqlSanitizer = new SqlSanitizer();

export default SqlSanitizer;
