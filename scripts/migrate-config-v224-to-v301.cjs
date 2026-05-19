#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_VERSION = '3.1';
const RUNTIME_CACHE_VERSION = '1';
const ROUTE_RUNTIME_STATE_VERSION = '1';
const ROUTE_PROBES_STATE_VERSION = '1';
const ROUTE_ANALYTICS_STATE_VERSION = '1';
const ROUTE_MODEL_SOURCES_STATE_VERSION = '1';
const DEFAULT_SITE_TYPE = 'newapi';
const MAX_ROUTE_RUNTIME_ITEMS = 5000;
const MAX_ROUTE_PROBE_HISTORY_SAMPLES = 10000;
const MAX_ROUTE_ANALYTICS_BUCKETS = 50000;
const MAX_ROUTE_MODEL_SOURCES = 20000;

const DEFAULT_SETTINGS = {
  timeout: 30,
  concurrent: true,
  max_concurrent: 3,
  show_disabled: false,
  browser_path: '',
};

const DEFAULT_GROUP = { id: 'default', name: '默认分组' };
const UNAVAILABLE_GROUP = { id: 'unavailable', name: '不可用' };

const SITE_TYPE_RULES = [
  { siteType: 'sub2api', pattern: /\bsub2api\b/i },
  { siteType: 'veloera', pattern: /\bveloera\b/i },
  { siteType: 'onehub', pattern: /\bone[-_ ]?hub\b/i },
  { siteType: 'donehub', pattern: /\bdone[-_ ]?hub\b/i },
  { siteType: 'voapi', pattern: /\bvo[-_ ]?api\b/i },
  { siteType: 'superapi', pattern: /\bsuper[-_ ]?api\b/i },
  { siteType: 'newapi', pattern: /\bnew[-_ ]?api\b/i },
  { siteType: 'oneapi', pattern: /\bone[-_ ]?api\b/i },
];

const SUB2API_HTML_MARKERS = [
  { label: 'window.__APP_CONFIG__', pattern: /window\.__APP_CONFIG__\s*=/i },
  { label: 'site_subtitle', pattern: /"site_subtitle"\s*:/i },
  { label: 'custom_menu_items', pattern: /"custom_menu_items"\s*:/i },
  {
    label: 'purchase_subscription_enabled',
    pattern: /"purchase_subscription_enabled"\s*:/i,
  },
  { label: 'linuxdo_oauth_enabled', pattern: /"linuxdo_oauth_enabled"\s*:/i },
  { label: 'backend_mode_enabled', pattern: /"backend_mode_enabled"\s*:/i },
];

function generateSiteId() {
  return `site_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateAccountId() {
  return `acct_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function createEmptyRuntimeCache() {
  return {
    version: RUNTIME_CACHE_VERSION,
    site_shared_by_site_id: {},
    site_runtime_by_site_id: {},
    account_runtime_by_account_id: {},
    site_daily_snapshots_by_site_id: {},
    last_updated: 0,
  };
}

function createEmptyRouteRuntimeState() {
  return {
    version: ROUTE_RUNTIME_STATE_VERSION,
    stats: {},
    routePathStates: {},
    health: {},
    last_updated: 0,
  };
}

function createEmptyRouteProbesState() {
  return {
    version: ROUTE_PROBES_STATE_VERSION,
    latest: {},
    history: {},
    last_updated: 0,
  };
}

function createEmptyRouteAnalyticsState() {
  return {
    version: ROUTE_ANALYTICS_STATE_VERSION,
    buckets: {},
    last_updated: 0,
  };
}

function createEmptyRouteModelSourcesState() {
  return {
    version: ROUTE_MODEL_SOURCES_STATE_VERSION,
    sources: [],
    last_updated: 0,
  };
}

function createEmptyRouteStateSnapshot() {
  return {
    runtime: createEmptyRouteRuntimeState(),
    probes: createEmptyRouteProbesState(),
    analytics: createEmptyRouteAnalyticsState(),
    modelSources: createEmptyRouteModelSourcesState(),
  };
}

function hasMeaningfulValues(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some(item => item !== undefined);
}

function mergeDefined(current, incoming) {
  if (!current && !incoming) {
    return undefined;
  }

  const merged = { ...(current || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeRecord(current, incoming) {
  return {
    ...(current || {}),
    ...(incoming || {}),
  };
}

function normalizeCliConfigItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }

  const normalized = { ...item };
  if (typeof normalized.targetProtocol === 'string' && normalized.targetProtocol.trim()) {
    normalized.targetProtocol = normalized.targetProtocol.trim();
  } else {
    delete normalized.targetProtocol;
  }
  return normalized;
}

function normalizeCliConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }

  return {
    ...config,
    claudeCode: normalizeCliConfigItem(config.claudeCode),
    codex: normalizeCliConfigItem(config.codex),
    geminiCli: normalizeCliConfigItem(config.geminiCli),
  };
}

function keepNewestRecordEntries(record, maxItems, getTimestamp) {
  const entries = Object.entries(record || {});
  if (entries.length <= maxItems) {
    return Object.fromEntries(entries);
  }

  return Object.fromEntries(
    entries.sort((left, right) => getTimestamp(right[1]) - getTimestamp(left[1])).slice(0, maxItems)
  );
}

function compactProbeHistory(history) {
  const allSamples = Object.values(history || {})
    .flat()
    .filter(sample => sample && typeof sample === 'object')
    .sort((left, right) => (right.testedAt || 0) - (left.testedAt || 0))
    .slice(0, MAX_ROUTE_PROBE_HISTORY_SAMPLES);
  const compacted = {};

  for (const sample of allSamples.sort(
    (left, right) => (left.testedAt || 0) - (right.testedAt || 0)
  )) {
    if (!sample.probeKey) {
      continue;
    }
    if (!compacted[sample.probeKey]) {
      compacted[sample.probeKey] = [];
    }
    compacted[sample.probeKey].push(sample);
  }

  return compacted;
}

function compactModelSources(sources) {
  const byKey = new Map();
  for (const source of sources || []) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    const key = source.sourceKey || JSON.stringify(source);
    byKey.set(key, source);
  }

  return Array.from(byKey.values()).slice(-MAX_ROUTE_MODEL_SOURCES);
}

function splitDetectionCacheData(cache) {
  if (!cache || typeof cache !== 'object') {
    return {};
  }

  const shared = {
    models: cache.models,
    user_groups: cache.user_groups,
    model_pricing: cache.model_pricing,
    last_refresh: cache.last_refresh,
  };

  const runtime = {
    balance: cache.balance,
    today_usage: cache.today_usage,
    today_prompt_tokens: cache.today_prompt_tokens,
    today_completion_tokens: cache.today_completion_tokens,
    today_requests: cache.today_requests,
    api_keys: cache.api_keys,
    last_refresh: cache.last_refresh,
    has_checkin: cache.has_checkin,
    can_check_in: cache.can_check_in,
    cli_compatibility: cache.cli_compatibility,
    ldc_payment_supported: cache.ldc_payment_supported,
    ldc_exchange_rate: cache.ldc_exchange_rate,
    ldc_payment_type: cache.ldc_payment_type,
    checkin_stats: cache.checkin_stats,
    status: cache.status,
    error: cache.error,
    endpoint_hints: cache.endpoint_hints,
  };

  return {
    shared: hasMeaningfulValues(shared) ? shared : undefined,
    runtime: hasMeaningfulValues(runtime) ? runtime : undefined,
  };
}

function resolveDefaultConfigPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'api-hub-management-tools', 'config.json');
  }

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'api-hub-management-tools',
      'config.json'
    );
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfigHome, 'api-hub-management-tools', 'config.json');
}

function parseArgs(argv) {
  const args = {
    path: resolveDefaultConfigPath(),
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }

    if (current === '--path') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --path');
      }
      args.path = path.resolve(next);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return args;
}

function readJsonIfExists(filePath, defaultValue, normalize) {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return normalize ? normalize(parsed) : parsed;
}

function normalizeRuntimeCache(value) {
  const partial = value && typeof value === 'object' ? value : {};
  return {
    version: partial.version || RUNTIME_CACHE_VERSION,
    site_shared_by_site_id: partial.site_shared_by_site_id || {},
    site_runtime_by_site_id: partial.site_runtime_by_site_id || {},
    account_runtime_by_account_id: partial.account_runtime_by_account_id || {},
    site_daily_snapshots_by_site_id: partial.site_daily_snapshots_by_site_id || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteRuntimeState(value) {
  const partial = value && typeof value === 'object' ? value : {};
  return {
    version: partial.version || ROUTE_RUNTIME_STATE_VERSION,
    stats: partial.stats || {},
    routePathStates: partial.routePathStates || {},
    health: partial.health || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteProbesState(value) {
  const partial = value && typeof value === 'object' ? value : {};
  return {
    version: partial.version || ROUTE_PROBES_STATE_VERSION,
    latest: partial.latest || {},
    history: partial.history || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteAnalyticsState(value) {
  const partial = value && typeof value === 'object' ? value : {};
  return {
    version: partial.version || ROUTE_ANALYTICS_STATE_VERSION,
    buckets: partial.buckets || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteModelSourcesState(value) {
  const partial = value && typeof value === 'object' ? value : {};
  return {
    version: partial.version || ROUTE_MODEL_SOURCES_STATE_VERSION,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
    last_updated: partial.last_updated || 0,
  };
}

function buildTempPath(targetPath) {
  return path.join(
    path.dirname(targetPath),
    [
      path.basename(targetPath),
      process.pid,
      Date.now(),
      Math.random().toString(36).slice(2),
      'tmp',
    ].join('.')
  );
}

function writeJsonAtomically(filePath, value) {
  const tempPath = buildTempPath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-config-v224-to-v301.cjs [--path <config.json>] [--dry-run]

Options:
  --path     Legacy config.json path. Defaults to the app userData config path.
  --dry-run  Print the migration summary without writing changes.
  -h, --help Show this help message.

Notes:
  - This migrates legacy v2.1.24-style config data into the v3.0.1 app line format.
  - The resulting config schema version is ${CONFIG_VERSION}.
  - Detection cache is split into runtime-cache.json.
  - Route runtime/probe/analytics/model source payloads are split into state/route-*.json.
`);
}

function ensureSiteGroups(siteGroups) {
  const groups = Array.isArray(siteGroups) ? [...siteGroups] : [];

  if (!groups.some(group => group.id === DEFAULT_GROUP.id)) {
    groups.unshift(DEFAULT_GROUP);
  }

  if (!groups.some(group => group.id === UNAVAILABLE_GROUP.id)) {
    groups.push(UNAVAILABLE_GROUP);
  }

  return groups;
}

function normalizeBaseUrl(baseUrl) {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function findMatchingRule(value, rules) {
  if (!value) {
    return null;
  }

  for (const rule of rules) {
    if (rule.pattern.test(value)) {
      return rule.siteType;
    }
  }

  return null;
}

function extractTitle(html) {
  if (typeof html !== 'string') {
    return '';
  }

  const match = html.match(/<title>(.*?)<\/title>/i);
  return match && match[1] ? match[1].trim() : '';
}

function detectFromHtml(html) {
  const title = extractTitle(html);
  const titleSiteType = findMatchingRule(title, SITE_TYPE_RULES);
  if (titleSiteType) {
    return { siteType: titleSiteType, detectionMethod: 'title' };
  }

  const matchedMarkers = SUB2API_HTML_MARKERS.filter(marker => marker.pattern.test(html)).map(
    marker => marker.label
  );
  if (matchedMarkers.includes('window.__APP_CONFIG__') && matchedMarkers.length >= 3) {
    return {
      siteType: 'sub2api',
      detectionMethod: 'html-marker',
    };
  }

  return null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getStatusMetadata(payload) {
  if (!isRecord(payload)) {
    return '';
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  return [data.system_name, data.systemName, data.site_name, data.siteName, data.name, data.version]
    .filter(item => typeof item === 'string' && item.trim())
    .join(' ');
}

function detectSiteTypeFromStatus(payload) {
  if (!isRecord(payload)) {
    return null;
  }

  const metadata = getStatusMetadata(payload);
  const hintedType = findMatchingRule(metadata, SITE_TYPE_RULES);
  if (hintedType) {
    return hintedType;
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const hasSystemName =
    !!data &&
    ['system_name', 'systemName', 'site_name', 'siteName'].some(
      key => typeof data[key] === 'string' && data[key].trim()
    );

  if (payload.success === true && hasSystemName) {
    return 'newapi';
  }

  if (payload.success === true) {
    return 'oneapi';
  }

  return null;
}

function isSub2ApiEnvelope(payload) {
  return (
    isRecord(payload) &&
    typeof payload.code === 'number' &&
    typeof payload.message === 'string' &&
    ('data' in payload || 'error' in payload)
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function detectSiteTypeForUrl(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const hintedByUrl = findMatchingRule(normalizedBaseUrl, SITE_TYPE_RULES);
  if (hintedByUrl) {
    return { siteType: hintedByUrl, detectionMethod: 'url-hint' };
  }

  try {
    const html = await fetchText(`${normalizedBaseUrl}/`);
    const homeDetection = detectFromHtml(html);
    if (homeDetection) {
      return homeDetection;
    }
  } catch {}

  try {
    const statusPayload = await fetchJson(`${normalizedBaseUrl}/api/status`);
    const statusSiteType = detectSiteTypeFromStatus(statusPayload);
    if (statusSiteType) {
      return { siteType: statusSiteType, detectionMethod: 'api-status' };
    }
  } catch {}

  try {
    const authPayload = await fetchJson(`${normalizedBaseUrl}/api/v1/auth/me`);
    if (isSub2ApiEnvelope(authPayload)) {
      return { siteType: 'sub2api', detectionMethod: 'sub2api-envelope' };
    }
  } catch {}

  return { siteType: DEFAULT_SITE_TYPE, detectionMethod: 'fallback' };
}

async function normalizeSite(site, now, summary) {
  const normalized = {
    ...site,
    id: site.id || generateSiteId(),
    site_type: site.site_type,
    enabled: site.enabled !== false,
    group: site.group || DEFAULT_GROUP.id,
    created_at: site.created_at || now,
    updated_at: site.updated_at || now,
  };

  if (!site.id) {
    summary.generatedSiteIds += 1;
  }
  if (!site.site_type && site.url) {
    try {
      const detection = await detectSiteTypeForUrl(site.url);
      if (detection.detectionMethod !== 'fallback') {
        normalized.site_type = detection.siteType;
        summary.detectedSiteTypes += 1;
      } else {
        summary.pendingSiteTypeDetection += 1;
      }
    } catch {
      summary.pendingSiteTypeDetection += 1;
    }
  } else if (!site.site_type) {
    summary.pendingSiteTypeDetection += 1;
  }

  return normalized;
}

function normalizeAccount(account, now) {
  return {
    ...account,
    id: account.id || generateAccountId(),
    status: account.status || 'active',
    auth_source: account.auth_source || 'manual',
    created_at: account.created_at || now,
    updated_at: account.updated_at || now,
  };
}

function buildRouteStateSnapshotFromConfig(config, existingState, now) {
  const routing = config.routing || {};
  const modelRegistry = routing.modelRegistry || {};
  const cliProbe = routing.cliProbe || {};
  const analytics = routing.analytics || {};

  return {
    runtime: {
      version: ROUTE_RUNTIME_STATE_VERSION,
      stats: keepNewestRecordEntries(
        mergeRecord(existingState.runtime.stats, routing.stats),
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.lastUsedAt || value.lastSuccessAt || value.lastFailureAt || 0
      ),
      routePathStates: keepNewestRecordEntries(
        mergeRecord(existingState.runtime.routePathStates, routing.routePathStates),
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.updatedAt || value.lastUsedAt || 0
      ),
      health: keepNewestRecordEntries(
        mergeRecord(existingState.runtime.health, routing.health),
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.testedAt || 0
      ),
      last_updated: now,
    },
    probes: {
      version: ROUTE_PROBES_STATE_VERSION,
      latest: keepNewestRecordEntries(
        mergeRecord(existingState.probes.latest, cliProbe.latest),
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.lastSample?.testedAt || value.lastSuccessAt || value.lastFailureAt || 0
      ),
      history: compactProbeHistory(mergeRecord(existingState.probes.history, cliProbe.history)),
      last_updated: now,
    },
    analytics: {
      version: ROUTE_ANALYTICS_STATE_VERSION,
      buckets: keepNewestRecordEntries(
        mergeRecord(existingState.analytics.buckets, analytics.buckets),
        MAX_ROUTE_ANALYTICS_BUCKETS,
        value => value.updatedAt || value.bucketStart || 0
      ),
      last_updated: now,
    },
    modelSources: {
      version: ROUTE_MODEL_SOURCES_STATE_VERSION,
      sources: compactModelSources([
        ...(existingState.modelSources.sources || []),
        ...(modelRegistry.sources || []),
      ]),
      last_updated: now,
    },
  };
}

function createPersistableRouting(routing) {
  if (!routing) {
    return undefined;
  }

  return {
    ...routing,
    stats: {},
    routePathStates: {},
    health: {},
    modelRegistry: routing.modelRegistry
      ? {
          ...routing.modelRegistry,
          sources: [],
          lastAggregatedAt: undefined,
        }
      : undefined,
    cliProbe: routing.cliProbe
      ? {
          config: { ...(routing.cliProbe.config || {}) },
          latest: {},
          history: {},
        }
      : undefined,
    analytics: routing.analytics
      ? {
          config: { ...(routing.analytics.config || {}) },
          buckets: {},
        }
      : undefined,
  };
}

async function migrateConfigShape(config, existingRuntimeCache, existingRouteState) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config root must be an object');
  }

  if (!Array.isArray(config.sites)) {
    throw new Error('Config must contain a sites array');
  }

  const now = Date.now();
  const summary = {
    sourceVersion: config.version || 'unknown',
    targetVersion: CONFIG_VERSION,
    siteCount: 0,
    accountCount: 0,
    detectedSiteTypes: 0,
    pendingSiteTypeDetection: 0,
    generatedSiteIds: 0,
    repairedLegacyAccounts: 0,
    siteSharedCacheEntries: 0,
    siteRuntimeCacheEntries: 0,
    accountRuntimeCacheEntries: 0,
    routeStatsEntries: 0,
    routePathStateEntries: 0,
    routeProbeLatestEntries: 0,
    routeProbeHistorySamples: 0,
    routeAnalyticsBucketEntries: 0,
    routeModelSourceEntries: 0,
  };

  const sites = await Promise.all(
    config.sites
      .filter(site => site && typeof site === 'object')
      .map(site => normalizeSite(site, now, summary))
  );

  const accounts = Array.isArray(config.accounts)
    ? config.accounts
        .filter(account => account && typeof account === 'object')
        .map(account => normalizeAccount(account, now))
    : [];

  const accountsBySite = new Map();
  for (const account of accounts) {
    if (!account.site_id) {
      continue;
    }

    const list = accountsBySite.get(account.site_id) || [];
    list.push(account);
    accountsBySite.set(account.site_id, list);
  }

  for (const site of sites) {
    const existingAccounts = accountsBySite.get(site.id) || [];
    const legacyAccessToken = site.access_token || site.system_token;
    if (existingAccounts.length > 0 || !legacyAccessToken || !site.user_id) {
      continue;
    }

    const account = {
      id: generateAccountId(),
      site_id: site.id,
      account_name: '默认账户',
      user_id: site.user_id,
      access_token: legacyAccessToken,
      auth_source: 'manual',
      status: 'active',
      cached_data: site.cached_data ? { ...site.cached_data } : undefined,
      cli_config: normalizeCliConfig(site.cli_config),
      created_at: now,
      updated_at: now,
    };
    accounts.push(account);
    accountsBySite.set(site.id, [account]);
    summary.repairedLegacyAccounts += 1;
  }

  const runtimeCache = normalizeRuntimeCache(existingRuntimeCache || createEmptyRuntimeCache());
  const siteIdsWithAccounts = new Set(accounts.map(account => account.site_id));

  for (const site of sites) {
    const { shared, runtime } = splitDetectionCacheData(site.cached_data);
    if (shared) {
      runtimeCache.site_shared_by_site_id[site.id] = mergeDefined(
        runtimeCache.site_shared_by_site_id[site.id],
        shared
      );
    }
    if (runtime && !siteIdsWithAccounts.has(site.id)) {
      runtimeCache.site_runtime_by_site_id[site.id] = mergeDefined(
        runtimeCache.site_runtime_by_site_id[site.id],
        runtime
      );
    }
  }

  for (const account of accounts) {
    const { shared, runtime } = splitDetectionCacheData(account.cached_data);
    if (shared) {
      runtimeCache.site_shared_by_site_id[account.site_id] = mergeDefined(
        runtimeCache.site_shared_by_site_id[account.site_id],
        shared
      );
    }
    if (runtime) {
      runtimeCache.account_runtime_by_account_id[account.id] = mergeDefined(
        runtimeCache.account_runtime_by_account_id[account.id],
        runtime
      );
    }
  }

  runtimeCache.last_updated = now;
  const routeState = buildRouteStateSnapshotFromConfig(
    config,
    existingRouteState || createEmptyRouteStateSnapshot(),
    now
  );

  const persistableConfig = {
    ...config,
    version: CONFIG_VERSION,
    sites: sites.map(site => {
      const { cached_data: _cachedData, ...persistableSite } = site;
      return {
        ...persistableSite,
        cli_config: normalizeCliConfig(persistableSite.cli_config),
      };
    }),
    accounts: accounts.map(account => {
      const { cached_data: _cachedData, ...persistableAccount } = account;
      return {
        ...persistableAccount,
        cli_config: normalizeCliConfig(persistableAccount.cli_config),
      };
    }),
    siteGroups: ensureSiteGroups(config.siteGroups),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(config.settings || {}),
    },
    routing: createPersistableRouting(config.routing),
    last_updated: now,
  };

  summary.siteCount = persistableConfig.sites.length;
  summary.accountCount = persistableConfig.accounts.length;
  summary.siteSharedCacheEntries = Object.keys(runtimeCache.site_shared_by_site_id).length;
  summary.siteRuntimeCacheEntries = Object.keys(runtimeCache.site_runtime_by_site_id).length;
  summary.accountRuntimeCacheEntries = Object.keys(
    runtimeCache.account_runtime_by_account_id
  ).length;
  summary.routeStatsEntries = Object.keys(routeState.runtime.stats).length;
  summary.routePathStateEntries = Object.keys(routeState.runtime.routePathStates).length;
  summary.routeProbeLatestEntries = Object.keys(routeState.probes.latest).length;
  summary.routeProbeHistorySamples = Object.values(routeState.probes.history).reduce(
    (total, samples) => total + samples.length,
    0
  );
  summary.routeAnalyticsBucketEntries = Object.keys(routeState.analytics.buckets).length;
  summary.routeModelSourceEntries = routeState.modelSources.sources.length;

  return {
    config: persistableConfig,
    runtimeCache,
    routeState,
    summary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(args.path)) {
    throw new Error(`Config file not found: ${args.path}`);
  }

  const raw = fs.readFileSync(args.path, 'utf-8');
  const parsed = JSON.parse(raw);
  const configDir = path.dirname(args.path);
  const runtimeCachePath = path.join(path.dirname(args.path), 'runtime-cache.json');
  const stateDir = path.join(configDir, 'state');
  const routeRuntimePath = path.join(stateDir, 'route-runtime.json');
  const routeProbesPath = path.join(stateDir, 'route-probes.json');
  const routeAnalyticsPath = path.join(stateDir, 'route-analytics.json');
  const routeModelSourcesPath = path.join(stateDir, 'route-model-sources.json');
  const existingRuntimeCache = readJsonIfExists(
    runtimeCachePath,
    createEmptyRuntimeCache(),
    normalizeRuntimeCache
  );
  const existingRouteState = {
    runtime: readJsonIfExists(
      routeRuntimePath,
      createEmptyRouteRuntimeState(),
      normalizeRouteRuntimeState
    ),
    probes: readJsonIfExists(
      routeProbesPath,
      createEmptyRouteProbesState(),
      normalizeRouteProbesState
    ),
    analytics: readJsonIfExists(
      routeAnalyticsPath,
      createEmptyRouteAnalyticsState(),
      normalizeRouteAnalyticsState
    ),
    modelSources: readJsonIfExists(
      routeModelSourcesPath,
      createEmptyRouteModelSourcesState(),
      normalizeRouteModelSourcesState
    ),
  };
  const migrated = await migrateConfigShape(parsed, existingRuntimeCache, existingRouteState);

  console.log('[migrate-config-v224-to-v301] Migration summary:');
  console.log(JSON.stringify(migrated.summary, null, 2));
  console.log(`Target config path: ${args.path}`);
  console.log(`Target runtime cache path: ${runtimeCachePath}`);
  console.log(`Target route runtime path: ${routeRuntimePath}`);
  console.log(`Target route probes path: ${routeProbesPath}`);
  console.log(`Target route analytics path: ${routeAnalyticsPath}`);
  console.log(`Target route model sources path: ${routeModelSourcesPath}`);

  if (args.dryRun) {
    console.log('Dry run enabled. No files were written.');
    return;
  }

  const timestamp = Date.now();
  const backupPath = args.path.replace(/\.json$/i, `.before-v301-migration.${timestamp}.json`);
  fs.copyFileSync(args.path, backupPath);

  const backupExistingFile = filePath => {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const backupFilePath = filePath.replace(/\.json$/i, `.before-v301-migration.${timestamp}.json`);
    fs.copyFileSync(filePath, backupFilePath);
    return backupFilePath;
  };

  for (const filePath of [
    runtimeCachePath,
    routeRuntimePath,
    routeProbesPath,
    routeAnalyticsPath,
    routeModelSourcesPath,
  ]) {
    const backupFilePath = backupExistingFile(filePath);
    if (backupFilePath) {
      console.log(`Existing state/cache backup created: ${backupFilePath}`);
    }
  }

  writeJsonAtomically(args.path, migrated.config);
  writeJsonAtomically(runtimeCachePath, migrated.runtimeCache);
  writeJsonAtomically(routeRuntimePath, migrated.routeState.runtime);
  writeJsonAtomically(routeProbesPath, migrated.routeState.probes);
  writeJsonAtomically(routeAnalyticsPath, migrated.routeState.analytics);
  writeJsonAtomically(routeModelSourcesPath, migrated.routeState.modelSources);

  console.log(`Backup created: ${backupPath}`);
  console.log(`Config migrated: ${args.path}`);
  console.log(`Runtime cache written: ${runtimeCachePath}`);
  console.log(`Route state written: ${stateDir}`);
}

main().catch(error => {
  console.error(`[migrate-config-v224-to-v301] ${error.message}`);
  process.exitCode = 1;
});
