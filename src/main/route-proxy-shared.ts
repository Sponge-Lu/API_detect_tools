/**
 * 路由代理共享小工具
 * 定位: 工具层 - 请求路径/协议推断与通用取值，供代理各模块共用
 */

import type { CliTargetProtocol } from '../shared/types/cli-config';

export type ConcreteCliTargetProtocol = Exclude<CliTargetProtocol, 'native'>;

export function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

export function getRequestPathname(requestUrl: string | undefined): string {
  return (requestUrl || '/').split('?')[0] || '/';
}

export function inferSourceProtocol(
  requestUrl: string | undefined
): ConcreteCliTargetProtocol | null {
  const pathname = getRequestPathname(requestUrl);
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages/')) {
    return 'anthropic-messages';
  }
  if (
    pathname === '/v1/responses' ||
    pathname.startsWith('/v1/responses/') ||
    pathname === '/v1/conversations' ||
    pathname.startsWith('/v1/conversations/')
  ) {
    return 'openai-responses';
  }
  if (pathname === '/v1/chat/completions' || pathname.startsWith('/v1/chat/completions/')) {
    return 'openai-chat-completions';
  }
  return null;
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}
