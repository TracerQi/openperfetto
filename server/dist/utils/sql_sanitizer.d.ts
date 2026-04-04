/**
 * SQL 安全防护工具
 * 提供参数化查询构建、SQL注入防护、白名单验证
 */
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
export declare class SqlSanitizer {
    private static readonly ALLOWED_KEYWORDS;
    private static readonly DANGEROUS_KEYWORDS;
    private static readonly DANGEROUS_PATTERNS;
    private static readonly MAX_QUERY_LENGTH;
    private static readonly IDENTIFIER_PATTERN;
    /**
     * 主入口：将模板和参数组合成安全的 SQL
     * @param template SQL 模板，使用 ${param} 占位符
     * @param params 参数对象
     * @returns 安全的 SQL 字符串
     */
    sanitize(template: string, params: Record<string, unknown>): string;
    /**
     * 构建参数化查询（返回 SQL + 绑定参数）
     */
    buildParameterizedQuery(template: string, params: Record<string, unknown>, paramDefs: Array<{
        name: string;
        type: string;
    }>): SafeQuery;
    /**
     * 清理字符串参数，移除潜在的 SQL 注入字符
     */
    sanitizeString(value: string): string;
    /**
     * 验证标识符（表名、列名）是否安全
     */
    isIdentifierSafe(identifier: string): boolean;
    /**
     * 检查条件 SQL 是否安全
     */
    isConditionSafe(condition: string): boolean;
    /**
     * 验证完整 SQL 语句是否为安全的查询
     */
    validateQuery(sql: string): {
        valid: boolean;
        errors: string[];
    };
    /**
     * 根据值类型进行安全转换
     */
    private sanitizeValue;
    /**
     * 处理条件表达式 ${condition ? "trueValue" : "falseValue"}
     */
    private processConditionalExpressions;
    /**
     * 清理未替换的占位符
     */
    private cleanupUnusedPlaceholders;
    /**
     * 检查是否包含危险关键字
     */
    private containsDangerousKeywords;
    /**
     * 检查是否包含危险模式
     */
    private containsDangerousPatterns;
}
export declare const sqlSanitizer: SqlSanitizer;
export default SqlSanitizer;
//# sourceMappingURL=sql_sanitizer.d.ts.map