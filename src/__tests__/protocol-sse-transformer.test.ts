import { describe, expect, it } from 'vitest';
import {
  IncrementalProtocolSseTransformer,
  ProtocolSseTransformError,
  type StreamingProtocol,
} from '../main/protocol-sse-transformer';

function sse(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${
    typeof data === 'string' ? data : JSON.stringify(data)
  }\n\n`;
}

function buildFixture(protocol: StreamingProtocol): Buffer {
  if (protocol === 'anthropic-messages') {
    return Buffer.from(
      [
        sse('message_start', {
          type: 'message_start',
          message: { usage: { input_tokens: 11, output_tokens: 0 } },
        }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '你' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '好' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"q":' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"值"}' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 1 }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 7 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ].join(''),
      'utf8'
    );
  }

  if (protocol === 'openai-responses') {
    const response = {
      id: 'resp_upstream',
      object: 'response',
      status: 'completed',
      model: 'fixture-model',
      output: [],
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    };
    return Buffer.from(
      [
        sse('response.created', {
          type: 'response.created',
          response: { ...response, status: 'in_progress', usage: null },
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: '你',
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: '好',
        }),
        sse('response.output_item.added', {
          type: 'response.output_item.added',
          item: {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '',
          },
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_1',
          call_id: 'call_1',
          delta: '{"q":',
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_1',
          call_id: 'call_1',
          delta: '"值"}',
        }),
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          item: {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '{"q":"值"}',
          },
        }),
        sse('response.completed', { type: 'response.completed', response }),
        sse(null, '[DONE]'),
      ].join(''),
      'utf8'
    );
  }

  return Buffer.from(
    [
      sse(null, {
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      }),
      sse(null, {
        choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }],
      }),
      sse(null, {
        choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }],
      }),
      sse(null, {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"q":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      sse(null, {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"值"}' } }] },
            finish_reason: null,
          },
        ],
      }),
      sse(null, {
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      sse(null, '[DONE]'),
    ].join(''),
    'utf8'
  );
}

function count(value: string, token: string): number {
  return value.split(token).length - 1;
}

function expectOneSuccessfulTerminal(protocol: StreamingProtocol, output: string): void {
  if (protocol === 'anthropic-messages') {
    expect(count(output, 'event: message_stop')).toBe(1);
    expect(count(output, '"stop_reason":"tool_use"')).toBe(1);
    return;
  }
  if (protocol === 'openai-responses') {
    expect(count(output, 'event: response.completed')).toBe(1);
    expect(count(output, 'data: [DONE]')).toBe(1);
    return;
  }
  expect(count(output, '"finish_reason":"tool_calls"')).toBe(1);
  expect(count(output, 'data: [DONE]')).toBe(1);
}

const protocols: StreamingProtocol[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions',
];

describe('IncrementalProtocolSseTransformer', () => {
  for (const sourceProtocol of protocols) {
    for (const targetProtocol of protocols) {
      if (sourceProtocol === targetProtocol) continue;

      it(`${targetProtocol} -> ${sourceProtocol} translates incrementally across byte boundaries`, () => {
        const transformer = new IncrementalProtocolSseTransformer({
          sourceProtocol,
          targetProtocol,
          model: 'fixture-model',
        });
        const input = buildFixture(targetProtocol);
        const chunks: Buffer[] = [];
        let firstOutputAt = -1;

        for (let index = 0; index < input.length; index += 1) {
          const output = transformer.transform(input.subarray(index, index + 1));
          if (output.length && firstOutputAt < 0) firstOutputAt = index;
          chunks.push(...output);
        }
        chunks.push(...transformer.finish());

        const output = Buffer.concat(chunks).toString('utf8');
        expect(firstOutputAt).toBeGreaterThanOrEqual(0);
        expect(firstOutputAt).toBeLessThan(input.length - 1);
        expect(output).toContain('你');
        expect(output).toContain('好');
        expect(output).toContain('lookup');
        expect(output).toContain('值');
        expect(output).toContain('11');
        expect(output).toContain('7');
        expectOneSuccessfulTerminal(sourceProtocol, output);
      });
    }
  }

  it('translates an upstream error without a successful terminal', () => {
    const transformer = new IncrementalProtocolSseTransformer({
      sourceProtocol: 'anthropic-messages',
      targetProtocol: 'openai-responses',
      model: 'fixture-model',
    });
    const output = transformer.transform(
      Buffer.from(
        sse('response.failed', {
          type: 'response.failed',
          response: { error: { message: 'capacity unavailable' } },
        }),
        'utf8'
      )
    );

    expect(Buffer.concat(output).toString('utf8')).toContain('capacity unavailable');
    expect(Buffer.concat(output).toString('utf8')).not.toContain('message_stop');
    expect(() => transformer.finish()).toThrowError(
      new ProtocolSseTransformError('upstream_error_event')
    );
  });

  it('rejects EOF without a terminal event', () => {
    const transformer = new IncrementalProtocolSseTransformer({
      sourceProtocol: 'openai-responses',
      targetProtocol: 'openai-chat-completions',
      model: 'fixture-model',
    });
    transformer.transform(
      Buffer.from(
        sse(null, {
          choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }],
        }),
        'utf8'
      )
    );

    expect(() => transformer.finish()).toThrowError(
      new ProtocolSseTransformError('missing_terminal_event')
    );
  });
});

