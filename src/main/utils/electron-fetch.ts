/**
 * 使用 Electron net 模块的 HTTP 客户端
 * 解决打包后 BoringSSL 与某些服务器 TLS 握手失败的问题
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
