/**
 * 输入: HTTP 请求配置 (URL, method, headers, body, timeout)
 * 输出: HTTP 响应数据（完整或首 chunk 流式）
 * 定位: 工具层 - 使用 Electron net 模块的 HTTP 客户端，解决打包后 TLS 握手问题；支持流式首包探测
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { net } from 'electron';
import { Logger } from './logger';

const log = Logger.scope('ElectronFetch');

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
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

/**
 * 使用 Electron net 模块发起 HTTP 请求
 * 该模块使用 Chromium 网络栈，可以绕过 Node.js BoringSSL 的 TLS 限制
 */
export async function electronFetch<T = any>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResponse<T>> {
  const { method = 'GET', headers = {}, body, timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
    });

    // 设置请求头
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

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
    if (body) {
      request.write(body);
    }

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
  const { method = 'GET', headers = {}, body, timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const request = net.request({ method, url });

    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

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

    if (body) request.write(body);
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
