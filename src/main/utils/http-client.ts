/**
 * 输入: HTTP 请求配置 (AxiosRequestConfig 兼容，另支持 proxyUrl 上游代理)
 * 输出: HTTP 响应数据（JSON/文本、流式首包或 raw Buffer）
 * 定位: 工具层 - 开发与打包环境统一使用 Electron net；不可用时回退 axios，状态码策略保持一致；支持上游代理、流式首包探测和 raw 透明转发
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import axios, { AxiosRequestConfig } from 'axios';
import {
  electronFetch,
  electronFetchRaw,
  electronFetchRawStream,
  electronFetchStream,
  isElectronNetAvailable,
  normalizeProxyUrl,
  type RawFetchResponse,
  type RawFetchStreamStart,
  type StreamFetchResponse,
} from './electron-fetch';
import { Logger } from './logger';

const log = Logger.scope('HttpClient');

interface HttpResponse<T = any> {
  data: T;
  status: number;
}

/** 标准请求配置：在 AxiosRequestConfig 基础上支持上游代理（检测/刷新等直连请求可被站点级代理接管） */
export interface HttpRequestConfig extends AxiosRequestConfig {
  /** 上游代理地址（http/https/socks4/socks5），为空时直连 */
  proxyUrl?: string;
}

interface RawRequestConfig extends Omit<AxiosRequestConfig, 'data' | 'headers' | 'method'> {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Buffer | string;
  proxyUrl?: string;
  preferElectronNet?: boolean;
  signal?: AbortSignal;
}

interface RawStreamRequestConfig extends RawRequestConfig {
  streamIdleTimeout?: number;
  retainStreamedBody?: boolean;
  onResponse?: (response: RawFetchStreamStart) => boolean | void;
  onChunk?: (chunk: Buffer) => void | Promise<void>;
  shouldResolveOnAbort?: () => boolean;
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  firstByteLatencyMs?: number;
}

type ValidateStatus = (status: number) => boolean;

const RESOLVE_ALL_STATUSES: ValidateStatus = () => true;

function resolveValidateStatus(config?: AxiosRequestConfig): ValidateStatus {
  return config?.validateStatus ?? RESOLVE_ALL_STATUSES;
}

/** Electron net 对所有状态码 resolve；按调用方 validateStatus 策略恢复 axios 抛错语义，保证两栈行为一致 */
function assertStatusPolicy(
  status: number,
  statusText: string,
  data: any,
  headers: Record<string, string | string[]>,
  validateStatus: ValidateStatus
): void {
  if (validateStatus(status)) return;
  throw {
    name: 'AxiosError',
    message: `Request failed with status code ${status}`,
    isAxiosError: true,
    response: { status, statusText, data, headers },
  };
}

function shouldUseElectronNet(preferElectronNet?: boolean): boolean {
  return preferElectronNet !== false && isElectronNetAvailable();
}

function compactHeaders(
  headers: Record<string, string | string[] | undefined> = {}
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string | string[]] => {
      const value = entry[1];
      return typeof value === 'string' || Array.isArray(value);
    })
  );
}

function buildAxiosProxyConfig(proxyUrl?: string): AxiosRequestConfig['proxy'] | undefined {
  const normalizedProxyUrl = normalizeProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) return undefined;

  const parsed = new URL(normalizedProxyUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return undefined;
  }

  return {
    protocol: parsed.protocol.replace(':', ''),
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    auth:
      parsed.username || parsed.password
        ? {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          }
        : undefined,
  };
}

function normalizeAxiosResponseBody(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') return Buffer.from(data, 'utf-8');
  if (data === undefined || data === null) return Buffer.alloc(0);
  return Buffer.from(String(data), 'utf-8');
}

function normalizeAxiosResponseHeaders(headers: unknown): Record<string, string | string[]> {
  if (!headers || typeof headers !== 'object') return {};

  const normalized: Array<[string, string | string[]]> = [];

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') {
      normalized.push([key, value]);
    } else if (Array.isArray(value)) {
      normalized.push([key, value.map(item => String(item))]);
    } else if (value !== undefined && value !== null) {
      normalized.push([key, String(value)]);
    }
  }

  return Object.fromEntries(normalized);
}

function toRawHttpResponse(response: RawFetchResponse): RawHttpResponse {
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    firstByteLatencyMs: response.firstByteLatencyMs,
  };
}

/**
 * 发起 GET 请求
 */
export async function httpGet<T = any>(
  url: string,
  config?: HttpRequestConfig
): Promise<HttpResponse<T>> {
  const { proxyUrl, ...axiosConfig } = config || {};
  const timeout = axiosConfig.timeout || 30000;
  const headers = (axiosConfig.headers as Record<string, string>) || {};

  if (shouldUseElectronNet()) {
    log.debug('Using Electron net module for GET:', url);
    const res = await electronFetch<T>(url, {
      method: 'GET',
      headers,
      timeout,
      proxyUrl,
    });
    assertStatusPolicy(
      res.status,
      res.statusText,
      res.data,
      res.headers,
      resolveValidateStatus(config)
    );
    return { data: res.data, status: res.status };
  }
  // 非 Electron 环境保留相同的状态码策略。
  const res = await axios.get<T>(url, {
    ...axiosConfig,
    proxy: proxyUrl ? buildAxiosProxyConfig(proxyUrl) : axiosConfig.proxy,
    validateStatus: resolveValidateStatus(config),
  });
  return { data: res.data, status: res.status };
}

/**
 * 发起 POST 请求
 */
export async function httpPost<T = any>(
  url: string,
  data?: any,
  config?: HttpRequestConfig
): Promise<HttpResponse<T>> {
  const { proxyUrl, ...axiosConfig } = config || {};
  const timeout = axiosConfig.timeout || 30000;
  const headers = (axiosConfig.headers as Record<string, string>) || {};

  if (shouldUseElectronNet()) {
    log.debug('Using Electron net module for POST:', url);
    const res = await electronFetch<T>(url, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
      proxyUrl,
    });
    assertStatusPolicy(
      res.status,
      res.statusText,
      res.data,
      res.headers,
      resolveValidateStatus(config)
    );
    return { data: res.data, status: res.status };
  }
  const res = await axios.post<T>(url, data, {
    ...axiosConfig,
    proxy: proxyUrl ? buildAxiosProxyConfig(proxyUrl) : axiosConfig.proxy,
    validateStatus: resolveValidateStatus(config),
  });
  return { data: res.data, status: res.status };
}

/**
 * 流式 POST 请求：发送后只读取首个 chunk 即 abort，用于 CLI 兼容性探测
 */
export async function httpPostStream(
  url: string,
  data?: any,
  config?: HttpRequestConfig
): Promise<StreamFetchResponse> {
  const { proxyUrl, ...axiosConfig } = config || {};
  const timeout = axiosConfig.timeout || 30000;
  const headers = (axiosConfig.headers as Record<string, string>) || {};

  if (shouldUseElectronNet()) {
    log.debug('Using Electron net module for streaming POST:', url);
    return electronFetchStream(url, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
      proxyUrl,
    });
  }

  // 开发环境：axios + stream
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await axios.post<NodeJS.ReadableStream>(url, data, {
      ...axiosConfig,
      headers,
      timeout,
      signal: controller.signal,
      proxy: proxyUrl ? buildAxiosProxyConfig(proxyUrl) : axiosConfig.proxy,
      responseType: 'stream',
      validateStatus: () => true,
    });

    const stream = res.data as NodeJS.ReadableStream;
    const contentType = String(res.headers['content-type'] || '');

    return await new Promise<StreamFetchResponse>((resolve, reject) => {
      let settled = false;

      const done = (result: StreamFetchResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };

      stream.once('data', (chunk: Buffer | string) => {
        const firstChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        done({ status: res.status, firstChunk, contentType });
        controller.abort();
      });

      stream.once('end', () => {
        done({ status: res.status, firstChunk: '', contentType });
      });

      stream.on('error', (error: Error & { code?: string; name?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Raw HTTP 请求：保留完整响应体与响应头，用于透明转发。
 */
export async function httpRawRequest(
  url: string,
  config: RawRequestConfig = {}
): Promise<RawHttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 30000,
    proxyUrl,
    preferElectronNet,
    signal,
    ...axiosConfig
  } = config;
  const compactedHeaders = compactHeaders(headers);

  if (shouldUseElectronNet(preferElectronNet)) {
    log.debug(`Using Electron net module for raw ${method}:`, url);
    const res = await electronFetchRaw(url, {
      method,
      headers: compactedHeaders,
      body,
      timeout,
      proxyUrl,
      ...(signal ? { signal } : {}),
    });
    return toRawHttpResponse(res);
  }

  const res = await axios.request<ArrayBuffer | Buffer>({
    ...axiosConfig,
    method,
    url,
    data: body,
    headers: compactedHeaders,
    timeout,
    signal,
    proxy: buildAxiosProxyConfig(proxyUrl),
    responseType: 'arraybuffer',
    transformResponse: data => data,
    validateStatus: () => true,
  });

  return {
    status: res.status,
    headers: normalizeAxiosResponseHeaders(res.headers),
    body: normalizeAxiosResponseBody(res.data),
  };
}

async function consumeAxiosStreamResponse(
  res: {
    status: number;
    statusText?: string;
    headers: unknown;
    data: NodeJS.ReadableStream;
  },
  options: Pick<
    RawStreamRequestConfig,
    'onResponse' | 'onChunk' | 'timeout' | 'streamIdleTimeout' | 'retainStreamedBody'
  >
): Promise<RawHttpResponse> {
  const startedAt = Date.now();
  const headers = normalizeAxiosResponseHeaders(res.headers);
  const shouldStreamChunks =
    Boolean(options.onChunk) &&
    options.onResponse?.({ status: res.status, statusText: res.statusText || '', headers }) !==
      false;
  const retainBody = options.retainStreamedBody !== false || !shouldStreamChunks;

  return await new Promise<RawHttpResponse>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let firstByteLatencyMs: number | undefined;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const initialTimeoutMs = options.timeout ?? 30000;
    const activeStreamIdleTimeoutMs = options.streamIdleTimeout ?? initialTimeoutMs;

    const clearRequestTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearRequestTimeout();
      reject(error);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearRequestTimeout();
      resolve({
        status: res.status,
        headers,
        body: Buffer.concat(chunks),
        firstByteLatencyMs,
      });
    };

    const armIdleTimeout = (timeoutMs: number) => {
      if (timeoutMs <= 0 || settled) return;
      clearRequestTimeout();
      timeoutId = setTimeout(() => {
        const error = new Error(`Request timeout after ${timeoutMs}ms`);
        const destroyableStream = res.data as NodeJS.ReadableStream & {
          destroy?: (error?: Error) => void;
        };
        destroyableStream.destroy?.(error);
        rejectOnce(error);
      }, timeoutMs);
    };

    armIdleTimeout(initialTimeoutMs);

    res.data.on('data', (chunk: Buffer | string) => {
      if (firstByteLatencyMs === undefined) {
        firstByteLatencyMs = Date.now() - startedAt;
      }
      armIdleTimeout(activeStreamIdleTimeoutMs);

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (retainBody) chunks.push(buffer);

      if (!shouldStreamChunks || !options.onChunk) return;

      res.data.pause();
      Promise.resolve(options.onChunk(buffer)).then(
        () => {
          if (!settled) {
            res.data.resume();
          }
        },
        (error: unknown) => {
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

    res.data.once('end', resolveOnce);
    res.data.once('error', (error: Error) => rejectOnce(error));
  });
}

/**
 * Raw HTTP 流式请求：可在接收 chunk 时回调写下游，并按调用方需要保留完整 body。
 */
export async function httpRawStreamRequest(
  url: string,
  config: RawStreamRequestConfig = {}
): Promise<RawHttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 30000,
    streamIdleTimeout,
    retainStreamedBody,
    proxyUrl,
    preferElectronNet,
    signal,
    onResponse,
    onChunk,
    shouldResolveOnAbort,
    ...axiosConfig
  } = config;
  const compactedHeaders = compactHeaders(headers);

  if (shouldUseElectronNet(preferElectronNet)) {
    log.debug(`Using Electron net module for raw stream ${method}:`, url);
    const res = await electronFetchRawStream(url, {
      method,
      headers: compactedHeaders,
      body,
      timeout,
      streamIdleTimeout,
      proxyUrl,
      onResponse,
      onData: onChunk,
      ...(retainStreamedBody !== undefined ? { retainStreamedBody } : {}),
      ...(shouldResolveOnAbort !== undefined ? { shouldResolveOnAbort } : {}),
      ...(signal ? { signal } : {}),
    });
    return toRawHttpResponse(res);
  }

  const res = await axios.request<NodeJS.ReadableStream>({
    ...axiosConfig,
    method,
    url,
    data: body,
    headers: compactedHeaders,
    timeout,
    signal,
    proxy: buildAxiosProxyConfig(proxyUrl),
    responseType: 'stream',
    validateStatus: () => true,
  });

  return consumeAxiosStreamResponse(res, {
    timeout,
    streamIdleTimeout,
    retainStreamedBody,
    onResponse,
    onChunk,
  });
}

/**
 * 发起 DELETE 请求
 */
export async function httpDelete<T = any>(
  url: string,
  config?: HttpRequestConfig
): Promise<HttpResponse<T>> {
  const { proxyUrl, ...axiosConfig } = config || {};
  const timeout = axiosConfig.timeout || 30000;
  const headers = (axiosConfig.headers as Record<string, string>) || {};

  if (shouldUseElectronNet()) {
    log.debug('Using Electron net module for DELETE:', url);
    const res = await electronFetch<T>(url, {
      method: 'DELETE',
      headers,
      timeout,
      proxyUrl,
    });
    assertStatusPolicy(
      res.status,
      res.statusText,
      res.data,
      res.headers,
      resolveValidateStatus(config)
    );
    return { data: res.data, status: res.status };
  }
  const res = await axios.delete<T>(url, {
    ...axiosConfig,
    proxy: proxyUrl ? buildAxiosProxyConfig(proxyUrl) : axiosConfig.proxy,
    validateStatus: resolveValidateStatus(config),
  });
  return { data: res.data, status: res.status };
}

/**
 * 通用请求方法
 */
export async function httpRequest<T = any>(
  config: HttpRequestConfig & { url: string }
): Promise<HttpResponse<T>> {
  const { method = 'GET', url, data, timeout = 30000, headers = {}, proxyUrl, ...rest } = config;

  if (shouldUseElectronNet()) {
    log.debug(`Using Electron net module for ${method}:`, url);
    const res = await electronFetch<T>(url, {
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      headers: headers as Record<string, string>,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
      proxyUrl,
    });
    assertStatusPolicy(
      res.status,
      res.statusText,
      res.data,
      res.headers,
      resolveValidateStatus(config)
    );
    return { data: res.data, status: res.status };
  }
  const res = await axios.request<T>({
    ...rest,
    method,
    url,
    data,
    headers,
    timeout,
    proxy: proxyUrl ? buildAxiosProxyConfig(proxyUrl) : rest.proxy,
    validateStatus: resolveValidateStatus(config),
  });
  return { data: res.data, status: res.status };
}
