/**
 * 输入: 路由代理收到的源 CLI 请求体 + 目标协议元数据
 * 输出: 改写后的上游请求体 + 响应回写适配器，支持 text/tool_use/tool_result 三类内容的双向转换
 * 定位: 服务层 - 在 Claude Code / Codex / Gemini CLI 原生协议与 Anthropic Messages / OpenAI Chat Completions / OpenAI Responses 上游协议之间桥接
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { randomUUID } from 'crypto';
import type { CliTargetProtocol } from '../shared/types/cli-config';
import type { RouteCliType } from '../shared/types/route-proxy';

type JsonRecord = Record<string, unknown>;

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface NormalizedTool {
  name: string;
  description?: string;
  parameters?: JsonRecord;
}

interface NormalizedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

interface NormalizedToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

type NormalizedPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; toolCall: NormalizedToolCall }
  | { kind: 'tool_result'; toolResult: NormalizedToolResult };

type NormalizedRole = 'system' | 'user' | 'assistant';

interface NormalizedMessage {
  role: NormalizedRole;
  parts: NormalizedPart[];
}

interface NormalizedRequest {
  model: string;
  stream: boolean;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: unknown;
}

type NormalizedFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

interface NormalizedResponse {
  text: string;
  textDeltas: string[];
  toolCalls: NormalizedToolCall[];
  usage: UsageShape;
  finishReason?: NormalizedFinishReason;
}

export type CliProtocolResponseAdapter =
  | { type: 'transparent' }
  | {
      type: 'source';
      sourceCliType: RouteCliType;
      targetProtocol: Exclude<CliTargetProtocol, 'native'>;
      model: string;
      stream: boolean;
    };

export interface CliProtocolRewriteResult {
  body: Buffer;
  headers: Record<string, string>;
  upstreamMethod: 'POST';
  upstreamPath: string;
  /**
   * 上游传输形态指示符（鉴权头 + 是否走 Gemini 路径改写）。
   * - 'claudeCode' → 上游用 `x-api-key`，路径透传
   * - 'codex'      → 上游用 `Authorization: Bearer`，路径透传
   * - 'geminiCli'  → 上游用 `x-goog-api-key`/`?key=`，路径需 `buildGeminiUpstreamPath` 改写
   * 当前 adapter 永远不会输出 geminiCli（目标协议都基于 Anthropic / OpenAI 系），
   * 因此 openai-chat-completions/openai-responses 复用 codex 的 Bearer 鉴权位。
   */
  upstreamCliType: RouteCliType;
  responseAdapter: CliProtocolResponseAdapter;
}

interface ResponseTransformResult {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export type CliProtocolAdapterStage = 'request-adapt' | 'response-adapt';

export interface CliProtocolAdapterErrorContext {
  stage: CliProtocolAdapterStage;
  sourceCliType: RouteCliType;
  targetProtocol: Exclude<CliTargetProtocol, 'native'>;
  reason: string;
}

export class CliProtocolAdapterError extends Error {
  readonly stage: CliProtocolAdapterStage;
  readonly sourceCliType: RouteCliType;
  readonly targetProtocol: Exclude<CliTargetProtocol, 'native'>;
  readonly reason: string;

  constructor(context: CliProtocolAdapterErrorContext) {
    super(
      `cli-protocol-adapter ${context.stage} failed: ${context.reason} ` +
        `(source=${context.sourceCliType}, target=${context.targetProtocol})`
    );
    this.name = 'CliProtocolAdapterError';
    this.stage = context.stage;
    this.sourceCliType = context.sourceCliType;
    this.targetProtocol = context.targetProtocol;
    this.reason = context.reason;
  }
}

/* ============================== Utilities ============================== */

function normalizeObject(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function stripUndefined(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value === '[undefined]' ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value.map(stripUndefined).filter(item => item !== undefined);
  }
  const result: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    const cleaned = stripUndefined(item);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

function parseJsonBody(body: Buffer): JsonRecord | null {
  try {
    return normalizeObject(stripUndefined(JSON.parse(body.toString('utf-8'))));
  } catch {
    return null;
  }
}

function stringifyArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function parseArgumentsObject(jsonString: string): JsonRecord {
  if (!jsonString) return {};
  try {
    const parsed = JSON.parse(jsonString);
    return normalizeObject(parsed);
  } catch {
    return {};
  }
}

function genToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function genMessageId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function normalizeUsage(usage: JsonRecord | undefined): UsageShape {
  if (!usage) return {};
  const inputTokens = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.promptTokenCount
  );
  const outputTokens = Number(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.candidatesTokenCount
  );
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount);
  return {
    ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
    ...(Number.isFinite(totalTokens) ? { totalTokens } : {}),
  };
}

function mergeUsage(left: UsageShape, right: UsageShape): UsageShape {
  return {
    inputTokens: right.inputTokens ?? left.inputTokens,
    outputTokens: right.outputTokens ?? left.outputTokens,
    totalTokens: right.totalTokens ?? left.totalTokens,
  };
}

function parseSseJsonPayloads(body: Buffer): JsonRecord[] {
  const payloads: JsonRecord[] = [];
  const text = body.toString('utf-8').replace(/\r\n/g, '\n');
  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    try {
      payloads.push(normalizeObject(JSON.parse(data)));
    } catch {
      /* ignore malformed payloads */
    }
  }
  return payloads;
}

function deleteHeader(headers: Record<string, string | string[] | undefined>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  }
}

function replaceResponseBody(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  contentType: string
): ResponseTransformResult {
  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers };
  deleteHeader(nextHeaders, 'content-length');
  deleteHeader(nextHeaders, 'transfer-encoding');
  deleteHeader(nextHeaders, 'content-encoding');
  nextHeaders['content-type'] = contentType;
  nextHeaders['content-length'] = String(body.length);
  return { body, headers: nextHeaders };
}

function sseEvent(event: string | null, data: unknown): string {
  const prefix = event ? `event: ${event}\n` : '';
  return `${prefix}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function throwUnsupported(
  reason: string,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>,
  stage: CliProtocolAdapterStage = 'request-adapt'
): never {
  throw new CliProtocolAdapterError({ stage, sourceCliType, targetProtocol, reason });
}

/* ============================== Tool Definition Mappers ============================== */

function mapTools(
  rawTools: unknown,
  mapper: (tool: unknown) => NormalizedTool | null
): NormalizedTool[] | undefined {
  if (!Array.isArray(rawTools)) return undefined;
  const tools = rawTools.map(mapper).filter(Boolean) as NormalizedTool[];
  return tools.length > 0 ? tools : undefined;
}

function mapClaudeTool(tool: unknown): NormalizedTool | null {
  const record = normalizeObject(tool);
  const name = normalizeText(record.name);
  if (!name) return null;
  return {
    name,
    description: normalizeText(record.description) || undefined,
    parameters: normalizeObject(record.input_schema),
  };
}

function mapCodexTool(tool: unknown): NormalizedTool | null {
  const record = normalizeObject(tool);
  if (record.type === 'function') {
    const fn = normalizeObject(record.function);
    const name = normalizeText(fn.name) || normalizeText(record.name);
    if (!name) return null;
    return {
      name,
      description: normalizeText(fn.description) || normalizeText(record.description) || undefined,
      parameters: normalizeObject(Object.keys(fn).length > 0 ? fn.parameters : record.parameters),
    };
  }
  const name = normalizeText(record.name);
  if (!name) return null;
  return {
    name,
    description: normalizeText(record.description) || undefined,
    parameters: normalizeObject(record.parameters),
  };
}

function mapGeminiTools(tools: unknown): NormalizedTool[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const result: NormalizedTool[] = [];
  for (const tool of tools) {
    const record = normalizeObject(tool);
    const declarations = Array.isArray(record.functionDeclarations)
      ? record.functionDeclarations
      : [];
    for (const declaration of declarations) {
      const item = normalizeObject(declaration);
      const name = normalizeText(item.name);
      if (!name) continue;
      result.push({
        name,
        description: normalizeText(item.description) || undefined,
        parameters: normalizeObject(item.parameters),
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

/* ============================== Source Request Parsers ============================== */

function parseClaudeTextOrError(
  part: JsonRecord,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>
): string {
  const kind = normalizeText(part.type);
  if (kind === 'text' || kind === '') {
    return normalizeText(part.text);
  }
  if (kind === 'thinking' || kind === 'redacted_thinking') {
    return '';
  }
  if (kind === 'image' || kind === 'document') {
    throwUnsupported(`unsupported_content:${kind}`, sourceCliType, targetProtocol);
  }
  return normalizeText(part.text);
}

function parseClaudeMessageContent(
  content: unknown,
  role: NormalizedRole,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>
): NormalizedPart[] {
  if (typeof content === 'string') {
    return content ? [{ kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts: NormalizedPart[] = [];
  for (const raw of content) {
    if (typeof raw === 'string') {
      if (raw) parts.push({ kind: 'text', text: raw });
      continue;
    }
    const record = normalizeObject(raw);
    const kind = normalizeText(record.type);
    if (kind === 'tool_use') {
      if (role !== 'assistant') {
        // Claude only emits tool_use on assistant; ignore stray
        continue;
      }
      const id = normalizeText(record.id) || genToolCallId();
      const name = normalizeText(record.name);
      if (!name) continue;
      parts.push({
        kind: 'tool_call',
        toolCall: { id, name, argumentsJson: stringifyArguments(record.input ?? {}) },
      });
      continue;
    }
    if (kind === 'tool_result') {
      const toolCallId = normalizeText(record.tool_use_id) || normalizeText(record.id) || '';
      const innerContent = record.content;
      let text = '';
      if (typeof innerContent === 'string') {
        text = innerContent;
      } else if (Array.isArray(innerContent)) {
        text = innerContent
          .map(item => parseClaudeTextOrError(normalizeObject(item), sourceCliType, targetProtocol))
          .filter(Boolean)
          .join('\n');
      }
      parts.push({
        kind: 'tool_result',
        toolResult: {
          toolCallId,
          content: text,
          ...(record.is_error === true ? { isError: true } : {}),
        },
      });
      continue;
    }
    const text = parseClaudeTextOrError(record, sourceCliType, targetProtocol);
    if (text) parts.push({ kind: 'text', text });
  }
  return parts;
}

function parseClaudeRequest(
  cleaned: JsonRecord,
  upstreamModel: string | undefined,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>
): NormalizedRequest {
  const messages: NormalizedMessage[] = [];

  const systemRaw = cleaned.system;
  if (typeof systemRaw === 'string' && systemRaw.trim()) {
    messages.push({ role: 'system', parts: [{ kind: 'text', text: systemRaw }] });
  } else if (Array.isArray(systemRaw)) {
    const text = systemRaw
      .map(item => parseClaudeTextOrError(normalizeObject(item), sourceCliType, targetProtocol))
      .filter(Boolean)
      .join('\n');
    if (text) messages.push({ role: 'system', parts: [{ kind: 'text', text }] });
  }

  for (const msg of Array.isArray(cleaned.messages) ? cleaned.messages : []) {
    const record = normalizeObject(msg);
    const role: NormalizedRole = normalizeText(record.role) === 'assistant' ? 'assistant' : 'user';
    const parts = parseClaudeMessageContent(record.content, role, sourceCliType, targetProtocol);
    if (parts.length === 0) continue;
    messages.push({ role, parts });
  }

  return {
    model: upstreamModel || normalizeText(cleaned.model),
    stream: cleaned.stream === true,
    messages,
    tools: mapTools(cleaned.tools, mapClaudeTool),
    maxOutputTokens: toFiniteNumber(cleaned.max_tokens),
    temperature: toFiniteNumber(cleaned.temperature),
    topP: toFiniteNumber(cleaned.top_p),
    stop: cleaned.stop_sequences ?? cleaned.stop,
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseCodexInstructions(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => parseCodexInstructions(item))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    const record = value as JsonRecord;
    const direct = normalizeText(record.text ?? record.input_text ?? record.output_text);
    if (direct) return direct;
    if (Array.isArray(record.content)) return parseCodexInstructions(record.content);
    if (Array.isArray(record.parts)) return parseCodexInstructions(record.parts);
    return '';
  }
  return normalizeText(value);
}

function parseCodexInputContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return normalizeText(content);
  return content
    .map(part => {
      const record = normalizeObject(part);
      const kind = normalizeText(record.type);
      if (kind === 'input_text' || kind === 'output_text' || kind === 'text' || kind === '') {
        return normalizeText(record.text);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseCodexRequest(
  cleaned: JsonRecord,
  upstreamModel: string | undefined,
  _sourceCliType: RouteCliType,
  _targetProtocol: Exclude<CliTargetProtocol, 'native'>
): NormalizedRequest {
  const messages: NormalizedMessage[] = [];
  const instructions = parseCodexInstructions(cleaned.instructions);
  if (instructions) {
    messages.push({ role: 'system', parts: [{ kind: 'text', text: instructions }] });
  }

  const inputs = cleaned.input;
  if (typeof inputs === 'string' && inputs) {
    messages.push({ role: 'user', parts: [{ kind: 'text', text: inputs }] });
  } else if (Array.isArray(inputs)) {
    for (const raw of inputs) {
      const record = normalizeObject(raw);
      const itemType = normalizeText(record.type);
      if (
        itemType === 'function_call' ||
        (!itemType && record.name && record.arguments !== undefined)
      ) {
        const id = normalizeText(record.call_id) || normalizeText(record.id) || genToolCallId();
        const name = normalizeText(record.name);
        if (!name) continue;
        messages.push({
          role: 'assistant',
          parts: [
            {
              kind: 'tool_call',
              toolCall: { id, name, argumentsJson: stringifyArguments(record.arguments) },
            },
          ],
        });
        continue;
      }
      if (itemType === 'function_call_output') {
        const toolCallId = normalizeText(record.call_id) || normalizeText(record.id) || '';
        const output =
          typeof record.output === 'string' ? record.output : stringifyArguments(record.output);
        messages.push({
          role: 'user',
          parts: [{ kind: 'tool_result', toolResult: { toolCallId, content: output } }],
        });
        continue;
      }
      // message item
      const role: NormalizedRole =
        normalizeText(record.role) === 'assistant' ? 'assistant' : 'user';
      const text = parseCodexInputContent(record.content ?? record.input ?? record);
      if (text) {
        messages.push({ role, parts: [{ kind: 'text', text }] });
      }
    }
  } else if (inputs !== undefined && inputs !== null) {
    const text = parseCodexInputContent(inputs);
    if (text) messages.push({ role: 'user', parts: [{ kind: 'text', text }] });
  }

  return {
    model: upstreamModel || normalizeText(cleaned.model),
    stream: cleaned.stream === true,
    messages,
    tools: mapTools(cleaned.tools, mapCodexTool),
    maxOutputTokens:
      toFiniteNumber(cleaned.max_output_tokens) ?? toFiniteNumber(cleaned.max_tokens),
    temperature: toFiniteNumber(cleaned.temperature),
    topP: toFiniteNumber(cleaned.top_p),
    stop: cleaned.stop,
  };
}

function parseGeminiParts(
  parts: unknown,
  role: NormalizedRole,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>
): NormalizedPart[] {
  if (!Array.isArray(parts)) return [];
  const result: NormalizedPart[] = [];
  for (const raw of parts) {
    const record = normalizeObject(raw);
    if (record.functionCall !== undefined) {
      const call = normalizeObject(record.functionCall);
      const name = normalizeText(call.name);
      if (!name) continue;
      const id = normalizeText(call.id) || genToolCallId();
      result.push({
        kind: 'tool_call',
        toolCall: { id, name, argumentsJson: stringifyArguments(call.args) },
      });
      continue;
    }
    if (record.functionResponse !== undefined) {
      const resp = normalizeObject(record.functionResponse);
      const name = normalizeText(resp.name);
      const toolCallId = normalizeText(resp.id) || name || '';
      const content =
        typeof resp.response === 'string' ? resp.response : stringifyArguments(resp.response);
      result.push({
        kind: 'tool_result',
        toolResult: { toolCallId, content },
      });
      continue;
    }
    if (record.text !== undefined) {
      const text = normalizeText(record.text);
      if (text) result.push({ kind: 'text', text });
      continue;
    }
    if (record.inlineData !== undefined || record.fileData !== undefined) {
      throwUnsupported('unsupported_content:gemini_media', sourceCliType, targetProtocol);
    }
    // unknown part type: ignore quietly to mirror Claude/Codex unknown-part tolerance
  }
  if (role === 'user') {
    // tool_call from user is illegal; demote to noop
    return result.filter(part => part.kind !== 'tool_call');
  }
  if (role === 'assistant') {
    return result.filter(part => part.kind !== 'tool_result');
  }
  return result;
}

function parseGeminiRequest(
  cleaned: JsonRecord,
  upstreamModel: string | undefined,
  requestUrl: string | undefined,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>
): NormalizedRequest {
  const messages: NormalizedMessage[] = [];
  const systemInstruction = normalizeObject(cleaned.systemInstruction);
  const systemText = (
    Array.isArray(systemInstruction.parts)
      ? systemInstruction.parts
          .map(part => normalizeText(normalizeObject(part).text))
          .filter(Boolean)
          .join('\n')
      : normalizeText(cleaned.systemInstruction)
  ).trim();
  if (systemText) {
    messages.push({ role: 'system', parts: [{ kind: 'text', text: systemText }] });
  }

  for (const content of Array.isArray(cleaned.contents) ? cleaned.contents : []) {
    const record = normalizeObject(content);
    const role: NormalizedRole = record.role === 'model' ? 'assistant' : 'user';
    const parts = parseGeminiParts(record.parts, role, sourceCliType, targetProtocol);
    if (parts.length === 0) continue;
    messages.push({ role, parts });
  }

  const generationConfig = normalizeObject(cleaned.generationConfig);
  return {
    model: upstreamModel || normalizeText(cleaned.model),
    stream: Boolean(requestUrl?.includes(':streamGenerateContent') || cleaned.stream === true),
    messages,
    tools: mapGeminiTools(cleaned.tools),
    maxOutputTokens: toFiniteNumber(generationConfig.maxOutputTokens),
    temperature: toFiniteNumber(generationConfig.temperature),
    topP: toFiniteNumber(generationConfig.topP),
    stop: generationConfig.stopSequences,
  };
}

function normalizeSourceRequest(
  bodyBuffer: Buffer,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>,
  requestUrl: string | undefined,
  upstreamModel: string | undefined
): NormalizedRequest | null {
  const cleaned = parseJsonBody(bodyBuffer);
  if (!cleaned) return null;
  if (sourceCliType === 'claudeCode') {
    return parseClaudeRequest(cleaned, upstreamModel, sourceCliType, targetProtocol);
  }
  if (sourceCliType === 'geminiCli') {
    return parseGeminiRequest(cleaned, upstreamModel, requestUrl, sourceCliType, targetProtocol);
  }
  return parseCodexRequest(cleaned, upstreamModel, sourceCliType, targetProtocol);
}

/* ============================== Target Request Builders ============================== */

function collectSystemText(request: NormalizedRequest): string {
  return request.messages
    .filter(msg => msg.role === 'system')
    .flatMap(msg => msg.parts)
    .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
    .map(part => part.text)
    .join('\n\n');
}

function buildAnthropicBody(request: NormalizedRequest): JsonRecord {
  const system = collectSystemText(request);
  const messages: JsonRecord[] = [];
  for (const msg of request.messages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content: JsonRecord[] = [];
    for (const part of msg.parts) {
      if (part.kind === 'text') {
        if (part.text) content.push({ type: 'text', text: part.text });
      } else if (part.kind === 'tool_call') {
        content.push({
          type: 'tool_use',
          id: part.toolCall.id,
          name: part.toolCall.name,
          input: parseArgumentsObject(part.toolCall.argumentsJson),
        });
      } else if (part.kind === 'tool_result') {
        content.push({
          type: 'tool_result',
          tool_use_id: part.toolResult.toolCallId,
          content: part.toolResult.content,
          ...(part.toolResult.isError ? { is_error: true } : {}),
        });
      }
    }
    if (content.length === 0) continue;
    messages.push({ role, content });
  }

  const body: JsonRecord = {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 4096,
    stream: request.stream,
    messages:
      messages.length > 0 ? messages : [{ role: 'user', content: [{ type: 'text', text: '' }] }],
  };
  if (system) body.system = system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (Array.isArray(request.stop)) {
    body.stop_sequences = request.stop;
  } else if (typeof request.stop === 'string' && request.stop.trim()) {
    body.stop_sequences = [request.stop];
  }
  if (request.tools?.length) {
    body.tools = request.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters ?? {},
    }));
  }
  return body;
}

function buildOpenAiChatBody(request: NormalizedRequest): JsonRecord {
  const messages: JsonRecord[] = [];
  const systemText = collectSystemText(request);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }
  for (const msg of request.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'assistant') {
      const textPieces: string[] = [];
      const toolCalls: JsonRecord[] = [];
      for (const part of msg.parts) {
        if (part.kind === 'text' && part.text) {
          textPieces.push(part.text);
        } else if (part.kind === 'tool_call') {
          toolCalls.push({
            id: part.toolCall.id,
            type: 'function',
            function: {
              name: part.toolCall.name,
              arguments: part.toolCall.argumentsJson || '{}',
            },
          });
        }
      }
      const assistantMessage: JsonRecord = { role: 'assistant' };
      assistantMessage.content = textPieces.join('\n') || null;
      if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
      messages.push(assistantMessage);
      continue;
    }
    // user role: tool_results split into separate role:'tool' messages before any text
    for (const part of msg.parts) {
      if (part.kind === 'tool_result') {
        messages.push({
          role: 'tool',
          tool_call_id: part.toolResult.toolCallId,
          content: part.toolResult.content,
        });
      }
    }
    const userText = msg.parts
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map(part => part.text)
      .filter(Boolean)
      .join('\n');
    if (userText) messages.push({ role: 'user', content: userText });
  }

  const body: JsonRecord = {
    model: request.model,
    stream: request.stream,
    messages: messages.length > 0 ? messages : [{ role: 'user', content: '' }],
  };
  if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stop !== undefined) body.stop = request.stop;
  if (request.tools?.length) {
    body.tools = request.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? {},
      },
    }));
  }
  return body;
}

function buildOpenAiResponsesBody(request: NormalizedRequest): JsonRecord {
  const instructions = collectSystemText(request);
  const input: JsonRecord[] = [];
  for (const msg of request.messages) {
    if (msg.role === 'system') continue;
    for (const part of msg.parts) {
      if (part.kind === 'tool_call') {
        input.push({
          type: 'function_call',
          call_id: part.toolCall.id,
          name: part.toolCall.name,
          arguments: part.toolCall.argumentsJson || '{}',
        });
      } else if (part.kind === 'tool_result') {
        input.push({
          type: 'function_call_output',
          call_id: part.toolResult.toolCallId,
          output: part.toolResult.content,
        });
      }
    }
    const text = msg.parts
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map(part => part.text)
      .filter(Boolean)
      .join('\n');
    if (text) {
      input.push({
        role: msg.role,
        content: [
          {
            type: msg.role === 'assistant' ? 'output_text' : 'input_text',
            text,
          },
        ],
      });
    }
  }

  const body: JsonRecord = {
    model: request.model,
    stream: request.stream,
    input:
      input.length > 0 ? input : [{ role: 'user', content: [{ type: 'input_text', text: '' }] }],
  };
  if (instructions) body.instructions = instructions;
  if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.tools?.length) {
    body.tools = request.tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
    }));
  }
  return body;
}

/* ============================== Public: adaptRequestToTargetProtocol ============================== */

export function adaptRequestToTargetProtocol(
  bodyBuffer: Buffer,
  sourceCliType: RouteCliType,
  targetProtocol: Exclude<CliTargetProtocol, 'native'>,
  requestUrl?: string,
  upstreamModel?: string
): CliProtocolRewriteResult {
  const normalized = normalizeSourceRequest(
    bodyBuffer,
    sourceCliType,
    targetProtocol,
    requestUrl,
    upstreamModel
  );
  if (!normalized) {
    throw new CliProtocolAdapterError({
      stage: 'request-adapt',
      sourceCliType,
      targetProtocol,
      reason: 'invalid_source_body',
    });
  }

  const hasConversation = normalized.messages.some(
    msg => (msg.role === 'user' || msg.role === 'assistant') && msg.parts.length > 0
  );
  if (!hasConversation) {
    throw new CliProtocolAdapterError({
      stage: 'request-adapt',
      sourceCliType,
      targetProtocol,
      reason: 'empty_conversation',
    });
  }

  const body =
    targetProtocol === 'anthropic-messages'
      ? buildAnthropicBody(normalized)
      : targetProtocol === 'openai-responses'
        ? buildOpenAiResponsesBody(normalized)
        : buildOpenAiChatBody(normalized);

  return {
    body: Buffer.from(JSON.stringify(body), 'utf-8'),
    headers: {
      'content-type': 'application/json',
      accept: normalized.stream ? 'text/event-stream' : 'application/json',
    },
    upstreamMethod: 'POST',
    upstreamPath:
      targetProtocol === 'anthropic-messages'
        ? '/v1/messages'
        : targetProtocol === 'openai-responses'
          ? '/v1/responses'
          : '/v1/chat/completions',
    upstreamCliType: targetProtocol === 'anthropic-messages' ? 'claudeCode' : 'codex',
    responseAdapter: {
      type: 'source',
      sourceCliType,
      targetProtocol,
      model: normalized.model,
      stream: normalized.stream,
    },
  };
}

/* ============================== Target Response Parsers ============================== */

function mapAnthropicStopReason(reason: unknown): NormalizedFinishReason | undefined {
  const text = normalizeText(reason);
  if (!text) return undefined;
  if (text === 'tool_use') return 'tool_calls';
  if (text === 'end_turn' || text === 'stop_sequence') return 'stop';
  if (text === 'max_tokens') return 'length';
  return undefined;
}

function parseAnthropicResponse(body: Buffer): NormalizedResponse {
  const json = parseJsonBody(body);
  if (json) {
    const content = Array.isArray(json.content) ? json.content : [];
    let text = '';
    const toolCalls: NormalizedToolCall[] = [];
    for (const part of content) {
      const record = normalizeObject(part);
      const kind = normalizeText(record.type);
      if (kind === 'text') {
        text += normalizeText(record.text);
      } else if (kind === 'tool_use') {
        toolCalls.push({
          id: normalizeText(record.id) || genToolCallId(),
          name: normalizeText(record.name),
          argumentsJson: stringifyArguments(record.input ?? {}),
        });
      }
    }
    return {
      text,
      textDeltas: text ? [text] : [],
      toolCalls,
      usage: normalizeUsage(normalizeObject(json.usage)),
      finishReason: mapAnthropicStopReason(json.stop_reason),
    };
  }

  const textDeltas: string[] = [];
  const blockBuffers = new Map<
    number,
    { type: 'text' | 'tool_use'; toolCall?: NormalizedToolCall; text?: string }
  >();
  const toolCalls: NormalizedToolCall[] = [];
  let usage: UsageShape = {};
  let finishReason: NormalizedFinishReason | undefined;
  for (const payload of parseSseJsonPayloads(body)) {
    const type = normalizeText(payload.type);
    if (type === 'message_start') {
      usage = mergeUsage(
        usage,
        normalizeUsage(normalizeObject(normalizeObject(payload.message).usage))
      );
      continue;
    }
    if (type === 'content_block_start') {
      const index = Number(payload.index);
      const block = normalizeObject(payload.content_block);
      const blockKind = normalizeText(block.type);
      if (blockKind === 'tool_use') {
        const toolCall: NormalizedToolCall = {
          id: normalizeText(block.id) || genToolCallId(),
          name: normalizeText(block.name),
          argumentsJson: '',
        };
        blockBuffers.set(index, { type: 'tool_use', toolCall });
      } else {
        blockBuffers.set(index, { type: 'text', text: '' });
      }
      continue;
    }
    if (type === 'content_block_delta') {
      const index = Number(payload.index);
      const buf = blockBuffers.get(index);
      const delta = normalizeObject(payload.delta);
      const deltaKind = normalizeText(delta.type);
      if (buf?.type === 'text' && (deltaKind === 'text_delta' || deltaKind === '')) {
        const text = normalizeText(delta.text);
        if (text) {
          buf.text = (buf.text || '') + text;
          textDeltas.push(text);
        }
      } else if (buf?.type === 'tool_use' && deltaKind === 'input_json_delta') {
        buf.toolCall!.argumentsJson += normalizeText(delta.partial_json);
      }
      continue;
    }
    if (type === 'content_block_stop') {
      const index = Number(payload.index);
      const buf = blockBuffers.get(index);
      if (buf?.type === 'tool_use' && buf.toolCall) {
        toolCalls.push(buf.toolCall);
      }
      blockBuffers.delete(index);
      continue;
    }
    if (type === 'message_delta') {
      usage = mergeUsage(usage, normalizeUsage(normalizeObject(payload.usage)));
      const messageDelta = normalizeObject(payload.delta);
      finishReason = mapAnthropicStopReason(messageDelta.stop_reason) ?? finishReason;
      continue;
    }
  }
  return {
    text: textDeltas.join(''),
    textDeltas,
    toolCalls,
    usage,
    finishReason,
  };
}

function mapOpenAiFinishReason(reason: unknown): NormalizedFinishReason | undefined {
  const text = normalizeText(reason);
  if (!text) return undefined;
  if (text === 'tool_calls' || text === 'function_call') return 'tool_calls';
  if (text === 'stop') return 'stop';
  if (text === 'length') return 'length';
  return undefined;
}

function parseOpenAiChatToolCallsFromMessage(message: JsonRecord): NormalizedToolCall[] {
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return rawCalls
    .map(call => {
      const record = normalizeObject(call);
      const fn = normalizeObject(record.function);
      const name = normalizeText(fn.name);
      if (!name) return null;
      return {
        id: normalizeText(record.id) || genToolCallId(),
        name,
        argumentsJson: normalizeText(fn.arguments) || '{}',
      } satisfies NormalizedToolCall;
    })
    .filter(Boolean) as NormalizedToolCall[];
}

function parseOpenAiChatResponse(body: Buffer): NormalizedResponse {
  const json = parseJsonBody(body);
  if (json) {
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const first = normalizeObject(choices[0]);
    const message = normalizeObject(first.message);
    const text = normalizeText(message.content);
    const toolCalls = parseOpenAiChatToolCallsFromMessage(message);
    return {
      text,
      textDeltas: text ? [text] : [],
      toolCalls,
      usage: normalizeUsage(normalizeObject(json.usage)),
      finishReason: mapOpenAiFinishReason(first.finish_reason),
    };
  }

  const textDeltas: string[] = [];
  const toolCallBuffers = new Map<number, NormalizedToolCall>();
  let usage: UsageShape = {};
  let finishReason: NormalizedFinishReason | undefined;
  for (const payload of parseSseJsonPayloads(body)) {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      const choiceRecord = normalizeObject(choice);
      const delta = normalizeObject(choiceRecord.delta);
      const text = normalizeText(delta.content);
      if (text) textDeltas.push(text);
      const rawToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const call of rawToolCalls) {
        const callRecord = normalizeObject(call);
        const index = Number(callRecord.index);
        if (!Number.isFinite(index)) continue;
        const fn = normalizeObject(callRecord.function);
        let buf = toolCallBuffers.get(index);
        if (!buf) {
          buf = {
            id: normalizeText(callRecord.id) || genToolCallId(),
            name: normalizeText(fn.name),
            argumentsJson: '',
          };
          toolCallBuffers.set(index, buf);
        } else {
          if (normalizeText(callRecord.id)) buf.id = normalizeText(callRecord.id);
          if (normalizeText(fn.name)) buf.name = normalizeText(fn.name);
        }
        buf.argumentsJson += normalizeText(fn.arguments);
      }
      finishReason = mapOpenAiFinishReason(choiceRecord.finish_reason) ?? finishReason;
    }
    usage = mergeUsage(usage, normalizeUsage(normalizeObject(payload.usage)));
  }
  const toolCalls = Array.from(toolCallBuffers.entries())
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter(call => call.name);
  return {
    text: textDeltas.join(''),
    textDeltas,
    toolCalls,
    usage,
    finishReason,
  };
}

function extractResponsesOutputItems(json: JsonRecord): {
  text: string;
  toolCalls: NormalizedToolCall[];
} {
  let text = normalizeText(json.output_text);
  const toolCalls: NormalizedToolCall[] = [];
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const record = normalizeObject(item);
    const kind = normalizeText(record.type);
    if (kind === 'function_call') {
      toolCalls.push({
        id: normalizeText(record.call_id) || normalizeText(record.id) || genToolCallId(),
        name: normalizeText(record.name),
        argumentsJson: normalizeText(record.arguments) || '{}',
      });
      continue;
    }
    const content = Array.isArray(record.content) ? record.content : [];
    for (const part of content) {
      const partRecord = normalizeObject(part);
      const partKind = normalizeText(partRecord.type);
      if (partKind === 'output_text' || partKind === 'text' || partKind === 'input_text') {
        if (!text) text = normalizeText(partRecord.text);
        else text += normalizeText(partRecord.text);
      }
    }
  }
  return { text, toolCalls: toolCalls.filter(call => call.name) };
}

function parseOpenAiResponsesResponse(body: Buffer): NormalizedResponse {
  const json = parseJsonBody(body);
  if (json) {
    const { text, toolCalls } = extractResponsesOutputItems(json);
    return {
      text,
      textDeltas: text ? [text] : [],
      toolCalls,
      usage: normalizeUsage(normalizeObject(json.usage)),
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  const textDeltas: string[] = [];
  const toolCallBuffers = new Map<string, NormalizedToolCall>();
  let usage: UsageShape = {};
  let finalText = '';
  let finishReason: NormalizedFinishReason | undefined;
  for (const payload of parseSseJsonPayloads(body)) {
    const type = normalizeText(payload.type);
    if (type === 'response.output_text.delta') {
      const delta = normalizeText(payload.delta);
      if (delta) textDeltas.push(delta);
      continue;
    }
    if (type === 'response.output_item.added') {
      const item = normalizeObject(payload.item);
      const itemType = normalizeText(item.type);
      if (itemType === 'function_call') {
        const key = normalizeText(item.call_id) || normalizeText(item.id) || genToolCallId();
        toolCallBuffers.set(key, {
          id: key,
          name: normalizeText(item.name),
          argumentsJson: normalizeText(item.arguments) || '',
        });
      }
      continue;
    }
    if (type === 'response.function_call_arguments.delta') {
      const key = normalizeText(payload.call_id) || normalizeText(payload.item_id);
      const buf = toolCallBuffers.get(key);
      if (buf) buf.argumentsJson += normalizeText(payload.delta);
      continue;
    }
    if (type === 'response.function_call_arguments.done') {
      const key = normalizeText(payload.call_id) || normalizeText(payload.item_id);
      const buf = toolCallBuffers.get(key);
      const finalArgs = normalizeText(payload.arguments);
      if (buf && finalArgs) buf.argumentsJson = finalArgs;
      continue;
    }
    if (
      type === 'response.completed' ||
      type === 'response.in_progress' ||
      type === 'response.created'
    ) {
      const response = normalizeObject(payload.response);
      usage = mergeUsage(usage, normalizeUsage(normalizeObject(response.usage)));
      if (type === 'response.completed') {
        const aggregated = extractResponsesOutputItems(response);
        if (aggregated.text) finalText = aggregated.text;
        for (const call of aggregated.toolCalls) {
          if (!toolCallBuffers.has(call.id)) toolCallBuffers.set(call.id, call);
        }
        finishReason = aggregated.toolCalls.length > 0 ? 'tool_calls' : 'stop';
      }
      continue;
    }
  }
  const toolCalls = Array.from(toolCallBuffers.values()).filter(call => call.name);
  const text = finalText || textDeltas.join('');
  return {
    text,
    textDeltas,
    toolCalls,
    usage,
    finishReason: finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : undefined),
  };
}

/* ============================== Source Response Builders ============================== */

function buildAnthropicUsage(usage: UsageShape): JsonRecord {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
  };
}

function buildClaudeJson(model: string, response: NormalizedResponse): Buffer {
  const content: JsonRecord[] = [];
  if (response.text) {
    content.push({ type: 'text', text: response.text });
  }
  for (const call of response.toolCalls) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: parseArgumentsObject(call.argumentsJson),
    });
  }
  const stopReason =
    response.finishReason === 'tool_calls'
      ? 'tool_use'
      : response.finishReason === 'length'
        ? 'max_tokens'
        : 'end_turn';
  return Buffer.from(
    JSON.stringify({
      id: genMessageId('msg'),
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: buildAnthropicUsage(response.usage),
    }),
    'utf-8'
  );
}

function buildClaudeSse(model: string, response: NormalizedResponse): Buffer {
  const messageId = genMessageId('msg');
  const stopReason =
    response.finishReason === 'tool_calls'
      ? 'tool_use'
      : response.finishReason === 'length'
        ? 'max_tokens'
        : 'end_turn';
  const chunks: string[] = [];
  chunks.push(
    sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: response.usage.inputTokens ?? 0, output_tokens: 0 },
      },
    })
  );
  let blockIndex = 0;
  const actualDeltas =
    response.textDeltas.length > 0 ? response.textDeltas : response.text ? [response.text] : [];
  if (actualDeltas.length > 0) {
    chunks.push(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      })
    );
    for (const delta of actualDeltas) {
      chunks.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: delta },
        })
      );
    }
    chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex }));
    blockIndex += 1;
  }
  for (const call of response.toolCalls) {
    chunks.push(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: {},
        },
      })
    );
    if (call.argumentsJson) {
      chunks.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: call.argumentsJson },
        })
      );
    }
    chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex }));
    blockIndex += 1;
  }
  chunks.push(
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: response.usage.outputTokens ?? 0 },
    })
  );
  chunks.push(sseEvent('message_stop', { type: 'message_stop' }));
  return Buffer.from(chunks.join(''), 'utf-8');
}

function buildCodexUsage(usage: UsageShape): JsonRecord {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}

function buildCodexResponseObject(model: string, response: NormalizedResponse): JsonRecord {
  const responseId = genMessageId('resp');
  const output: JsonRecord[] = [];
  if (response.text) {
    output.push({
      id: genMessageId('msg'),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: response.text, annotations: [] }],
    });
  }
  for (const call of response.toolCalls) {
    output.push({
      id: genMessageId('fc'),
      type: 'function_call',
      status: 'completed',
      call_id: call.id,
      name: call.name,
      arguments: call.argumentsJson || '{}',
    });
  }
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model,
    output,
    output_text: response.text,
    usage: buildCodexUsage(response.usage),
  };
}

function buildCodexSse(model: string, response: NormalizedResponse): Buffer {
  const payload = buildCodexResponseObject(model, response);
  const responseId = normalizeText(payload.id);
  const initialPayload = { ...payload, status: 'in_progress', output: [] };
  const chunks: string[] = [
    sseEvent('response.created', { response: initialPayload }),
    sseEvent('response.in_progress', { response: initialPayload }),
  ];
  const output = (payload.output as JsonRecord[]) || [];
  let outputIndex = 0;
  for (const item of output) {
    const itemType = normalizeText(item.type);
    if (itemType === 'message') {
      const messageId = normalizeText(item.id);
      chunks.push(
        sseEvent('response.output_item.added', {
          response_id: responseId,
          output_index: outputIndex,
          item: { ...item, status: 'in_progress', content: [] },
        })
      );
      chunks.push(
        sseEvent('response.content_part.added', {
          response_id: responseId,
          item_id: messageId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        })
      );
      const deltas =
        response.textDeltas.length > 0 ? response.textDeltas : response.text ? [response.text] : [];
      for (const delta of deltas) {
        chunks.push(
          sseEvent('response.output_text.delta', {
            response_id: responseId,
            item_id: messageId,
            output_index: outputIndex,
            content_index: 0,
            delta,
          })
        );
      }
      chunks.push(
        sseEvent('response.output_text.done', {
          response_id: responseId,
          item_id: messageId,
          output_index: outputIndex,
          content_index: 0,
          text: response.text,
        })
      );
      const finalPart = (Array.isArray(item.content) ? item.content[0] : undefined) ?? {
        type: 'output_text',
        text: response.text,
        annotations: [],
      };
      chunks.push(
        sseEvent('response.content_part.done', {
          response_id: responseId,
          item_id: messageId,
          output_index: outputIndex,
          content_index: 0,
          part: finalPart,
        })
      );
      chunks.push(
        sseEvent('response.output_item.done', {
          response_id: responseId,
          output_index: outputIndex,
          item,
        })
      );
    } else if (itemType === 'function_call') {
      const itemId = normalizeText(item.id);
      const inProgress = { ...item, status: 'in_progress', arguments: '' };
      chunks.push(
        sseEvent('response.output_item.added', {
          response_id: responseId,
          output_index: outputIndex,
          item: inProgress,
        })
      );
      const argsText = normalizeText(item.arguments) || '{}';
      if (argsText) {
        chunks.push(
          sseEvent('response.function_call_arguments.delta', {
            response_id: responseId,
            item_id: itemId,
            output_index: outputIndex,
            call_id: normalizeText(item.call_id),
            delta: argsText,
          })
        );
      }
      chunks.push(
        sseEvent('response.function_call_arguments.done', {
          response_id: responseId,
          item_id: itemId,
          output_index: outputIndex,
          call_id: normalizeText(item.call_id),
          arguments: argsText,
        })
      );
      chunks.push(
        sseEvent('response.output_item.done', {
          response_id: responseId,
          output_index: outputIndex,
          item,
        })
      );
    }
    outputIndex += 1;
  }
  chunks.push(sseEvent('response.completed', { response: payload }));
  chunks.push(sseEvent(null, '[DONE]'));
  return Buffer.from(chunks.join(''), 'utf-8');
}

function buildGeminiUsageMetadata(usage: UsageShape): JsonRecord | undefined {
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(usage.inputTokens !== undefined ? { promptTokenCount: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { candidatesTokenCount: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined
      ? { totalTokenCount: usage.totalTokens }
      : usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? { totalTokenCount: usage.inputTokens + usage.outputTokens }
        : {}),
  };
}

function buildGeminiCandidateParts(response: NormalizedResponse): JsonRecord[] {
  const parts: JsonRecord[] = [];
  if (response.text) {
    parts.push({ text: response.text });
  }
  for (const call of response.toolCalls) {
    parts.push({
      functionCall: {
        name: call.name,
        args: parseArgumentsObject(call.argumentsJson),
      },
    });
  }
  return parts;
}

function buildGeminiJson(response: NormalizedResponse): JsonRecord {
  const usageMetadata = buildGeminiUsageMetadata(response.usage);
  const finishReason =
    response.finishReason === 'tool_calls'
      ? 'STOP'
      : response.finishReason === 'length'
        ? 'MAX_TOKENS'
        : 'STOP';
  return {
    candidates: [
      {
        content: {
          parts: buildGeminiCandidateParts(response),
          role: 'model',
        },
        finishReason,
        index: 0,
      },
    ],
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}

function buildGeminiSse(response: NormalizedResponse): Buffer {
  const chunks: string[] = [];
  const deltas =
    response.textDeltas.length > 0 ? response.textDeltas : response.text ? [response.text] : [];
  for (const delta of deltas) {
    chunks.push(
      sseEvent(null, {
        candidates: [{ content: { parts: [{ text: delta }], role: 'model' }, index: 0 }],
      })
    );
  }
  for (const call of response.toolCalls) {
    chunks.push(
      sseEvent(null, {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: call.name,
                    args: parseArgumentsObject(call.argumentsJson),
                  },
                },
              ],
              role: 'model',
            },
            index: 0,
          },
        ],
      })
    );
  }
  const usageMetadata = buildGeminiUsageMetadata(response.usage);
  chunks.push(
    sseEvent(null, {
      candidates: [
        {
          content: { parts: [], role: 'model' },
          finishReason: response.finishReason === 'length' ? 'MAX_TOKENS' : 'STOP',
          index: 0,
        },
      ],
      ...(usageMetadata ? { usageMetadata } : {}),
    })
  );
  return Buffer.from(chunks.join(''), 'utf-8');
}

/* ============================== Public: transformTargetProtocolResponse ============================== */

export function transformTargetProtocolResponse(params: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  adapter: CliProtocolResponseAdapter;
}): ResponseTransformResult {
  if (
    params.adapter.type === 'transparent' ||
    params.statusCode < 200 ||
    params.statusCode >= 300
  ) {
    return { body: params.body, headers: params.headers };
  }

  const normalized =
    params.adapter.targetProtocol === 'anthropic-messages'
      ? parseAnthropicResponse(params.body)
      : params.adapter.targetProtocol === 'openai-responses'
        ? parseOpenAiResponsesResponse(params.body)
        : parseOpenAiChatResponse(params.body);

  if (params.adapter.sourceCliType === 'claudeCode') {
    const body = params.adapter.stream
      ? buildClaudeSse(params.adapter.model, normalized)
      : buildClaudeJson(params.adapter.model, normalized);
    return replaceResponseBody(
      params.headers,
      body,
      params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
    );
  }

  if (params.adapter.sourceCliType === 'codex') {
    const body = params.adapter.stream
      ? buildCodexSse(params.adapter.model, normalized)
      : Buffer.from(
          JSON.stringify(buildCodexResponseObject(params.adapter.model, normalized)),
          'utf-8'
        );
    return replaceResponseBody(
      params.headers,
      body,
      params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
    );
  }

  const body = params.adapter.stream
    ? buildGeminiSse(normalized)
    : Buffer.from(JSON.stringify(buildGeminiJson(normalized)), 'utf-8');
  return replaceResponseBody(
    params.headers,
    body,
    params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
  );
}
