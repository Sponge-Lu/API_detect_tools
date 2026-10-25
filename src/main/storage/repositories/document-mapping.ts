import { encodePayload, decodePayload } from '../database/payload-codec';

export type JsonRecord = Record<string, any>;
export type Row = Record<string, string | number | null>;
export interface TableRows {
  table: string;
  keys: string[];
  rows: Row[];
}
export interface MappedDocument {
  metadata: JsonRecord;
  tables: TableRows[];
}

export const STORAGE_DOCUMENT_PATHS = {
  'stable-config': 'config.json',
  'custom-cli-configs': 'custom-cli-configs.json',
  'config-file-profiles': 'config-file-profiles.json',
  'runtime-detection-cache': 'runtime-cache.json',
  'route-runtime-state': 'state/route-runtime.json',
  'route-analytics-state': 'state/route-analytics.json',
  'model-registry-source-state': 'state/route-model-sources.json',
  'route-endpoint-test-state': 'state/route-endpoint-tests.json',
  'route-session-activity': 'state/route-session-activity.json',
  'route-session-bindings': 'state/route-session-bindings.json',
  'route-state-affinity': 'state/route-state-affinity.json',
  'theme-settings': 'theme-settings.json',
  'close-behavior-settings': 'close-behavior-settings.json',
  'update-settings': 'update-settings.json',
} as const;
export type StorageDocumentId = keyof typeof STORAGE_DOCUMENT_PATHS;

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid storage object');
  return value as JsonRecord;
}
function at(root: JsonRecord, location: string): unknown {
  return location
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as JsonRecord)[key] : undefined),
      root
    );
}
function set(root: JsonRecord, location: string, value: unknown): void {
  const keys = location.split('.');
  let parent = root;
  for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
  parent[keys[keys.length - 1]] = value;
}
interface Collection {
  location: string;
  table: string;
  keys: string[];
  kind: 'array' | 'map';
  keyColumn?: string;
  columns?: (value: JsonRecord, key: string, order: number) => Row;
}
const configCollections: Collection[] = [
  {
    location: 'siteGroups',
    table: 'site_groups',
    keys: ['id'],
    kind: 'array',
    columns: (v, _, order) => ({ id: v.id, name: v.name, sort_order: order }),
  },
  {
    location: 'sites',
    table: 'sites',
    keys: ['id'],
    kind: 'array',
    columns: (v, _, order) => ({
      id: v.id,
      group_id: v.group,
      enabled: Number(v.enabled),
      sort_order: order,
    }),
  },
  {
    location: 'accounts',
    table: 'accounts',
    keys: ['id'],
    kind: 'array',
    columns: (v, _, order) => ({ id: v.id, site_id: v.site_id, sort_order: order }),
  },
  {
    location: 'routing.rules',
    table: 'route_rules',
    keys: ['id'],
    kind: 'array',
    columns: (v, _, order) => ({
      id: v.id,
      priority: v.priority,
      sort_order: order,
      enabled: Number(v.enabled),
      has_site_filter: Number(Array.isArray(v.allowedSiteIds)),
      has_account_filter: Number(Array.isArray(v.allowedAccountIds)),
    }),
  },
  {
    location: 'routing.modelRegistry.displayItems',
    table: 'model_redirects',
    keys: ['id'],
    kind: 'array',
    columns: (v, _, order) => ({ id: v.id, sort_order: order }),
  },
  {
    location: 'routing.clientRouting',
    table: 'client_routing',
    keys: ['client_id'],
    kind: 'map',
    columns: (v, key) => ({ client_id: key, mode: v.mode, pinned: Number(v.pinned === true) }),
  },
  {
    location: 'routing.sessionRouting.instances',
    table: 'session_choices',
    keys: ['id'],
    kind: 'map',
    columns: (v, key) => ({
      id: key,
      profile_id: v.profileId ?? null,
      parent_id: v.parentInstanceId ?? null,
      pinned: Number(v.pinned === true),
    }),
  },
  {
    location: 'routing.sessionRouting.rules',
    table: 'document_records',
    keys: ['document_id', 'collection', 'record_key'],
    kind: 'array',
  },
  ...[
    'routing.modelRegistry.overrides',
    'routing.sessionRouting.overrides',
    'routing.sessionRouting.currentRouteBySlot',
  ].map(location => ({
    location,
    table: 'document_records',
    keys: ['document_id', 'collection', 'record_key'],
    kind: (location.endsWith('.overrides') && location.includes('modelRegistry')
      ? 'array'
      : 'map') as 'array' | 'map',
  })),
];

function analyticsColumns(v: JsonRecord, key: string): Row {
  return {
    bucket_key: key,
    bucket_start: v.bucketStart,
    site_id: v.siteId ?? null,
    account_id: v.accountId ?? null,
    cli_type: v.cliType,
    target_protocol: v.targetProtocol ?? null,
    target_endpoint: v.targetEndpoint ?? null,
    route_rule_id: v.routeRuleId ?? null,
    canonical_model: v.canonicalModel ?? null,
    api_key_id: v.apiKeyId ?? null,
    request_count: v.requestCount,
    success_count: v.successCount,
    failure_count: v.failureCount,
    neutral_count: v.neutralCount,
    prompt_tokens: v.promptTokens,
    completion_tokens: v.completionTokens,
    total_tokens: v.totalTokens,
    updated_at: v.updatedAt,
  };
}

function collections(id: StorageDocumentId): Collection[] {
  if (id === 'stable-config') return configCollections;
  if (id === 'runtime-detection-cache')
    return [
      'site_shared_by_site_id',
      'site_runtime_by_site_id',
      'account_runtime_by_account_id',
    ].map(location => ({
      location,
      table: 'detection_cache',
      keys: ['owner_kind', 'owner_id'],
      keyColumn: 'owner_id',
      kind: 'map',
      columns: (v: JsonRecord, key: string) => ({
        owner_kind: location,
        owner_id: key,
        updated_at: v.last_refresh ?? 0,
      }),
    }));
  if (id === 'custom-cli-configs')
    return [
      {
        location: 'configs',
        table: 'custom_cli_configs',
        keys: ['id'],
        kind: 'array',
        columns: (v, _, order) => ({ id: v.id, sort_order: order }),
      },
    ];
  if (id === 'config-file-profiles')
    return [
      {
        location: 'profiles',
        table: 'config_file_profiles',
        keys: ['id'],
        kind: 'array',
        columns: (v, _, order) => ({ id: v.id, revision: v.revision ?? 1, sort_order: order }),
      },
    ];
  if (id === 'route-analytics-state')
    return [
      {
        location: 'buckets',
        table: 'route_analytics_buckets',
        keys: ['bucket_key'],
        kind: 'map',
        columns: analyticsColumns,
      },
    ];
  if (id === 'model-registry-source-state')
    return [
      {
        location: 'sources',
        table: 'route_model_sources',
        keys: ['source_key'],
        kind: 'array',
        columns: (v, _, order) => ({
          source_key: JSON.stringify([v.sourceKey, v.originalModel]),
          source_type: v.sourceType,
          site_id: v.siteId ?? null,
          account_id: v.accountId ?? null,
          last_seen_at: v.lastSeenAt,
          sort_order: order,
        }),
      },
      {
        location: 'entries',
        table: 'document_records',
        keys: ['document_id', 'collection', 'record_key'],
        kind: 'map',
      },
    ];
  if (id === 'route-runtime-state')
    return ['stats', 'routePathStates', 'routeEndpointCapabilities', 'health'].map(location => ({
      location,
      table: 'route_runtime',
      keys: ['kind', 'record_key'],
      keyColumn: 'record_key',
      kind: 'map',
      columns: (v: JsonRecord, key: string) => ({
        kind: location,
        record_key: key,
        updated_at: v.updatedAt ?? v.lastUsedAt ?? v.testedAt ?? 0,
      }),
    }));
  if (id === 'route-session-activity')
    return [
      {
        location: 'instances',
        table: 'session_activity',
        keys: ['instance_id'],
        kind: 'map',
        columns: (v, key) => ({ instance_id: key, last_request_at: v.lastRequestAt }),
      },
    ];
  if (id === 'route-session-bindings')
    return [
      {
        location: 'bindings',
        table: 'session_bindings',
        keys: ['binding_key'],
        kind: 'map',
        columns: (v, key) => ({ binding_key: key, updated_at: v.lastUsedAt }),
      },
    ];
  if (id === 'route-state-affinity')
    return [
      {
        location: 'resources',
        table: 'response_affinity',
        keys: ['namespace', 'resource_id'],
        keyColumn: 'resource_id',
        kind: 'map',
        columns: (v, key) => ({
          namespace: 'provider-resource',
          resource_id: key,
          profile_id: v.profileId ?? null,
          updated_at: v.createdAt,
        }),
      },
    ];
  const locations: Record<string, Array<[string, 'array' | 'map']>> = {
    'runtime-detection-cache': [
      ['site_shared_by_site_id', 'map'],
      ['site_runtime_by_site_id', 'map'],
      ['account_runtime_by_account_id', 'map'],
      ['site_daily_snapshots_by_site_id', 'map'],
    ],
    'route-runtime-state': [
      ['stats', 'map'],
      ['routePathStates', 'map'],
      ['routeEndpointCapabilities', 'map'],
      ['health', 'map'],
    ],
    'model-registry-source-state': [['sources', 'array']],
    'route-endpoint-test-state': [['targets', 'map']],
    'route-session-activity': [['activities', 'map']],
    'route-session-bindings': [['bindings', 'map']],
    'route-state-affinity': [['resources', 'map']],
  };
  return (locations[id] ?? []).map(([location, kind]) => ({
    location,
    kind,
    table: 'document_records',
    keys: ['document_id', 'collection', 'record_key'],
  }));
}

export function mapDocument(id: StorageDocumentId, input: unknown): MappedDocument {
  const metadata = record(JSON.parse(JSON.stringify(input)));
  if (
    id === 'stable-config' &&
    (!Array.isArray(metadata.sites) ||
      !Array.isArray(metadata.accounts) ||
      !Array.isArray(metadata.siteGroups))
  )
    throw new Error('Invalid stable configuration collections');
  if (id === 'custom-cli-configs' && !Array.isArray(metadata.configs))
    throw new Error('Invalid direct configuration collection');
  if (id === 'config-file-profiles' && !Array.isArray(metadata.profiles))
    throw new Error('Invalid client profile collection');
  const tables: TableRows[] = [];
  if (id === 'runtime-detection-cache' && metadata.site_daily_snapshots_by_site_id !== undefined) {
    const rows: Row[] = [];
    for (const [siteId, snapshots] of Object.entries(
      record(metadata.site_daily_snapshots_by_site_id)
    )) {
      if (!Array.isArray(snapshots)) throw new Error('Invalid daily snapshots');
      for (const snapshot of snapshots)
        rows.push({
          site_id: siteId,
          snapshot_date: identityText(snapshot.snapshotDate),
          payload: encodePayload(snapshot),
        });
    }
    tables.push({ table: 'site_daily_snapshots', keys: ['site_id', 'snapshot_date'], rows });
    metadata.site_daily_snapshots_by_site_id = {};
  }
  const childTables = new Map<string, TableRows>();
  const addChild = (table: string, keys: string[], row: Row) => {
    if (!childTables.has(table)) childTables.set(table, { table, keys, rows: [] });
    childTables.get(table)!.rows.push(row);
  };
  for (const spec of collections(id)) {
    const value = at(metadata, spec.location);
    if (value === undefined) {
      tables.push({ table: spec.table, keys: spec.keys, rows: [] });
      continue;
    }
    if (
      spec.kind === 'array'
        ? !Array.isArray(value)
        : !value || typeof value !== 'object' || Array.isArray(value)
    ) {
      throw new Error(`Invalid collection: ${spec.location}`);
    }
    const entries =
      spec.kind === 'array'
        ? (value as unknown[]).map((v, index) => [String(index), v] as const)
        : Object.entries(value as JsonRecord);
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const [order, [key, raw]] of entries.entries()) {
      // Slot maps may contain string values; generic rows preserve these verbatim.
      const v = spec.columns ? record(raw) : raw;
      const fields = spec.columns ? { ...v } : v;
      if (id === 'stable-config' && spec.location === 'accounts') {
        if (Array.isArray(fields.local_api_keys)) {
          fields.local_api_keys.forEach((item: JsonRecord, index: number) =>
            addChild('account_keys', ['account_id', 'source', 'key_id'], {
              account_id: fields.id,
              source: 'local',
              key_id: item.id,
              sort_order: index,
              payload: encodePayload(item),
            })
          );
          fields.local_api_keys = [];
        }
      }
      if (id === 'stable-config' && spec.location === 'routing.rules') {
        for (const [order, siteId] of (fields.allowedSiteIds ?? []).entries())
          addChild('rule_sites', ['rule_id', 'site_id'], {
            rule_id: fields.id,
            site_id: siteId,
            sort_order: order,
          });
        for (const [order, accountId] of (fields.allowedAccountIds ?? []).entries())
          addChild('rule_accounts', ['rule_id', 'account_id'], {
            rule_id: fields.id,
            account_id: accountId,
            sort_order: order,
          });
        if (Array.isArray(fields.allowedSiteIds)) fields.allowedSiteIds = [];
        if (Array.isArray(fields.allowedAccountIds)) fields.allowedAccountIds = [];
      }
      if (
        id === 'stable-config' &&
        spec.location === 'routing.modelRegistry.displayItems' &&
        fields.autoCollect
      ) {
        for (const [order, model] of (fields.autoCollect.excludedModels ?? []).entries())
          addChild('model_exclusions', ['redirect_id', 'model_key'], {
            redirect_id: fields.id,
            model_key: model,
            sort_order: order,
          });
        fields.autoCollect = { ...fields.autoCollect, excludedModels: [] };
      }
      if (id === 'custom-cli-configs' && Array.isArray(fields.apiKeys)) {
        fields.apiKeys.forEach((item: JsonRecord, index: number) =>
          addChild('custom_cli_keys', ['config_id', 'key_id'], {
            config_id: fields.id,
            key_id: item.id,
            sort_order: index,
            payload: encodePayload(item),
          })
        );
        fields.apiKeys = [];
      }
      if (id === 'config-file-profiles' && Array.isArray(fields.files)) {
        fields.files.forEach((item: JsonRecord, index: number) =>
          addChild('profile_files', ['profile_id', 'file_id'], {
            profile_id: fields.id,
            file_id: item.id,
            sort_order: index,
            payload: encodePayload(item),
          })
        );
        fields.files = [];
      }
      const columns = spec.columns
        ? spec.columns(record(raw), key, order)
        : {
            document_id: id,
            collection: spec.location,
            record_key:
              spec.kind === 'array' && raw && typeof raw === 'object' && 'id' in raw
                ? String(raw.id)
                : key,
            sort_order: order,
          };
      const identity = JSON.stringify(spec.keys.map(name => columns[name]));
      if (seen.has(identity) || spec.keys.some(name => columns[name] === undefined))
        throw new Error(`Duplicate or missing identity: ${spec.location}`);
      seen.add(identity);
      rows.push({ ...columns, payload: encodePayload(fields) });
    }
    tables.push({ table: spec.table, keys: spec.keys, rows });
    set(metadata, spec.location, spec.kind === 'array' ? [] : {});
  }
  if (id === 'stable-config') {
    for (const [table, keys] of [
      ['account_keys', ['account_id', 'source', 'key_id']],
      ['rule_sites', ['rule_id', 'site_id']],
      ['rule_accounts', ['rule_id', 'account_id']],
      ['model_exclusions', ['redirect_id', 'model_key']],
    ] as const) {
      if (!childTables.has(table)) childTables.set(table, { table, keys: [...keys], rows: [] });
    }
  }
  if (id === 'custom-cli-configs' && !childTables.has('custom_cli_keys'))
    childTables.set('custom_cli_keys', {
      table: 'custom_cli_keys',
      keys: ['config_id', 'key_id'],
      rows: [],
    });
  if (id === 'config-file-profiles' && !childTables.has('profile_files'))
    childTables.set('profile_files', {
      table: 'profile_files',
      keys: ['profile_id', 'file_id'],
      rows: [],
    });
  return { metadata, tables: [...tables, ...childTables.values()] };
}

export function reconstructDocument(
  id: StorageDocumentId,
  metadata: JsonRecord,
  read: (table: string, filter?: Row) => Row[]
): JsonRecord {
  const result = JSON.parse(JSON.stringify(metadata)) as JsonRecord;
  for (const spec of collections(id)) {
    if (at(metadata, spec.location) === undefined) continue;
    const rows = read(
      spec.table,
      spec.table === 'document_records'
        ? { document_id: id, collection: spec.location }
        : spec.table === 'route_runtime'
          ? { kind: spec.location }
          : spec.table === 'detection_cache'
            ? { owner_kind: spec.location }
            : undefined
    );
    const values = rows.map(row => {
      const value = decodePayload<JsonRecord>(row.payload as string);
      if (spec.table === 'sites')
        Object.assign(value, { id: row.id, group: row.group_id, enabled: row.enabled === 1 });
      if (spec.table === 'accounts') {
        Object.assign(value, { id: row.id, site_id: row.site_id });
        if (Array.isArray(value.local_api_keys))
          value.local_api_keys = read('account_keys', { account_id: row.id, source: 'local' }).map(
            item => decodePayload(item.payload as string)
          );
      }
      if (spec.table === 'route_rules') {
        Object.assign(value, { id: row.id, enabled: row.enabled === 1 });
        if (row.has_site_filter)
          value.allowedSiteIds = read('rule_sites', { rule_id: row.id }).map(item => item.site_id);
        if (row.has_account_filter)
          value.allowedAccountIds = read('rule_accounts', { rule_id: row.id }).map(
            item => item.account_id
          );
      }
      if (spec.table === 'model_redirects' && value.autoCollect)
        value.autoCollect.excludedModels = read('model_exclusions', { redirect_id: row.id }).map(
          item => item.model_key
        );
      if (spec.table === 'custom_cli_configs' && Array.isArray(value.apiKeys))
        value.apiKeys = read('custom_cli_keys', { config_id: row.id }).map(item =>
          decodePayload(item.payload as string)
        );
      if (spec.table === 'config_file_profiles' && Array.isArray(value.files))
        value.files = read('profile_files', { profile_id: row.id }).map(item =>
          decodePayload(item.payload as string)
        );
      return [
        String(
          spec.table === 'document_records'
            ? row.record_key
            : spec.keyColumn
              ? row[spec.keyColumn]
              : spec.keys.map(name => row[name]).join(':')
        ),
        value,
      ] as const;
    });
    set(
      result,
      spec.location,
      spec.kind === 'array' ? values.map(([, value]) => value) : Object.fromEntries(values)
    );
  }
  if (id === 'runtime-detection-cache' && metadata.site_daily_snapshots_by_site_id !== undefined) {
    const snapshots: Record<string, JsonRecord[]> = {};
    for (const row of read('site_daily_snapshots'))
      (snapshots[String(row.site_id)] ??= []).push(
        decodePayload<JsonRecord>(row.payload as string)
      );
    for (const values of Object.values(snapshots))
      values.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    result.site_daily_snapshots_by_site_id = snapshots;
  }
  return result;
}

function identityText(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing record identity');
  return value;
}
