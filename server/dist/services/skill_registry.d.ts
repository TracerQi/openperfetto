/**
 * Skill 注册表
 * 管理所有 Skill 的加载、索引、查询、热重载
 */
import { YamlParser, SkillDefinition, SceneType, SkillType } from './yaml_parser.js';
export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    type: SkillType;
    scene: SceneType;
    tags: string[];
    parameterCount: number;
    filePath: string;
}
export interface SearchOptions {
    scene?: SceneType;
    type?: SkillType;
    tags?: string[];
    query?: string;
    limit?: number;
}
export interface RegistryStats {
    totalSkills: number;
    byType: Record<string, number>;
    byScene: Record<string, number>;
    loadErrors: number;
}
export declare class SkillRegistry {
    private skills;
    private skillsByScene;
    private skillsByType;
    private skillsByTag;
    private filePathToId;
    private idToFilePath;
    private watchers;
    private yamlParser;
    private loadErrors;
    private libraryPath;
    constructor(yamlParser?: YamlParser);
    /**
     * 初始化：加载所有 Skill
     */
    initialize(libraryPath: string): Promise<void>;
    /**
     * 加载所有 Skill 文件
     */
    loadAllSkills(): Promise<void>;
    /**
     * 加载单个 Skill 文件
     */
    loadSkillFile(filePath: string): Promise<boolean>;
    /**
     * 注册 Skill
     */
    register(skill: SkillDefinition, filePath?: string): void;
    /**
     * 注销 Skill
     */
    unregister(skillId: string): boolean;
    /**
     * 根据 ID 获取 Skill
     */
    getById(skillId: string): SkillDefinition | undefined;
    /**
     * 根据场景列出 Skill
     */
    listByScene(scene: SceneType): SkillDefinition[];
    /**
     * 根据类型列出 Skill
     */
    listByType(type: SkillType): SkillDefinition[];
    /**
     * 根据标签列出 Skill
     */
    listByTag(tag: string): SkillDefinition[];
    /**
     * 获取所有 Skill
     */
    getAll(): SkillDefinition[];
    /**
     * 获取所有 Skill 的简要信息
     */
    getAllInfo(): SkillInfo[];
    /**
     * 搜索 Skill
     */
    search(options: SearchOptions): SkillDefinition[];
    /**
     * 检查 Skill 是否存在
     */
    has(skillId: string): boolean;
    /**
     * 获取 Skill 数量
     */
    count(): number;
    /**
     * 获取统计信息
     */
    getStats(): RegistryStats;
    /**
     * 获取所有场景
     */
    getScenes(): SceneType[];
    /**
     * 获取所有类型
     */
    getTypes(): SkillType[];
    /**
     * 获取所有标签
     */
    getTags(): string[];
    /**
     * 启动文件监视
     */
    private startWatching;
    /**
     * 处理文件变更
     */
    private handleFileChange;
    /**
     * 停止文件监视
     */
    stopWatching(): void;
    /**
     * 手动重新加载
     */
    reload(): Promise<void>;
    /**
     * 销毁注册表
     */
    destroy(): void;
    /**
     * 递归扫描目录获取所有 YAML 文件
     */
    private scanDirectory;
    /**
     * 添加到索引
     */
    private addToIndex;
    /**
     * 从索引中移除
     */
    private removeFromIndex;
}
export default SkillRegistry;
//# sourceMappingURL=skill_registry.d.ts.map