import { describe, expect, it } from 'vitest';
import {
  createIncrementalStreamingValidator,
  StreamingProtocolValidationError,
  type IncrementalStreamingValidator,
  type StreamingUsage,
  type StreamingValidationProtocol,
} from '../main/streaming-protocol-validator';

function sse(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${
    typeof data === 'string' ? data : JSON.stringify(data)
  }\n\n`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractUsage(value: unknown): StreamingUsage | undefined {
  const payload = asRecord(value);
  const response = asRecord(payload?.response);
  const message = asRecord(payload?.message);
  const usage = asRecord(payload?.usage) || asRecord(response?.usage) || asRecord(message?.usage);
  if (!usage) return undefined;
  const result: StreamingUsage = {
    promptTokens: number(usage.input_tokens ?? usage.prompt_tokens),
    completionTokens: number(usage.output_tokens ?? usage.completion_tokens),
    totalTokens: number(usage.total_tokens),
  };
  return Object.values(result).some(tokenCount => tokenCount !== undefined) ? result : undefined;
}

function pushBytewise(validator: IncrementalStreamingValidator, input: string): void {
  const bytes = Buffer.from(input, 'utf8');
  for (const byte of bytes) validator.push(Buffer.from([byte]));
}

function expectFailure(
  validation: ReturnType<IncrementalStreamingValidator['finish']>,
  reason: string
): void {
  expect(validation).toMatchObject({ ok: false, reason });
}

function expectPushFailure(
  validator: IncrementalStreamingValidator,
  input: string | Buffer,
  reason: string
): void {
  let thrown: unknown;
  try {
    validator.push(Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8'));
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StreamingProtocolValidationError);
  expect((thrown as StreamingProtocolValidationError).reason).toBe(reason);
}

function validStream(protocol: StreamingValidationProtocol): string {
  if (protocol === 'anthropic') {
    return [
      sse('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 3, output_tokens: 0 } },
      }),
      sse('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '\u4f60' },
      }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 2 },
      }),
      sse('message_stop', { type: 'message_stop' }),
    ].join('');
  }

  if (protocol === 'openaiResponses') {
    return [
      sse('response.output_text.delta', {
        type: 'response.output_text.delta',
        delta: '\u4f60',
      }),
      sse('response.completed', {
        type: 'response.completed',
        response: {
          output: [],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        },
      }),
      sse(null, '[DONE]'),
    ].join('');
  }

  return [
    sse(null, {
      choices: [{ index: 0, delta: { content: '\u4f60' }, finish_reason: null }],
    }),
    sse(null, {
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    sse(null, '[DONE]'),
  ].join('');
}

describe('incremental streaming protocol validator', () => {
  for (const protocol of [
    'anthropic',
    'openaiResponses',
    'openaiChat',
  ] as StreamingValidationProtocol[]) {
    it(`validates ${protocol} across every UTF-8 and SSE byte boundary`, () => {
      const validator = createIncrementalStreamingValidator(protocol, { extractUsage });
      pushBytewise(validator, validStream(protocol));

      expect(validator.finish()).toEqual({ ok: true });
      expect(validator.getState()).toMatchObject({
        terminalSeen: true,
        errorSeen: false,
        outputSeen: true,
      });
      expect(validator.getUsage()).toMatchObject({
        promptTokens: 3,
        completionTokens: 2,
      });
    });

    it(`ignores ${protocol} comments and empty data heartbeat frames`, () => {
      const validator = createIncrementalStreamingValidator(protocol, { extractUsage });
      pushBytewise(validator, `: upstream keepalive\n\ndata: \t \n\n${validStream(protocol)}`);

      expect(validator.finish()).toEqual({ ok: true });
      expect(validator.getState()).toMatchObject({
        terminalSeen: true,
        errorSeen: false,
        outputSeen: true,
      });
    });

    it(`rejects malformed ${protocol} frame JSON`, () => {
      const validator = createIncrementalStreamingValidator(protocol);
      expectPushFailure(validator, sse(null, '{bad-json'), 'malformed_sse_json');
    });
  }

  it('does not treat Anthropic terminal text inside content as message_stop', () => {
    const validator = createIncrementalStreamingValidator('anthropic');
    validator.push(
      Buffer.from(
        [
          sse('message_start', { type: 'message_start' }),
          sse('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'event: message_stop' },
          }),
          sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        ].join(''),
        'utf8'
      )
    );

    expectFailure(validator.finish(), 'missing_message_stop');
  });

  it('does not treat Responses terminal text inside output as response.completed', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    validator.push(
      Buffer.from(
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'response.completed',
        }),
        'utf8'
      )
    );

    expectFailure(validator.finish(), 'missing_response_terminal');
  });

  it('does not treat Chat terminal text inside output as [DONE]', () => {
    const validator = createIncrementalStreamingValidator('openaiChat');
    validator.push(
      Buffer.from(
        sse(null, {
          choices: [{ index: 0, delta: { content: 'data: [DONE]' }, finish_reason: null }],
        }),
        'utf8'
      )
    );

    expectFailure(validator.finish(), 'missing_chat_done');
  });

  it('rejects Anthropic deltas without an open content block', () => {
    const validator = createIncrementalStreamingValidator('anthropic');
    expectPushFailure(
      validator,
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'orphaned' },
      }),
      'unexpected_content_block_delta'
    );
  });

  it('rejects malformed and non-object Anthropic tool input JSON', () => {
    for (const partialJson of ['{"query":', '[]']) {
      const validator = createIncrementalStreamingValidator('anthropic');
      validator.push(
        Buffer.from(
          [
            sse('message_start', { type: 'message_start' }),
            sse('content_block_start', {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
            }),
            sse('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: partialJson },
            }),
          ].join(''),
          'utf8'
        )
      );
      expectPushFailure(
        validator,
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        'malformed_tool_input_json'
      );
    }
  });

  it('correlates Responses tools across item id and output index aliases', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    const functionItem = {
      id: 'fc_1',
      type: 'function_call',
      call_id: 'call_1',
      name: 'lookup',
      arguments: '',
    };
    validator.push(
      Buffer.from(
        [
          sse('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
            item: functionItem,
          }),
          sse('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            delta: '{"query":',
          }),
          sse('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            output_index: 0,
            arguments: '{"query":"value"}',
          }),
          sse('response.output_item.done', {
            type: 'response.output_item.done',
            item: { ...functionItem, status: 'completed', arguments: '{"query":"value"}' },
          }),
          sse('response.completed', {
            type: 'response.completed',
            response: { output: [{ ...functionItem, arguments: '{"query":"value"}' }] },
          }),
          sse(null, '[DONE]'),
        ].join(''),
        'utf8'
      )
    );

    expect(validator.finish()).toEqual({ ok: true });
  });

  it('rejects inconsistent authoritative Responses function arguments', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    validator.push(
      Buffer.from(
        [
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
            delta: '{"query":',
          }),
          sse('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            item_id: 'fc_1',
            arguments: '{"query":"left"}',
          }),
        ].join(''),
        'utf8'
      )
    );

    expectPushFailure(
      validator,
      sse('response.output_item.done', {
        type: 'response.output_item.done',
        item: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'lookup',
          arguments: '{"query":"right"}',
        },
      }),
      'tool_arguments_mismatch'
    );
  });

  it('rejects non-object Responses function arguments', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    expectPushFailure(
      validator,
      sse('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_1',
        arguments: '[]',
      }),
      'malformed_tool_arguments_json'
    );
  });

  it('accumulates Chat tools independently across choices and tool indices', () => {
    const validator = createIncrementalStreamingValidator('openaiChat');
    validator.push(
      Buffer.from(
        [
          sse(null, {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: 1, function: { arguments: '{"left":' } }],
                },
              },
              {
                index: 1,
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '{"right":' } }],
                },
              },
            ],
          }),
          sse(null, {
            choices: [
              {
                index: 1,
                delta: { tool_calls: [{ index: 0, function: { arguments: '2}' } }] },
              },
              {
                index: 0,
                delta: { tool_calls: [{ index: 1, function: { arguments: '1}' } }] },
              },
            ],
          }),
          sse(null, '[DONE]'),
          sse(null, '[DONE]'),
        ].join(''),
        'utf8'
      )
    );

    expect(validator.finish()).toEqual({ ok: true });
  });

  it('rejects non-object Chat tool arguments', () => {
    const validator = createIncrementalStreamingValidator('openaiChat');
    validator.push(
      Buffer.from(
        sse(null, {
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '[]' } }] },
            },
          ],
        }),
        'utf8'
      )
    );
    expectPushFailure(validator, sse(null, '[DONE]'), 'malformed_tool_arguments_json');
  });

  it('distinguishes missing usage, explicit zero usage, and valid zero-usage output', () => {
    const missingUsage = createIncrementalStreamingValidator('openaiResponses');
    missingUsage.push(
      Buffer.from(
        sse('response.completed', {
          type: 'response.completed',
          response: { output: [] },
        }),
        'utf8'
      )
    );
    expectFailure(missingUsage.finish(), 'empty_response');

    const zeroUsage = createIncrementalStreamingValidator('openaiResponses');
    zeroUsage.push(
      Buffer.from(
        sse('response.completed', {
          type: 'response.completed',
          response: {
            output: [],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        }),
        'utf8'
      )
    );
    expectFailure(zeroUsage.finish(), 'empty_response_zero_usage');

    const outputWithZeroUsage = createIncrementalStreamingValidator('openaiResponses');
    outputWithZeroUsage.push(
      Buffer.from(
        [
          sse('response.output_text.delta', {
            type: 'response.output_text.delta',
            delta: 'valid output',
          }),
          sse('response.completed', {
            type: 'response.completed',
            response: {
              output: [],
              usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            },
          }),
        ].join(''),
        'utf8'
      )
    );
    expect(outputWithZeroUsage.finish()).toEqual({ ok: true });
  });

  it('observes upstream protocol failures without turning them into local validation errors', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    validator.push(
      Buffer.from(
        sse('response.failed', {
          type: 'response.failed',
          sequence_number: 7,
          response: { error: { code: 'capacity_exhausted', message: 'no capacity' } },
        }),
        'utf8'
      )
    );

    expect(validator.finish()).toEqual({ ok: true });
    expect(validator.getState()).toMatchObject({
      terminalSeen: true,
      errorSeen: true,
      failureCode: 'capacity_exhausted',
      nextSequenceNumber: 8,
      errorSummary: 'no capacity',
    });
  });

  it('keeps permissive native observation alive after invalid UTF-8', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses', { strict: false });
    validator.push(
      Buffer.concat([Buffer.from('data: '), Buffer.from([0xff]), Buffer.from('\n\n')])
    );
    validator.push(Buffer.from(validStream('openaiResponses'), 'utf8'));

    expect(validator.getState()).toMatchObject({
      terminalSeen: true,
      outputSeen: true,
      errorSummary: 'upstream emitted invalid UTF-8 in streaming response',
    });
    expectFailure(validator.finish(), 'invalid_utf8');
  });

  it('enforces independent frame and tool-argument safety limits', () => {
    const frameValidator = createIncrementalStreamingValidator('openaiChat', {
      maxFrameBytes: 32,
    });
    expectPushFailure(
      frameValidator,
      sse(null, { choices: [{ delta: { content: 'x'.repeat(64) } }] }),
      'sse_frame_too_large'
    );

    const toolValidator = createIncrementalStreamingValidator('openaiChat', {
      maxToolArgumentBytes: 16,
    });
    expectPushFailure(
      toolValidator,
      sse(null, {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'x'.repeat(17) } }],
            },
          },
        ],
      }),
      'tool_arguments_too_large'
    );
  });

  it('validates a synthetic 128K-token-class stream without an aggregate body limit', () => {
    const validator = createIncrementalStreamingValidator('openaiResponses');
    const tokenChunk = ' token'.repeat(1024);

    for (let index = 0; index < 128; index += 1) {
      validator.push(
        Buffer.from(
          sse('response.output_text.delta', {
            type: 'response.output_text.delta',
            delta: tokenChunk,
          }),
          'utf8'
        )
      );
    }
    validator.push(
      Buffer.from(
        [
          sse('response.completed', {
            type: 'response.completed',
            response: { output: [], usage: { output_tokens: 128 * 1024 } },
          }),
          sse(null, '[DONE]'),
        ].join(''),
        'utf8'
      )
    );

    expect(validator.finish()).toEqual({ ok: true });
    expect(validator.getState()).toMatchObject({ terminalSeen: true, outputSeen: true });
  });
});
