export function normalizeApiKeyValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function isMaskedApiKeyValue(value: unknown): boolean {
  const normalized = normalizeApiKeyValue(value);
  if (!normalized) {
    return false;
  }

  return normalized.includes('*') || normalized.includes('...') || normalized.includes('…');
}

export function resolveApiKeyValue(apiKey: any): string | null {
  return normalizeApiKeyValue(apiKey?.key) || normalizeApiKeyValue(apiKey?.token);
}

export function asObjectPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isAuthFailureText(value: unknown): boolean {
  const text = String(value || '').toLowerCase();

  return (
    /http\s+(401|403)/i.test(text) ||
    text.includes('登录已过期') ||
    text.includes('登录过期') ||
    text.includes('未登录') ||
    text.includes('认证失败') ||
    text.includes('鉴权失败') ||
    text.includes('token has expired') ||
    text.includes('token expired') ||
    text.includes('token_expired') ||
    text.includes('jwt expired') ||
    text.includes('access token expired') ||
    text.includes('invalid access token') ||
    text.includes('invalid token') ||
    text.includes('unauthorized') ||
    text.includes('unauthenticated') ||
    text.includes('forbidden') ||
    text.includes('not login') ||
    text.includes('not logged in')
  );
}

export function isAuthFailureResponse(payload: unknown, status?: number): boolean {
  if (status === 401 || status === 403) {
    return true;
  }

  const data = asObjectPayload(payload);
  if (!data) {
    return false;
  }

  const code = String(data.code || data.status || '').toUpperCase();
  const authCodes = new Set([
    '401',
    '403',
    'TOKEN_EXPIRED',
    'UNAUTHORIZED',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'INVALID_TOKEN',
    'INVALID_ACCESS_TOKEN',
    'ACCESS_TOKEN_EXPIRED',
  ]);

  return (
    authCodes.has(code) ||
    isAuthFailureText(data.message) ||
    isAuthFailureText(data.msg) ||
    isAuthFailureText(data.error)
  );
}

export function getAuthFailurePayloadMessage(payload: unknown): string {
  const data = asObjectPayload(payload);
  const message = data?.message || data?.msg || data?.error || data?.code;
  return String(message || 'Unauthorized').trim();
}

export function buildLoginExpiredErrorMessage(source: string, payload?: unknown): string {
  return `登录已过期或未登录，请点击"重新获取"登录站点 (${source}返回: ${getAuthFailurePayloadMessage(payload)})`;
}

export function resolveApiKeyFetchId(apiKey: any): string | null {
  if (!apiKey || typeof apiKey !== 'object') {
    return null;
  }

  if (apiKey.id !== undefined && apiKey.id !== null) {
    return String(apiKey.id);
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return String(apiKey.token_id);
  }

  return null;
}

export function withResolvedApiKeyValue(apiKey: any, rawValue: string): any {
  if ('token' in apiKey && !('key' in apiKey)) {
    return { ...apiKey, token: rawValue };
  }

  return { ...apiKey, key: rawValue };
}

export function normalizeApiKeyGroup(group: unknown): string {
  if (typeof group !== 'string') {
    return 'default';
  }

  const normalized = group.trim();
  return normalized || 'default';
}

export function resolveCachedApiKeyIdentity(apiKey: any): string | null {
  if (!apiKey || typeof apiKey !== 'object') {
    return null;
  }

  if (apiKey.id !== undefined && apiKey.id !== null) {
    return `id:${String(apiKey.id)}`;
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return `token_id:${String(apiKey.token_id)}`;
  }

  const name = normalizeApiKeyValue(apiKey.name ?? apiKey.token_name);
  if (name) {
    return `name:${name}|group:${normalizeApiKeyGroup(apiKey.group)}`;
  }

  const rawValue = resolveApiKeyValue(apiKey);
  if (rawValue && !isMaskedApiKeyValue(rawValue)) {
    return `key:${rawValue}`;
  }

  return null;
}

export function mergeApiKeysPreservingRawValue(
  existingApiKeys: any[] | undefined,
  incomingApiKeys: any[] | undefined
): any[] | undefined {
  if (!Array.isArray(incomingApiKeys)) {
    return incomingApiKeys;
  }

  if (!Array.isArray(existingApiKeys) || existingApiKeys.length === 0) {
    return incomingApiKeys;
  }

  const preservedRawByIdentity = new Map<string, string>();

  for (const existingApiKey of existingApiKeys) {
    const identity = resolveCachedApiKeyIdentity(existingApiKey);
    const rawValue = resolveApiKeyValue(existingApiKey);
    if (!identity || !rawValue || isMaskedApiKeyValue(rawValue)) {
      continue;
    }
    preservedRawByIdentity.set(identity, rawValue);
  }

  if (preservedRawByIdentity.size === 0) {
    return incomingApiKeys;
  }

  return incomingApiKeys.map(apiKey => {
    const identity = resolveCachedApiKeyIdentity(apiKey);
    if (!identity) {
      return apiKey;
    }

    const incomingValue = resolveApiKeyValue(apiKey);
    if (incomingValue && !isMaskedApiKeyValue(incomingValue)) {
      return apiKey;
    }

    const preservedRaw = preservedRawByIdentity.get(identity);
    if (!preservedRaw) {
      return apiKey;
    }

    if ('token' in apiKey && !('key' in apiKey)) {
      return { ...apiKey, token: preservedRaw };
    }

    return { ...apiKey, key: preservedRaw };
  });
}
