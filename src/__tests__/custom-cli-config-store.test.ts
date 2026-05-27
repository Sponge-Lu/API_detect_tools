import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

function createConfig(): CustomCliConfig {
  return {
    id: 'cfg-1',
    name: 'Custom Endpoint',
    baseUrl: 'https://custom.example.com',
    apiKey: 'sk-custom',
    models: ['old-model', 'fresh-model'],
    manualModels: [],
    notes: '',
    cliSettings: {
      claudeCode: {
        enabled: true,
        model: 'fresh-model',
        testModels: ['fresh-model', 'stale-test'],
        editedFiles: [{ path: '~/.claude/settings.json', content: '{}' }],
        testState: {
          status: false,
          testedAt: 20,
          claudeDetail: { replyText: 'stale detail' },
          slots: [
            { model: 'fresh-model', success: true, timestamp: 10 },
            { model: 'stale-test', success: false, timestamp: 20 },
            null,
          ],
        },
      },
      codex: {
        enabled: true,
        model: 'stale-model',
        testModels: ['new-test', 'stale-test'],
        editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "stale-model"' }],
        testState: {
          status: false,
          testedAt: 30,
          slots: [{ model: 'stale-model', success: false, timestamp: 30 }, null, null],
        },
      },
      geminiCli: {
        enabled: true,
        model: null,
        testModels: [],
        editedFiles: null,
        testState: null,
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('custom cli config store', () => {
  beforeEach(() => {
    useCustomCliConfigStore.setState({
      configs: [createConfig()],
      activeConfigId: null,
      loading: false,
      saving: false,
      fetchingModels: {},
    });

    window.electronAPI = {
      ...window.electronAPI,
      customCliConfig: {
        load: vi.fn(),
        save: vi.fn().mockResolvedValue({ success: true }),
        fetchModels: vi.fn().mockResolvedValue(['fresh-model', ' new-test ', 'fresh-model']),
      },
    };
  });

  it('clears stale selected and tested models after fetching a new custom CLI model list', async () => {
    await useCustomCliConfigStore.getState().fetchModels('cfg-1');

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.models).toEqual(['fresh-model', 'new-test']);
    expect(config.cliSettings.claudeCode.model).toBe('fresh-model');
    expect(config.cliSettings.claudeCode.testModels).toEqual(['fresh-model']);
    expect(config.cliSettings.claudeCode.testState).toMatchObject({
      status: true,
      testedAt: 10,
      claudeDetail: undefined,
      slots: [{ model: 'fresh-model', success: true, timestamp: 10 }, null, null],
    });
    expect(config.cliSettings.claudeCode.editedFiles).toEqual([
      { path: '~/.claude/settings.json', content: '{}' },
    ]);
    expect(config.cliSettings.codex.model).toBeNull();
    expect(config.cliSettings.codex.testModels).toEqual(['new-test']);
    expect(config.cliSettings.codex.testState).toBeNull();
    expect(config.cliSettings.codex.editedFiles).toBeNull();
    expect(window.electronAPI.customCliConfig.save).toHaveBeenCalledWith(
      expect.objectContaining({
        configs: [
          expect.objectContaining({
            id: 'cfg-1',
            models: ['fresh-model', 'new-test'],
            manualModels: [],
          }),
        ],
      })
    );
  });

  it('preserves manually entered models after fetching a new custom CLI model list', async () => {
    useCustomCliConfigStore.setState({
      configs: [
        {
          ...createConfig(),
          manualModels: ['manual-model'],
          cliSettings: {
            ...createConfig().cliSettings,
            codex: {
              enabled: true,
              model: 'manual-model',
              testModels: ['manual-model', 'new-test'],
              editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-model"' }],
              testState: {
                status: true,
                testedAt: 40,
                slots: [
                  { model: 'manual-model', success: true, timestamp: 40 },
                  { model: 'new-test', success: true, timestamp: 35 },
                  null,
                ],
              },
            },
          },
        },
      ],
    });

    await useCustomCliConfigStore.getState().fetchModels('cfg-1');

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.models).toEqual(['fresh-model', 'new-test']);
    expect(config.manualModels).toEqual(['manual-model']);
    expect(config.cliSettings.codex.model).toBe('manual-model');
    expect(config.cliSettings.codex.testModels).toEqual(['manual-model', 'new-test']);
    expect(config.cliSettings.codex.editedFiles).toEqual([
      { path: '~/.codex/config.toml', content: 'model = "manual-model"' },
    ]);
    expect(config.cliSettings.codex.testState).toMatchObject({
      status: true,
      testedAt: 40,
      slots: [
        { model: 'manual-model', success: true, timestamp: 40 },
        { model: 'new-test', success: true, timestamp: 35 },
        null,
      ],
    });
  });

  it('normalizes persisted stale model selections when loading configs', async () => {
    window.electronAPI.customCliConfig.load = vi.fn().mockResolvedValue({
      configs: [createConfig()],
      activeConfigId: 'cfg-1',
    });

    await useCustomCliConfigStore.getState().loadConfigs();

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.manualModels).toEqual([]);
    expect(config.cliSettings.codex.model).toBeNull();
    expect(config.cliSettings.codex.testModels).toEqual([]);
    expect(config.cliSettings.codex.testState).toBeNull();
    expect(config.cliSettings.claudeCode.testModels).toEqual(['fresh-model']);
  });

  it('normalizes persisted manual model selections when loading configs', async () => {
    window.electronAPI.customCliConfig.load = vi.fn().mockResolvedValue({
      configs: [
        {
          ...createConfig(),
          manualModels: ['manual-model'],
          cliSettings: {
            ...createConfig().cliSettings,
            codex: {
              enabled: true,
              model: 'manual-model',
              testModels: ['manual-model'],
              editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-model"' }],
              testState: {
                status: true,
                testedAt: 50,
                slots: [{ model: 'manual-model', success: true, timestamp: 50 }, null, null],
              },
            },
          },
        },
      ],
      activeConfigId: 'cfg-1',
    });

    await useCustomCliConfigStore.getState().loadConfigs();

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.models).toEqual(['old-model', 'fresh-model']);
    expect(config.manualModels).toEqual(['manual-model']);
    expect(config.cliSettings.codex.model).toBe('manual-model');
    expect(config.cliSettings.codex.testModels).toEqual(['manual-model']);
    expect(config.cliSettings.codex.testState).toMatchObject({
      status: true,
      testedAt: 50,
      slots: [{ model: 'manual-model', success: true, timestamp: 50 }, null, null],
    });
  });

  it('prevents stale local editor saves from reintroducing models outside the fetched list', () => {
    useCustomCliConfigStore.getState().updateConfig('cfg-1', {
      cliSettings: {
        ...createConfig().cliSettings,
        codex: {
          enabled: true,
          model: 'stale-model',
          testModels: ['stale-test'],
          editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "stale-model"' }],
          testState: {
            status: true,
            testedAt: 30,
            slots: [{ model: 'stale-test', success: true, timestamp: 30 }, null, null],
          },
        },
      },
    });

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.cliSettings.codex.model).toBeNull();
    expect(config.cliSettings.codex.testModels).toEqual([]);
    expect(config.cliSettings.codex.editedFiles).toBeNull();
    expect(config.cliSettings.codex.testState).toBeNull();
  });

  it('allows local editor saves to keep models explicitly marked as manual', () => {
    useCustomCliConfigStore.getState().updateConfig('cfg-1', {
      manualModels: ['manual-stale-model'],
      cliSettings: {
        ...createConfig().cliSettings,
        codex: {
          enabled: true,
          model: 'manual-stale-model',
          testModels: ['manual-stale-model'],
          editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-stale-model"' }],
          testState: {
            status: true,
            testedAt: 60,
            slots: [{ model: 'manual-stale-model', success: true, timestamp: 60 }, null, null],
          },
        },
      },
    });

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.manualModels).toEqual(['manual-stale-model']);
    expect(config.cliSettings.codex.model).toBe('manual-stale-model');
    expect(config.cliSettings.codex.testModels).toEqual(['manual-stale-model']);
    expect(config.cliSettings.codex.editedFiles).toEqual([
      { path: '~/.codex/config.toml', content: 'model = "manual-stale-model"' },
    ]);
    expect(config.cliSettings.codex.testState).toMatchObject({
      status: true,
      testedAt: 60,
      slots: [{ model: 'manual-stale-model', success: true, timestamp: 60 }, null, null],
    });
  });
});
