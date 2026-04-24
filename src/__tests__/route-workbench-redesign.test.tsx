import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVendorSections,
  ModelRedirectionTab,
  shouldRefreshRegistrySourceDetails,
} from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';
import { RoutePage } from '../renderer/pages/RoutePage';
import type { RoutingConfig } from '../shared/types/route-proxy';

const mockUpsertMappingOverride = vi.fn();
const mockUpsertDisplayItem = vi.fn();
const mockDeleteDisplayItem = vi.fn();
const mockDeleteMappingOverride = vi.fn();
const mockRebuildModelRegistry = vi.fn();
const mockSyncModelRegistrySources = vi.fn();
const mockSaveVendorPriorityConfig = vi.fn();

type MockRouteStoreShape = {
  config: RoutingConfig;
  loading: boolean;
  cliProbeView: [];
  cliProbeTimeRange: '24h';
  cliProbeLoaded: boolean;
  cliProbeError: null;
  serverRunning: boolean;
  rebuildModelRegistry: typeof mockRebuildModelRegistry;
  syncModelRegistrySources: typeof mockSyncModelRegistrySources;
  fetchCliProbeData: ReturnType<typeof vi.fn>;
  runProbeNow: ReturnType<typeof vi.fn>;
  saveCliProbeConfig: ReturnType<typeof vi.fn>;
  saveCliModelSelections: ReturnType<typeof vi.fn>;
  saveServerConfig: ReturnType<typeof vi.fn>;
  regenerateApiKey: ReturnType<typeof vi.fn>;
  startServer: ReturnType<typeof vi.fn>;
  stopServer: ReturnType<typeof vi.fn>;
  upsertMappingOverride: typeof mockUpsertMappingOverride;
  upsertDisplayItem: typeof mockUpsertDisplayItem;
  deleteDisplayItem: typeof mockDeleteDisplayItem;
  saveVendorPriorityConfig: typeof mockSaveVendorPriorityConfig;
  deleteMappingOverride: typeof mockDeleteMappingOverride;
};

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (selector: (store: MockRouteStoreShape) => unknown) =>
    selector({
      config: {
        modelRegistry: {
          entries: {
            'claude-opus-4-6': {
              vendor: 'claude',
              canonicalName: 'claude-opus-4-6',
              aliases: ['claude-opus-4.6-20260201'],
              sources: [
                {
                  sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
                  siteId: 'site-1',
                  siteName: 'Claude Site',
                  accountId: 'acc-1',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'claude-opus-4.6-20260201',
                  vendor: 'claude',
                  userGroupKeys: ['team-alpha', 'team-beta'],
                  apiKeyGroups: ['team-beta'],
                  apiKeyNamesByGroup: {
                    'team-beta': ['main-key', 'backup-key'],
                  },
                  availableUserGroups: ['team-alpha', 'team-beta'],
                  availableApiKeys: [
                    {
                      apiKeyId: 'main-key-id',
                      apiKeyName: 'main-key',
                      accountId: 'acc-1',
                      accountName: 'Main',
                      group: 'team-beta',
                    },
                    {
                      apiKeyId: 'backup-key-id',
                      apiKeyName: 'backup-key',
                      accountId: 'acc-1',
                      accountName: 'Main',
                      group: 'team-beta',
                    },
                  ],
                  firstSeenAt: 10,
                  lastSeenAt: 10,
                },
              ],
              hasOverride: false,
              createdAt: 10,
              updatedAt: 40,
            },
            'claude-sonnet-4-6': {
              vendor: 'claude',
              canonicalName: 'claude-sonnet-4-6',
              aliases: ['claude-sonnet-4.6-20260201'],
              sources: [
                {
                  sourceKey: 'site-1:acc-1:claude-sonnet-4.6-20260201',
                  siteId: 'site-1',
                  siteName: 'Claude Site',
                  accountId: 'acc-1',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'claude-sonnet-4.6-20260201',
                  vendor: 'claude',
                  userGroupKeys: ['team-alpha'],
                  apiKeyGroups: [],
                  apiKeyNamesByGroup: {},
                  availableUserGroups: ['team-alpha'],
                  availableApiKeys: [],
                  firstSeenAt: 11,
                  lastSeenAt: 11,
                },
              ],
              hasOverride: true,
              createdAt: 11,
              updatedAt: 38,
            },
            'claude-haiku-4-5': {
              vendor: 'claude',
              canonicalName: 'claude-haiku-4-5',
              aliases: ['claude-haiku-4.5-20251001'],
              sources: [
                {
                  sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
                  siteId: 'site-2',
                  siteName: 'Claude Site 2',
                  accountId: 'acc-2',
                  accountName: 'Secondary',
                  sourceType: 'account',
                  originalModel: 'claude-haiku-4.5-20251001',
                  vendor: 'claude',
                  userGroupKeys: ['team-gamma'],
                  apiKeyGroups: ['team-gamma'],
                  apiKeyNamesByGroup: {
                    'team-gamma': ['shared-key'],
                  },
                  availableUserGroups: ['team-gamma'],
                  availableApiKeys: [
                    {
                      apiKeyId: 'shared-key-id',
                      apiKeyName: 'shared-key',
                      accountId: 'acc-2',
                      accountName: 'Secondary',
                      group: 'team-gamma',
                    },
                  ],
                  firstSeenAt: 12,
                  lastSeenAt: 12,
                },
              ],
              hasOverride: false,
              createdAt: 12,
              updatedAt: 35,
            },
            'gpt-5.4': {
              vendor: 'gpt',
              canonicalName: 'gpt-5.4',
              aliases: ['gpt-5.4-latest', 'gpt-5.4-experimental'],
              sources: [
                {
                  sourceKey: 'site-3:acc-3:gpt-5.4-latest',
                  siteId: 'site-3',
                  siteName: 'OpenAI Site',
                  accountId: 'acc-3',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'gpt-5.4-latest',
                  vendor: 'gpt',
                  firstSeenAt: 13,
                  lastSeenAt: 13,
                },
                {
                  sourceKey: 'site-4:acc-4:gpt-5.4-experimental',
                  siteId: 'site-4',
                  siteName: 'Legacy OpenAI Site',
                  accountId: 'acc-4',
                  accountName: 'Legacy',
                  sourceType: 'account',
                  originalModel: 'gpt-5.4-experimental',
                  vendor: 'gpt',
                  availableUserGroups: [],
                  availableApiKeys: [
                    {
                      apiKeyId: 'legacy-key-id',
                      apiKeyName: 'legacy-key',
                      accountId: 'acc-4',
                      accountName: 'Legacy',
                      group: 'legacy-group',
                    },
                  ],
                  firstSeenAt: 13,
                  lastSeenAt: 13,
                },
              ],
              hasOverride: false,
              createdAt: 13,
              updatedAt: 34,
            },
            'gpt-5': {
              vendor: 'gpt',
              canonicalName: 'gpt-5',
              aliases: ['gpt-5-latest'],
              sources: [
                {
                  sourceKey: 'site-3:acc-3:gpt-5-latest',
                  siteId: 'site-3',
                  siteName: 'OpenAI Site',
                  accountId: 'acc-3',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'gpt-5-latest',
                  vendor: 'gpt',
                  firstSeenAt: 14,
                  lastSeenAt: 14,
                },
              ],
              hasOverride: false,
              createdAt: 14,
              updatedAt: 33,
            },
            o3: {
              vendor: 'gpt',
              canonicalName: 'o3',
              aliases: ['o3-latest'],
              sources: [
                {
                  sourceKey: 'site-3:acc-3:o3-latest',
                  siteId: 'site-3',
                  siteName: 'OpenAI Site',
                  accountId: 'acc-3',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'o3-latest',
                  vendor: 'gpt',
                  firstSeenAt: 15,
                  lastSeenAt: 15,
                },
              ],
              hasOverride: false,
              createdAt: 15,
              updatedAt: 32,
            },
            'gpt-4.1': {
              vendor: 'gpt',
              canonicalName: 'gpt-4.1',
              aliases: ['gpt-4.1-edge'],
              sources: [
                {
                  sourceKey: 'site-3:acc-3:gpt-4.1-edge',
                  siteId: 'site-3',
                  siteName: 'OpenAI Site',
                  accountId: 'acc-3',
                  accountName: 'Main',
                  sourceType: 'account',
                  originalModel: 'gpt-4.1-edge',
                  vendor: 'gpt',
                  firstSeenAt: 16,
                  lastSeenAt: 16,
                },
              ],
              hasOverride: false,
              createdAt: 16,
              updatedAt: 31,
            },
          },
          sources: [
            {
              sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
              siteId: 'site-1',
              siteName: 'Claude Site',
              accountId: 'acc-1',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'claude-opus-4.6-20260201',
              vendor: 'claude',
              userGroupKeys: ['team-alpha', 'team-beta'],
              apiKeyGroups: ['team-beta'],
              apiKeyNamesByGroup: {
                'team-beta': ['main-key', 'backup-key'],
              },
              availableUserGroups: ['team-alpha', 'team-beta'],
              availableApiKeys: [
                {
                  apiKeyId: 'main-key-id',
                  apiKeyName: 'main-key',
                  accountId: 'acc-1',
                  accountName: 'Main',
                  group: 'team-beta',
                },
                {
                  apiKeyId: 'backup-key-id',
                  apiKeyName: 'backup-key',
                  accountId: 'acc-1',
                  accountName: 'Main',
                  group: 'team-beta',
                },
              ],
              firstSeenAt: 10,
              lastSeenAt: 10,
            },
            {
              sourceKey: 'site-1:acc-1:claude-sonnet-4.6-20260201',
              siteId: 'site-1',
              siteName: 'Claude Site',
              accountId: 'acc-1',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'claude-sonnet-4.6-20260201',
              vendor: 'claude',
              userGroupKeys: ['team-alpha'],
              apiKeyGroups: [],
              apiKeyNamesByGroup: {},
              availableUserGroups: ['team-alpha'],
              availableApiKeys: [],
              firstSeenAt: 11,
              lastSeenAt: 11,
            },
            {
              sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
              siteId: 'site-2',
              siteName: 'Claude Site 2',
              accountId: 'acc-2',
              accountName: 'Secondary',
              sourceType: 'account',
              originalModel: 'claude-haiku-4.5-20251001',
              vendor: 'claude',
              userGroupKeys: ['team-gamma'],
              apiKeyGroups: ['team-gamma'],
              apiKeyNamesByGroup: {
                'team-gamma': ['shared-key'],
              },
              availableUserGroups: ['team-gamma'],
              availableApiKeys: [
                {
                  apiKeyId: 'shared-key-id',
                  apiKeyName: 'shared-key',
                  accountId: 'acc-2',
                  accountName: 'Secondary',
                  group: 'team-gamma',
                },
              ],
              firstSeenAt: 12,
              lastSeenAt: 12,
            },
            {
              sourceKey: 'site-3:acc-3:gpt-5.4-latest',
              siteId: 'site-3',
              siteName: 'OpenAI Site',
              accountId: 'acc-3',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'gpt-5.4-latest',
              vendor: 'gpt',
              firstSeenAt: 13,
              lastSeenAt: 13,
            },
            {
              sourceKey: 'site-4:acc-4:gpt-5.4-experimental',
              siteId: 'site-4',
              siteName: 'Legacy OpenAI Site',
              accountId: 'acc-4',
              accountName: 'Legacy',
              sourceType: 'account',
              originalModel: 'gpt-5.4-experimental',
              vendor: 'gpt',
              availableUserGroups: [],
              availableApiKeys: [
                {
                  apiKeyId: 'legacy-key-id',
                  apiKeyName: 'legacy-key',
                  accountId: 'acc-4',
                  accountName: 'Legacy',
                  group: 'legacy-group',
                },
              ],
              firstSeenAt: 13,
              lastSeenAt: 13,
            },
            {
              sourceKey: 'site-3:acc-3:gpt-5-latest',
              siteId: 'site-3',
              siteName: 'OpenAI Site',
              accountId: 'acc-3',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'gpt-5-latest',
              vendor: 'gpt',
              firstSeenAt: 14,
              lastSeenAt: 14,
            },
            {
              sourceKey: 'site-3:acc-3:o3-latest',
              siteId: 'site-3',
              siteName: 'OpenAI Site',
              accountId: 'acc-3',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'o3-latest',
              vendor: 'gpt',
              firstSeenAt: 15,
              lastSeenAt: 15,
            },
            {
              sourceKey: 'site-3:acc-3:gpt-4.1-edge',
              siteId: 'site-3',
              siteName: 'OpenAI Site',
              accountId: 'acc-3',
              accountName: 'Main',
              sourceType: 'account',
              originalModel: 'gpt-4.1-edge',
              vendor: 'gpt',
              firstSeenAt: 16,
              lastSeenAt: 16,
            },
          ],
          overrides: [
            {
              id: 'override-1',
              sourceKey: 'site-1:acc-1:claude-sonnet-4.6-20260201',
              canonicalName: 'claude-sonnet-4-6',
              action: 'rename',
              createdAt: 30,
              updatedAt: 40,
            },
          ],
          displayItems: [
            {
              id: 'seeded:claude:0',
              vendor: 'claude',
              canonicalName: 'claude-opus-4-6',
              sourceKeys: ['site-1:acc-1:claude-opus-4.6-20260201'],
              originalModelOrder: ['claude-opus-4.6-20260201'],
              mode: 'seeded',
              createdAt: 10,
              updatedAt: 10,
            },
            {
              id: 'seeded:claude:1',
              vendor: 'claude',
              canonicalName: 'claude-sonnet-4-6',
              sourceKeys: ['site-1:acc-1:claude-sonnet-4.6-20260201'],
              originalModelOrder: ['claude-sonnet-4.6-20260201'],
              mode: 'seeded',
              createdAt: 11,
              updatedAt: 11,
            },
            {
              id: 'seeded:claude:2',
              vendor: 'claude',
              canonicalName: 'claude-haiku-4-5',
              sourceKeys: ['site-2:acc-2:claude-haiku-4.5-20251001'],
              originalModelOrder: ['claude-haiku-4.5-20251001'],
              mode: 'seeded',
              createdAt: 12,
              updatedAt: 12,
            },
            {
              id: 'seeded:gpt:0',
              vendor: 'gpt',
              canonicalName: 'gpt-5.4',
              sourceKeys: ['site-3:acc-3:gpt-5.4-latest', 'site-4:acc-4:gpt-5.4-experimental'],
              originalModelOrder: ['gpt-5.4-latest', 'gpt-5.4-experimental'],
              mode: 'seeded',
              createdAt: 13,
              updatedAt: 13,
            },
            {
              id: 'seeded:gpt:1',
              vendor: 'gpt',
              canonicalName: 'gpt-5',
              sourceKeys: ['site-3:acc-3:gpt-5-latest'],
              originalModelOrder: ['gpt-5-latest'],
              mode: 'seeded',
              createdAt: 14,
              updatedAt: 14,
            },
            {
              id: 'seeded:gpt:2',
              vendor: 'gpt',
              canonicalName: 'o3',
              sourceKeys: ['site-3:acc-3:o3-latest'],
              originalModelOrder: ['o3-latest'],
              mode: 'seeded',
              createdAt: 15,
              updatedAt: 15,
            },
          ],
          vendorPriorities: {
            claude: {
              sitePriorities: {
                'site-1': 5,
                'site-2': 9,
              },
              apiKeyPriorities: {
                'site-1:acc-1:main-key-id': 3,
                'site-1:acc-1:backup-key-id': 1,
                'site-2:acc-2:shared-key-id': 3,
              },
            },
          },
        },
        cliProbe: { config: { enabled: true, intervalMinutes: 60 } },
        cliModelSelections: {
          claudeCode: 'claude-sonnet-4.6-20260201',
          codex: 'o3-latest',
          geminiCli: null,
        },
        server: { host: '127.0.0.1', port: 3000, unifiedApiKey: 'route-key' },
      },
      loading: false,
      cliProbeView: [],
      cliProbeTimeRange: '24h',
      cliProbeLoaded: true,
      cliProbeError: null,
      serverRunning: true,
      rebuildModelRegistry: mockRebuildModelRegistry,
      syncModelRegistrySources: mockSyncModelRegistrySources,
      fetchCliProbeData: vi.fn(),
      runProbeNow: vi.fn(),
      saveCliProbeConfig: vi.fn(),
      saveCliModelSelections: vi.fn(),
      saveServerConfig: vi.fn(),
      regenerateApiKey: vi.fn(),
      startServer: vi.fn(),
      stopServer: vi.fn(),
      upsertMappingOverride: mockUpsertMappingOverride,
      upsertDisplayItem: mockUpsertDisplayItem,
      deleteDisplayItem: mockDeleteDisplayItem,
      saveVendorPriorityConfig: mockSaveVendorPriorityConfig,
      deleteMappingOverride: mockDeleteMappingOverride,
    }),
}));

const mockGetAnalyticsSummary = vi.fn();

beforeEach(() => {
  mockUpsertMappingOverride.mockReset().mockResolvedValue({
    id: 'override-2',
    sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
    canonicalName: 'claude-team-route',
    action: 'rename',
    createdAt: 50,
    updatedAt: 50,
  });
  mockUpsertDisplayItem.mockReset().mockResolvedValue({
    version: 1,
    sources: [],
    entries: {},
    overrides: [],
    displayItems: [],
    vendorPriorities: {},
  });
  mockDeleteDisplayItem.mockReset().mockResolvedValue({
    version: 1,
    sources: [],
    entries: {},
    overrides: [],
    displayItems: [],
    vendorPriorities: {},
  });
  mockDeleteMappingOverride.mockReset().mockResolvedValue(true);
  mockRebuildModelRegistry.mockReset().mockResolvedValue(undefined);
  mockSyncModelRegistrySources.mockReset().mockResolvedValue({
    version: 1,
    sources: [],
    entries: {},
    overrides: [],
    displayItems: [],
    vendorPriorities: {},
    lastAggregatedAt: 1,
  });
  mockSaveVendorPriorityConfig.mockReset().mockResolvedValue({
    version: 1,
    sources: [],
    entries: {},
    overrides: [],
    displayItems: [],
    vendorPriorities: {},
  });

  (
    window as Window &
      typeof globalThis & {
        electronAPI: {
          route: {
            getAnalyticsSummary: typeof mockGetAnalyticsSummary;
          };
        };
      }
  ).electronAPI.route = {
    getAnalyticsSummary: mockGetAnalyticsSummary.mockResolvedValue({
      success: true,
      data: {
        totalRequests: 12,
        successRate: 100,
        promptTokens: 2048,
        completionTokens: 1024,
      },
    }),
  };
});

describe('route workbench redesign', () => {
  it('renders the combined route page without the legacy route workbench shell', async () => {
    render(<RoutePage />);

    await waitFor(() => {
      expect(screen.queryByTestId('route-workbench-header')).not.toBeInTheDocument();
    });

    expect(screen.getByText('代理服务器')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
    expect(screen.getByDisplayValue('claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByDisplayValue('o3')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'gpt-4.1' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'claude-opus-4-6' }).length).toBeGreaterThan(0);
    expect(screen.getByText('模型重定向')).toBeInTheDocument();
    expect(screen.getAllByText('claude-opus-4-6').length).toBeGreaterThan(0);
    await screen.findByText('总请求');
  });

  it('keeps CLI usability as an independent page with the existing local action cluster', async () => {
    render(<CliUsabilityTab />);

    expect(screen.queryByRole('dialog', { name: '检测设置' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开启定时检测|关闭定时检测/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '检测间隔（分钟）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
    expect(screen.queryByTestId('route-workbench-header')).not.toBeInTheDocument();
  });

  it('keeps vendor sections collapsed by default and reveals entry details after expanding', () => {
    render(<ModelRedirectionTab />);

    expect(screen.queryByText('claude-sonnet-4.6-20260201')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));

    expect(screen.getByText('claude-sonnet-4.6-20260201')).toBeInTheDocument();
  });

  it('supports searching and multi-selecting original models when creating a redirect', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '新增重定向' }));

    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('重定向名称'), {
      target: { value: 'claude-team-route' },
    });
    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'claude' },
    });

    fireEvent.click(screen.getByText('claude-opus-4.6-20260201').closest('label')!);
    fireEvent.click(screen.getByText('claude-haiku-4.5-20251001').closest('label')!);

    fireEvent.click(within(dialog).getByRole('button', { name: '新增重定向' }));

    await waitFor(() => {
      expect(mockUpsertMappingOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
          canonicalName: 'claude-team-route',
          action: 'rename',
        })
      );
      expect(mockUpsertMappingOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
          canonicalName: 'claude-team-route',
          action: 'rename',
        })
      );
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalName: 'claude-team-route',
          originalModelOrder: ['claude-opus-4.6-20260201', 'claude-haiku-4.5-20251001'],
        })
      );
    });
  });

  it('allows removing selected original models directly inside the edit dialog', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑 claude-opus-4-6' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑模型重定向' });
    expect(within(dialog).getByText('已选原始模型')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: '取消选择 claude-opus-4.6-20260201' })
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: '取消选择 claude-opus-4.6-20260201' })
      );
    });

    expect(
      within(dialog).queryByRole('button', { name: '取消选择 claude-opus-4.6-20260201' })
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('已选原始模型')).toBeInTheDocument();
    expect(within(dialog).getByText('还没有选择原始模型')).toBeInTheDocument();
  });

  it('caps the selected original model area with internal scroll and removes the old helper copy', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '新增重定向' }));

    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });

    expect(
      within(dialog).queryByText('下方展示所有站点的模型列表，可直接搜索并勾选多个来源模型。')
    ).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText('gpt-5.4-latest').closest('label')!);
      fireEvent.click(screen.getByText('gpt-5-latest').closest('label')!);
      fireEvent.click(screen.getByText('o3-latest').closest('label')!);
    });

    expect(dialog.className).toContain('h-[72vh]');
    expect(dialog.className).toContain('max-h-[72vh]');
    expect(dialog.className).toContain('max-w-4xl');

    const overlayBody = within(dialog).getByTestId('overlay-body');
    expect(overlayBody.className).toContain('flex');
    expect(overlayBody.className).toContain('flex-1');
    expect(overlayBody.className).toContain('max-h-none');
    expect(overlayBody.className).toContain('overflow-hidden');

    expect(within(dialog).getByText('已选 3')).toBeInTheDocument();

    const selectedList = within(dialog).getByTestId('selected-original-models-list');
    expect(selectedList.className).not.toMatch(/(?:^|\s)h-56(?:\s|$)/);
    expect(selectedList.className).toContain('max-h-56');
    expect(selectedList.className).toContain('overflow-y-auto');
    expect(selectedList.className).toContain('md:flex-1');
    expect(selectedList.className).toContain('md:basis-0');
    expect(selectedList.className).toContain('md:max-h-none');
    expect(selectedList.className).toContain('[scrollbar-gutter:stable]');

    const candidateList = within(dialog).getByTestId('original-model-candidate-list');
    expect(candidateList.className).toContain('flex-1');
    expect(candidateList.className).toContain('basis-0');
    expect(candidateList.className).toContain('overflow-y-auto');
    expect(within(dialog).getByTestId('selected-original-models-header').className).toContain(
      'min-h-12'
    );
    expect(within(dialog).getByTestId('original-model-candidate-header').className).toContain(
      'min-h-12'
    );
    expect(within(dialog).getByText('原始模型')).toBeInTheDocument();
  });

  it('keeps the edit dialog body pinned to the footer when a redirect already has multiple original models', async () => {
    render(<ModelRedirectionTab />);

    const gptSection = screen.getByText('OpenAI').closest('section');
    expect(gptSection).not.toBeNull();

    fireEvent.click(within(gptSection!).getByRole('button', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑 gpt-5.4' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑模型重定向' });
    expect(within(dialog).getByText('已选原始模型')).toBeInTheDocument();

    const selectedList = within(dialog).getByTestId('selected-original-models-list');
    expect(within(selectedList).getByText('gpt-5.4-latest')).toBeInTheDocument();
    expect(within(selectedList).getByText('gpt-5.4-experimental')).toBeInTheDocument();
    expect(within(dialog).getByText('已选 2')).toBeInTheDocument();
    expect(selectedList.className).toContain('max-h-56');
    expect(selectedList.className).toContain('md:flex-1');
    expect(selectedList.className).toContain('md:basis-0');

    const overlayBody = within(dialog).getByTestId('overlay-body');
    expect(overlayBody.className).toContain('flex');
    expect(overlayBody.className).toContain('flex-1');

    const candidateList = within(dialog).getByTestId('original-model-candidate-list');
    expect(candidateList.className).toContain('flex-1');
    expect(candidateList.className).toContain('basis-0');

    const footer = within(dialog).getByTestId('overlay-footer');
    expect(footer.className).toContain('shrink-0');
  });

  it('keeps wheel scrolling inside the nested selected/candidate lists instead of bubbling to the dialog', async () => {
    render(<ModelRedirectionTab />);

    const gptSection = screen.getByText('OpenAI').closest('section');
    expect(gptSection).not.toBeNull();

    fireEvent.click(within(gptSection!).getByRole('button', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑 gpt-5.4' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑模型重定向' });
    const bubbleSpy = vi.fn();
    dialog.addEventListener('wheel', bubbleSpy);

    fireEvent.wheel(within(dialog).getByTestId('selected-original-models-list'), {
      deltaY: 120,
    });
    fireEvent.wheel(within(dialog).getByTestId('original-model-candidate-list'), {
      deltaY: 120,
    });

    expect(bubbleSpy).not.toHaveBeenCalled();
  });

  it('keeps redirect and original name fields on the same dialog row and shows an empty selected state card', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '新增重定向' }));

    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });
    const inputRow = within(dialog).getByTestId('redirect-editor-input-row');
    expect(inputRow.className).toContain('md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]');
    expect(within(inputRow).getByText('重定向名称')).toBeInTheDocument();
    expect(within(inputRow).getByText('原始名称')).toBeInTheDocument();

    const searchInput = within(inputRow).getByLabelText('搜索原始名称');
    expect(searchInput).toBeInTheDocument();

    const selectedList = within(dialog).getByTestId('selected-original-models-list');
    expect(within(selectedList).getByText('还没有选择原始模型')).toBeInTheDocument();
    expect(within(dialog).getByText('已选 0')).toBeInTheDocument();
  });

  it('shows all site models in the redirect editor candidate list regardless of vendor', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '新增重定向' }));

    await screen.findByRole('dialog', { name: '新增模型重定向' });

    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'gpt-4.1' },
    });

    expect(screen.getByText('gpt-4.1-edge')).toBeInTheDocument();
    expect(screen.getByText('1 站点 / 1 来源')).toBeInTheDocument();
  });

  it('shows only the vendor top-three models in both the collapsed summary and expanded list', () => {
    render(<ModelRedirectionTab />);

    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('gpt-5')).toBeInTheDocument();
    expect(screen.getByText('o3')).toBeInTheDocument();
    expect(screen.queryByText('gpt-4.1')).not.toBeInTheDocument();

    const gptSection = screen.getByText('OpenAI').closest('section');
    expect(gptSection).not.toBeNull();

    fireEvent.click(within(gptSection!).getByRole('button', { name: /OpenAI/ }));

    expect(screen.queryByText('gpt-4.1')).not.toBeInTheDocument();
  });

  it('shows source details for redirected models with user groups and api key highlighting', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);

    const dialog = await screen.findByRole('dialog', { name: 'claude-opus-4-6 来源详情' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Claude Site')).toBeInTheDocument();
    expect(within(dialog).getByText('claude-opus-4.6-20260201')).toBeInTheDocument();

    const highlightedGroup = within(dialog).getByText('team-beta (main-key, backup-key)');
    const normalGroup = within(dialog).getByText('team-alpha');

    expect(highlightedGroup.className).toContain('bg-[var(--accent-soft-strong)]');
    expect(normalGroup.className).toContain('bg-[var(--surface-1)]');
  });

  it('opens the vendor priority dialog and saves site/api key priorities', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '站点优先级' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Anthropic 站点优先级（数字越小优先级越高）',
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Claude Site')).toBeInTheDocument();
    expect(within(dialog).getByText('backup-key (Main)')).toBeInTheDocument();

    const inputs = within(dialog).getAllByRole('spinbutton');
    fireEvent.change(inputs[0]!, { target: { value: '2' } });
    fireEvent.change(inputs[2]!, { target: { value: '1' } });

    fireEvent.click(within(dialog).getByRole('button', { name: '保存优先级' }));

    await waitFor(() => {
      expect(mockSaveVendorPriorityConfig).toHaveBeenCalledWith(
        'claude',
        expect.objectContaining({
          sitePriorities: expect.objectContaining({
            'site-1': 2,
          }),
          apiKeyPriorities: expect.objectContaining({
            'site-1:acc-1:backup-key-id': 1,
          }),
        })
      );
    });
  });

  it('reorders site priority cards immediately after editing priority values', async () => {
    render(<ModelRedirectionTab />);

    const claudeSection = screen.getByText('Anthropic').closest('section');
    expect(claudeSection).not.toBeNull();

    fireEvent.click(within(claudeSection!).getByRole('button', { name: '站点优先级' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Anthropic 站点优先级（数字越小优先级越高）',
    });

    let siteSections = Array.from(dialog.querySelectorAll('section'));
    expect(within(siteSections[0]!).getByText('Claude Site')).toBeInTheDocument();
    expect(within(siteSections[1]!).getByText('Claude Site 2')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(within(siteSections[1]!).getAllByRole('spinbutton')[0]!, {
        target: { value: '1' },
      });
    });

    siteSections = Array.from(dialog.querySelectorAll('section'));
    expect(within(siteSections[0]!).getByText('Claude Site 2')).toBeInTheDocument();
    expect(within(siteSections[1]!).getByText('Claude Site')).toBeInTheDocument();
  });

  it('shows only available sites in the vendor priority dialog', async () => {
    render(<ModelRedirectionTab />);

    const gptSection = screen.getByText('OpenAI').closest('section');
    expect(gptSection).not.toBeNull();

    fireEvent.click(within(gptSection!).getByRole('button', { name: '站点优先级' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'OpenAI 站点优先级（数字越小优先级越高）',
    });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('当前厂商还没有可配置优先级的可用站点或 API key。')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('OpenAI Site')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Legacy OpenAI Site')).not.toBeInTheDocument();
  });

  it('syncs model sources from the header action without rebuilding defaults', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '同步来源' }));

    await waitFor(() => {
      expect(mockSyncModelRegistrySources).toHaveBeenCalledWith(true);
    });
    expect(mockRebuildModelRegistry).not.toHaveBeenCalled();
  });

  it('deletes a redirect card through the display item action', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除 claude-opus-4-6' }));

    await waitFor(() => {
      expect(mockDeleteDisplayItem).toHaveBeenCalledWith('seeded:claude:0');
    });
  });

  it('keeps the trailing redirect card actions interactive after expanding a vendor', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));

    const editButton = screen.getByRole('button', { name: '编辑 claude-haiku-4-5' });
    const deleteButton = screen.getByRole('button', { name: '删除 claude-haiku-4-5' });

    expect(editButton).not.toBeDisabled();
    expect(deleteButton).not.toBeDisabled();

    fireEvent.click(editButton);

    expect(await screen.findByRole('dialog', { name: '编辑模型重定向' })).toBeInTheDocument();
  });

  it('marks persisted registry entries without api key names for source detail refresh', () => {
    expect(
      shouldRefreshRegistrySourceDetails({
        version: 1,
        sources: [],
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
        entries: {
          'claude-opus-4-6': {
            vendor: 'claude',
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4.6-20260201'],
            sources: [
              {
                sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
                siteId: 'site-1',
                siteName: 'Claude Site',
                accountId: 'acc-1',
                accountName: 'Main',
                sourceType: 'account',
                originalModel: 'claude-opus-4.6-20260201',
                vendor: 'claude',
                apiKeyGroups: ['team-beta'],
                userGroupKeys: ['team-beta'],
                firstSeenAt: 10,
                lastSeenAt: 10,
              },
            ],
            hasOverride: false,
            createdAt: 10,
            updatedAt: 40,
          },
        },
      })
    ).toBe(true);

    expect(
      shouldRefreshRegistrySourceDetails({
        version: 1,
        sources: [],
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
        entries: {
          'claude-opus-4-6': {
            vendor: 'claude',
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4.6-20260201'],
            sources: [
              {
                sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
                siteId: 'site-1',
                siteName: 'Claude Site',
                accountId: 'acc-1',
                accountName: 'Main',
                sourceType: 'account',
                originalModel: 'claude-opus-4.6-20260201',
                vendor: 'claude',
                apiKeyGroups: ['team-beta'],
                apiKeyNamesByGroup: {
                  'team-beta': ['main-key'],
                },
                userGroupKeys: ['team-beta'],
                availableUserGroups: ['team-beta'],
                availableApiKeys: [
                  {
                    apiKeyId: 'main-key-id',
                    apiKeyName: 'main-key',
                    accountId: 'acc-1',
                    accountName: 'Main',
                    group: 'team-beta',
                  },
                ],
                firstSeenAt: 10,
                lastSeenAt: 10,
              },
            ],
            hasOverride: false,
            createdAt: 10,
            updatedAt: 40,
          },
        },
      })
    ).toBe(false);
  });

  it('prefers persisted display items over re-deriving the vendor top three on every render', () => {
    const sections = buildVendorSections({
      version: 1,
      sources: [],
      overrides: [],
      vendorPriorities: {},
      entries: {
        'claude-team-opus': {
          vendor: 'claude',
          canonicalName: 'claude-team-opus',
          aliases: ['claude-opus-4.6-20260201'],
          sources: [],
          hasOverride: true,
          createdAt: 1,
          updatedAt: 4,
        },
        'claude-sonnet-4-6': {
          vendor: 'claude',
          canonicalName: 'claude-sonnet-4-6',
          aliases: ['claude-sonnet-4.6-20260201'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 3,
        },
        'claude-haiku-4-5': {
          vendor: 'claude',
          canonicalName: 'claude-haiku-4-5',
          aliases: ['claude-haiku-4.5-20251001'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 2,
        },
        'claude-labs-beta': {
          vendor: 'claude',
          canonicalName: 'claude-labs-beta',
          aliases: ['claude-3-5-sonnet-20250101'],
          sources: [],
          hasOverride: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      displayItems: [
        {
          id: 'manual:claude:1',
          vendor: 'claude',
          canonicalName: 'claude-team-opus',
          sourceKeys: ['site-1:acc-1:claude-opus-4.6-20260201'],
          originalModelOrder: ['claude-opus-4.6-20260201'],
          mode: 'manual',
          createdAt: 1,
          updatedAt: 4,
        },
      ],
    });

    const claudeSection = sections.find(section => section.vendor === 'claude');
    expect(claudeSection).toBeDefined();
    expect(claudeSection!.displayItems.map(entry => entry.displayName)).toEqual([
      'claude-team-opus',
    ]);
    expect(claudeSection!.summaryItems.map(entry => entry.displayName)).toEqual([]);
  });

  it('keeps non-top3 models available as source candidates without auto-creating redirect cards', () => {
    const sections = buildVendorSections({
      version: 1,
      sources: [
        {
          sourceKey: 'site-3:acc-3:gpt-5.4-latest',
          siteId: 'site-3',
          siteName: 'OpenAI Site',
          accountId: 'acc-3',
          accountName: 'Main',
          sourceType: 'account',
          originalModel: 'gpt-5.4-latest',
          vendor: 'gpt',
          firstSeenAt: 13,
          lastSeenAt: 13,
        },
        {
          sourceKey: 'site-3:acc-3:gpt-5-latest',
          siteId: 'site-3',
          siteName: 'OpenAI Site',
          accountId: 'acc-3',
          accountName: 'Main',
          sourceType: 'account',
          originalModel: 'gpt-5-latest',
          vendor: 'gpt',
          firstSeenAt: 14,
          lastSeenAt: 14,
        },
        {
          sourceKey: 'site-3:acc-3:o3-latest',
          siteId: 'site-3',
          siteName: 'OpenAI Site',
          accountId: 'acc-3',
          accountName: 'Main',
          sourceType: 'account',
          originalModel: 'o3-latest',
          vendor: 'gpt',
          firstSeenAt: 15,
          lastSeenAt: 15,
        },
        {
          sourceKey: 'site-3:acc-3:gpt-4.1-edge',
          siteId: 'site-3',
          siteName: 'OpenAI Site',
          accountId: 'acc-3',
          accountName: 'Main',
          sourceType: 'account',
          originalModel: 'gpt-4.1-edge',
          vendor: 'gpt',
          firstSeenAt: 16,
          lastSeenAt: 16,
        },
      ],
      overrides: [],
      vendorPriorities: {},
      entries: {
        'gpt-5.4': {
          vendor: 'gpt',
          canonicalName: 'gpt-5.4',
          aliases: ['gpt-5.4-latest'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 4,
        },
        'gpt-5': {
          vendor: 'gpt',
          canonicalName: 'gpt-5',
          aliases: ['gpt-5-latest'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 3,
        },
        o3: {
          vendor: 'gpt',
          canonicalName: 'o3',
          aliases: ['o3-latest'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      displayItems: [
        {
          id: 'seeded:gpt:0',
          vendor: 'gpt',
          canonicalName: 'gpt-5.4',
          sourceKeys: ['site-3:acc-3:gpt-5.4-latest'],
          originalModelOrder: ['gpt-5.4-latest'],
          mode: 'seeded',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'seeded:gpt:1',
          vendor: 'gpt',
          canonicalName: 'gpt-5',
          sourceKeys: ['site-3:acc-3:gpt-5-latest'],
          originalModelOrder: ['gpt-5-latest'],
          mode: 'seeded',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'seeded:gpt:2',
          vendor: 'gpt',
          canonicalName: 'o3',
          sourceKeys: ['site-3:acc-3:o3-latest'],
          originalModelOrder: ['o3-latest'],
          mode: 'seeded',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const gptSection = sections.find(section => section.vendor === 'gpt');
    expect(gptSection).toBeDefined();
    expect(gptSection!.displayItems.map(item => item.displayName)).toEqual([
      'gpt-5.4',
      'gpt-5',
      'o3',
    ]);
    expect(gptSection!.candidateGroups.map(candidate => candidate.originalModel)).toContain(
      'gpt-4.1-edge'
    );
  });
});
