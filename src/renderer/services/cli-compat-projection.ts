import type { CliCompatibilityResult } from '../store/detectionStore';
import type { UnifiedConfig } from '../../shared/types/site';
import type {
  RouteCliProbeLatest,
  RouteCliProbeSource,
  RouteCliType,
} from '../../shared/types/route-proxy';
import { buildSiteScopedProbeAccountId } from '../../shared/types/route-proxy';

const CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
const makeStoreKey = (siteName: string, accountId?: string) =>
  accountId ? `${siteName}::${accountId}` : siteName;

function sortProbeLatest(entries: RouteCliProbeLatest[]): RouteCliProbeLatest[] {
  return [...entries].sort((left, right) => right.lastSample.testedAt - left.lastSample.testedAt);
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

  const projection: Record<string, CliCompatibilityResult> = {};
  for (const site of config.sites) {
    const siteAccounts = accountsBySiteId.get(site.id) || [];
    const siteEntries = latestBySite.get(site.id) || [];

    if (siteAccounts.length === 0) {
      const siteScopedEntries = siteEntries.filter(
        entry => entry.accountId === buildSiteScopedProbeAccountId(site.id)
      );
      const latestSiteEntry = sortProbeLatest(siteScopedEntries)[0];
      const sourceLabel = latestSiteEntry
        ? buildSourceLabel(latestSiteEntry.lastSample.source, undefined)
        : undefined;
      const siteSummary = summarizeProbeLatest(siteScopedEntries, sourceLabel);
      if (siteSummary) {
        projection[makeStoreKey(site.name)] = siteSummary;
      }
      continue;
    }

    for (const account of siteAccounts) {
      const accountEntries = siteEntries.filter(entry => entry.accountId === account.id);
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

export async function syncProjectedCliCompatibility(
  config: Pick<UnifiedConfig, 'sites' | 'accounts' | 'routing'>,
  setCliCompatibility: (siteName: string, result: CliCompatibilityResult) => void
): Promise<void> {
  const projection = projectCliCompatibilityMap(config);
  for (const [storeKey, result] of Object.entries(projection)) {
    setCliCompatibility(storeKey, result);
  }
}
