import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigFileProfile } from '../shared/types/config-file-profile';
import { BUILTIN_CLI_TYPES } from '../shared/types/cli-config';
import { getBuiltinClientConfigTemplates } from '../shared/config/builtin-client-configs';
import * as atomicJson from '../main/utils/atomic-json';
import { backupConfigFile } from '../main/config-file-backups';
import { parse } from 'yaml';
import { createDshConfigFileProfile } from '../main/dsh-config-file-profile';
import { isDshConfigProfile } from '../shared/config/dsh-client-config';
import { DSH_ROUTE_CREDENTIAL_REF } from '../shared/types/dsh-integration';
import { detectDshRouting } from '../main/dsh-integration-service';

import {
  applyConfigFileProfile,
  commitConfigFileProfile,
  listSavedConfigFileBackups,
  previewConfigFileBackupRestore,
  createDefaultConfigFileProfiles,
  deleteConfigFileProfile,
  findConfigFileProfileByRouteApiKey,
  generateConfigFileProfileRouteKey,
  getConfigFileTargetCatalog,
  resolveConfigFileProfileValues,
  getSessionRecordCacheStats,
  loadConfigFileProfiles,
  previewConfigFileProfile,
  previewConfigFileProfileRouteKeyRotation,
  previewConfigFileDirectEdit,
  readConfigFiles,
  restoreBuiltinConfigFileProfile,
  restoreMissingBuiltinConfigFileProfiles,
  switchBuiltinConfigFileProfileAuthMode,
  saveConfigFile,
  saveConfigFileProfiles,
  scanSavedSessionRecords,
  scanSavedSessionRecordsWithDiagnostics,
  upsertConfigFileProfile,
} from '../main/config-file-profile-service';
import { routeStateAffinityService } from '../main/route-state-affinity-service';

const mocks = vi.hoisted(() => ({
  userData: '',
  sites: [] as any[],
  accounts: [] as any[],
  routing: {
    server: { host: '127.0.0.1', port: 3210, unifiedApiKey: 'secret' },
    modelRegistry: { entries: {}, displayItems: [], sources: [], overrides: [] },
  } as any,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userData,
    isReady: () => false,
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getRoutingConfig: () => ({
      ...mocks.routing,
    }),
    getSites: () => mocks.sites,
    getAccountsBySiteId: (siteId: string) =>
      mocks.accounts.filter(account => account.site_id === siteId),
    getSiteById: (siteId: string) => mocks.sites.find(site => site.id === siteId) || null,
    getAccountById: (accountId: string) => mocks.accounts.find(account => account.id === accountId),
  },
}));

vi.mock('../main/route-model-registry-service', () => ({
  resolveApiKeyId: (key: { id?: string | number; token_id?: string | number }) =>
    String(key.id ?? key.token_id ?? 'unknown'),
}));

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-detect-config-profile-'));
  // macOS 的 os.tmpdir() 位于 /var/folders/...，而 /var 是指向 /private/var 的符号链接；
  // 被测服务会拒绝任何祖先链上含符号链接的配置路径，因此这里必须回填真实路径。
  const canonical = await fs.realpath(directory).catch(() => directory);
  tempDirectories.push(canonical);
  return canonical;
}

function profile(
  filePaths: string[],
  template = 'url={{BASE_URL}}\nkey={{API_KEY}}\nmodel={{MODEL}}'
): ConfigFileProfile {
  return {
    id: 'profile-1',
    name: 'Test',
    files: filePaths.map((pathname, index) => ({
      id: `file-${index + 1}`,
      path: pathname,
      template,
      format: 'text',
    })),
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    target: { kind: 'local-route' },
    localRouteCredential: {
      id: 'credential-1',
      apiKey: 'sk-route-profile-1',
      createdAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  mocks.sites = [];
  mocks.accounts = [];
  mocks.routing = {
    server: { host: '127.0.0.1', port: 3210, unifiedApiKey: 'secret' },
    modelRegistry: { entries: {}, displayItems: [], sources: [], overrides: [] },
  };
  await Promise.all(
    tempDirectories.splice(0).map(item => fs.rm(item, { recursive: true, force: true }))
  );
});

it('preserves the secret-free import marker and rejects apply until reconfigured', async () => {
  const directory = await createTempDirectory();
  mocks.userData = directory;
  const card = {
    ...profile([path.join(directory, 'client.json')], ''),
    requiresConfiguration: true,
  };
  await saveConfigFileProfiles([card]);
  expect((await loadConfigFileProfiles())[0].requiresConfiguration).toBe(true);
  await expect(previewConfigFileProfile({ profileId: card.id })).rejects.toThrow('无密钥备份');
  await expect(fs.access(card.files[0].path)).rejects.toThrow();
});

describe('DSH configuration card', () => {
  async function fixture(initialize = true) {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    vi.stubEnv('DSH_HOME', path.join(directory, 'dsh'));
    mocks.routing.modelRegistry.displayItems = [
      { canonicalName: 'model-a' },
      { canonicalName: 'model-b' },
    ];
    const card = createDshConfigFileProfile(1);
    card.localRouteCredential = { id: 'dsh-key', apiKey: 'sk-dsh-card', createdAt: 1 };
    if (initialize) {
      await fs.mkdir(path.dirname(card.files[0].path), { recursive: true });
      await fs.writeFile(path.join(path.dirname(card.files[0].path), 'package.json'), '{}', 'utf8');
    }
    await saveConfigFileProfiles([card]);
    return card;
  }

  it('upgrades the legacy hidden credential once and preserves its identity and key', async () => {
    const card = await fixture();
    const legacy = {
      ...card,
      id: 'legacy-dsh-id',
      credentialOnly: true,
      builtin: undefined,
      dsh: undefined,
      isExample: false,
      files: [],
    };
    const storagePath = path.join(mocks.userData, 'config-file-profiles.json');
    await fs.writeFile(storagePath, JSON.stringify({ version: 3, profiles: [legacy] }), 'utf8');
    const upgraded = await loadConfigFileProfiles();
    const dsh = upgraded.find(isDshConfigProfile)!;
    expect(upgraded).toHaveLength(1);
    expect(dsh.id).toBe(legacy.id);
    expect(dsh.localRouteCredential).toEqual(card.localRouteCredential);
    expect(dsh.credentialOnly).toBe(false);
    expect(dsh.files).toHaveLength(2);
    expect((await loadConfigFileProfiles()).map(item => item.id)).toEqual([legacy.id]);
    expect(await restoreMissingBuiltinConfigFileProfiles()).toHaveLength(5);
    await expect(fs.access(card.files[0].path)).rejects.toThrow();
  });

  it('preserves custom DSH file cards when upgrading storage', async () => {
    const card = await fixture();
    const custom = {
      ...profile([path.join(mocks.userData, 'custom.yaml')], 'user template'),
      name: 'DSH',
    };
    await fs.writeFile(
      path.join(mocks.userData, 'config-file-profiles.json'),
      JSON.stringify({ version: 3, profiles: [custom] }),
      'utf8'
    );
    const loaded = await loadConfigFileProfiles();
    expect(loaded.find(item => item.id === custom.id)?.files).toEqual(custom.files);
    expect(loaded.filter(isDshConfigProfile)).toHaveLength(1);
    expect(loaded.find(isDshConfigProfile)?.localRouteCredential).toBeUndefined();
    expect(card.id).not.toBe(custom.id);
  });

  it('previews both YAML files without writing and commits while preserving unrelated content', async () => {
    const card = await fixture();
    const patch =
      '# keep comment\n- id: other\n  config:\n    expression: !!js ctx.custom\n- id: llm-deepseek\n  config:\n    thinking: enabled\n';
    const credentials = 'version: 1\nrefs:\n  OTHER: keep\n';
    await fs.writeFile(card.files[0].path, patch, 'utf8');
    await fs.writeFile(card.files[1].path, credentials, 'utf8');
    card.target.model = 'model-b';
    card.dsh = { modelSourceId: 'local-route', allowedModels: ['model-b'] };
    const saved = await upsertConfigFileProfile({ profile: card });
    const preview = await previewConfigFileProfile({ profileId: saved.id });
    expect(preview.files).toHaveLength(2);
    expect(await fs.readFile(card.files[0].path, 'utf8')).toBe(patch);
    expect(await fs.readFile(card.files[1].path, 'utf8')).toBe(credentials);
    expect(preview.files[0].nextContent).toContain('# keep comment');
    expect(preview.files[0].nextContent).toContain('!!js ctx.custom');
    const entries = parse(preview.files[0].nextContent) as Array<{
      id: string;
      config: { thinking?: string; provider?: string; model?: string; allowedModels?: unknown[] };
    }>;
    expect(entries.find(item => item.id === 'llm-deepseek')?.config.thinking).toBe('enabled');
    expect(entries.find(item => item.id === 'agent-default-model')?.config).toEqual({
      provider: 'deepseek-official',
      model: 'model-b',
    });
    expect(
      entries.find(item => item.id === 'subagent-model-selection-settings')?.config.allowedModels
    ).toBeUndefined();
    await commitConfigFileProfile({ transactionId: preview.transactionId });
    expect(parse(await fs.readFile(card.files[1].path, 'utf8')).refs).toEqual({
      OTHER: 'keep',
      [DSH_ROUTE_CREDENTIAL_REF]: 'sk-dsh-card',
    });
    expect((await loadConfigFileProfiles())[0].lastApplied?.model).toBe('model-b');
  });

  it('requires initialization and preserves unavailable source selections', async () => {
    const card = await fixture(false);
    await expect(previewConfigFileProfile({ profileId: card.id })).rejects.toThrow('初始化');
    await fs.mkdir(path.dirname(card.files[0].path), { recursive: true });
    await fs.writeFile(path.join(path.dirname(card.files[0].path), 'package.json'), '{}', 'utf8');
    card.dsh = { modelSourceId: 'managed:removed:account' };
    await upsertConfigFileProfile({ profile: card });
    await expect(previewConfigFileProfile({ profileId: card.id })).rejects.toThrow(
      '模型来源已不可用'
    );
    await expect(fs.access(card.files[1].path)).rejects.toThrow();
  });

  it('writes all models or one model while preserving the existing subagent policy', async () => {
    const card = await fixture();
    const childPolicy = {
      enabled: true,
      allowedModels: [
        { provider: 'deepseek-account', model: 'official-a' },
        { provider: 'deepseek-account', model: 'official-b' },
      ],
    };
    await fs.writeFile(
      card.files[0].path,
      '- id: agent-default-model\n  config:\n    provider: deepseek-account\n    model: official-parent\n- id: subagent-model-selection-settings\n  config:\n    enabled: true\n    allowedModels:\n      - provider: deepseek-account\n        model: official-a\n      - provider: deepseek-account\n        model: official-b\n',
      'utf8'
    );
    const all = await previewConfigFileProfile({ profileId: card.id });
    const allEntries = parse(all.files[0].nextContent) as Array<{
      id: string;
      config: { models?: Array<{ id: string }>; enabled?: boolean; allowedModels?: unknown[] };
    }>;
    expect(
      allEntries.find(item => item.id === 'llm-deepseek')?.config.models?.map(model => model.id)
    ).toEqual(['model-a', 'model-b']);
    expect(
      allEntries.find(item => item.id === 'subagent-model-selection-settings')?.config
    ).toEqual(childPolicy);
    card.target.model = 'model-b';
    await upsertConfigFileProfile({ profile: card });
    const single = await previewConfigFileProfile({ profileId: card.id });
    const singleEntries = parse(single.files[0].nextContent) as typeof allEntries;
    expect(
      singleEntries.find(item => item.id === 'llm-deepseek')?.config.models?.map(model => model.id)
    ).toEqual(['model-b']);
    expect(
      singleEntries.find(item => item.id === 'subagent-model-selection-settings')?.config
    ).toEqual(childPolicy);
    expect(singleEntries.find(item => item.id === 'agent-default-model')?.config).toEqual({
      provider: 'deepseek-official',
      model: 'model-b',
    });
    await commitConfigFileProfile({ transactionId: single.transactionId });
    const status = await detectDshRouting({ isRunning: async () => false });
    expect(status.configured).toBe(true);
    expect(status.missingModels).toEqual([]);
    expect(status.matchedModelSourceId).toBe('local-route');
  });

  it('preserves native subagent settings during apply and restore and ignores stale card subagent options', async () => {
    const card = await fixture();
    const policy = {
      enabled: false,
      allowedModels: [{ provider: 'deepseek-official', model: 'model-a' }],
    };
    await fs.writeFile(
      card.files[0].path,
      '- id: subagent-model-selection-settings\n  config:\n    enabled: false\n    allowedModels:\n      - provider: deepseek-official\n        model: model-a\n',
      'utf8'
    );
    card.target.model = 'model-b';
    card.dsh = { modelSourceId: 'local-route', allowedModels: ['removed-model'] };
    await upsertConfigFileProfile({ profile: card });
    const preview = await previewConfigFileProfile({ profileId: card.id });
    const rows = parse(preview.files[0].nextContent) as Array<{ id: string; config: unknown }>;
    expect(rows.find(row => row.id === 'subagent-model-selection-settings')?.config).toEqual(
      policy
    );
    await commitConfigFileProfile({ transactionId: preview.transactionId });
    expect((await loadConfigFileProfiles())[0].dsh?.allowedModels).toEqual(['removed-model']);
    const current = await fs.readFile(card.files[0].path, 'utf8');
    await fs.writeFile(
      card.files[0].path,
      current.replace('model: model-a', 'model: changed-after-apply'),
      'utf8'
    );
    const restore = await previewConfigFileProfile({ profileId: card.id, restoreDsh: true });
    const restoredRows = parse(restore.files[0].nextContent) as typeof rows;
    expect(
      restoredRows.find(row => row.id === 'subagent-model-selection-settings')?.config
    ).toEqual({
      ...policy,
      allowedModels: [{ provider: 'deepseek-official', model: 'changed-after-apply' }],
    });
  });

  it('rejects changing DSH templates or switching to official login', async () => {
    const card = await fixture();
    card.files[0].template = 'user change';
    await expect(upsertConfigFileProfile({ profile: card })).rejects.toThrow('专用');
    await expect(
      switchBuiltinConfigFileProfileAuthMode({ profileId: card.id, authMode: 'official' })
    ).rejects.toThrow('不支持切换');
  });

  it('rejects changed files and changed model catalogs after preview', async () => {
    const card = await fixture();
    const preview = await previewConfigFileProfile({ profileId: card.id });
    await fs.writeFile(card.files[0].path, '# external\n[]\n', 'utf8');
    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      '外部修改'
    );
    const second = await previewConfigFileProfile({ profileId: card.id });
    mocks.routing.modelRegistry.displayItems.push({ canonicalName: 'model-c' });
    await expect(commitConfigFileProfile({ transactionId: second.transactionId })).rejects.toThrow(
      '已变化'
    );
    await expect(fs.access(card.files[1].path)).rejects.toThrow();
  });

  it('rotates only the managed credential reference and retains profile identity', async () => {
    const card = await fixture();
    const applied = await previewConfigFileProfile({ profileId: card.id });
    await commitConfigFileProfile({ transactionId: applied.transactionId });
    await fs.appendFile(card.files[1].path, '  OTHER: sk-dsh-card\n', 'utf8');
    const rotation = await previewConfigFileProfileRouteKeyRotation({ profileId: card.id });
    expect(rotation.files[0].changed).toBe(false);
    await commitConfigFileProfile({ transactionId: rotation.transactionId });
    const persisted = (await loadConfigFileProfiles())[0];
    expect(persisted.id).toBe(card.id);
    expect(persisted.localRouteCredential?.apiKey).not.toBe('sk-dsh-card');
    const refs = parse(await fs.readFile(card.files[1].path, 'utf8')).refs;
    expect(refs.OTHER).toBe('sk-dsh-card');
    expect(refs[DSH_ROUTE_CREDENTIAL_REF]).toBe(persisted.localRouteCredential?.apiKey);
  });

  it('restores the original managed entries through preview and preserves later unrelated edits', async () => {
    const card = await fixture();
    const patch = '- id: llm-deepseek\n  config:\n    baseURL: https://original.example\n';
    await fs.writeFile(card.files[0].path, patch, 'utf8');
    await fs.writeFile(card.files[1].path, 'version: 1\nrefs:\n  OTHER: keep\n', 'utf8');
    const applied = await previewConfigFileProfile({ profileId: card.id });
    await commitConfigFileProfile({ transactionId: applied.transactionId });
    await fs.appendFile(
      card.files[0].path,
      '- id: added-later\n  config: { enabled: true }\n',
      'utf8'
    );
    const restore = await previewConfigFileProfile({ profileId: card.id, restoreDsh: true });
    expect(restore.operation).toBe('dsh-rollback');
    expect(restore.files[0].nextContent).toContain('https://original.example');
    expect(restore.files[0].nextContent).toContain('added-later');
    await commitConfigFileProfile({ transactionId: restore.transactionId });
    expect(parse(await fs.readFile(card.files[1].path, 'utf8')).refs).toEqual({ OTHER: 'keep' });
    expect((await loadConfigFileProfiles())[0].lastApplied).toBeUndefined();
  });

  it('restores using legacy DSH integration backups', async () => {
    const card = await fixture();
    const legacyBackup = `${card.files[0].path}.apidetect-20261021010000.bak`;
    await fs.writeFile(
      legacyBackup,
      '- id: llm-deepseek\n  config:\n    baseURL: https://legacy.example\n',
      'utf8'
    );
    await fs.writeFile(
      card.files[0].path,
      '- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:3210\n',
      'utf8'
    );
    const restore = await previewConfigFileProfile({ profileId: card.id, restoreDsh: true });
    expect(restore.files[0].nextContent).toContain('https://legacy.example');
  });

  it('rolls back the first YAML file if writing the second fails', async () => {
    const card = await fixture();
    await fs.writeFile(card.files[0].path, '[]\n', 'utf8');
    const preview = await previewConfigFileProfile({ profileId: card.id });
    const write = atomicJson.writeTextFileAtomically;
    vi.spyOn(atomicJson, 'writeTextFileAtomically').mockImplementation(
      async (pathname, content, options) => {
        if (pathname === card.files[1].path) throw new Error('credential write failed');
        return write(pathname, content, options);
      }
    );
    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      'credential write failed'
    );
    expect(await fs.readFile(card.files[0].path, 'utf8')).toBe('[]\n');
    expect((await loadConfigFileProfiles())[0].lastApplied).toBeUndefined();
  });

  it('does not change vendor configuration when restoring a card that was never applied', async () => {
    const card = await fixture();
    const patch = '- id: llm-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n';
    await fs.writeFile(card.files[0].path, patch, 'utf8');
    const preview = await previewConfigFileProfile({ profileId: card.id, restoreDsh: true });
    expect(preview.files.every(file => !file.changed)).toBe(true);
    await commitConfigFileProfile({ transactionId: preview.transactionId });
    expect(await fs.readFile(card.files[0].path, 'utf8')).toBe(patch);
    await expect(fs.access(card.files[1].path)).rejects.toThrow();
  });

  it('keeps a chosen model source when its catalog gains models and normalizes wildcard hosts', async () => {
    const card = await fixture();
    mocks.routing.server.host = '0.0.0.0';
    mocks.sites = [
      { id: 'site', name: 'Provider', url: 'https://upstream.example', enabled: true },
    ];
    mocks.accounts = [
      {
        id: 'account',
        site_id: 'site',
        account_name: 'Account',
        api_key: 'provider-key',
        cached_data: { models: ['provider-model'] },
      },
    ];
    card.dsh = { modelSourceId: 'managed:site:account' };
    await upsertConfigFileProfile({ profile: card });
    const values = await resolveConfigFileProfileValues({ profile: card });
    expect(values.baseUrl).toBe('http://127.0.0.1:3210');
    expect(values.apiKey).toBe('sk-dsh-card');
    const first = await previewConfigFileProfile({ profileId: card.id });
    await commitConfigFileProfile({ transactionId: first.transactionId });
    mocks.accounts[0].cached_data.models.push('provider-new');
    const status = await detectDshRouting({ isRunning: async () => false });
    expect(status.missingModels).toEqual(['provider-new']);
    expect(status.staleModels).toEqual([]);
    const second = await previewConfigFileProfile({ profileId: card.id });
    expect(second.files[0].nextContent).toContain('provider-new');
    expect(second.files[0].nextContent).not.toContain('id: model-a');
  });
});

describe('config file profile service', () => {
  it('restores only the selected saved file through preview and commit with CAS checks', async () => {
    mocks.userData = await createTempDirectory();
    const target = path.join(mocks.userData, 'settings.json');
    await fs.writeFile(target, 'current', 'utf8');
    const saved = await upsertConfigFileProfile({ profile: profile([target]) });
    await backupConfigFile(target, 'historical');
    const [backup] = await listSavedConfigFileBackups({ profileId: saved.id, fileId: 'file-1' });
    const input = {
      profileId: saved.id,
      fileId: 'file-1',
      backupId: backup.id,
      expectedHash: backup.sha256,
      expectedRevision: saved.revision,
    };
    const preview = await previewConfigFileBackupRestore(input);
    expect(await fs.readFile(target, 'utf8')).toBe('current');
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0].nextContent).toBe('historical');
    await fs.writeFile(target, 'external', 'utf8');
    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      '外部修改'
    );
    expect(await fs.readFile(target, 'utf8')).toBe('external');
    const retry = await previewConfigFileBackupRestore(input);
    await commitConfigFileProfile({ transactionId: retry.transactionId });
    expect(await fs.readFile(target, 'utf8')).toBe('historical');
    await expect(previewConfigFileBackupRestore({ ...input, fileId: 'missing' })).rejects.toThrow(
      '不存在'
    );
    await expect(
      previewConfigFileBackupRestore({ ...input, expectedHash: 'changed' })
    ).rejects.toThrow('已变化');
  });

  it('uses a local key and its own models for managed configuration targets', async () => {
    mocks.userData = await createTempDirectory();
    mocks.sites = [
      { id: 'site-1', name: 'Managed', url: 'https://example.com/prefix/v1', enabled: true },
    ];
    mocks.accounts = [
      {
        id: 'account-1',
        site_id: 'site-1',
        account_name: 'Local',
        local_api_keys: [
          {
            id: 'local-key',
            name: 'Manual',
            key: 'plain-secret',
            group: 'custom',
            groupMultiplier: 2,
            source: 'local',
            models: ['local-model'],
          },
        ],
      },
    ];
    const catalog = await getConfigFileTargetCatalog();
    expect(catalog.find(entry => entry.accountId === 'account-1')).toMatchObject({
      available: true,
      models: ['local-model'],
      apiKeys: [{ id: 'local-key', scopedModels: ['local-model'] }],
    });
    const input = profile([]);
    input.target = {
      kind: 'managed',
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'local-key',
      model: 'local-model',
    };
    await expect(resolveConfigFileProfileValues({ profile: input })).resolves.toMatchObject({
      apiKey: 'plain-secret',
      model: 'local-model',
      baseUrl: 'https://example.com/prefix/v1',
    });
  });

  it('renders versioned template URLs without adding v1 twice', async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, 'config.conf');
    await applyConfigFileProfile({
      profile: profile([file], 'url={{BASE_URL}}/v1'),
      values: {
        baseUrl: 'https://example.com/prefix/v1/',
        apiKey: 'plain-secret',
        model: 'model-a',
      },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('url=https://example.com/prefix/v1');
  });
  it('caches unknown route credentials until the profile index is rebuilt', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    await saveConfigFileProfiles([]);
    const storagePath = path.join(directory, 'config-file-profiles.json');
    const added = profile([]);
    added.localRouteCredential = {
      id: 'credential-later',
      apiKey: 'sk-route-later',
      createdAt: 2,
    };

    await expect(findConfigFileProfileByRouteApiKey('sk-route-later')).resolves.toBeNull();
    await fs.writeFile(storagePath, JSON.stringify({ version: 3, profiles: [added] }), 'utf8');
    await expect(findConfigFileProfileByRouteApiKey('sk-route-later')).resolves.toBeNull();
    await saveConfigFileProfiles([added]);

    await expect(findConfigFileProfileByRouteApiKey('sk-route-later')).resolves.toMatchObject({
      id: added.id,
      localRouteCredential: added.localRouteCredential,
    });
  });

  it('persists and transactionally rotates a credential-only client route key', async () => {
    mocks.userData = await createTempDirectory();
    const now = Date.now();
    const saved = await upsertConfigFileProfile({
      profile: {
        id: 'credential-only-aider',
        name: 'Aider',
        agentLogoId: 'cursor',
        credentialOnly: true,
        files: [],
        sessionRecordConnectors: [],
        sessionRecordPaths: [],
        target: { kind: 'local-route', model: null },
        createdAt: now,
        updatedAt: now,
      },
    });

    const generated = await generateConfigFileProfileRouteKey({
      profileId: saved.id,
      expectedRevision: saved.revision,
    });

    expect(generated).toMatchObject({
      name: 'Aider',
      agentLogoId: 'cursor',
      credentialOnly: true,
      revision: 2,
      files: [],
      localRouteCredential: {
        id: expect.any(String),
        apiKey: expect.stringMatching(/^sk-route-/),
      },
    });
    await expect(loadConfigFileProfiles()).resolves.toContainEqual(generated);

    const rotation = await previewConfigFileProfileRouteKeyRotation({
      profileId: generated.id,
      expectedRevision: generated.revision,
    });
    expect(rotation.files).toEqual([]);
    expect(rotation.nextLocalRouteCredential?.apiKey).toMatch(/^sk-route-/);
    expect(rotation.nextLocalRouteCredential?.apiKey).not.toBe(
      generated.localRouteCredential?.apiKey
    );

    await commitConfigFileProfile({ transactionId: rotation.transactionId });
    const rotated = (await loadConfigFileProfiles()).find(profile => profile.id === generated.id);
    expect(rotated).toMatchObject({
      revision: 3,
      localRouteCredential: rotation.nextLocalRouteCredential,
    });
  });

  it('rejects invalid credential-only profile content and logo overrides', async () => {
    mocks.userData = await createTempDirectory();
    const base = {
      id: 'invalid-credential-only',
      name: 'Invalid',
      credentialOnly: true,
      files: [],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route' as const, model: null },
      createdAt: 1,
      updatedAt: 1,
    };

    await expect(
      upsertConfigFileProfile({
        profile: { ...base, agentLogoId: 'not-a-logo' as never },
      })
    ).rejects.toThrow('客户端 Logo 参数无效');
    await expect(
      upsertConfigFileProfile({
        profile: {
          ...base,
          files: [{ id: 'file-a', path: 'config.json', template: '{}' }],
        },
      })
    ).rejects.toThrow('仅凭证客户端只能保存名称、Logo 和本地路由凭证');
  });

  it('reports missing files without creating them', async () => {
    const directory = await createTempDirectory();
    const pathname = path.join(directory, 'missing.json');
    await expect(readConfigFiles([pathname])).resolves.toEqual([
      expect.objectContaining({
        fileId: 'legacy:0',
        path: pathname,
        exists: false,
        content: '',
        mtimeMs: null,
      }),
    ]);
    await expect(fs.stat(pathname)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('saves direct edits atomically and creates a recoverable backup', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, 'before', 'utf-8');
    await saveConfigFile(pathname, 'after');
    expect(await fs.readFile(pathname, 'utf-8')).toBe('after');
    const [backupId] = await fs.readdir(path.join(directory, 'backups', 'cli-config'));
    const backupModule = await import('../main/config-file-backups');
    const original = (await backupModule.listConfigFileBackups(pathname)).find(
      item => item.id === 'original'
    )!;
    expect(await backupModule.readConfigFileBackup(pathname, 'original', original.sha256)).toBe(
      'before'
    );
    expect(
      await fs.readFile(path.join(directory, 'backups', 'cli-config', backupId, 'original'), 'utf8')
    ).toMatch(/^api-hub-cli-backup:v1/);
  });

  it('applies one rendered template to all files after validating the full batch', async () => {
    const directory = await createTempDirectory();
    const files = [path.join(directory, 'a.conf'), path.join(directory, 'b.conf')];
    await Promise.all(files.map(file => fs.writeFile(file, 'before', 'utf-8')));
    await applyConfigFileProfile({
      profile: profile(files),
      values: { baseUrl: 'http://127.0.0.1:3210', apiKey: 'secret', model: 'model-a' },
    });
    const expected = 'url=http://127.0.0.1:3210\nkey=secret\nmodel=model-a';
    await expect(Promise.all(files.map(file => fs.readFile(file, 'utf-8')))).resolves.toEqual([
      expected,
      expected,
    ]);
  });

  it('renders each file with its own template and fixed replacement tokens', async () => {
    const directory = await createTempDirectory();
    const first = path.join(directory, 'first.conf');
    const second = path.join(directory, 'second.conf');
    const input = profile([first, second]);
    input.files[0].template = 'first={{BASE_URL}}';
    input.files[1].template = 'second={{MODEL}}';

    await applyConfigFileProfile({
      profile: input,
      values: { baseUrl: 'local-url', apiKey: 'secret', model: 'model-a' },
    });

    await expect(fs.readFile(first, 'utf-8')).resolves.toBe('first=local-url');
    await expect(fs.readFile(second, 'utf-8')).resolves.toBe('second=model-a');
  });

  it('allows templates without replacement tokens', async () => {
    const directory = await createTempDirectory();
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, 'before', 'utf-8');
    await applyConfigFileProfile({
      profile: profile([pathname], 'no placeholders'),
      values: { baseUrl: 'url', apiKey: 'key', model: 'model' },
    });
    expect(await fs.readFile(pathname, 'utf-8')).toBe('no placeholders');
  });

  it('creates five default examples using the same profile and file schema', () => {
    const defaults = createDefaultConfigFileProfiles(1);
    expect(defaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Claude Code', isExample: true }),
        expect.objectContaining({ name: 'Codex', isExample: true }),
        expect.objectContaining({ name: 'OpenCode', isExample: true }),
        expect.objectContaining({ name: 'Grok Build', isExample: true }),
        expect.objectContaining({ name: 'DeepSeek Harness', isExample: true }),
      ])
    );
    expect(defaults.map(item => item.files.length)).toEqual([2, 2, 2, 1, 2]);
    const codexTemplate = defaults.find(item => item.name === 'Codex')?.files[0].template;
    expect(codexTemplate).toContain('wire_api = "responses"');
    expect(codexTemplate).toContain('web_search = "disabled"');
    expect(codexTemplate).not.toContain('disable_response_storage');
    expect(codexTemplate).not.toContain('network_access');
    const openCodeTemplate = defaults.find(item => item.name === 'OpenCode')?.files[0].template;
    expect(openCodeTemplate).toContain('api-detect-anthropic');
    expect(openCodeTemplate).toContain('"apiKey": "{{API_KEY}}"');
    const grokTemplate = defaults.find(item => item.name === 'Grok Build')?.files[0].template;
    expect(grokTemplate).toContain('api_backend = "responses"');
    expect(grokTemplate).toContain('api_backend = "chat_completions"');
    expect(grokTemplate).toContain('api_backend = "messages"');
    expect(grokTemplate).toContain('"anthropic-version" = "2023-06-01"');
    expect(defaults.every(item => item.builtin?.fingerprint)).toBe(true);
    expect(
      defaults
        .flatMap(item => item.files)
        .every(file => !file.template.includes('x-api-detect-cli'))
    ).toBe(true);
  });

  it('upgrades untouched v2 built-ins that contain the removed CLI marker', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const legacy = createDefaultConfigFileProfiles(1)[2];
    legacy.files = legacy.files.map(file => ({
      ...file,
      template: `${file.template}\n// x-api-detect-cli`,
    }));
    legacy.builtin = {
      ...legacy.builtin!,
      version: 2,
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ name: legacy.name, files: legacy.files }))
        .digest('hex'),
    };
    legacy.agentLogoId = 'cursor';
    legacy.localRouteCredential = {
      id: 'preserved-credential',
      apiKey: 'sk-route-preserved',
      createdAt: 1,
    };
    await fs.writeFile(
      path.join(directory, 'config-file-profiles.json'),
      JSON.stringify({ version: 3, profiles: [legacy] }),
      'utf-8'
    );

    const [upgraded] = await loadConfigFileProfiles();

    expect(upgraded.builtin?.version).toBe(6);
    expect(upgraded.files.every(file => !file.template.includes('x-api-detect-cli'))).toBe(true);
    expect(upgraded.agentLogoId).toBe('cursor');
    expect(upgraded.localRouteCredential?.apiKey).toBe('sk-route-preserved');
  });

  it('upgrades only untouched simplified examples and preserves modified examples', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const [legacyClaude, legacyCodex] = createDefaultConfigFileProfiles(1);
    legacyClaude.files = [
      {
        id: 'legacy-claude-file',
        path: '~/.claude/settings.json',
        template:
          '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "{{BASE_URL}}",\n    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",\n    "ANTHROPIC_MODEL": "{{MODEL}}"\n  }\n}',
      },
    ];
    legacyClaude.builtin = undefined;
    legacyCodex.files = [{ ...legacyCodex.files[0], template: 'user modified' }];
    legacyCodex.builtin = undefined;
    await fs.writeFile(
      path.join(directory, 'config-file-profiles.json'),
      JSON.stringify({ version: 2, profiles: [legacyClaude, legacyCodex] }),
      'utf-8'
    );

    const loaded = await loadConfigFileProfiles();
    expect(loaded.find(item => item.id === 'example:claude-code')?.files).toHaveLength(2);
    expect(loaded.find(item => item.id === 'example:codex')?.files).toHaveLength(1);
    expect(loaded.find(item => item.id === 'example:codex')?.files[0].template).toBe(
      'user modified'
    );
  });

  it('restores a modified built-in example without replacing its target', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const builtin = createDefaultConfigFileProfiles(1)[0];
    builtin.files[0].template = 'user modified';
    builtin.target = { kind: 'local-route', model: 'selected-model' };
    await saveConfigFileProfiles([builtin]);

    const restored = await restoreBuiltinConfigFileProfile({
      profileId: builtin.id,
      expectedRevision: builtin.revision,
    });
    expect(restored.files).toHaveLength(2);
    expect(restored.files[0].template).not.toBe('user modified');
    expect(restored.target).toEqual({ kind: 'local-route', model: 'selected-model' });
  });

  it('restores built-in examples deleted from the UI', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const defaults = createDefaultConfigFileProfiles(1);
    await saveConfigFileProfiles(defaults);
    await deleteConfigFileProfile({ profileId: defaults[1].id });

    expect((await loadConfigFileProfiles()).map(profile => profile.id)).not.toContain(
      defaults[1].id
    );

    const restored = await restoreMissingBuiltinConfigFileProfiles();
    expect(restored.map(profile => profile.id)).toEqual(
      expect.arrayContaining(defaults.map(profile => profile.id))
    );
    expect(restored.find(profile => profile.id === defaults[1].id)?.isExample).toBe(true);
  });

  it('provides official login templates without third-party placeholders', () => {
    for (const clientType of BUILTIN_CLI_TYPES) {
      const files = getBuiltinClientConfigTemplates(clientType, 'official');
      expect(files.length).toBeGreaterThan(0);
      expect(files.every(file => !file.content.includes('{{API_KEY}}'))).toBe(true);
      expect(files.every(file => !file.content.includes('{{BASE_URL}}'))).toBe(true);
    }
  });

  it('switches a built-in profile between third-party and official templates', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const defaults = createDefaultConfigFileProfiles(1);
    const codex = defaults.find(profile => profile.builtin?.clientType === 'codex')!;
    await saveConfigFileProfiles(defaults);

    const official = await switchBuiltinConfigFileProfileAuthMode({
      profileId: codex.id,
      authMode: 'official',
      expectedRevision: codex.revision,
    });
    expect(official.authMode).toBe('official');
    expect(official.files).toHaveLength(1);
    expect(official.files[0].template).toContain('model_provider = "openai"');
    expect(official.files[0].template).toContain('gpt-6-sol');
    expect(official.files[0].template).not.toContain('{{BASE_URL}}');

    const thirdParty = await switchBuiltinConfigFileProfileAuthMode({
      profileId: codex.id,
      authMode: 'third-party',
      expectedRevision: official.revision,
    });
    expect(thirdParty.authMode).toBe('third-party');
    expect(thirdParty.files).toHaveLength(2);
    expect(thirdParty.files[0].template).toContain('experimental_bearer_token');
  });

  it('merges official Codex templates over the third-party provider', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.toml');
    await fs.writeFile(
      pathname,
      'model_provider = "AnyAPI"\nmodel = "old-model"\n\n[model_providers.AnyAPI]\nname = "AnyAPI"\n',
      'utf-8'
    );
    const input = profile([pathname], 'model_provider = "openai"\nmodel = "gpt-6-sol"');
    input.files[0].format = 'toml';
    input.authMode = 'official';
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });
    expect(preview.files[0].nextContent).toContain('model_provider = "openai"');
    expect(preview.files[0].nextContent).toContain('model = "gpt-6-sol"');
  });

  it('merges official Claude settings with an empty env block', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'settings.json');
    await fs.writeFile(
      pathname,
      JSON.stringify({
        model: 'old-model',
        env: { ANTHROPIC_BASE_URL: 'https://relay.example', ANTHROPIC_AUTH_TOKEN: 'sk-old' },
      }),
      'utf-8'
    );
    const input = profile(
      [pathname],
      JSON.stringify({ model: 'opus[1m]', language: 'zh-CN', env: {} })
    );
    input.files[0].format = 'json';
    input.authMode = 'official';
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });
    const parsed = JSON.parse(preview.files[0].nextContent);
    expect(parsed.model).toBe('opus[1m]');
    expect(parsed.env).toEqual({});
  });

  it('keeps local, managed scoped, and managed all-model domains isolated', async () => {
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'local-redirect' }];
    mocks.sites = [
      { id: 'site-1', name: 'Site', url: 'https://site.example', enabled: true, group: 'default' },
      { id: 'site-off', name: 'Off', url: 'https://off.example', enabled: false, group: 'default' },
    ];
    mocks.accounts = [
      {
        id: 'account-1',
        site_id: 'site-1',
        account_name: 'Account',
        routeTargetProtocol: 'openai-responses',
        cached_data: {
          models: ['raw-a', 'raw-b'],
          api_keys: [{ id: 1, name: 'Key', group: 'group-a', status: 1, models: 'raw-a' }],
          model_pricing: {
            data: {
              'raw-a': { enable_groups: ['group-a'] },
              'raw-b': { enable_groups: ['group-b'] },
            },
          },
        },
      },
      {
        id: 'account-off',
        site_id: 'site-off',
        account_name: 'Off',
        cached_data: { api_keys: [{ id: 2, status: 1 }], models: ['must-not-appear'] },
      },
    ];

    const catalog = await getConfigFileTargetCatalog();
    expect(catalog.find(item => item.value === 'local-route')?.models).toEqual(['local-redirect']);
    const managed = catalog.find(item => item.value === 'managed:site-1:account-1');
    expect(managed?.apiKeys[0].scopedModels).toEqual(['raw-a']);
    expect(managed?.allModels).toEqual(['raw-a', 'raw-b']);
    expect(managed?.allModels).not.toContain('local-redirect');
    expect(managed?.targetProtocol).toBe('openai-responses');
    expect(catalog.find(item => item.value === 'managed:site-off:account-off')).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining('站点已禁用'),
    });
  });

  it('requires an independent key before previewing a local-route profile', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const input = profile([path.join(directory, 'config.json')]);
    delete input.localRouteCredential;
    await saveConfigFileProfiles([input]);

    await expect(
      previewConfigFileProfile({ profileId: input.id, applyMode: 'overwrite' })
    ).rejects.toThrow('请先为此配置卡片生成独立的本地路由 API Key');
  });

  it('rotates a profile key only after confirmed file diff commit', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.env');
    const input = profile([pathname]);
    await fs.writeFile(pathname, 'key=sk-route-profile-1', 'utf-8');
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfileRouteKeyRotation({
      profileId: input.id,
      expectedRevision: 1,
    });
    expect(preview.operation).toBe('key-rotation');
    expect(preview.files[0].content).toBe('key=sk-route-profile-1');
    expect(preview.files[0].nextContent).not.toBe(preview.files[0].content);
    expect((await loadConfigFileProfiles())[0].localRouteCredential?.apiKey).toBe(
      'sk-route-profile-1'
    );

    await commitConfigFileProfile({ transactionId: preview.transactionId });
    const rotated = (await loadConfigFileProfiles())[0];
    expect(rotated.localRouteCredential?.apiKey).toBe(preview.nextLocalRouteCredential?.apiKey);
    expect(await fs.readFile(pathname, 'utf-8')).toContain(
      preview.nextLocalRouteCredential!.apiKey
    );
  });

  it.each(['client', 'session'])(
    'rejects profile deletion when its %s route is pinned',
    async mode => {
      mocks.userData = await createTempDirectory();
      const input = profile([]);
      await saveConfigFileProfiles([input]);
      if (mode === 'client') {
        mocks.routing.clientRouting = { [input.id]: { mode: 'session', pinned: true } };
      } else {
        mocks.routing.sessionRouting = {
          instances: { pinned: { profileId: input.id, pinned: true } },
        };
      }
      const removeState = vi.spyOn(routeStateAffinityService, 'removeByProfile');
      await expect(deleteConfigFileProfile({ profileId: input.id })).rejects.toThrow(
        '请先取消钉住'
      );
      expect(removeState).not.toHaveBeenCalled();
      expect((await loadConfigFileProfiles()).map(item => item.id)).toContain(input.id);
    }
  );

  it('removes only the deleted profile state affinity records', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const first = profile([]);
    const second = { ...profile([]), id: 'profile-2', name: 'Other' };
    await saveConfigFileProfiles([first, second]);
    await routeStateAffinityService.bind({
      resourceId: 'response-1',
      resourceType: 'response',
      profileId: first.id,
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'key-1',
      routeRuleId: 'rule-1',
      targetProtocol: 'openai-responses',
      targetEndpoint: 'https://first.example.com',
      createdAt: 1,
    });
    await routeStateAffinityService.bind({
      resourceId: 'response-2',
      resourceType: 'response',
      profileId: second.id,
      siteId: 'site-2',
      accountId: 'account-2',
      apiKeyId: 'key-2',
      routeRuleId: 'rule-2',
      targetProtocol: 'openai-responses',
      targetEndpoint: 'https://second.example.com',
      createdAt: 1,
    });

    await deleteConfigFileProfile({ profileId: first.id, expectedRevision: first.revision });

    expect(await routeStateAffinityService.get('response-1', first.id)).toBeNull();
    expect(await routeStateAffinityService.get('response-2', second.id)).not.toBeNull();
  });

  it('merges structured JSON without dropping unrelated local values', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, '{"keep":1,"nested":{"old":true}}', 'utf-8');
    const input = profile([pathname], '{"nested":{"model":"{{MODEL}}"}}');
    input.files[0].format = 'json';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });
    expect(JSON.parse(preview.files[0].nextContent)).toEqual({
      keep: 1,
      nested: { old: true, model: 'model-a' },
    });
  });

  it('preserves unrelated JSON source text while updating template-owned fields', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'settings.json');
    const current = `{
    "keepLarge": 900719925474099312345,
    "keepEscaped": "\\u4f60\\u597d",
    "nested": { "old": true, "model": "old-model" }
}`;
    await fs.writeFile(pathname, current, 'utf-8');
    const input = profile([pathname], '{"nested":{"model":"{{MODEL}}","added":true}}');
    input.files[0].format = 'json';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toContain('"keepLarge": 900719925474099312345');
    expect(preview.files[0].nextContent).toContain('"keepEscaped": "\\u4f60\\u597d"');
    expect(preview.files[0].nextContent).toContain('"old": true');
    expect(preview.files[0].nextContent).toContain('"model": "model-a"');
    expect(preview.files[0].nextContent).toContain('"added": true');
  });

  it('merges OpenCode JSONC with comments and trailing commas', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'opencode.json');
    const current = `{
  // user setting
  "keep": 1,
  "nested": {
    "old": true,
    "model": "old-model", // keep this comment
  },
}`;
    await fs.writeFile(pathname, current, 'utf-8');
    const input = profile([pathname], '{"nested":{"model":"{{MODEL}}","added":true}}');
    input.files[0].format = 'json';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toContain('// user setting');
    expect(preview.files[0].nextContent).toContain('// keep this comment');
    expect(preview.files[0].nextContent).toContain('"keep": 1');
    expect(preview.files[0].nextContent).toContain('"model": "model-a"');
    expect(preview.files[0].nextContent).toContain('"added": true');
  });

  it('preserves ENV line endings, export prefixes, spacing, comments, and unrelated lines', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, '.env');
    const current =
      '  export API_KEY = old-value  # managed by user\r\nUNRELATED = "value # literal"\r\n';
    await fs.writeFile(pathname, current, 'utf-8');
    const input = profile([pathname], 'API_KEY={{API_KEY}}\nNEW_VALUE=enabled');
    input.files[0].format = 'env';
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toBe(
      '  export API_KEY = sk-route-profile-1  # managed by user\r\n' +
        'UNRELATED = "value # literal"\r\n' +
        'NEW_VALUE=enabled\r\n'
    );
  });

  it('updates only template-owned TOML keys without rewriting unrelated Codex settings', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.toml');
    const current = `# keep this comment
model_provider = "OldProvider"
model = "old-model"
experimental_setting = { enabled = true, count = 2 }

[model_providers.AnyAPI]
name = "Old name"
base_url = "https://old.example/v1"
wire_api = "responses"
custom_header = "keep"

[features]
web_search_request = true
`;
    await fs.writeFile(pathname, current, 'utf-8');
    const input = profile(
      [pathname],
      `model_provider = "AnyAPI"
model = "{{MODEL}}"

[model_providers.AnyAPI]
name = "AnyAPI"
base_url = "{{BASE_URL}}/v1"
wire_api = "responses"`
    );
    input.files[0].format = 'toml';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toBe(`# keep this comment
model_provider = "AnyAPI"
model = "model-a"
experimental_setting = { enabled = true, count = 2 }

[model_providers.AnyAPI]
name = "AnyAPI"
base_url = "http://127.0.0.1:3210/v1"
wire_api = "responses"
custom_header = "keep"

[features]
web_search_request = true
`);
  });

  it('matches quoted and dotted TOML paths without redefining Grok model tables', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.toml');
    const current = `model."api-detect-grok-responses".model = "old-model"
model."api-detect-grok-responses".custom = "keep"

[models]
default = "old"
`;
    await fs.writeFile(pathname, current, 'utf-8');
    const input = profile(
      [pathname],
      `[models]
default = "api-detect-grok-responses"

[model.api-detect-grok-responses]
model = "{{MODEL}}"
base_url = "{{BASE_URL}}/v1"
api_key = "{{API_KEY}}"`
    );
    input.files[0].format = 'toml';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toContain(
      'model."api-detect-grok-responses".model = "model-a"'
    );
    expect(preview.files[0].nextContent).toContain(
      'model."api-detect-grok-responses".custom = "keep"'
    );
    expect(preview.files[0].nextContent).toContain(
      'model.api-detect-grok-responses.base_url = "http://127.0.0.1:3210/v1"'
    );
    expect(preview.files[0].nextContent).not.toContain('[model.api-detect-grok-responses]');
  });

  it('merges a Grok inline table template into an existing child table', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.toml');
    await fs.writeFile(
      pathname,
      `[model.api-detect-grok-messages]
model = "old-model"

[model.api-detect-grok-messages.extra_headers]
x-api-key = "old-key"
x-user-header = "keep"
`,
      'utf-8'
    );
    const input = profile(
      [pathname],
      `[model.api-detect-grok-messages]
model = "{{MODEL}}"
extra_headers = { "x-api-key" = "{{API_KEY}}" }`
    );
    input.files[0].format = 'toml';
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toContain('x-api-key = "sk-route-profile-1"');
    expect(preview.files[0].nextContent).toContain('x-user-header = "keep"');
    expect(preview.files[0].nextContent).not.toContain('extra_headers = {');
  });

  it('removes obsolete managed Grok auth fields while preserving unrelated settings', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, '.grok', 'config.toml');
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await fs.writeFile(
      pathname,
      `[model.api-detect-grok-responses]
api_key = "old-key"
extra_headers = { "x-api-key" = "stale-key" }
custom = "keep"

[model.api-detect-grok-messages]
api_key = "stale-key"
extra_headers = { "x-api-key" = "old-key" }
`,
      'utf-8'
    );
    const input = profile(
      [pathname],
      `[model.api-detect-grok-responses]
api_key = "{{API_KEY}}"

[model.api-detect-grok-messages]
extra_headers = { "x-api-key" = "{{API_KEY}}" }`
    );
    input.files[0].format = 'toml';
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });

    expect(preview.files[0].nextContent).toContain('custom = "keep"');
    expect(preview.files[0].nextContent).not.toContain('"stale-key"');
    expect(preview.files[0].nextContent).toContain('api_key = "sk-route-profile-1"');
    expect(preview.files[0].nextContent).toContain(
      'extra_headers = { "x-api-key" = "sk-route-profile-1" }'
    );
  });

  it('removes only the obsolete Claude proxy values generated by the old template', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await fs.writeFile(
      pathname,
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'old-key',
          HTTPS_PROXY: 'http://127.0.0.1:7890',
          HTTP_PROXY: 'http://127.0.0.1:7890',
          CUSTOM_PROXY: 'http://127.0.0.1:9000',
        },
      }),
      'utf-8'
    );
    const input = profile(
      [pathname],
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: '{{API_KEY}}' } })
    );
    input.files[0].format = 'json';
    await saveConfigFileProfiles([input]);

    const preview = await previewConfigFileProfile({ profileId: input.id, applyMode: 'merge' });
    const next = JSON.parse(preview.files[0].nextContent);

    expect(next.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: 'sk-route-profile-1',
      CUSTOM_PROXY: 'http://127.0.0.1:9000',
    });
    expect(next.env.HTTPS_PROXY).toBeUndefined();
    expect(next.env.HTTP_PROXY).toBeUndefined();
  });

  it('rejects key rotation when no local file contains the current key', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.env');
    const input = profile([pathname]);
    await fs.writeFile(pathname, 'key=another-value', 'utf-8');
    await saveConfigFileProfiles([input]);

    await expect(
      previewConfigFileProfileRouteKeyRotation({
        profileId: input.id,
        expectedRevision: 1,
      })
    ).rejects.toThrow('本地配置中未找到当前 API Key');
  });

  it('does not silently overwrite unknown text while merge is selected', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.conf');
    await fs.writeFile(pathname, 'existing', 'utf-8');
    await saveConfigFileProfiles([profile([pathname])]);
    await expect(
      previewConfigFileProfile({ profileId: 'profile-1', applyMode: 'merge' })
    ).rejects.toThrow('文本文件不支持合并');
    expect(await fs.readFile(pathname, 'utf-8')).toBe('existing');
  });

  it('supports static companion files without replacement tokens', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'auth.json');
    const input = profile([pathname], '{"primaryApiKey":"any"}');
    input.files[0].format = 'json';
    await saveConfigFileProfiles([input]);
    const preview = await previewConfigFileProfile({
      profileId: input.id,
      applyMode: 'overwrite',
    });
    expect(preview.files[0].nextContent).toBe('{"primaryApiKey":"any"}');
  });

  it('rejects revision conflicts and duplicate normalized paths', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    const input = profile([pathname]);
    const saved = await upsertConfigFileProfile({ profile: input });
    await expect(
      upsertConfigFileProfile({ profile: saved, expectedRevision: 999 })
    ).rejects.toThrow('其他操作修改');
    const duplicate = profile([pathname, path.join(directory, '.', 'config.json')]);
    await expect(upsertConfigFileProfile({ profile: duplicate })).rejects.toThrow('重复文件路径');
  });

  it('invalidates direct-edit snapshots when a configured path changes', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const first = path.join(directory, 'first.json');
    const second = path.join(directory, 'second.json');
    await fs.writeFile(first, '{}', 'utf-8');
    const saved = await upsertConfigFileProfile({ profile: profile([first]) });
    const snapshot = (await readConfigFiles([first]))[0];
    const changed = await upsertConfigFileProfile({
      profile: { ...saved, files: [{ ...saved.files[0], path: second }] },
      expectedRevision: saved.revision,
    });
    await expect(
      previewConfigFileDirectEdit({
        profileId: changed.id,
        expectedRevision: changed.revision,
        edits: { 'file-1': '{"changed":true}' },
        snapshots: { 'file-1': snapshot },
      })
    ).rejects.toThrow('路径已变化');
  });

  it('caches unchanged conversation files and isolates malformed paths', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const goodPath = path.join(directory, 'good.jsonl');
    const badPath = path.join(directory, 'bad.jsonl');
    await fs.writeFile(goodPath, '{"id":"session-1"}\n', 'utf-8');
    await fs.writeFile(badPath, '{broken}\n', 'utf-8');
    const input = profile([]);
    input.sessionRecordConnectors = [goodPath, badPath].map((pathname, index) => ({
      id: `connector-${index}`,
      path: pathname,
      format: 'jsonl' as const,
      namespace: 'editor',
      sessionIdPath: 'id',
    }));
    await saveConfigFileProfiles([input]);
    const before = getSessionRecordCacheStats().fileReads;
    const first = await scanSavedSessionRecordsWithDiagnostics();
    const afterFirst = getSessionRecordCacheStats().fileReads;
    const second = await scanSavedSessionRecordsWithDiagnostics();
    expect(first.records).toHaveLength(1);
    expect(first.diagnostics.some(item => item.status === 'error')).toBe(true);
    expect(second.records).toEqual(first.records);
    expect(afterFirst - before).toBe(2);
    expect(getSessionRecordCacheStats().fileReads).toBe(afterFirst);
  });

  it('rejects a commit when a file changes after preview', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, 'before', 'utf-8');
    await saveConfigFileProfiles([profile([pathname])]);
    const preview = await previewConfigFileProfile({
      profileId: 'profile-1',
      applyMode: 'overwrite',
    });

    await fs.writeFile(pathname, 'external change', 'utf-8');

    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      '文件已被外部修改'
    );
    expect(await fs.readFile(pathname, 'utf-8')).toBe('external change');
  });

  it('revalidates target availability before committing an apply transaction', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.conf');
    await fs.writeFile(pathname, 'before', 'utf-8');
    const input = profile([pathname]);
    input.target.model = 'model-a';
    mocks.routing.modelRegistry.displayItems = [{ canonicalName: 'model-a' }];
    await saveConfigFileProfiles([input]);
    const preview = await previewConfigFileProfile({
      profileId: input.id,
      applyMode: 'overwrite',
    });
    mocks.routing.modelRegistry.displayItems = [];

    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      '本地路由模型已不可用'
    );
    expect(await fs.readFile(pathname, 'utf-8')).toBe('before');
  });

  it('commits a confirmed preview and creates a backup', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, 'before', 'utf-8');
    await saveConfigFileProfiles([profile([pathname])]);
    const preview = await previewConfigFileProfile({
      profileId: 'profile-1',
      applyMode: 'overwrite',
    });

    await commitConfigFileProfile({ transactionId: preview.transactionId });

    expect(await fs.readFile(pathname, 'utf-8')).toBe(
      'url=http://127.0.0.1:3210\nkey=sk-route-profile-1\nmodel='
    );
    expect((await fs.readdir(directory)).some(item => item.startsWith('config.json.bak.'))).toBe(
      false
    );
    const [backupId] = await fs.readdir(path.join(directory, 'backups', 'cli-config'));
    const backupModule = await import('../main/config-file-backups');
    const original = (await backupModule.listConfigFileBackups(pathname)).find(
      item => item.id === 'original'
    )!;
    expect(await backupModule.readConfigFileBackup(pathname, 'original', original.sha256)).toBe(
      'before'
    );
    expect(
      await fs.readFile(path.join(directory, 'backups', 'cli-config', backupId, 'original'), 'utf8')
    ).toMatch(/^api-hub-cli-backup:v1/);
  });

  it('does not write any target file when creating a backup fails', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const pathname = path.join(directory, 'config.json');
    await fs.writeFile(pathname, 'before', 'utf-8');
    await saveConfigFileProfiles([profile([pathname])]);
    const preview = await previewConfigFileProfile({
      profileId: 'profile-1',
      applyMode: 'overwrite',
    });
    const writeAtomically = atomicJson.writeTextFileAtomically;
    vi.spyOn(atomicJson, 'writeTextFileAtomically').mockImplementation(
      async (targetPath, content, options) => {
        if (targetPath.endsWith('.bak')) throw new Error('backup failed');
        await writeAtomically(targetPath, content, options);
      }
    );

    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      'backup failed'
    );
    expect(await fs.readFile(pathname, 'utf-8')).toBe('before');
  });

  it('rolls back earlier files when a later target write fails', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const first = path.join(directory, 'first.conf');
    const second = path.join(directory, 'second.conf');
    await fs.writeFile(first, 'first-before', 'utf-8');
    await fs.writeFile(second, 'second-before', 'utf-8');
    await saveConfigFileProfiles([profile([first, second])]);
    const preview = await previewConfigFileProfile({
      profileId: 'profile-1',
      applyMode: 'overwrite',
    });
    const writeAtomically = atomicJson.writeTextFileAtomically;
    let secondTargetFailed = false;
    vi.spyOn(atomicJson, 'writeTextFileAtomically').mockImplementation(
      async (targetPath, content, options) => {
        if (targetPath === second && !secondTargetFailed) {
          secondTargetFailed = true;
          throw new Error('second write failed');
        }
        await writeAtomically(targetPath, content, options);
      }
    );

    await expect(commitConfigFileProfile({ transactionId: preview.transactionId })).rejects.toThrow(
      'second write failed'
    );
    await expect(
      Promise.all([fs.readFile(first, 'utf-8'), fs.readFile(second, 'utf-8')])
    ).resolves.toEqual(['first-before', 'second-before']);
  });

  it('rejects config directories and symbolic links during profile authorization', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    await expect(saveConfigFileProfiles([profile([directory])])).rejects.toThrow('不能是目录');

    const targetDirectory = path.join(directory, 'target');
    const linkDirectory = path.join(directory, 'linked');
    await fs.mkdir(targetDirectory);
    await fs.writeFile(path.join(targetDirectory, 'config.json'), '{}', 'utf-8');
    await fs.symlink(targetDirectory, linkDirectory, 'junction');
    await expect(
      saveConfigFileProfiles([profile([path.join(linkDirectory, 'config.json')])])
    ).rejects.toThrow('符号链接');
  });

  it('marks the current session only when the owning window is explicitly open', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const recordsPath = path.join(directory, 'window-state.json');
    await fs.writeFile(
      recordsPath,
      JSON.stringify({
        window: { is_open: true, current_session_id: 'session-2' },
        sessions: [{ id: 'session-1' }, { id: 'session-2' }],
      }),
      'utf-8'
    );
    const input = profile([]);
    input.sessionRecordConnectors = [
      {
        id: 'connector-current',
        path: recordsPath,
        format: 'json',
        namespace: 'editor',
        recordsPath: 'sessions',
        sessionIdPath: 'id',
        windowOpenPath: 'window.is_open',
        currentSessionIdPath: 'window.current_session_id',
      },
    ];
    await saveConfigFileProfiles([input]);

    expect(await scanSavedSessionRecords()).toEqual([
      expect.objectContaining({ sessionId: 'session-1', isOpen: false }),
      expect.objectContaining({ sessionId: 'session-2', isOpen: true }),
    ]);
  });

  it('does not treat a persisted current session ID as proof that the window is open', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const recordsPath = path.join(directory, 'closed-window-state.json');
    await fs.writeFile(
      recordsPath,
      JSON.stringify({
        window: { is_open: false, current_session_id: 'session-2' },
        sessions: [{ id: 'session-1' }, { id: 'session-2' }],
      }),
      'utf-8'
    );
    const input = profile([]);
    input.sessionRecordConnectors = [
      {
        id: 'connector-closed-window',
        path: recordsPath,
        format: 'json',
        namespace: 'editor',
        recordsPath: 'sessions',
        sessionIdPath: 'id',
        windowOpenPath: 'window.is_open',
        currentSessionIdPath: 'window.current_session_id',
      },
    ];
    await saveConfigFileProfiles([input]);

    expect(await scanSavedSessionRecords()).toEqual([
      expect.objectContaining({ sessionId: 'session-1', isOpen: false }),
      expect.objectContaining({ sessionId: 'session-2', isOpen: false }),
    ]);

    await fs.writeFile(
      recordsPath,
      JSON.stringify({
        window: { current_session_id: 'session-2' },
        sessions: [{ id: 'session-1' }, { id: 'session-2' }],
      }),
      'utf-8'
    );

    const unknownRecords = await scanSavedSessionRecords();
    expect(unknownRecords.map(record => record.sessionId)).toEqual(['session-1', 'session-2']);
    expect(unknownRecords.every(record => record.isOpen === undefined)).toBe(true);
  });

  it('scans authorized JSONL session records without returning unrelated content', async () => {
    const directory = await createTempDirectory();
    mocks.userData = directory;
    const recordsPath = path.join(directory, 'sessions.jsonl');
    await fs.writeFile(
      recordsPath,
      [
        JSON.stringify({
          id: 'session-1',
          title: 'First',
          cwd: 'D:/repo',
          at: 1_700_000_000,
          window: { state: 'current' },
        }),
        JSON.stringify({
          id: 'session-2',
          title: 'Second',
          prompt: 'must-not-leak',
          window: { state: 'closed' },
        }),
      ].join('\n'),
      'utf-8'
    );
    const input = profile([]);
    input.sessionRecordConnectors = [
      {
        id: 'connector-1',
        path: recordsPath,
        format: 'jsonl',
        namespace: 'editor',
        sessionIdPath: 'id',
        displayNamePath: 'title',
        workspacePath: 'cwd',
        updatedAtPath: 'at',
        activePath: 'window.state',
      },
    ];
    await saveConfigFileProfiles([input]);

    const records = await scanSavedSessionRecords();
    expect(records).toEqual([
      {
        connectorId: 'connector-1',
        namespace: 'editor',
        sessionId: 'session-1',
        displayName: 'First',
        workspace: 'D:/repo',
        updatedAt: 1_700_000_000_000,
        isOpen: true,
      },
      {
        connectorId: 'connector-1',
        namespace: 'editor',
        sessionId: 'session-2',
        displayName: 'Second',
        workspace: undefined,
        updatedAt: undefined,
        isOpen: false,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('must-not-leak');
  });
});
