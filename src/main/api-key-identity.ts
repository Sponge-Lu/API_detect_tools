/**
 * API Key 标识工具
 * 输入: API Key 的持久化字段
 * 输出: 稳定的 API Key 标识
 * 定位: 中性凭证标识层，供路由、端点测试和配置服务共享
 */

import { createHash } from 'crypto';

export function resolveApiKeyId(apiKey: {
  id?: number | string;
  token_id?: number | string;
  key?: string;
  token?: string;
}): string {
  if (apiKey.id !== undefined && apiKey.id !== null) {
    return String(apiKey.id);
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return String(apiKey.token_id);
  }

  const raw = apiKey.key || apiKey.token || '';
  if (raw) {
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  return 'unknown';
}
