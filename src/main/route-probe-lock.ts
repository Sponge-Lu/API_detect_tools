import type { RouteCliType } from '../shared/types/route-proxy';
import { normalizeCliTargetProtocol, type CliTargetProtocol } from '../shared/types/cli-config';

const ROUTE_PROBE_LOCK_SEPARATOR = '.probe.';
const TERMINAL_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_ATTEMPT_CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface RouteProbeLock {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  probeRunId?: string;
  canonicalModel: string;
  rawModel: string;
  targetProtocol?: CliTargetProtocol;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
}

export interface RouteProbeLockTerminalFailure {
  routeApiKey: string;
  cliType: RouteCliType;
  statusCode?: number;
  terminalError: string;
  lock?: RouteProbeLock;
}

export interface RouteProbeLockUpstreamResult {
  routeApiKey: string;
  cliType: RouteCliType;
  statusCode?: number;
  success: boolean;
  responseSummary?: string;
  error?: string;
  finishedAt: number;
  lock?: RouteProbeLock;
}

type RouteProbeLockTerminalFailureListener = (failure: RouteProbeLockTerminalFailure) => void;
type RouteProbeLockRequestListener = () => void;

const terminalFailureListeners = new Map<string, Set<RouteProbeLockTerminalFailureListener>>();
const requestListeners = new Map<string, Set<RouteProbeLockRequestListener>>();
const terminalFailures = new Map<
  string,
  { failure: RouteProbeLockTerminalFailure; expiresAt: number }
>();
const upstreamAttempts = new Map<string, { expiresAt: number }>();
const upstreamResults = new Map<
  string,
  { result: RouteProbeLockUpstreamResult; expiresAt: number }
>();

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

export function subscribeRouteProbeLockTerminalFailure(
  routeApiKey: string,
  listener: RouteProbeLockTerminalFailureListener
): () => void {
  const listeners = terminalFailureListeners.get(routeApiKey) ?? new Set();
  listeners.add(listener);
  terminalFailureListeners.set(routeApiKey, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      terminalFailureListeners.delete(routeApiKey);
    }
  };
}

export function clearRouteProbeLockTerminalFailure(routeApiKey: string): void {
  terminalFailures.delete(routeApiKey);
  upstreamAttempts.delete(routeApiKey);
  upstreamResults.delete(routeApiKey);
}

export function subscribeRouteProbeLockRequest(
  routeApiKey: string,
  listener: RouteProbeLockRequestListener
): () => void {
  const listeners = requestListeners.get(routeApiKey) ?? new Set();
  listeners.add(listener);
  requestListeners.set(routeApiKey, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      requestListeners.delete(routeApiKey);
    }
  };
}

export function notifyRouteProbeLockRequest(routeApiKey: string): void {
  const listeners = requestListeners.get(routeApiKey);
  if (!listeners?.size) {
    return;
  }

  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function getRouteProbeLockTerminalFailure(
  routeApiKey: string
): RouteProbeLockTerminalFailure | undefined {
  const cached = terminalFailures.get(routeApiKey);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    terminalFailures.delete(routeApiKey);
    return undefined;
  }

  return cached.failure;
}

export function notifyRouteProbeLockTerminalFailure(failure: RouteProbeLockTerminalFailure): void {
  terminalFailures.set(failure.routeApiKey, {
    failure,
    expiresAt: Date.now() + TERMINAL_FAILURE_CACHE_TTL_MS,
  });

  const listeners = terminalFailureListeners.get(failure.routeApiKey);
  if (!listeners?.size) {
    return;
  }

  for (const listener of Array.from(listeners)) {
    listener(failure);
  }
}

export function getRouteProbeLockFirstUpstreamResult(
  routeApiKey: string
): RouteProbeLockUpstreamResult | undefined {
  const cached = upstreamResults.get(routeApiKey);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    upstreamResults.delete(routeApiKey);
    return undefined;
  }

  return cached.result;
}

export function recordRouteProbeLockFirstUpstreamResult(
  result: RouteProbeLockUpstreamResult
): RouteProbeLockUpstreamResult {
  const existing = getRouteProbeLockFirstUpstreamResult(result.routeApiKey);
  if (existing) {
    return existing;
  }

  upstreamResults.set(result.routeApiKey, {
    result,
    expiresAt: Date.now() + UPSTREAM_RESULT_CACHE_TTL_MS,
  });
  return result;
}

export function consumeRouteProbeLockUpstreamAttempt(routeApiKey: string): boolean {
  const existing = upstreamAttempts.get(routeApiKey);
  if (existing) {
    if (existing.expiresAt > Date.now()) {
      return false;
    }
    upstreamAttempts.delete(routeApiKey);
  }

  upstreamAttempts.set(routeApiKey, {
    expiresAt: Date.now() + UPSTREAM_ATTEMPT_CACHE_TTL_MS,
  });
  return true;
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
    const probeRunId = typeof record.probeRunId === 'string' ? record.probeRunId.trim() : '';
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
      probeRunId: probeRunId || undefined,
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
