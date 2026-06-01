/**
 * AnyRouter 请求改写器测试
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Logger 以避免 Electron 依赖
vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import {
  rewriteForAnyRouter,
  isValidUserHash,
  transformAnyRouterResponse,
} from '../main/anyrouter-request-rewriter';

describe('AnyRouter Request Rewriter', () => {
  describe('isValidUserHash', () => {
    it('应该验证有效的 64 位十六进制哈希', () => {
      const validHash = 'a'.repeat(64);
      expect(isValidUserHash(validHash)).toBe(true);
    });

    it('应该拒绝无效长度的哈希', () => {
      expect(isValidUserHash('abc123')).toBe(false);
      expect(isValidUserHash('a'.repeat(63))).toBe(false);
      expect(isValidUserHash('a'.repeat(65))).toBe(false);
    });

    it('应该拒绝非十六进制字符', () => {
      const invalidHash = 'g'.repeat(64);
      expect(isValidUserHash(invalidHash)).toBe(false);
    });

    it('应该拒绝 undefined 和空字符串', () => {
      expect(isValidUserHash(undefined)).toBe(false);
      expect(isValidUserHash('')).toBe(false);
    });
  });

  describe('rewriteForAnyRouter', () => {
    const validHash = 'a'.repeat(64);

    it('应该改写请求体并添加必需字段', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 1024,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {});

      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.model).toBe('claude-opus-4-6');
      expect(rewritten.messages).toHaveLength(1);
      expect(rewritten.system).toBeDefined();
      expect(rewritten.metadata?.user_id).toMatch(/^user_[a-f0-9]{64}_account__session_/);
      expect(rewritten.thinking).toEqual({ type: 'adaptive' });
      expect(rewritten.output_config).toEqual({ effort: 'max' });
    });

    it('应该保留 Claude Code 原始工具和请求控制字段', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'inspect files' }],
          system: [{ type: 'text', text: 'Original Claude Code system prompt' }],
          tools: [
            {
              name: 'Read',
              description: 'Read a file',
              input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
            },
          ],
          tool_choice: { type: 'auto' },
          stop_sequences: ['stop-here'],
          temperature: 0.2,
          top_p: 0.9,
          metadata: { source: 'claude-code' },
          thinking: { type: 'enabled', budget_tokens: 2048 },
          output_config: { effort: 'medium' },
          stream: true,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {});
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.system).toEqual([
        { type: 'text', text: 'Original Claude Code system prompt' },
      ]);
      expect(rewritten.tools).toEqual([
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
        },
      ]);
      expect(rewritten.tool_choice).toEqual({ type: 'auto' });
      expect(rewritten.stop_sequences).toEqual(['stop-here']);
      expect(rewritten.temperature).toBe(0.2);
      expect(rewritten.top_p).toBe(0.9);
      expect(rewritten.metadata.source).toBe('claude-code');
      expect(rewritten.metadata.user_id).toMatch(/^user_[a-f0-9]{64}_account__session_/);
      expect(rewritten.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
      expect(rewritten.output_config).toEqual({ effort: 'medium' });
      expect(rewritten.stream).toBe(true);
    });

    it('应该清理 [undefined] 值', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
          someField: '[undefined]',
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {});
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.someField).toBeUndefined();
    });

    it('应该添加 anthropic-beta 头', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {});

      expect(result.headers['anthropic-beta']).toContain('context-1m-2025-08-07');
    });

    it('应该合并现有的 anthropic-beta 头', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {
        'anthropic-beta': 'existing-feature',
      });

      expect(result.headers['anthropic-beta']).toContain('existing-feature');
      expect(result.headers['anthropic-beta']).toContain('context-1m-2025-08-07');
    });

    it('应该添加 URL 后缀', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {});

      expect(result.urlSuffix).toBe('?beta=true');
    });

    it('应该处理无效的 JSON', () => {
      const invalidBody = Buffer.from('not json');

      const result = rewriteForAnyRouter(invalidBody, validHash, {});

      expect(result.body).toEqual(invalidBody);
      expect(result.headers).toEqual({});
      expect(result.urlSuffix).toBe('');
    });

    it('应该保持 Codex Responses 原生协议透传且不注入 hash', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          instructions: 'Answer with a short result.',
          input: '1+1=?',
          metadata: { source: 'codex' },
          someField: '[undefined]',
          stream: true,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(result.upstreamPath).toBe('/v1/responses');
      expect(result.upstreamCliType).toBe('codex');
      expect(result.responseAdapter).toEqual({ type: 'transparent' });
      expect(result.headers).toEqual({});
      expect(result.urlSuffix).toBe('');
      expect(rewritten.model).toBe('gpt-route');
      expect(rewritten.instructions).toBe('Answer with a short result.');
      expect(rewritten.input).toBe('1+1=?');
      expect(rewritten.stream).toBe(true);
      expect(rewritten.someField).toBeUndefined();
      expect(rewritten.metadata.source).toBe('codex');
      expect(rewritten.metadata.user_id).toBeUndefined();
      expect(rewritten.messages).toBeUndefined();
      expect(rewritten.system).toBeUndefined();
      expect(rewritten.thinking).toBeUndefined();
      expect(rewritten.output_config).toBeUndefined();
    });

    it('应该保留 AnyRouter 当前支持的 Codex Responses 工具类型', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          input: 'use a tool if needed',
          stream: true,
          tools: [
            {
              type: 'function',
              name: 'shell_command',
              parameters: { type: 'object', properties: {} },
            },
            {
              type: 'custom',
              name: 'custom_shell',
              description: 'Custom grammar shell',
              format: { type: 'text' },
            },
            {
              type: 'web_search',
            },
            {
              type: 'web_search_preview',
            },
            {
              type: 'file_search',
              vector_store_ids: ['vs_123'],
            },
            {
              type: 'image_generation',
            },
            {
              type: 'apply_patch',
            },
            {
              type: 'namespace',
              name: 'crm',
              tools: [
                {
                  type: 'function',
                  name: 'lookup_customer',
                  parameters: { type: 'object', properties: {} },
                },
              ],
            },
            {
              type: 'tool_search',
              execution: 'client',
              parameters: { type: 'object', properties: {} },
            },
          ],
          tool_choice: 'auto',
          parallel_tool_calls: true,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.tools).toEqual([
        {
          type: 'function',
          name: 'shell_command',
          parameters: { type: 'object', properties: {} },
        },
        {
          type: 'custom',
          name: 'custom_shell',
          description: 'Custom grammar shell',
          format: { type: 'text' },
        },
        {
          type: 'web_search',
        },
        {
          type: 'web_search_preview',
        },
        {
          type: 'file_search',
          vector_store_ids: ['vs_123'],
        },
        {
          type: 'image_generation',
        },
        {
          type: 'apply_patch',
        },
        {
          type: 'namespace',
          name: 'crm',
          tools: [
            {
              type: 'function',
              name: 'lookup_customer',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
        {
          type: 'tool_search',
          execution: 'client',
          parameters: { type: 'object', properties: {} },
        },
      ]);
      expect(rewritten.tool_choice).toBe('auto');
      expect(rewritten.parallel_tool_calls).toBe(true);
    });

    it('应该过滤 AnyRouter 仍不稳定或不支持的 Codex 工具类型', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          input: 'hello',
          tools: [
            { type: 'mcp', server_label: 'local_only' },
            { name: 'legacy_name_only' },
            { type: 'code_interpreter', container: { type: 'auto' } },
            { type: 'computer_use_preview', display_width: 1024, display_height: 768 },
            { type: 'local_shell' },
            { type: 'shell', environment: { type: 'local' } },
          ],
          tool_choice: 'auto',
          parallel_tool_calls: true,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.tools).toBeUndefined();
      expect(rewritten.tool_choice).toBeUndefined();
      expect(rewritten.parallel_tool_calls).toBeUndefined();
    });

    it('Codex 强制选择的工具被过滤时应移除无效 tool_choice', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          input: 'use a tool',
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              parameters: { type: 'object', properties: {} },
            },
            {
              type: 'mcp',
              server_label: 'local_only',
            },
          ],
          tool_choice: { type: 'mcp', server_label: 'local_only' },
          parallel_tool_calls: true,
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.tools).toEqual([
        {
          type: 'function',
          name: 'get_weather',
          parameters: { type: 'object', properties: {} },
        },
      ]);
      expect(rewritten.tool_choice).toBeUndefined();
      expect(rewritten.parallel_tool_calls).toBe(true);
    });

    it('Codex 强制选择的工具仍保留时应保留 tool_choice', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          input: 'use a tool',
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              parameters: { type: 'object', properties: {} },
            },
            {
              type: 'mcp',
              server_label: 'local_only',
            },
          ],
          tool_choice: { type: 'function', name: 'get_weather' },
        })
      );

      const result = rewriteForAnyRouter(originalBody, validHash, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(rewritten.tools).toEqual([
        {
          type: 'function',
          name: 'get_weather',
          parameters: { type: 'object', properties: {} },
        },
      ]);
      expect(rewritten.tool_choice).toEqual({ type: 'function', name: 'get_weather' });
    });

    it('应该保持 Gemini Native 原生协议透传', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          systemInstruction: { parts: [{ text: 'Be concise.' }] },
          contents: [
            { role: 'user', parts: [{ text: 'hello' }] },
            { role: 'model', parts: [{ text: 'hi' }] },
          ],
          someField: '[undefined]',
        })
      );

      const result = rewriteForAnyRouter(
        originalBody,
        validHash,
        {},
        'geminiCli',
        '/v1beta/models/gemini-route:streamGenerateContent?alt=sse',
        'claude-opus-4-6'
      );
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(result.upstreamPath).toBe('/v1beta/models/gemini-route:streamGenerateContent?alt=sse');
      expect(result.upstreamCliType).toBe('geminiCli');
      expect(result.responseAdapter).toEqual({ type: 'transparent' });
      expect(result.headers).toEqual({});
      expect(result.urlSuffix).toBe('');
      expect(rewritten.model).toBeUndefined();
      expect(rewritten.systemInstruction.parts[0].text).toBe('Be concise.');
      expect(rewritten.contents).toEqual([
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi' }] },
      ]);
      expect(rewritten.someField).toBeUndefined();
      expect(rewritten.metadata).toBeUndefined();
      expect(rewritten.messages).toBeUndefined();
      expect(rewritten.system).toBeUndefined();
      expect(rewritten.thinking).toBeUndefined();
      expect(rewritten.output_config).toBeUndefined();
    });

    it('Codex 缺少有效 hash 时应原生透传且不伪造 metadata.user_id', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          input: '1+1=?',
        })
      );

      const result = rewriteForAnyRouter(originalBody, undefined, {}, 'codex', '/v1/responses');
      const rewritten = JSON.parse(result.body.toString('utf-8'));

      expect(result.upstreamPath).toBe('/v1/responses');
      expect(result.upstreamCliType).toBe('codex');
      expect(result.responseAdapter).toEqual({ type: 'transparent' });
      expect(rewritten).toEqual({
        model: 'gpt-route',
        input: '1+1=?',
      });
    });
  });

  describe('transformAnyRouterResponse', () => {
    it('应该把 Anthropic JSON 响应转换为 Codex Responses JSON', () => {
      const upstreamBody = Buffer.from(
        JSON.stringify({
          content: [{ type: 'text', text: '2' }],
          usage: { input_tokens: 5, output_tokens: 1 },
        })
      );

      const result = transformAnyRouterResponse({
        body: upstreamBody,
        headers: { 'content-type': 'application/json', 'content-length': '999' },
        statusCode: 200,
        adapter: { type: 'codexResponses', model: 'gpt-route', stream: false },
      });
      const converted = JSON.parse(result.body.toString('utf-8'));

      expect(converted.object).toBe('response');
      expect(converted.model).toBe('gpt-route');
      expect(converted.output[0].content[0].text).toBe('2');
      expect(converted.usage).toEqual({ input_tokens: 5, output_tokens: 1, total_tokens: 6 });
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.headers['content-length']).toBe(String(result.body.length));
    });

    it('应该把 Anthropic SSE 响应转换为 Codex Responses SSE', () => {
      const upstreamBody = Buffer.from(
        [
          'event: message_start',
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"2"}}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","usage":{"output_tokens":1}}',
          '',
        ].join('\n')
      );

      const result = transformAnyRouterResponse({
        body: upstreamBody,
        headers: { 'content-type': 'text/event-stream' },
        statusCode: 200,
        adapter: { type: 'codexResponses', model: 'gpt-route', stream: true },
      });
      const converted = result.body.toString('utf-8');

      expect(converted).toContain('event: response.output_text.delta');
      expect(converted).toContain('"delta":"2"');
      expect(converted).toContain('event: response.completed');
      expect(converted).toContain('data: [DONE]');
      expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    });

    it('应该把 Anthropic JSON 响应转换为 Gemini GenerateContent JSON', () => {
      const upstreamBody = Buffer.from(
        JSON.stringify({
          content: [{ type: 'text', text: '2' }],
          usage: { input_tokens: 5, output_tokens: 1 },
        })
      );

      const result = transformAnyRouterResponse({
        body: upstreamBody,
        headers: { 'content-type': 'application/json' },
        statusCode: 200,
        adapter: { type: 'geminiGenerateContent', model: 'gemini-route', stream: false },
      });
      const converted = JSON.parse(result.body.toString('utf-8'));

      expect(converted.candidates[0].content.parts[0].text).toBe('2');
      expect(converted.candidates[0].finishReason).toBe('STOP');
      expect(converted.usageMetadata).toEqual({
        promptTokenCount: 5,
        candidatesTokenCount: 1,
        totalTokenCount: 6,
      });
    });

    it('应该把 Anthropic SSE 响应转换为 Gemini SSE', () => {
      const upstreamBody = Buffer.from(
        [
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"2"}}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":1}}',
          '',
        ].join('\n')
      );

      const result = transformAnyRouterResponse({
        body: upstreamBody,
        headers: { 'content-type': 'text/event-stream' },
        statusCode: 200,
        adapter: { type: 'geminiGenerateContent', model: 'gemini-route', stream: true },
      });
      const converted = result.body.toString('utf-8');

      expect(converted).toContain('"text":"2"');
      expect(converted).toContain('"finishReason":"STOP"');
      expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    });
  });
});
