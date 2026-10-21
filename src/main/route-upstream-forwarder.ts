/**
 * 上游转发器
 * 输入: 已选定的上游目标、请求头/体、流式适配与校验选项
 * 输出: 上游响应（缓冲）或已写入下游的流式结果 + 用量
 * 定位: 服务层 - 单次上游尝试的传输、SSE 校验/规范化/协议转换与提交窗口
 */

import * as http from 'http';

import { URL } from 'url';

import { httpRawRequest, httpRawStreamRequest } from './utils/http-client';

import type { RouteCliType } from '../shared/types/route-proxy';
import { ROUTE_CLI_MARKER_HEADER } from '../shared/types/route-proxy';
import { isAnyRouterSite } from '../shared/types/site';

import { type AnyRouterResponseAdapter } from './anyrouter-request-rewriter';
import { type CliProtocolResponseAdapter } from './cli-protocol-adapter';
import {
  IncrementalProtocolSseTransformer,
  type StreamingProtocol,
} from './protocol-sse-transformer';
import {
  createIncrementalStreamingValidator,
  STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES,
  StreamingProtocolValidationError,
  type CompletedStreamValidation,
  type StreamingValidationProtocol,
} from './streaming-protocol-validator';

import { classifyRouteStatusCode } from './route-upstream-failure';
import {
  asRecord,
  inferSourceProtocol,
  normalizeHeaderValue,
  readString,
} from './route-proxy-shared';
import {
  extractUsageFromBody,
  extractUsageFromParsed,
  finalizeRouteUsage,
  type RouteUsageStats,
} from './route-usage';

export const EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE = 'empty_response_zero_usage';
const EMPTY_STREAMING_RESPONSE_ERROR = 'invalid_streaming_response:empty_streaming_response';
const ANYROUTER_REQUEST_TIMEOUT_MS = 120 * 1000;
const ACTIVE_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const INITIAL_STREAM_VALIDATION_MAX_BYTES = 4096;
const NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
/**
 * 原生 Anthropic 流的下游提交窗口。窗口内的上游截断可以丢弃缓冲并换通道重试，
 * 客户端无感；窗口一旦过去，已发出的字节无法撤回，只能靠可重试错误事件收尾。
 */
const NATIVE_ANTHROPIC_SSE_COMMIT_DELAY_MS = 3_000;
const NATIVE_ANTHROPIC_SSE_COMMIT_BYTES = 64 * 1024;
export const NATIVE_STREAM_MISSING_TERMINAL_ERROR =
  'incomplete_streaming_response:missing_terminal_event';
function deleteAuthHeaders(headers: Record<string, string | string[] | undefined>): void {
  for (const key of Object.keys(headers)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'authorization' || normalizedKey === 'x-api-key') {
      delete headers[key];
    }
  }
}

function compactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string | string[]] => {
      const value = entry[1];
      return typeof value === 'string' || Array.isArray(value);
    })
  );
}

function isEventStreamResponse(headers: http.IncomingHttpHeaders): boolean {
  return normalizeHeaderValue(headers['content-type']).toLowerCase().includes('text/event-stream');
}

export function isStreamingRequest(bodyJson: unknown, requestUrl: string | undefined): boolean {
  void requestUrl;
  const record = asRecord(bodyJson);
  if (record?.stream === true) return true;

  return false;
}

export function resolveUpstreamTimeouts(params: {
  siteName?: string;
  baseTimeoutMs: number;
  streamingRequest: boolean;
}): { timeoutMs: number; streamIdleTimeoutMs?: number } {
  const siteTimeoutMs =
    params.siteName && isAnyRouterSite(params.siteName)
      ? ANYROUTER_REQUEST_TIMEOUT_MS
      : params.baseTimeoutMs;

  if (!params.streamingRequest) {
    return { timeoutMs: siteTimeoutMs };
  }

  return {
    timeoutMs: siteTimeoutMs,
    streamIdleTimeoutMs: Math.max(siteTimeoutMs, ACTIVE_STREAM_IDLE_TIMEOUT_MS),
  };
}

export function canStreamResponseAdapters(
  anyRouterAdapter: AnyRouterResponseAdapter,
  protocolAdapters: CliProtocolResponseAdapter[]
): boolean {
  if (anyRouterAdapter.type !== 'transparent') return false;
  if (protocolAdapters.every(adapter => adapter.type === 'transparent')) return true;
  return getIncrementalProtocolResponseAdapter(protocolAdapters) !== null;
}

type SourceProtocolResponseAdapter = Extract<CliProtocolResponseAdapter, { type: 'source' }>;

export function getIncrementalProtocolResponseAdapter(
  protocolAdapters: CliProtocolResponseAdapter[]
): SourceProtocolResponseAdapter | null {
  if (protocolAdapters.length !== 1) return null;
  const adapter = protocolAdapters[0];
  return adapter.type === 'source' &&
    adapter.stream &&
    adapter.sourceProtocol !== undefined &&
    adapter.sourceProtocol !== adapter.targetProtocol
    ? adapter
    : null;
}

const ROUTE_PROXY_BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildRouteProxyResponseHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  const outgoing: http.OutgoingHttpHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || ROUTE_PROXY_BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    outgoing[key] = value;
  }

  return outgoing;
}

function buildStreamingResponseHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  return buildRouteProxyResponseHeaders(headers);
}

export function buildBufferedResponseHeaders(
  headers: http.IncomingHttpHeaders,
  body: Buffer
): http.OutgoingHttpHeaders {
  return {
    ...buildRouteProxyResponseHeaders(headers),
    'content-length': String(body.length),
  };
}

type InitialEventStreamValidation =
  | { status: 'accepted' }
  | { status: 'pending' }
  | { status: 'rejected'; reason: string };

type StreamingTerminalProtocol = StreamingValidationProtocol | 'none';

function getStreamingTerminalProtocolForWireProtocol(
  protocol: StreamingProtocol
): StreamingTerminalProtocol {
  if (protocol === 'anthropic-messages') return 'anthropic';
  if (protocol === 'openai-responses') return 'openaiResponses';
  return 'openaiChat';
}
interface ParsedSseBlock {
  event?: string;
  data: string;
}

interface StreamingSseObservationState {
  buffer: Buffer;
  errorSeen: boolean;
  failureCode?: string;
  nextSequenceNumber: number;
  terminalSeen: boolean;
}

interface AnthropicSseCompatibilityNormalizerState {
  decodeBlock: (block: Buffer) => string;
  frameBuffer: IncrementalSseFrameBuffer;
  openBlocks: Map<number, { type: string }>;
  completedToolBlocks: number;
}

export class NativeAnthropicSseGuardError extends Error {
  constructor(
    readonly reason: string,
    readonly protocolMessage: string
  ) {
    super(`malformed_streaming_response:${reason}`);
    this.name = 'NativeAnthropicSseGuardError';
  }
}

interface NativeAnthropicSseGuardState {
  buffer: Buffer;
  openBlocks: Set<number>;
  pendingFrames: Buffer[];
  pendingBytes: number;
  released: boolean;
  sawMessageStart: boolean;
}

function validateInitialEventStreamChunk(buffer: Buffer): InitialEventStreamValidation {
  if (!buffer.length) {
    return { status: 'pending' };
  }

  const text = buffer.toString('utf-8');
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed) {
    return buffer.length >= INITIAL_STREAM_VALIDATION_MAX_BYTES
      ? { status: 'rejected', reason: 'empty_initial_stream' }
      : { status: 'pending' };
  }

  const firstBytes = trimmed.slice(0, 256).toLowerCase();
  if (firstBytes.startsWith('<!doctype') || firstBytes.startsWith('<html') || trimmed[0] === '<') {
    return { status: 'rejected', reason: 'html_response' };
  }
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    return { status: 'rejected', reason: 'json_response' };
  }

  const hasCompleteLine = /\r?\n/.test(trimmed);
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  if (/^(?::|event\s*:|data\s*:|id\s*:|retry\s*:)/.test(firstLine.trimStart())) {
    return { status: 'accepted' };
  }

  if (hasCompleteLine) {
    return { status: 'rejected', reason: 'non_sse_response' };
  }

  return buffer.length >= INITIAL_STREAM_VALIDATION_MAX_BYTES
    ? { status: 'rejected', reason: 'non_sse_response' }
    : { status: 'pending' };
}

function getStreamingTerminalProtocol(requestUrl?: string): StreamingTerminalProtocol {
  const sourceProtocol = inferSourceProtocol(requestUrl);
  if (sourceProtocol === 'anthropic-messages') return 'anthropic';
  if (sourceProtocol === 'openai-responses') return 'openaiResponses';
  if (sourceProtocol === 'openai-chat-completions') return 'openaiChat';
  return 'none';
}

function buildStreamingErrorChunk(
  protocol: StreamingTerminalProtocol,
  message: string,
  sequenceNumber = 0,
  anthropicErrorType: 'api_error' | 'overloaded_error' = 'api_error'
): Buffer {
  if (protocol === 'anthropic') {
    return Buffer.from(
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: { type: anthropicErrorType, message },
      })}\n\n`,
      'utf-8'
    );
  }

  if (protocol === 'openaiResponses') {
    return Buffer.from(
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        code: 'upstream_stream_error',
        message,
        param: null,
        sequence_number: sequenceNumber,
      })}\n\n`,
      'utf-8'
    );
  }

  // 不补 [DONE]：它是成功终结标记，错误后补发会让客户端把截断的回答当作完整结果接受。
  return Buffer.from(
    `data: ${JSON.stringify({
      error: {
        message,
        type: 'server_error',
        code: 'upstream_stream_error',
        param: null,
      },
    })}\n\n`,
    'utf-8'
  );
}

export function parseSseBlocks(text: string): ParsedSseBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks: ParsedSseBlock[] = [];

  for (const block of normalized.split(/\n\n+/)) {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    let event: string | undefined;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    if (dataLines.length > 0) {
      blocks.push({ event, data: dataLines.join('\n').trim() });
    }
  }

  return blocks;
}

function hasNativeResponsesOutputBeforeFrameBoundary(chunk: Buffer): boolean {
  for (const block of parseSseBlocks(chunk.toString('utf-8'))) {
    const payload = parseSseJsonRecord(block.data);
    const eventType = readString(payload?.type) || block.event || '';
    if (eventType === 'response.output_text.delta' || eventType === 'response.output_text.done') {
      if (readString(payload?.delta).trim() || readString(payload?.text).trim()) return true;
    }
    if (
      eventType === 'response.function_call_arguments.delta' ||
      eventType === 'response.function_call_arguments.done'
    ) {
      if (readString(payload?.delta).trim() || readString(payload?.arguments).trim()) return true;
    }
  }
  return false;
}

function createStreamingSseObservationState(
  protocol: StreamingTerminalProtocol
): StreamingSseObservationState {
  return {
    buffer: Buffer.alloc(0),
    errorSeen: false,
    nextSequenceNumber: 0,
    terminalSeen: protocol === 'none',
  };
}

function observeStreamingSseBlock(
  state: StreamingSseObservationState,
  protocol: StreamingTerminalProtocol,
  block: ParsedSseBlock
): void {
  if (block.data === '[DONE]') {
    state.terminalSeen = true;
    return;
  }

  const payload = parseSseJsonRecord(block.data);
  const eventType = readString(payload?.type) || block.event || '';
  const sequenceNumber = payload?.sequence_number;
  if (
    typeof sequenceNumber === 'number' &&
    Number.isSafeInteger(sequenceNumber) &&
    sequenceNumber >= state.nextSequenceNumber
  ) {
    state.nextSequenceNumber = sequenceNumber + 1;
  }

  if (eventType === 'error' || asRecord(payload?.error)) {
    state.errorSeen = true;
    const response = asRecord(payload?.response);
    const error = asRecord(payload?.error) || asRecord(response?.error);
    state.failureCode =
      readString(error?.type) || readString(error?.code) || eventType || 'unknown_error';
    state.terminalSeen = true;
    return;
  }

  if (protocol === 'anthropic') {
    state.terminalSeen = state.terminalSeen || eventType === 'message_stop';
    return;
  }

  if (protocol === 'openaiResponses') {
    if (eventType === 'response.failed') {
      state.errorSeen = true;
      const response = asRecord(payload?.response);
      const error = asRecord(payload?.error) || asRecord(response?.error);
      state.failureCode =
        readString(error?.type) || readString(error?.code) || eventType || 'unknown_error';
    }
    state.terminalSeen =
      state.terminalSeen ||
      eventType === 'response.completed' ||
      eventType === 'response.failed' ||
      eventType === 'response.incomplete';
  }
}

function observeStreamingSseChunk(
  state: StreamingSseObservationState,
  protocol: StreamingTerminalProtocol,
  chunk: Buffer,
  flush = false
): void {
  if (chunk.length) {
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  }

  for (;;) {
    const frameEnd = findSseFrameEnd(state.buffer);
    if (frameEnd < 0) break;
    const frame = state.buffer.subarray(0, frameEnd);
    state.buffer = state.buffer.subarray(frameEnd);
    for (const block of parseSseBlocks(frame.toString('utf-8'))) {
      observeStreamingSseBlock(state, protocol, block);
    }
  }

  if (flush && state.buffer.length) {
    for (const block of parseSseBlocks(state.buffer.toString('utf-8'))) {
      observeStreamingSseBlock(state, protocol, block);
    }
    state.buffer = Buffer.alloc(0);
  }
}

function createAnthropicSseCompatibilityNormalizer(): AnthropicSseCompatibilityNormalizerState {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    decodeBlock: block => decoder.decode(block),
    frameBuffer: new IncrementalSseFrameBuffer(STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES),
    openBlocks: new Map(),
    completedToolBlocks: 0,
  };
}

function serializeSseBlock(event: string | undefined, data: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${data}\n\n`;
}

function normalizeAnthropicSseCompatibilityBlock(
  state: AnthropicSseCompatibilityNormalizerState,
  rawBlock: Buffer
): Buffer {
  let decodedBlock: string;
  try {
    decodedBlock = state.decodeBlock(rawBlock);
  } catch {
    return rawBlock;
  }
  const blocks = parseSseBlocks(decodedBlock);
  if (blocks.length !== 1 || !blocks[0].data || blocks[0].data === '[DONE]') {
    return rawBlock;
  }

  const block = blocks[0];
  const payload = parseSseJsonRecord(block.data);
  if (!payload) {
    return rawBlock;
  }

  const payloadType = readString(payload.type);
  const eventType = payloadType || block.event || '';

  if (eventType === 'content_block_start') {
    const index = readNumericIndex(payload.index);
    const contentBlock = asRecord(payload.content_block);
    const blockType = readString(contentBlock?.type);
    if (index !== undefined && blockType && !state.openBlocks.has(index)) {
      state.openBlocks.set(index, { type: blockType });
    }
    return rawBlock;
  }

  if (eventType === 'content_block_stop') {
    const index = readNumericIndex(payload.index);
    const blockState = index === undefined ? undefined : state.openBlocks.get(index);
    if (blockState?.type === 'tool_use') {
      state.completedToolBlocks += 1;
    }
    if (index !== undefined) {
      state.openBlocks.delete(index);
    }
    return rawBlock;
  }

  if (eventType !== 'message_delta' || state.completedToolBlocks === 0) {
    return rawBlock;
  }

  const delta = asRecord(payload.delta);
  if (readString(delta?.stop_reason) !== 'end_turn') {
    return rawBlock;
  }

  return Buffer.from(
    serializeSseBlock(
      block.event,
      JSON.stringify({
        ...payload,
        delta: {
          ...delta,
          stop_reason: 'tool_use',
        },
      })
    ),
    'utf-8'
  );
}

function normalizeAnthropicSseCompatibilityChunk(
  state: AnthropicSseCompatibilityNormalizerState,
  chunk: Buffer
): Buffer[] {
  return [...state.frameBuffer.push(chunk)].map(block =>
    normalizeAnthropicSseCompatibilityBlock(state, block)
  );
}

function flushAnthropicSseCompatibilityNormalizer(
  state: AnthropicSseCompatibilityNormalizerState
): Buffer {
  return state.frameBuffer.hasTail ? state.frameBuffer.takeTail() : Buffer.alloc(0);
}

export function parseSseJsonRecord(data: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function createNativeAnthropicSseGuard(): NativeAnthropicSseGuardState {
  return {
    buffer: Buffer.alloc(0),
    openBlocks: new Set(),
    pendingFrames: [],
    pendingBytes: 0,
    released: false,
    sawMessageStart: false,
  };
}

function findSseFrameEnd(buffer: Buffer): number {
  let previousWasLineEnding = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte !== 0x0a && byte !== 0x0d) {
      previousWasLineEnding = false;
      continue;
    }

    const lineEndingLength = byte === 0x0d && buffer[index + 1] === 0x0a ? 2 : 1;
    if (previousWasLineEnding) {
      return index + lineEndingLength;
    }

    previousWasLineEnding = true;
    index += lineEndingLength - 1;
  }

  return -1;
}

interface SseFrameBoundary {
  end: number;
  separatorStart: number;
}

function findValidatedSseFrameBoundary(buffer: Buffer, startIndex = 0): SseFrameBoundary | null {
  for (let index = Math.max(0, startIndex); index < buffer.length; index += 1) {
    const firstEndingBytes =
      buffer[index] === 0x0a
        ? 1
        : buffer[index] === 0x0d && buffer[index + 1] === 0x0a
          ? 2
          : buffer[index] === 0x0d
            ? 1
            : 0;
    if (!firstEndingBytes) continue;

    const nextIndex = index + firstEndingBytes;
    const secondEndingBytes =
      buffer[nextIndex] === 0x0a
        ? 1
        : buffer[nextIndex] === 0x0d && buffer[nextIndex + 1] === 0x0a
          ? 2
          : buffer[nextIndex] === 0x0d
            ? 1
            : 0;
    if (secondEndingBytes) {
      return { end: nextIndex + secondEndingBytes, separatorStart: index };
    }
    index += firstEndingBytes - 1;
  }
  return null;
}

class IncrementalSseFrameBuffer {
  private static readonly MAX_DELIMITER_BYTES = 4;
  private buffer = Buffer.alloc(0);
  private length = 0;
  private scanOffset = 0;

  constructor(private readonly maxFrameBytes: number) {}

  *push(chunk: Buffer): Generator<Buffer> {
    let chunkOffset = 0;

    while (chunkOffset < chunk.length) {
      this.ensureWritableCapacity();
      const copyBytes = Math.min(this.buffer.length - this.length, chunk.length - chunkOffset);
      chunk.copy(this.buffer, this.length, chunkOffset, chunkOffset + copyBytes);
      this.length += copyBytes;
      chunkOffset += copyBytes;

      yield* this.drainFrames();

      if (this.length >= this.maxBufferedBytes) {
        throw this.buildFrameTooLargeError();
      }
    }
  }

  takeTail(): Buffer {
    const tail = Buffer.from(this.buffer.subarray(0, this.length));
    this.length = 0;
    this.scanOffset = 0;
    return tail;
  }

  get hasTail(): boolean {
    return this.length > 0;
  }

  private get maxBufferedBytes(): number {
    return this.maxFrameBytes + IncrementalSseFrameBuffer.MAX_DELIMITER_BYTES;
  }

  private *drainFrames(): Generator<Buffer> {
    const frames: Buffer[] = [];
    let frameStart = 0;
    let searchOffset = this.scanOffset;

    for (;;) {
      const boundary = findValidatedSseFrameBoundary(
        this.buffer.subarray(0, this.length),
        searchOffset
      );
      if (!boundary) break;
      if (boundary.separatorStart - frameStart > this.maxFrameBytes) {
        throw this.buildFrameTooLargeError();
      }
      frames.push(Buffer.from(this.buffer.subarray(frameStart, boundary.end)));
      frameStart = boundary.end;
      searchOffset = boundary.end;
    }

    if (frameStart > 0) {
      this.buffer.copyWithin(0, frameStart, this.length);
      this.length -= frameStart;
    }
    this.scanOffset = Math.max(0, this.length - 3);
    yield* frames;
  }

  private ensureWritableCapacity(): void {
    if (this.length < this.buffer.length) return;
    if (this.length >= this.maxBufferedBytes) throw this.buildFrameTooLargeError();

    const nextCapacity = Math.min(
      this.maxBufferedBytes,
      Math.max(4096, this.buffer.length * 2, this.length + 1)
    );
    const nextBuffer = Buffer.allocUnsafe(nextCapacity);
    this.buffer.copy(nextBuffer, 0, 0, this.length);
    this.buffer = nextBuffer;
  }

  private buildFrameTooLargeError(): StreamingProtocolValidationError {
    return new StreamingProtocolValidationError(
      'sse_frame_too_large',
      'upstream emitted an SSE frame above the safety limit'
    );
  }
}

function buildNativeAnthropicSseGuardFailure(
  reason: string,
  message: string
): CompletedStreamValidation {
  return { ok: false, reason, message };
}

function validateNativeAnthropicSseFrame(
  state: NativeAnthropicSseGuardState,
  frame: Buffer
): CompletedStreamValidation & { releasesPending?: boolean } {
  const blocks = parseSseBlocks(frame.toString('utf-8'));
  if (blocks.length === 0 || !blocks[0].data || blocks[0].data === '[DONE]') {
    return { ok: true };
  }

  const block = blocks[0];
  const payload = parseSseJsonRecord(block.data);
  const eventType = readString(payload?.type) || block.event || '';
  if (!payload) {
    if (
      block.event &&
      !block.event.startsWith('content_block_') &&
      !block.event.startsWith('message_') &&
      block.event !== 'error'
    ) {
      return { ok: true };
    }
    return buildNativeAnthropicSseGuardFailure(
      'malformed_sse_json',
      'upstream emitted malformed Anthropic SSE JSON'
    );
  }

  if (eventType === 'message_start') {
    state.sawMessageStart = true;
    return { ok: true };
  }

  if (eventType === 'content_block_start') {
    const index = readNumericIndex(payload.index);
    const contentBlock = asRecord(payload.content_block);
    if (
      !state.sawMessageStart ||
      index === undefined ||
      !readString(contentBlock?.type) ||
      state.openBlocks.has(index)
    ) {
      return buildNativeAnthropicSseGuardFailure(
        'invalid_content_block_start',
        'upstream emitted invalid Anthropic content block start'
      );
    }

    state.openBlocks.add(index);
    return { ok: true, releasesPending: true };
  }

  if (eventType === 'content_block_delta') {
    const index = readNumericIndex(payload.index);
    if (index === undefined || !state.openBlocks.has(index) || !asRecord(payload.delta)) {
      return buildNativeAnthropicSseGuardFailure(
        'unexpected_content_block_delta',
        'upstream emitted Anthropic content delta without an open block'
      );
    }
    return { ok: true };
  }

  if (eventType === 'content_block_stop') {
    const index = readNumericIndex(payload.index);
    if (index === undefined || !state.openBlocks.delete(index)) {
      return buildNativeAnthropicSseGuardFailure(
        'unexpected_content_block_stop',
        'upstream emitted Anthropic content block stop without an open block'
      );
    }
    return { ok: true };
  }

  if (eventType === 'message_stop') {
    if (state.openBlocks.size > 0) {
      return buildNativeAnthropicSseGuardFailure(
        'unclosed_content_block',
        'upstream ended Claude Code stream with an unclosed content block'
      );
    }
    return { ok: true, releasesPending: true };
  }

  if (eventType === 'error') {
    return { ok: true, releasesPending: true };
  }

  return { ok: true };
}

function* processNativeAnthropicSseFrames(
  state: NativeAnthropicSseGuardState,
  frames: Buffer[]
): Generator<Buffer> {
  for (const frame of frames) {
    if (frame.length > NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES) {
      throw new NativeAnthropicSseGuardError(
        'sse_frame_too_large',
        'upstream emitted an Anthropic SSE frame above the safety limit'
      );
    }

    const validation = validateNativeAnthropicSseFrame(state, frame);
    if (!validation.ok) {
      throw new NativeAnthropicSseGuardError(validation.reason, validation.message);
    }

    if (state.released) {
      yield frame;
      continue;
    }

    state.pendingFrames.push(frame);
    state.pendingBytes += frame.length;
    if (state.pendingBytes > NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES) {
      throw new NativeAnthropicSseGuardError(
        'precommit_buffer_too_large',
        'upstream did not emit a valid Anthropic content block before the safety limit'
      );
    }

    if (validation.releasesPending) {
      state.released = true;
      const pendingFrames = state.pendingFrames;
      state.pendingFrames = [];
      state.pendingBytes = 0;
      yield* pendingFrames;
    }
  }
}

function* processNativeAnthropicSseGuardChunk(
  state: NativeAnthropicSseGuardState,
  chunk: Buffer
): Generator<Buffer> {
  state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  const frames: Buffer[] = [];

  for (;;) {
    const frameEnd = findSseFrameEnd(state.buffer);
    if (frameEnd < 0) break;
    frames.push(state.buffer.subarray(0, frameEnd));
    state.buffer = state.buffer.subarray(frameEnd);
  }

  if (state.buffer.length > NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES) {
    throw new NativeAnthropicSseGuardError(
      'sse_frame_too_large',
      'upstream emitted an Anthropic SSE frame above the safety limit'
    );
  }

  yield* processNativeAnthropicSseFrames(state, frames);
}

function* flushNativeAnthropicSseGuard(state: NativeAnthropicSseGuardState): Generator<Buffer> {
  const frames = state.buffer.length ? [state.buffer] : [];
  state.buffer = Buffer.alloc(0);
  yield* processNativeAnthropicSseFrames(state, frames);

  if (state.openBlocks.size > 0) {
    throw new NativeAnthropicSseGuardError(
      'unclosed_content_block',
      'upstream ended Claude Code stream with an unclosed content block'
    );
  }

  if (!state.released) {
    state.released = true;
    const pendingFrames = state.pendingFrames;
    state.pendingFrames = [];
    state.pendingBytes = 0;
    yield* pendingFrames;
  }
}

function readStreamingValidationMessage(error: unknown): string {
  return error instanceof NativeAnthropicSseGuardError ||
    error instanceof StreamingProtocolValidationError
    ? error.protocolMessage
    : 'upstream emitted an invalid streaming response';
}

function readNumericIndex(value: unknown): number | undefined {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

export function isRetryableEmptyStreamingResponse(error: unknown): boolean {
  return error instanceof Error && error.message === EMPTY_STREAMING_RESPONSE_ERROR;
}

function writeResponseChunk(res: http.ServerResponse, chunk: Buffer): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once('error', onError);

    try {
      if (res.write(chunk)) {
        cleanup();
        resolve();
        return;
      }
      res.once('drain', onDrain);
    } catch (error: unknown) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

type UpstreamAuthScheme = 'native' | 'bearer' | 'x-api-key';

export function buildUpstreamHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  targetHost: string,
  bodyLength: number,
  apiKey: string,
  cliType: RouteCliType,
  authScheme: UpstreamAuthScheme = 'native'
): Record<string, string | string[] | undefined> {
  void cliType;
  const forwardHeaders: Record<string, string | string[] | undefined> = {
    ...incomingHeaders,
    host: targetHost,
    'content-length': String(bodyLength),
  };

  deleteAuthHeaders(forwardHeaders);
  for (const headerName of Object.keys(forwardHeaders)) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      normalizedHeaderName === ROUTE_CLI_MARKER_HEADER ||
      normalizedHeaderName.startsWith('x-api-detect-') ||
      normalizedHeaderName.startsWith('x-grok-') ||
      (cliType !== 'claudeCode' &&
        (normalizedHeaderName === 'anthropic-version' || normalizedHeaderName === 'anthropic-beta'))
    ) {
      delete forwardHeaders[headerName];
    }
  }

  if (authScheme === 'bearer') {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  } else if (authScheme === 'x-api-key' || (authScheme === 'native' && cliType === 'claudeCode')) {
    forwardHeaders['x-api-key'] = apiKey;
  } else {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  }

  if (cliType === 'claudeCode' && !forwardHeaders['anthropic-version']) {
    forwardHeaders['anthropic-version'] = '2023-06-01';
  }

  return forwardHeaders;
}

export function buildUpstreamRequestUrl(
  targetBaseUrl: string,
  requestUrl: string | undefined,
  cliType: RouteCliType,
  upstreamModel: string | undefined,
  apiKey: string
): { url: string; host: string } {
  const target = new URL(targetBaseUrl);
  void cliType;
  void upstreamModel;
  void apiKey;
  const requestTarget = new URL(requestUrl || '/', 'http://127.0.0.1');
  const baseSegments = target.pathname.split('/').filter(Boolean);
  const requestSegments = requestTarget.pathname.split('/').filter(Boolean);
  let overlap = Math.min(baseSegments.length, requestSegments.length);
  while (
    overlap > 0 &&
    !baseSegments
      .slice(baseSegments.length - overlap)
      .every((segment, index) => segment === requestSegments[index])
  ) {
    overlap -= 1;
  }
  target.pathname = `/${[...baseSegments, ...requestSegments.slice(overlap)].join('/')}`;
  for (const [name, value] of requestTarget.searchParams) target.searchParams.set(name, value);
  target.hash = '';

  return {
    url: target.toString(),
    host: target.host,
  };
}

export interface ForwardToUpstreamOptions {
  upstreamProxyUrl?: string;
  additionalHeaders?: Record<string, string>;
  methodOverride?: string;
  requestUrlOverride?: string;
  upstreamCliType?: RouteCliType;
  upstreamAuthScheme?: 'bearer' | 'x-api-key';
  signal?: AbortSignal;
  streamResponse?: http.ServerResponse;
  streamResponseBody?: boolean;
  streamResponseAdapter?: SourceProtocolResponseAdapter;
  nativeResponsePassthrough?: boolean;
  streamIdleTimeoutMs?: number;
  beforeStreamCommit?: (bufferedBody: Buffer) => Promise<void>;
  onUpstreamAttempt?: () => void;
  onStreamCompletionDelivered?: () => void;
}

/** 转发请求到上游（不直接写 res，返回结果由调用者决定是否透传） */
export async function forwardToUpstream(
  req: http.IncomingMessage,
  targetBaseUrl: string,
  apiKey: string,
  bodyBuffer: Buffer,
  cliType: RouteCliType,
  timeoutMs: number,
  upstreamModel?: string,
  options: ForwardToUpstreamOptions = {}
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  latencyMs: number;
  firstByteLatencyMs?: number;
  usage?: RouteUsageStats;
  streamed?: boolean;
  semanticError?: typeof EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE;
  /** 原生 Anthropic 流已提交但上游未发终止事件；仅影响记账，不改变下游字节 */
  missingTerminalEvent?: boolean;
}> {
  const startTime = Date.now();
  const upstreamCliType = options.upstreamCliType ?? cliType;
  const requestUrl = options.requestUrlOverride ?? req.url;
  const target = buildUpstreamRequestUrl(
    targetBaseUrl,
    requestUrl,
    upstreamCliType,
    upstreamModel,
    apiKey
  );
  const forwardHeaders = buildUpstreamHeaders(
    req.headers,
    target.host,
    bodyBuffer.length,
    apiKey,
    upstreamCliType,
    options.upstreamAuthScheme === 'x-api-key'
      ? 'x-api-key'
      : options.upstreamAuthScheme === 'bearer'
        ? 'bearer'
        : upstreamCliType === 'claudeCode'
          ? 'x-api-key'
          : 'bearer'
  );

  // 合并额外的请求头（如 AnyRouter 改写添加的 anthropic-beta）
  if (options.additionalHeaders) {
    Object.assign(forwardHeaders, options.additionalHeaders);
  }

  const requestConfig = {
    method: options.methodOverride ?? req.method ?? 'GET',
    headers: compactHeaders(forwardHeaders),
    body: bodyBuffer,
    timeout: timeoutMs,
    proxyUrl: options.upstreamProxyUrl,
    preferElectronNet: true,
    signal: options.signal,
  };

  let streamed = false;
  let streamingStatusCode: number | undefined;
  let streamingHeaders: http.OutgoingHttpHeaders | undefined;
  let streamingRejectedBeforeBody: string | undefined;
  let receivedUpstreamStreamingChunk = false;
  const initialStreamingBuffer = Buffer.alloc(INITIAL_STREAM_VALIDATION_MAX_BYTES + 1);
  let initialStreamingBytes = 0;
  let pendingStreamingChunks: Buffer[] = [];
  let pendingStreamingBytes = 0;
  const streamingResponsePreview = Buffer.alloc(INITIAL_STREAM_VALIDATION_MAX_BYTES);
  let streamingResponsePreviewBytes = 0;
  const incrementalValidationBuffer = new IncrementalSseFrameBuffer(
    STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES
  );
  let initialStreamAccepted = false;
  const incrementalProtocolTransformer = options.streamResponseAdapter?.sourceProtocol
    ? new IncrementalProtocolSseTransformer({
        sourceProtocol: options.streamResponseAdapter.sourceProtocol,
        targetProtocol: options.streamResponseAdapter.targetProtocol,
        model: options.streamResponseAdapter.model,
      })
    : null;
  const streamingTerminalProtocol = incrementalProtocolTransformer
    ? getStreamingTerminalProtocolForWireProtocol(options.streamResponseAdapter!.sourceProtocol!)
    : getStreamingTerminalProtocol(requestUrl);
  const anthropicStreamNormalizer =
    !options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createAnthropicSseCompatibilityNormalizer()
      : null;
  const nativeAnthropicStreamGuard =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createNativeAnthropicSseGuard()
      : null;
  const incrementalStreamingValidator =
    streamingTerminalProtocol !== 'none' &&
    (!options.nativeResponsePassthrough || streamingTerminalProtocol === 'openaiResponses')
      ? createIncrementalStreamingValidator(streamingTerminalProtocol, {
          strict: !options.nativeResponsePassthrough,
          extractUsage: extractUsageFromParsed,
        })
      : null;
  const strictIncrementalValidation = Boolean(
    incrementalStreamingValidator && !options.nativeResponsePassthrough
  );
  const streamingObservation = createStreamingSseObservationState(streamingTerminalProtocol);
  let streamingErrorWritten = false;
  let streamingCompletionNotified = false;
  let streamingSemanticError: typeof EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE | undefined;
  const inspectNativeOpenAiResponsesBeforeCommit =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'openaiResponses';
  // 原生 Anthropic 是唯一没有增量校验器的透传组合，提交时机改由窗口控制。
  const nativeAnthropicDeferredCommit = Boolean(
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
  );
  let nativeAnthropicCommitTimer: NodeJS.Timeout | null = null;
  let nativeAnthropicCommitDeadlineReached = false;
  let nativeAnthropicMissingTerminal = false;
  // 定时器与 onChunk 是两条独立调用链，共用一条写入队列避免字节交错。
  let streamWriteChain: Promise<void> = Promise.resolve();
  const serializeStreamWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = streamWriteChain.then(operation);
    streamWriteChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  const clearNativeAnthropicCommitTimer = (): void => {
    if (!nativeAnthropicCommitTimer) return;
    clearTimeout(nativeAnthropicCommitTimer);
    nativeAnthropicCommitTimer = null;
  };
  const isStreamingErrorSeen = (): boolean =>
    streamingErrorWritten ||
    (incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().errorSeen
      : streamingObservation.errorSeen);
  const isStreamingTerminalSeen = (): boolean =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().terminalSeen
      : streamingObservation.terminalSeen;
  const getStreamingFailureCode = (): string | undefined =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().failureCode
      : streamingObservation.failureCode;
  const getStreamingNextSequenceNumber = (): number =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().nextSequenceNumber
      : streamingObservation.nextSequenceNumber;
  const isStreamingCompletionValidated = (): boolean => {
    const state = incrementalStreamingValidator?.getState();
    return Boolean(
      state?.terminalSeen && !state.errorSeen && state.completedValidation?.ok === true
    );
  };

  const writeStreamingError = async (
    message: string,
    anthropicErrorType: 'api_error' | 'overloaded_error' = 'api_error'
  ): Promise<void> => {
    if (
      !streamed ||
      isStreamingErrorSeen() ||
      options.streamResponse?.writableEnded ||
      options.streamResponse?.destroyed
    ) {
      return;
    }

    streamingErrorWritten = true;
    await writeResponseChunk(
      options.streamResponse!,
      buildStreamingErrorChunk(
        streamingTerminalProtocol,
        message,
        getStreamingNextSequenceNumber(),
        anthropicErrorType
      )
    );
  };

  const notifyStreamCompletionIfDelivered = (): void => {
    if (streamingCompletionNotified || streamingSemanticError) return;
    const state = incrementalStreamingValidator?.getState();
    const completionDelivered = options.nativeResponsePassthrough
      ? (state?.terminalSeen ?? streamingObservation.terminalSeen) &&
        !(state?.errorSeen ?? streamingObservation.errorSeen)
      : isStreamingCompletionValidated();
    if (!completionDelivered) return;
    streamingCompletionNotified = true;
    options.onStreamCompletionDelivered?.();
  };

  const appendStreamingPreview = (chunk: Buffer): void => {
    const previewBytesRemaining =
      INITIAL_STREAM_VALIDATION_MAX_BYTES - streamingResponsePreviewBytes;
    if (previewBytesRemaining > 0) {
      const previewBytes = Math.min(previewBytesRemaining, chunk.length);
      chunk.copy(streamingResponsePreview, streamingResponsePreviewBytes, 0, previewBytes);
      streamingResponsePreviewBytes += previewBytes;
    }
  };

  const commitPendingStreamingChunks = async (): Promise<void> => {
    // headersSent 守卫：预提交定时器是异步触发的，客户端取消或上游中止可能在
    // 定时器和此次调用之间已经把响应头发走——此时再 writeHead 会污染残响应。
    if (
      streamed ||
      streamingSemanticError ||
      !initialStreamAccepted ||
      !streamingStatusCode ||
      !streamingHeaders ||
      pendingStreamingChunks.length === 0 ||
      options.streamResponse?.headersSent
    ) {
      return;
    }

    if (options.beforeStreamCommit) {
      const bufferedBody =
        pendingStreamingChunks.length === 1
          ? pendingStreamingChunks[0]
          : Buffer.concat(pendingStreamingChunks, pendingStreamingBytes);
      await options.beforeStreamCommit(bufferedBody);
    }
    streamed = true;
    options.streamResponse!.writeHead(streamingStatusCode, streamingHeaders);
    const chunksToWrite = pendingStreamingChunks;
    pendingStreamingChunks = [];
    pendingStreamingBytes = 0;
    for (const pendingChunk of chunksToWrite) {
      await writeResponseChunk(options.streamResponse!, pendingChunk);
    }
    notifyStreamCompletionIfDelivered();
  };

  const shouldCommitNativeAnthropicWindow = (): boolean =>
    nativeAnthropicCommitDeadlineReached ||
    pendingStreamingBytes >= NATIVE_ANTHROPIC_SSE_COMMIT_BYTES ||
    pendingStreamingBytes >= NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES ||
    streamingObservation.terminalSeen ||
    streamingObservation.errorSeen;

  const ensureNativeAnthropicCommitTimer = (): void => {
    if (nativeAnthropicCommitTimer || nativeAnthropicCommitDeadlineReached || streamed) return;
    nativeAnthropicCommitTimer = setTimeout(() => {
      nativeAnthropicCommitTimer = null;
      nativeAnthropicCommitDeadlineReached = true;
      void serializeStreamWrite(() => commitPendingStreamingChunks()).catch(() => undefined);
    }, NATIVE_ANTHROPIC_SSE_COMMIT_DELAY_MS);
    nativeAnthropicCommitTimer.unref?.();
  };

  const queueOrWriteStreamingChunk = async (
    outgoingChunk: Buffer,
    deferCommit: boolean
  ): Promise<void> => {
    if (!streamingStatusCode || !streamingHeaders || !outgoingChunk.length) return;
    if (streamingSemanticError) return;
    appendStreamingPreview(outgoingChunk);

    if (streamed) {
      await writeResponseChunk(options.streamResponse!, outgoingChunk);
      notifyStreamCompletionIfDelivered();
      return;
    }

    pendingStreamingChunks.push(outgoingChunk);
    pendingStreamingBytes += outgoingChunk.length;
    const initialBytesRemaining = initialStreamingBuffer.length - initialStreamingBytes;
    if (initialBytesRemaining > 0) {
      const initialBytes = Math.min(initialBytesRemaining, outgoingChunk.length);
      outgoingChunk.copy(initialStreamingBuffer, initialStreamingBytes, 0, initialBytes);
      initialStreamingBytes += initialBytes;
    }
    const initialStreamingView = initialStreamingBuffer.subarray(0, initialStreamingBytes);
    const initialValidation = validateInitialEventStreamChunk(initialStreamingView);
    if (initialValidation.status === 'rejected') {
      throw new Error(`invalid_streaming_response:${initialValidation.reason}`);
    }
    if (initialValidation.status === 'pending') return;
    initialStreamAccepted = true;

    if (inspectNativeOpenAiResponsesBeforeCommit) {
      const state = incrementalStreamingValidator!.getState();
      const outputSeen =
        state.outputSeen || hasNativeResponsesOutputBeforeFrameBoundary(initialStreamingView);
      if (state.terminalSeen && !state.errorSeen && state.explicitZeroUsage && !outputSeen) {
        streamingSemanticError = EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE;
        pendingStreamingChunks = [];
        pendingStreamingBytes = 0;
        return;
      }
      if (
        !outputSeen &&
        !state.terminalSeen &&
        pendingStreamingBytes < NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES
      ) {
        return;
      }
    }

    if (nativeAnthropicDeferredCommit && !shouldCommitNativeAnthropicWindow()) {
      ensureNativeAnthropicCommitTimer();
      return;
    }

    if (deferCommit && pendingStreamingBytes < NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES) {
      return;
    }
    await commitPendingStreamingChunks();
  };

  const validateOutgoingFrame = async (frame: Buffer): Promise<void> => {
    try {
      incrementalStreamingValidator!.push(frame);
      const completedValidation = incrementalStreamingValidator!.getState().completedValidation;
      if (completedValidation && !completedValidation.ok) {
        throw new StreamingProtocolValidationError(
          completedValidation.reason,
          completedValidation.message
        );
      }
    } catch (error: unknown) {
      if (streamed && error instanceof StreamingProtocolValidationError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  };

  const processStreamingOutgoingChunks = async (
    outgoingChunks: Iterable<Buffer>
  ): Promise<void> => {
    for (const outgoingChunk of outgoingChunks) {
      if (!streamingStatusCode || !streamingHeaders || !outgoingChunk.length) continue;

      if (strictIncrementalValidation) {
        try {
          for (const frame of incrementalValidationBuffer.push(outgoingChunk)) {
            await validateOutgoingFrame(frame);
            await queueOrWriteStreamingChunk(frame, true);
          }
        } catch (error: unknown) {
          if (streamed && error instanceof StreamingProtocolValidationError) {
            await writeStreamingError(readStreamingValidationMessage(error));
          }
          throw error;
        }
        if (
          !streamed &&
          initialStreamAccepted &&
          pendingStreamingBytes >= NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES
        ) {
          await commitPendingStreamingChunks();
        }
        continue;
      }

      if (incrementalStreamingValidator) {
        incrementalStreamingValidator.push(outgoingChunk);
      } else {
        observeStreamingSseChunk(streamingObservation, streamingTerminalProtocol, outgoingChunk);
      }
      await queueOrWriteStreamingChunk(outgoingChunk, false);
    }

    if (strictIncrementalValidation) {
      await commitPendingStreamingChunks();
    }
  };

  let response: Awaited<ReturnType<typeof httpRawRequest>>;
  try {
    options.onUpstreamAttempt?.();
    response =
      options.streamResponse && options.streamResponseBody
        ? await httpRawStreamRequest(target.url, {
            ...requestConfig,
            ...(!options.nativeResponsePassthrough ? { retainStreamedBody: false } : {}),
            onResponse: upstreamResponse => {
              const statusCode = upstreamResponse.status || 500;
              if (classifyRouteStatusCode(statusCode) !== 'success') return false;
              if (!isEventStreamResponse(upstreamResponse.headers)) {
                streamingRejectedBeforeBody = 'unexpected_content_type';
                return false;
              }

              streamingStatusCode = statusCode;
              streamingHeaders = buildStreamingResponseHeaders(upstreamResponse.headers);
              return true;
            },
            onChunk: async chunk => {
              if (!streamingStatusCode || !streamingHeaders || !chunk.length) return;
              receivedUpstreamStreamingChunk = true;
              try {
                const outgoingChunks = incrementalProtocolTransformer
                  ? incrementalProtocolTransformer.transform(chunk)
                  : nativeAnthropicStreamGuard
                    ? processNativeAnthropicSseGuardChunk(nativeAnthropicStreamGuard, chunk)
                    : anthropicStreamNormalizer
                      ? normalizeAnthropicSseCompatibilityChunk(anthropicStreamNormalizer, chunk)
                      : [chunk];
                await serializeStreamWrite(() => processStreamingOutgoingChunks(outgoingChunks));
              } catch (error: unknown) {
                if (streamed && error instanceof NativeAnthropicSseGuardError) {
                  await writeStreamingError(readStreamingValidationMessage(error));
                }
                throw error;
              }
            },
            streamIdleTimeout: options.streamIdleTimeoutMs,
            shouldResolveOnAbort: () =>
              !options.nativeResponsePassthrough && streamed && isStreamingCompletionValidated(),
          })
        : await httpRawRequest(target.url, requestConfig);
  } catch (error: unknown) {
    clearNativeAnthropicCommitTimer();
    if (!incrementalStreamingValidator) {
      observeStreamingSseChunk(
        streamingObservation,
        streamingTerminalProtocol,
        Buffer.alloc(0),
        true
      );
    }
    const upstreamFailureCode = getStreamingFailureCode();
    if (upstreamFailureCode) {
      throw new Error(`upstream_streaming_error:${upstreamFailureCode}`);
    }
    if (
      streamed &&
      !options.signal?.aborted &&
      !isStreamingErrorSeen() &&
      !isStreamingTerminalSeen()
    ) {
      await writeStreamingError('upstream stream terminated unexpectedly');
    }
    throw error;
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    !receivedUpstreamStreamingChunk
  ) {
    throw new Error(EMPTY_STREAMING_RESPONSE_ERROR);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    anthropicStreamNormalizer
  ) {
    await processStreamingOutgoingChunks([
      flushAnthropicSseCompatibilityNormalizer(anthropicStreamNormalizer),
    ]);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    nativeAnthropicStreamGuard
  ) {
    try {
      await processStreamingOutgoingChunks(
        flushNativeAnthropicSseGuard(nativeAnthropicStreamGuard)
      );
    } catch (error: unknown) {
      // 该路径此前缺失定时器清理：guard 抛错触发故障转移后，废弃尝试的
      // 预提交定时器可能仍然存活，把旧通道的缓冲字节写进共享响应。
      clearNativeAnthropicCommitTimer();
      if (streamed && error instanceof NativeAnthropicSseGuardError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  // 原生 Anthropic 收尾：窗口内截断丢弃缓冲交给下一个通道，窗口外截断只能补一个可重试错误。
  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    nativeAnthropicDeferredCommit
  ) {
    clearNativeAnthropicCommitTimer();
    observeStreamingSseChunk(
      streamingObservation,
      streamingTerminalProtocol,
      Buffer.alloc(0),
      true
    );

    if (streamingObservation.terminalSeen || streamingObservation.errorSeen) {
      // 流已完整或上游已明确报错：不再等窗口到期。
      await serializeStreamWrite(() => commitPendingStreamingChunks());
    } else if (!streamed) {
      pendingStreamingChunks = [];
      pendingStreamingBytes = 0;
      throw new Error(NATIVE_STREAM_MISSING_TERMINAL_ERROR);
    } else {
      // 字节已发出无法撤回：补一个官方定义的可重试错误，让客户端换通道重来。
      nativeAnthropicMissingTerminal = true;
      await serializeStreamWrite(() =>
        writeStreamingError('upstream stream ended before terminal SSE event', 'overloaded_error')
      );
    }
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    incrementalProtocolTransformer
  ) {
    try {
      await processStreamingOutgoingChunks(incrementalProtocolTransformer.finish());
    } catch (error: unknown) {
      const upstreamFailureCode = getStreamingFailureCode();
      if (upstreamFailureCode) {
        throw new Error(`upstream_streaming_error:${upstreamFailureCode}`);
      }
      if (
        streamed &&
        !options.signal?.aborted &&
        !isStreamingErrorSeen() &&
        !isStreamingTerminalSeen()
      ) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  if (strictIncrementalValidation && incrementalValidationBuffer.hasTail) {
    const tail = incrementalValidationBuffer.takeTail();
    try {
      incrementalStreamingValidator!.push(tail);
    } catch (error: unknown) {
      if (streamed && error instanceof StreamingProtocolValidationError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  const completedStreamingValidation =
    streamingStatusCode !== undefined ? incrementalStreamingValidator?.finish() : undefined;
  if (streamingStatusCode !== undefined && !incrementalStreamingValidator) {
    observeStreamingSseChunk(
      streamingObservation,
      streamingTerminalProtocol,
      Buffer.alloc(0),
      true
    );
  }

  const upstreamStreamingFailureCode = getStreamingFailureCode();

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamed &&
    upstreamStreamingFailureCode
  ) {
    throw new Error(`upstream_streaming_error:${upstreamStreamingFailureCode}`);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    completedStreamingValidation &&
    !completedStreamingValidation.ok &&
    !(options.nativeResponsePassthrough && streamingSemanticError && !streamed)
  ) {
    const missingTerminal = [
      'missing_message_stop',
      'missing_response_terminal',
      'missing_chat_done',
    ].includes(completedStreamingValidation.reason);
    const preservesNativeZeroUsageReason =
      options.nativeResponsePassthrough &&
      streamingTerminalProtocol === 'openaiResponses' &&
      completedStreamingValidation.reason === 'empty_response_zero_usage';
    const error = missingTerminal
      ? 'incomplete_streaming_response:missing_terminal_event'
      : preservesNativeZeroUsageReason
        ? 'empty_response_zero_usage'
        : `malformed_streaming_response:${completedStreamingValidation.reason}`;
    await writeStreamingError(
      missingTerminal
        ? 'upstream stream ended before terminal SSE event'
        : completedStreamingValidation.message
    );
    throw new Error(error);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    classifyRouteStatusCode(response.status || 500) === 'success' &&
    !streamed
  ) {
    if (streamingRejectedBeforeBody) {
      throw new Error(`invalid_streaming_response:${streamingRejectedBeforeBody}`);
    }

    const validation = validateInitialEventStreamChunk(response.body);
    if (validation.status !== 'accepted') {
      const reason =
        validation.status === 'rejected'
          ? validation.reason
          : response.body.length
            ? 'malformed_sse_response'
            : 'empty_streaming_response';
      throw new Error(`invalid_streaming_response:${reason}`);
    }
  }

  const streamedUsage =
    streamed && incrementalStreamingValidator && !options.nativeResponsePassthrough
      ? finalizeRouteUsage(incrementalStreamingValidator.getUsage())
      : undefined;
  const responseBody =
    streamed && incrementalStreamingValidator && !options.nativeResponsePassthrough
      ? streamingResponsePreview.subarray(0, streamingResponsePreviewBytes)
      : response.body;

  clearNativeAnthropicCommitTimer();

  return {
    statusCode: response.status || 500,
    headers: response.headers,
    body: responseBody,
    latencyMs: Date.now() - startTime,
    firstByteLatencyMs: response.firstByteLatencyMs,
    usage: streamedUsage ?? extractUsageFromBody(response.body),
    streamed,
    semanticError: streamingSemanticError,
    missingTerminalEvent: nativeAnthropicMissingTerminal,
  };
}
