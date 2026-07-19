/**
 * 输入: 模拟的 CLI 请求/响应 buffer
 * 输出: CLI 协议适配器请求/响应转换的回归测试
 * 定位: 测试层 - 验证 Claude/Codex 源 CLI 与 Anthropic/OpenAI Chat/OpenAI Responses 目标协议之间的双向适配
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

  it('adapts Grok Build according to its actual Messages source endpoint', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'wire-grok',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      }),
      'grokBuild',
      'openai-chat-completions',
      '/v1/messages',
      'grok-upstream',
      'anthropic-messages'
    );

    expect(result.upstreamPath).toBe('/v1/chat/completions');
    expect(JSON.parse(result.body.toString('utf-8'))).toMatchObject({
      model: 'grok-upstream',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
    });
    expect(result.responseAdapter).toMatchObject({
      type: 'source',
      sourceCliType: 'grokBuild',
      sourceProtocol: 'anthropic-messages',
    });
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
        'codex',
        'openai-chat-completions',
        '/v1/responses',
        'gpt-4.1-mini'
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliProtocolAdapterError);
      const adapterErr = err as CliProtocolAdapterError;
      expect(adapterErr.stage).toBe('request-adapt');
      expect(adapterErr.sourceCliType).toBe('codex');
      expect(adapterErr.targetProtocol).toBe('openai-chat-completions');
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

  it('rejects Codex instructions fields that cannot be preserved', () => {
    expect(() =>
      adaptRequestToTargetProtocol(
        toBuffer({
          model: 'gpt-5',
          instructions: { meta: { tag: 'system' }, foo: 1 },
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'q' }] }],
        }),
        'codex',
        'openai-chat-completions',
        '/v1/responses',
        'gpt-4.1-mini'
      )
    ).toThrow(/unsupported_field:instructions\.meta/);
  });

  it('maps Responses reasoning effort to Anthropic output config', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        input: 'hello',
        reasoning: { effort: 'high' },
      }),
      'codex',
      'anthropic-messages',
      '/v1/responses',
      'claude-opus-4-6'
    );

    expect(JSON.parse(result.body.toString('utf-8'))).toMatchObject({
      output_config: { effort: 'high' },
      thinking: { type: 'adaptive' },
    });
  });

  it('maps Anthropic output effort to OpenAI Responses reasoning', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'max' },
      }),
      'claudeCode',
      'openai-responses',
      '/v1/messages',
      'gpt-5'
    );

    expect(JSON.parse(result.body.toString('utf-8')).reasoning).toEqual({ effort: 'max' });
  });

  it('maps Anthropic output effort to Chat Completions reasoning_effort', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'max' },
      }),
      'grokBuild',
      'openai-chat-completions',
      '/v1/messages',
      'grok-4'
    );

    expect(JSON.parse(result.body.toString('utf-8'))).toMatchObject({
      reasoning_effort: 'max',
    });
    expect(JSON.parse(result.body.toString('utf-8')).reasoning).toBeUndefined();
  });
});

describe('cli-protocol-adapter request tool/function conversion', () => {
  it('maps Anthropic required single-tool selection to OpenAI Chat controls', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'fetch weather' }],
        tools: [{ name: 'weather', input_schema: { type: 'object' } }],
        tool_choice: { type: 'any', disable_parallel_tool_use: true },
      }),
      'claudeCode',
      'openai-chat-completions',
      '/v1/messages',
      'gpt-4.1-mini'
    );

    expect(JSON.parse(result.body.toString('utf-8'))).toMatchObject({
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
  });

  it('maps Anthropic named tool selection to OpenAI Responses controls', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'fetch weather' }],
        tools: [{ name: 'weather', input_schema: { type: 'object' } }],
        tool_choice: { type: 'tool', name: 'weather' },
      }),
      'claudeCode',
      'openai-responses',
      '/v1/messages',
      'gpt-5'
    );

    expect(JSON.parse(result.body.toString('utf-8')).tool_choice).toEqual({
      type: 'function',
      name: 'weather',
    });
  });

  it('maps OpenAI Responses named tool and parallel controls to Anthropic', () => {
    const result = adaptRequestToTargetProtocol(
      toBuffer({
        model: 'gpt-5',
        input: 'fetch weather',
        tools: [{ type: 'function', name: 'weather', parameters: { type: 'object' } }],
        tool_choice: { type: 'function', name: 'weather' },
        parallel_tool_calls: false,
      }),
      'codex',
      'anthropic-messages',
      '/v1/responses',
      'claude-opus-4-6'
    );

    expect(JSON.parse(result.body.toString('utf-8')).tool_choice).toEqual({
      type: 'tool',
      name: 'weather',
      disable_parallel_tool_use: true,
    });
  });

  it('rejects tool choices without a lossless cross-protocol equivalent', () => {
    expect(() =>
      adaptRequestToTargetProtocol(
        toBuffer({
          model: 'gpt-5',
          input: 'answer directly',
          tools: [{ type: 'function', name: 'weather', parameters: { type: 'object' } }],
          tool_choice: 'none',
        }),
        'codex',
        'anthropic-messages',
        '/v1/responses',
        'claude-opus-4-6'
      )
    ).toThrow(/unsupported_field:tool_choice/);
  });

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

  it('converts a Chat response back to the Grok Build source protocol', () => {
    const out = transformTargetProtocolResponse({
      body: toBuffer({
        choices: [{ message: { content: 'grok reply' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      }),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      adapter: {
        type: 'source',
        sourceCliType: 'grokBuild',
        sourceProtocol: 'anthropic-messages',
        targetProtocol: 'openai-chat-completions',
        model: 'wire-grok',
        stream: false,
      },
    });

    const parsed = JSON.parse(out.body.toString('utf-8'));
    expect(parsed.type).toBe('message');
    expect(parsed.content[0]).toEqual({ type: 'text', text: 'grok reply' });
  });
});
