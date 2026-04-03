/**
 * WebSocket 通信协议类型定义
 * 使用 Zod 进行运行时类型验证
 */

import { z } from 'zod';

// ============= 消息优先级 =============

export enum MessagePriority {
  HIGH = 0,    // error
  MEDIUM = 1,  // tool_result, skill_result
  LOW = 2,     // text_delta, done, pong
}

// ============= 前端 → 后端 消息 =============

export const ChatMessageDTOSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCall: z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  }).optional(),
  toolResult: z.object({
    toolCallId: z.string(),
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }).optional(),
});

export const ToolDefinitionDTOSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});

export const ChatRequestSchema = z.object({
  type: z.literal('chat'),
  agentId: z.string().uuid(),
  traceId: z.string().uuid(),
  payload: z.object({
    messages: z.array(ChatMessageDTOSchema),
    tools: z.array(ToolDefinitionDTOSchema).optional(),
    systemPrompt: z.string().optional(),
    stream: z.boolean().optional().default(true),
    requirePlan: z.boolean().optional(),
  }),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  timestamp: z.number(),
});

// 前端 → 后端 消息联合类型
export const ClientMessageSchema = z.discriminatedUnion('type', [
  ChatRequestSchema,
  PingMessageSchema,
]);

export type ChatMessageDTO = z.infer<typeof ChatMessageDTOSchema>;
export type ToolDefinitionDTO = z.infer<typeof ToolDefinitionDTOSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ============= 后端 → 前端 消息 =============

// 基础响应接口，包含追踪ID
const BaseResponseSchema = z.object({
  traceId: z.string().optional(),
});

export const TextDeltaResponseSchema = BaseResponseSchema.extend({
  type: z.literal('text_delta'),
  data: z.object({
    text: z.string(),
  }),
});

export const ToolUseResponseSchema = BaseResponseSchema.extend({
  type: z.literal('tool_use'),
  data: z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  }),
});

export const ToolResultResponseSchema = BaseResponseSchema.extend({
  type: z.literal('tool_result'),
  data: z.object({
    toolCallId: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

export const ErrorResponseSchema = BaseResponseSchema.extend({
  type: z.literal('error'),
  data: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const DoneResponseSchema = BaseResponseSchema.extend({
  type: z.literal('done'),
  data: z.object({
    agentId: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
    }).optional(),
  }),
});

export const PongResponseSchema = BaseResponseSchema.extend({
  type: z.literal('pong'),
  timestamp: z.number(),
});

// 后端 → 前端 消息联合类型
export const ServerMessageSchema = z.discriminatedUnion('type', [
  TextDeltaResponseSchema,
  ToolUseResponseSchema,
  ToolResultResponseSchema,
  ErrorResponseSchema,
  DoneResponseSchema,
  PongResponseSchema,
]);

export type TextDeltaResponse = z.infer<typeof TextDeltaResponseSchema>;
export type ToolUseResponse = z.infer<typeof ToolUseResponseSchema>;
export type ToolResultResponse = z.infer<typeof ToolResultResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type DoneResponse = z.infer<typeof DoneResponseSchema>;
export type PongResponse = z.infer<typeof PongResponseSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ============= 辅助函数 =============

/**
 * 验证客户端消息
 */
export function validateClientMessage(data: unknown): ClientMessage {
  return ClientMessageSchema.parse(data);
}

/**
 * 安全验证客户端消息（返回 null 而不是抛出异常）
 */
export function safeValidateClientMessage(data: unknown): ClientMessage | null {
  const result = ClientMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * 获取消息优先级
 */
export function getMessagePriority(message: ServerMessage): MessagePriority {
  switch (message.type) {
    case 'error':
      return MessagePriority.HIGH;
    case 'tool_result':
      return MessagePriority.MEDIUM;
    case 'text_delta':
    case 'done':
    case 'pong':
    default:
      return MessagePriority.LOW;
  }
}
