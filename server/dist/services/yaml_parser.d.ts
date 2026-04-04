/**
 * YAML Skill 解析器
 * 解析和验证 Skill YAML 定义文件
 */
import { z } from 'zod';
/**
 * Skill 参数定义 Schema
 */
export declare const SkillParamSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<["string", "integer", "float", "boolean", "array"]>;
    required: z.ZodDefault<z.ZodBoolean>;
    description: z.ZodOptional<z.ZodString>;
    default: z.ZodOptional<z.ZodUnknown>;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
    maxLength: z.ZodOptional<z.ZodNumber>;
    pattern: z.ZodOptional<z.ZodString>;
    allowedValues: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "string" | "boolean" | "integer" | "float" | "array";
    name: string;
    required: boolean;
    max?: number | undefined;
    description?: string | undefined;
    default?: unknown;
    min?: number | undefined;
    maxLength?: number | undefined;
    pattern?: string | undefined;
    allowedValues?: string[] | undefined;
}, {
    type: "string" | "boolean" | "integer" | "float" | "array";
    name: string;
    max?: number | undefined;
    description?: string | undefined;
    required?: boolean | undefined;
    default?: unknown;
    min?: number | undefined;
    maxLength?: number | undefined;
    pattern?: string | undefined;
    allowedValues?: string[] | undefined;
}>;
export type SkillParam = z.infer<typeof SkillParamSchema>;
/**
 * 输出列定义 Schema
 */
export declare const OutputColumnSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodString;
    unit: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: string;
    name: string;
    description?: string | undefined;
    unit?: string | undefined;
}, {
    type: string;
    name: string;
    description?: string | undefined;
    unit?: string | undefined;
}>;
export type OutputColumn = z.infer<typeof OutputColumnSchema>;
/**
 * 输出模式 Schema
 */
export declare const OutputSchemaSchema: z.ZodObject<{
    columns: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        unit: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
        description?: string | undefined;
        unit?: string | undefined;
    }, {
        type: string;
        name: string;
        description?: string | undefined;
        unit?: string | undefined;
    }>, "many">;
    displayLevel: z.ZodDefault<z.ZodEnum<["summary", "detail"]>>;
}, "strip", z.ZodTypeAny, {
    columns: {
        type: string;
        name: string;
        description?: string | undefined;
        unit?: string | undefined;
    }[];
    displayLevel: "summary" | "detail";
}, {
    columns: {
        type: string;
        name: string;
        description?: string | undefined;
        unit?: string | undefined;
    }[];
    displayLevel?: "summary" | "detail" | undefined;
}>;
export type OutputSchema = z.infer<typeof OutputSchemaSchema>;
export interface SkillStep {
    id: string;
    skill?: string;
    type?: 'skill' | 'iterator' | 'conditional' | 'diagnostic';
    params?: Record<string, unknown>;
    forEach?: string;
    filter?: string;
    maxItems?: number;
    body?: SkillStep[];
    condition?: string;
    template?: string;
    inputFrom?: string;
    dependsOn?: string | string[];
}
export declare const SkillStepSchema: z.ZodType<SkillStep>;
/**
 * Pipeline 阶段定义 Schema
 */
export declare const PipelineStageSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    skills: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    dependsOn: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
    inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    outputs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    type: z.ZodDefault<z.ZodEnum<["skill", "diagnostic"]>>;
    template: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "skill" | "diagnostic";
    name: string;
    id: string;
    outputs: string[];
    skills?: string[] | undefined;
    template?: string | undefined;
    dependsOn?: string | string[] | undefined;
    inputMapping?: Record<string, string> | undefined;
}, {
    name: string;
    id: string;
    type?: "skill" | "diagnostic" | undefined;
    skills?: string[] | undefined;
    template?: string | undefined;
    dependsOn?: string | string[] | undefined;
    inputMapping?: Record<string, string> | undefined;
    outputs?: string[] | undefined;
}>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
/**
 * Pipeline 配置 Schema
 */
export declare const PipelineConfigSchema: z.ZodObject<{
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    stageTimeoutMs: z.ZodDefault<z.ZodNumber>;
    continueOnError: z.ZodDefault<z.ZodBoolean>;
    parallelStages: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    timeoutMs: number;
    stageTimeoutMs: number;
    continueOnError: boolean;
    parallelStages: boolean;
}, {
    timeoutMs?: number | undefined;
    stageTimeoutMs?: number | undefined;
    continueOnError?: boolean | undefined;
    parallelStages?: boolean | undefined;
}>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
/**
 * 诊断规则 Schema
 */
export declare const DiagnosticRuleSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    condition: z.ZodString;
    severity: z.ZodDefault<z.ZodEnum<["info", "warning", "error", "critical"]>>;
    message: z.ZodString;
    recommendation: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    message: string;
    name: string;
    id: string;
    condition: string;
    severity: "info" | "error" | "warning" | "critical";
    recommendation?: string | undefined;
}, {
    message: string;
    name: string;
    id: string;
    condition: string;
    severity?: "info" | "error" | "warning" | "critical" | undefined;
    recommendation?: string | undefined;
}>;
export type DiagnosticRule = z.infer<typeof DiagnosticRuleSchema>;
/**
 * Skill 类型枚举
 */
export declare const SkillTypeEnum: z.ZodEnum<["sql_query", "sql_metric", "composite", "pipeline", "diagnostic"]>;
export type SkillType = z.infer<typeof SkillTypeEnum>;
/**
 * 场景类型枚举
 */
export declare const SceneTypeEnum: z.ZodEnum<["scrolling", "startup", "anr", "memory", "power", "lock", "binder", "network", "io", "general"]>;
export type SceneType = z.infer<typeof SceneTypeEnum>;
/**
 * 完整 Skill 定义 Schema
 */
export declare const SkillDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    type: z.ZodEnum<["sql_query", "sql_metric", "composite", "pipeline", "diagnostic"]>;
    scene: z.ZodEnum<["scrolling", "startup", "anr", "memory", "power", "lock", "binder", "network", "io", "general"]>;
    category: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    parameters: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<["string", "integer", "float", "boolean", "array"]>;
        required: z.ZodDefault<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
        default: z.ZodOptional<z.ZodUnknown>;
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
        maxLength: z.ZodOptional<z.ZodNumber>;
        pattern: z.ZodOptional<z.ZodString>;
        allowedValues: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "string" | "boolean" | "integer" | "float" | "array";
        name: string;
        required: boolean;
        max?: number | undefined;
        description?: string | undefined;
        default?: unknown;
        min?: number | undefined;
        maxLength?: number | undefined;
        pattern?: string | undefined;
        allowedValues?: string[] | undefined;
    }, {
        type: "string" | "boolean" | "integer" | "float" | "array";
        name: string;
        max?: number | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        default?: unknown;
        min?: number | undefined;
        maxLength?: number | undefined;
        pattern?: string | undefined;
        allowedValues?: string[] | undefined;
    }>, "many">>;
    sqlTemplate: z.ZodOptional<z.ZodString>;
    steps: z.ZodOptional<z.ZodArray<z.ZodType<SkillStep, z.ZodTypeDef, SkillStep>, "many">>;
    pipelineConfig: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        stageTimeoutMs: z.ZodDefault<z.ZodNumber>;
        continueOnError: z.ZodDefault<z.ZodBoolean>;
        parallelStages: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        timeoutMs: number;
        stageTimeoutMs: number;
        continueOnError: boolean;
        parallelStages: boolean;
    }, {
        timeoutMs?: number | undefined;
        stageTimeoutMs?: number | undefined;
        continueOnError?: boolean | undefined;
        parallelStages?: boolean | undefined;
    }>>;
    stages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        skills: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        dependsOn: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        outputs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        type: z.ZodDefault<z.ZodEnum<["skill", "diagnostic"]>>;
        template: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "skill" | "diagnostic";
        name: string;
        id: string;
        outputs: string[];
        skills?: string[] | undefined;
        template?: string | undefined;
        dependsOn?: string | string[] | undefined;
        inputMapping?: Record<string, string> | undefined;
    }, {
        name: string;
        id: string;
        type?: "skill" | "diagnostic" | undefined;
        skills?: string[] | undefined;
        template?: string | undefined;
        dependsOn?: string | string[] | undefined;
        inputMapping?: Record<string, string> | undefined;
        outputs?: string[] | undefined;
    }>, "many">>;
    diagnosticRules: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        condition: z.ZodString;
        severity: z.ZodDefault<z.ZodEnum<["info", "warning", "error", "critical"]>>;
        message: z.ZodString;
        recommendation: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        name: string;
        id: string;
        condition: string;
        severity: "info" | "error" | "warning" | "critical";
        recommendation?: string | undefined;
    }, {
        message: string;
        name: string;
        id: string;
        condition: string;
        severity?: "info" | "error" | "warning" | "critical" | undefined;
        recommendation?: string | undefined;
    }>, "many">>;
    outputSchema: z.ZodOptional<z.ZodObject<{
        columns: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            type: z.ZodString;
            unit: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }, {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }>, "many">;
        displayLevel: z.ZodDefault<z.ZodEnum<["summary", "detail"]>>;
    }, "strip", z.ZodTypeAny, {
        columns: {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }[];
        displayLevel: "summary" | "detail";
    }, {
        columns: {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }[];
        displayLevel?: "summary" | "detail" | undefined;
    }>>;
    relatedSkills: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    relatedTools: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    vendor: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "diagnostic" | "sql_query" | "sql_metric" | "composite" | "pipeline";
    version: string;
    name: string;
    id: string;
    description: string;
    scene: "memory" | "scrolling" | "startup" | "anr" | "power" | "lock" | "binder" | "network" | "io" | "general";
    tags: string[];
    parameters: {
        type: "string" | "boolean" | "integer" | "float" | "array";
        name: string;
        required: boolean;
        max?: number | undefined;
        description?: string | undefined;
        default?: unknown;
        min?: number | undefined;
        maxLength?: number | undefined;
        pattern?: string | undefined;
        allowedValues?: string[] | undefined;
    }[];
    relatedSkills: string[];
    relatedTools: string[];
    metadata?: Record<string, unknown> | undefined;
    category?: string | undefined;
    sqlTemplate?: string | undefined;
    steps?: SkillStep[] | undefined;
    pipelineConfig?: {
        timeoutMs: number;
        stageTimeoutMs: number;
        continueOnError: boolean;
        parallelStages: boolean;
    } | undefined;
    stages?: {
        type: "skill" | "diagnostic";
        name: string;
        id: string;
        outputs: string[];
        skills?: string[] | undefined;
        template?: string | undefined;
        dependsOn?: string | string[] | undefined;
        inputMapping?: Record<string, string> | undefined;
    }[] | undefined;
    diagnosticRules?: {
        message: string;
        name: string;
        id: string;
        condition: string;
        severity: "info" | "error" | "warning" | "critical";
        recommendation?: string | undefined;
    }[] | undefined;
    outputSchema?: {
        columns: {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }[];
        displayLevel: "summary" | "detail";
    } | undefined;
    vendor?: string | undefined;
}, {
    type: "diagnostic" | "sql_query" | "sql_metric" | "composite" | "pipeline";
    name: string;
    id: string;
    description: string;
    scene: "memory" | "scrolling" | "startup" | "anr" | "power" | "lock" | "binder" | "network" | "io" | "general";
    version?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    category?: string | undefined;
    tags?: string[] | undefined;
    parameters?: {
        type: "string" | "boolean" | "integer" | "float" | "array";
        name: string;
        max?: number | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        default?: unknown;
        min?: number | undefined;
        maxLength?: number | undefined;
        pattern?: string | undefined;
        allowedValues?: string[] | undefined;
    }[] | undefined;
    sqlTemplate?: string | undefined;
    steps?: SkillStep[] | undefined;
    pipelineConfig?: {
        timeoutMs?: number | undefined;
        stageTimeoutMs?: number | undefined;
        continueOnError?: boolean | undefined;
        parallelStages?: boolean | undefined;
    } | undefined;
    stages?: {
        name: string;
        id: string;
        type?: "skill" | "diagnostic" | undefined;
        skills?: string[] | undefined;
        template?: string | undefined;
        dependsOn?: string | string[] | undefined;
        inputMapping?: Record<string, string> | undefined;
        outputs?: string[] | undefined;
    }[] | undefined;
    diagnosticRules?: {
        message: string;
        name: string;
        id: string;
        condition: string;
        severity?: "info" | "error" | "warning" | "critical" | undefined;
        recommendation?: string | undefined;
    }[] | undefined;
    outputSchema?: {
        columns: {
            type: string;
            name: string;
            description?: string | undefined;
            unit?: string | undefined;
        }[];
        displayLevel?: "summary" | "detail" | undefined;
    } | undefined;
    relatedSkills?: string[] | undefined;
    relatedTools?: string[] | undefined;
    vendor?: string | undefined;
}>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export interface ParseResult<T> {
    success: boolean;
    data?: T;
    errors: string[];
    warnings: string[];
}
export declare class YamlParser {
    /**
     * 解析 Skill YAML 内容
     */
    parseSkill(yamlContent: string, filePath?: string): ParseResult<SkillDefinition>;
    /**
     * 批量解析多个 Skill
     */
    parseMultiple(yamlContents: Array<{
        content: string;
        filePath: string;
    }>): Array<{
        filePath: string;
        result: ParseResult<SkillDefinition>;
    }>;
    /**
     * 验证 Skill 定义（不解析 YAML）
     */
    validateSkillDefinition(skill: unknown): ParseResult<SkillDefinition>;
    /**
     * 预处理 YAML 数据：转换字段名
     */
    private preprocessYamlData;
    /**
     * 业务规则验证
     */
    private validateBusinessRules;
    /**
     * 从 SQL 模板中提取参数名
     */
    private extractTemplateParams;
}
export declare const yamlParser: YamlParser;
export default YamlParser;
//# sourceMappingURL=yaml_parser.d.ts.map