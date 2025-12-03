import Logger from './utils/logger';
/**
 * API请求助手类
 * 提供统一的API请求方法，兼容All API Hub的请求格式
 */

import type { ApiResponse } from './types/token';

export class ApiRequestHelper {
  /**
   * 创建兼容多站点的请求头
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param siteUrl 站点URL（可选，用于判断站点类型）
   * @returns 请求头对象
   */
  static createHeaders(
    userId: number,
    accessToken: string,
    siteUrl?: string
  ): Record<string, string> {
    // 基础请求头（所有站点通用）
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Pragma: 'no-cache',
    };

    // 根据站点URL判断类型，添加特定的User-ID头
    if (siteUrl) {
      const hostname = siteUrl.toLowerCase();

      if (hostname.includes('veloera') || hostname.includes('velo')) {
        // Veloera站点：只使用 Veloera-User
        headers['Veloera-User'] = userId.toString();
      } else if (hostname.includes('onehub') || hostname.includes('hub')) {
        // OneHub站点：使用 User-id
        headers['User-id'] = userId.toString();
      } else {
        // NewAPI及其他站点：使用 New-API-User
        headers['New-API-User'] = userId.toString();
      }
    } else {
      // 如果无法判断站点类型，使用NewAPI的头（最常见）
      headers['New-API-User'] = userId.toString();
    }

    return headers;
  }

  /**
   * 发送API请求
   * @param url 请求URL
   * @param options 请求选项
   * @returns 响应数据
   */
  static async request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'omit', // 不携带cookie，使用Bearer token
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ApiResponse<T>;
      return data;
    } catch (error: any) {
      Logger.error(`API请求失败 [${url}]:`, error);
      throw error;
    }
  }

  /**
   * 发送API请求并直接返回data字段
   * @param url 请求URL
   * @param options 请求选项
   * @returns 数据
   */
  static async requestData<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await this.request<T>(url, options);

    if (!response.success || response.data === undefined) {
      throw new Error(response.message || 'API请求失败');
    }

    return response.data;
  }

  /**
   * GET请求
   * @param url 请求URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param siteUrl 站点URL（可选）
   * @returns 数据
   */
  static async get<T>(
    url: string,
    userId: number,
    accessToken: string,
    siteUrl?: string
  ): Promise<T> {
    return this.requestData<T>(url, {
      method: 'GET',
      headers: this.createHeaders(userId, accessToken, siteUrl),
    });
  }

  /**
   * POST请求
   * @param url 请求URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param body 请求体
   * @param siteUrl 站点URL（可选）
   * @returns 数据
   */
  static async post<T>(
    url: string,
    userId: number,
    accessToken: string,
    body?: any,
    siteUrl?: string
  ): Promise<T> {
    return this.requestData<T>(url, {
      method: 'POST',
      headers: this.createHeaders(userId, accessToken, siteUrl),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PUT请求
   * @param url 请求URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param body 请求体
   * @param siteUrl 站点URL（可选）
   * @returns 数据
   */
  static async put<T>(
    url: string,
    userId: number,
    accessToken: string,
    body?: any,
    siteUrl?: string
  ): Promise<T> {
    return this.requestData<T>(url, {
      method: 'PUT',
      headers: this.createHeaders(userId, accessToken, siteUrl),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * DELETE请求
   * @param url 请求URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param siteUrl 站点URL（可选）
   * @returns 数据
   */
  static async delete<T>(
    url: string,
    userId: number,
    accessToken: string,
    siteUrl?: string
  ): Promise<T> {
    return this.requestData<T>(url, {
      method: 'DELETE',
      headers: this.createHeaders(userId, accessToken, siteUrl),
    });
  }
}
