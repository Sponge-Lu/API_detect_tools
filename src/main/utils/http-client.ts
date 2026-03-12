/**
 * 输入: HTTP 请求配置 (AxiosRequestConfig 兼容)
 * 输出: HTTP 响应数据（完整或流式首包）
 * 定位: 工具层 - 统一 HTTP 客户端，打包环境使用 Electron net，开发环境使用 axios；支持流式首包探测
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import axios, { AxiosRequestConfig } from 'axios';
import { app } from 'electron';
import { electronFetch, electronFetchStream, type StreamFetchResponse } from './electron-fetch';
import { Logger } from './logger';

const log = Logger.scope('HttpClient');

interface HttpResponse<T = any> {
  data: T;
  status: number;
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
