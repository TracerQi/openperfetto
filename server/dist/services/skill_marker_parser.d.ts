/**
 * Skill 标记解析器
 * 解析文本中的 skill:<skill_id>|<params_json> 标记
 */
export interface SkillMarker {
    /** 完整匹配文本 */
    fullMatch: string;
    /** Skill 名称 */
    skillId: string;
    /** 解析后的参数 */
    params: Record<string, unknown>;
    /** 开始索引 */
    startIndex: number;
    /** 结束索引 */
    endIndex: number;
}
export interface ParseResult {
    /** 是否解析成功 */
    success: boolean;
    /** 解析出的标记列表 */
    markers: SkillMarker[];
    /** 解析错误（如果有） */
    errors: Array<{
        position: number;
        message: string;
        rawText: string;
    }>;
}
export declare class SkillMarkerParser {
    /**
     * Skill ID 格式验证正则
     * 只允许小写字母开头，后跟小写字母、数字或下划线
     */
    private static readonly SKILL_ID_PATTERN;
    /**
     * Skill 标记匹配正则
     * 格式: skill:<skill_id>|<params_json>
     * 支持嵌套 JSON（使用平衡括号匹配）
     */
    private static readonly SKILL_MARKER_REGEX;
    /**
     * 解析文本中的所有 Skill 标记
     */
    parse(text: string): ParseResult;
    /**
     * 替换文本中的 Skill 标记
     * @param text 原始文本
     * @param replacer 替换函数，接收 SkillMarker 返回替换文本
     */
    replace(text: string, replacer: (marker: SkillMarker) => string): string;
    /**
     * 检查文本是否包含 Skill 标记
     */
    hasMarkers(text: string): boolean;
    /**
     * 提取所有 Skill ID（去重）
     */
    extractSkillIds(text: string): string[];
    /**
     * 验证 Skill ID 格式
     */
    validateSkillId(skillId: string): boolean;
    /**
     * 验证 Skill 标记字符串格式
     */
    validateMarker(markerText: string): {
        valid: boolean;
        skillId?: string;
        params?: Record<string, unknown>;
        error?: string;
    };
    /**
     * 构建 Skill 标记字符串
     */
    buildMarker(skillId: string, params: Record<string, unknown>): string;
}
export declare const skillMarkerParser: SkillMarkerParser;
export default SkillMarkerParser;
//# sourceMappingURL=skill_marker_parser.d.ts.map