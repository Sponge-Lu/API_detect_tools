// @vitest-environment node
/**
 * 上游转发器真实 socket 集成测试：用本地 HTTP 上游 + 本地代理，走 Node 传输路径，
 * 覆盖 SSE 分帧透传、上游中途截断、非流式 JSON 三种传输行为。
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// net/session 置空：让 http-client 走 Node 传输路径，请求真正经过本地 socket
vi.mock('electron', () => ({ app: { isPackaged: false }, net: undefined, session: undefined }));
vi.mock('../main/utils/logger', () => {
  const noop = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { default: { ...noop, scope: () => noop }, Logger: { ...noop, scope: () => noop } };
});

import { forwardToUpstream } from '../main/route-upstream-forwarder';

type UpstreamBehavior = 'sse-complete' | 'sse-truncated' | 'json';

const MESSAGE_START =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"usage":{"input_tokens":3,"output_tokens":0}}}\n\n';
const BLOCK_START =
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
const DELTA =
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n';
const BLOCK_STOP = 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n';
const MESSAGE_DELTA =
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n';
const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

let upstream: http.Server;
let proxy: http.Server;
let upstreamBase = '';
let proxyBase = '';
let lastForward: Awaited<ReturnType<typeof forwardToUpstream>> | Error | undefined;

function listen(server: http.Server): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    await readBody(req);
    const behavior = (req.headers['x-test-behavior'] as UpstreamBehavior) || 'json';
    if (behavior === 'json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 3, output_tokens: 2 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // 故意把 SSE 帧切在事件中间，验证分帧缓冲
    res.write(MESSAGE_START.slice(0, 20));
    await new Promise(r => setTimeout(r, 10));
    res.write(MESSAGE_START.slice(20) + BLOCK_START);
    await new Promise(r => setTimeout(r, 10));
    res.write(DELTA + BLOCK_STOP);
    await new Promise(r => setTimeout(r, 10));
    if (behavior === 'sse-truncated') {
      res.destroy();
      return;
    }
    res.end(MESSAGE_DELTA + MESSAGE_STOP);
  });
  upstreamBase = await listen(upstream);

  proxy = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const streaming = Boolean(JSON.parse(body.toString('utf-8')).stream);
    try {
      lastForward = await forwardToUpstream(
        req,
        upstreamBase,
        'sk-test',
        body,
        'claudeCode',
        5000,
        'm',
        {
          streamResponse: res,
          streamResponseBody: streaming,
          additionalHeaders: {
            'x-test-behavior': String(req.headers['x-test-behavior'] || 'json'),
          },
        }
      );
      if (lastForward.streamed) {
        if (!res.writableEnded) res.end();
        return;
      }
      res.writeHead(lastForward.statusCode, {
        'content-type': String(lastForward.headers['content-type'] || 'application/json'),
      });
      res.end(lastForward.body);
    } catch (error) {
      lastForward = error as Error;
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      if (!res.writableEnded) res.end(JSON.stringify({ error: String((error as Error).message) }));
    }
  });
  proxyBase = await listen(proxy);
});

afterAll(async () => {
  await Promise.all([
    new Promise(r => proxy.close(() => r(undefined))),
    new Promise(r => upstream.close(() => r(undefined))),
  ]);
});

function callProxy(
  behavior: UpstreamBehavior,
  stream: boolean
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${proxyBase}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'sk-route',
          'x-test-behavior': behavior,
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify({ model: 'm', max_tokens: 8, stream, messages: [] }));
  });
}

describe('route-upstream-forwarder over real sockets', () => {
  it('re-frames a split SSE stream byte-for-byte and extracts usage', async () => {
    const result = await callProxy('sse-complete', true);

    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/event-stream');
    expect(result.body).toBe(
      MESSAGE_START + BLOCK_START + DELTA + BLOCK_STOP + MESSAGE_DELTA + MESSAGE_STOP
    );
    expect(lastForward).toMatchObject({
      streamed: true,
      statusCode: 200,
      usage: { promptTokens: 3, completionTokens: 2 },
    });
  });

  it('appends a retryable SSE error when the upstream socket drops before message_stop', async () => {
    const result = await callProxy('sse-truncated', true);

    // 首字节已提交，下游状态码无法更改，只能靠终结错误事件告知客户端
    expect(result.status).toBe(200);
    expect(result.body.startsWith(MESSAGE_START + BLOCK_START + DELTA + BLOCK_STOP)).toBe(true);
    expect(result.body).toContain('event: error');
    expect(result.body).not.toContain('message_stop');
    expect(lastForward).toBeInstanceOf(Error);
    expect((lastForward as Error).message).toMatch(/missing_terminal_event|aborted|socket hang up/);
  });

  it('buffers non-streaming JSON and reports upstream usage', async () => {
    const result = await callProxy('json', false);

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ id: 'msg_1' });
    expect(lastForward).toMatchObject({
      streamed: false,
      usage: { promptTokens: 3, completionTokens: 2 },
    });
  });
});
