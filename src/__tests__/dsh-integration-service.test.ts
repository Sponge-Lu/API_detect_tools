import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

vi.mock('../main/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      verbose: vi.fn(),
    }),
  },
}));

import {
  applyCredentialDocument,
  applyPatchDocument,
  detectDshRouting,
  enableDshSessionRouting,
  migrateDshSessionProviders,
  resolveDshPaths,
  rollbackDshSessionRouting,
  type DshRouteSource,
} from '../main/dsh-integration-service';
import {
  DSH_NATIVE_PROVIDER_ID,
  DSH_PATCH_ENTRY_ID,
  DSH_ROUTE_CREDENTIAL_REF,
} from '../shared/types/dsh-integration';

const MODELS = ['model-alpha', 'model-beta', 'model-gamma', 'model-delta', 'model-epsilon'];

const routeSource: DshRouteSource = {
  baseUrl: 'http://127.0.0.1:4599',
  apiKey: 'sk-route-test-key',
  models: MODELS,
};

const neverRunning = async () => false;

let dshHome: string;

async function writeFixture(relativePath: string, content: string): Promise<string> {
  const target = path.join(dshHome, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return target;
}

beforeEach(async () => {
  dshHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-integration-'));
  await writeFixture(
    path.join('profiles', 'desktop', 'package.json'),
    '{"name":"dsh-profile-desktop"}'
  );
});

afterEach(async () => {
  await fs.rm(dshHome, { recursive: true, force: true });
});

describe('applyPatchDocument', () => {
  it('缺失时新增条目，且顶层仍是数组', () => {
    const output = applyPatchDocument('[]\n', {
      baseUrl: routeSource.baseUrl,
      models: MODELS,
      defaultModel: MODELS[0],
      allowedModels: MODELS.slice(0, 2),
    });
    const parsed = parse(output) as Array<Record<string, unknown>>;
    const entry = parsed.find(item => item.id === DSH_PATCH_ENTRY_ID);
    expect(entry).toBeTruthy();
    expect(entry?.name).toBe('@deepseek-ai/dsh-llm-deepseek-api-key');
    const config = entry?.config as Record<string, unknown>;
    expect(config.baseURL).toBe(routeSource.baseUrl);
    expect(config.apiKeyEnv).toBe(DSH_ROUTE_CREDENTIAL_REF);
    expect((config.models as Array<{ id: string }>).map(model => model.id)).toEqual(MODELS);
  });

  it('已存在时按 id 合并，不产生重复条目，并保留用户自定义字段', () => {
    const source = [
      '# 用户自己的注释',
      '- id: llm-deepseek',
      '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
      '  config:',
      '    baseURL: http://old-host:1',
      '    thinking: enabled',
      '    models:',
      '      - id: stale-model',
      '        name: stale-model',
      '',
    ].join('\n');

    const output = applyPatchDocument(source, {
      baseUrl: routeSource.baseUrl,
      models: MODELS,
      defaultModel: MODELS[0],
      allowedModels: [],
    });

    const parsed = parse(output) as Array<Record<string, unknown>>;
    const entries = parsed.filter(item => item.id === DSH_PATCH_ENTRY_ID);
    expect(entries).toHaveLength(1);
    const config = entries[0].config as Record<string, unknown>;
    expect(config.baseURL).toBe(routeSource.baseUrl);
    // 用户自己加的 thinking 必须保留
    expect(config.thinking).toBe('enabled');
    expect((config.models as Array<{ id: string }>).map(model => model.id)).toEqual(MODELS);
    // 注释与 !!js 表达式不能被吃掉
    expect(output).toContain('# 用户自己的注释');
  });

  it('保留 !!js 表达式与注释', () => {
    const source = [
      '# 顶部注释',
      '- id: other-plugin',
      '  name: "@deepseek-ai/other"',
      '  config:',
      '    publicUrl: !!js ctx.webStartup.publicUrl',
      "    disabled: !!js \"ctx.get('profileContext')?.name !== 'desktop'\"",
      '',
    ].join('\n');

    const output = applyPatchDocument(source, {
      baseUrl: routeSource.baseUrl,
      models: MODELS,
      defaultModel: MODELS[0],
      allowedModels: [],
    });

    expect(output).toContain('# 顶部注释');
    expect(output.match(/!!js/g)).toHaveLength(2);
  });

  it('默认模型指向 legacy provider 时才改，deepseek-account 不动', () => {
    const legacySource = [
      '- id: agent-default-model',
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      '  config:',
      '    provider: local',
      '    model: stale-model',
      '',
    ].join('\n');
    const legacyOut = parse(
      applyPatchDocument(legacySource, {
        baseUrl: routeSource.baseUrl,
        models: MODELS,
        defaultModel: MODELS[1],
        allowedModels: [],
      })
    ) as Array<{ id: string; config: Record<string, unknown> }>;
    expect(legacyOut[0].config.provider).toBe(DSH_NATIVE_PROVIDER_ID);
    expect(legacyOut[0].config.model).toBe(MODELS[1]);

    const accountSource = legacySource.replace('provider: local', 'provider: deepseek-account');
    const accountOut = parse(
      applyPatchDocument(accountSource, {
        baseUrl: routeSource.baseUrl,
        models: MODELS,
        defaultModel: MODELS[1],
        allowedModels: [],
      })
    ) as Array<{ id: string; config: Record<string, unknown> }>;
    expect(accountOut[0].config.provider).toBe('deepseek-account');
  });

  it('子 agent 白名单整表指向 legacy 时才替换', () => {
    const source = [
      '- id: subagent-model-selection-settings',
      '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
      '  config:',
      '    enabled: true',
      '    allowedModels:',
      '      - provider: local',
      '        model: model-alpha',
      '',
    ].join('\n');

    const output = applyPatchDocument(source, {
      baseUrl: routeSource.baseUrl,
      models: MODELS,
      defaultModel: MODELS[0],
      allowedModels: ['model-beta', 'model-gamma'],
    });
    const parsed = parse(output) as Array<{ config: Record<string, unknown> }>;
    const allowed = parsed[0].config.allowedModels as Array<{ provider: string; model: string }>;
    expect(allowed).toEqual([
      { provider: DSH_NATIVE_PROVIDER_ID, model: 'model-beta' },
      { provider: DSH_NATIVE_PROVIDER_ID, model: 'model-gamma' },
    ]);
  });

  it('顶层不是数组时明确报错', () => {
    expect(() =>
      applyPatchDocument('foo: bar\n', {
        baseUrl: routeSource.baseUrl,
        models: MODELS,
        defaultModel: MODELS[0],
        allowedModels: [],
      })
    ).toThrow(/顶层必须是 YAML 数组/);
  });
});

describe('applyCredentialDocument', () => {
  it('文件不存在时生成 version: 1 布局', () => {
    const output = applyCredentialDocument(null, 'sk-route-abc');
    const parsed = parse(output) as { version: number; refs: Record<string, string> };
    expect(parsed.version).toBe(1);
    expect(parsed.refs[DSH_ROUTE_CREDENTIAL_REF]).toBe('sk-route-abc');
  });

  it('已有文件时只补 refs，不动 records', () => {
    const source = [
      'version: 1',
      'records:',
      '  deepseek-account-platform/default:',
      '    kind: token',
      '    payload:',
      '      token: abc',
      'refs: { LOCAL_API_KEY: sk-route-old }',
      '',
    ].join('\n');

    const output = applyCredentialDocument(source, 'sk-route-new');
    const parsed = parse(output) as {
      version: number;
      records: Record<string, unknown>;
      refs: Record<string, string>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.refs.LOCAL_API_KEY).toBe('sk-route-old');
    expect(parsed.refs[DSH_ROUTE_CREDENTIAL_REF]).toBe('sk-route-new');
    expect(parsed.records['deepseek-account-platform/default']).toBeTruthy();
  });

  it('非 version: 1 布局拒绝改写', () => {
    expect(() => applyCredentialDocument('LOCAL_API_KEY: sk-old\n', 'sk-new')).toThrow(
      /version: 1/
    );
  });
});

describe('detectDshRouting / enableDshSessionRouting', () => {
  it('应用里没有模型供应商时报告 no-model-source，而不是抛异常', async () => {
    const status = await detectDshRouting({
      dshHome,
      routeSource,
      modelSources: [],
      isRunning: neverRunning,
    });
    expect(status.installed).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.drift).toContain('no-model-source');
    expect(status.modelSources).toEqual([]);
    expect(status.summary).toContain('模型供应商');
  });

  it('已配置的模型集合能对上某个来源时，回报 matchedModelSourceId', async () => {
    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    const status = await detectDshRouting({ dshHome, routeSource, isRunning: neverRunning });
    expect(status.matchedModelSourceId).toBe('local-route');
  });

  it('未接入时报告 patch-entry-missing', async () => {
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), '[]\n');
    const status = await detectDshRouting({ dshHome, routeSource, isRunning: neverRunning });
    expect(status.installed).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.drift).toContain('patch-entry-missing');
    expect(status.expectedBaseUrl).toBe(routeSource.baseUrl);
  });

  it('接入后状态变为 configured，且模型来自传入的路由源', async () => {
    const result = await enableDshSessionRouting(
      {},
      { dshHome, routeSource, isRunning: neverRunning }
    );
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(MODELS);

    const status = await detectDshRouting({ dshHome, routeSource, isRunning: neverRunning });
    expect(status.configured).toBe(true);
    expect(status.drift).toEqual(['ok']);
    expect(status.configuredModelCount).toBe(MODELS.length);
    expect(status.missingModels).toEqual([]);
    expect(status.currentBaseUrl).toBe(routeSource.baseUrl);
  });

  it('幂等：重复接入不产生重复条目', async () => {
    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });

    const paths = resolveDshPaths(dshHome);
    const parsed = parse(await fs.readFile(paths.patchFilePath, 'utf8')) as Array<{ id: string }>;
    expect(parsed.filter(item => item.id === DSH_PATCH_ENTRY_ID)).toHaveLength(1);
  });

  it('端口变化后重新接入，baseURL 跟着变', async () => {
    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    const moved: DshRouteSource = { ...routeSource, baseUrl: 'http://127.0.0.1:5000' };
    await enableDshSessionRouting({}, { dshHome, routeSource: moved, isRunning: neverRunning });

    const status = await detectDshRouting({ dshHome, routeSource: moved, isRunning: neverRunning });
    expect(status.configured).toBe(true);
    expect(status.currentBaseUrl).toBe('http://127.0.0.1:5000');
  });

  it('模型目录收缩后报告 staleModels', async () => {
    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    const shrunk: DshRouteSource = { ...routeSource, models: ['model-alpha'] };
    const status = await detectDshRouting({
      dshHome,
      routeSource: shrunk,
      isRunning: neverRunning,
    });
    expect(status.staleModels).toEqual([
      'model-beta',
      'model-gamma',
      'model-delta',
      'model-epsilon',
    ]);
    expect(status.drift).toContain('models-out-of-sync');
  });

  it('默认模型不在目录里时回退到首个可用模型', async () => {
    const result = await enableDshSessionRouting(
      { defaultModel: 'not-in-catalog' },
      { dshHome, routeSource, isRunning: neverRunning }
    );
    expect(result.defaultModel).toBe(MODELS[0]);
  });

  it('DSH 在运行且要求迁移会话时，在写文件前就拒绝', async () => {
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), '[]\n');
    await expect(
      enableDshSessionRouting(
        { migrateSessions: true },
        { dshHome, routeSource, isRunning: async () => true }
      )
    ).rejects.toThrow(/正在运行/);

    const status = await detectDshRouting({ dshHome, routeSource, isRunning: neverRunning });
    expect(status.drift).toContain('patch-entry-missing');
  });
});

describe('migrateDshSessionProviders', () => {
  async function writeSession(name: string, rows: Record<string, unknown>): Promise<string> {
    return writeFixture(
      path.join('storages', 'session_projcache', 'sessions', name),
      JSON.stringify({ version: 1, record: { identity: { id: name }, rows } })
    );
  }

  it('同时迁移 lastUsed 与 subagentModelSelectionPolicy，模型名不变', async () => {
    await writeSession('session-a.json', {
      modelSelection: {
        ver: 2,
        seq: 1,
        val: { lastUsed: { provider: 'local', model: 'model-beta' } },
      },
      subagentModelSelectionPolicy: {
        ver: 1,
        seq: 1,
        val: [
          { provider: 'local', model: 'model-alpha' },
          { provider: 'local', model: 'model-gamma' },
        ],
      },
    });
    await writeSession('session-b.json', {
      modelSelection: {
        ver: 2,
        seq: 1,
        val: { lastUsed: { provider: 'deepseek-account', model: 'x' } },
      },
    });

    const result = await migrateDshSessionProviders({ dshHome, isRunning: neverRunning });
    expect(result.scannedFiles).toBe(2);
    expect(result.changedFiles).toBe(1);
    expect(result.changedRefs).toBe(3);
    expect(result.backupDir).toBeTruthy();

    const migrated = JSON.parse(
      await fs.readFile(
        path.join(dshHome, 'storages', 'session_projcache', 'sessions', 'session-a.json'),
        'utf8'
      )
    );
    expect(migrated.record.rows.modelSelection.val.lastUsed).toEqual({
      provider: DSH_NATIVE_PROVIDER_ID,
      model: 'model-beta',
    });
    expect(
      migrated.record.rows.subagentModelSelectionPolicy.val.map(
        (item: { provider: string; model: string }) => item
      )
    ).toEqual([
      { provider: DSH_NATIVE_PROVIDER_ID, model: 'model-alpha' },
      { provider: DSH_NATIVE_PROVIDER_ID, model: 'model-gamma' },
    ]);

    // 非 legacy 的会话一个字节都不该变
    const untouched = JSON.parse(
      await fs.readFile(
        path.join(dshHome, 'storages', 'session_projcache', 'sessions', 'session-b.json'),
        'utf8'
      )
    );
    expect(untouched.record.rows.modelSelection.val.lastUsed.provider).toBe('deepseek-account');
  });

  it('DSH 在运行且未强制时拒绝迁移', async () => {
    await writeSession('session-a.json', {
      modelSelection: { val: { lastUsed: { provider: 'local', model: 'm' } } },
    });
    await expect(
      migrateDshSessionProviders({ dshHome, isRunning: async () => true })
    ).rejects.toThrow(/正在运行/);
  });

  it('没有 legacy 引用时不动任何文件', async () => {
    await writeSession('session-a.json', {
      modelSelection: { val: { lastUsed: { provider: DSH_NATIVE_PROVIDER_ID, model: 'm' } } },
    });
    const result = await migrateDshSessionProviders({ dshHome, isRunning: neverRunning });
    expect(result.changedFiles).toBe(0);
    expect(result.backupDir).toBeNull();
  });
});

describe('rollbackDshSessionRouting', () => {
  it('按 id 撤销我们写进去的条目，并清掉凭据 ref', async () => {
    const paths = resolveDshPaths(dshHome);
    const originalPatch = '# 原始注释\n- id: keep-me\n  name: "@deepseek-ai/keep"\n';
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), originalPatch);
    const originalCredentials = 'version: 1\nrefs: { LOCAL_API_KEY: sk-route-old }\n';
    await writeFixture('.credentials.yaml', originalCredentials);

    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    expect(await fs.readFile(paths.patchFilePath, 'utf8')).not.toBe(originalPatch);

    const rollback = await rollbackDshSessionRouting({
      dshHome,
      routeSource,
      isRunning: neverRunning,
    });
    expect(rollback.skippedFiles).toEqual([]);
    expect(rollback.restoredFiles).toHaveLength(2);

    const after = parse(await fs.readFile(paths.patchFilePath, 'utf8')) as Array<{ id: string }>;
    expect(after.map(item => item.id)).toEqual(['keep-me']);
    expect(await fs.readFile(paths.patchFilePath, 'utf8')).toContain('# 原始注释');

    const credentials = parse(await fs.readFile(paths.credentialsFilePath, 'utf8')) as {
      refs: Record<string, string>;
    };
    expect(credentials.refs.LOCAL_API_KEY).toBe('sk-route-old');
    expect(credentials.refs[DSH_ROUTE_CREDENTIAL_REF]).toBeUndefined();
  });

  it('用户后续手改的内容保留，只撤销受管条目', async () => {
    const paths = resolveDshPaths(dshHome);
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), '[]\n');
    await writeFixture('.credentials.yaml', 'version: 1\nrefs: {}\n');

    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });

    const handEdited = `${await fs.readFile(paths.patchFilePath, 'utf8')}
- id: user-added
  name: "@deepseek-ai/user"
`;
    await fs.writeFile(paths.patchFilePath, handEdited, 'utf8');

    const rollback = await rollbackDshSessionRouting({
      dshHome,
      routeSource,
      isRunning: neverRunning,
    });
    expect(rollback.skippedFiles).toEqual([]);

    const after = parse(await fs.readFile(paths.patchFilePath, 'utf8')) as Array<{ id: string }>;
    expect(after.map(item => item.id)).toEqual(['user-added']);
  });

  it('清单被删掉后仍能靠同目录最新备份回滚', async () => {
    const paths = resolveDshPaths(dshHome);
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), '[]\n');
    await writeFixture('.credentials.yaml', 'version: 1\nrefs: {}\n');

    await enableDshSessionRouting({}, { dshHome, routeSource, isRunning: neverRunning });
    await fs.unlink(paths.manifestPath);

    const rollback = await rollbackDshSessionRouting({
      dshHome,
      routeSource,
      isRunning: neverRunning,
    });
    expect(rollback.skippedFiles).toEqual([]);
    const after = parse(await fs.readFile(paths.patchFilePath, 'utf8')) as Array<{ id: string }>;
    expect(after.map(item => item.id)).not.toContain(DSH_PATCH_ENTRY_ID);
  });

  it('本来就没接入时回滚不改任何文件', async () => {
    const paths = resolveDshPaths(dshHome);
    const untouched = '[]\n';
    await writeFixture(path.join('profiles', 'desktop', 'cordis.patch.yml'), untouched);

    const rollback = await rollbackDshSessionRouting({
      dshHome,
      routeSource,
      isRunning: neverRunning,
    });
    expect(rollback.restoredFiles).toEqual([]);
    expect(await fs.readFile(paths.patchFilePath, 'utf8')).toBe(untouched);
  });
});
