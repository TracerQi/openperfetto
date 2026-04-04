/**
 * Skill 注册表
 * 管理所有 Skill 的加载、索引、查询、热重载
 */
import * as fs from 'fs';
import * as path from 'path';
import { StructuredLogger } from '../utils/logger.js';
import { YamlParser } from './yaml_parser.js';
const logger = new StructuredLogger('skill_registry');
// ============= Skill 注册表类 =============
export class SkillRegistry {
    // 主存储：id -> SkillDefinition
    skills = new Map();
    // 索引
    skillsByScene = new Map();
    skillsByType = new Map();
    skillsByTag = new Map();
    // 文件路径映射
    filePathToId = new Map();
    idToFilePath = new Map();
    // 文件监视器
    watchers = new Map();
    // YAML 解析器
    yamlParser;
    // 加载错误计数
    loadErrors = 0;
    // 库路径
    libraryPath = '';
    constructor(yamlParser) {
        this.yamlParser = yamlParser || new YamlParser();
    }
    /**
     * 初始化：加载所有 Skill
     */
    async initialize(libraryPath) {
        this.libraryPath = path.resolve(libraryPath);
        logger.info('Initializing SkillRegistry', { libraryPath: this.libraryPath });
        // 确保目录存在
        if (!fs.existsSync(this.libraryPath)) {
            logger.warn('Skills library path does not exist, creating...', { libraryPath: this.libraryPath });
            fs.mkdirSync(this.libraryPath, { recursive: true });
            return;
        }
        // 加载所有 Skill
        await this.loadAllSkills();
        // 启动文件监视（热重载）
        this.startWatching();
        logger.info('SkillRegistry initialized', { ...this.getStats() });
    }
    /**
     * 加载所有 Skill 文件
     */
    async loadAllSkills() {
        this.loadErrors = 0;
        // 递归扫描目录
        const yamlFiles = this.scanDirectory(this.libraryPath);
        logger.info(`Found ${yamlFiles.length} YAML files`);
        for (const filePath of yamlFiles) {
            await this.loadSkillFile(filePath);
        }
        logger.info('Skill loading complete', {
            loaded: this.skills.size,
            errors: this.loadErrors,
        });
    }
    /**
     * 加载单个 Skill 文件
     */
    async loadSkillFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const result = this.yamlParser.parseSkill(content, filePath);
            if (!result.success || !result.data) {
                logger.warn('Failed to parse skill file', {
                    filePath,
                    errors: result.errors,
                });
                this.loadErrors++;
                return false;
            }
            // 如果有警告，记录但继续
            if (result.warnings.length > 0) {
                logger.debug('Skill parsed with warnings', {
                    skillId: result.data.id,
                    warnings: result.warnings,
                });
            }
            // 注册 Skill
            this.register(result.data, filePath);
            return true;
        }
        catch (err) {
            logger.error('Error loading skill file', err, { filePath });
            this.loadErrors++;
            return false;
        }
    }
    /**
     * 注册 Skill
     */
    register(skill, filePath) {
        // 如果已存在，先移除旧索引
        if (this.skills.has(skill.id)) {
            this.unregister(skill.id);
        }
        // 存储 Skill
        this.skills.set(skill.id, skill);
        // 建立索引
        this.addToIndex(this.skillsByScene, skill.scene, skill.id);
        this.addToIndex(this.skillsByType, skill.type, skill.id);
        for (const tag of skill.tags) {
            this.addToIndex(this.skillsByTag, tag, skill.id);
        }
        // 存储文件路径映射
        if (filePath) {
            const normalizedPath = path.normalize(filePath);
            this.filePathToId.set(normalizedPath, skill.id);
            this.idToFilePath.set(skill.id, normalizedPath);
        }
        logger.debug('Skill registered', {
            id: skill.id,
            type: skill.type,
            scene: skill.scene,
        });
    }
    /**
     * 注销 Skill
     */
    unregister(skillId) {
        const skill = this.skills.get(skillId);
        if (!skill)
            return false;
        // 从索引中移除
        this.removeFromIndex(this.skillsByScene, skill.scene, skillId);
        this.removeFromIndex(this.skillsByType, skill.type, skillId);
        for (const tag of skill.tags) {
            this.removeFromIndex(this.skillsByTag, tag, skillId);
        }
        // 移除文件路径映射
        const filePath = this.idToFilePath.get(skillId);
        if (filePath) {
            this.filePathToId.delete(filePath);
            this.idToFilePath.delete(skillId);
        }
        // 删除 Skill
        this.skills.delete(skillId);
        logger.debug('Skill unregistered', { skillId });
        return true;
    }
    // ============= 查询方法 =============
    /**
     * 根据 ID 获取 Skill
     */
    getById(skillId) {
        return this.skills.get(skillId);
    }
    /**
     * 根据场景列出 Skill
     */
    listByScene(scene) {
        const ids = this.skillsByScene.get(scene) || new Set();
        return Array.from(ids).map(id => this.skills.get(id)).filter(Boolean);
    }
    /**
     * 根据类型列出 Skill
     */
    listByType(type) {
        const ids = this.skillsByType.get(type) || new Set();
        return Array.from(ids).map(id => this.skills.get(id)).filter(Boolean);
    }
    /**
     * 根据标签列出 Skill
     */
    listByTag(tag) {
        const ids = this.skillsByTag.get(tag) || new Set();
        return Array.from(ids).map(id => this.skills.get(id)).filter(Boolean);
    }
    /**
     * 获取所有 Skill
     */
    getAll() {
        return Array.from(this.skills.values());
    }
    /**
     * 获取所有 Skill 的简要信息
     */
    getAllInfo() {
        return Array.from(this.skills.entries()).map(([id, skill]) => ({
            id,
            name: skill.name,
            description: skill.description,
            type: skill.type,
            scene: skill.scene,
            tags: skill.tags,
            parameterCount: skill.parameters.length,
            filePath: this.idToFilePath.get(id) || '',
        }));
    }
    /**
     * 搜索 Skill
     */
    search(options) {
        let results = this.getAll();
        // 按场景过滤
        if (options.scene) {
            results = results.filter(s => s.scene === options.scene);
        }
        // 按类型过滤
        if (options.type) {
            results = results.filter(s => s.type === options.type);
        }
        // 按标签过滤
        if (options.tags && options.tags.length > 0) {
            results = results.filter(s => options.tags.some(tag => s.tags.includes(tag)));
        }
        // 按关键字搜索
        if (options.query) {
            const queryLower = options.query.toLowerCase();
            results = results.filter(s => s.id.toLowerCase().includes(queryLower) ||
                s.name.toLowerCase().includes(queryLower) ||
                s.description.toLowerCase().includes(queryLower));
        }
        // 限制数量
        if (options.limit && options.limit > 0) {
            results = results.slice(0, options.limit);
        }
        return results;
    }
    /**
     * 检查 Skill 是否存在
     */
    has(skillId) {
        return this.skills.has(skillId);
    }
    /**
     * 获取 Skill 数量
     */
    count() {
        return this.skills.size;
    }
    /**
     * 获取统计信息
     */
    getStats() {
        const byType = {};
        const byScene = {};
        for (const [type, ids] of this.skillsByType) {
            byType[type] = ids.size;
        }
        for (const [scene, ids] of this.skillsByScene) {
            byScene[scene] = ids.size;
        }
        return {
            totalSkills: this.skills.size,
            byType,
            byScene,
            loadErrors: this.loadErrors,
        };
    }
    /**
     * 获取所有场景
     */
    getScenes() {
        return Array.from(this.skillsByScene.keys());
    }
    /**
     * 获取所有类型
     */
    getTypes() {
        return Array.from(this.skillsByType.keys());
    }
    /**
     * 获取所有标签
     */
    getTags() {
        return Array.from(this.skillsByTag.keys());
    }
    // ============= 热重载 =============
    /**
     * 启动文件监视
     */
    startWatching() {
        if (!this.libraryPath || !fs.existsSync(this.libraryPath)) {
            return;
        }
        try {
            // 监视整个目录树
            const watcher = fs.watch(this.libraryPath, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.yaml'))
                    return;
                const filePath = path.join(this.libraryPath, filename);
                this.handleFileChange(eventType, filePath);
            });
            this.watchers.set(this.libraryPath, watcher);
            logger.info('File watching started', { path: this.libraryPath });
        }
        catch (err) {
            logger.warn('Failed to start file watching', { error: err.message });
        }
    }
    /**
     * 处理文件变更
     */
    handleFileChange(eventType, filePath) {
        const normalizedPath = path.normalize(filePath);
        logger.debug('File change detected', { eventType, filePath: normalizedPath });
        // 延迟处理，避免文件写入过程中读取
        setTimeout(async () => {
            try {
                if (!fs.existsSync(normalizedPath)) {
                    // 文件被删除
                    const skillId = this.filePathToId.get(normalizedPath);
                    if (skillId) {
                        this.unregister(skillId);
                        logger.info('Skill unloaded (file deleted)', { skillId, filePath: normalizedPath });
                    }
                    return;
                }
                // 文件被创建或修改
                const existingId = this.filePathToId.get(normalizedPath);
                const success = await this.loadSkillFile(normalizedPath);
                if (success) {
                    const action = existingId ? 'reloaded' : 'loaded';
                    logger.info(`Skill ${action}`, { filePath: normalizedPath });
                }
            }
            catch (err) {
                logger.error('Error handling file change', err, { filePath: normalizedPath });
            }
        }, 100);
    }
    /**
     * 停止文件监视
     */
    stopWatching() {
        for (const [path, watcher] of this.watchers) {
            watcher.close();
            logger.debug('File watcher closed', { path });
        }
        this.watchers.clear();
    }
    /**
     * 手动重新加载
     */
    async reload() {
        logger.info('Reloading all skills...');
        // 清空当前数据
        this.skills.clear();
        this.skillsByScene.clear();
        this.skillsByType.clear();
        this.skillsByTag.clear();
        this.filePathToId.clear();
        this.idToFilePath.clear();
        // 重新加载
        await this.loadAllSkills();
        logger.info('Reload complete', { ...this.getStats() });
    }
    /**
     * 销毁注册表
     */
    destroy() {
        this.stopWatching();
        this.skills.clear();
        this.skillsByScene.clear();
        this.skillsByType.clear();
        this.skillsByTag.clear();
        this.filePathToId.clear();
        this.idToFilePath.clear();
        logger.info('SkillRegistry destroyed');
    }
    // ============= 私有辅助方法 =============
    /**
     * 递归扫描目录获取所有 YAML 文件
     */
    scanDirectory(dirPath) {
        const files = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    files.push(...this.scanDirectory(fullPath));
                }
                else if (entry.isFile() && entry.name.endsWith('.yaml')) {
                    files.push(fullPath);
                }
            }
        }
        catch (err) {
            logger.warn('Error scanning directory', { dirPath, error: err.message });
        }
        return files;
    }
    /**
     * 添加到索引
     */
    addToIndex(map, key, skillId) {
        let set = map.get(key);
        if (!set) {
            set = new Set();
            map.set(key, set);
        }
        set.add(skillId);
    }
    /**
     * 从索引中移除
     */
    removeFromIndex(map, key, skillId) {
        const set = map.get(key);
        if (set) {
            set.delete(skillId);
            if (set.size === 0) {
                map.delete(key);
            }
        }
    }
}
// ============= 导出 =============
export default SkillRegistry;
//# sourceMappingURL=skill_registry.js.map