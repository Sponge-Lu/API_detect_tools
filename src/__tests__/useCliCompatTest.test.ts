/**
 * 输入: 站点页 CLI 配置、Electron IPC mock、Zustand 检测状态
 * 输出: 站点页 CLI 兼容性测试回归结果
 * 定位: 测试层 - 验证 useCliCompatTest 的站点 URL 优先级、手动测试结果同步与 Gemini 错误提示
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCliCompatTest } from '../renderer/hooks/useCliCompatTest';
import { useDetectionStore, type CliConfig } from '../renderer/store/detectionStore';
import { useRouteStore } from '../renderer/store/routeStore';
import { buildProbeKey, buildSiteScopedProbeAccountId } from '../shared/types/route-proxy';

const {
  toastSuccessMock,
  toastErrorMock,
  toastWarningMock,
  toastInfoMock,
  sessionInfoMock,
  sessionErrorMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
  toastInfoMock: vi.fn(),
  sessionInfoMock: vi.fn(),
  sessionErrorMock: vi.fn(),
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: toastWarningMock,
    info: toastInfoMock,
  },
}));

vi.mock('../renderer/services/sessionEventLog', () => ({
  sessionEventLog: {
    info: sessionInfoMock,
    error: sessionErrorMock,
  },
}));

const SITE_URL = 'https://www.duckcoding.ai/';
const STORE_KEY = 'DuckCoding';
const SITE_ID = 'site-duckcoding';

interface TestElectronApi {
  electronAPI?: {
    loadConfig?: ReturnType<typeof vi.fn>;
    token?: {
      resolveApiKeyValue?: ReturnType<typeof vi.fn>;
    };
    cliCompat?: {
      testWithWrapper?: ReturnType<typeof vi.fn>;
      saveResult?: ReturnType<typeof vi.fn>;
    };
  };
}

function buildCliConfig(
  cliType: 'codex' | 'geminiCli',
  editedFiles: Array<{ path: string; content: string }>
): CliConfig {
  return {
    claudeCode: null,
    codex:
      cliType === 'codex'
        ? {
            apiKeyId: 1,
            model: 'gpt-5.2-xhigh',
            testModels: ['gpt-5.2-codex-low'],
            enabled: true,
            editedFiles,
            applyMode: 'merge',
          }
        : null,
    geminiCli:
      cliType === 'geminiCli'
        ? {
            apiKeyId: 1,
            model: 'gemini-3-pro-preview',
            testModels: ['gemini-3-flash-preview'],
            enabled: true,
            editedFiles,
            applyMode: 'merge',
          }
        : null,
  };
}

describe('useCliCompatTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useDetectionStore.setState({
      cliCompatibility: {},
      cliConfigs: {},
      cliTestingSites: new Set<string>(),
    });
    useRouteStore.setState({
      cliProbeLoaded: false,
      cliProbeTimeRange: '24h',
      fetchCliProbeData: vi.fn().mockResolvedValue(undefined),
      fetchConfig: vi.fn().mockResolvedValue(undefined),
    });

    const testWindow = window as typeof window & TestElectronApi;
    const electronAPI = (testWindow.electronAPI ??= {});
    electronAPI.loadConfig = vi.fn().mockResolvedValue({
      sites: [],
      accounts: [],
      routing: {
        cliProbe: {
          latest: {},
        },
      },
    });
    electronAPI.token = {
      ...(electronAPI.token ?? {}),
      resolveApiKeyValue: vi.fn().mockResolvedValue({
        success: true,
        data: 'sk-live-selected',
      }),
    };
    electronAPI.cliCompat = {
      testWithWrapper: vi.fn().mockResolvedValue({
        success: true,
        data: {
          claudeCode: null,
          codex: true,
          geminiCli: true,
        },
        samples: [],
      }),
      saveResult: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  it.each([
    [
      'codex',
      buildCliConfig('codex', [
        {
          path: '~/.codex/config.toml',
          content: 'base_url = "https://duckcoding.com/v1"\nwire_api = "responses"',
        },
        {
          path: '~/.codex/auth.json',
          content: '{\n  "OPENAI_API_KEY": "sk-stale-from-preview"\n}',
        },
      ]),
      'gpt-5.2-codex-low',
    ],
    [
      'geminiCli',
      buildCliConfig('geminiCli', [
        {
          path: '~/.gemini/.env',
          content: [
            'GEMINI_API_KEY=sk-stale-from-preview',
            'GEMINI_MODEL=gemini-3-pro-preview',
            'GOOGLE_GEMINI_BASE_URL=https://duckcoding.com',
          ].join('\n'),
        },
      ]),
      'gemini-3-flash-preview',
    ],
  ] as const)(
    'uses the current site URL for %s tests when the site selected an API key',
    async (cliType, cliConfig, expectedModel) => {
      useDetectionStore.getState().setCliConfig(STORE_KEY, cliConfig);

      const { result } = renderHook(() => useCliCompatTest());

      await act(async () => {
        await result.current.testSite(
          STORE_KEY,
          'DuckCoding',
          SITE_URL,
          [{ id: 1, key: 'sk-display-value' }],
          'acct-default'
        );
      });

      const testWindow = window as typeof window & TestElectronApi;
      expect(testWindow.electronAPI?.token?.resolveApiKeyValue).toHaveBeenCalledWith(
        SITE_URL,
        1,
        'acct-default'
      );
      expect(testWindow.electronAPI?.cliCompat?.testWithWrapper).toHaveBeenCalledWith({
        siteUrl: SITE_URL,
        configs: [
          {
            cliType,
            apiKey: 'sk-live-selected',
            model: expectedModel,
            baseUrl: 'https://www.duckcoding.ai',
          },
        ],
      });
      expect(toastWarningMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '预览配置中的站点域名（https://duckcoding.com）与当前站点（https://www.duckcoding.ai）不一致'
        )
      );
    }
  );

  it('syncs persisted manual probe results back into the site card and route usability cache', async () => {
    useDetectionStore.getState().setCliConfig(
      STORE_KEY,
      buildCliConfig('geminiCli', [
        {
          path: '~/.gemini/.env',
          content: [
            'GEMINI_API_KEY=sk-stale-from-preview',
            'GEMINI_MODEL=gemini-3-pro-preview',
            'GOOGLE_GEMINI_BASE_URL=https://duckcoding.com',
          ].join('\n'),
        },
      ])
    );

    const fetchCliProbeDataMock = vi.fn().mockResolvedValue(undefined);
    const fetchConfigMock = vi.fn().mockResolvedValue(undefined);
    useRouteStore.setState({
      cliProbeLoaded: true,
      cliProbeTimeRange: '24h',
      fetchCliProbeData: fetchCliProbeDataMock,
      fetchConfig: fetchConfigMock,
    });

    const testWindow = window as typeof window & TestElectronApi;
    const electronAPI = testWindow.electronAPI!;
    const siteScopedAccountId = buildSiteScopedProbeAccountId(SITE_ID);
    const probeKey = buildProbeKey(
      SITE_ID,
      siteScopedAccountId,
      'geminiCli',
      'gemini-3-flash-preview'
    );

    electronAPI.cliCompat = {
      testWithWrapper: vi.fn().mockResolvedValue({
        success: true,
        data: {
          claudeCode: null,
          codex: null,
          geminiCli: false,
          geminiDetail: {
            native: false,
            proxy: false,
          },
          geminiError: '错误码 401',
        },
        samples: [
          {
            cliType: 'geminiCli',
            model: 'gemini-3-flash-preview',
            success: false,
            testedAt: 1776800000000,
            error: '错误码 401',
            geminiDetail: {
              native: false,
              proxy: false,
            },
          },
        ],
      }),
      saveResult: vi.fn().mockResolvedValue({ success: true }),
    };
    electronAPI.loadConfig = vi.fn().mockResolvedValue({
      sites: [{ id: SITE_ID, name: STORE_KEY, url: 'https://www.duckcoding.ai' }],
      accounts: [],
      routing: {
        cliProbe: {
          latest: {
            [probeKey]: {
              probeKey,
              siteId: SITE_ID,
              accountId: siteScopedAccountId,
              cliType: 'geminiCli',
              canonicalModel: 'gemini-3-flash-preview',
              rawModel: 'gemini-3-flash-preview',
              healthy: false,
              lastSample: {
                sampleId: 'sample-1',
                probeKey,
                siteId: SITE_ID,
                accountId: siteScopedAccountId,
                cliType: 'geminiCli',
                canonicalModel: 'gemini-3-flash-preview',
                rawModel: 'gemini-3-flash-preview',
                success: false,
                source: 'siteManual',
                error: '错误码 401',
                geminiDetail: {
                  native: false,
                  proxy: false,
                },
                testedAt: 1776800000000,
              },
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useCliCompatTest());

    await act(async () => {
      await result.current.testSite(STORE_KEY, 'DuckCoding', SITE_URL, [{ id: 1, key: 'sk-live' }]);
    });

    expect(electronAPI.cliCompat?.saveResult).toHaveBeenCalled();
    expect(electronAPI.loadConfig).toHaveBeenCalled();
    expect(fetchConfigMock).toHaveBeenCalled();
    expect(fetchCliProbeDataMock).toHaveBeenCalledWith('24h', true);
    expect(useDetectionStore.getState().cliCompatibility[STORE_KEY]).toMatchObject({
      geminiCli: false,
      geminiError: '错误码 401',
      testedAt: 1776800000000,
      sourceLabel: '来自站点管理测试',
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Gemini CLI 失败原因: 错误码 401', 8000);
  });
});
