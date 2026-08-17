import { createHash, randomUUID } from 'crypto';
import type * as http from 'http';
import { CLI_TARGET_PROTOCOLS, type CliTargetProtocol } from '../shared/types/cli-config';
import {
  ROUTE_AGENT_ID_HEADER,
  ROUTE_AGENT_NAME_HEADER,
  ROUTE_RUNTIME_SLOT_ID_HEADER,
  ROUTE_RUNTIME_SLOT_LABEL_HEADER,
  ROUTE_SESSION_ID_HEADER,
  DEFAULT_ROUTE_SESSION_EXTRACTION_RULES,
  normalizeRouteThinkingEffort,
  type RouteInstance,
  type RouteInstanceKey,
  type RouteInstanceUpdate,
  type RouteSessionActivity,
  type RouteSessionActivityState,
  type RouteSessionAssociationLevel,
  type RouteSessionCandidate,
  type RouteSessionExtractionRule,
  type RouteSessionIdentityLevel,
  type RouteSessionOverride,
  type RouteSessionRoutingConfig,
} from '../shared/types/route-proxy';
import type { ConfigSessionRecord } from '../shared/types/config-file-profile';

export interface RouteSessionIdentity {
  key: string;
  namespace: string;
  sessionId: string;
  associationLevel: RouteSessionAssociationLevel;
  sourceRuleId: string;
  identityLevel: RouteSessionIdentityLevel;
}

interface CandidateRuntime extends RouteSessionCandidate {
  valueHashes: Set<string>;
}

export type RouteSessionListScope = 'active' | 'recent' | 'history' | 'all';

const activityByKey = new Map<string, RouteSessionActivity>();
const candidatesByKey = new Map<string, CandidateRuntime>();
const CANDIDATE_NAME_PATTERN = /(session|conversation|thread|affinity)/i;
export const ROUTE_SESSION_CANDIDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROUTE_SESSION_CANDIDATE_MAX_COUNT = 256;
export const ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES = 64;

export interface ObservedRouteInstanceKey extends RouteInstanceKey {
  observedAgentName?: string;
  observedRuntimeSlotLabel?: string;
}

export interface RouteInstanceResolution {
  instance: RouteInstance | null;
  changed: boolean;
}

interface IdentityPartResolution {
  supplied: boolean;
  value: string | null;
}

const CODEX_WINDOW_ID_HEADER = 'x-codex-window-id';
const CODEX_SESSION_ID_HEADER = 'x-codex-session-id';
const CODEX_THREAD_ID_HEADER = 'x-codex-thread-id';
const CODEX_SESSION_SLOT_LABEL = 'Codex 会话';
const CLAUDE_CODE_SESSION_ID_HEADER = 'x-claude-code-session-id';
const CLAUDE_CODE_SESSION_SLOT_LABEL = 'Claude Code 会话';

function normalizeIdentityPart(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) return null;
  return Array.from(normalized).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })
    ? null
    : normalized;
}

function asIdentityRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveConsistentIdentityPart(values: unknown[]): IdentityPartResolution {
  const suppliedValues = values.filter(value => value !== undefined);
  if (suppliedValues.length === 0) return { supplied: false, value: null };

  const normalizedValues: string[] = [];
  for (const value of suppliedValues) {
    const normalized = normalizeIdentityPart(value);
    if (!normalized) return { supplied: true, value: null };
    normalizedValues.push(normalized);
  }

  const firstValue = normalizedValues[0];
  return {
    supplied: true,
    value: normalizedValues.every(value => value === firstValue) ? firstValue : null,
  };
}

function inferObservedAgentName(req: Pick<http.IncomingMessage, 'headers'>): string {
  const userAgent = normalizeIdentityPart(req.headers['user-agent'])?.toLowerCase() || '';
  if (userAgent.includes('opencode')) return 'OpenCode';
  if (userAgent.includes('pi-coding-agent') || userAgent.includes('pi-agent')) return 'Pi';
  if (userAgent.includes('grok')) return 'Grok Build';
  if (userAgent.includes('zcode')) return 'ZCode';
  return '通用 Agent';
}

function inferObservedProtocol(req: Pick<http.IncomingMessage, 'headers'>): CliTargetProtocol {
  const headers = req.headers;
  if (headers['anthropic-version'] || headers['x-api-key']) return 'anthropic-messages';
  return 'openai-responses';
}

function normalizeRouteInstanceKey(key: RouteInstanceKey): RouteInstanceKey {
  if (key.agentId !== 'codex') return key;

  const legacyWindowPrefix = `${key.sessionId}:`;
  const legacyWindowSuffix = key.runtimeSlotId.startsWith(legacyWindowPrefix)
    ? key.runtimeSlotId.slice(legacyWindowPrefix.length)
    : '';
  const usesSessionScopedSlot =
    key.runtimeSlotId === key.sessionId || /^\d+$/.test(legacyWindowSuffix);
  return usesSessionScopedSlot ? { ...key, runtimeSlotId: key.sessionId } : key;
}

function buildRouteInstanceKey(profileId: string | undefined, key: RouteInstanceKey): string {
  const normalized = normalizeRouteInstanceKey(key);
  return JSON.stringify([
    profileId || '',
    normalized.agentId,
    normalized.runtimeSlotId,
    normalized.sessionId,
  ]);
}

function buildRouteSlotKey(profileId: string | undefined, key: RouteInstanceKey): string {
  const normalized = normalizeRouteInstanceKey(key);
  return JSON.stringify([profileId || '', normalized.agentId, normalized.runtimeSlotId]);
}

function ensureRouteInstanceCollections(config: RouteSessionRoutingConfig): void {
  config.instances ||= {};
  config.currentRouteBySlot ||= {};
}

function firstRequestAt(instance: RouteInstance): number {
  return instance.createdAt ?? instance.lastRequestAt ?? Number.MAX_SAFE_INTEGER;
}

function lastRequestAt(instance: RouteInstance): number {
  return instance.lastRequestAt ?? instance.createdAt ?? 0;
}

function mergeDuplicateRouteInstance(target: RouteInstance, duplicate: RouteInstance): void {
  const targetLastRequestAt = lastRequestAt(target);
  const duplicateLastRequestAt = lastRequestAt(duplicate);
  const latest = duplicateLastRequestAt >= targetLastRequestAt ? duplicate : target;
  const targetCreatedAt = target.createdAt;
  const duplicateCreatedAt = duplicate.createdAt;

  if (
    targetCreatedAt === undefined ||
    (duplicateCreatedAt !== undefined && duplicateCreatedAt < targetCreatedAt)
  ) {
    target.createdAt = duplicateCreatedAt;
  }
  target.lastRequestAt = Math.max(targetLastRequestAt, duplicateLastRequestAt) || undefined;
  target.display.customAgentName ||= duplicate.display.customAgentName;
  target.display.customRuntimeSlotLabel ||= duplicate.display.customRuntimeSlotLabel;
  target.display.observedAgentName =
    latest.display.observedAgentName || target.display.observedAgentName;
  target.display.observedRuntimeSlotLabel =
    latest.display.observedRuntimeSlotLabel || target.display.observedRuntimeSlotLabel;

  if (target.routingState === 'active' || duplicate.routingState === 'active') {
    target.routingState = 'active';
    delete target.closedAt;
    delete target.closedReason;
  } else if (latest !== target) {
    target.routingState = latest.routingState;
    target.closedAt = latest.closedAt;
    target.closedReason = latest.closedReason;
  }

  if (target.presenceState === 'confirmed_open' || duplicate.presenceState === 'confirmed_open') {
    target.presenceState = 'confirmed_open';
  } else if (
    target.presenceState === 'confirmed_closed' &&
    duplicate.presenceState === 'confirmed_closed'
  ) {
    target.presenceState = 'confirmed_closed';
  } else {
    target.presenceState = 'unknown';
  }
}

export function normalizeRouteInstanceCollections(config: RouteSessionRoutingConfig): boolean {
  ensureRouteInstanceCollections(config);
  let changed = false;
  const normalizedInstances: Record<string, RouteInstance> = {};
  const instanceByRouteKey = new Map<string, RouteInstance>();
  const orderedInstances = Object.values(config.instances).sort(
    (left, right) => firstRequestAt(left) - firstRequestAt(right)
  );

  for (const instance of orderedInstances) {
    instance.display ||= {};
    if (!instance.routeKey) {
      normalizedInstances[instance.id] = instance;
      continue;
    }

    const normalizedKey = normalizeRouteInstanceKey(instance.routeKey);
    const isLegacyCodexWindowKey = normalizedKey.runtimeSlotId !== instance.routeKey.runtimeSlotId;
    if (isLegacyCodexWindowKey) {
      instance.routeKey = normalizedKey;
      instance.display.observedRuntimeSlotLabel ||= CODEX_SESSION_SLOT_LABEL;
      changed = true;
    }
    if (!isLegacyCodexWindowKey) {
      normalizedInstances[instance.id] = instance;
      continue;
    }
    const identity = buildRouteInstanceKey(instance.profileId, instance.routeKey);
    const existing = instanceByRouteKey.get(identity);
    if (!existing) {
      instanceByRouteKey.set(identity, instance);
      normalizedInstances[instance.id] = instance;
      continue;
    }

    mergeDuplicateRouteInstance(existing, instance);
    changed = true;
  }

  const currentRouteBySlot: Record<string, string> = {};
  const activeInstances = Object.values(normalizedInstances)
    .filter(instance => instance.routingState === 'active' && instance.routeKey)
    .sort((left, right) => lastRequestAt(left) - lastRequestAt(right));
  for (const instance of activeInstances) {
    const slotKey = buildRouteSlotKey(instance.profileId, instance.routeKey!);
    const previousId = currentRouteBySlot[slotKey];
    if (previousId && previousId !== instance.id) {
      const previous = normalizedInstances[previousId];
      if (previous) {
        previous.routingState = 'closed';
        previous.closedReason = 'replaced';
        previous.closedAt = instance.lastRequestAt || instance.createdAt || Date.now();
      }
      changed = true;
    }
    currentRouteBySlot[slotKey] = instance.id;
  }

  if (JSON.stringify(config.currentRouteBySlot) !== JSON.stringify(currentRouteBySlot)) {
    changed = true;
  }
  config.instances = normalizedInstances;
  config.currentRouteBySlot = currentRouteBySlot;
  return changed;
}

export function extractObservedRouteInstanceKey(
  req: Pick<http.IncomingMessage, 'headers'>,
  body?: unknown,
  extractionRules: RouteSessionExtractionRule[] = DEFAULT_ROUTE_SESSION_EXTRACTION_RULES,
  protocol?: CliTargetProtocol
): ObservedRouteInstanceKey | null {
  const explicitIdentityValues = [
    req.headers[ROUTE_AGENT_ID_HEADER],
    req.headers[ROUTE_RUNTIME_SLOT_ID_HEADER],
    req.headers[ROUTE_SESSION_ID_HEADER],
  ];
  if (explicitIdentityValues.some(value => value !== undefined)) {
    const agentId = normalizeIdentityPart(explicitIdentityValues[0]);
    const runtimeSlotId = normalizeIdentityPart(explicitIdentityValues[1]);
    const sessionId = normalizeIdentityPart(explicitIdentityValues[2]);
    if (!agentId || !runtimeSlotId || !sessionId) return null;
    return {
      agentId,
      runtimeSlotId,
      sessionId,
      observedAgentName: normalizeIdentityPart(req.headers[ROUTE_AGENT_NAME_HEADER]) || undefined,
      observedRuntimeSlotLabel:
        normalizeIdentityPart(req.headers[ROUTE_RUNTIME_SLOT_LABEL_HEADER]) || undefined,
    };
  }

  const claudeCodeSession = resolveConsistentIdentityPart([
    req.headers[CLAUDE_CODE_SESSION_ID_HEADER],
  ]);
  if (claudeCodeSession.supplied) {
    if (!claudeCodeSession.value) return null;
    return {
      agentId: 'claudeCode',
      runtimeSlotId: claudeCodeSession.value,
      sessionId: claudeCodeSession.value,
      observedAgentName: 'Claude Code',
      observedRuntimeSlotLabel: CLAUDE_CODE_SESSION_SLOT_LABEL,
    };
  }

  const bodyRecord = asIdentityRecord(body);
  const clientMetadata = asIdentityRecord(bodyRecord?.client_metadata);
  const runtimeSlot = resolveConsistentIdentityPart([
    req.headers[CODEX_WINDOW_ID_HEADER],
    clientMetadata?.[CODEX_WINDOW_ID_HEADER],
    clientMetadata?.window_id,
  ]);
  if (runtimeSlot.supplied) {
    if (!runtimeSlot.value) return null;
    const nativeSession = resolveConsistentIdentityPart([
      req.headers[CODEX_SESSION_ID_HEADER],
      clientMetadata?.session_id,
    ]);
    const nativeThread = nativeSession.supplied
      ? { supplied: false, value: null }
      : resolveConsistentIdentityPart([
          req.headers[CODEX_THREAD_ID_HEADER],
          clientMetadata?.thread_id,
        ]);
    const sessionId = nativeSession.supplied ? nativeSession.value : nativeThread.value;
    if (!sessionId) return null;
    return {
      agentId: 'codex',
      runtimeSlotId: sessionId,
      sessionId,
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: CODEX_SESSION_SLOT_LABEL,
    };
  }

  const genericIdentity = extractRouteSessionIdentity(
    req as Pick<http.IncomingMessage, 'headers' | 'url'>,
    body,
    extractionRules,
    protocol || inferObservedProtocol(req)
  );
  if (!genericIdentity) return null;
  const agentId = `session:${genericIdentity.namespace}`;
  return {
    agentId,
    runtimeSlotId: genericIdentity.sessionId,
    sessionId: genericIdentity.sessionId,
    observedAgentName: inferObservedAgentName(req),
    observedRuntimeSlotLabel: '会话级路由',
  };
}

export function listRouteInstances(config: RouteSessionRoutingConfig): RouteInstance[] {
  normalizeRouteInstanceCollections(config);
  return Object.values(config.instances || {}).sort((left, right) => {
    if (left.routingState === 'armed' && right.routingState !== 'armed') return -1;
    if (right.routingState === 'armed' && left.routingState !== 'armed') return 1;
    return (
      (right.lastRequestAt || right.createdAt || 0) - (left.lastRequestAt || left.createdAt || 0)
    );
  });
}

export function createArmedRouteInstance(
  config: RouteSessionRoutingConfig,
  modelId: string,
  reasoningEffort: string
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const normalizedModel = modelId.trim();
  const normalizedEffort = normalizeRouteThinkingEffort(reasoningEffort);
  if (!normalizedModel || !normalizedEffort) throw new Error('模型和思考强度不能为空');
  if (Object.values(config.instances || {}).some(item => item.routingState === 'armed')) {
    throw new Error('已有一个路由正在等待下一个新会话');
  }
  const instance: RouteInstance = {
    id: randomUUID(),
    display: {},
    modelId: normalizedModel,
    reasoningEffort: normalizedEffort,
    routingState: 'armed',
    presenceState: 'unknown',
  };
  config.instances[instance.id] = instance;
  return instance;
}

export function updateRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string,
  updates: RouteInstanceUpdate
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (!instance) throw new Error('路由实例不存在');
  if (updates.modelId !== undefined) {
    const modelId = updates.modelId.trim();
    if (!modelId) throw new Error('模型不能为空');
    instance.modelId = modelId;
  }
  if (updates.reasoningEffort !== undefined) {
    const effort = normalizeRouteThinkingEffort(updates.reasoningEffort);
    if (!effort) throw new Error('思考强度不能为空');
    instance.reasoningEffort = effort;
  }
  if (updates.customAgentName !== undefined) {
    instance.display.customAgentName = normalizeIdentityPart(updates.customAgentName) || undefined;
  }
  if (updates.customRuntimeSlotLabel !== undefined) {
    instance.display.customRuntimeSlotLabel =
      normalizeIdentityPart(updates.customRuntimeSlotLabel) || undefined;
  }
  return instance;
}

export function closeRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string,
  now = Date.now()
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (!instance || !instance.routeKey) throw new Error('已绑定的路由实例不存在');
  instance.routingState = 'closed';
  instance.closedReason = 'explicit';
  instance.closedAt = now;
  const slotKey = buildRouteSlotKey(instance.profileId, instance.routeKey);
  if (config.currentRouteBySlot[slotKey] === instance.id) delete config.currentRouteBySlot[slotKey];
  return instance;
}

export function cancelArmedRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (!instance || instance.routingState !== 'armed') throw new Error('等待中的路由实例不存在');
  instance.routingState = 'cancelled';
  return instance;
}

export function archiveRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string
): boolean {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (!instance || instance.routingState === 'active' || instance.routingState === 'armed') {
    return false;
  }
  delete config.instances[instanceId];
  return true;
}

export function resolveRouteInstanceForRequest(params: {
  config: RouteSessionRoutingConfig;
  profileId: string;
  observedKey: ObservedRouteInstanceKey | null;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  defaultModel: string;
  defaultReasoningEffort: string;
  requestAt: number;
}): RouteInstanceResolution {
  const { config, observedKey, profileId } = params;
  ensureRouteInstanceCollections(config);
  if (!observedKey) return { instance: null, changed: false };
  let changed = normalizeRouteInstanceCollections(config);
  const routeKey = buildRouteInstanceKey(profileId, observedKey);
  let instance = Object.values(config.instances).find(
    item =>
      item.routingState === 'active' &&
      item.profileId === profileId &&
      item.routeKey &&
      buildRouteInstanceKey(item.profileId, item.routeKey) === routeKey
  );
  if (!instance) {
    instance = Object.values(config.instances).find(item => item.routingState === 'armed');
    if (!instance) {
      const modelId = params.requestedModel?.trim() || params.defaultModel.trim();
      const reasoningEffort =
        normalizeRouteThinkingEffort(params.requestedReasoningEffort) ||
        normalizeRouteThinkingEffort(params.defaultReasoningEffort);
      if (!modelId || !reasoningEffort) return { instance: null, changed: false };
      instance = {
        id: randomUUID(),
        profileId,
        display: {},
        modelId,
        reasoningEffort,
        routingState: 'active',
        presenceState: 'unknown',
      };
      config.instances[instance.id] = instance;
    }
    instance.profileId = profileId;
    instance.routeKey = normalizeRouteInstanceKey({
      agentId: observedKey.agentId,
      runtimeSlotId: observedKey.runtimeSlotId,
      sessionId: observedKey.sessionId,
    });
    instance.createdAt = params.requestAt;
    changed = true;
  }
  if (
    observedKey.observedAgentName &&
    instance.display.observedAgentName !== observedKey.observedAgentName
  ) {
    instance.display.observedAgentName = observedKey.observedAgentName;
    changed = true;
  }
  if (
    observedKey.observedRuntimeSlotLabel &&
    instance.display.observedRuntimeSlotLabel !== observedKey.observedRuntimeSlotLabel
  ) {
    instance.display.observedRuntimeSlotLabel = observedKey.observedRuntimeSlotLabel;
    changed = true;
  }
  const slotKey = buildRouteSlotKey(profileId, observedKey);
  const previousId = config.currentRouteBySlot[slotKey];
  if (previousId && previousId !== instance.id) {
    const previous = config.instances[previousId];
    if (previous) {
      previous.routingState = 'closed';
      previous.closedReason = 'replaced';
      previous.closedAt = params.requestAt;
    }
    changed = true;
  }
  if (instance.routingState !== 'active') {
    instance.routingState = 'active';
    changed = true;
  }
  if (config.currentRouteBySlot[slotKey] !== instance.id) {
    config.currentRouteBySlot[slotKey] = instance.id;
    changed = true;
  }
  if (instance.lastRequestAt !== params.requestAt) {
    instance.lastRequestAt = params.requestAt;
  }
  return { instance, changed };
}

function normalizeAssociationLevel(
  value: unknown,
  fallback: RouteSessionAssociationLevel = 'exact'
): RouteSessionAssociationLevel {
  return ['exact', 'linked', 'probable', 'unidentified'].includes(String(value))
    ? (value as RouteSessionAssociationLevel)
    : fallback;
}

export function normalizeRouteSessionOverride(
  override: RouteSessionOverride,
  fallbackAssociationLevel: RouteSessionAssociationLevel = 'exact'
): RouteSessionOverride {
  const namespace = override.namespace.trim();
  const sessionId = override.sessionId.trim();
  if (!namespace || !sessionId) {
    throw new Error('Session namespace and ID are required');
  }
  return {
    ...override,
    key: `${namespace}:${sessionId}`,
    namespace,
    sessionId,
    displayName: override.displayName?.trim() || undefined,
    model: override.model?.trim() || null,
    thinkingEffort: normalizeRouteThinkingEffort(override.thinkingEffort),
    associationLevel: normalizeAssociationLevel(
      override.associationLevel,
      fallbackAssociationLevel
    ),
  };
}

export function clearRouteSessionActivities(key?: string): void {
  if (key) activityByKey.delete(key);
  else activityByKey.clear();
}

export function clearRouteSessionCandidates(): void {
  candidatesByKey.clear();
}

function normalizeValue(
  value: unknown,
  rule?: Pick<RouteSessionExtractionRule, 'minLength' | 'maxLength' | 'valuePattern'>
): string | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  const hasControlCharacter = Array.from(normalized).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  const minLength = Math.max(1, rule?.minLength || 1);
  const maxLength = Math.min(512, Math.max(minLength, rule?.maxLength || 512));
  if (
    !normalized ||
    normalized.length < minLength ||
    normalized.length > maxLength ||
    hasControlCharacter
  ) {
    return null;
  }
  if (rule?.valuePattern) {
    try {
      if (!new RegExp(rule.valuePattern).test(normalized)) return null;
    } catch {
      return null;
    }
  }
  return normalized;
}

function readJsonPath(value: unknown, pathname: string): unknown {
  let current = value;
  for (const segment of pathname
    .split('.')
    .map(item => item.trim())
    .filter(Boolean)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readRuleValue(
  rule: RouteSessionExtractionRule,
  req: Pick<http.IncomingMessage, 'headers' | 'url'>,
  body: unknown
): unknown {
  if (rule.source === 'header') return req.headers[rule.path.toLowerCase()];
  if (rule.source === 'query') {
    return new URL(req.url || '/', 'http://127.0.0.1').searchParams.get(rule.path);
  }
  return readJsonPath(body, rule.path);
}

export function normalizeRouteSessionRule(
  input: RouteSessionExtractionRule,
  previous?: RouteSessionExtractionRule
): RouteSessionExtractionRule {
  const now = Date.now();
  const source = input.source;
  const pathname = input.path.trim();
  const namespace = input.namespace.trim();
  const identityLevel = input.identityLevel || 'conversation';
  if (!input.id.trim() || !input.name.trim() || !namespace || !pathname) {
    throw new Error('会话规则名称、命名空间和提取路径不能为空');
  }
  if (!['header', 'query', 'json'].includes(source)) throw new Error('会话规则来源无效');
  if (!['conversation', 'window', 'agent', 'request'].includes(identityLevel)) {
    throw new Error('会话身份层级无效');
  }
  if (identityLevel === 'request') throw new Error('请求级 ID 不能作为会话路由身份');
  if (
    input.protocol &&
    input.protocol !== 'any' &&
    !CLI_TARGET_PROTOCOLS.includes(input.protocol)
  ) {
    throw new Error('会话规则协议无效');
  }
  const minLength = Math.max(1, Math.round(input.minLength || 1));
  const maxLength = Math.min(512, Math.max(minLength, Math.round(input.maxLength || 512)));
  const valuePattern = input.valuePattern?.trim() || undefined;
  if (valuePattern) {
    try {
      new RegExp(valuePattern);
    } catch {
      throw new Error('会话规则字符校验表达式无效');
    }
  }
  const version = previous ? (previous.version || 1) + 1 : Math.max(1, input.version || 1);
  const revisions = previous
    ? [
        ...(previous.revisions || []),
        {
          version: previous.version || 1,
          name: previous.name,
          enabled: previous.enabled,
          namespace: previous.namespace,
          source: previous.source,
          path: previous.path,
          protocol: previous.protocol,
          identityLevel: previous.identityLevel,
          priority: previous.priority,
          minLength: previous.minLength,
          maxLength: previous.maxLength,
          valuePattern: previous.valuePattern,
          updatedAt: previous.updatedAt || now,
        },
      ].slice(-20)
    : input.revisions || [];
  return {
    ...input,
    id: input.id.trim(),
    name: input.name.trim(),
    namespace,
    path: pathname,
    protocol: input.protocol || 'any',
    identityLevel,
    priority: Number.isFinite(input.priority) ? Math.round(input.priority || 0) : 0,
    minLength,
    maxLength,
    valuePattern,
    version,
    revisions,
    createdAt: previous?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
}

export function rollbackRouteSessionRule(
  rule: RouteSessionExtractionRule,
  version: number
): RouteSessionExtractionRule {
  const revision = rule.revisions?.find(item => item.version === version);
  if (!revision) throw new Error('找不到指定的规则版本');
  return normalizeRouteSessionRule(
    { ...rule, ...revision, version: rule.version, revisions: rule.revisions },
    rule
  );
}

export function extractRouteSessionIdentity(
  req: Pick<http.IncomingMessage, 'headers' | 'url'>,
  body: unknown,
  rules: RouteSessionExtractionRule[],
  protocol?: CliTargetProtocol
): RouteSessionIdentity | null {
  const ordered = [...rules].sort((left, right) => (right.priority || 0) - (left.priority || 0));
  for (const rule of ordered) {
    if (!rule.enabled) continue;
    if (protocol && rule.protocol && rule.protocol !== 'any' && rule.protocol !== protocol)
      continue;
    const identityLevel = rule.identityLevel || 'conversation';
    if (identityLevel !== 'conversation') continue;
    const sessionId = normalizeValue(readRuleValue(rule, req, body), rule);
    const namespace = rule.namespace.trim();
    if (!sessionId || !namespace) continue;
    return {
      key: `${namespace}:${sessionId}`,
      namespace,
      sessionId,
      associationLevel: 'exact',
      sourceRuleId: rule.id,
      identityLevel,
    };
  }
  return null;
}

function describeValueShape(value: string): string {
  const kind = /^[0-9a-f-]+$/i.test(value)
    ? 'hex-like'
    : /^[A-Za-z0-9_-]+$/.test(value)
      ? 'token-like'
      : 'text';
  return `${kind}; length=${value.length}`;
}

function observeCandidate(
  source: 'header' | 'query' | 'json',
  pathname: string,
  value: unknown,
  protocol: CliTargetProtocol,
  now: number
): void {
  pruneRouteSessionCandidates(now);
  const normalized = normalizeValue(value);
  if (!normalized) return;
  const key = `${source}:${pathname}:${protocol}`;
  const valueHash = createHash('sha256').update(normalized).digest('hex');
  const existing = candidatesByKey.get(key);
  if (!existing && candidatesByKey.size >= ROUTE_SESSION_CANDIDATE_MAX_COUNT) {
    const oldestKey = Array.from(candidatesByKey.entries()).reduce<string | null>(
      (oldest, [candidateKey, candidate]) =>
        !oldest || candidate.lastSeenAt < candidatesByKey.get(oldest)!.lastSeenAt
          ? candidateKey
          : oldest,
      null
    );
    if (oldestKey) candidatesByKey.delete(oldestKey);
  }
  const valueHashes = existing?.valueHashes || new Set<string>();
  if (
    valueHashes.has(valueHash) ||
    valueHashes.size < ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES
  ) {
    valueHashes.add(valueHash);
  }
  candidatesByKey.set(key, {
    key,
    source,
    path: pathname,
    protocol,
    valueShape: describeValueShape(normalized),
    observationCount: (existing?.observationCount || 0) + 1,
    distinctValueCount: valueHashes.size,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    valueHashes,
  });
}

function scanJsonCandidates(
  value: unknown,
  protocol: CliTargetProtocol,
  now: number,
  prefix = '',
  depth = 0
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const pathname = prefix ? `${prefix}.${key}` : key;
    if (CANDIDATE_NAME_PATTERN.test(key)) observeCandidate('json', pathname, nested, protocol, now);
    scanJsonCandidates(nested, protocol, now, pathname, depth + 1);
  }
}

export function discoverRouteSessionCandidates(
  req: Pick<http.IncomingMessage, 'headers' | 'url'>,
  body: unknown,
  protocol: CliTargetProtocol,
  now = Date.now()
): void {
  for (const [name, value] of Object.entries(req.headers)) {
    if (CANDIDATE_NAME_PATTERN.test(name)) observeCandidate('header', name, value, protocol, now);
  }
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  for (const [name, value] of requestUrl.searchParams) {
    if (CANDIDATE_NAME_PATTERN.test(name)) observeCandidate('query', name, value, protocol, now);
  }
  scanJsonCandidates(body, protocol, now);
}

function pruneRouteSessionCandidates(now: number): void {
  const expiresBefore = now - ROUTE_SESSION_CANDIDATE_TTL_MS;
  for (const [key, candidate] of candidatesByKey) {
    if (candidate.lastSeenAt < expiresBefore) candidatesByKey.delete(key);
  }
}

export function listRouteSessionCandidates(now = Date.now()): RouteSessionCandidate[] {
  pruneRouteSessionCandidates(now);
  return Array.from(candidatesByKey.values())
    .map(({ valueHashes: _valueHashes, ...candidate }) => candidate)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}

export function observeRouteSession(params: {
  identity: RouteSessionIdentity;
  config: RouteSessionRoutingConfig;
  protocol: CliTargetProtocol;
  requestedModel: string | null;
  clientLabel?: string;
  displayName?: string;
  now?: number;
}): RouteSessionActivity {
  const now = params.now ?? Date.now();
  const existing = activityByKey.get(params.identity.key);
  const override = params.config.overrides[params.identity.key];
  const activity: RouteSessionActivity = {
    key: params.identity.key,
    namespace: params.identity.namespace,
    sessionId: params.identity.sessionId,
    displayName: override?.displayName || params.displayName || existing?.displayName,
    model: override?.model ?? null,
    thinkingEffort: override?.thinkingEffort ?? null,
    updatedAt: override?.updatedAt ?? now,
    clientLabel: params.clientLabel || existing?.clientLabel,
    protocol: params.protocol,
    requestedModel: params.requestedModel,
    requestCount: (existing?.requestCount ?? 0) + 1,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    active: existing?.activityState === 'open',
    activityState: existing?.activityState || 'unknown',
    associationLevel: params.identity.associationLevel,
    sourceRuleId: params.identity.sourceRuleId,
  };
  activityByKey.set(activity.key, activity);
  return activity;
}

export function mergeRouteSessionRecords(
  records: ConfigSessionRecord[],
  config: RouteSessionRoutingConfig,
  now = Date.now(),
  scannedConnectorIds: Iterable<string> = records.map(record => record.connectorId)
): void {
  const scannedConnectors = new Set(scannedConnectorIds);
  const recordKeys = new Set(
    records.map(
      record => `${record.connectorId}:${record.namespace.trim()}:${record.sessionId.trim()}`
    )
  );
  for (const activity of activityByKey.values()) {
    if (
      activity.recordConnectorId &&
      scannedConnectors.has(activity.recordConnectorId) &&
      !recordKeys.has(`${activity.recordConnectorId}:${activity.key}`)
    ) {
      activity.active = false;
      activity.activityState = 'unknown';
    }
  }
  for (const record of records) {
    const namespace = record.namespace.trim();
    const sessionId = record.sessionId.trim();
    if (!namespace || !sessionId) continue;
    const key = `${namespace}:${sessionId}`;
    const existing = activityByKey.get(key);
    const override = config.overrides[key];
    const overrideAssociationLevel = override
      ? normalizeAssociationLevel(override.associationLevel)
      : 'probable';
    const associationLevel =
      existing?.associationLevel === 'exact' || existing?.associationLevel === 'linked'
        ? existing.associationLevel
        : overrideAssociationLevel === 'exact' || overrideAssociationLevel === 'linked'
          ? overrideAssociationLevel
          : 'probable';
    const activityState: RouteSessionActivityState =
      record.isOpen === true ? 'open' : record.isOpen === false ? 'closed' : 'unknown';
    activityByKey.set(key, {
      key,
      namespace,
      sessionId,
      displayName: override?.displayName || record.displayName || existing?.displayName,
      model: override?.model ?? existing?.model ?? null,
      thinkingEffort: override?.thinkingEffort ?? existing?.thinkingEffort ?? null,
      updatedAt: override?.updatedAt ?? existing?.updatedAt ?? now,
      clientLabel: existing?.clientLabel,
      workspace: record.workspace || existing?.workspace,
      protocol: existing?.protocol || 'native',
      requestedModel: existing?.requestedModel,
      requestCount: existing?.requestCount || 0,
      firstSeenAt: existing?.firstSeenAt || record.updatedAt || now,
      lastSeenAt: Math.max(existing?.lastSeenAt || 0, record.updatedAt || 0),
      active: activityState === 'open',
      activityState,
      associationLevel,
      sourceRuleId: existing?.sourceRuleId,
      recordConnectorId: record.connectorId,
    });
  }
}

export function getRouteSessionOverride(
  config: RouteSessionRoutingConfig,
  identity: RouteSessionIdentity | null
): RouteSessionOverride | null {
  if (!identity || !['exact', 'linked'].includes(identity.associationLevel)) return null;
  return config.overrides[identity.key] ?? null;
}

export function pruneRouteSessionActivities(
  config: RouteSessionRoutingConfig,
  now = Date.now()
): number {
  const retentionMs = Math.max(1, config.historyRetentionDays || 30) * 86_400_000;
  let removed = 0;
  for (const [key, activity] of activityByKey) {
    if (
      activity.activityState !== 'open' &&
      activity.lastSeenAt > 0 &&
      now - activity.lastSeenAt > retentionMs
    ) {
      activityByKey.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function listRouteSessionActivities(
  config: RouteSessionRoutingConfig,
  now = Date.now(),
  scope: RouteSessionListScope = 'active'
): RouteSessionActivity[] {
  pruneRouteSessionActivities(config, now);
  const recentWindowMs = Math.max(1, config.recentWindowHours || 24) * 3_600_000;
  const items = new Map(activityByKey);
  for (const override of Object.values(config.overrides)) {
    if (items.has(override.key)) continue;
    items.set(override.key, {
      ...override,
      protocol: 'native',
      requestCount: 0,
      firstSeenAt: override.updatedAt,
      lastSeenAt: 0,
      active: false,
      activityState: 'unknown',
      associationLevel: normalizeAssociationLevel(override.associationLevel),
    });
  }
  return Array.from(items.values())
    .map(item => {
      const override = config.overrides[item.key];
      const activityState = item.activityState || (item.active ? 'open' : 'unknown');
      return {
        ...item,
        displayName: override?.displayName || item.displayName,
        model: override?.model ?? null,
        thinkingEffort: override?.thinkingEffort ?? null,
        updatedAt: override?.updatedAt ?? item.updatedAt,
        associationLevel:
          override &&
          ['exact', 'linked'].includes(normalizeAssociationLevel(override.associationLevel))
            ? normalizeAssociationLevel(override.associationLevel)
            : item.associationLevel,
        active: activityState === 'open',
        activityState,
      };
    })
    .filter(item => {
      if (scope === 'all') return true;
      if (scope === 'active') return item.activityState === 'open';
      if (scope === 'recent')
        return (
          item.activityState !== 'open' &&
          item.lastSeenAt > 0 &&
          now - item.lastSeenAt <= recentWindowMs
        );
      return (
        item.activityState !== 'open' &&
        (item.lastSeenAt === 0 || now - item.lastSeenAt > recentWindowMs)
      );
    })
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}
