import type { CliCompatibilityResult } from '../store/detectionStore';
import type { CliConfig, CliModelTestResult } from '../../shared/types/cli-config';
import type { UnifiedConfig } from '../../shared/types/site';
import type {
  RouteCliProbeLatest,
  RouteCliProbeSource,
  RouteCliType,
} from '../../shared/types/route-proxy';
import {
  CLI_TEST_MODEL_SLOT_COUNT,
  normalizeCliTargetProtocol,
  normalizeCliTestModels,
  normalizeCliTestResults,
} from '../../shared/types/cli-config';
import { buildSiteScopedProbeAccountId } from '../../shared/types/route-proxy';

const CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
const makeStoreKey = (siteName: string, accountId?: string) =>
  accountId ? `${siteName}::${accountId}` : siteName;

function sortProbeLatest(entries: RouteCliProbeLatest[]): RouteCliProbeLatest[] {
  return [...entries].sort((left, right) => right.lastSample.testedAt - left.lastSample.testedAt);
}

function normalizeComparableUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:80(\/|$)/, '$1')
    .replace(/:443(\/|$)/, '$1')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

function summarizeProbeLatest(
  entries: RouteCliProbeLatest[],
  sourceLabel?: string
): CliCompatibilityResult | null {
  if (entries.length === 0) {
    return null;
  }

  const sorted = sortProbeLatest(entries);
  const summary: CliCompatibilityResult = {
    claudeCode: null,
    claudeDetail: undefined,
    codex: null,
    codexDetail: undefined,
    geminiCli: null,
    geminiDetail: undefined,
    testedAt: sorted[0]?.lastSample.testedAt ?? null,
    sourceLabel,
  };

  let hasAny = false;
  for (const cliType of CLI_TYPES) {
    const cliEntries = sorted.filter(entry => entry.cliType === cliType);
    if (cliEntries.length === 0) {
      continue;
    }

    hasAny = true;
    const detailEntry = cliEntries[0];
    const success = detailEntry.lastSample.success;
    if (cliType === 'claudeCode') {
      summary.claudeCode = success;
      summary.claudeDetail = detailEntry.lastSample.claudeDetail;
      summary.claudeError = success ? undefined : summarizeProbeFailure(detailEntry);
    } else if (cliType === 'codex') {
      summary.codex = success;
      summary.codexDetail = detailEntry.lastSample.codexDetail;
      summary.codexError = success ? undefined : summarizeProbeFailure(detailEntry);
    } else {
      summary.geminiCli = success;
      summary.geminiDetail = detailEntry.lastSample.geminiDetail;
      summary.geminiError = success ? undefined : summarizeProbeFailure(detailEntry);
    }
  }

  return hasAny ? summary : null;
}

function summarizeProbeFailure(entry: RouteCliProbeLatest): string | undefined {
  const statusCode = entry.lastSample.statusCode;
  if (statusCode) {
    return `错误码 ${statusCode}`;
  }

  const normalized = entry.lastSample.error?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 93)}...`;
}

function buildCliModelTestMessage(entry: RouteCliProbeLatest): string | undefined {
  if (entry.lastSample.success) {
    return undefined;
  }

  const statusCode = entry.lastSample.statusCode;
  if (statusCode) {
    return `错误码 ${statusCode}`;
  }

  const normalized = entry.lastSample.error?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function toCliModelTestResult(
  entry: RouteCliProbeLatest,
  selectedModel: string
): CliModelTestResult | null {
  const model = selectedModel.trim() || entry.canonicalModel?.trim() || entry.rawModel?.trim();
  const testedAt = entry.lastSample.testedAt;
  if (!model || typeof testedAt !== 'number' || !Number.isFinite(testedAt)) {
    return null;
  }

  const message = buildCliModelTestMessage(entry);
  return {
    model,
    success: entry.lastSample.success,
    timestamp: testedAt,
    ...(message ? { message } : {}),
  };
}

function isSameProbeModel(entry: RouteCliProbeLatest, model: string): boolean {
  return (
    entry.canonicalModel === model ||
    entry.rawModel === model ||
    entry.lastSample.canonicalModel === model ||
    entry.lastSample.rawModel === model
  );
}

function chooseNewestCliModelResult(
  current: CliModelTestResult | null,
  projected: CliModelTestResult | null
): CliModelTestResult | null {
  if (!projected) {
    return current;
  }
  if (!current) {
    return projected;
  }
  return projected.timestamp >= current.timestamp ? projected : current;
}

function buildSourceLabel(
  source: RouteCliProbeSource | undefined,
  accountName: string | undefined
): string {
  if (source === 'legacyCache') {
    return '来自历史兼容性缓存';
  }

  if (source === 'siteManual') {
    return accountName ? `来自站点管理测试 · ${accountName}` : '来自站点管理测试';
  }

  return accountName ? `来自站点检测 · ${accountName}` : '来自站点检测';
}

function resolveConfiguredTargetProtocol(
  siteCliConfig: CliConfig | null | undefined,
  accountCliConfig: CliConfig | null | undefined,
  cliType: RouteCliType
): ReturnType<typeof normalizeCliTargetProtocol> {
  return normalizeCliTargetProtocol(
    accountCliConfig?.[cliType]?.targetProtocol ?? siteCliConfig?.[cliType]?.targetProtocol
  );
}

function filterEntriesByCurrentTargetProtocol(
  entries: RouteCliProbeLatest[],
  siteCliConfig: CliConfig | null | undefined,
  accountCliConfig: CliConfig | null | undefined
): RouteCliProbeLatest[] {
  return entries.filter(entry => {
    const currentTargetProtocol = resolveConfiguredTargetProtocol(
      siteCliConfig,
      accountCliConfig,
      entry.cliType
    );
    return normalizeCliTargetProtocol(entry.targetProtocol) === currentTargetProtocol;
  });
}

export function projectCliCompatibilityMap(
  config: Pick<UnifiedConfig, 'sites' | 'accounts' | 'routing'>
): Record<string, CliCompatibilityResult> {
  const accounts = config.accounts || [];
  const routing = config.routing;
  if (!routing?.cliProbe?.latest) {
    return {};
  }

  const latestEntries = Object.values(routing.cliProbe.latest);
  const accountsBySiteId = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const list = accountsBySiteId.get(account.site_id) || [];
    list.push(account);
    accountsBySiteId.set(account.site_id, list);
  }

  const latestBySite = new Map<string, RouteCliProbeLatest[]>();

  for (const entry of latestEntries) {
    latestBySite.set(entry.siteId, [...(latestBySite.get(entry.siteId) || []), entry]);
  }

  const projection: Record<string, CliCompatibilityResult> = Object.create(null);
  for (const site of config.sites) {
    const siteAccounts = accountsBySiteId.get(site.id) || [];
    const siteEntries = latestBySite.get(site.id) || [];

    if (siteAccounts.length === 0) {
      const siteScopedEntries = siteEntries.filter(
        entry => entry.accountId === buildSiteScopedProbeAccountId(site.id)
      );
      const currentSiteEntries = filterEntriesByCurrentTargetProtocol(
        siteScopedEntries,
        site.cli_config,
        undefined
      );
      const latestSiteEntry = sortProbeLatest(currentSiteEntries)[0];
      const sourceLabel = latestSiteEntry
        ? buildSourceLabel(latestSiteEntry.lastSample.source, undefined)
        : undefined;
      const siteSummary = summarizeProbeLatest(currentSiteEntries, sourceLabel);
      if (siteSummary) {
        projection[makeStoreKey(site.name)] = siteSummary;
      }
      continue;
    }

    for (const account of siteAccounts) {
      const accountEntries = filterEntriesByCurrentTargetProtocol(
        siteEntries.filter(entry => entry.accountId === account.id),
        site.cli_config,
        account.cli_config
      );
      const latestAccountEntry = sortProbeLatest(accountEntries)[0];
      const sourceLabel = latestAccountEntry
        ? buildSourceLabel(latestAccountEntry.lastSample.source, account.account_name)
        : undefined;
      const accountSummary = summarizeProbeLatest(accountEntries, sourceLabel);

      if (accountSummary) {
        projection[makeStoreKey(site.name, account.id)] = accountSummary;
      }
    }
  }

  return projection;
}

export function resolveCliProbeSiteId(
  config: Pick<UnifiedConfig, 'sites'> | null | undefined,
  params: { siteId?: string; siteName?: string; siteUrl?: string }
): string | null {
  if (params.siteId) {
    return params.siteId;
  }

  const sites = config?.sites || [];
  const normalizedUrl = normalizeComparableUrl(params.siteUrl);
  const matchedByUrl = normalizedUrl
    ? sites.find(site => normalizeComparableUrl(site.url) === normalizedUrl)
    : null;
  if (matchedByUrl?.id) {
    return matchedByUrl.id;
  }

  const matchedByName = params.siteName ? sites.find(site => site.name === params.siteName) : null;
  return matchedByName?.id ?? null;
}

export function mergeCliProbeLatestRecords(
  ...records: Array<Record<string, RouteCliProbeLatest> | null | undefined>
): Record<string, RouteCliProbeLatest> {
  const merged: Record<string, RouteCliProbeLatest> = {};
  for (const record of records) {
    for (const [key, entry] of Object.entries(record || {})) {
      const existing = merged[key];
      if (!existing || entry.lastSample.testedAt >= existing.lastSample.testedAt) {
        merged[key] = entry;
      }
    }
  }
  return merged;
}

export function projectCliModelTestResultsFromLatest(params: {
  latest: Record<string, RouteCliProbeLatest> | null | undefined;
  siteId: string | null | undefined;
  accountId?: string | null;
  cliConfig: CliConfig | null | undefined;
  slotCount?: number;
}): Record<RouteCliType, Array<CliModelTestResult | null>> {
  const slotCount = params.slotCount ?? CLI_TEST_MODEL_SLOT_COUNT;
  const emptySlots: Array<CliModelTestResult | null> = Array.from(
    { length: slotCount },
    () => null
  );
  const baseResults = {
    claudeCode: normalizeCliTestResults(params.cliConfig?.claudeCode, slotCount),
    codex: normalizeCliTestResults(params.cliConfig?.codex, slotCount),
    geminiCli: normalizeCliTestResults(params.cliConfig?.geminiCli, slotCount),
  };

  if (!params.latest || !params.siteId) {
    return baseResults;
  }

  const ownerAccountId = params.accountId || buildSiteScopedProbeAccountId(params.siteId);
  const entries = Object.values(params.latest).filter(
    entry => entry.siteId === params.siteId && entry.accountId === ownerAccountId
  );

  const projected: Record<RouteCliType, Array<CliModelTestResult | null>> = {
    claudeCode: [...emptySlots],
    codex: [...emptySlots],
    geminiCli: [...emptySlots],
  };

  for (const cliType of CLI_TYPES) {
    const item = params.cliConfig?.[cliType] ?? null;
    const selectedModels = Array.from({ length: slotCount }, (_, index) => {
      return normalizeCliTestModels(item, slotCount)[index] || '';
    });

    projected[cliType] = selectedModels.map((model, slotIndex) => {
      if (!model) {
        return null;
      }

      const newestEntry = sortProbeLatest(
        entries.filter(
          entry =>
            entry.cliType === cliType &&
            normalizeCliTargetProtocol(entry.targetProtocol) ===
              normalizeCliTargetProtocol(item?.targetProtocol) &&
            isSameProbeModel(entry, model)
        )
      )[0];
      const projectedResult = newestEntry ? toCliModelTestResult(newestEntry, model) : null;
      return chooseNewestCliModelResult(baseResults[cliType][slotIndex], projectedResult);
    });
  }

  return projected;
}

export async function syncProjectedCliCompatibility(
  config: Pick<UnifiedConfig, 'sites' | 'accounts' | 'routing'>,
  setCliCompatibility: (siteName: string, result: CliCompatibilityResult) => void
): Promise<void> {
  const projection = projectCliCompatibilityMap(config);
  for (const [storeKey, result] of Object.entries(projection)) {
    setCliCompatibility(storeKey, result);
  }
}
