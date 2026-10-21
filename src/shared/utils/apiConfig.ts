import type { RouteAuthScheme } from '../types/site';

export type ApiKeySource = 'remote' | 'local';

export function resolveApiKeyForUse(value: string, source: ApiKeySource = 'local'): string {
  const key = value.trim();
  if (!key || /\*|\.\.\.|…/.test(key)) return '';
  return source === 'remote' && !key.startsWith('sk-') ? `sk-${key}` : key;
}

export function buildApiKeyHeaders(
  apiKey: string,
  authScheme?: RouteAuthScheme
): Record<string, string> {
  return authScheme === 'x-api-key'
    ? { 'x-api-key': apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

export function buildVersionedApiUrl(baseUrl: string, endpoint = ''): string {
  const url = new URL(baseUrl.trim());
  let pathname = url.pathname.replace(/\/+$/, '');
  if (endpoint && pathname.endsWith(`/v1/${endpoint}`)) return url.toString();
  if (!/\/v1$/i.test(pathname)) pathname += '/v1';
  url.pathname = endpoint ? `${pathname}/${endpoint}` : pathname;
  return url.toString();
}
