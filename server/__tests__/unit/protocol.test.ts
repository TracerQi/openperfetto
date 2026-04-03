/**
 * Protocol 类型定义测试
 * 测试 Zod Schema 验证逻辑
 */

import {
  ChatRequestSchema,
  PingMessageSchema,
  InvokeSkillSchema,
  ClientMessageSchema,
  ServerMessageSchema,
  TextDeltaResponseSchema,
  ToolUseResponseSchema,
  ToolResultResponseSchema,
  ErrorResponseSchema,
  DoneResponseSchema,
  PongResponseSchema,
  validateClientMessage,
  safeValidateClientMessage,
  getMessagePriority,
  MessagePriority,
} from '../../src/types/protocol.js';

describe('Protocol Schemas', () => {
  // ============= ChatRequestSchema 测试 =============
  describe('ChatRequestSchema', () => {
    it('should accept valid chat request', () => {
      const validRequest = {
        type: 'chat',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: '550e8400-e29b-41d4-a716-446655440001',
        payload: {
          messages: [
            { role: 'user', content: 'Hello' },
          ],
        },
      };

      const result = ChatRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should accept chat request with optional fields', () => {
      const validRequest = {
        type: 'chat',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: '550e8400-e29b-41d4-a716-446655440001',
        payload: {
          messages: [
            { role: 'user', content: 'Hello' },
          ],
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              inputSchema: { type: 'object' },
            },
          ],
          systemPrompt: 'You are a helpful assistant',
          stream: true,
          requirePlan: false,
        },
      };

      const result = ChatRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject request missing required fields', () => {
      const invalidRequest = {
        type: 'chat',
        // missing agentId, traceId, payload
      };

      const result = ChatRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid agentId (not UUID)', () => {
      const invalidRequest = {
        type: 'chat',
        agentId: 'not-a-uuid',
        traceId: '550e8400-e29b-41d4-a716-446655440001',
        payload: {
          messages: [],
        },
      };

      const result = ChatRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid traceId (not UUID)', () => {
      const invalidRequest = {
        type: 'chat',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: 'invalid-trace',
        payload: {
          messages: [],
        },
      };

      const result = ChatRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid message role', () => {
      const invalidRequest = {
        type: 'chat',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: '550e8400-e29b-41d4-a716-446655440001',
        payload: {
          messages: [
            { role: 'invalid_role', content: 'Hello' },
          ],
        },
      };

      const result = ChatRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  // ============= PingMessageSchema 测试 =============
  describe('PingMessageSchema', () => {
    it('should accept valid ping message', () => {
      const validPing = {
        type: 'ping',
        timestamp: Date.now(),
      };

      const result = PingMessageSchema.safeParse(validPing);
      expect(result.success).toBe(true);
    });

    it('should reject ping without timestamp', () => {
      const invalidPing = {
        type: 'ping',
      };

      const result = PingMessageSchema.safeParse(invalidPing);
      expect(result.success).toBe(false);
    });

    it('should reject ping with non-number timestamp', () => {
      const invalidPing = {
        type: 'ping',
        timestamp: 'not-a-number',
      };

      const result = PingMessageSchema.safeParse(invalidPing);
      expect(result.success).toBe(false);
    });
  });

  // ============= InvokeSkillSchema 测试 =============
  describe('InvokeSkillSchema', () => {
    it('should accept valid invoke_skill request', () => {
      const validRequest = {
        type: 'invoke_skill',
        skillId: 'my-skill-id',
      };

      const result = InvokeSkillSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should accept invoke_skill with optional agentId', () => {
      const validRequest = {
        type: 'invoke_skill',
        skillId: 'my-skill-id',
        agentId: 'agent-123',
        params: { key: 'value' },
        requestId: 'req-456',
        traceId: 'trace-789',
      };

      const result = InvokeSkillSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject invoke_skill without skillId', () => {
      const invalidRequest = {
        type: 'invoke_skill',
        // missing skillId
      };

      const result = InvokeSkillSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should accept invoke_skill with params object', () => {
      const validRequest = {
        type: 'invoke_skill',
        skillId: 'query-skill',
        params: {
          processName: 'system_server',
          limit: 100,
        },
      };

      const result = InvokeSkillSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.params).toEqual({
          processName: 'system_server',
          limit: 100,
        });
      }
    });
  });

  // ============= ClientMessageSchema (discriminatedUnion) 测试 =============
  describe('ClientMessageSchema', () => {
    it('should route chat message correctly', () => {
      const chatMessage = {
        type: 'chat',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: '550e8400-e29b-41d4-a716-446655440001',
        payload: {
          messages: [{ role: 'user', content: 'test' }],
        },
      };

      const result = ClientMessageSchema.safeParse(chatMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('chat');
      }
    });

    it('should route ping message correctly', () => {
      const pingMessage = {
        type: 'ping',
        timestamp: Date.now(),
      };

      const result = ClientMessageSchema.safeParse(pingMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('ping');
      }
    });

    it('should route invoke_skill message correctly', () => {
      const invokeMessage = {
        type: 'invoke_skill',
        skillId: 'test-skill',
      };

      const result = ClientMessageSchema.safeParse(invokeMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('invoke_skill');
      }
    });

    it('should reject unknown message type', () => {
      const unknownMessage = {
        type: 'unknown_type',
        data: 'something',
      };

      const result = ClientMessageSchema.safeParse(unknownMessage);
      expect(result.success).toBe(false);
    });
  });

  // ============= ServerMessage Schemas 测试 =============
  describe('ServerMessage Schemas', () => {
    it('should construct valid text_delta response', () => {
      const response = {
        type: 'text_delta',
        traceId: 'trace-123',
        data: { text: 'Hello world' },
      };

      const result = TextDeltaResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should construct valid tool_use response', () => {
      const response = {
        type: 'tool_use',
        data: {
          id: 'tool-call-1',
          name: 'search',
          arguments: { query: 'test' },
        },
      };

      const result = ToolUseResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should construct valid tool_result response', () => {
      const response = {
        type: 'tool_result',
        data: {
          toolCallId: 'tool-call-1',
          success: true,
          result: { items: [] },
        },
      };

      const result = ToolResultResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should construct valid error response', () => {
      const response = {
        type: 'error',
        data: {
          code: 'INVALID_REQUEST',
          message: 'Invalid input',
        },
      };

      const result = ErrorResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should construct valid done response', () => {
      const response = {
        type: 'done',
        data: {
          agentId: 'agent-123',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
          },
        },
      };

      const result = DoneResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should construct valid pong response', () => {
      const response = {
        type: 'pong',
        timestamp: Date.now(),
      };

      const result = PongResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should parse server message union correctly', () => {
      const messages = [
        { type: 'text_delta', data: { text: 'hi' } },
        { type: 'done', data: { agentId: 'a' } },
        { type: 'pong', timestamp: 123 },
      ];

      for (const msg of messages) {
        const result = ServerMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      }
    });
  });

  // ============= Helper Functions 测试 =============
  describe('Helper Functions', () => {
    describe('validateClientMessage', () => {
      it('should return parsed message for valid input', () => {
        const validMessage = {
          type: 'ping',
          timestamp: Date.now(),
        };

        const result = validateClientMessage(validMessage);
        expect(result.type).toBe('ping');
      });

      it('should throw for invalid input', () => {
        const invalidMessage = {
          type: 'invalid',
        };

        expect(() => validateClientMessage(invalidMessage)).toThrow();
      });
    });

    describe('safeValidateClientMessage', () => {
      it('should return parsed message for valid input', () => {
        const validMessage = {
          type: 'ping',
          timestamp: Date.now(),
        };

        const result = safeValidateClientMessage(validMessage);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('ping');
      });

      it('should return null for invalid input', () => {
        const invalidMessage = {
          type: 'invalid',
        };

        const result = safeValidateClientMessage(invalidMessage);
        expect(result).toBeNull();
      });
    });

    describe('getMessagePriority', () => {
      it('should return HIGH priority for error messages', () => {
        const errorMsg = {
          type: 'error' as const,
          data: { code: 'ERR', message: 'error' },
        };

        expect(getMessagePriority(errorMsg)).toBe(MessagePriority.HIGH);
      });

      it('should return MEDIUM priority for tool_result messages', () => {
        const toolResultMsg = {
          type: 'tool_result' as const,
          data: { toolCallId: '1', success: true },
        };

        expect(getMessagePriority(toolResultMsg)).toBe(MessagePriority.MEDIUM);
      });

      it('should return LOW priority for text_delta messages', () => {
        const textDeltaMsg = {
          type: 'text_delta' as const,
          data: { text: 'hello' },
        };

        expect(getMessagePriority(textDeltaMsg)).toBe(MessagePriority.LOW);
      });

      it('should return LOW priority for done messages', () => {
        const doneMsg = {
          type: 'done' as const,
          data: { agentId: 'a' },
        };

        expect(getMessagePriority(doneMsg)).toBe(MessagePriority.LOW);
      });

      it('should return LOW priority for pong messages', () => {
        const pongMsg = {
          type: 'pong' as const,
          timestamp: 123,
        };

        expect(getMessagePriority(pongMsg)).toBe(MessagePriority.LOW);
      });
    });
  });
});
