import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userData: '', removeBySites: vi.fn() }));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
}));

vi.mock('../main/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../main/route-state-affinity-service', () => ({
  routeStateAffinityService: { removeBySites: mocks.removeBySites },
}));

import {
  loadCustomCliConfigStorage,
  saveCustomCliConfigStorage,
} from '../main/custom-cli-config-service';
import { CLI_UPSTREAM_PROTOCOLS } from '../shared/types/cli-config';

function createLegacyConfig(targetProtocols: Record<string, string>) {
  return {
    id: 'direct-1',
    name: 'Direct',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    models: [],
    cliSettings: Object.fromEntries(
      Object.entries(targetProtocols).map(([cliType, targetProtocol]) => [
        cliType,
        { enabled: true, model: null, targetProtocol },
      ])
    ),
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'api-detect-direct-migration-'));
  mocks.removeBySites.mockReset().mockResolvedValue(0);
});

afterEach(async () => {
  await fs.rm(mocks.userData, { recursive: true, force: true });
});

describe('custom CLI route target protocol migration', () => {
  it('refuses to overwrite a malformed configuration file', async () => {
    const file = path.join(mocks.userData, 'custom-cli-configs.json');
    await fs.writeFile(file, '{broken', 'utf8');
    await expect(loadCustomCliConfigStorage()).rejects.toThrow();
    await expect(
      saveCustomCliConfigStorage({ configs: [], activeConfigId: null })
    ).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('{broken');
  });
  it('migrates one unique legacy protocol before filling missing CLI settings', async () => {
    const config = createLegacyConfig({
      claudeCode: 'openai-responses',
      codex: 'openai-responses',
      openCode: 'openai-responses',
    });
    await fs.writeFile(
      path.join(mocks.userData, 'custom-cli-configs.json'),
      JSON.stringify({ configs: [config], activeConfigId: config.id }),
      'utf-8'
    );

    const loaded = await loadCustomCliConfigStorage();

    expect(loaded.configs[0]).toMatchObject({
      routeTargetProtocol: 'openai-responses',
      routeTargetProtocolNeedsConfirmation: false,
      supportedProtocols: CLI_UPSTREAM_PROTOCOLS,
    });
  });

  it('defaults old direct configs without route fields to all upstream protocols and native routing', async () => {
    const config = createLegacyConfig({});
    await fs.writeFile(
      path.join(mocks.userData, 'custom-cli-configs.json'),
      JSON.stringify({ configs: [config], activeConfigId: config.id }),
      'utf-8'
    );

    const loaded = await loadCustomCliConfigStorage();

    expect(loaded.configs[0]).toMatchObject({
      routeTargetProtocol: 'native',
      routeTargetProtocolNeedsConfirmation: false,
      supportedProtocols: CLI_UPSTREAM_PROTOCOLS,
    });
    expect(loaded.configs[0].routeAuthScheme).toBeUndefined();

    const persisted = JSON.parse(
      await fs.readFile(path.join(mocks.userData, 'custom-cli-configs.json'), 'utf-8')
    );
    expect(persisted.configs[0]).toMatchObject({
      routeTargetProtocol: 'native',
      routeTargetProtocolNeedsConfirmation: false,
      supportedProtocols: CLI_UPSTREAM_PROTOCOLS,
    });
  });

  it('falls back to native and requires confirmation for conflicting legacy protocols', async () => {
    const config = createLegacyConfig({
      claudeCode: 'anthropic-messages',
      codex: 'openai-responses',
    });
    await fs.writeFile(
      path.join(mocks.userData, 'custom-cli-configs.json'),
      JSON.stringify({ configs: [config], activeConfigId: config.id }),
      'utf-8'
    );

    const loaded = await loadCustomCliConfigStorage();

    expect(loaded.configs[0]).toMatchObject({
      routeTargetProtocol: 'native',
      routeTargetProtocolNeedsConfirmation: true,
    });
  });

  it('cleans affinity for removed direct configs in one sidecar transaction', async () => {
    const first = createLegacyConfig({ codex: 'openai-responses' });
    const second = { ...createLegacyConfig({ codex: 'openai-responses' }), id: 'direct-2' };
    const retained = { ...createLegacyConfig({ codex: 'openai-responses' }), id: 'direct-3' };
    await saveCustomCliConfigStorage({ configs: [first, second, retained], activeConfigId: null });
    mocks.removeBySites.mockClear();

    await saveCustomCliConfigStorage({ configs: [retained], activeConfigId: retained.id });

    expect(mocks.removeBySites).toHaveBeenCalledTimes(1);
    expect(mocks.removeBySites).toHaveBeenCalledWith([
      'custom-cli-site-direct-1',
      'custom-cli-site-direct-2',
    ]);
  });

  it('normalizes route defaults when configs are saved directly through the main service', async () => {
    const config = createLegacyConfig({});

    await saveCustomCliConfigStorage({ configs: [config], activeConfigId: config.id });

    const loaded = await loadCustomCliConfigStorage();
    expect(loaded.configs[0]).toMatchObject({
      routeTargetProtocol: 'native',
      routeTargetProtocolNeedsConfirmation: false,
      supportedProtocols: CLI_UPSTREAM_PROTOCOLS,
    });
    expect(loaded.configs[0].routeAuthScheme).toBeUndefined();
  });
});
