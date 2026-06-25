/**
 * CLI 定时探测服务
 * 输入: ModelRegistry (选样本), cliWrapperCompatService (执行探测), 配置
 * 输出: 探测历史 (RouteCliProbeSample[]), 最新快照 (RouteCliProbeLatest)
 * 定位: 服务层 - 独立于代理服务器生命周期的定时 CLI 健康探测
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import { cliWrapperCompatService } from './cli-wrapper-compat-service';
import { isRouteMaskedApiKeyValue, resolveAccountApiKeyValue } from './route-channel-resolver';
import { resolveApiKeyId } from './route-model-registry-service';
import { ensureRouteProxyReady } from './route-proxy-service';
import { buildProbeLockRouteApiKey } from './route-probe-lock';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  loadCustomCliConfigStorage,
} from './custom-cli-config-service';
import { isCustomCliRouteSiteId } from '../shared/utils/customCliRouteId';
import type {
  RouteCliType,
  RouteCliProbeConfig,
  RouteCliProbeSample,
  RouteCliProbeLatest,
  RouteCliProbeSiteView,
  RouteCliProbeCliView,
  RouteCliProbeModelView,
  RoutingConfig,
} from '../shared/types/route-proxy';
import { buildProbeKey } from '../shared/types/route-proxy';
import {
  BUILTIN_GROUP_IDS,
  isApiKeyActive,
  type AccountCredential,
  type ApiKeyInfo,
  type UnifiedSite,
  isAnyRouterSite,
} from '../shared/types/site';
import {
  DEFAULT_CLI_CONFIG,
  CLI_TEST_MODEL_SLOT_COUNT,
  getCliTargetEndpoint,
  normalizeCliTargetProtocol,
  normalizeCliTestModels,
  type CliTargetProtocol,
  type CliConfigItem,
} from '../shared/types/cli-config';
import {
  normalizeCustomCliSettings,
  type CustomCliConfig,
} from '../shared/types/custom-cli-config';

const log = Logger.scope('RouteCliProbe');
const CLI_PROBE_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
const CUSTOM_CLI_PROBE_SITE_NAME = '自定义 CLI';

let probeTimer: NodeJS.Timeout | null = null;
let probeStartupTimer: NodeJS.Timeout | null = null;

function generateSampleId(): string {
  return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateProbeRunId(prefix = 'probe'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getCliProbeConfig(): RouteCliProbeConfig {
  return unifiedConfigManager.getRoutingConfig().cliProbe.config;
}

function getLatestProbeActivityAt(): number | null {
  const latestEntries = Object.values(unifiedConfigManager.getRoutingConfig().cliProbe.latest);
  let latestProbeAt: number | null = null;

  for (const entry of latestEntries) {
    const candidate = entry.lastSample?.testedAt ?? null;
    if (candidate === null) continue;
    latestProbeAt = latestProbeAt === null ? candidate : Math.max(latestProbeAt, candidate);
  }

  return latestProbeAt;
}

export async function saveCliProbeConfig(
  updates: Partial<RouteCliProbeConfig>
): Promise<RouteCliProbeConfig> {
  const result = await unifiedConfigManager.updateRouteCliProbeConfig(updates);
  // 配置变更后重启定时器
  if (updates.enabled !== undefined || updates.intervalMinutes !== undefined) {
    restartCliProbeTimer();
  }
  return result;
}

function getProbeSite(siteId: string): UnifiedSite | null {
  return unifiedConfigManager.getSiteById(siteId);
}

function getProbeAccount(siteId: string, accountId: string): AccountCredential | null {
  const account = unifiedConfigManager.getAccountById(accountId);
  if (!account || account.site_id !== siteId) return null;
  return account;
}

function resolveProbeCliItem(
  siteId: string,
  accountId: string,
  cliType: RouteCliType
): CliConfigItem | null {
  const site = getProbeSite(siteId);
  const account = getProbeAccount(siteId, accountId);
  const configItem = account?.cli_config?.[cliType] ?? site?.cli_config?.[cliType] ?? null;

  if (!configItem) {
    return null;
  }

  const fallback = DEFAULT_CLI_CONFIG[cliType];
  return {
    apiKeyId: configItem.apiKeyId ?? fallback.apiKeyId,
    model: configItem.model ?? fallback.model,
    testModel: configItem.testModel ?? fallback.testModel,
    testModels: configItem.testModels ?? fallback.testModels,
    enabled: configItem.enabled ?? fallback.enabled,
    editedFiles: configItem.editedFiles ?? fallback.editedFiles,
    applyMode: configItem.applyMode ?? fallback.applyMode,
    targetProtocol: configItem.targetProtocol ?? fallback.targetProtocol,
  };
}

function resolveProbeTargetProtocol(
  siteId: string,
  accountId: string,
  cliType: RouteCliType
): ReturnType<typeof normalizeCliTargetProtocol> {
  return normalizeCliTargetProtocol(
    resolveProbeCliItem(siteId, accountId, cliType)?.targetProtocol
  );
}

function isProbeCliEnabled(siteId: string, accountId: string, cliType: RouteCliType): boolean {
  return resolveProbeCliItem(siteId, accountId, cliType)?.enabled !== false;
}

function matchesConfiguredApiKey(apiKey: ApiKeyInfo, apiKeyId: number | null | undefined): boolean {
  if (apiKeyId === null || apiKeyId === undefined) return false;
  const candidateId = apiKey.id ?? apiKey.token_id;
  return (
    candidateId !== null && candidateId !== undefined && Number(candidateId) === Number(apiKeyId)
  );
}

async function resolveProbeApiKeyForExecution(
  site: UnifiedSite,
  account: AccountCredential,
  cliType: RouteCliType
): Promise<{ apiKeyId: string } | null> {
  const preferredApiKeyId = resolveProbeCliItem(site.id, account.id, cliType)?.apiKeyId;
  const apiKeys = (account.cached_data?.api_keys || []).filter(apiKey => {
    return isApiKeyActive(apiKey) && Boolean(apiKey.key || apiKey.token);
  });

  if (preferredApiKeyId !== null && preferredApiKeyId !== undefined) {
    const preferredApiKey = apiKeys.find(apiKey =>
      matchesConfiguredApiKey(apiKey, preferredApiKeyId)
    );
    if (preferredApiKey) {
      const resolvedApiKey = await resolveAccountApiKeyValue(site, account, preferredApiKey);
      if (resolvedApiKey) {
        return {
          apiKeyId: resolveApiKeyId(preferredApiKey),
        };
      }
    }
  }

  if (apiKeys.length > 0) {
    const resolvedApiKey = await resolveAccountApiKeyValue(site, account, apiKeys[0]);
    if (resolvedApiKey) {
      return {
        apiKeyId: resolveApiKeyId(apiKeys[0]),
      };
    }
  }

  return site.api_key && !isRouteMaskedApiKeyValue(site.api_key)
    ? {
        apiKeyId: resolveApiKeyId({ key: site.api_key }),
      }
    : null;
}

function isProbeAccountActive(account: AccountCredential): boolean {
  // Older configs may not have persisted status yet; treat them as active for backward compatibility.
  return !account.status || account.status === 'active';
}

function isCliProbeExcludedSite(site: UnifiedSite): boolean {
  return site.group === BUILTIN_GROUP_IDS.UNAVAILABLE;
}

function listProbeAccountsForSite(params: { siteId: string; explicitAccountId?: string }): {
  site: UnifiedSite;
  accounts: AccountCredential[];
} | null {
  const site = getProbeSite(params.siteId);
  if (!site) return null;

  const activeAccounts = unifiedConfigManager
    .getAccountsBySiteId(site.id)
    .filter(account => isProbeAccountActive(account));

  if (!params.explicitAccountId) {
    return {
      site,
      accounts: activeAccounts,
    };
  }

  return {
    site,
    accounts: activeAccounts.filter(account => account.id === params.explicitAccountId),
  };
}

function extractStatusCodeFromError(message?: string): number | undefined {
  if (!message) {
    return undefined;
  }

  const patterns = [
    /status\s+code\s*[:=]?\s*(\d{3})/i,
    /\bhttp\s*[:=]?\s*(\d{3})\b/i,
    /"status"\s*:\s*(\d{3})/i,
    /\b(\d{3})\b(?=\s+(?:bad request|unauthorized|forbidden|not found|too many requests|server error))/i,
  ];

  for (const pattern of patterns) {
    const matched = message.match(pattern);
    const statusCode = matched?.[1] ? Number.parseInt(matched[1], 10) : Number.NaN;
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
      return statusCode;
    }
  }

  return undefined;
}

function buildConfiguredProbeModels(
  siteId: string,
  accountId: string,
  cliType: RouteCliType,
  limit: number
): Array<{ canonicalModel: string; rawModel: string }> {
  const cliConfigItem = resolveProbeCliItem(siteId, accountId, cliType);
  if (!cliConfigItem) {
    return [];
  }
  const testModels = normalizeCliTestModels(cliConfigItem, limit);
  const seen = new Set<string>();
  const results: Array<{ canonicalModel: string; rawModel: string }> = [];

  for (const model of testModels) {
    if (seen.has(model)) continue;
    seen.add(model);
    results.push({
      canonicalModel: model,
      rawModel: model,
    });
  }

  return results;
}

function summarizeProbeHistory(samples: RouteCliProbeSample[]): RouteCliProbeSample[] {
  const buckets = new Map<number, RouteCliProbeSample>();
  const sortedSamples = [...samples].sort((left, right) => left.testedAt - right.testedAt);
  for (const sample of sortedSamples) {
    const bucketKey = Math.floor(sample.testedAt / 3600000);
    const existing = buckets.get(bucketKey);
    if (
      !existing ||
      (sample.success && !existing.success) ||
      (sample.success === existing.success &&
        (sample.totalLatencyMs || Infinity) < (existing.totalLatencyMs || Infinity))
    ) {
      buckets.set(bucketKey, sample);
    }
  }

  return Array.from(buckets.values())
    .sort((left, right) => left.testedAt - right.testedAt)
    .slice(-60);
}

function buildLatestListFromSamples(samples: RouteCliProbeSample[]): RouteCliProbeLatest[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  const latestMap = new Map<string, RouteCliProbeLatest>();

  for (const sample of samples) {
    const existing = latestMap.get(sample.probeKey) || routing.cliProbe.latest[sample.probeKey];
    latestMap.set(sample.probeKey, {
      probeKey: sample.probeKey,
      siteId: sample.siteId,
      accountId: sample.accountId,
      cliType: sample.cliType,
      targetProtocol: sample.targetProtocol,
      targetEndpoint: sample.targetEndpoint,
      canonicalModel: sample.canonicalModel,
      rawModel: sample.rawModel,
      healthy: sample.success,
      lastSample: sample,
      lastSuccessAt: sample.success ? sample.testedAt : existing?.lastSuccessAt,
      lastFailureAt: !sample.success ? sample.testedAt : existing?.lastFailureAt,
    });
  }

  return Array.from(latestMap.values());
}

export async function persistCliProbeSamples(samples: RouteCliProbeSample[]): Promise<void> {
  if (samples.length === 0) {
    return;
  }

  await unifiedConfigManager.persistRouteCliProbeSamples(
    samples,
    buildLatestListFromSamples(samples)
  );
}

/**
 * 为指定站点/账户/CLI 选出待探测的模型样本
 */
export function selectProbeModelsForCli(params: {
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  limit: number;
}): Array<{ canonicalModel: string; rawModel: string }> {
  const { siteId, accountId, cliType, limit } = params;
  if (!isProbeCliEnabled(siteId, accountId, cliType)) {
    return [];
  }

  return buildConfiguredProbeModels(siteId, accountId, cliType, Math.min(limit, 1));
}

function resolveCustomCliDisplayName(config: CustomCliConfig): string {
  return config.name?.trim() || config.baseUrl?.trim() || config.id;
}

function resolveCustomCliProbeIds(configId: string): {
  siteId: string;
  accountId: string;
  apiKeyId: string;
} {
  return {
    siteId: buildCustomCliRouteSiteId(configId),
    accountId: buildCustomCliRouteAccountId(configId),
    apiKeyId: buildCustomCliRouteApiKeyId(configId),
  };
}

function selectCustomCliProbeModelsForCli(params: {
  config: CustomCliConfig;
  cliType: RouteCliType;
  limit: number;
}): Array<{ canonicalModel: string; rawModel: string }> {
  const setting = normalizeCustomCliSettings(params.config.cliSettings?.[params.cliType]);
  if (setting.enabled === false) {
    return [];
  }

  const testModels = normalizeCliTestModels(setting, Math.min(params.limit, 1));
  const seen = new Set<string>();
  const results: Array<{ canonicalModel: string; rawModel: string }> = [];

  for (const model of testModels) {
    if (seen.has(model)) continue;
    seen.add(model);
    results.push({
      canonicalModel: model,
      rawModel: model,
    });
  }

  return results;
}

function buildProbeModelView(params: {
  routing: RoutingConfig;
  cutoff: number;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  canonicalModel: string;
  rawModel: string;
  targetProtocol: CliTargetProtocol;
}): RouteCliProbeModelView {
  const targetEndpoint = getCliTargetEndpoint(
    params.cliType,
    params.targetProtocol,
    params.rawModel || params.canonicalModel
  );
  const probeKey = buildProbeKey(
    params.siteId,
    params.accountId,
    params.cliType,
    params.canonicalModel,
    params.targetProtocol
  );
  const latest = params.routing.cliProbe.latest[probeKey];
  const history = summarizeProbeHistory(
    (params.routing.cliProbe.history[probeKey] || []).filter(
      sample => sample.testedAt >= params.cutoff
    )
  );

  return {
    canonicalModel: params.canonicalModel,
    rawModel: latest?.rawModel || params.rawModel,
    targetProtocol: params.targetProtocol,
    targetEndpoint: latest?.targetEndpoint || targetEndpoint,
    success: latest ? latest.lastSample.success : null,
    testedAt: latest?.lastSample.testedAt,
    statusCode: latest?.lastSample.statusCode,
    totalLatencyMs: latest?.lastSample.totalLatencyMs,
    error: latest?.lastSample.error,
    source: latest?.lastSample.source,
    claudeDetail: latest?.lastSample.claudeDetail,
    codexDetail: latest?.lastSample.codexDetail,
    geminiDetail: latest?.lastSample.geminiDetail,
    history,
  };
}

/**
 * 执行单个探测样本
 */
async function runSingleProbe(
  siteId: string,
  accountId: string,
  cliType: RouteCliType,
  canonicalModel: string,
  rawModel: string,
  _timeoutMs: number,
  probeRunId: string,
  options: {
    apiKeyId?: string;
    targetProtocol?: CliTargetProtocol;
    upstreamBaseUrl?: string;
    upstreamApiKey?: string;
  } = {}
): Promise<RouteCliProbeSample> {
  const targetProtocol = normalizeCliTargetProtocol(
    options.targetProtocol ?? resolveProbeTargetProtocol(siteId, accountId, cliType)
  );
  const targetEndpoint = getCliTargetEndpoint(cliType, targetProtocol, rawModel || canonicalModel);
  const probeKey = buildProbeKey(siteId, accountId, cliType, canonicalModel, targetProtocol);
  const now = Date.now();

  // 找一个可用的 API Key
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) {
    return {
      sampleId: generateSampleId(),
      probeRunId,
      probeKey,
      siteId,
      accountId,
      cliType,
      targetProtocol,
      targetEndpoint,
      canonicalModel,
      rawModel,
      success: false,
      source: 'routeProbe',
      error: 'Config not loaded',
      testedAt: now,
    };
  }

  const site = config.sites.find(s => s.id === siteId);
  const account = config.accounts.find(a => a.id === accountId);
  const routeCredential = options.apiKeyId
    ? { apiKeyId: options.apiKeyId }
    : site && account
      ? await resolveProbeApiKeyForExecution(site, account, cliType)
      : null;

  if (!routeCredential || (!options.upstreamBaseUrl && (!site || !account))) {
    return {
      sampleId: generateSampleId(),
      probeRunId,
      probeKey,
      siteId,
      accountId,
      cliType,
      targetProtocol,
      targetEndpoint,
      canonicalModel,
      rawModel,
      success: false,
      source: 'routeProbe',
      error: 'No API key available',
      testedAt: now,
    };
  }

  // AnyRouter 站点使用 120 秒超时，其他站点使用配置的超时时间
  const timeoutMs = site && isAnyRouterSite(site.name) ? 120000 : _timeoutMs;
  const startTime = Date.now();

  try {
    const routeRuntime = await ensureRouteProxyReady({ autoEnable: true });
    const routeApiKey = buildProbeLockRouteApiKey(routeRuntime.unifiedApiKey, {
      siteId,
      accountId,
      apiKeyId: routeCredential.apiKeyId,
      cliType,
      probeRunId,
      canonicalModel,
      rawModel,
      targetProtocol,
      upstreamBaseUrl: options.upstreamBaseUrl,
      upstreamApiKey: options.upstreamApiKey,
    });

    let success = false;
    let statusCode: number | undefined;
    let firstByteLatencyMs: number | undefined;
    let error: string | undefined;
    let claudeDetail: RouteCliProbeSample['claudeDetail'];
    let codexDetail: RouteCliProbeSample['codexDetail'];
    let geminiDetail: RouteCliProbeSample['geminiDetail'];

    switch (cliType) {
      case 'claudeCode': {
        const result = await cliWrapperCompatService.testClaudeCodeWithDetail(
          routeRuntime.baseUrl,
          routeApiKey,
          rawModel,
          timeoutMs
        );
        success = result.supported;
        error = result.message;
        statusCode = extractStatusCodeFromError(result.message);
        claudeDetail = result.detail;
        break;
      }
      case 'codex': {
        const result = await cliWrapperCompatService.testCodexWithDetail(
          routeRuntime.baseUrl,
          routeApiKey,
          rawModel,
          timeoutMs
        );
        success = result.supported;
        error = result.message;
        statusCode = extractStatusCodeFromError(result.message);
        codexDetail = result.detail;
        break;
      }
      case 'geminiCli': {
        const result = await cliWrapperCompatService.testGeminiWithDetail(
          routeRuntime.baseUrl,
          routeApiKey,
          rawModel,
          timeoutMs
        );
        success = result.supported;
        error = result.message;
        statusCode = extractStatusCodeFromError(result.message);
        geminiDetail = result.detail;
        break;
      }
    }

    const totalLatencyMs = Date.now() - startTime;

    return {
      sampleId: generateSampleId(),
      probeRunId,
      probeKey,
      siteId,
      accountId,
      cliType,
      targetProtocol,
      targetEndpoint,
      canonicalModel,
      rawModel,
      success,
      source: 'routeProbe',
      statusCode,
      firstByteLatencyMs,
      totalLatencyMs,
      error,
      claudeDetail,
      codexDetail,
      geminiDetail,
      testedAt: Date.now(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      sampleId: generateSampleId(),
      probeRunId,
      probeKey,
      siteId,
      accountId,
      cliType,
      targetProtocol,
      targetEndpoint,
      canonicalModel,
      rawModel,
      success: false,
      source: 'routeProbe',
      statusCode: extractStatusCodeFromError(message),
      totalLatencyMs: Date.now() - startTime,
      error: message,
      testedAt: Date.now(),
    };
  }
}

/**
 * 执行一次完整探测
 */
export async function runCliProbeNow(params?: {
  siteId?: string;
  accountId?: string;
  cliType?: RouteCliType;
}): Promise<{
  startedAt: number;
  finishedAt: number;
  totalSamples: number;
  successSamples: number;
  failureSamples: number;
}> {
  const startedAt = Date.now();
  const probeRunId = generateProbeRunId('route');
  const probeConfig = getCliProbeConfig();
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) {
    return {
      startedAt,
      finishedAt: Date.now(),
      totalSamples: 0,
      successSamples: 0,
      failureSamples: 0,
    };
  }

  const cliTypes: RouteCliType[] = params?.cliType ? [params.cliType] : CLI_PROBE_TYPES;

  const tasks: Array<{
    siteId: string;
    accountId: string;
    apiKeyId?: string;
    cliType: RouteCliType;
    canonicalModel: string;
    rawModel: string;
    targetProtocol?: CliTargetProtocol;
    upstreamBaseUrl?: string;
    upstreamApiKey?: string;
  }> = [];

  for (const site of config.sites) {
    if (!site.enabled) continue;
    if (isCliProbeExcludedSite(site)) continue;
    if (params?.siteId && site.id !== params.siteId) continue;

    const selection = listProbeAccountsForSite({
      siteId: site.id,
      explicitAccountId: params?.accountId,
    });
    if (!selection) continue;

    for (const account of selection.accounts) {
      for (const cliType of cliTypes) {
        if (!isProbeCliEnabled(site.id, account.id, cliType)) continue;

        const models = selectProbeModelsForCli({
          siteId: site.id,
          accountId: account.id,
          cliType,
          limit: 1,
        });
        for (const model of models) {
          tasks.push({
            siteId: site.id,
            accountId: account.id,
            cliType,
            ...model,
          });
        }
      }
    }
  }

  const customCliStorage = await loadCustomCliConfigStorage();
  for (const customConfig of customCliStorage.configs) {
    const baseUrl = customConfig.baseUrl?.trim();
    const apiKey = customConfig.apiKey?.trim();
    if (!baseUrl || !apiKey || isRouteMaskedApiKeyValue(apiKey)) continue;

    const ids = resolveCustomCliProbeIds(customConfig.id);
    if (params?.siteId && ids.siteId !== params.siteId) continue;
    if (params?.accountId && ids.accountId !== params.accountId) continue;

    for (const cliType of cliTypes) {
      const setting = normalizeCustomCliSettings(customConfig.cliSettings?.[cliType]);
      if (setting.enabled === false) continue;

      const models = selectCustomCliProbeModelsForCli({
        config: customConfig,
        cliType,
        limit: 1,
      });

      for (const model of models) {
        tasks.push({
          ...ids,
          cliType,
          ...model,
          targetProtocol: normalizeCliTargetProtocol(setting.targetProtocol),
          upstreamBaseUrl: baseUrl,
          upstreamApiKey: apiKey,
        });
      }
    }
  }

  log.info(`CLI probe started: ${tasks.length} tasks`);

  // 并发控制
  const samples: RouteCliProbeSample[] = [];
  const concurrency = probeConfig.maxConcurrency;

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(t =>
        runSingleProbe(
          t.siteId,
          t.accountId,
          t.cliType,
          t.canonicalModel,
          t.rawModel,
          probeConfig.requestTimeoutMs,
          probeRunId,
          {
            apiKeyId: t.apiKeyId,
            targetProtocol: t.targetProtocol,
            upstreamBaseUrl: t.upstreamBaseUrl,
            upstreamApiKey: t.upstreamApiKey,
          }
        )
      )
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') samples.push(r.value);
    }
  }

  // 持久化
  if (samples.length > 0) {
    await persistCliProbeSamples(samples);
  }

  const successSamples = samples.filter(s => s.success).length;
  const finishedAt = Date.now();
  log.info(`CLI probe finished: ${samples.length} total, ${successSamples} success`);

  return {
    startedAt,
    finishedAt,
    totalSamples: samples.length,
    successSamples,
    failureSamples: samples.length - successSamples,
  };
}

/** 查询最新探测快照 */
export function getCliProbeLatest(params?: {
  siteId?: string;
  accountId?: string;
  cliType?: RouteCliType;
  canonicalModel?: string;
}): RouteCliProbeLatest[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  let list = Object.values(routing.cliProbe.latest);
  if (params?.siteId) list = list.filter(l => l.siteId === params.siteId);
  if (params?.accountId) list = list.filter(l => l.accountId === params.accountId);
  if (params?.cliType) list = list.filter(l => l.cliType === params.cliType);
  if (params?.canonicalModel) list = list.filter(l => l.canonicalModel === params.canonicalModel);
  return list;
}

/** 查询探测历史 */
export function getCliProbeHistory(params: {
  window: '24h' | '7d' | '30d';
  siteId?: string;
  accountId?: string;
  cliType?: RouteCliType;
  canonicalModel?: string;
}): RouteCliProbeSample[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  const cutoff = Date.now() - windowToMs(params.window);

  const results: RouteCliProbeSample[] = [];
  for (const samples of Object.values(routing.cliProbe.history)) {
    for (const s of samples) {
      if (s.testedAt < cutoff) continue;
      if (params.siteId && s.siteId !== params.siteId) continue;
      if (params.accountId && s.accountId !== params.accountId) continue;
      if (params.cliType && s.cliType !== params.cliType) continue;
      if (params.canonicalModel && s.canonicalModel !== params.canonicalModel) continue;
      results.push(s);
    }
  }

  return results.sort((a, b) => a.testedAt - b.testedAt);
}

export async function getCliProbeView(params: {
  window: '24h' | '7d' | '30d';
}): Promise<RouteCliProbeSiteView[]> {
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) return [];

  const routing = unifiedConfigManager.getRoutingConfig();
  const cutoff = Date.now() - windowToMs(params.window);
  const siteViews: RouteCliProbeSiteView[] = [];

  for (const site of config.sites) {
    if (!site.enabled) continue;
    if (isCliProbeExcludedSite(site)) continue;

    const selection = listProbeAccountsForSite({ siteId: site.id });
    if (!selection || selection.accounts.length === 0) {
      continue;
    }

    for (const account of selection.accounts) {
      const clis = {} as Record<RouteCliType, RouteCliProbeCliView>;
      let hasEnabledCli = false;

      for (const cliType of CLI_PROBE_TYPES) {
        const cliEnabled = isProbeCliEnabled(site.id, account.id, cliType);
        if (cliEnabled) {
          hasEnabledCli = true;
        }
        const desiredModels = selectProbeModelsForCli({
          siteId: site.id,
          accountId: account.id,
          cliType,
          limit: 1,
        });

        const modelViews: RouteCliProbeModelView[] = desiredModels.map(model =>
          buildProbeModelView({
            routing,
            cutoff,
            siteId: site.id,
            accountId: account.id,
            cliType,
            canonicalModel: model.canonicalModel,
            rawModel: model.rawModel,
            targetProtocol: resolveProbeTargetProtocol(site.id, account.id, cliType),
          })
        );

        clis[cliType] = {
          cliType,
          enabled: cliEnabled,
          accountId: account.id,
          accountName: account.account_name,
          isFallbackAccount: false,
          models: modelViews,
        };
      }

      if (!hasEnabledCli) {
        continue;
      }

      siteViews.push({
        siteId: site.id,
        siteName: site.name,
        accountId: account.id,
        accountName: account.account_name,
        isFallbackAccount: false,
        clis,
      });
    }
  }

  const customCliStorage = await loadCustomCliConfigStorage();
  for (const customConfig of customCliStorage.configs) {
    const baseUrl = customConfig.baseUrl?.trim();
    const apiKey = customConfig.apiKey?.trim();
    if (!baseUrl || !apiKey || isRouteMaskedApiKeyValue(apiKey)) continue;

    const ids = resolveCustomCliProbeIds(customConfig.id);
    const displayName = resolveCustomCliDisplayName(customConfig);
    const clis = {} as Record<RouteCliType, RouteCliProbeCliView>;
    let hasEnabledCli = false;

    for (const cliType of CLI_PROBE_TYPES) {
      const setting = normalizeCustomCliSettings(customConfig.cliSettings?.[cliType]);
      const cliEnabled = setting.enabled !== false;
      if (cliEnabled) {
        hasEnabledCli = true;
      }
      const targetProtocol = normalizeCliTargetProtocol(setting.targetProtocol);
      const desiredModels = selectCustomCliProbeModelsForCli({
        config: customConfig,
        cliType,
        limit: 1,
      });

      clis[cliType] = {
        cliType,
        enabled: cliEnabled,
        accountId: ids.accountId,
        accountName: displayName,
        isFallbackAccount: false,
        models: desiredModels.map(model =>
          buildProbeModelView({
            routing,
            cutoff,
            siteId: ids.siteId,
            accountId: ids.accountId,
            cliType,
            canonicalModel: model.canonicalModel,
            rawModel: model.rawModel,
            targetProtocol,
          })
        ),
      };
    }

    if (!hasEnabledCli) {
      continue;
    }

    siteViews.push({
      siteId: ids.siteId,
      siteName: CUSTOM_CLI_PROBE_SITE_NAME,
      accountId: ids.accountId,
      accountName: displayName,
      isFallbackAccount: false,
      clis,
    });
  }

  return siteViews.sort((left, right) => {
    const leftCustom = isCustomCliRouteSiteId(left.siteId);
    const rightCustom = isCustomCliRouteSiteId(right.siteId);
    if (leftCustom !== rightCustom) {
      return leftCustom ? 1 : -1;
    }

    const siteCompare = left.siteName.localeCompare(right.siteName);
    if (siteCompare !== 0) {
      return siteCompare;
    }

    return (left.accountName || '').localeCompare(right.accountName || '');
  });
}

function armCliProbeInterval(intervalMs: number): void {
  probeTimer = setInterval(async () => {
    try {
      await runCliProbeNow();
    } catch (err) {
      log.error('Scheduled CLI probe failed:', err);
    }
  }, intervalMs);
}

function scheduleCliProbeStartupRun(delayMs: number, intervalMs: number): void {
  probeStartupTimer = setTimeout(() => {
    probeStartupTimer = null;
    runCliProbeNow()
      .catch(err => {
        log.error('Startup probe failed:', err);
      })
      .finally(() => {
        armCliProbeInterval(intervalMs);
      });
  }, delayMs);
}

export function startCliProbeTimer(options?: { resumeFromLatest?: boolean }): void {
  stopCliProbeTimer();
  const config = getCliProbeConfig();
  if (!config.enabled) return;

  const intervalMs = config.intervalMinutes * 60 * 1000;
  log.info(`CLI probe timer started, interval: ${config.intervalMinutes}min`);

  if (options?.resumeFromLatest) {
    const latestProbeAt = getLatestProbeActivityAt();
    const elapsedMs =
      latestProbeAt === null ? Number.POSITIVE_INFINITY : Date.now() - latestProbeAt;
    const startupDelayMs =
      latestProbeAt !== null && elapsedMs < intervalMs ? intervalMs - elapsedMs : 3000;
    scheduleCliProbeStartupRun(startupDelayMs, intervalMs);
    log.info(
      `CLI probe startup run scheduled in ${Math.ceil(startupDelayMs / 1000)}s (resume mode)`
    );
    return;
  }

  // 手动重启定时器时仍允许显式的启动即跑配置
  if (config.runOnStartup) {
    scheduleCliProbeStartupRun(3000, intervalMs);
    return;
  }

  armCliProbeInterval(intervalMs);
}

export function stopCliProbeTimer(): void {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
  if (probeStartupTimer) {
    clearTimeout(probeStartupTimer);
    probeStartupTimer = null;
  }
}

export function restartCliProbeTimer(): void {
  stopCliProbeTimer();
  startCliProbeTimer();
}

function windowToMs(window: '24h' | '7d' | '30d'): number {
  switch (window) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}
