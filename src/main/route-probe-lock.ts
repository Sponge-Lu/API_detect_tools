import type { RouteCliType } from '../shared/types/route-proxy';
import { normalizeCliTargetProtocol, type CliTargetProtocol } from '../shared/types/cli-config';

const ROUTE_PROBE_LOCK_SEPARATOR = '.probe.';
const TERMINAL_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_ATTEMPT_CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;

// Claude Code 一次探测会并发/退避重发多个上游请求；上限取 4 留出重试余量。
// 权衡：瞬时错误在上限内不消耗预算，故并发的 CLI 请求单次模型测试最多可计费 MAX 次真实上游调用。
export const MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS = 4;

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
type RouteProbeLockUpstreamResultListener = (result: RouteProbeLockUpstreamResult) => void;

const terminalFailureListeners = new Map<string, Set<RouteProbeLockTerminalFailureListener>>();
const requestListeners = new Map<string, Set<RouteProbeLockRequestListener>>();
const upstreamResultListeners = new Map<string, Set<RouteProbeLockUpstreamResultListener>>();
const terminalFailures = new Map<
  string,
  { failure: RouteProbeLockTerminalFailure; expiresAt: number }
>();
const upstreamAttempts = new Map<string, { count: number; settled: boolean; expiresAt: number }>();
const upstreamResults = new Map<
  string,
  { result: RouteProbeLockUpstreamResult; terminal: boolean; expiresAt: number }
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

// 仅返回已终结(成功/终结失败)的结果；可被覆盖的瞬时结果不视为终值。
function getTerminalRouteProbeLockUpstreamResult(
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

  return cached.terminal ? cached.result : undefined;
}

// 语义：终值优先(terminal-wins)、瞬时可覆盖(transient-overwritable)。
// - 已缓存终值：直接返回，不覆盖、不通知。
// - 否则写入新结果；仅终值 resolve 等待者，瞬时结果只更新缓存供同步读取，可被后续结果覆盖。
export function recordRouteProbeLockFirstUpstreamResult(
  result: RouteProbeLockUpstreamResult,
  opts?: { terminal?: boolean }
): RouteProbeLockUpstreamResult {
  const terminal = opts?.terminal ?? true;
  const cached = upstreamResults.get(result.routeApiKey);
  const existing = cached && cached.expiresAt > Date.now() ? cached : undefined;
  if (existing?.terminal) {
    return existing.result;
  }

  upstreamResults.set(result.routeApiKey, {
    result,
    terminal,
    expiresAt: Date.now() + UPSTREAM_RESULT_CACHE_TTL_MS,
  });

  if (terminal) {
    const listeners = upstreamResultListeners.get(result.routeApiKey);
    if (listeners?.size) {
      for (const listener of Array.from(listeners)) {
        listener(result);
      }
    }
  }

  return result;
}

export function waitForRouteProbeLockFirstUpstreamResult(
  routeApiKey: string,
  timeoutMs: number
): Promise<RouteProbeLockUpstreamResult | undefined> {
  const existing = getTerminalRouteProbeLockUpstreamResult(routeApiKey);
  if (existing || timeoutMs <= 0) {
    return Promise.resolve(existing);
  }

  return new Promise(resolve => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let listener: RouteProbeLockUpstreamResultListener = () => undefined;
    const listeners = upstreamResultListeners.get(routeApiKey) ?? new Set();

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        upstreamResultListeners.delete(routeApiKey);
      }
    };

    listener = result => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    listeners.add(listener);
    upstreamResultListeners.set(routeApiKey, listeners);

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(undefined);
    }, timeoutMs);

    const current = getTerminalRouteProbeLockUpstreamResult(routeApiKey);
    if (current) {
      listener(current);
    }
  });
}

export function beginRouteProbeLockUpstreamAttempt(routeApiKey: string): {
  allowed: boolean;
  attemptNumber: number;
  isFinalAttempt: boolean;
} {
  const existing = upstreamAttempts.get(routeApiKey);
  const now = Date.now();

  if (existing && existing.expiresAt <= now) {
    upstreamAttempts.delete(routeApiKey);
  }

  const current = upstreamAttempts.get(routeApiKey);
  if (current) {
    if (current.settled || current.count >= MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS) {
      return { allowed: false, attemptNumber: current.count, isFinalAttempt: true };
    }
    current.count += 1;
    current.expiresAt = now + UPSTREAM_ATTEMPT_CACHE_TTL_MS;
    return {
      allowed: true,
      attemptNumber: current.count,
      isFinalAttempt: current.count >= MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS,
    };
  }

  upstreamAttempts.set(routeApiKey, {
    count: 1,
    settled: false,
    expiresAt: now + UPSTREAM_ATTEMPT_CACHE_TTL_MS,
  });
  return {
    allowed: true,
    attemptNumber: 1,
    isFinalAttempt: MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS <= 1,
  };
}

export function settleRouteProbeLockUpstreamAttempt(routeApiKey: string): void {
  const existing = upstreamAttempts.get(routeApiKey);
  if (existing) {
    existing.settled = true;
    existing.expiresAt = Date.now() + UPSTREAM_ATTEMPT_CACHE_TTL_MS;
    return;
  }

  upstreamAttempts.set(routeApiKey, {
    count: 1,
    settled: true,
    expiresAt: Date.now() + UPSTREAM_ATTEMPT_CACHE_TTL_MS,
  });
}

export function hasRouteProbeLockUpstreamAttempt(routeApiKey: string): boolean {
  const existing = upstreamAttempts.get(routeApiKey);
  if (!existing) {
    return false;
  }

  if (existing.expiresAt <= Date.now()) {
    upstreamAttempts.delete(routeApiKey);
    return false;
  }

  return existing.count > 0;
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
