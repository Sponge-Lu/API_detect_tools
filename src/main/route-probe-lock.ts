import type { RouteCliType } from '../shared/types/route-proxy';
import { normalizeCliTargetProtocol, type CliTargetProtocol } from '../shared/types/cli-config';

const ROUTE_PROBE_LOCK_SEPARATOR = '.probe.';

export interface RouteProbeLock {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  canonicalModel: string;
  rawModel: string;
  targetProtocol?: CliTargetProtocol;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export function buildProbeLockRouteApiKey(unifiedApiKey: string, lock: RouteProbeLock): string {
  return `${unifiedApiKey}${ROUTE_PROBE_LOCK_SEPARATOR}${encodeBase64Url(
    JSON.stringify({
      ...lock,
      targetProtocol: normalizeCliTargetProtocol(lock.targetProtocol),
    })
  )}`;
}

export function parseProbeLockRouteApiKey(
  token: string,
  unifiedApiKey: string
): RouteProbeLock | null {
  if (token === unifiedApiKey) {
    return null;
  }

  const prefix = `${unifiedApiKey}${ROUTE_PROBE_LOCK_SEPARATOR}`;
  if (!token.startsWith(prefix)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(token.slice(prefix.length)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const cliType = record.cliType;
    const siteId = typeof record.siteId === 'string' ? record.siteId.trim() : '';
    const accountId = typeof record.accountId === 'string' ? record.accountId.trim() : '';
    const apiKeyId = typeof record.apiKeyId === 'string' ? record.apiKeyId.trim() : '';
    const canonicalModel =
      typeof record.canonicalModel === 'string' ? record.canonicalModel.trim() : '';
    const rawModel = typeof record.rawModel === 'string' ? record.rawModel.trim() : '';

    if (
      (cliType !== 'claudeCode' && cliType !== 'codex' && cliType !== 'geminiCli') ||
      !siteId ||
      !accountId ||
      !apiKeyId ||
      !canonicalModel ||
      !rawModel
    ) {
      return null;
    }

    return {
      siteId,
      accountId,
      apiKeyId,
      cliType,
      canonicalModel,
      rawModel,
      targetProtocol: normalizeCliTargetProtocol(record.targetProtocol),
      upstreamBaseUrl:
        typeof record.upstreamBaseUrl === 'string' ? record.upstreamBaseUrl.trim() : undefined,
      upstreamApiKey:
        typeof record.upstreamApiKey === 'string' ? record.upstreamApiKey.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) {
    return false;
  }

  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  );
}

export function buildRouteProxyBaseUrl(server: {
  host?: string | null;
  port?: number | null;
}): string {
  const host = (server.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number.isFinite(server.port) ? Number(server.port) : 3210;
  return `http://${host}:${port}`;
}
