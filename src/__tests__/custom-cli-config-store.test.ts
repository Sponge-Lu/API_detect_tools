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
        editedFiles: [{ path: '~/.claude/settings.json', content: '{}' }],
      },
      codex: {
        enabled: true,
        model: 'stale-model',
        editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "stale-model"' }],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('custom cli config store', () => {
  it('restores a deleted config when persistence fails', async () => {
    window.electronAPI.customCliConfig.save = vi.fn().mockResolvedValue({ success: false });
    await expect(useCustomCliConfigStore.getState().deleteConfig('cfg-1')).rejects.toThrow();
    expect(useCustomCliConfigStore.getState().configs.map(config => config.id)).toEqual(['cfg-1']);
  });

  it('keeps concurrent unsaved edits after loading fetched model metadata', async () => {
    window.electronAPI.customCliConfig.fetchModels = vi.fn().mockImplementation(async () => {
      useCustomCliConfigStore
        .getState()
        .updateConfig('cfg-1', { name: 'Unsaved name', notes: 'Draft' });
      useCustomCliConfigStore.getState().addConfig({ id: 'new-draft', name: 'New draft' });
      return ['fresh-model'];
    });
    window.electronAPI.customCliConfig.load = vi.fn().mockResolvedValue({
      configs: [{ ...createConfig(), models: ['fresh-model'] }],
      activeConfigId: 'cfg-1',
    });
    await useCustomCliConfigStore.getState().fetchModels('cfg-1');
    const state = useCustomCliConfigStore.getState();
    expect(state.configs.map(config => config.id)).toEqual(['cfg-1', 'new-draft']);
    expect(state.configs[0]).toMatchObject({
      name: 'Unsaved name',
      notes: 'Draft',
      models: ['fresh-model'],
    });
    expect(state.activeConfigId).toBeNull();
  });
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

  it('clears stale selected models after fetching a new custom CLI model list', async () => {
    await useCustomCliConfigStore.getState().fetchModels('cfg-1');

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.models).toEqual(['fresh-model', 'new-test']);
    expect(config.cliSettings.claudeCode.model).toBe('fresh-model');
    expect(config.cliSettings.claudeCode.editedFiles).toEqual([
      { path: '~/.claude/settings.json', content: '{}' },
    ]);
    expect(config.cliSettings.codex.model).toBeNull();
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
              editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-model"' }],
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
    expect(config.cliSettings.codex.editedFiles).toEqual([
      { path: '~/.codex/config.toml', content: 'model = "manual-model"' },
    ]);
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
              editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-model"' }],
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
  });

  it('normalizes invalid group multipliers when updating configs', () => {
    useCustomCliConfigStore.getState().updateConfig('cfg-1', { groupMultiplier: 0 });
    expect(useCustomCliConfigStore.getState().configs[0].groupMultiplier).toBe(0.001);

    useCustomCliConfigStore.getState().updateConfig('cfg-1', { groupMultiplier: Number.NaN });
    expect(useCustomCliConfigStore.getState().configs[0].groupMultiplier).toBe(1);
  });

  it('prevents stale local editor saves from reintroducing models outside the fetched list', () => {
    useCustomCliConfigStore.getState().updateConfig('cfg-1', {
      cliSettings: {
        ...createConfig().cliSettings,
        codex: {
          enabled: true,
          model: 'stale-model',
          editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "stale-model"' }],
        },
      },
    });

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.cliSettings.codex.model).toBeNull();
    expect(config.cliSettings.codex.editedFiles).toBeNull();
  });

  it('allows local editor saves to keep models explicitly marked as manual', () => {
    useCustomCliConfigStore.getState().updateConfig('cfg-1', {
      manualModels: ['manual-stale-model'],
      cliSettings: {
        ...createConfig().cliSettings,
        codex: {
          enabled: true,
          model: 'manual-stale-model',
          editedFiles: [{ path: '~/.codex/config.toml', content: 'model = "manual-stale-model"' }],
        },
      },
    });

    const config = useCustomCliConfigStore.getState().configs[0];
    expect(config.manualModels).toEqual(['manual-stale-model']);
    expect(config.cliSettings.codex.model).toBe('manual-stale-model');
    expect(config.cliSettings.codex.editedFiles).toEqual([
      { path: '~/.codex/config.toml', content: 'model = "manual-stale-model"' },
    ]);
  });
});
