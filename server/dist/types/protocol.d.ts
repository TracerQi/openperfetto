/**
 * WebSocket 通信协议类型定义
 * 使用 Zod 进行运行时类型验证
 */
import { z } from 'zod';
export declare enum MessagePriority {
    HIGH = 0,// error
    MEDIUM = 1,// tool_result, skill_result
    LOW = 2
}
export declare const ChatMessageDTOSchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant", "system", "tool"]>;
    content: z.ZodString;
    toolCall: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }>>;
    toolResult: z.ZodOptional<z.ZodObject<{
        toolCallId: z.ZodString;
        success: z.ZodBoolean;
        data: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
    }, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
    }>>;
}, "strip", z.ZodTypeAny, {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCall?: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    } | undefined;
    toolResult?: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
    } | undefined;
}, {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCall?: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    } | undefined;
    toolResult?: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        data?: unknown;
    } | undefined;
}>;
export declare const ToolDefinitionDTOSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}>;
export declare const ChatRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"chat">;
    agentId: z.ZodString;
    traceId: z.ZodString;
    payload: z.ZodObject<{
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant", "system", "tool"]>;
            content: z.ZodString;
            toolCall: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            }, {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            }>>;
            toolResult: z.ZodOptional<z.ZodObject<{
                toolCallId: z.ZodString;
                success: z.ZodBoolean;
                data: z.ZodOptional<z.ZodUnknown>;
                error: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            }, {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            }>>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }, {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }>, "many">;
        tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }, {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }>, "many">>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        stream: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        requirePlan: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        stream: boolean;
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        requirePlan?: boolean | undefined;
    }, {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        stream?: boolean | undefined;
        requirePlan?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "chat";
    traceId: string;
    agentId: string;
    payload: {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        stream: boolean;
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        requirePlan?: boolean | undefined;
    };
}, {
    type: "chat";
    traceId: string;
    agentId: string;
    payload: {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        stream?: boolean | undefined;
        requirePlan?: boolean | undefined;
    };
}>;
export declare const PingMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    timestamp: number;
}, {
    type: "ping";
    timestamp: number;
}>;
export declare const InvokeSkillSchema: z.ZodObject<{
    type: z.ZodLiteral<"invoke_skill">;
    agentId: z.ZodOptional<z.ZodString>;
    skillId: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "invoke_skill";
    skillId: string;
    params?: Record<string, unknown> | undefined;
    traceId?: string | undefined;
    agentId?: string | undefined;
    requestId?: string | undefined;
}, {
    type: "invoke_skill";
    skillId: string;
    params?: Record<string, unknown> | undefined;
    traceId?: string | undefined;
    agentId?: string | undefined;
    requestId?: string | undefined;
}>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"chat">;
    agentId: z.ZodString;
    traceId: z.ZodString;
    payload: z.ZodObject<{
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant", "system", "tool"]>;
            content: z.ZodString;
            toolCall: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            }, {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            }>>;
            toolResult: z.ZodOptional<z.ZodObject<{
                toolCallId: z.ZodString;
                success: z.ZodBoolean;
                data: z.ZodOptional<z.ZodUnknown>;
                error: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            }, {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            }>>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }, {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }>, "many">;
        tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }, {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }>, "many">>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        stream: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        requirePlan: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        stream: boolean;
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        requirePlan?: boolean | undefined;
    }, {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        stream?: boolean | undefined;
        requirePlan?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "chat";
    traceId: string;
    agentId: string;
    payload: {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        stream: boolean;
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        requirePlan?: boolean | undefined;
    };
}, {
    type: "chat";
    traceId: string;
    agentId: string;
    payload: {
        messages: {
            role: "user" | "assistant" | "system" | "tool";
            content: string;
            toolCall?: {
                name: string;
                id: string;
                arguments: Record<string, unknown>;
            } | undefined;
            toolResult?: {
                toolCallId: string;
                success: boolean;
                error?: string | undefined;
                data?: unknown;
            } | undefined;
        }[];
        tools?: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[] | undefined;
        systemPrompt?: string | undefined;
        stream?: boolean | undefined;
        requirePlan?: boolean | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    timestamp: number;
}, {
    type: "ping";
    timestamp: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"invoke_skill">;
    agentId: z.ZodOptional<z.ZodString>;
    skillId: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "invoke_skill";
    skillId: string;
    params?: Record<string, unknown> | undefined;
    traceId?: string | undefined;
    agentId?: string | undefined;
    requestId?: string | undefined;
}, {
    type: "invoke_skill";
    skillId: string;
    params?: Record<string, unknown> | undefined;
    traceId?: string | undefined;
    agentId?: string | undefined;
    requestId?: string | undefined;
}>]>;
export type ChatMessageDTO = z.infer<typeof ChatMessageDTOSchema>;
export type ToolDefinitionDTO = z.infer<typeof ToolDefinitionDTOSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type InvokeSkillRequest = z.infer<typeof InvokeSkillSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export declare const TextDeltaResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"text_delta">;
    data: z.ZodObject<{
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
    }, {
        text: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "text_delta";
    data: {
        text: string;
    };
    traceId?: string | undefined;
}, {
    type: "text_delta";
    data: {
        text: string;
    };
    traceId?: string | undefined;
}>;
export declare const ToolUseResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"tool_use">;
    data: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_use";
    data: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    };
    traceId?: string | undefined;
}, {
    type: "tool_use";
    data: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    };
    traceId?: string | undefined;
}>;
export declare const ToolResultResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"tool_result">;
    data: z.ZodObject<{
        toolCallId: z.ZodString;
        requestId: z.ZodOptional<z.ZodString>;
        success: z.ZodBoolean;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    }, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_result";
    data: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    };
    traceId?: string | undefined;
}, {
    type: "tool_result";
    data: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    };
    traceId?: string | undefined;
}>;
export declare const ErrorResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"error">;
    data: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: unknown;
    }, {
        code: string;
        message: string;
        details?: unknown;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "error";
    data: {
        code: string;
        message: string;
        details?: unknown;
    };
    traceId?: string | undefined;
}, {
    type: "error";
    data: {
        code: string;
        message: string;
        details?: unknown;
    };
    traceId?: string | undefined;
}>;
export declare const DoneResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"done">;
    data: z.ZodObject<{
        agentId: z.ZodString;
        usage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
        }, {
            inputTokens: number;
            outputTokens: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }, {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "done";
    data: {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    };
    traceId?: string | undefined;
}, {
    type: "done";
    data: {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    };
    traceId?: string | undefined;
}>;
export declare const PongResponseSchema: z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"pong">;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    timestamp: number;
    traceId?: string | undefined;
}, {
    type: "pong";
    timestamp: number;
    traceId?: string | undefined;
}>;
export declare const ServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"text_delta">;
    data: z.ZodObject<{
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
    }, {
        text: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "text_delta";
    data: {
        text: string;
    };
    traceId?: string | undefined;
}, {
    type: "text_delta";
    data: {
        text: string;
    };
    traceId?: string | undefined;
}>, z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"tool_use">;
    data: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }, {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_use";
    data: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    };
    traceId?: string | undefined;
}, {
    type: "tool_use";
    data: {
        name: string;
        id: string;
        arguments: Record<string, unknown>;
    };
    traceId?: string | undefined;
}>, z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"tool_result">;
    data: z.ZodObject<{
        toolCallId: z.ZodString;
        requestId: z.ZodOptional<z.ZodString>;
        success: z.ZodBoolean;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    }, {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_result";
    data: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    };
    traceId?: string | undefined;
}, {
    type: "tool_result";
    data: {
        toolCallId: string;
        success: boolean;
        error?: string | undefined;
        requestId?: string | undefined;
        result?: unknown;
    };
    traceId?: string | undefined;
}>, z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"error">;
    data: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: unknown;
    }, {
        code: string;
        message: string;
        details?: unknown;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "error";
    data: {
        code: string;
        message: string;
        details?: unknown;
    };
    traceId?: string | undefined;
}, {
    type: "error";
    data: {
        code: string;
        message: string;
        details?: unknown;
    };
    traceId?: string | undefined;
}>, z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"done">;
    data: z.ZodObject<{
        agentId: z.ZodString;
        usage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
        }, {
            inputTokens: number;
            outputTokens: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }, {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "done";
    data: {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    };
    traceId?: string | undefined;
}, {
    type: "done";
    data: {
        agentId: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    };
    traceId?: string | undefined;
}>, z.ZodObject<{
    traceId: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"pong">;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    timestamp: number;
    traceId?: string | undefined;
}, {
    type: "pong";
    timestamp: number;
    traceId?: string | undefined;
}>]>;
export type TextDeltaResponse = z.infer<typeof TextDeltaResponseSchema>;
export type ToolUseResponse = z.infer<typeof ToolUseResponseSchema>;
export type ToolResultResponse = z.infer<typeof ToolResultResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type DoneResponse = z.infer<typeof DoneResponseSchema>;
export type PongResponse = z.infer<typeof PongResponseSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
/**
 * 验证客户端消息
 */
export declare function validateClientMessage(data: unknown): ClientMessage;
/**
 * 安全验证客户端消息（返回 null 而不是抛出异常）
 */
export declare function safeValidateClientMessage(data: unknown): ClientMessage | null;
/**
 * 获取消息优先级
 */
export declare function getMessagePriority(message: ServerMessage): MessagePriority;
//# sourceMappingURL=protocol.d.ts.map