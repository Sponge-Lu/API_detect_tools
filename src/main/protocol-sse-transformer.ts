import { randomUUID } from 'crypto';
import { TextDecoder } from 'util';
import type { CliTargetProtocol } from '../shared/types/cli-config';

export type StreamingProtocol = Exclude<CliTargetProtocol, 'native'>;

type JsonRecord = Record<string, unknown>;
type FinishReason = 'stop' | 'tool_calls' | 'length';

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

type CanonicalEvent =
  | { type: 'start'; usage?: Usage }
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; key: string; id: string; name: string }
  | { type: 'tool-arguments'; key: string; delta: string }
  | { type: 'tool-end'; key: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'terminal'; finishReason: FinishReason }
  | { type: 'error'; message: string };

interface SseFrame {
  event: string;
  data: string;
}

export type ProtocolSseTransformStatus = 'open' | 'completed' | 'failed';

export class ProtocolSseTransformError extends Error {
  constructor(readonly reason: string) {
    super(`protocol_sse_transform:${reason}`);
    this.name = 'ProtocolSseTransformError';
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function mergeUsage(current: Usage, next: Usage): Usage {
  return {
    inputTokens: next.inputTokens ?? current.inputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
  };
}

function readUsage(value: unknown): Usage {
  const source = record(value);
  const inputTokens = finiteNumber(source.input_tokens ?? source.prompt_tokens);
  const outputTokens = finiteNumber(source.output_tokens ?? source.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: finiteNumber(source.total_tokens) ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
  };
}

function eventFrame(event: string | null, data: unknown): Buffer {
  const prefix = event ? `event: ${event}\n` : '';
  return Buffer.from(
    `${prefix}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    'utf8'
  );
}

function messageId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function errorMessage(payload: JsonRecord): string {
  const error = record(payload.error);
  return text(error.message) || text(payload.message) || text(payload.error) || 'upstream stream failed';
}

class SseFrameDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';

  push(chunk: Buffer): SseFrame[] {
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new ProtocolSseTransformError('invalid_utf8');
    }
    return this.drain();
  }

  finish(): SseFrame[] {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      throw new ProtocolSseTransformError('invalid_utf8');
    }
    const frames = this.drain();
    if (this.buffer.trim()) {
      throw new ProtocolSseTransformError('incomplete_sse_frame');
    }
    this.buffer = '';
    return frames;
  }

  private drain(): SseFrame[] {
    const frames: SseFrame[] = [];
    while (true) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (!boundary || boundary.index === undefined) break;
      const raw = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const parsed = this.parse(raw);
      if (parsed) frames.push(parsed);
    }
    return frames;
  }

  private parse(raw: string): SseFrame | null {
    let event = '';
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
  }
}

class CanonicalSseParser {
  private readonly messageBlocks = new Map<number, { key: string; kind: 'text' | 'tool' }>();
  private readonly responseTools = new Map<string, { key: string; arguments: string }>();
  private readonly chatTools = new Map<number, { key: string; arguments: string }>();
  private terminal = false;
  private failed = false;
  private finishReason: FinishReason = 'stop';

  constructor(private readonly protocol: StreamingProtocol) {}

  parse(frame: SseFrame): CanonicalEvent[] {
    if (this.terminal || this.failed) {
      if (frame.data === '[DONE]') return [];
      throw new ProtocolSseTransformError('event_after_terminal');
    }
    if (frame.data === '[DONE]') {
      if (this.protocol === 'anthropic-messages') {
        throw new ProtocolSseTransformError('unexpected_done_marker');
      }
      this.terminal = true;
      return [{ type: 'terminal', finishReason: this.finishReason }];
    }

    let payload: JsonRecord;
    try {
      payload = record(JSON.parse(frame.data));
    } catch {
      throw new ProtocolSseTransformError('malformed_json_event');
    }
    if (payload.error || frame.event === 'error' || payload.type === 'error') {
      this.failed = true;
      return [{ type: 'error', message: errorMessage(payload) }];
    }

    if (this.protocol === 'anthropic-messages') return this.parseMessages(payload);
    if (this.protocol === 'openai-responses') return this.parseResponses(payload, frame.event);
    return this.parseChat(payload);
  }

  getStatus(): ProtocolSseTransformStatus {
    return this.failed ? 'failed' : this.terminal ? 'completed' : 'open';
  }

  private parseMessages(payload: JsonRecord): CanonicalEvent[] {
    const kind = text(payload.type);
    if (kind === 'message_start') {
      return [{ type: 'start', usage: readUsage(record(payload.message).usage) }];
    }
    if (kind === 'content_block_start') {
      const index = finiteNumber(payload.index);
      if (index === undefined) throw new ProtocolSseTransformError('invalid_content_block_index');
      const block = record(payload.content_block);
      if (block.type === 'tool_use') {
        const key = `messages:${index}`;
        this.messageBlocks.set(index, { key, kind: 'tool' });
        return [{
          type: 'tool-start',
          key,
          id: text(block.id) || messageId('call'),
          name: text(block.name),
        }];
      }
      this.messageBlocks.set(index, { key: `messages:${index}`, kind: 'text' });
      return [];
    }
    if (kind === 'content_block_delta') {
      const index = finiteNumber(payload.index);
      const block = index === undefined ? undefined : this.messageBlocks.get(index);
      const delta = record(payload.delta);
      if (!block) throw new ProtocolSseTransformError('delta_without_content_block');
      if (block.kind === 'tool') {
        const value = text(delta.partial_json);
        return value ? [{ type: 'tool-arguments', key: block.key, delta: value }] : [];
      }
      const value = text(delta.text);
      return value ? [{ type: 'text', delta: value }] : [];
    }
    if (kind === 'content_block_stop') {
      const index = finiteNumber(payload.index);
      const block = index === undefined ? undefined : this.messageBlocks.get(index);
      if (!block) throw new ProtocolSseTransformError('stop_without_content_block');
      this.messageBlocks.delete(index!);
      return block.kind === 'tool' ? [{ type: 'tool-end', key: block.key }] : [];
    }
    if (kind === 'message_delta') {
      const reason = text(record(payload.delta).stop_reason);
      this.finishReason =
        reason === 'tool_use' ? 'tool_calls' : reason === 'max_tokens' ? 'length' : 'stop';
      return [{ type: 'usage', usage: readUsage(payload.usage) }];
    }
    if (kind === 'message_stop') {
      if (this.messageBlocks.size) throw new ProtocolSseTransformError('open_content_block');
      this.terminal = true;
      return [{ type: 'terminal', finishReason: this.finishReason }];
    }
    return [];
  }

  private parseResponses(payload: JsonRecord, frameEvent: string): CanonicalEvent[] {
    const kind = text(payload.type) || frameEvent;
    if (kind === 'response.failed' || kind === 'response.error') {
      this.failed = true;
      return [{ type: 'error', message: errorMessage(record(payload.response)) }];
    }
    if (kind === 'response.created' || kind === 'response.in_progress') {
      return [{ type: 'start', usage: readUsage(record(payload.response).usage) }];
    }
    if (kind === 'response.output_text.delta') {
      const delta = text(payload.delta);
      return delta ? [{ type: 'text', delta }] : [];
    }
    if (kind === 'response.output_item.added') {
      const item = record(payload.item);
      if (item.type !== 'function_call') return [];
      this.finishReason = 'tool_calls';
      const itemKey = text(item.id) || text(item.call_id) || messageId('fc');
      const key = `responses:${itemKey}`;
      this.responseTools.set(itemKey, { key, arguments: text(item.arguments) });
      const events: CanonicalEvent[] = [{
        type: 'tool-start',
        key,
        id: text(item.call_id) || itemKey,
        name: text(item.name),
      }];
      if (text(item.arguments)) {
        events.push({ type: 'tool-arguments', key, delta: text(item.arguments) });
      }
      return events;
    }
    if (kind === 'response.function_call_arguments.delta') {
      const itemKey = text(payload.item_id) || text(payload.call_id);
      const tool = this.responseTools.get(itemKey);
      if (!tool) throw new ProtocolSseTransformError('tool_delta_without_start');
      const delta = text(payload.delta);
      tool.arguments += delta;
      return delta ? [{ type: 'tool-arguments', key: tool.key, delta }] : [];
    }
    if (kind === 'response.output_item.done') {
      const item = record(payload.item);
      if (item.type !== 'function_call') return [];
      const itemKey = text(item.id) || text(item.call_id);
      let tool = this.responseTools.get(itemKey);
      const events: CanonicalEvent[] = [];
      if (!tool) {
        const key = `responses:${itemKey || messageId('fc')}`;
        tool = { key, arguments: '' };
        events.push({
          type: 'tool-start',
          key,
          id: text(item.call_id) || itemKey || messageId('call'),
          name: text(item.name),
        });
      }
      const finalArguments = text(item.arguments);
      if (finalArguments && finalArguments !== tool.arguments) {
        events.push({ type: 'tool-arguments', key: tool.key, delta: finalArguments });
      }
      events.push({ type: 'tool-end', key: tool.key });
      this.responseTools.delete(itemKey);
      return events;
    }
    if (kind === 'response.completed' || kind === 'response.incomplete') {
      const response = record(payload.response);
      const events: CanonicalEvent[] = [];
      const usage = readUsage(response.usage);
      if (Object.values(usage).some(value => value !== undefined)) {
        events.push({ type: 'usage', usage });
      }
      if (kind === 'response.incomplete') this.finishReason = 'length';
      this.terminal = true;
      events.push({ type: 'terminal', finishReason: this.finishReason });
      return events;
    }
    return [];
  }

  private parseChat(payload: JsonRecord): CanonicalEvent[] {
    const events: CanonicalEvent[] = [];
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const rawChoice of choices) {
      const choice = record(rawChoice);
      const delta = record(choice.delta);
      const content = text(delta.content);
      if (content) events.push({ type: 'text', delta: content });
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const rawCall of calls) {
        const call = record(rawCall);
        const index = finiteNumber(call.index);
        if (index === undefined) throw new ProtocolSseTransformError('invalid_tool_index');
        const fn = record(call.function);
        let tool = this.chatTools.get(index);
        if (!tool) {
          const key = `chat:${index}`;
          tool = { key, arguments: '' };
          this.chatTools.set(index, tool);
          events.push({
            type: 'tool-start',
            key,
            id: text(call.id) || messageId('call'),
            name: text(fn.name),
          });
        }
        const argumentsDelta = text(fn.arguments);
        if (argumentsDelta) {
          tool.arguments += argumentsDelta;
          events.push({ type: 'tool-arguments', key: tool.key, delta: argumentsDelta });
        }
      }
      const reason = text(choice.finish_reason);
      if (reason) {
        this.finishReason =
          reason === 'tool_calls' || reason === 'function_call'
            ? 'tool_calls'
            : reason === 'length'
              ? 'length'
              : 'stop';
        for (const tool of this.chatTools.values()) {
          events.push({ type: 'tool-end', key: tool.key });
        }
        this.chatTools.clear();
      }
    }
    const usage = readUsage(payload.usage);
    if (Object.values(usage).some(value => value !== undefined)) {
      events.push({ type: 'usage', usage });
    }
    return events;
  }
}

class ProtocolSseWriter {
  private readonly responseId = messageId('resp');
  private readonly messageId = messageId('msg');
  private readonly chatId = messageId('chatcmpl');
  private readonly createdAt = Math.floor(Date.now() / 1000);
  private readonly responseOutput: JsonRecord[] = [];
  private readonly responseTools = new Map<string, { index: number; item: JsonRecord; arguments: string }>();
  private readonly chatTools = new Map<string, number>();
  private usage: Usage = {};
  private started = false;
  private completed = false;
  private failed = false;
  private text = '';
  private textIndex: number | undefined;
  private textOpen = false;
  private messageBlockIndex = 0;
  private activeMessageBlock: { key?: string; index: number } | undefined;

  constructor(
    private readonly protocol: StreamingProtocol,
    private readonly model: string
  ) {}

  write(event: CanonicalEvent): Buffer[] {
    if (this.completed || this.failed) return [];
    if (event.type === 'error') return this.writeError(event.message);
    if (event.type === 'usage') {
      this.usage = mergeUsage(this.usage, event.usage);
      return [];
    }
    if (event.type === 'start') {
      if (event.usage) this.usage = mergeUsage(this.usage, event.usage);
      return this.ensureStart();
    }

    const chunks = this.ensureStart();
    if (event.type === 'text') chunks.push(...this.writeText(event.delta));
    if (event.type === 'tool-start') chunks.push(...this.writeToolStart(event));
    if (event.type === 'tool-arguments') chunks.push(...this.writeToolArguments(event));
    if (event.type === 'tool-end') chunks.push(...this.writeToolEnd(event.key));
    if (event.type === 'terminal') chunks.push(...this.writeTerminal(event.finishReason));
    return chunks;
  }

  private ensureStart(): Buffer[] {
    if (this.started) return [];
    this.started = true;
    if (this.protocol === 'anthropic-messages') {
      return [eventFrame('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.usage.inputTokens ?? 0, output_tokens: 0 },
        },
      })];
    }
    if (this.protocol === 'openai-responses') {
      const response = this.responseObject('in_progress', []);
      return [
        eventFrame('response.created', { type: 'response.created', response }),
        eventFrame('response.in_progress', { type: 'response.in_progress', response }),
      ];
    }
    return [this.chatChunk({ role: 'assistant' }, null)];
  }

  private writeText(delta: string): Buffer[] {
    this.text += delta;
    if (this.protocol === 'anthropic-messages') {
      if (this.activeMessageBlock && this.activeMessageBlock.key === undefined) {
        return [eventFrame('content_block_delta', {
          type: 'content_block_delta',
          index: this.activeMessageBlock.index,
          delta: { type: 'text_delta', text: delta },
        })];
      }
      const chunks = this.closeActiveMessageBlock();
      const index = this.messageBlockIndex++;
      this.activeMessageBlock = { index };
      chunks.push(
        eventFrame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        }),
        eventFrame('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: delta },
        })
      );
      return chunks;
    }
    if (this.protocol === 'openai-responses') {
      const chunks: Buffer[] = [];
      if (!this.textOpen) {
        this.textIndex = this.responseOutput.length;
        const item = {
          id: this.messageId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: [],
        };
        this.responseOutput.push(item);
        this.textOpen = true;
        chunks.push(
          eventFrame('response.output_item.added', {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: this.textIndex,
            item,
          }),
          eventFrame('response.content_part.added', {
            type: 'response.content_part.added',
            response_id: this.responseId,
            item_id: this.messageId,
            output_index: this.textIndex,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          })
        );
      }
      chunks.push(eventFrame('response.output_text.delta', {
        type: 'response.output_text.delta',
        response_id: this.responseId,
        item_id: this.messageId,
        output_index: this.textIndex,
        content_index: 0,
        delta,
      }));
      return chunks;
    }
    return [this.chatChunk({ content: delta }, null)];
  }

  private writeToolStart(event: Extract<CanonicalEvent, { type: 'tool-start' }>): Buffer[] {
    if (this.protocol === 'anthropic-messages') {
      const chunks = this.closeActiveMessageBlock();
      const index = this.messageBlockIndex++;
      this.activeMessageBlock = { key: event.key, index };
      chunks.push(eventFrame('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: event.id, name: event.name, input: {} },
      }));
      return chunks;
    }
    if (this.protocol === 'openai-responses') {
      const index = this.responseOutput.length;
      const item = {
        id: messageId('fc'),
        type: 'function_call',
        status: 'in_progress',
        call_id: event.id,
        name: event.name,
        arguments: '',
      };
      this.responseOutput.push(item);
      this.responseTools.set(event.key, { index, item, arguments: '' });
      return [eventFrame('response.output_item.added', {
        type: 'response.output_item.added',
        response_id: this.responseId,
        output_index: index,
        item,
      })];
    }
    const index = this.chatTools.size;
    this.chatTools.set(event.key, index);
    return [this.chatChunk({
      tool_calls: [{
        index,
        id: event.id,
        type: 'function',
        function: { name: event.name, arguments: '' },
      }],
    }, null)];
  }

  private writeToolArguments(event: Extract<CanonicalEvent, { type: 'tool-arguments' }>): Buffer[] {
    if (this.protocol === 'anthropic-messages') {
      if (this.activeMessageBlock?.key !== event.key) {
        throw new ProtocolSseTransformError('tool_arguments_without_active_block');
      }
      return [eventFrame('content_block_delta', {
        type: 'content_block_delta',
        index: this.activeMessageBlock.index,
        delta: { type: 'input_json_delta', partial_json: event.delta },
      })];
    }
    if (this.protocol === 'openai-responses') {
      const tool = this.responseTools.get(event.key);
      if (!tool) throw new ProtocolSseTransformError('tool_arguments_without_start');
      tool.arguments += event.delta;
      return [eventFrame('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        response_id: this.responseId,
        item_id: tool.item.id,
        output_index: tool.index,
        call_id: tool.item.call_id,
        delta: event.delta,
      })];
    }
    const index = this.chatTools.get(event.key);
    if (index === undefined) throw new ProtocolSseTransformError('tool_arguments_without_start');
    return [this.chatChunk({
      tool_calls: [{ index, function: { arguments: event.delta } }],
    }, null)];
  }

  private writeToolEnd(key: string): Buffer[] {
    if (this.protocol === 'anthropic-messages') {
      if (this.activeMessageBlock?.key !== key) return [];
      return this.closeActiveMessageBlock();
    }
    if (this.protocol === 'openai-responses') {
      const tool = this.responseTools.get(key);
      if (!tool) return [];
      const finalItem = { ...tool.item, status: 'completed', arguments: tool.arguments || '{}' };
      this.responseOutput[tool.index] = finalItem;
      this.responseTools.delete(key);
      return [
        eventFrame('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          response_id: this.responseId,
          item_id: tool.item.id,
          output_index: tool.index,
          call_id: tool.item.call_id,
          arguments: tool.arguments || '{}',
        }),
        eventFrame('response.output_item.done', {
          type: 'response.output_item.done',
          response_id: this.responseId,
          output_index: tool.index,
          item: finalItem,
        }),
      ];
    }
    this.chatTools.delete(key);
    return [];
  }

  private writeTerminal(reason: FinishReason): Buffer[] {
    const chunks: Buffer[] = [];
    if (this.protocol === 'anthropic-messages') {
      chunks.push(...this.closeActiveMessageBlock());
      chunks.push(
        eventFrame('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: reason === 'tool_calls' ? 'tool_use' : reason === 'length' ? 'max_tokens' : 'end_turn',
            stop_sequence: null,
          },
          usage: {
            input_tokens: this.usage.inputTokens ?? 0,
            output_tokens: this.usage.outputTokens ?? 0,
          },
        }),
        eventFrame('message_stop', { type: 'message_stop' })
      );
    } else if (this.protocol === 'openai-responses') {
      chunks.push(...this.closeResponseText());
      for (const key of [...this.responseTools.keys()]) chunks.push(...this.writeToolEnd(key));
      const response = this.responseObject('completed', this.responseOutput);
      chunks.push(
        eventFrame('response.completed', { type: 'response.completed', response }),
        eventFrame(null, '[DONE]')
      );
    } else {
      chunks.push(
        this.chatChunk(
          {},
          reason === 'tool_calls' ? 'tool_calls' : reason === 'length' ? 'length' : 'stop',
          this.usage
        ),
        eventFrame(null, '[DONE]')
      );
    }
    this.completed = true;
    return chunks;
  }

  private writeError(message: string): Buffer[] {
    this.failed = true;
    if (this.protocol === 'anthropic-messages') {
      return [eventFrame('error', {
        type: 'error',
        error: { type: 'api_error', message },
      })];
    }
    if (this.protocol === 'openai-responses') {
      return [eventFrame('response.failed', {
        type: 'response.failed',
        response: {
          ...this.responseObject('failed', this.responseOutput),
          error: { code: 'upstream_error', message },
        },
      })];
    }
    return [eventFrame(null, { error: { type: 'upstream_error', message } })];
  }

  private closeActiveMessageBlock(): Buffer[] {
    if (!this.activeMessageBlock) return [];
    const index = this.activeMessageBlock.index;
    this.activeMessageBlock = undefined;
    return [eventFrame('content_block_stop', { type: 'content_block_stop', index })];
  }

  private closeResponseText(): Buffer[] {
    if (!this.textOpen || this.textIndex === undefined) return [];
    this.textOpen = false;
    const part = { type: 'output_text', text: this.text, annotations: [] };
    const item = {
      id: this.messageId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [part],
    };
    this.responseOutput[this.textIndex] = item;
    return [
      eventFrame('response.output_text.done', {
        type: 'response.output_text.done',
        response_id: this.responseId,
        item_id: this.messageId,
        output_index: this.textIndex,
        content_index: 0,
        text: this.text,
      }),
      eventFrame('response.content_part.done', {
        type: 'response.content_part.done',
        response_id: this.responseId,
        item_id: this.messageId,
        output_index: this.textIndex,
        content_index: 0,
        part,
      }),
      eventFrame('response.output_item.done', {
        type: 'response.output_item.done',
        response_id: this.responseId,
        output_index: this.textIndex,
        item,
      }),
    ];
  }

  private responseObject(status: 'in_progress' | 'completed' | 'failed', output: JsonRecord[]): JsonRecord {
    const inputTokens = this.usage.inputTokens ?? 0;
    const outputTokens = this.usage.outputTokens ?? 0;
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.createdAt,
      status,
      model: this.model,
      output,
      output_text: this.text,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: this.usage.totalTokens ?? inputTokens + outputTokens,
      },
    };
  }

  private chatChunk(
    delta: JsonRecord,
    finishReason: string | null,
    usage?: Usage
  ): Buffer {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    return eventFrame(null, {
      id: this.chatId,
      object: 'chat.completion.chunk',
      created: this.createdAt,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage
        ? {
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: usage.totalTokens ?? inputTokens + outputTokens,
            },
          }
        : {}),
    });
  }
}

export class IncrementalProtocolSseTransformer {
  private readonly decoder = new SseFrameDecoder();
  private readonly parser: CanonicalSseParser;
  private readonly writer: ProtocolSseWriter;

  constructor(params: {
    sourceProtocol: StreamingProtocol;
    targetProtocol: StreamingProtocol;
    model: string;
  }) {
    if (params.sourceProtocol === params.targetProtocol) {
      throw new ProtocolSseTransformError('protocols_must_differ');
    }
    this.parser = new CanonicalSseParser(params.targetProtocol);
    this.writer = new ProtocolSseWriter(params.sourceProtocol, params.model);
  }

  transform(chunk: Buffer): Buffer[] {
    return this.transformFrames(this.decoder.push(chunk));
  }

  finish(): Buffer[] {
    const chunks = this.transformFrames(this.decoder.finish());
    const status = this.parser.getStatus();
    if (status === 'open') throw new ProtocolSseTransformError('missing_terminal_event');
    if (status === 'failed') throw new ProtocolSseTransformError('upstream_error_event');
    return chunks;
  }

  getStatus(): ProtocolSseTransformStatus {
    return this.parser.getStatus();
  }

  private transformFrames(frames: SseFrame[]): Buffer[] {
    const chunks: Buffer[] = [];
    for (const frame of frames) {
      for (const event of this.parser.parse(frame)) {
        chunks.push(...this.writer.write(event));
      }
    }
    return chunks;
  }
}
