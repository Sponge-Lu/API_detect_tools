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
import type {
  RouteCliType,
  RouteCliProbeConfig,
  RouteCliProbeSample,
  RouteCliProbeLatest,
  RouteCliProbeSiteView,
  RouteCliProbeCliView,
  RouteCliProbeModelView,
} from '../shared/types/route-proxy';
import { buildProbeKey } from '../shared/types/route-proxy';
import {
  BUILTIN_GROUP_IDS,
  type AccountCredential,
  type ApiKeyInfo,
  type UnifiedSite,
} from '../shared/types/site';
import {
  DEFAULT_CLI_CONFIG,
  CLI_TEST_MODEL_SLOT_COUNT,
  normalizeCliTestModels,
  type CliConfigItem,
} from '../shared/types/cli-config';

const log = Logger.scope('RouteCliProbe');
const CLI_PROBE_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];

let probeTimer: NodeJS.Timeout | null = null;
let probeStartupTimer: NodeJS.Timeout | null = null;

function generateSampleId(): string {
  return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
  const siteItem = site?.cli_config?.[cliType] || null;
  const accountItem = account?.cli_config?.[cliType] || null;

  if (!siteItem && !accountItem) {
    return null;
  }

  const fallback = DEFAULT_CLI_CONFIG[cliType];
  return {
    apiKeyId: accountItem?.apiKeyId ?? siteItem?.apiKeyId ?? fallback.apiKeyId,
    model: accountItem?.model ?? siteItem?.model ?? fallback.model,
    testModel: accountItem?.testModel ?? siteItem?.testModel ?? fallback.testModel,
    testModels: accountItem?.testModels ?? siteItem?.testModels ?? fallback.testModels,
    enabled: accountItem?.enabled ?? siteItem?.enabled ?? fallback.enabled,
    editedFiles: accountItem?.editedFiles ?? siteItem?.editedFiles ?? fallback.editedFiles,
    applyMode: accountItem?.applyMode ?? siteItem?.applyMode ?? fallback.applyMode,
  };
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
): Promise<string | null> {
  const preferredApiKeyId = resolveProbeCliItem(site.id, account.id, cliType)?.apiKeyId;
  const apiKeys = (account.cached_data?.api_keys || []).filter(apiKey => {
    return (
      (apiKey.status === undefined || apiKey.status === 1) && Boolean(apiKey.key || apiKey.token)
    );
  });

  if (preferredApiKeyId !== null && preferredApiKeyId !== undefined) {
    const preferredApiKey = apiKeys.find(apiKey =>
      matchesConfiguredApiKey(apiKey, preferredApiKeyId)
    );
    if (preferredApiKey) {
      return await resolveAccountApiKeyValue(site, account, preferredApiKey);
    }
  }

  if (apiKeys.length > 0) {
    return await resolveAccountApiKeyValue(site, account, apiKeys[0]);
  }

  return site.api_key && !isRouteMaskedApiKeyValue(site.api_key) ? site.api_key : null;
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

  await unifiedConfigManager.appendRouteCliProbeSamples(samples);
  await unifiedConfigManager.upsertRouteCliProbeLatest(buildLatestListFromSamples(samples));
  await unifiedConfigManager.pruneRouteCliProbeHistory();
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

  return buildConfiguredProbeModels(siteId, accountId, cliType, limit);
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
  _timeoutMs: number
): Promise<RouteCliProbeSample> {
  const probeKey = buildProbeKey(siteId, accountId, cliType, canonicalModel);
  const now = Date.now();

  // 找一个可用的 API Key
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) {
    return {
      sampleId: generateSampleId(),
      probeKey,
      siteId,
      accountId,
      cliType,
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
  const apiKey =
    site && account ? await resolveProbeApiKeyForExecution(site, account, cliType) : null;

  if (!apiKey || !site || !account) {
    return {
      sampleId: generateSampleId(),
      probeKey,
      siteId,
      accountId,
      cliType,
      canonicalModel,
      rawModel,
      success: false,
      source: 'routeProbe',
      error: 'No API key available',
      testedAt: now,
    };
  }

  const baseUrl = site.url;
  const startTime = Date.now();

  try {
    // Endpoint ping: 简单 HEAD 请求计时
    let endpointPingMs: number | undefined;
    try {
      const pingStart = Date.now();
      await Promise.race([
        fetch(`${baseUrl}/v1/models`, { method: 'HEAD', signal: AbortSignal.timeout(5000) }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 5000)),
      ]);
      endpointPingMs = Date.now() - pingStart;
    } catch {
      // ping 失败不阻断探测
    }

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
          baseUrl,
          apiKey,
          rawModel
        );
        success = result.supported;
        error = result.message;
        statusCode = extractStatusCodeFromError(result.message);
        claudeDetail = result.detail;
        break;
      }
      case 'codex': {
        const result = await cliWrapperCompatService.testCodexWithDetail(baseUrl, apiKey, rawModel);
        success = result.supported;
        error = result.message;
        statusCode = extractStatusCodeFromError(result.message);
        codexDetail = result.detail;
        break;
      }
      case 'geminiCli': {
        const result = await cliWrapperCompatService.testGeminiWithDetail(
          baseUrl,
          apiKey,
          rawModel
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
      probeKey,
      siteId,
      accountId,
      cliType,
      canonicalModel,
      rawModel,
      success,
      source: 'routeProbe',
      statusCode,
      endpointPingMs,
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
      probeKey,
      siteId,
      accountId,
      cliType,
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
    cliType: RouteCliType;
    canonicalModel: string;
    rawModel: string;
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
          limit: Math.min(probeConfig.modelsPerCli, CLI_TEST_MODEL_SLOT_COUNT),
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
          probeConfig.requestTimeoutMs
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

export function getCliProbeView(params: { window: '24h' | '7d' | '30d' }): RouteCliProbeSiteView[] {
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
          limit: CLI_TEST_MODEL_SLOT_COUNT,
        });

        const modelViews: RouteCliProbeModelView[] = desiredModels.map(model => {
          const probeKey = buildProbeKey(site.id, account.id, cliType, model.canonicalModel);
          const latest = routing.cliProbe.latest[probeKey];
          const history = summarizeProbeHistory(
            (routing.cliProbe.history[probeKey] || []).filter(sample => sample.testedAt >= cutoff)
          );

          return {
            canonicalModel: model.canonicalModel,
            rawModel: latest?.rawModel || model.rawModel,
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
        });

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

  return siteViews.sort((left, right) => {
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
