import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  httpGet: vi.fn(),
  removeBySites: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
}));

vi.mock('../main/utils/http-client', () => ({
  httpGet: mocks.httpGet,
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    scope: () => ({ info: vi.fn(), error: vi.fn() }),
  },
}));

vi.mock('../main/route-state-affinity-service', () => ({
  routeStateAffinityService: { removeBySites: mocks.removeBySites },
}));

import { fetchModels } from '../main/custom-cli-model-service';

const baseConfig = {
  id: 'direct-1',
  name: 'Direct',
  baseUrl: 'https://api.example.com/suffix',
  apiKey: 'sk-test',
  models: [],
  cliSettings: {},
  createdAt: 1,
  updatedAt: 1,
};

async function writeConfig(config: Record<string, unknown>) {
  await fs.writeFile(
    path.join(mocks.userData, 'custom-cli-configs.json'),
    JSON.stringify({ configs: [config], activeConfigId: config.id }),
    'utf-8'
  );
}

beforeEach(async () => {
  mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'api-detect-custom-models-'));
  mocks.httpGet.mockReset().mockResolvedValue({
    status: 200,
    data: { data: [{ id: 'model-a' }] },
  });
  mocks.removeBySites.mockReset().mockResolvedValue(0);
});

afterEach(async () => {
  await fs.rm(mocks.userData, { recursive: true, force: true });
});

describe('custom CLI model URL selection', () => {
  it('uses Base URL when model URL is empty', async () => {
    await writeConfig(baseConfig);

    await expect(fetchModels(baseConfig.id)).resolves.toMatchObject({
      success: true,
      models: ['model-a'],
    });
    expect(mocks.httpGet).toHaveBeenCalledWith(
      'https://api.example.com/suffix/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      })
    );
  });

  it('uses the explicit model URL without changing the routing Base URL', async () => {
    const config = {
      ...baseConfig,
      modelUrl: 'https://models.example.com/openai/v1/models',
    };
    await writeConfig(config);

    await expect(fetchModels(config.id)).resolves.toMatchObject({ success: true });
    expect(mocks.httpGet).toHaveBeenCalledWith(
      'https://models.example.com/openai/v1/models',
      expect.any(Object)
    );
  });

  it('adds the models path when the override points at a versioned API root', async () => {
    const config = { ...baseConfig, modelUrl: 'https://models.example.com/openai/v1/' };
    await writeConfig(config);

    await fetchModels(config.id);

    expect(mocks.httpGet).toHaveBeenCalledWith(
      'https://models.example.com/openai/v1/models',
      expect.any(Object)
    );
  });

  it('requests models once for every configured API key', async () => {
    const config = {
      ...baseConfig,
      apiKeys: [
        { id: 'key-a', name: 'A', key: 'sk-a', group: '', groupMultiplier: 1, models: [] },
        { id: 'key-b', name: 'B', key: 'sk-b', group: '', groupMultiplier: 1, models: [] },
      ],
    };
    await writeConfig(config);

    const result = await fetchModels(config.id);

    expect(mocks.httpGet).toHaveBeenCalledTimes(2);
    expect(mocks.httpGet.mock.calls.map(call => call[1].headers.Authorization)).toEqual([
      'Bearer sk-a',
      'Bearer sk-b',
    ]);
    expect(result.perKey?.map(item => item.keyId)).toEqual(['key-a', 'key-b']);
  });
});
