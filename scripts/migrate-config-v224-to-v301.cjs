#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_VERSION = '3.1';
const RUNTIME_CACHE_VERSION = '1';
const DEFAULT_SITE_TYPE = 'newapi';

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
    last_updated: 0,
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
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
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

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-config-v224-to-v301.cjs [--path <config.json>] [--dry-run]

Options:
  --path     Legacy config.json path. Defaults to the app userData config path.
  --dry-run  Print the migration summary without writing changes.
  -h, --help Show this help message.

Notes:
  - This migrates legacy v2.1.24-style config data into the v3.0.1 app line format.
  - The resulting config schema version is ${CONFIG_VERSION}, and runtime cache is split into runtime-cache.json.
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
  return [
    data.system_name,
    data.systemName,
    data.site_name,
    data.siteName,
    data.name,
    data.version,
  ]
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

async function migrateConfigShape(config) {
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
      cli_config: site.cli_config ? { ...site.cli_config } : undefined,
      created_at: now,
      updated_at: now,
    };
    accounts.push(account);
    accountsBySite.set(site.id, [account]);
    summary.repairedLegacyAccounts += 1;
  }

  const runtimeCache = createEmptyRuntimeCache();
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

  const persistableConfig = {
    ...config,
    version: CONFIG_VERSION,
    sites: sites.map(site => {
      const { cached_data: _cachedData, ...persistableSite } = site;
      return persistableSite;
    }),
    accounts: accounts.map(account => {
      const { cached_data: _cachedData, ...persistableAccount } = account;
      return persistableAccount;
    }),
    siteGroups: ensureSiteGroups(config.siteGroups),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(config.settings || {}),
    },
    last_updated: now,
  };

  summary.siteCount = persistableConfig.sites.length;
  summary.accountCount = persistableConfig.accounts.length;
  summary.siteSharedCacheEntries = Object.keys(runtimeCache.site_shared_by_site_id).length;
  summary.siteRuntimeCacheEntries = Object.keys(runtimeCache.site_runtime_by_site_id).length;
  summary.accountRuntimeCacheEntries = Object.keys(
    runtimeCache.account_runtime_by_account_id
  ).length;

  return {
    config: persistableConfig,
    runtimeCache,
    summary,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
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
  const migrated = await migrateConfigShape(parsed);
  const runtimeCachePath = path.join(path.dirname(args.path), 'runtime-cache.json');

  console.log('[migrate-config-v224-to-v301] Migration summary:');
  console.log(JSON.stringify(migrated.summary, null, 2));
  console.log(`Target config path: ${args.path}`);
  console.log(`Target runtime cache path: ${runtimeCachePath}`);

  if (args.dryRun) {
    console.log('Dry run enabled. No files were written.');
    return;
  }

  const backupPath = args.path.replace(/\.json$/i, `.before-v301-migration.${Date.now()}.json`);
  fs.copyFileSync(args.path, backupPath);

  if (fs.existsSync(runtimeCachePath)) {
    const runtimeBackupPath = runtimeCachePath.replace(
      /\.json$/i,
      `.before-v301-migration.${Date.now()}.json`
    );
    fs.copyFileSync(runtimeCachePath, runtimeBackupPath);
    console.log(`Existing runtime cache backup created: ${runtimeBackupPath}`);
  }

  writeJson(args.path, migrated.config);
  writeJson(runtimeCachePath, migrated.runtimeCache);

  console.log(`Backup created: ${backupPath}`);
  console.log(`Config migrated: ${args.path}`);
  console.log(`Runtime cache written: ${runtimeCachePath}`);
}

main().catch(error => {
  console.error(`[migrate-config-v224-to-v301] ${error.message}`);
  process.exitCode = 1;
});
