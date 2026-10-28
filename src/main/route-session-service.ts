import { createHash, randomUUID } from 'crypto';
import type * as http from 'http';
import { CLI_TARGET_PROTOCOLS, type CliTargetProtocol } from '../shared/types/cli-config';
import {
  ROUTE_AGENT_ID_HEADER,
  ROUTE_AGENT_NAME_HEADER,
  ROUTE_CLI_MARKER_HEADER,
  ROUTE_CLI_MARKER_VALUES,
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
  lineage?: ObservedRouteLineage;
  observedAgentName?: string;
  observedRuntimeSlotLabel?: string;
}

export interface ObservedRouteLineage {
  source: 'codex' | 'claudeCode' | 'openCode';
  rootSessionId?: string;
  parentSessionId?: string;
  threadId?: string;
  requestKind?: string;
  forkedFromThreadId?: string;
  threadSource?: string;
  isUtility?: boolean;
}

export interface RouteInstanceResolution {
  instance: RouteInstance | null;
  changed: boolean;
  resolutionPath?:
    | 'client'
    | 'global-model'
    | 'exact'
    | 'parent'
    | 'parent-unresolved'
    | 'root-alias'
    | 'utility'
    | 'armed'
    | 'created';
  createdReason?: string;
  memberAppended?: boolean;
  utilityRequest?: boolean;
}

interface IdentityPartResolution {
  supplied: boolean;
  value: string | null;
}

const CODEX_WINDOW_ID_HEADER = 'x-codex-window-id';
const CODEX_SESSION_ID_HEADER = 'x-codex-session-id';
const CODEX_THREAD_ID_HEADER = 'x-codex-thread-id';
const CODEX_SESSION_COMPAT_HEADER = 'session-id';
const CODEX_THREAD_COMPAT_HEADER = 'thread-id';
const CODEX_PARENT_THREAD_ID_HEADER = 'x-codex-parent-thread-id';
const CODEX_TURN_METADATA_HEADER = 'x-codex-turn-metadata';
const CODEX_SUBAGENT_HEADER = 'x-openai-subagent';
const CODEX_SESSION_SLOT_LABEL = 'Codex 会话';
const CLAUDE_CODE_SESSION_ID_HEADER = 'x-claude-code-session-id';
const CLAUDE_CODE_AGENT_ID_HEADER = 'x-claude-code-agent-id';
const CLAUDE_CODE_PARENT_AGENT_ID_HEADER = 'x-claude-code-parent-agent-id';
const CLAUDE_CODE_SESSION_SLOT_LABEL = 'Claude Code 会话';
const OPEN_CODE_SESSION_ID_HEADER = 'x-session-affinity';
const OPEN_CODE_PARENT_SESSION_ID_HEADER = 'x-parent-session-id';
const DEEPSEEK_HARNESS_SESSION_ID_HEADER = 'x-deepseek-harness-session-id';
const CODEX_TURN_METADATA_MAX_LENGTH = 8_192;
const ROUTE_INSTANCE_MEMBER_SESSION_MAX_COUNT = 64;
const ROUTE_INSTANCE_PARENT_MAX_DEPTH = 32;

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

function claudeMetadataSession(body: unknown): IdentityPartResolution {
  const metadata = asIdentityRecord(asIdentityRecord(body)?.metadata);
  const userId = metadata?.user_id;
  if (typeof userId !== 'string' || userId.length > CODEX_TURN_METADATA_MAX_LENGTH) {
    return { supplied: false, value: null };
  }
  const record = parseBoundedIdentityRecord(userId);
  if (record?.session_id !== undefined) {
    return { supplied: true, value: normalizeIdentityPart(record.session_id) };
  }
  const match =
    /^user_[a-f\d]+_account_[^\r\n]*_session_([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.exec(
      userId
    );
  return { supplied: Boolean(match), value: match?.[1] || null };
}

function parseBoundedIdentityRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' || value.length > CODEX_TURN_METADATA_MAX_LENGTH) return null;
  try {
    return asIdentityRecord(JSON.parse(value));
  } catch {
    return null;
  }
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
  if (userAgent.includes('deepseek-harness')) return 'DeepSeek Harness';
  if (userAgent.includes('opencode')) return 'OpenCode';
  if (userAgent.includes('pi-coding-agent') || userAgent.includes('pi-agent')) return 'Pi';
  if (userAgent.includes('grok')) return 'Grok Build';
  if (userAgent.includes('zcode')) return 'ZCode';
  return '通用 Agent';
}

function requestMarker(req: Pick<http.IncomingMessage, 'headers'>): string {
  return normalizeIdentityPart(req.headers[ROUTE_CLI_MARKER_HEADER])?.toLowerCase() || '';
}

function userAgentIncludes(req: Pick<http.IncomingMessage, 'headers'>, fragment: string): boolean {
  return (normalizeIdentityPart(req.headers['user-agent'])?.toLowerCase() || '').includes(fragment);
}

function isLikelyCodexRequest(
  req: Pick<http.IncomingMessage, 'headers'>,
  clientMetadata: Record<string, unknown> | null
): boolean {
  return (
    requestMarker(req) === ROUTE_CLI_MARKER_VALUES.codex.toLowerCase() ||
    userAgentIncludes(req, 'codex') ||
    [
      req.headers[CODEX_WINDOW_ID_HEADER],
      req.headers[CODEX_SESSION_ID_HEADER],
      req.headers[CODEX_THREAD_ID_HEADER],
      req.headers[CODEX_SESSION_COMPAT_HEADER],
      req.headers[CODEX_THREAD_COMPAT_HEADER],
      req.headers[CODEX_PARENT_THREAD_ID_HEADER],
      req.headers[CODEX_TURN_METADATA_HEADER],
      req.headers[CODEX_SUBAGENT_HEADER],
      clientMetadata?.[CODEX_WINDOW_ID_HEADER],
      clientMetadata?.window_id,
      clientMetadata?.[CODEX_SESSION_COMPAT_HEADER],
      clientMetadata?.[CODEX_THREAD_COMPAT_HEADER],
      clientMetadata?.session_id,
      clientMetadata?.thread_id,
      clientMetadata?.[CODEX_PARENT_THREAD_ID_HEADER],
      clientMetadata?.parent_thread_id,
      clientMetadata?.[CODEX_TURN_METADATA_HEADER],
      clientMetadata?.[CODEX_SUBAGENT_HEADER],
    ].some(value => value !== undefined)
  );
}

function isLikelyOpenCodeRequest(req: Pick<http.IncomingMessage, 'headers'>): boolean {
  return (
    requestMarker(req) === ROUTE_CLI_MARKER_VALUES.openCode.toLowerCase() ||
    userAgentIncludes(req, 'opencode')
  );
}

export function isLikelyDeepSeekHarnessRequest(
  req: Pick<http.IncomingMessage, 'headers'>
): boolean {
  return (
    req.headers[DEEPSEEK_HARNESS_SESSION_ID_HEADER] !== undefined ||
    userAgentIncludes(req, 'deepseek-harness')
  );
}

export function hasObservedRouteInstanceEvidence(
  req: Pick<http.IncomingMessage, 'headers'>,
  body?: unknown
): boolean {
  const bodyRecord = asIdentityRecord(body);
  const clientMetadata = asIdentityRecord(bodyRecord?.client_metadata);
  if (
    [
      req.headers[ROUTE_AGENT_ID_HEADER],
      req.headers[ROUTE_RUNTIME_SLOT_ID_HEADER],
      req.headers[ROUTE_SESSION_ID_HEADER],
      req.headers[CLAUDE_CODE_SESSION_ID_HEADER],
      req.headers[CLAUDE_CODE_AGENT_ID_HEADER],
      req.headers[CLAUDE_CODE_PARENT_AGENT_ID_HEADER],
    ].some(value => value !== undefined)
  ) {
    return true;
  }
  if (
    isLikelyDeepSeekHarnessRequest(req) &&
    [
      req.headers[DEEPSEEK_HARNESS_SESSION_ID_HEADER],
      req.headers.session_id,
      req.headers['x-session-affinity'],
      req.headers['x-session-id'],
      req.headers['x-client-request-id'],
    ].some(value => value !== undefined)
  )
    return true;
  if (claudeMetadataSession(body).supplied || req.headers['x-grok-conv-id'] !== undefined)
    return true;
  if (isLikelyCodexRequest(req, clientMetadata)) return true;
  return (
    isLikelyOpenCodeRequest(req) &&
    [
      req.headers[OPEN_CODE_SESSION_ID_HEADER],
      req.headers[OPEN_CODE_PARENT_SESSION_ID_HEADER],
    ].some(value => value !== undefined)
  );
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

function normalizeMemberSessionIds(instance: RouteInstance): boolean {
  if (instance.memberSessionIds === undefined) return false;
  const values = Array.isArray(instance.memberSessionIds) ? instance.memberSessionIds : [];
  const normalized = Array.from(
    new Set(values.map(normalizeIdentityPart).filter((value): value is string => Boolean(value)))
  )
    .filter(value => value !== instance.routeKey?.sessionId)
    .slice(0, ROUTE_INSTANCE_MEMBER_SESSION_MAX_COUNT);
  if (JSON.stringify(instance.memberSessionIds) === JSON.stringify(normalized)) return false;
  if (normalized.length > 0) instance.memberSessionIds = normalized;
  else delete instance.memberSessionIds;
  return true;
}

function normalizeRouteInstanceLineageFields(instance: RouteInstance): boolean {
  let changed = false;
  if (instance.clientModelId !== undefined) {
    const clientModelId = normalizeIdentityPart(instance.clientModelId);
    if (clientModelId !== instance.clientModelId) {
      if (clientModelId) instance.clientModelId = clientModelId;
      else delete instance.clientModelId;
      changed = true;
    }
  }
  if (instance.parentInstanceId !== undefined) {
    const parentInstanceId = normalizeIdentityPart(instance.parentInstanceId);
    if (parentInstanceId !== instance.parentInstanceId) {
      if (parentInstanceId) instance.parentInstanceId = parentInstanceId;
      else delete instance.parentInstanceId;
      changed = true;
    }
  }
  if (
    instance.childOrdinal !== undefined &&
    (!Number.isSafeInteger(instance.childOrdinal) || instance.childOrdinal < 1)
  ) {
    delete instance.childOrdinal;
    changed = true;
  }
  return changed;
}

function appendMemberSessionId(instance: RouteInstance, value: string | undefined): boolean {
  const sessionId = normalizeIdentityPart(value);
  if (!sessionId || sessionId === instance.routeKey?.sessionId) return false;
  const existing = instance.memberSessionIds || [];
  if (existing.includes(sessionId) || existing.length >= ROUTE_INSTANCE_MEMBER_SESSION_MAX_COUNT) {
    return false;
  }
  instance.memberSessionIds = [...existing, sessionId];
  return true;
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
  target.display.customNote ||= duplicate.display.customNote;
  target.display.observedAgentName =
    latest.display.observedAgentName || target.display.observedAgentName;
  target.display.observedRuntimeSlotLabel =
    latest.display.observedRuntimeSlotLabel || target.display.observedRuntimeSlotLabel;
  target.clientModelId ||= duplicate.clientModelId;
  if (duplicate.pinned) target.pinned = true;
  target.parentInstanceId ||= duplicate.parentInstanceId;
  target.childOrdinal ||= duplicate.childOrdinal;
  for (const memberSessionId of duplicate.memberSessionIds || []) {
    appendMemberSessionId(target, memberSessionId);
  }

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

/**
 * 迁移：修复将 Codex 卡片身份从 thread_id 锚定到 session_id 后，
 * 同一会话可能同时存在旧卡（sessionId=thread_id）和新卡（sessionId=session_id）。
 * 通过 memberSessionIds 重叠检测合并它们：保留最新的一张，关闭其余。
 */
function closeDuplicateCodexSessionCards(instances: Record<string, RouteInstance>): boolean {
  let changed = false;
  const activeCodexInstances = Object.values(instances).filter(
    i => i.routingState === 'active' && i.routeKey?.agentId === 'codex' && i.profileId
  );
  if (activeCodexInstances.length <= 1) return false;

  // 按 profileId 分组
  const byProfile = new Map<string, RouteInstance[]>();
  for (const instance of activeCodexInstances) {
    const group = byProfile.get(instance.profileId!) || [];
    group.push(instance);
    byProfile.set(instance.profileId!, group);
  }

  for (const [, group] of byProfile) {
    if (group.length <= 1) continue;
    // 构建每个实例的会话标识集合（routeKey.sessionId + memberSessionIds）
    const sessionIds = group.map(instance => {
      const ids = new Set([instance.routeKey!.sessionId]);
      for (const sid of instance.memberSessionIds || []) ids.add(sid);
      return ids;
    });

    // 查找重叠组：两个实例共享任意 sessionId 即视为同一会话
    const visited = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [i];
      visited.add(i);
      for (let j = i + 1; j < group.length; j++) {
        if (visited.has(j)) continue;
        if ([...sessionIds[i]].some(id => sessionIds[j].has(id))) {
          cluster.push(j);
          visited.add(j);
        }
      }
      if (cluster.length <= 1) continue;

      // 保留最近活跃的，关闭其余，合并 member
      cluster.sort((a, b) => (group[b].lastRequestAt || 0) - (group[a].lastRequestAt || 0));
      const [keepIndex, ...restIndices] = cluster;
      const keep = group[keepIndex];
      for (const idx of restIndices) {
        const dup = group[idx];
        dup.routingState = 'closed';
        dup.closedReason = 'replaced';
        dup.closedAt = keep.lastRequestAt || Date.now();
        for (const sid of dup.memberSessionIds || []) {
          appendMemberSessionId(keep, sid);
        }
        appendMemberSessionId(keep, dup.routeKey!.sessionId);
        changed = true;
      }
    }
  }

  return changed;
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
    if (normalizeRouteInstanceLineageFields(instance)) changed = true;
    if (normalizeMemberSessionIds(instance)) changed = true;
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

  // 迁移：Codex 卡片身份从 thread_id 锚定到 session_id 后，同一会话可能同时存在
  // 旧卡（sessionId=thread_id）和新卡（sessionId=session_id）。通过 memberSessionIds
  // 重叠检测把它们合并，保留最新的一张，关闭其余。
  changed = closeDuplicateCodexSessionCards(normalizedInstances) || changed;

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

  if (isLikelyDeepSeekHarnessRequest(req)) {
    const nativeSession = req.headers[DEEPSEEK_HARNESS_SESSION_ID_HEADER];
    const session = resolveConsistentIdentityPart(
      nativeSession !== undefined
        ? [nativeSession]
        : [
            req.headers.session_id,
            req.headers['x-session-affinity'],
            req.headers['x-session-id'],
            ...((protocol || inferObservedProtocol(req)) === 'openai-responses'
              ? [req.headers['x-client-request-id']]
              : []),
          ]
    );
    if (session.supplied) {
      if (!session.value) return null;
      return {
        agentId: 'deepseekHarness',
        runtimeSlotId: session.value,
        sessionId: session.value,
        observedAgentName: 'DeepSeek Harness',
        observedRuntimeSlotLabel: '会话级路由',
      };
    }
  }

  const bodyRecord = asIdentityRecord(body);
  const clientMetadata = asIdentityRecord(bodyRecord?.client_metadata);
  if (isLikelyCodexRequest(req, clientMetadata)) {
    const turnMetadataValues = [
      req.headers[CODEX_TURN_METADATA_HEADER],
      clientMetadata?.[CODEX_TURN_METADATA_HEADER],
    ].filter(value => value !== undefined);
    const turnMetadataRecords: Record<string, unknown>[] = [];
    for (const value of turnMetadataValues) {
      const record = parseBoundedIdentityRecord(value);
      if (!record) return null;
      turnMetadataRecords.push(record);
    }

    const runtimeSlot = resolveConsistentIdentityPart([
      req.headers[CODEX_WINDOW_ID_HEADER],
      clientMetadata?.[CODEX_WINDOW_ID_HEADER],
      clientMetadata?.window_id,
    ]);
    if (runtimeSlot.supplied && !runtimeSlot.value) return null;
    const nativeSession = resolveConsistentIdentityPart([
      req.headers[CODEX_SESSION_COMPAT_HEADER],
      req.headers[CODEX_SESSION_ID_HEADER],
      clientMetadata?.session_id,
      ...turnMetadataRecords.map(record => record.session_id),
    ]);
    const nativeThread = resolveConsistentIdentityPart([
      req.headers[CODEX_THREAD_COMPAT_HEADER],
      req.headers[CODEX_THREAD_ID_HEADER],
      clientMetadata?.thread_id,
      ...turnMetadataRecords.map(record => record.thread_id),
    ]);
    const parentThread = resolveConsistentIdentityPart([
      req.headers[CODEX_PARENT_THREAD_ID_HEADER],
      clientMetadata?.[CODEX_PARENT_THREAD_ID_HEADER],
      clientMetadata?.parent_thread_id,
      ...turnMetadataRecords.map(record => record.parent_thread_id),
    ]);
    const subagentMarker = resolveConsistentIdentityPart([
      req.headers[CODEX_SUBAGENT_HEADER],
      clientMetadata?.[CODEX_SUBAGENT_HEADER],
    ]);
    const metadataFields = ['request_kind', 'forked_from_thread_id', 'thread_source'] as const;
    if (
      [clientMetadata, ...turnMetadataRecords].some(record =>
        metadataFields.some(
          field => record?.[field] !== undefined && typeof record[field] !== 'string'
        )
      )
    ) {
      return null;
    }
    const requestKind = resolveConsistentIdentityPart([
      clientMetadata?.request_kind,
      ...turnMetadataRecords.map(record => record.request_kind),
    ]);
    const forkedFromThread = resolveConsistentIdentityPart([
      clientMetadata?.forked_from_thread_id,
      ...turnMetadataRecords.map(record => record.forked_from_thread_id),
    ]);
    const threadSource = resolveConsistentIdentityPart([
      clientMetadata?.thread_source,
      ...turnMetadataRecords.map(record => record.thread_source),
    ]);
    if (
      (nativeSession.supplied && !nativeSession.value) ||
      (nativeThread.supplied && !nativeThread.value) ||
      (parentThread.supplied && !parentThread.value) ||
      (subagentMarker.supplied && !subagentMarker.value) ||
      (requestKind.supplied && !requestKind.value) ||
      (forkedFromThread.supplied && !forkedFromThread.value) ||
      (threadSource.supplied && !threadSource.value)
    ) {
      return null;
    }

    const hasSystemSubagentKind =
      threadSource.value === 'system' &&
      [clientMetadata, ...turnMetadataRecords].some(record => record?.subagent_kind !== undefined);
    if (hasSystemSubagentKind) {
      // A system request claiming subagent evidence must project one valid string kind across
      // every projection; malformed or conflicting kinds fail closed even with a parent chain.
      const hasMalformedSubagentKind = [clientMetadata, ...turnMetadataRecords].some(
        record => record?.subagent_kind !== undefined && typeof record.subagent_kind !== 'string'
      );
      const subagentKind = resolveConsistentIdentityPart([
        clientMetadata?.subagent_kind,
        ...turnMetadataRecords.map(record => record.subagent_kind),
      ]);
      if (hasMalformedSubagentKind || !subagentKind.value) return null;
    }
    const hasChildEvidence =
      parentThread.supplied || subagentMarker.supplied || hasSystemSubagentKind;
    if (hasChildEvidence && (!nativeThread.value || !parentThread.value)) return null;
    const isUtility = threadSource.value === 'system' && !hasChildEvidence;

    // When both identifiers are present, the session owns the card and the
    // thread identifies a history node or spawned task within that session.
    const sessionId = nativeSession.value || nativeThread.value;
    if (!sessionId) return null;
    if (parentThread.value && parentThread.value === nativeThread.value) return null;
    const rootSessionId = nativeSession.value;
    const hasLineage = Boolean(
      rootSessionId ||
        parentThread.value ||
        requestKind.value ||
        forkedFromThread.value ||
        threadSource.value
    );
    return {
      agentId: 'codex',
      runtimeSlotId: sessionId,
      sessionId,
      ...(hasLineage || (nativeThread.value && nativeThread.value !== sessionId)
        ? {
            lineage: {
              source: 'codex' as const,
              ...(rootSessionId ? { rootSessionId } : {}),
              ...(parentThread.value ? { parentSessionId: parentThread.value } : {}),
              ...(nativeThread.value && nativeThread.value !== sessionId
                ? { threadId: nativeThread.value }
                : {}),
              ...(requestKind.value ? { requestKind: requestKind.value } : {}),
              ...(forkedFromThread.value ? { forkedFromThreadId: forkedFromThread.value } : {}),
              ...(threadSource.value ? { threadSource: threadSource.value } : {}),
              ...(isUtility ? { isUtility: true } : {}),
            },
          }
        : {}),
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: CODEX_SESSION_SLOT_LABEL,
    };
  }

  const metadataSession = claudeMetadataSession(body);
  const claudeCodeSession = resolveConsistentIdentityPart([
    req.headers[CLAUDE_CODE_SESSION_ID_HEADER],
    ...(metadataSession.supplied ? [metadataSession.value] : []),
  ]);
  const claudeCodeAgent = resolveConsistentIdentityPart([req.headers[CLAUDE_CODE_AGENT_ID_HEADER]]);
  const claudeCodeParentAgent = resolveConsistentIdentityPart([
    req.headers[CLAUDE_CODE_PARENT_AGENT_ID_HEADER],
  ]);
  if (claudeCodeSession.supplied || claudeCodeAgent.supplied || claudeCodeParentAgent.supplied) {
    if (
      !claudeCodeSession.value ||
      (claudeCodeAgent.supplied && !claudeCodeAgent.value) ||
      (claudeCodeParentAgent.supplied && !claudeCodeParentAgent.value) ||
      (claudeCodeParentAgent.supplied && !claudeCodeAgent.value)
    ) {
      return null;
    }
    const sessionId = claudeCodeAgent.value || claudeCodeSession.value;
    const parentSessionId = claudeCodeAgent.value
      ? claudeCodeParentAgent.value || claudeCodeSession.value
      : undefined;
    if (parentSessionId === sessionId) return null;
    return {
      agentId: 'claudeCode',
      runtimeSlotId: sessionId,
      sessionId,
      lineage: {
        source: 'claudeCode',
        rootSessionId: claudeCodeSession.value,
        ...(parentSessionId ? { parentSessionId } : {}),
      },
      observedAgentName: 'Claude Code',
      observedRuntimeSlotLabel: CLAUDE_CODE_SESSION_SLOT_LABEL,
    };
  }

  if (isLikelyOpenCodeRequest(req)) {
    const openCodeSession = resolveConsistentIdentityPart([
      req.headers[OPEN_CODE_SESSION_ID_HEADER],
    ]);
    const openCodeParent = resolveConsistentIdentityPart([
      req.headers[OPEN_CODE_PARENT_SESSION_ID_HEADER],
    ]);
    if (openCodeSession.supplied || openCodeParent.supplied) {
      if (!openCodeSession.value || (openCodeParent.supplied && !openCodeParent.value)) return null;
      if (openCodeParent.value === openCodeSession.value) return null;
      return {
        agentId: 'session:session-affinity',
        runtimeSlotId: openCodeSession.value,
        sessionId: openCodeSession.value,
        lineage: {
          source: 'openCode',
          ...(openCodeParent.value
            ? { parentSessionId: openCodeParent.value }
            : { rootSessionId: openCodeSession.value }),
        },
        observedAgentName: 'OpenCode',
        observedRuntimeSlotLabel: '会话级路由',
      };
    }
  }

  if (req.headers['x-grok-conv-id'] !== undefined) {
    const sessionId = normalizeIdentityPart(req.headers['x-grok-conv-id']);
    if (!sessionId) return null;
    return {
      agentId: 'grokBuild',
      runtimeSlotId: sessionId,
      sessionId,
      observedAgentName: 'Grok Build',
      observedRuntimeSlotLabel: '会话级路由',
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
  // 创建顺序稳定排列（无时间戳的 ARMED/已取消卡视为最新，排在末尾），活动不改变卡片位置
  return Object.values(config.instances || {}).sort(
    (left, right) => firstRequestAt(left) - firstRequestAt(right)
  );
}

export function createArmedRouteInstance(
  config: RouteSessionRoutingConfig,
  modelId?: string,
  reasoningEffort?: string
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const normalizedModel = (modelId ?? '').trim();
  // 模型可留空（等待中在卡片上选择），思考强度缺省 medium
  const normalizedEffort = (reasoningEffort ?? '').trim()
    ? normalizeRouteThinkingEffort((reasoningEffort ?? '').trim())
    : 'medium';
  if (!normalizedEffort) throw new Error('思考强度不能为空');
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
  if (updates.pinned !== undefined) {
    if (typeof updates.pinned !== 'boolean') throw new Error('钉住状态无效');
  }
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
  if (updates.customNote !== undefined) {
    instance.display.customNote = updates.customNote?.trim() || undefined;
  }
  if (updates.pinned !== undefined) instance.pinned = updates.pinned;
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

/**
 * Reopens a terminated route card. Bound generations become the current active
 * route for their slot; an unbound cancelled pre-creation returns to ARMED so
 * the next complete identity can claim it.
 */
export function restoreRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string,
  now = Date.now()
): RouteInstance {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (!instance || (instance.routingState !== 'closed' && instance.routingState !== 'cancelled')) {
    throw new Error('可恢复的路由实例不存在');
  }

  if (!instance.routeKey) {
    if (
      Object.values(config.instances).some(
        item => item.id !== instance.id && item.routingState === 'armed'
      )
    ) {
      throw new Error('已有一个路由正在等待下一个新会话');
    }
    instance.routingState = 'armed';
    instance.presenceState = 'unknown';
    delete instance.closedAt;
    delete instance.closedReason;
    return instance;
  }

  const slotKey = buildRouteSlotKey(instance.profileId, instance.routeKey);
  for (const other of Object.values(config.instances)) {
    if (
      other.id === instance.id ||
      other.routingState !== 'active' ||
      !other.routeKey ||
      buildRouteSlotKey(other.profileId, other.routeKey) !== slotKey
    ) {
      continue;
    }
    other.routingState = 'closed';
    other.closedReason = 'replaced';
    other.closedAt = now;
  }
  instance.routingState = 'active';
  instance.presenceState = 'unknown';
  delete instance.closedAt;
  delete instance.closedReason;
  config.currentRouteBySlot[slotKey] = instance.id;
  return instance;
}

export function archiveRouteInstance(
  config: RouteSessionRoutingConfig,
  instanceId: string
): boolean {
  ensureRouteInstanceCollections(config);
  const instance = config.instances[instanceId];
  if (instance?.pinned) throw new Error('路由已钉住，请先取消钉住');
  if (!instance || instance.routingState === 'active' || instance.routingState === 'armed') {
    return false;
  }
  delete config.instances[instanceId];
  return true;
}

function resolveTopLevelRouteInstance(
  config: RouteSessionRoutingConfig,
  instance: RouteInstance,
  profileId: string,
  agentId: string
): RouteInstance | null {
  const visited = new Set<string>();
  let current = instance;
  for (let depth = 0; depth < ROUTE_INSTANCE_PARENT_MAX_DEPTH; depth += 1) {
    if (
      visited.has(current.id) ||
      current.routingState !== 'active' ||
      current.profileId !== profileId ||
      current.routeKey?.agentId !== agentId
    ) {
      return null;
    }
    visited.add(current.id);
    if (!current.parentInstanceId) return current;
    const parent = config.instances[current.parentInstanceId];
    if (!parent) return null;
    current = parent;
  }
  return null;
}

function findActiveTopLevelBySessionAlias(
  config: RouteSessionRoutingConfig,
  profileId: string,
  agentId: string,
  sessionId: string
): RouteInstance | null {
  const roots = new Map<string, RouteInstance>();
  for (const instance of Object.values(config.instances)) {
    if (
      instance.routingState !== 'active' ||
      instance.profileId !== profileId ||
      instance.routeKey?.agentId !== agentId ||
      (instance.routeKey.sessionId !== sessionId && !instance.memberSessionIds?.includes(sessionId))
    ) {
      continue;
    }
    const root = resolveTopLevelRouteInstance(config, instance, profileId, agentId);
    if (root) roots.set(root.id, root);
  }
  return roots.size === 1 ? Array.from(roots.values())[0] : null;
}

function resolveObservedParentInstance(
  config: RouteSessionRoutingConfig,
  profileId: string,
  observedKey: ObservedRouteInstanceKey
): RouteInstance | null {
  const rootSessionId = observedKey.lineage?.rootSessionId;
  const parentSessionId = observedKey.lineage?.parentSessionId;
  if (!parentSessionId) return null;

  const explicitRoot = rootSessionId
    ? findActiveTopLevelBySessionAlias(config, profileId, observedKey.agentId, rootSessionId)
    : null;
  if (rootSessionId && !explicitRoot && observedKey.agentId !== 'codex') return null;

  const immediateRoot = findActiveTopLevelBySessionAlias(
    config,
    profileId,
    observedKey.agentId,
    parentSessionId
  );
  if (explicitRoot && immediateRoot && explicitRoot.id !== immediateRoot.id) return null;
  return explicitRoot || immediateRoot;
}

function allocateChildOrdinal(config: RouteSessionRoutingConfig, parentInstanceId: string): number {
  return (
    Math.max(
      0,
      ...Object.values(config.instances)
        .filter(instance => instance.parentInstanceId === parentInstanceId)
        .map(instance =>
          Number.isSafeInteger(instance.childOrdinal) && (instance.childOrdinal || 0) > 0
            ? instance.childOrdinal || 0
            : 0
        )
    ) + 1
  );
}

function applyObservedInstanceState(params: {
  config: RouteSessionRoutingConfig;
  profileId: string;
  observedKey: ObservedRouteInstanceKey;
  instance: RouteInstance;
  requestAt: number;
  manageSlot: boolean;
}): boolean {
  const { config, profileId, observedKey, instance, requestAt, manageSlot } = params;
  let changed = false;
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
  if (manageSlot) {
    const slotKey = buildRouteSlotKey(profileId, observedKey);
    const previousId = config.currentRouteBySlot[slotKey];
    if (previousId && previousId !== instance.id) {
      const previous = config.instances[previousId];
      if (previous) {
        previous.routingState = 'closed';
        previous.closedReason = 'replaced';
        previous.closedAt = requestAt;
      }
      changed = true;
    }
    if (config.currentRouteBySlot[slotKey] !== instance.id) {
      config.currentRouteBySlot[slotKey] = instance.id;
      changed = true;
    }
  }
  if (instance.routingState !== 'active') {
    instance.routingState = 'active';
    changed = true;
  }
  if (instance.lastRequestAt !== requestAt) instance.lastRequestAt = requestAt;
  return changed;
}

function closeActiveChildForSession(
  config: RouteSessionRoutingConfig,
  root: RouteInstance,
  observedKey: ObservedRouteInstanceKey,
  requestAt: number
): boolean {
  let changed = false;
  for (const instance of Object.values(config.instances)) {
    if (
      instance.routingState !== 'active' ||
      instance.parentInstanceId !== root.id ||
      instance.profileId !== root.profileId ||
      instance.routeKey?.agentId !== observedKey.agentId ||
      instance.routeKey.sessionId !== observedKey.sessionId
    ) {
      continue;
    }
    instance.routingState = 'closed';
    instance.closedReason = 'replaced';
    instance.closedAt = requestAt;
    const slotKey = buildRouteSlotKey(instance.profileId, instance.routeKey);
    if (config.currentRouteBySlot[slotKey] === instance.id) {
      delete config.currentRouteBySlot[slotKey];
    }
    changed = true;
  }
  return changed;
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
  if (observedKey?.agentId === 'codex' && observedKey.lineage?.isUtility) {
    return {
      instance: null,
      changed: false,
      resolutionPath: 'utility',
      memberAppended: false,
      utilityRequest: true,
    };
  }
  ensureRouteInstanceCollections(config);
  if (!observedKey) return { instance: null, changed: false };
  let changed = normalizeRouteInstanceCollections(config);
  const requestedModel = normalizeIdentityPart(params.requestedModel);
  const routeKey = buildRouteInstanceKey(profileId, observedKey);
  let instance = Object.values(config.instances).find(
    item =>
      item.routingState === 'active' &&
      item.profileId === profileId &&
      item.routeKey &&
      buildRouteInstanceKey(item.profileId, item.routeKey) === routeKey
  );
  let resolutionPath: RouteInstanceResolution['resolutionPath'] = 'exact';
  let createdReason: string | undefined;
  const isChildRequest = Boolean(
    observedKey.lineage?.parentSessionId || observedKey.lineage?.forkedFromThreadId
  );

  if (observedKey.lineage?.parentSessionId) {
    if (observedKey.agentId === 'codex') {
      const parent = resolveObservedParentInstance(config, profileId, observedKey);
      if (parent) {
        let memberAppended = appendMemberSessionId(parent, observedKey.lineage.rootSessionId);
        memberAppended =
          appendMemberSessionId(parent, observedKey.lineage.threadId) || memberAppended;
        memberAppended = appendMemberSessionId(parent, observedKey.sessionId) || memberAppended;
        changed = memberAppended || changed;
        changed =
          applyObservedInstanceState({
            config,
            profileId,
            observedKey,
            instance: parent,
            requestAt: params.requestAt,
            manageSlot: false,
          }) || changed;
        return { instance: parent, changed, resolutionPath: 'parent', memberAppended };
      }
      if (!instance) {
        return {
          instance: null,
          changed,
          resolutionPath: 'parent-unresolved',
          memberAppended: false,
        };
      }
    } else {
      const parent = resolveObservedParentInstance(config, profileId, observedKey);
      const parentClientModel = normalizeIdentityPart(parent?.clientModelId);
      if (!parent || !requestedModel || !parentClientModel) {
        return {
          instance: null,
          changed,
          resolutionPath: 'parent-unresolved',
          memberAppended: false,
        };
      }

      if (requestedModel === parentClientModel) {
        const memberAppended = appendMemberSessionId(parent, observedKey.sessionId);
        changed = memberAppended || changed;
        changed =
          closeActiveChildForSession(config, parent, observedKey, params.requestAt) || changed;
        changed =
          applyObservedInstanceState({
            config,
            profileId,
            observedKey,
            instance: parent,
            requestAt: params.requestAt,
            manageSlot: false,
          }) || changed;
        return { instance: parent, changed, resolutionPath: 'parent', memberAppended };
      }

      instance = Object.values(config.instances).find(
        item =>
          item.routingState === 'active' &&
          item.profileId === profileId &&
          item.parentInstanceId === parent.id &&
          item.clientModelId === requestedModel &&
          item.routeKey &&
          buildRouteInstanceKey(item.profileId, item.routeKey) === routeKey
      );
      if (!instance) {
        const reasoningEffort =
          normalizeRouteThinkingEffort(params.requestedReasoningEffort) ||
          normalizeRouteThinkingEffort(params.defaultReasoningEffort);
        if (!reasoningEffort) {
          return {
            instance: null,
            changed,
            resolutionPath: 'parent-unresolved',
            memberAppended: false,
          };
        }
        instance = {
          id: randomUUID(),
          profileId,
          routeKey: normalizeRouteInstanceKey({
            agentId: observedKey.agentId,
            runtimeSlotId: observedKey.runtimeSlotId,
            sessionId: observedKey.sessionId,
          }),
          clientModelId: requestedModel,
          parentInstanceId: parent.id,
          childOrdinal: allocateChildOrdinal(config, parent.id),
          display: {},
          modelId: requestedModel,
          reasoningEffort,
          routingState: 'active',
          presenceState: 'unknown',
          createdAt: params.requestAt,
        };
        config.instances[instance.id] = instance;
        createdReason = 'different_model_child';
        changed = true;
      } else if (!instance.childOrdinal) {
        instance.childOrdinal = allocateChildOrdinal(config, parent.id);
        changed = true;
      }
      changed =
        applyObservedInstanceState({
          config,
          profileId,
          observedKey,
          instance,
          requestAt: params.requestAt,
          manageSlot: true,
        }) || changed;
      return {
        instance,
        changed,
        resolutionPath: 'parent',
        ...(createdReason ? { createdReason } : {}),
        memberAppended: false,
      };
    }
  }

  if (observedKey.agentId === 'codex' && observedKey.lineage?.forkedFromThreadId) {
    const parent = findActiveTopLevelBySessionAlias(
      config,
      profileId,
      observedKey.agentId,
      observedKey.lineage.forkedFromThreadId
    );
    if (parent) {
      let memberAppended = appendMemberSessionId(parent, observedKey.lineage.rootSessionId);
      memberAppended =
        appendMemberSessionId(parent, observedKey.lineage.threadId) || memberAppended;
      memberAppended = appendMemberSessionId(parent, observedKey.sessionId) || memberAppended;
      changed = memberAppended || changed;
      changed =
        applyObservedInstanceState({
          config,
          profileId,
          observedKey,
          instance: parent,
          requestAt: params.requestAt,
          manageSlot: false,
        }) || changed;
      return { instance: parent, changed, resolutionPath: 'parent', memberAppended };
    }
    if (!instance) {
      return {
        instance: null,
        changed,
        resolutionPath: 'parent-unresolved',
        memberAppended: false,
      };
    }
  }

  if (observedKey.lineage?.parentSessionId && !instance) {
    return {
      instance: null,
      changed,
      resolutionPath: 'parent-unresolved',
      memberAppended: false,
    };
  }

  if (!instance) {
    const sessionAliases =
      observedKey.agentId === 'codex'
        ? [observedKey.lineage?.rootSessionId, observedKey.lineage?.threadId, observedKey.sessionId]
        : [observedKey.lineage?.rootSessionId];
    const roots = new Map<string, RouteInstance>();
    for (const sessionId of new Set(sessionAliases)) {
      if (!sessionId) continue;
      const root = findActiveTopLevelBySessionAlias(
        config,
        profileId,
        observedKey.agentId,
        sessionId
      );
      if (root) roots.set(root.id, root);
    }
    if (roots.size > 1) {
      return {
        instance: null,
        changed,
        resolutionPath: 'parent-unresolved',
        memberAppended: false,
      };
    }
    instance = roots.values().next().value;
    if (instance) resolutionPath = 'root-alias';
  }
  if (!instance) {
    instance = Object.values(config.instances).find(item => item.routingState === 'armed');
    resolutionPath = 'armed';
    if (!instance) {
      const modelId = requestedModel || normalizeIdentityPart(params.defaultModel);
      const reasoningEffort =
        normalizeRouteThinkingEffort(params.requestedReasoningEffort) ||
        normalizeRouteThinkingEffort(params.defaultReasoningEffort);
      if (!modelId || !reasoningEffort) return { instance: null, changed };
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
      resolutionPath = 'created';
      createdReason = 'unseen_identity';
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
  if (requestedModel && !isChildRequest && instance.clientModelId !== requestedModel) {
    instance.clientModelId = requestedModel;
    changed = true;
  }
  let memberAppended = appendMemberSessionId(instance, observedKey.lineage?.rootSessionId);
  memberAppended = appendMemberSessionId(instance, observedKey.lineage?.threadId) || memberAppended;
  memberAppended = appendMemberSessionId(instance, observedKey.sessionId) || memberAppended;
  changed = memberAppended || changed;
  const manageSlot =
    Boolean(instance.routeKey) && buildRouteInstanceKey(profileId, instance.routeKey!) === routeKey;
  changed =
    applyObservedInstanceState({
      config,
      profileId,
      observedKey,
      instance,
      requestAt: params.requestAt,
      manageSlot,
    }) || changed;
  return {
    instance,
    changed,
    resolutionPath,
    ...(createdReason ? { createdReason } : {}),
    memberAppended,
  };
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
  if (valueHashes.has(valueHash) || valueHashes.size < ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES) {
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
