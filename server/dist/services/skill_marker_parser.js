/**
 * Skill 标记解析器
 * 解析文本中的 skill:<skill_id>|<params_json> 标记
 */
import { StructuredLogger } from '../utils/logger.js';
const logger = new StructuredLogger('skill_marker_parser');
// ============= Skill 标记解析器 =============
export class SkillMarkerParser {
    /**
     * Skill ID 格式验证正则
     * 只允许小写字母开头，后跟小写字母、数字或下划线
     */
    static SKILL_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
    /**
     * Skill 标记匹配正则
     * 格式: skill:<skill_id>|<params_json>
     * 支持嵌套 JSON（使用平衡括号匹配）
     */
    static SKILL_MARKER_REGEX = /skill:([a-z][a-z0-9_]*)\|(\{(?:[^{}]|\{[^{}]*\})*\})/g;
    /**
     * 解析文本中的所有 Skill 标记
     */
    parse(text) {
        const markers = [];
        const errors = [];
        // 重置正则的 lastIndex
        const regex = new RegExp(SkillMarkerParser.SKILL_MARKER_REGEX.source, 'g');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const [fullMatch, skillId, paramsJson] = match;
            const startIndex = match.index;
            const endIndex = startIndex + fullMatch.length;
            // 验证 Skill ID 格式
            if (!this.validateSkillId(skillId)) {
                errors.push({
                    position: startIndex,
                    message: `Invalid skill ID format: "${skillId}". Must start with lowercase letter and contain only lowercase letters, numbers, and underscores.`,
                    rawText: fullMatch,
                });
                continue;
            }
            // 解析 JSON 参数
            let params;
            try {
                params = JSON.parse(paramsJson);
                // 确保 params 是对象
                if (typeof params !== 'object' || params === null || Array.isArray(params)) {
                    throw new Error('Params must be a JSON object');
                }
            }
            catch (e) {
                errors.push({
                    position: startIndex,
                    message: `Invalid JSON params: ${e instanceof Error ? e.message : 'Unknown error'}`,
                    rawText: fullMatch,
                });
                continue;
            }
            markers.push({
                fullMatch,
                skillId,
                params,
                startIndex,
                endIndex,
            });
        }
        return {
            success: errors.length === 0,
            markers,
            errors,
        };
    }
    /**
     * 替换文本中的 Skill 标记
     * @param text 原始文本
     * @param replacer 替换函数，接收 SkillMarker 返回替换文本
     */
    replace(text, replacer) {
        const result = this.parse(text);
        if (result.markers.length === 0) {
            return text;
        }
        // 从后往前替换，避免索引偏移问题
        const sortedMarkers = [...result.markers].sort((a, b) => b.startIndex - a.startIndex);
        let modifiedText = text;
        for (const marker of sortedMarkers) {
            try {
                const replacement = replacer(marker);
                modifiedText =
                    modifiedText.slice(0, marker.startIndex) +
                        replacement +
                        modifiedText.slice(marker.endIndex);
            }
            catch (e) {
                logger.warn('Failed to replace skill marker', {
                    skillId: marker.skillId,
                    error: e instanceof Error ? e.message : 'Unknown error',
                });
            }
        }
        return modifiedText;
    }
    /**
     * 异步替换文本中的 Skill 标记
     * @param text 原始文本
     * @param replacer 异步替换函数，接收 SkillMarker 返回替换文本的 Promise
     */
    async replaceAsync(text, replacer) {
        const result = this.parse(text);
        if (result.markers.length === 0) {
            return text;
        }
        // 从后往前替换，避免索引偏移问题
        const sortedMarkers = [...result.markers].sort((a, b) => b.startIndex - a.startIndex);
        let modifiedText = text;
        for (const marker of sortedMarkers) {
            try {
                const replacement = await replacer(marker);
                modifiedText =
                    modifiedText.slice(0, marker.startIndex) +
                        replacement +
                        modifiedText.slice(marker.endIndex);
            }
            catch (e) {
                logger.warn('Failed to async replace skill marker', {
                    skillId: marker.skillId,
                    error: e instanceof Error ? e.message : 'Unknown error',
                });
            }
        }
        return modifiedText;
    }
    /**
     * 检查文本是否包含 Skill 标记
     */
    hasMarkers(text) {
        const regex = new RegExp(SkillMarkerParser.SKILL_MARKER_REGEX.source);
        return regex.test(text);
    }
    /**
     * 提取所有 Skill ID（去重）
     */
    extractSkillIds(text) {
        const result = this.parse(text);
        const skillIds = new Set(result.markers.map(m => m.skillId));
        return Array.from(skillIds);
    }
    /**
     * 验证 Skill ID 格式
     */
    validateSkillId(skillId) {
        return SkillMarkerParser.SKILL_ID_PATTERN.test(skillId);
    }
    /**
     * 验证 Skill 标记字符串格式
     */
    validateMarker(markerText) {
        // 检查基本格式
        if (!markerText.startsWith('skill:')) {
            return { valid: false, error: 'Marker must start with "skill:"' };
        }
        const pipeIndex = markerText.indexOf('|');
        if (pipeIndex === -1) {
            return { valid: false, error: 'Marker must contain "|" separator' };
        }
        const skillId = markerText.slice(6, pipeIndex);
        const paramsJson = markerText.slice(pipeIndex + 1);
        // 验证 Skill ID
        if (!this.validateSkillId(skillId)) {
            return {
                valid: false,
                error: `Invalid skill ID: "${skillId}"`,
            };
        }
        // 验证 JSON
        try {
            const params = JSON.parse(paramsJson);
            if (typeof params !== 'object' || params === null || Array.isArray(params)) {
                return { valid: false, error: 'Params must be a JSON object' };
            }
            return { valid: true, skillId, params };
        }
        catch (e) {
            return {
                valid: false,
                error: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
            };
        }
    }
    /**
     * 构建 Skill 标记字符串
     */
    buildMarker(skillId, params) {
        if (!this.validateSkillId(skillId)) {
            throw new Error(`Invalid skill ID: "${skillId}"`);
        }
        return `skill:${skillId}|${JSON.stringify(params)}`;
    }
}
// ============= 默认实例导出 =============
export const skillMarkerParser = new SkillMarkerParser();
export default SkillMarkerParser;
//# sourceMappingURL=skill_marker_parser.js.map