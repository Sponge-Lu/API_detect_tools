/**
 * 输入: 模拟的 CLI 请求/响应 buffer
 * 输出: CLI 协议适配器请求/响应转换的回归测试
 * 定位: 测试层 - 验证 Claude/Codex/Gemini 三类源 CLI 与 Anthropic/OpenAI Chat/OpenAI Responses 三类目标协议之间的双向适配
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { describe, expect, it } from 'vitest';
import {
  CliProtocolAdapterError,
  adaptRequestToTargetProtocol,
  transformTargetProtocolResponse,
} from '../main/cli-protocol-adapter';

function toBuffer(payload: unknown): Buffer {
  return Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf-8');
}

describe('cli-protocol-adapter request adapt', () => {
  it('adapts Claude Code text request into Anthropic messages body and path', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        stream: true,
        system: 'be terse',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      }),
      'claudeCode',
      'anthropic-messages',
      '/v1/messages',
      'upstream-opus'
    );
    expect(result.upstreamPath).toBe('/v1/messages');
    expect(result.upstreamMethod).toBe('POST');
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.model).toBe('upstream-opus');
    expect(body.stream).toBe(true);
    expect(body.system).toBe('be terse');
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(result.responseAdapter.type).toBe('source');
  });

  it('adapts Claude Code request into OpenAI Chat Completions body', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        stream: false,
        system: 'rules',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
      'claudeCode',
      'openai-chat-completions',
      '/v1/messages',
      'gpt-4.1-mini'
    );
    expect(result.upstreamPath).toBe('/v1/chat/completions');
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'rules' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('adapts Gemini CLI streaming request into Anthropic messages body', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        systemInstruction: { parts: [{ text: 'be polite' }] },
      }),
      'geminiCli',
      'anthropic-messages',
      '/v1beta/models/gemini-3.1-pro:streamGenerateContent',
      'claude-opus-4-6'
    );
    expect(result.upstreamPath).toBe('/v1/messages');
    expect(result.responseAdapter.type).toBe('source');
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.model).toBe('claude-opus-4-6');
    expect(body.system).toBe('be polite');
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    });
    if (result.responseAdapter.type === 'source') {
      expect(result.responseAdapter.stream).toBe(true);
    }
  });

  it('adapts Codex request into OpenAI Chat Completions body', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        stream: true,
        instructions: 'follow rules',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
      }),
      'codex',
      'openai-chat-completions',
      '/v1/responses',
      'gpt-4.1-mini'
    );
    expect(result.upstreamPath).toBe('/v1/chat/completions');
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'follow rules' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'ping' });
    expect(body.stream).toBe(true);
  });

  it('throws CliProtocolAdapterError when request body is not valid JSON', () => {
    expect(() =>
      adaptRequestToTargetProtocol(
        Buffer.from('not json', 'utf-8'),
        'claudeCode',
        'openai-chat-completions',
        '/v1/messages',
        'gpt-4.1-mini'
      )
    ).toThrow(CliProtocolAdapterError);
  });

  it('exposes stage and target protocol on adapter error', () => {
    try {
      adaptRequestToTargetProtocol(
        Buffer.from('bad', 'utf-8'),
        'geminiCli',
        'anthropic-messages',
        '/v1beta/models/x:streamGenerateContent',
        'upstream'
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliProtocolAdapterError);
      const adapterErr = err as CliProtocolAdapterError;
      expect(adapterErr.stage).toBe('request-adapt');
      expect(adapterErr.sourceCliType).toBe('geminiCli');
      expect(adapterErr.targetProtocol).toBe('anthropic-messages');
      expect(adapterErr.reason).toBe('invalid_source_body');
    }
  });

  it('throws empty_conversation when only system message exists', () => {
    expect(() =>
      adaptRequestToTargetProtocol(
        toBuffer({
          model: 'claude-opus-4-6',
          system: 'system only',
          messages: [],
        }),
        'claudeCode',
        'openai-chat-completions',
        '/v1/messages',
        'gpt-4.1-mini'
      )
    ).toThrow(/empty_conversation/);
  });

  it('tolerates Codex instructions object with text field', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        instructions: { type: 'developer', text: 'be precise' },
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'q' }] }],
      }),
      'codex',
      'openai-chat-completions',
      '/v1/responses',
      'gpt-4.1-mini'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be precise' });
  });

  it('tolerates Codex instructions unknown structured object without throwing', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        instructions: { meta: { tag: 'system' }, foo: 1 },
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'q' }] }],
      }),
      'codex',
      'openai-chat-completions',
      '/v1/responses',
      'gpt-4.1-mini'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    // 未知 instructions 结构被丢弃，user 消息仍正常传递
    expect(body.messages[0]).toEqual({ role: 'user', content: 'q' });
  });
});

describe('cli-protocol-adapter request tool/function conversion', () => {
  it('converts Claude tool_use + tool_result through OpenAI Chat target', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'fetch weather' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'weather',
                input: { city: 'sf' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: '72F sunny',
              },
            ],
          },
        ],
        tools: [{ name: 'weather', description: 'gets weather', input_schema: { type: 'object' } }],
      }),
      'claudeCode',
      'openai-chat-completions',
      '/v1/messages',
      'gpt-4.1-mini'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.messages[0]).toEqual({ role: 'user', content: 'fetch weather' });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: { name: 'weather', arguments: '{"city":"sf"}' },
        },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_1',
      content: '72F sunny',
    });
    expect(body.tools[0].function.name).toBe('weather');
  });

  it('converts Claude tool_use into OpenAI Responses function_call items', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'x' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
          },
        ],
      }),
      'claudeCode',
      'openai-responses',
      '/v1/messages',
      'gpt-5'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    expect(body.input).toContainEqual({
      type: 'function_call',
      call_id: 'toolu_1',
      name: 'lookup',
      arguments: '{"q":"x"}',
    });
    expect(body.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'toolu_1',
      output: 'ok',
    });
  });

  it('converts Codex function_call/function_call_output to Anthropic tool_use/tool_result', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'q' }] },
          { type: 'function_call', call_id: 'fc_1', name: 'lookup', arguments: '{"q":"a"}' },
          { type: 'function_call_output', call_id: 'fc_1', output: 'answer' },
        ],
        tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
      }),
      'codex',
      'anthropic-messages',
      '/v1/responses',
      'claude-opus-4-6'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg.content[0]).toEqual({
      type: 'tool_use',
      id: 'fc_1',
      name: 'lookup',
      input: { q: 'a' },
    });
    const toolResultMsg = body.messages.find(
      (m: { role: string; content: Array<{ type: string }> }) =>
        m.role === 'user' && m.content[0]?.type === 'tool_result'
    );
    expect(toolResultMsg.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'fc_1',
      content: 'answer',
    });
    expect(body.tools[0]).toEqual({
      name: 'lookup',
      description: undefined,
      input_schema: { type: 'object' },
    });
  });

  it('converts Gemini functionCall/functionResponse into OpenAI Chat tool_calls', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        contents: [
          { role: 'user', parts: [{ text: 'q' }] },
          {
            role: 'model',
            parts: [{ functionCall: { name: 'lookup', args: { q: 'x' } } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              { name: 'lookup', description: 'find', parameters: { type: 'object' } },
            ],
          },
        ],
      }),
      'geminiCli',
      'openai-chat-completions',
      '/v1beta/models/gemini-3.1-pro:streamGenerateContent',
      'gpt-4.1-mini'
    );
    const body = JSON.parse(result.body.toString('utf-8'));
    const assistant = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0].function).toEqual({
      name: 'lookup',
      arguments: '{"q":"x"}',
    });
    const toolMsg = body.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).toBe('{"ok":true}');
    expect(body.tools[0].function.name).toBe('lookup');
  });

  it('throws unsupported_content for Claude image part', () => {
    try {
      adaptRequestToTargetProtocol(
        toBuffer({
          model: 'claude-opus-4-6',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
              ],
            },
          ],
        }),
        'claudeCode',
        'openai-chat-completions',
        '/v1/messages',
        'gpt-4.1-mini'
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliProtocolAdapterError);
      expect((err as CliProtocolAdapterError).reason).toContain('unsupported_content');
    }
  });

  it('throws unsupported_content for Gemini inlineData part', () => {
    expect(() =>
      adaptRequestToTargetProtocol(
        toBuffer({
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: 'image/png', data: 'aaa' } }],
            },
          ],
        }),
        'geminiCli',
        'anthropic-messages',
        '/v1beta/models/x:streamGenerateContent',
        'claude-opus-4-6'
      )
    ).toThrow(/unsupported_content/);
  });
});

describe('cli-protocol-adapter response tool/function conversion', () => {
  it('converts Anthropic tool_use JSON into Claude SSE with tool_use block when source is claudeCode', () => {
    const upstream = {
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking' },
        { type: 'tool_use', id: 'toolu_x', name: 'lookup', input: { q: 'a' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 3, output_tokens: 5 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'anthropic-messages',
        model: 'claude-opus-4-6',
        stream: true,
      },
    });
    const text = out.body.toString('utf-8');
    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"name":"lookup"');
    expect(text).toContain('"type":"input_json_delta"');
    expect(text).toContain('"partial_json":"{\\"q\\":\\"a\\"}"');
    expect(text).toContain('"stop_reason":"tool_use"');
  });

  it('converts OpenAI Chat SSE tool_calls into Claude tool_use stream', () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a\\"}"}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const out = transformTargetProtocolResponse({
      body: Buffer.from(sse, 'utf-8'),
      headers: { 'content-type': 'text/event-stream' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'openai-chat-completions',
        model: 'claude-opus-4-6',
        stream: true,
      },
    });
    const text = out.body.toString('utf-8');
    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"id":"call_1"');
    expect(text).toContain('"name":"lookup"');
    expect(text).toContain('"partial_json":"{\\"q\\":\\"a\\"}"');
    expect(text).toContain('"stop_reason":"tool_use"');
  });

  it('converts OpenAI Responses tool function_call JSON into Codex Responses function_call output', () => {
    const upstream = {
      output: [
        {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_x',
          name: 'lookup',
          arguments: '{"q":"a"}',
        },
      ],
      usage: { input_tokens: 2, output_tokens: 3 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'codex',
        targetProtocol: 'openai-responses',
        model: 'gpt-5',
        stream: false,
      },
    });
    const parsed = JSON.parse(out.body.toString('utf-8'));
    const fc = parsed.output.find((item: { type: string }) => item.type === 'function_call');
    expect(fc).toBeDefined();
    expect(fc.name).toBe('lookup');
    expect(fc.arguments).toBe('{"q":"a"}');
    expect(fc.call_id).toBe('call_x');
  });

  it('converts Anthropic tool_use SSE into Gemini functionCall stream', () => {
    const sse =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"lookup"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":6}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const out = transformTargetProtocolResponse({
      body: Buffer.from(sse, 'utf-8'),
      headers: { 'content-type': 'text/event-stream' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'geminiCli',
        targetProtocol: 'anthropic-messages',
        model: 'gemini-3.1-pro',
        stream: true,
      },
    });
    const text = out.body.toString('utf-8');
    expect(text).toContain('"functionCall"');
    expect(text).toContain('"name":"lookup"');
    expect(text).toContain('"args":{"q":"x"}');
  });

  it('converts OpenAI Responses function_call into Claude tool_use non-streaming JSON', () => {
    const upstream = {
      output: [
        {
          type: 'function_call',
          call_id: 'fc_1',
          name: 'lookup',
          arguments: '{"q":"a"}',
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'openai-responses',
        model: 'claude-opus-4-6',
        stream: false,
      },
    });
    const parsed = JSON.parse(out.body.toString('utf-8'));
    expect(parsed.stop_reason).toBe('tool_use');
    const toolUse = parsed.content.find((c: { type: string }) => c.type === 'tool_use');
    expect(toolUse).toEqual({
      type: 'tool_use',
      id: 'fc_1',
      name: 'lookup',
      input: { q: 'a' },
    });
  });

  it('aggregates OpenAI Responses streaming function_call_arguments deltas into Codex output', () => {
    const sse =
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1"}}\n\n' +
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"lookup","arguments":""}}\n\n' +
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"{\\"q\\":\\"a"}\n\n' +
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"\\"}"}\n\n' +
      'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","call_id":"call_1","arguments":"{\\"q\\":\\"a\\"}"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":5}}}\n\n' +
      'data: [DONE]\n\n';
    const out = transformTargetProtocolResponse({
      body: Buffer.from(sse, 'utf-8'),
      headers: { 'content-type': 'text/event-stream' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'codex',
        targetProtocol: 'openai-responses',
        model: 'gpt-5',
        stream: true,
      },
    });
    const text = out.body.toString('utf-8');
    expect(text).toContain('"type":"function_call"');
    expect(text).toContain('"name":"lookup"');
    expect(text).toContain('"call_id":"call_1"');
    expect(text).toContain('"arguments":"{\\"q\\":\\"a\\"}"');
  });
});

describe('cli-protocol-adapter response transform', () => {
  it('returns body untouched for transparent adapter', () => {
    const buf = Buffer.from('raw upstream body', 'utf-8');
    const out = transformTargetProtocolResponse({
      body: buf,
      headers: { 'content-type': 'text/plain' },
      statusCode: 200,
      adapter: { type: 'transparent' },
    });
    expect(out.body).toBe(buf);
    expect(out.headers['content-type']).toBe('text/plain');
  });

  it('returns body untouched for non-2xx response even with source adapter', () => {
    const buf = Buffer.from('{"error":"x"}', 'utf-8');
    const out = transformTargetProtocolResponse({
      body: buf,
      headers: { 'content-type': 'application/json' },
      statusCode: 400,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'openai-chat-completions',
        model: 'm',
        stream: false,
      },
    });
    expect(out.body).toBe(buf);
  });

  it('converts OpenAI Chat non-streaming JSON into Claude Code message body', () => {
    const upstream = {
      choices: [{ message: { content: 'hello world' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'openai-chat-completions',
        model: 'claude-opus-4-6',
        stream: false,
      },
    });
    const parsed = JSON.parse(out.body.toString('utf-8'));
    expect(parsed.type).toBe('message');
    expect(parsed.content[0]).toEqual({ type: 'text', text: 'hello world' });
    expect(parsed.usage.input_tokens).toBe(3);
    expect(parsed.usage.output_tokens).toBe(2);
  });

  it('converts OpenAI Chat streaming SSE into Claude Code SSE deltas', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"foo"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"bar"}}]}\n\n' +
      'data: [DONE]\n\n';
    const out = transformTargetProtocolResponse({
      body: Buffer.from(sse, 'utf-8'),
      headers: { 'content-type': 'text/event-stream' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'claudeCode',
        targetProtocol: 'openai-chat-completions',
        model: 'claude-opus-4-6',
        stream: true,
      },
    });
    const text = out.body.toString('utf-8');
    expect(text).toContain('event: message_start');
    expect(text).toContain('"text":"foo"');
    expect(text).toContain('"text":"bar"');
    expect(text).toContain('event: message_stop');
    expect(out.headers['content-type']).toBe('text/event-stream; charset=utf-8');
  });

  it('converts Anthropic JSON into Codex Responses object for Codex source', () => {
    const upstream = {
      content: [{ type: 'text', text: 'reply' }],
      usage: { input_tokens: 5, output_tokens: 7 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'codex',
        targetProtocol: 'anthropic-messages',
        model: 'gpt-5',
        stream: false,
      },
    });
    const parsed = JSON.parse(out.body.toString('utf-8'));
    expect(parsed.object).toBe('response');
    expect(parsed.output_text).toBe('reply');
    expect(parsed.usage.input_tokens).toBe(5);
    expect(parsed.usage.output_tokens).toBe(7);
    expect(parsed.usage.total_tokens).toBe(12);
  });

  it('converts OpenAI Responses JSON into Gemini JSON for Gemini source', () => {
    const upstream = {
      output_text: 'gem reply',
      usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
    };
    const out = transformTargetProtocolResponse({
      body: toBuffer(upstream),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'geminiCli',
        targetProtocol: 'openai-responses',
        model: 'gemini-3.1-pro',
        stream: false,
      },
    });
    const parsed = JSON.parse(out.body.toString('utf-8'));
    expect(parsed.candidates[0].content.parts[0].text).toBe('gem reply');
    expect(parsed.usageMetadata.promptTokenCount).toBe(4);
    expect(parsed.usageMetadata.candidatesTokenCount).toBe(6);
    expect(parsed.usageMetadata.totalTokenCount).toBe(10);
  });
});
