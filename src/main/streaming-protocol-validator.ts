import {
  ProtocolSseTransformError,
  SSE_FRAME_MAX_BYTES,
  SSE_TOOL_ARGUMENT_MAX_BYTES,
  SseFrameDecoder,
  type SseFrame,
} from './protocol-sse-transformer';

export type StreamingValidationProtocol = 'anthropic' | 'openaiChat' | 'openaiResponses';

export interface StreamingUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
}

export type CompletedStreamValidation =
  | { ok: true }
  | { ok: false; reason: string; message: string };

export interface StreamingValidationState {
  terminalSeen: boolean;
  errorSeen: boolean;
  failureCode?: string;
  nextSequenceNumber: number;
  outputSeen: boolean;
  explicitZeroUsage: boolean;
  errorSummary?: string;
  completedValidation?: CompletedStreamValidation;
}

export interface IncrementalStreamingValidator {
  push(chunk: Buffer): void;
  finish(): CompletedStreamValidation;
  getUsage(): StreamingUsage | undefined;
  getState(): StreamingValidationState;
}

export interface StreamingValidatorOptions {
  strict?: boolean;
  maxFrameBytes?: number;
  maxToolArgumentBytes?: number;
  extractUsage?: (payload: unknown) => StreamingUsage | undefined;
}

interface ArgumentAccumulator {
  chunks: string[];
  bytes: number;
  overflowed: boolean;
}

type JsonRecord = Record<string, unknown>;

export const STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES = SSE_FRAME_MAX_BYTES;
export const STREAMING_VALIDATION_MAX_TOOL_ARGUMENT_BYTES = SSE_TOOL_ARGUMENT_MAX_BYTES;
const STREAMING_VALIDATION_MAX_OPEN_ITEMS = 1024;
const STREAMING_VALIDATION_ERROR_SUMMARY_CHARS = 1200;
const DSML_SCAN_TAIL_CHARS = 128;

export class StreamingProtocolValidationError extends Error {
  constructor(
    readonly reason: string,
    readonly protocolMessage: string
  ) {
    super(`malformed_streaming_response:${reason}`);
    this.name = 'StreamingProtocolValidationError';
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumericIndex(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function failure(reason: string, message: string): CompletedStreamValidation {
  return { ok: false, reason, message };
}

function hasOnlyZeroUsageTokens(usage: JsonRecord | undefined): boolean {
  if (!usage) return false;
  const values = [
    usage.input_tokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.promptTokens,
    usage.output_tokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.completionTokens,
    usage.total_tokens,
    usage.totalTokens,
  ]
    .map(value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    })
    .filter((value): value is number => value !== undefined);
  return values.length > 0 && values.every(value => value === 0);
}

function hasResponsesOutputItem(value: unknown): boolean {
  const item = asRecord(value);
  if (!item) return false;
  const itemType = readString(item.type);
  if (itemType && itemType !== 'message') return true;
  if (readString(item.output_text).trim() || readString(item.text).trim()) return true;
  const content = Array.isArray(item.content) ? item.content : [];
  return content.some(part => {
    const record = asRecord(part);
    return Boolean(
      record && (readString(record.text).trim() || readString(record.output_text).trim())
    );
  });
}

function isForeignOpenAiLikeAnthropicPayload(payload: JsonRecord, eventType: string): boolean {
  if (eventType.startsWith('response.') || eventType.startsWith('chat.completion')) return true;
  if (Array.isArray(payload.choices) || Array.isArray(payload.tool_calls)) return true;
  const objectType = readString(payload.object);
  return objectType.startsWith('chat.completion') || objectType.startsWith('response.');
}

function mergeUsage(
  current: StreamingUsage | undefined,
  next: StreamingUsage | undefined
): StreamingUsage | undefined {
  if (!next) return current;
  const merged = { ...(current || {}) };
  let found = Boolean(current);
  for (const key of [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'cacheCreationTokens',
    'cacheReadTokens',
    'cachedTokens',
  ] as const) {
    if (next[key] !== undefined) {
      merged[key] = next[key];
      found = true;
    }
  }
  return found ? merged : undefined;
}

abstract class BaseStreamingValidator implements IncrementalStreamingValidator {
  private decoder: SseFrameDecoder;
  private readonly strict: boolean;
  private readonly maxFrameBytes: number;
  private readonly maxToolArgumentBytes: number;
  private readonly extractUsage?: (payload: unknown) => StreamingUsage | undefined;
  private usage: StreamingUsage | undefined;
  private validationFailure: CompletedStreamValidation | undefined;
  private decoderBroken = false;
  private finished = false;
  protected readonly state: StreamingValidationState = {
    terminalSeen: false,
    errorSeen: false,
    nextSequenceNumber: 0,
    outputSeen: false,
    explicitZeroUsage: false,
  };

  constructor(
    private readonly protocol: StreamingValidationProtocol,
    options: StreamingValidatorOptions
  ) {
    this.strict = options.strict !== false;
    this.maxToolArgumentBytes =
      options.maxToolArgumentBytes ?? STREAMING_VALIDATION_MAX_TOOL_ARGUMENT_BYTES;
    this.maxFrameBytes = options.maxFrameBytes ?? STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES;
    this.extractUsage = options.extractUsage;
    this.decoder = this.createDecoder();
  }

  push(chunk: Buffer): void {
    if (this.finished || this.decoderBroken || chunk.length === 0) return;
    try {
      this.processFrames(this.decoder.push(chunk));
    } catch (error: unknown) {
      this.handlePushError(error);
    }
  }

  finish(): CompletedStreamValidation {
    if (this.finished) {
      return this.state.completedValidation || this.validationFailure || { ok: true };
    }
    this.finished = true;
    if (!this.decoderBroken) {
      let frames: SseFrame[] = [];
      try {
        frames = this.decoder.finish();
      } catch (error: unknown) {
        this.recordDecoderFailure(error, false);
      }
      try {
        this.processFrames(frames);
      } catch (error: unknown) {
        if (!(error instanceof StreamingProtocolValidationError)) throw error;
      }
    }
    if (this.state.errorSeen) return { ok: true };
    const result = this.validationFailure || this.validateCompleted();
    this.state.completedValidation = result;
    return result;
  }

  getUsage(): StreamingUsage | undefined {
    return this.usage ? { ...this.usage } : undefined;
  }

  getState(): StreamingValidationState {
    return { ...this.state };
  }

  protected abstract malformedJsonMessage(): string;
  protected abstract processPayload(frame: SseFrame, payload: JsonRecord, eventType: string): void;
  protected abstract processDone(): void;
  protected abstract validateCompleted(): CompletedStreamValidation;

  protected recordFailure(reason: string, message: string, throwNow = true): false {
    if (!this.validationFailure) {
      this.validationFailure = failure(reason, message);
      this.state.errorSummary = message.slice(0, STREAMING_VALIDATION_ERROR_SUMMARY_CHARS);
    }
    if (this.strict && throwNow) {
      throw new StreamingProtocolValidationError(reason, message);
    }
    return false;
  }

  protected createArguments(initial = ''): ArgumentAccumulator {
    const accumulator = { chunks: [] as string[], bytes: 0, overflowed: false };
    if (initial) this.appendArguments(accumulator, initial);
    return accumulator;
  }

  protected appendArguments(accumulator: ArgumentAccumulator, delta: string): void {
    if (!delta || accumulator.overflowed) return;
    const deltaBytes = Buffer.byteLength(delta, 'utf8');
    if (accumulator.bytes + deltaBytes > this.maxToolArgumentBytes) {
      accumulator.overflowed = true;
      this.recordFailure(
        'tool_arguments_too_large',
        `upstream emitted ${this.protocol} tool arguments above the safety limit`
      );
      return;
    }
    accumulator.bytes += deltaBytes;
    accumulator.chunks.push(delta);
  }

  protected replaceArguments(accumulator: ArgumentAccumulator, value: string): void {
    accumulator.chunks = [];
    accumulator.bytes = 0;
    accumulator.overflowed = false;
    this.appendArguments(accumulator, value);
  }

  protected readArguments(accumulator: ArgumentAccumulator): string {
    return accumulator.chunks.join('');
  }

  protected assertOpenItemLimit(size: number): boolean {
    if (size >= STREAMING_VALIDATION_MAX_OPEN_ITEMS) {
      this.recordFailure(
        'too_many_open_stream_items',
        `upstream emitted too many concurrent ${this.protocol} stream items`
      );
      return false;
    }
    return true;
  }

  protected updateCompletionValidation(): void {
    if (!this.state.terminalSeen || this.state.errorSeen) return;
    this.state.completedValidation = this.validationFailure || this.validateCompleted();
  }

  private processFrames(frames: SseFrame[]): void {
    for (const frame of frames) this.processFrame(frame);
  }

  private processFrame(frame: SseFrame): void {
    if (!frame.data.trim()) return;
    if (frame.data.trim() === '[DONE]') {
      this.processDone();
      this.updateCompletionValidation();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      this.recordFailure('malformed_sse_json', this.malformedJsonMessage());
      return;
    }
    const payload = asRecord(parsed);
    if (!payload) {
      this.recordFailure('malformed_sse_json', this.malformedJsonMessage());
      return;
    }

    try {
      this.usage = mergeUsage(this.usage, this.extractUsage?.(payload));
    } catch {
      // Usage extraction must never invalidate an otherwise valid protocol frame.
    }

    const sequenceNumber = payload.sequence_number;
    if (
      typeof sequenceNumber === 'number' &&
      Number.isSafeInteger(sequenceNumber) &&
      sequenceNumber >= this.state.nextSequenceNumber
    ) {
      this.state.nextSequenceNumber = sequenceNumber + 1;
    }

    const eventType = readString(payload.type) || frame.event;
    const response = asRecord(payload.response);
    const payloadError = asRecord(payload.error) || asRecord(response?.error);
    const failureEvent =
      frame.event === 'error' ||
      eventType === 'error' ||
      eventType === 'response.failed' ||
      eventType === 'response.error';
    if (failureEvent || payloadError) {
      this.state.errorSeen = true;
      this.state.terminalSeen = true;
      this.state.failureCode =
        readString(payloadError?.type) ||
        readString(payloadError?.code) ||
        eventType ||
        'unknown_error';
      this.state.errorSummary = (
        readString(payloadError?.message) ||
        readString(payload.message) ||
        this.state.failureCode
      ).slice(0, STREAMING_VALIDATION_ERROR_SUMMARY_CHARS);
      return;
    }

    this.processPayload(frame, payload, eventType);
    this.updateCompletionValidation();
  }

  private handlePushError(error: unknown): void {
    if (error instanceof StreamingProtocolValidationError) throw error;
    this.recordDecoderFailure(error, true);
  }

  private recordDecoderFailure(error: unknown, throwNow: boolean): void {
    const reason = error instanceof ProtocolSseTransformError ? error.reason : 'invalid_sse_frame';
    const message =
      reason === 'invalid_utf8'
        ? 'upstream emitted invalid UTF-8 in streaming response'
        : reason === 'sse_frame_too_large'
          ? 'upstream emitted an SSE frame above the safety limit'
          : reason === 'incomplete_sse_frame'
            ? 'upstream ended with an incomplete SSE frame'
            : 'upstream emitted an invalid SSE frame';
    if (!this.strict && reason === 'invalid_utf8') {
      this.decoder = this.createDecoder();
    } else {
      this.decoderBroken = true;
    }
    this.recordFailure(reason, message, throwNow);
  }

  private createDecoder(): SseFrameDecoder {
    return new SseFrameDecoder(this.maxFrameBytes);
  }
}

interface AnthropicBlockState {
  type: string;
  hasText: boolean;
  hasThinking: boolean;
  toolArguments?: ArgumentAccumulator;
}

class AnthropicStreamingValidator extends BaseStreamingValidator {
  private readonly openBlocks = new Map<number, AnthropicBlockState>();
  private sawMessageStart = false;
  private sawMessageStop = false;
  private stopReason = '';
  private completedText = false;
  private completedToolBlocks = 0;
  private completedThinkingBlocks = 0;
  private dsmlTail = '';

  protected malformedJsonMessage(): string {
    return 'upstream emitted malformed Anthropic SSE JSON';
  }

  protected processDone(): void {
    // Anthropic does not use the OpenAI [DONE] sentinel.
  }

  protected processPayload(_frame: SseFrame, payload: JsonRecord, eventType: string): void {
    if (isForeignOpenAiLikeAnthropicPayload(payload, eventType)) {
      this.recordFailure(
        'foreign_openai_event',
        'upstream emitted OpenAI-style events in Claude Code stream'
      );
      return;
    }

    if (eventType === 'message_start') {
      this.sawMessageStart = true;
      return;
    }

    if (eventType === 'content_block_start') {
      const index = readNumericIndex(payload.index);
      const contentBlock = asRecord(payload.content_block);
      const blockType = readString(contentBlock?.type);
      if (index === undefined || !blockType || this.openBlocks.has(index)) {
        this.recordFailure(
          'invalid_content_block_start',
          'upstream emitted invalid Anthropic content block start'
        );
        return;
      }
      if (!this.assertOpenItemLimit(this.openBlocks.size)) return;
      const text = readString(contentBlock?.text);
      if (text) this.inspectDsml(text);
      this.openBlocks.set(index, {
        type: blockType,
        hasText: text.length > 0,
        hasThinking: readString(contentBlock?.thinking).length > 0,
        ...(blockType === 'tool_use' ? { toolArguments: this.createArguments() } : {}),
      });
      return;
    }

    if (eventType === 'content_block_delta') {
      const index = readNumericIndex(payload.index);
      const block = index === undefined ? undefined : this.openBlocks.get(index);
      const delta = asRecord(payload.delta);
      if (!block || !delta) {
        this.recordFailure(
          'unexpected_content_block_delta',
          'upstream emitted Anthropic content delta without an open block'
        );
        return;
      }
      const deltaType = readString(delta.type);
      if (block.type === 'text') {
        const text = readString(delta.text);
        if (text) {
          block.hasText = true;
          this.inspectDsml(text);
        }
      } else if (block.type === 'tool_use' && deltaType === 'input_json_delta') {
        this.appendArguments(block.toolArguments!, readString(delta.partial_json));
      } else if (block.type === 'thinking' && readString(delta.thinking)) {
        block.hasThinking = true;
      }
      return;
    }

    if (eventType === 'content_block_stop') {
      const index = readNumericIndex(payload.index);
      const block = index === undefined ? undefined : this.openBlocks.get(index);
      if (index === undefined || !block) {
        this.recordFailure(
          'unexpected_content_block_stop',
          'upstream emitted Anthropic content block stop without an open block'
        );
        return;
      }
      if (block.type === 'tool_use') {
        this.validateAnthropicToolInput(block.toolArguments!);
        this.completedToolBlocks += 1;
        this.state.outputSeen = true;
      } else if (block.type === 'thinking') {
        if (block.hasThinking) this.completedThinkingBlocks += 1;
      } else if (block.hasText) {
        this.completedText = true;
        this.state.outputSeen = true;
      }
      this.openBlocks.delete(index);
      return;
    }

    if (eventType === 'message_delta') {
      const nextStopReason = readString(asRecord(payload.delta)?.stop_reason);
      if (nextStopReason) this.stopReason = nextStopReason;
      return;
    }

    if (eventType === 'message_stop') {
      this.sawMessageStop = true;
      this.state.terminalSeen = true;
    }
  }

  protected validateCompleted(): CompletedStreamValidation {
    if (!this.sawMessageStart) {
      return failure(
        'missing_message_start',
        'upstream ended Claude Code stream without message_start'
      );
    }
    if (!this.sawMessageStop) {
      return failure(
        'missing_message_stop',
        'upstream ended Claude Code stream without message_stop'
      );
    }
    if (this.openBlocks.size > 0) {
      return failure(
        'unclosed_content_block',
        'upstream ended Claude Code stream with an unclosed content block'
      );
    }
    if (this.stopReason === 'tool_use' && this.completedToolBlocks === 0) {
      return failure(
        'tool_use_stop_without_tool_block',
        'upstream ended Claude Code stream with tool_use stop_reason but no tool_use block'
      );
    }
    if (this.completedToolBlocks > 0 && this.stopReason && this.stopReason !== 'tool_use') {
      return failure(
        'tool_block_without_tool_use_stop',
        'upstream emitted Claude tool_use blocks without tool_use stop_reason'
      );
    }
    if (!this.completedText && this.completedToolBlocks === 0) {
      return failure(
        this.completedThinkingBlocks > 0 ? 'thinking_only_message' : 'empty_message',
        'upstream ended Claude Code stream without assistant text or tool_use content'
      );
    }
    return { ok: true };
  }

  private inspectDsml(text: string): void {
    const candidate = `${this.dsmlTail}${text}`;
    if (/<\/?\s*\|\s*DSML\s*\|\s*(?:parameter|invoke|tool_calls)\s*>/i.test(candidate)) {
      this.recordFailure(
        'foreign_dsml_tool_markup',
        'upstream emitted non-Anthropic tool markup in Claude Code stream'
      );
    }
    this.dsmlTail = candidate.slice(-DSML_SCAN_TAIL_CHARS);
  }

  private validateAnthropicToolInput(argumentsState: ArgumentAccumulator): void {
    const json = this.readArguments(argumentsState).trim();
    if (!json) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      this.recordFailure(
        'malformed_tool_input_json',
        'upstream emitted an incomplete Claude tool_use input JSON stream'
      );
      return;
    }
    if (!asRecord(parsed)) {
      this.recordFailure(
        'malformed_tool_input_json',
        'upstream emitted a Claude tool_use with non-object input JSON'
      );
    }
  }
}

class OpenAiResponsesStreamingValidator extends BaseStreamingValidator {
  private readonly tools = new Map<string, ArgumentAccumulator>();
  private readonly toolAliases = new Map<string, string>();
  private anonymousToolSequence = 0;
  private sawFinished = false;
  private sawDone = false;

  protected malformedJsonMessage(): string {
    return 'upstream emitted malformed OpenAI Responses SSE JSON';
  }

  protected processDone(): void {
    this.sawDone = true;
    this.state.terminalSeen = true;
    this.validateOpenTools();
  }

  protected processPayload(_frame: SseFrame, payload: JsonRecord, eventType: string): void {
    if (eventType === 'response.output_text.delta' || eventType === 'response.output_text.done') {
      if (readString(payload.delta).trim() || readString(payload.text).trim()) {
        this.state.outputSeen = true;
      }
      return;
    }

    if (eventType === 'response.output_item.added' || eventType === 'response.output_item.done') {
      const item = asRecord(payload.item);
      if (hasResponsesOutputItem(item)) this.state.outputSeen = true;
      if (item?.type === 'function_call') {
        const { key, tool } = this.resolveTool(payload, item);
        const finalArguments = readString(item.arguments);
        this.applyFinalToolArguments(tool, finalArguments);
        if (eventType === 'response.output_item.done') {
          this.validateToolArguments(tool);
          this.closeTool(key);
        }
      }
      return;
    }

    if (
      eventType === 'response.function_call_arguments.delta' ||
      eventType === 'response.function_call_arguments.done'
    ) {
      const { tool } = this.resolveTool(payload);
      const value =
        eventType === 'response.function_call_arguments.done'
          ? readString(payload.arguments)
          : readString(payload.delta);
      if (eventType === 'response.function_call_arguments.done' && value) {
        this.applyFinalToolArguments(tool, value);
      } else {
        this.appendArguments(tool, value);
      }
      if (value.trim()) this.state.outputSeen = true;
      if (eventType === 'response.function_call_arguments.done') {
        this.validateToolArguments(tool);
      }
      return;
    }

    if (eventType === 'response.completed' || eventType === 'response.incomplete') {
      this.sawFinished = true;
      this.state.terminalSeen = true;
      const response = asRecord(payload.response);
      if (readString(response?.output_text).trim()) this.state.outputSeen = true;
      const output = Array.isArray(response?.output) ? response.output : [];
      if (output.some(hasResponsesOutputItem)) this.state.outputSeen = true;
      this.state.explicitZeroUsage =
        this.state.explicitZeroUsage ||
        hasOnlyZeroUsageTokens(asRecord(response?.usage) || asRecord(payload.usage));
      this.validateOpenTools();
    }
  }

  protected validateCompleted(): CompletedStreamValidation {
    if (!this.sawFinished && !this.sawDone) {
      return failure(
        'missing_response_terminal',
        'upstream ended Codex stream without response.completed, response.incomplete, or [DONE]'
      );
    }
    if (!this.state.outputSeen) {
      if (this.state.explicitZeroUsage) {
        return failure(
          'empty_response_zero_usage',
          'upstream ended Codex stream without output and with all-zero usage'
        );
      }
      return failure(
        'empty_response',
        'upstream ended Codex stream without assistant text, function_call, or tool output content'
      );
    }
    return { ok: true };
  }

  private resolveTool(
    payload: JsonRecord,
    item?: JsonRecord
  ): { key: string; tool: ArgumentAccumulator } {
    const aliases = this.toolAliasKeys(payload, item);
    const matchedKeys = [
      ...new Set(
        aliases
          .map(alias => this.toolAliases.get(alias))
          .filter((key): key is string => Boolean(key))
      ),
    ];
    const key = matchedKeys[0] || aliases[0] || `anonymous:${this.anonymousToolSequence++}`;
    let tool = this.tools.get(key);
    if (!tool) {
      if (!this.assertOpenItemLimit(this.tools.size)) {
        return { key, tool: this.createArguments() };
      }
      tool = this.createArguments();
      this.tools.set(key, tool);
    }

    for (const duplicateKey of matchedKeys.slice(1)) {
      const duplicate = this.tools.get(duplicateKey);
      if (duplicate) {
        this.appendArguments(tool, this.readArguments(duplicate));
        this.tools.delete(duplicateKey);
      }
      for (const [alias, mappedKey] of this.toolAliases) {
        if (mappedKey === duplicateKey) this.toolAliases.set(alias, key);
      }
    }
    for (const alias of aliases) this.toolAliases.set(alias, key);
    return { key, tool };
  }

  private toolAliasKeys(payload: JsonRecord, item?: JsonRecord): string[] {
    const aliases = [
      readString(item?.id) ? `item:${readString(item?.id)}` : '',
      readString(item?.call_id) ? `call:${readString(item?.call_id)}` : '',
      readString(payload.item_id) ? `item:${readString(payload.item_id)}` : '',
      readString(payload.call_id) ? `call:${readString(payload.call_id)}` : '',
      payload.output_index !== undefined ? `output:${String(payload.output_index)}` : '',
    ];
    return [...new Set(aliases.filter(Boolean))];
  }

  private closeTool(key: string): void {
    this.tools.delete(key);
    for (const [alias, mappedKey] of this.toolAliases) {
      if (mappedKey === key) this.toolAliases.delete(alias);
    }
  }

  private validateOpenTools(): void {
    for (const tool of this.tools.values()) this.validateToolArguments(tool);
    this.tools.clear();
    this.toolAliases.clear();
  }

  private validateToolArguments(argumentsState: ArgumentAccumulator): void {
    const json = this.readArguments(argumentsState).trim();
    if (!json) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      this.recordFailure(
        'malformed_tool_arguments_json',
        'upstream emitted malformed OpenAI Responses function arguments JSON'
      );
      return;
    }
    if (!asRecord(parsed)) {
      this.recordFailure(
        'malformed_tool_arguments_json',
        'upstream emitted non-object OpenAI Responses function arguments JSON'
      );
    }
  }

  private applyFinalToolArguments(tool: ArgumentAccumulator, finalArguments: string): void {
    if (!finalArguments) return;
    if (!finalArguments.startsWith(this.readArguments(tool))) {
      this.recordFailure(
        'tool_arguments_mismatch',
        'upstream emitted inconsistent OpenAI Responses function arguments'
      );
      return;
    }
    this.replaceArguments(tool, finalArguments);
  }
}

class OpenAiChatStreamingValidator extends BaseStreamingValidator {
  private readonly tools = new Map<string, ArgumentAccumulator>();
  private sawDone = false;

  protected malformedJsonMessage(): string {
    return 'upstream emitted malformed OpenAI Chat Completions SSE JSON';
  }

  protected processDone(): void {
    this.sawDone = true;
    this.state.terminalSeen = true;
    for (const tool of this.tools.values()) this.validateToolArguments(tool);
    this.tools.clear();
  }

  protected processPayload(_frame: SseFrame, payload: JsonRecord): void {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (let choiceOffset = 0; choiceOffset < choices.length; choiceOffset += 1) {
      const choice = asRecord(choices[choiceOffset]);
      if (!choice) continue;
      const choiceIndex = readNumericIndex(choice.index) ?? choiceOffset;
      const delta = asRecord(choice.delta);
      const message = asRecord(choice.message);
      if (readString(delta?.content).length || readString(message?.content).length) {
        this.state.outputSeen = true;
      }
      this.processToolCalls(choiceIndex, delta?.tool_calls, false);
      this.processToolCalls(choiceIndex, message?.tool_calls, true);
    }
    this.state.explicitZeroUsage =
      this.state.explicitZeroUsage || hasOnlyZeroUsageTokens(asRecord(payload.usage));
  }

  protected validateCompleted(): CompletedStreamValidation {
    if (!this.sawDone) {
      return failure(
        'missing_chat_done',
        'upstream ended OpenAI Chat Completions stream without [DONE]'
      );
    }
    if (!this.state.outputSeen) {
      if (this.state.explicitZeroUsage) {
        return failure(
          'empty_response_zero_usage',
          'upstream ended OpenAI Chat Completions stream without output and with all-zero usage'
        );
      }
      return failure(
        'empty_response',
        'upstream ended OpenAI Chat Completions stream without assistant text or tool call content'
      );
    }
    return { ok: true };
  }

  private processToolCalls(choiceIndex: number, value: unknown, replace: boolean): void {
    const calls = Array.isArray(value) ? value : [];
    for (let callOffset = 0; callOffset < calls.length; callOffset += 1) {
      const call = asRecord(calls[callOffset]);
      if (!call) continue;
      this.state.outputSeen = true;
      const callIndex = readNumericIndex(call.index) ?? callOffset;
      const key = `${choiceIndex}:${callIndex}`;
      let tool = this.tools.get(key);
      if (!tool) {
        if (!this.assertOpenItemLimit(this.tools.size)) continue;
        tool = this.createArguments();
        this.tools.set(key, tool);
      }
      const argumentsDelta = readString(asRecord(call.function)?.arguments);
      if (replace && argumentsDelta) this.replaceArguments(tool, argumentsDelta);
      else this.appendArguments(tool, argumentsDelta);
    }
  }

  private validateToolArguments(argumentsState: ArgumentAccumulator): void {
    const json = this.readArguments(argumentsState).trim();
    if (!json) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      this.recordFailure(
        'malformed_tool_arguments_json',
        'upstream emitted malformed OpenAI Chat Completions tool arguments JSON'
      );
      return;
    }
    if (!asRecord(parsed)) {
      this.recordFailure(
        'malformed_tool_arguments_json',
        'upstream emitted non-object OpenAI Chat Completions tool arguments JSON'
      );
    }
  }
}

export function createIncrementalStreamingValidator(
  protocol: StreamingValidationProtocol,
  options: StreamingValidatorOptions = {}
): IncrementalStreamingValidator {
  if (protocol === 'anthropic') return new AnthropicStreamingValidator(protocol, options);
  if (protocol === 'openaiResponses') {
    return new OpenAiResponsesStreamingValidator(protocol, options);
  }
  return new OpenAiChatStreamingValidator(protocol, options);
}
