import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CliConfigStatus } from '../renderer/components/CliConfigStatus/CliConfigStatus';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import { useDetectionStore } from '../renderer/store/detectionStore';
import { useRouteStore } from '../renderer/store/routeStore';
import type { CliDetectionResult } from '../shared/types/config-detection';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';
import { DEFAULT_ROUTING_CONFIG, type RoutingConfig } from '../shared/types/route-proxy';

function buildRouteConfig(
  port = 3210,
  cliModelSelections: Partial<RoutingConfig['cliModelSelections']> = {}
): RoutingConfig {
  return {
    ...DEFAULT_ROUTING_CONFIG,
    server: {
      ...DEFAULT_ROUTING_CONFIG.server,
      enabled: true,
      port,
      unifiedApiKey: 'route-key',
    },
    cliModelSelections: {
      ...DEFAULT_ROUTING_CONFIG.cliModelSelections,
      ...cliModelSelections,
    },
    rules: [],
    stats: {},
    routePathStates: {},
    health: {},
    modelRegistry: {
      ...DEFAULT_ROUTING_CONFIG.modelRegistry,
      sources: [],
      entries: {},
      overrides: [],
      displayItems: [],
      vendorPriorities: {},
    },
    cliProbe: {
      config: { ...DEFAULT_ROUTING_CONFIG.cliProbe.config },
      latest: {},
      history: {},
    },
    analytics: {
      config: { ...DEFAULT_ROUTING_CONFIG.analytics.config },
      buckets: {},
    },
  };
}

function buildResult(
  baseUrl: string,
  overrides: Partial<CliDetectionResult> = {}
): CliDetectionResult {
  return {
    sourceType: 'other',
    baseUrl,
    hasApiKey: true,
    authType: 'gemini-api-key',
    detectedAt: Date.now(),
    ...overrides,
  };
}

function buildCustomConfig(
  overrides: Omit<Partial<CustomCliConfig>, 'cliSettings'> & {
    cliSettings?: Partial<CustomCliConfig['cliSettings']>;
  } = {}
): CustomCliConfig {
  const { cliSettings, ...configOverrides } = overrides;
  const defaultCliSettings: CustomCliConfig['cliSettings'] = {
    claudeCode: { enabled: true, model: null, testModels: [], testState: null },
    codex: { enabled: true, model: null, testModels: [], testState: null },
    geminiCli: { enabled: true, model: null, testModels: [], testState: null },
  };

  return {
    id: 'custom-1',
    name: 'Custom One',
    baseUrl: 'https://custom.example.com',
    apiKey: 'sk-custom',
    models: [],
    ...configOverrides,
    cliSettings: {
      ...defaultCliSettings,
      ...cliSettings,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('CliConfigStatus', () => {
  afterEach(() => {
    cleanup();
    useRouteStore.setState({ config: null, serverRunning: false, loading: false });
    useDetectionStore.setState({ cliConfigs: {} });
    useCustomCliConfigStore.setState({
      configs: [],
      activeConfigId: null,
      loading: false,
      saving: false,
      fetchingModels: {},
    });
  });

  it('shows route proxy CLI configs as local route in compact mode', () => {
    useRouteStore.setState({ config: buildRouteConfig(3210) });

    render(
      <CliConfigStatus
        cliType="geminiCli"
        result={buildResult('http://127.0.0.1:3210/v1beta')}
        compact
      />
    );

    expect(screen.getByText('本地路由')).toBeInTheDocument();
    expect(screen.getByTitle(/Gemini CLI: 本地路由/)).toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1/)).not.toBeInTheDocument();
  });

  it('does not render auth type icons in compact mode', () => {
    render(
      <CliConfigStatus
        cliType="geminiCli"
        result={buildResult('https://relay.example.com/v1beta', {
          sourceType: 'other',
          authType: 'gemini-api-key',
        })}
        compact
      />
    );

    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(screen.queryByText('🔑')).not.toBeInTheDocument();
    expect(screen.getByTitle(/认证: Gemini API Key/)).toBeInTheDocument();
  });

  it('matches localhost to the configured route proxy port', () => {
    useRouteStore.setState({ config: buildRouteConfig(3210) });

    render(
      <CliConfigStatus
        cliType="codex"
        result={buildResult('http://localhost:3210/v1/responses')}
        compact
      />
    );

    expect(screen.getByText('本地路由')).toBeInTheDocument();
    expect(screen.getByTitle(/Codex: 本地路由/)).toBeInTheDocument();
  });

  it('shows the selected route model as compact subtitle for local route configs', () => {
    useRouteStore.setState({
      config: buildRouteConfig(3210, {
        codex: 'gpt-5.4',
      }),
    });

    render(
      <CliConfigStatus
        cliType="codex"
        result={buildResult('http://127.0.0.1:3210/v1/responses')}
        compact
      />
    );

    expect(screen.getByText('本地路由')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByTitle(/模型: gpt-5\.4/)).toBeInTheDocument();
  });

  it('shows the managed site CLI model as compact subtitle', () => {
    useDetectionStore.setState({
      cliConfigs: {
        'Managed Site': {
          geminiCli: { apiKeyId: 1, model: 'gemini-2.5-pro' },
        },
      },
    });

    render(
      <CliConfigStatus
        cliType="geminiCli"
        result={buildResult('https://managed.example.com/v1beta', {
          sourceType: 'managed',
          siteName: 'Managed Site',
          siteId: 'site-1',
        })}
        compact
      />
    );

    expect(screen.getByText('Managed Site')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
    expect(screen.getByTitle(/模型: gemini-2\.5-pro/)).toBeInTheDocument();
  });

  it('uses the unique account-scoped managed CLI model when site-level config is absent', () => {
    useDetectionStore.setState({
      cliConfigs: {
        'Managed Site::account-1': {
          codex: { apiKeyId: 2, model: 'gpt-5.3-codex' },
        },
      },
    });

    render(
      <CliConfigStatus
        cliType="codex"
        result={buildResult('https://managed.example.com/v1/responses', {
          sourceType: 'managed',
          siteName: 'Managed Site',
          siteId: 'site-1',
        })}
        compact
      />
    );

    expect(screen.getByText('Managed Site')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.3-codex')).toBeInTheDocument();
    expect(screen.getByTitle(/模型: gpt-5\.3-codex/)).toBeInTheDocument();
  });

  it('shows the matched custom CLI model as compact subtitle', () => {
    useCustomCliConfigStore.setState({
      configs: [
        buildCustomConfig({
          cliSettings: {
            codex: { enabled: true, model: 'gpt-5.4', testModels: [], testState: null },
          },
        }),
      ],
    });

    render(
      <CliConfigStatus
        cliType="codex"
        result={buildResult('https://custom.example.com/v1/responses')}
        compact
      />
    );

    expect(screen.getByText('Custom One')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByTitle(/模型: gpt-5\.4/)).toBeInTheDocument();
  });

  it('matches custom Gemini CLI configs with v1beta request paths', () => {
    useCustomCliConfigStore.setState({
      configs: [
        buildCustomConfig({
          cliSettings: {
            geminiCli: {
              enabled: true,
              model: 'gemini-2.5-flash',
              testModels: [],
              testState: null,
            },
          },
        }),
      ],
    });

    render(
      <CliConfigStatus
        cliType="geminiCli"
        result={buildResult('https://custom.example.com/v1beta/models/gemini-2.5-flash')}
        compact
      />
    );

    expect(screen.getByText('Custom One')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument();
    expect(screen.getByTitle(/模型: gemini-2\.5-flash/)).toBeInTheDocument();
  });

  it('keeps non-route local URLs as other relay stations', () => {
    useRouteStore.setState({ config: buildRouteConfig(3210) });

    render(
      <CliConfigStatus
        cliType="geminiCli"
        result={buildResult('http://127.0.0.1:9999/v1beta')}
        compact
      />
    );

    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(screen.queryByText('本地路由')).not.toBeInTheDocument();
  });
});
