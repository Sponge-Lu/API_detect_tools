/**
 * 输入: HTTP 请求配置 (URL, method, headers, body, timeout, proxyUrl)
 * 输出: HTTP 响应数据（JSON/文本、首 chunk 流式或 raw Buffer）
 * 定位: 工具层 - 使用 Electron net 模块的 HTTP 客户端，解决打包后 TLS 握手问题；支持流式首包探测、raw 透明转发和上游代理 session
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { net, session as electronSession, type Session } from 'electron';
import { Logger } from './logger';

const log = Logger.scope('ElectronFetch');

interface FetchOptions {
  method?: string;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
  timeout?: number;
  proxyUrl?: string;
}

interface FetchResponse<T = any> {
  status: number;
  statusText: string;
  data: T;
  headers: Record<string, string>;
}

export interface StreamFetchResponse {
  status: number;
  firstChunk: string;
  contentType: string;
}

export interface RawFetchResponse {
  status: number;
  statusText: string;
  body: Buffer;
  headers: Record<string, string | string[]>;
  firstByteLatencyMs?: number;
}

const proxySessionCache = new Map<string, Promise<Session>>();
const ELECTRON_FORBIDDEN_REQUEST_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'permissions-policy',
  'proxy-connection',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isElectronNetAvailable(): boolean {
  return typeof net?.request === 'function';
}

export function normalizeProxyUrl(proxyUrl?: string | null): string | undefined {
  const trimmed = proxyUrl?.trim();
  if (!trimmed) return undefined;

  const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return undefined;
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
      return undefined;
    }

    const auth =
      parsed.username || parsed.password
        ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
        : '';
    return `${parsed.protocol}//${auth}${parsed.host}`;
  } catch {
    return undefined;
  }
}

async function resolveProxySession(proxyUrl?: string): Promise<Session | undefined> {
  const proxyRules = normalizeProxyUrl(proxyUrl);
  if (!proxyRules) return undefined;
  if (typeof electronSession?.fromPartition !== 'function') {
    throw new Error('Electron session is unavailable for upstream proxy requests');
  }

  let sessionPromise = proxySessionCache.get(proxyRules);
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const partition = `route-upstream-proxy-${Buffer.from(proxyRules)
        .toString('base64url')
        .slice(0, 80)}`;
      const proxySession = electronSession.fromPartition(partition);
      await proxySession.setProxy({
        mode: 'fixed_servers',
        proxyRules,
      });
      return proxySession;
    })();
    proxySessionCache.set(proxyRules, sessionPromise);
  }

  return sessionPromise;
}

function createElectronRequestOptions(
  method: string,
  url: string,
  proxySession?: Session
): Electron.ClientRequestConstructorOptions {
  return proxySession ? { method, url, session: proxySession } : { method, url };
}

function writeRequestBody(request: Electron.ClientRequest, body?: string | Buffer): void {
  if (body === undefined || body.length === 0) return;
  request.write(body);
}

function normalizeRequestHeaderValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function isElectronForbiddenRequestHeader(key: string, value: string | string[]): boolean {
  const normalizedKey = key.toLowerCase();
  if (ELECTRON_FORBIDDEN_REQUEST_HEADERS.has(normalizedKey)) return true;
  if (normalizedKey.startsWith('proxy-') || normalizedKey.startsWith('sec-')) return true;
  return (
    normalizedKey === 'connection' && normalizeRequestHeaderValue(value).toLowerCase() === 'upgrade'
  );
}

function setElectronRequestHeaders(
  request: Electron.ClientRequest,
  headers: Record<string, string | string[]>
): void {
  for (const [key, value] of Object.entries(headers)) {
    if (isElectronForbiddenRequestHeader(key, value)) continue;
    request.setHeader(key, normalizeRequestHeaderValue(value));
  }
}

/**
 * 使用 Electron net 模块发起 HTTP 请求
 * 该模块使用 Chromium 网络栈，可以绕过 Node.js BoringSSL 的 TLS 限制
 */
export async function electronFetch<T = any>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResponse<T>> {
  const { method = 'GET', headers = {}, body, timeout = 30000, proxyUrl } = options;
  const proxySession = await resolveProxySession(proxyUrl);

  return new Promise((resolve, reject) => {
    const request = net.request(createElectronRequestOptions(method, url, proxySession));

    // 设置请求头
    setElectronRequestHeaders(request, headers);

    // 超时处理
    const timeoutId = setTimeout(() => {
      request.abort();
      reject(new Error(`Request timeout after ${timeout}ms`));
    }, timeout);

    let responseData = '';
    const responseHeaders: Record<string, string> = {};
    let statusCode = 0;
    let statusMessage = '';

    request.on('response', response => {
      statusCode = response.statusCode;
      statusMessage = response.statusMessage || '';

      // 收集响应头
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      }

      response.on('data', chunk => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        clearTimeout(timeoutId);

        let parsedData: T;
        try {
          parsedData = JSON.parse(responseData) as T;
        } catch {
          parsedData = responseData as unknown as T;
        }

        resolve({
          status: statusCode,
          statusText: statusMessage,
          data: parsedData,
          headers: responseHeaders,
        });
      });

      response.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    request.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      log.error('Request error:', error);
      reject(error);
    });

    // 发送请求体
    writeRequestBody(request, body);

    request.end();
  });
}

/**
 * 流式 HTTP 请求：只读取首个 data chunk 后 abort，用于 CLI 兼容性探测
 */
export async function electronFetchStream(
  url: string,
  options: FetchOptions = {}
): Promise<StreamFetchResponse> {
  const { method = 'GET', headers = {}, body, timeout = 30000, proxyUrl } = options;
  const proxySession = await resolveProxySession(proxyUrl);

  return new Promise((resolve, reject) => {
    const request = net.request(createElectronRequestOptions(method, url, proxySession));

    setElectronRequestHeaders(request, headers);

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      request.abort();
      reject(new Error(`Request timeout after ${timeout}ms`));
    }, timeout);

    request.on('response', response => {
      const ct =
        (response.headers['content-type'] as string) ??
        (response.headers['Content-Type'] as string) ??
        '';
      const contentType = Array.isArray(ct) ? ct.join(', ') : ct;

      response.once('data', chunk => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({ status: response.statusCode, firstChunk: chunk.toString('utf8'), contentType });
        request.abort();
      });

      response.once('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({ status: response.statusCode, firstChunk: '', contentType });
      });

      response.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    request.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      log.error('Stream request error:', error);
      reject(error);
    });

    writeRequestBody(request, body);
    request.end();
  });
}

/**
 * Raw HTTP 请求：保留完整响应体与响应头，用于本地路由代理透明转发。
 */
export async function electronFetchRaw(
  url: string,
  options: FetchOptions = {}
): Promise<RawFetchResponse> {
  const { method = 'GET', headers = {}, body, timeout = 30000, proxyUrl } = options;
  const proxySession = await resolveProxySession(proxyUrl);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const request = net.request(createElectronRequestOptions(method, url, proxySession));

    setElectronRequestHeaders(request, headers);

    const timeoutId = setTimeout(() => {
      request.abort();
      reject(new Error(`Request timeout after ${timeout}ms`));
    }, timeout);

    request.on('response', response => {
      const chunks: Buffer[] = [];
      let firstByteLatencyMs: number | undefined;
      const responseHeaders: Record<string, string | string[]> = {};

      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string' || Array.isArray(value)) {
          responseHeaders[key] = value;
        }
      }

      response.on('data', chunk => {
        if (firstByteLatencyMs === undefined) {
          firstByteLatencyMs = Date.now() - startedAt;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      response.on('end', () => {
        clearTimeout(timeoutId);
        resolve({
          status: response.statusCode,
          statusText: response.statusMessage || '',
          body: Buffer.concat(chunks),
          headers: responseHeaders,
          firstByteLatencyMs,
        });
      });

      response.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    request.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      log.error('Raw request error:', error);
      reject(error);
    });

    writeRequestBody(request, body);
    request.end();
  });
}

/**
 * GET 请求
 */
export async function electronGet<T = any>(
  url: string,
  headers?: Record<string, string>,
  timeout?: number
): Promise<FetchResponse<T>> {
  return electronFetch<T>(url, { method: 'GET', headers, timeout });
}

/**
 * POST 请求
 */
export async function electronPost<T = any>(
  url: string,
  data?: any,
  headers?: Record<string, string>,
  timeout?: number
): Promise<FetchResponse<T>> {
  const body = data ? JSON.stringify(data) : undefined;
  return electronFetch<T>(url, { method: 'POST', headers, body, timeout });
}
