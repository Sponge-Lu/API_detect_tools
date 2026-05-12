import { describe, expect, it, vi } from 'vitest';

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
  isChyApiSiteName,
  rewriteForChyApi,
  transformChyApiResponse,
} from '../main/chy-api-request-rewriter';

describe('CHY API request rewriter', () => {
  it('recognizes the exact CHY API public site name', () => {
    expect(isChyApiSiteName('CHY API公益站')).toBe(true);
    expect(isChyApiSiteName('  chy api公益站  ')).toBe(true);
    expect(isChyApiSiteName('Any Router')).toBe(false);
  });

  it('converts Claude Code messages requests to OpenAI chat completions', () => {
    const result = rewriteForChyApi(
      Buffer.from(
        JSON.stringify({
          model: 'claude-route',
          system: [{ type: 'text', text: 'Be concise.' }],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 64,
          stream: true,
          tools: [
            {
              name: 'lookup',
              description: 'Lookup data',
              input_schema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        })
      ),
      'claudeCode',
      '/v1/messages',
      'claude-upstream'
    );
    const rewritten = JSON.parse(result.body.toString('utf-8'));

    expect(result.upstreamPath).toBe('/v1/chat/completions');
    expect(result.upstreamMethod).toBe('POST');
    expect(result.upstreamCliType).toBe('codex');
    expect(result.responseAdapter).toEqual({
      type: 'claudeMessages',
      model: 'claude-upstream',
      stream: true,
    });
    expect(rewritten.model).toBe('claude-upstream');
    expect(rewritten.messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
    ]);
    expect(rewritten.tools[0].function.name).toBe('lookup');
    expect(rewritten.max_tokens).toBe(64);
    expect(rewritten.stream).toBe(true);
  });

  it('converts Codex Responses requests to OpenAI chat completions', () => {
    const result = rewriteForChyApi(
      Buffer.from(
        JSON.stringify({
          model: 'gpt-route',
          instructions: 'Answer briefly.',
          input: '1+1=?',
          max_output_tokens: 8,
          stream: false,
        })
      ),
      'codex',
      '/v1/responses',
      'gpt-upstream'
    );
    const rewritten = JSON.parse(result.body.toString('utf-8'));

    expect(result.upstreamPath).toBe('/v1/chat/completions');
    expect(result.upstreamMethod).toBe('POST');
    expect(result.upstreamCliType).toBe('codex');
    expect(result.responseAdapter).toEqual({
      type: 'codexResponses',
      model: 'gpt-upstream',
      stream: false,
    });
    expect(rewritten.model).toBe('gpt-upstream');
    expect(rewritten.messages).toEqual([
      { role: 'system', content: 'Answer briefly.' },
      { role: 'user', content: '1+1=?' },
    ]);
    expect(rewritten.max_tokens).toBe(8);
  });

  it('converts Gemini native requests to OpenAI chat completions', () => {
    const result = rewriteForChyApi(
      Buffer.from(
        JSON.stringify({
          systemInstruction: { parts: [{ text: 'Be concise.' }] },
          contents: [
            { role: 'user', parts: [{ text: 'hello' }] },
            { role: 'model', parts: [{ text: 'hi' }] },
          ],
          generationConfig: {
            maxOutputTokens: 12,
            temperature: 0.2,
          },
        })
      ),
      'geminiCli',
      '/v1beta/models/gemini-route:streamGenerateContent?alt=sse',
      'gemini-upstream'
    );
    const rewritten = JSON.parse(result.body.toString('utf-8'));

    expect(result.upstreamPath).toBe('/v1/chat/completions');
    expect(result.upstreamMethod).toBe('POST');
    expect(result.upstreamCliType).toBe('codex');
    expect(result.responseAdapter).toEqual({
      type: 'geminiGenerateContent',
      model: 'gemini-upstream',
      stream: true,
    });
    expect(rewritten.model).toBe('gemini-upstream');
    expect(rewritten.messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    expect(rewritten.max_tokens).toBe(12);
    expect(rewritten.temperature).toBe(0.2);
    expect(rewritten.stream).toBe(true);
  });

  it('converts OpenAI chat completion JSON back to Claude Messages JSON', () => {
    const result = transformChyApiResponse({
      body: Buffer.from(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '2' } }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        })
      ),
      headers: { 'content-type': 'application/json', 'content-length': '999' },
      statusCode: 200,
      adapter: { type: 'claudeMessages', model: 'claude-upstream', stream: false },
    });
    const converted = JSON.parse(result.body.toString('utf-8'));

    expect(converted.type).toBe('message');
    expect(converted.role).toBe('assistant');
    expect(converted.model).toBe('claude-upstream');
    expect(converted.content).toEqual([{ type: 'text', text: '2' }]);
    expect(converted.usage).toEqual({ input_tokens: 5, output_tokens: 1 });
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['content-length']).toBe(String(result.body.length));
  });

  it('converts OpenAI chat completion SSE back to Gemini SSE', () => {
    const upstreamBody = Buffer.from(
      [
        'data: {"choices":[{"delta":{"content":"2"}}]}',
        '',
        'data: {"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6},"choices":[]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
    );

    const result = transformChyApiResponse({
      body: upstreamBody,
      headers: { 'content-type': 'text/event-stream' },
      statusCode: 200,
      adapter: { type: 'geminiGenerateContent', model: 'gemini-upstream', stream: true },
    });
    const converted = result.body.toString('utf-8');

    expect(converted).toContain('"text":"2"');
    expect(converted).toContain('"finishReason":"STOP"');
    expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8');
  });
});
