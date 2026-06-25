/**
 * 输入: 模拟的统一配置和账户级 CLI 配置
 * 输出: useDataLoader 缓存回填回归测试结果
 * 定位: 测试层 - 验证启动缓存加载按账户 card key 回填 CLI 配置
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDataLoader } from '../renderer/hooks/useDataLoader';

describe('useDataLoader', () => {
  it('loads account-level CLI config into the matching account card key', async () => {
    const setCliConfig = vi.fn();
    const accountCliConfig = {
      codex: {
        enabled: true,
        testModels: ['account-model'],
      },
    };
    const legacySiteCliConfig = {
      codex: {
        enabled: true,
        testModels: ['legacy-model'],
      },
    };

    const { result } = renderHook(() =>
      useDataLoader({
        setResults: vi.fn(),
        setApiKeys: vi.fn(),
        setUserGroups: vi.fn(),
        setModelPricing: vi.fn(),
        setCliConfig,
      })
    );

    await act(async () => {
      await result.current.loadCachedData({
        sites: [
          {
            id: 'site-1',
            name: 'Demo Site',
            url: 'https://demo.example.com',
            enabled: true,
            group: 'default',
            cli_config: {
              codex: {
                enabled: false,
                testModels: ['site-stale-model'],
              },
            },
          },
          {
            id: 'site-2',
            name: 'Legacy Site',
            url: 'https://legacy.example.com',
            enabled: true,
            group: 'default',
            cli_config: legacySiteCliConfig,
          },
        ],
        accounts: [
          {
            id: 'acct-1',
            site_id: 'site-1',
            account_name: 'Primary',
            user_id: 'user-1',
            access_token: 'token-1',
            auth_source: 'manual',
            status: 'active',
            cached_data: {},
            cli_config: accountCliConfig,
          },
        ],
      } as any);
    });

    expect(setCliConfig).toHaveBeenCalledWith('Demo Site::acct-1', accountCliConfig);
    expect(setCliConfig).toHaveBeenCalledWith('Legacy Site', legacySiteCliConfig);
    expect(setCliConfig).not.toHaveBeenCalledWith('Demo Site', expect.anything());
  });
});
