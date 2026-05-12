/**
 * CHY API request rewriter.
 *
 * CHY API 公益站 only accepts OpenAI-compatible POST /v1/chat/completions.
 * Route proxy requests from Claude Code, Codex, and Gemini CLI are converted to
 * Chat Completions on the upstream side, then converted back to the caller's
 * protocol shape on the response side.
 */

import { randomUUID } from 'crypto';
import type { RouteCliType } from '../shared/types/route-proxy';
import {
  transformAnyRouterResponse,
  type AnyRouterResponseAdapter,
  type AnyRouterResponseTransformResult,
} from './anyrouter-request-rewriter';

type JsonRecord = Record<string, unknown>;

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ChyApiResponseAdapter =
  | { type: 'transparent' }
  | { type: 'claudeMessages'; model: string; stream: boolean }
  | { type: 'codexResponses'; model: string; stream: boolean }
  | { type: 'geminiGenerateContent'; model: string; stream: boolean };

export interface ChyApiRewriteResult {
  body: Buffer;
  headers: Record<string, string>;
  upstreamMethod: 'POST';
  upstreamPath: string;
  upstreamCliType: RouteCliType;
  responseAdapter: ChyApiResponseAdapter;
}

const CHY_API_SITE_NAME = 'chy api公益站';
const CHY_API_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

export function isChyApiSiteName(siteName: string): boolean {
  return siteName.trim().toLowerCase() === CHY_API_SITE_NAME;
}

function normalizeObject(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

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

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }

        const record = normalizeObject(part);
        return normalizeText(record.text ?? record.input_text ?? record.output_text);
      })
      .filter(Boolean)
      .join('\n');
  }

  const record = normalizeObject(content);
  return normalizeText(record.text ?? record.input_text ?? record.output_text);
}

function pushMessage(
  messages: Array<{ role: string; content: string }>,
  role: string,
  content: unknown
): void {
  const text = extractTextFromContent(content);
  if (text) {
    messages.push({ role, content: text });
  }
}

function buildOpenAiToolFromClaude(tool: unknown): JsonRecord | null {
  const record = normalizeObject(tool);
  const name = normalizeText(record.name);
  if (!name) {
    return null;
  }

  return {
    type: 'function',
    function: {
      name,
      description: normalizeText(record.description),
      parameters: record.input_schema ?? {},
    },
  };
}

function buildOpenAiToolFromGeminiDeclaration(declaration: unknown): JsonRecord | null {
  const record = normalizeObject(declaration);
  const name = normalizeText(record.name);
  if (!name) {
    return null;
  }

  return {
    type: 'function',
    function: {
      name,
      description: normalizeText(record.description),
      parameters: record.parameters ?? {},
    },
  };
}

function buildOpenAiToolFromCodex(tool: unknown): JsonRecord | null {
  const record = normalizeObject(tool);
  if (record.type === 'function' && normalizeObject(record.function).name) {
    return record;
  }

  const name = normalizeText(record.name);
  if (!name) {
    return null;
  }

  return {
    type: 'function',
    function: {
      name,
      description: normalizeText(record.description),
      parameters: record.parameters ?? {},
    },
  };
}

function normalizeOpenAiBody(base: JsonRecord, model: string, stream: boolean): JsonRecord {
  const body: JsonRecord = {
    model,
    messages: base.messages,
    stream,
  };

  for (const [fromKey, toKey] of [
    ['max_tokens', 'max_tokens'],
    ['temperature', 'temperature'],
    ['top_p', 'top_p'],
    ['stop', 'stop'],
    ['tools', 'tools'],
    ['tool_choice', 'tool_choice'],
  ] as const) {
    if (base[fromKey] !== undefined) {
      body[toKey] = base[fromKey];
    }
  }

  return body;
}

function buildClaudeChatCompletionsBody(
  cleaned: JsonRecord,
  model: string
): {
  body: JsonRecord;
  stream: boolean;
} {
  const messages: Array<{ role: string; content: string }> = [];
  const systemText = extractTextFromContent(cleaned.system);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  const sourceMessages = Array.isArray(cleaned.messages) ? cleaned.messages : [];
  for (const message of sourceMessages) {
    const record = normalizeObject(message);
    const role = normalizeText(record.role) === 'assistant' ? 'assistant' : 'user';
    pushMessage(messages, role, record.content);
  }

  const tools = Array.isArray(cleaned.tools)
    ? cleaned.tools.map(buildOpenAiToolFromClaude).filter(Boolean)
    : undefined;

  const body = normalizeOpenAiBody(
    {
      ...cleaned,
      messages: messages.length > 0 ? messages : [{ role: 'user', content: '' }],
      ...(tools && tools.length > 0 ? { tools } : {}),
    },
    model,
    cleaned.stream === true
  );

  return { body, stream: cleaned.stream === true };
}

function normalizeCodexInput(input: unknown): Array<{ role: string; content: string }> {
  if (typeof input === 'string') {
    return input ? [{ role: 'user', content: input }] : [];
  }

  if (!Array.isArray(input)) {
    const text = extractTextFromContent(input);
    return text ? [{ role: 'user', content: text }] : [];
  }

  const messages: Array<{ role: string; content: string }> = [];
  for (const item of input) {
    const record = normalizeObject(item);
    const roleText = normalizeText(record.role);
    const role = roleText === 'assistant' || roleText === 'system' ? roleText : 'user';
    pushMessage(messages, role, record.content ?? record.input ?? item);
  }
  return messages;
}

function buildCodexChatCompletionsBody(
  cleaned: JsonRecord,
  model: string
): {
  body: JsonRecord;
  stream: boolean;
} {
  const messages: Array<{ role: string; content: string }> = [];
  const instructions = extractTextFromContent(cleaned.instructions);
  if (instructions) {
    messages.push({ role: 'system', content: instructions });
  }
  messages.push(...normalizeCodexInput(cleaned.input));

  const tools = Array.isArray(cleaned.tools)
    ? cleaned.tools.map(buildOpenAiToolFromCodex).filter(Boolean)
    : undefined;

  const body = normalizeOpenAiBody(
    {
      ...cleaned,
      messages: messages.length > 0 ? messages : [{ role: 'user', content: '' }],
      max_tokens: cleaned.max_output_tokens ?? cleaned.max_tokens,
      ...(tools && tools.length > 0 ? { tools } : {}),
    },
    model,
    cleaned.stream === true
  );

  return { body, stream: cleaned.stream === true };
}

function extractGeminiPartsText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return extractTextFromContent(parts);
  }

  return parts
    .map(part => extractTextFromContent(part))
    .filter(Boolean)
    .join('\n');
}

function buildGeminiChatCompletionsBody(
  cleaned: JsonRecord,
  model: string,
  requestUrl?: string
): { body: JsonRecord; stream: boolean } {
  const messages: Array<{ role: string; content: string }> = [];
  const systemInstruction = normalizeObject(cleaned.systemInstruction);
  const systemText = extractGeminiPartsText(systemInstruction.parts ?? cleaned.systemInstruction);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  const contents = Array.isArray(cleaned.contents) ? cleaned.contents : [];
  for (const content of contents) {
    const record = normalizeObject(content);
    const role = record.role === 'model' ? 'assistant' : 'user';
    const text = extractGeminiPartsText(record.parts);
    if (text) {
      messages.push({ role, content: text });
    }
  }

  const declarations = (Array.isArray(cleaned.tools) ? cleaned.tools : []).flatMap(tool => {
    const record = normalizeObject(tool);
    return Array.isArray(record.functionDeclarations) ? record.functionDeclarations : [];
  });
  const tools = declarations.map(buildOpenAiToolFromGeminiDeclaration).filter(Boolean);
  const generationConfig = normalizeObject(cleaned.generationConfig);
  const stream = Boolean(requestUrl?.includes(':streamGenerateContent') || cleaned.stream === true);

  const body = normalizeOpenAiBody(
    {
      messages: messages.length > 0 ? messages : [{ role: 'user', content: '' }],
      max_tokens: generationConfig.maxOutputTokens,
      temperature: generationConfig.temperature,
      top_p: generationConfig.topP,
      stop: generationConfig.stopSequences,
      ...(tools.length > 0 ? { tools } : {}),
    },
    model,
    stream
  );

  return { body, stream };
}

function resolveModel(cleaned: JsonRecord, upstreamModel?: string): string {
  return upstreamModel || normalizeText(cleaned.model);
}

export function rewriteForChyApi(
  bodyBuffer: Buffer,
  cliType: RouteCliType,
  requestUrl?: string,
  upstreamModel?: string
): ChyApiRewriteResult {
  const cleaned = parseJsonBody(bodyBuffer);
  if (!cleaned) {
    return {
      body: bodyBuffer,
      headers: {},
      upstreamMethod: 'POST',
      upstreamPath: CHY_API_CHAT_COMPLETIONS_PATH,
      upstreamCliType: 'codex',
      responseAdapter: { type: 'transparent' },
    };
  }

  const model = resolveModel(cleaned, upstreamModel);
  let converted: { body: JsonRecord; stream: boolean };
  let responseAdapter: ChyApiResponseAdapter;

  if (cliType === 'claudeCode') {
    converted = buildClaudeChatCompletionsBody(cleaned, model);
    responseAdapter = { type: 'claudeMessages', model, stream: converted.stream };
  } else if (cliType === 'geminiCli') {
    converted = buildGeminiChatCompletionsBody(cleaned, model, requestUrl);
    responseAdapter = { type: 'geminiGenerateContent', model, stream: converted.stream };
  } else {
    converted = buildCodexChatCompletionsBody(cleaned, model);
    responseAdapter = { type: 'codexResponses', model, stream: converted.stream };
  }

  return {
    body: Buffer.from(JSON.stringify(converted.body), 'utf-8'),
    headers: {
      'content-type': 'application/json',
      accept: converted.stream ? 'text/event-stream' : 'application/json',
    },
    upstreamMethod: 'POST',
    upstreamPath: CHY_API_CHAT_COMPLETIONS_PATH,
    upstreamCliType: 'codex',
    responseAdapter,
  };
}

function getChoiceMessageText(choice: JsonRecord): string {
  const message = normalizeObject(choice.message);
  return extractTextFromContent(message.content);
}

function normalizeUsage(usage: JsonRecord | undefined): UsageShape {
  if (!usage) {
    return {};
  }

  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = Number(usage.total_tokens);

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

    if (!data || data === '[DONE]') {
      continue;
    }

    try {
      payloads.push(normalizeObject(JSON.parse(data)));
    } catch {
      /* ignore malformed SSE payloads */
    }
  }
  return payloads;
}

function extractOpenAiChatPayload(body: Buffer): {
  text: string;
  deltas: string[];
  usage: UsageShape;
} {
  const json = parseJsonBody(body);
  if (json) {
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const text = choices.map(choice => getChoiceMessageText(normalizeObject(choice))).join('');
    return {
      text,
      deltas: [],
      usage: normalizeUsage(normalizeObject(json.usage)),
    };
  }

  const deltas: string[] = [];
  let usage: UsageShape = {};
  for (const payload of parseSseJsonPayloads(body)) {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      const delta = normalizeObject(normalizeObject(choice).delta);
      const text = extractTextFromContent(delta.content);
      if (text) {
        deltas.push(text);
      }
    }
    usage = mergeUsage(usage, normalizeUsage(normalizeObject(payload.usage)));
  }

  return {
    text: deltas.join(''),
    deltas,
    usage,
  };
}

function buildAnthropicUsage(usage: UsageShape): JsonRecord {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
  };
}

function buildAnthropicJsonBody(model: string, text: string, usage: UsageShape): Buffer {
  const body = {
    id: `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: buildAnthropicUsage(usage),
  };

  return Buffer.from(JSON.stringify(body), 'utf-8');
}

function sseEvent(event: string | null, data: unknown): string {
  const prefix = event ? `event: ${event}\n` : '';
  return `${prefix}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function buildAnthropicSseBody(
  model: string,
  text: string,
  deltas: string[],
  usage: UsageShape
): Buffer {
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  const actualDeltas = deltas.length > 0 ? deltas : text ? [text] : [];
  const chunks = [
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
        usage: { input_tokens: usage.inputTokens ?? 0, output_tokens: 0 },
      },
    }),
    sseEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    ...actualDeltas.map(delta =>
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: delta },
      })
    ),
    sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.outputTokens ?? 0 },
    }),
    sseEvent('message_stop', { type: 'message_stop' }),
  ];

  return Buffer.from(chunks.join(''), 'utf-8');
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
): AnyRouterResponseTransformResult {
  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers };
  deleteHeader(nextHeaders, 'content-length');
  deleteHeader(nextHeaders, 'transfer-encoding');
  deleteHeader(nextHeaders, 'content-encoding');
  nextHeaders['content-type'] = contentType;
  nextHeaders['content-length'] = String(body.length);

  return { body, headers: nextHeaders };
}

function buildAnthropicResponseBuffer(
  adapter: Exclude<ChyApiResponseAdapter, { type: 'transparent' }>,
  payload: { text: string; deltas: string[]; usage: UsageShape }
): Buffer {
  return adapter.stream
    ? buildAnthropicSseBody(adapter.model, payload.text, payload.deltas, payload.usage)
    : buildAnthropicJsonBody(adapter.model, payload.text, payload.usage);
}

function toAnyRouterAdapter(
  adapter: Exclude<ChyApiResponseAdapter, { type: 'transparent' | 'claudeMessages' }>
): AnyRouterResponseAdapter {
  if (adapter.type === 'codexResponses') {
    return { type: 'codexResponses', model: adapter.model, stream: adapter.stream };
  }

  return { type: 'geminiGenerateContent', model: adapter.model, stream: adapter.stream };
}

export function transformChyApiResponse(params: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  adapter: ChyApiResponseAdapter;
}): AnyRouterResponseTransformResult {
  if (
    params.adapter.type === 'transparent' ||
    params.statusCode < 200 ||
    params.statusCode >= 300
  ) {
    return { body: params.body, headers: params.headers };
  }

  const payload = extractOpenAiChatPayload(params.body);
  const anthropicBody = buildAnthropicResponseBuffer(params.adapter, payload);

  if (params.adapter.type === 'claudeMessages') {
    return replaceResponseBody(
      params.headers,
      anthropicBody,
      params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
    );
  }

  return transformAnyRouterResponse({
    body: anthropicBody,
    headers: params.headers,
    statusCode: params.statusCode,
    adapter: toAnyRouterAdapter(params.adapter),
  });
}
