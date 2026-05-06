/**
 * 输入: HTTP 请求配置 (AxiosRequestConfig 兼容)
 * 输出: HTTP 响应数据（JSON/文本、流式首包或 raw Buffer）
 * 定位: 工具层 - 统一 HTTP 客户端，打包环境使用 Electron net，开发环境使用 axios；支持流式首包探测、raw 透明转发和上游代理
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import axios, { AxiosRequestConfig } from 'axios';
import { app } from 'electron';
import {
  electronFetch,
  electronFetchRaw,
  electronFetchStream,
  isElectronNetAvailable,
  normalizeProxyUrl,
  type RawFetchResponse,
  type StreamFetchResponse,
} from './electron-fetch';
import { Logger } from './logger';

const log = Logger.scope('HttpClient');

interface HttpResponse<T = any> {
  data: T;
  status: number;
}

interface RawRequestConfig extends Omit<AxiosRequestConfig, 'data' | 'headers' | 'method'> {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Buffer | string;
  proxyUrl?: string;
  preferElectronNet?: boolean;
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  firstByteLatencyMs?: number;
}

function shouldUseElectronNet(preferElectronNet?: boolean): boolean {
  return isElectronNetAvailable() && (preferElectronNet === true || Boolean(app?.isPackaged));
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
  config?: AxiosRequestConfig
): Promise<HttpResponse<T>> {
  const timeout = config?.timeout || 30000;
  const headers = (config?.headers as Record<string, string>) || {};

  if (app.isPackaged) {
    log.debug('Using Electron net module for GET:', url);
    const res = await electronFetch<T>(url, {
      method: 'GET',
      headers,
      timeout,
    });
    return { data: res.data, status: res.status };
  } else {
    // 开发环境使用 axios，配置 validateStatus 以接收所有状态码
    const res = await axios.get<T>(url, {
      ...config,
      validateStatus: () => true, // 接收所有状态码，不抛出异常
    });
    return { data: res.data, status: res.status };
  }
}

/**
 * 发起 POST 请求
 */
export async function httpPost<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<HttpResponse<T>> {
  const timeout = config?.timeout || 30000;
  const headers = (config?.headers as Record<string, string>) || {};

  if (app.isPackaged) {
    log.debug('Using Electron net module for POST:', url);
    const res = await electronFetch<T>(url, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
    });
    return { data: res.data, status: res.status };
  } else {
    const res = await axios.post<T>(url, data, config);
    return { data: res.data, status: res.status };
  }
}

/**
 * 流式 POST 请求：发送后只读取首个 chunk 即 abort，用于 CLI 兼容性探测
 */
export async function httpPostStream(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<StreamFetchResponse> {
  const timeout = config?.timeout || 30000;
  const headers = (config?.headers as Record<string, string>) || {};

  if (app.isPackaged) {
    log.debug('Using Electron net module for streaming POST:', url);
    return electronFetchStream(url, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
    });
  }

  // 开发环境：axios + stream
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await axios.post<NodeJS.ReadableStream>(url, data, {
      ...config,
      headers,
      timeout,
      signal: controller.signal,
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

/**
 * 发起 DELETE 请求
 */
export async function httpDelete<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<HttpResponse<T>> {
  const timeout = config?.timeout || 30000;
  const headers = (config?.headers as Record<string, string>) || {};

  if (app.isPackaged) {
    log.debug('Using Electron net module for DELETE:', url);
    const res = await electronFetch<T>(url, {
      method: 'DELETE',
      headers,
      timeout,
    });
    return { data: res.data, status: res.status };
  } else {
    const res = await axios.delete<T>(url, config);
    return { data: res.data, status: res.status };
  }
}

/**
 * 通用请求方法
 */
export async function httpRequest<T = any>(
  config: AxiosRequestConfig & { url: string }
): Promise<HttpResponse<T>> {
  const { method = 'GET', url, data, timeout = 30000, headers = {} } = config;

  if (app.isPackaged) {
    log.debug(`Using Electron net module for ${method}:`, url);
    const res = await electronFetch<T>(url, {
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      headers: headers as Record<string, string>,
      body: data ? JSON.stringify(data) : undefined,
      timeout,
    });
    return { data: res.data, status: res.status };
  } else {
    const res = await axios.request<T>(config);
    return { data: res.data, status: res.status };
  }
}
