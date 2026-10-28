import type { ElectronAPI } from '../shared/types/electron-api';
import type { StateVersion } from '../shared/types/app-storage-contract';
import { ROUTE_STABLE_COMMAND_CHANNELS } from '../shared/types/route-command-channels';

let routeVersion: StateVersion | undefined;
async function invokeRoute(channel: string, ...args: unknown[]): Promise<any> {
  const supplied = args.find(
    value => value && typeof value === 'object' && 'storageVersion' in value
  ) as { storageVersion?: StateVersion } | undefined;
  const expected = supplied?.storageVersion ?? routeVersion;
  const stable = ROUTE_STABLE_COMMAND_CHANNELS.includes(channel);
  const values = stable
    ? args.map(value =>
        value && typeof value === 'object' && !Array.isArray(value) && 'storageVersion' in value
          ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'storageVersion'))
          : value
      )
    : args;
  const result = await ipcRenderer.invoke(
    channel,
    ...values,
    ...(stable ? [{ storageVersion: expected }] : [])
  );
  if (result?.storageVersion) {
    routeVersion = result.storageVersion;
    if (channel === 'route:get-config' && result.data) {
      result.data.storageVersion = routeVersion;
      for (const rule of result.data.rules ?? []) rule.storageVersion = routeVersion;
    }
    const registry = Array.isArray(result.data?.displayItems)
      ? result.data
      : result.data?.modelRegistry;
    if (registry && typeof registry === 'object') {
      registry.storageVersion = routeVersion;
      for (const item of registry.displayItems ?? []) item.storageVersion = routeVersion;
    }
  }
  return result;
}
/**
 * 输入: Electron contextBridge, ipcRenderer
 * 输出: electronAPI 对象 (暴露给渲染进程的 IPC 接口)
 * 定位: 安全层 - 提供带上下文隔离的安全 IPC 接口
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { Config } from '../shared/types/renderer-config';
import { buildConfigCommands } from '../shared/types/config-commands';
import { generateSiteId } from '../shared/types/site';
import {
  buildCustomCliCommands,
  type CustomCliSnapshot,
} from '../shared/types/custom-cli-commands';

const directSnapshots = new Map<string, CustomCliSnapshot>();
async function loadDirectConfigs(): Promise<CustomCliSnapshot> {
  const data = await ipcRenderer.invoke('custom-cli-config:load');
  if (data.storageVersion)
    directSnapshots.set(JSON.stringify(data.storageVersion), structuredClone(data));
  if (directSnapshots.size > 32) directSnapshots.delete(directSnapshots.keys().next().value!);
  return data;
}
async function saveDirectConfigs(data: CustomCliSnapshot): Promise<unknown> {
  const before = directSnapshots.get(JSON.stringify(data.storageVersion));
  if (!before || !data.storageVersion)
    throw new Error('Direct configuration snapshot expired; reload before saving');
  const result = await ipcRenderer.invoke('custom-cli-config:commands', {
    version: data.storageVersion,
    commands: buildCustomCliCommands(before, data),
  });
  if (result.success && result.storageVersion)
    directSnapshots.set(
      JSON.stringify(result.storageVersion),
      structuredClone({ ...data, storageVersion: result.storageVersion })
    );
  return result;
}

const configSnapshots = new Map<string, Config>();
const snapshotKey = (config: Config) => JSON.stringify(config.storageVersion);
function rememberConfig(config: Config): Config {
  if (config.storageVersion) {
    configSnapshots.set(snapshotKey(config), structuredClone(config));
    if (configSnapshots.size > 32) configSnapshots.delete(configSnapshots.keys().next().value!);
  }
  return config;
}
async function saveConfigCommands(config: Config): Promise<Config> {
  const previous = configSnapshots.get(snapshotKey(config));
  if (!previous || !config.storageVersion)
    throw new Error('Configuration snapshot expired; reload before saving');
  for (const site of config.sites) site.id ||= generateSiteId();
  const result = await ipcRenderer.invoke('config:commands', {
    version: config.storageVersion,
    commands: buildConfigCommands(previous, config),
  });
  if (!result.success)
    throw Object.assign(new Error(result.error.message), {
      code: result.error.code,
      currentVersion: result.error.currentVersion,
    });
  rememberConfig(result.data);
  config.storageVersion = result.data.storageVersion;
  return result.data;
}
import type { ThemeMode } from '../shared/theme/themePresets';
import type {
  RouteAnalyticsWindowQuery,
  RoutePathStateResetParams,
  RouteRequestLogItem,
  RouteStateAffinitySummary,
  RouteSessionExtractionRule,
  RouteSessionOverride,
  RouteSessionRoutingConfig,
  RouteInstanceUpdate,
  RouteClientRoutingConfig,
  GlobalModelRoute,
} from '../shared/types/route-proxy';
import type { EndpointTestSelectionInput, EndpointTestTarget } from '../shared/types/endpoint-test';
import type { BrowserProfileOptionId } from '../shared/types/site';
import type {
  ConfigFileBackupInput,
  PreviewConfigFileBackupRestoreInput,
  CommitConfigFileProfileInput,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileDirectEditInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  RestoreBuiltinConfigFileProfileInput,
  SwitchBuiltinConfigFileProfileAuthModeInput,
  ResolveConfigFileProfileValuesInput,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from '../shared/types/config-file-profile';
import type { EnableDshSessionRoutingInput } from '../shared/types/dsh-integration';

const APP_DATA_CHANGED_EVENT = 'app-data:changed';
const ROUTE_REQUEST_LOG_APPENDED_EVENT = 'route:request-log-appended';

const electronAPI = {
  // 原有的API
  loadConfig: async () => rememberConfig(await ipcRenderer.invoke('load-config')),
  saveConfig: saveConfigCommands,
  sites: {
    add: (site: any) => ipcRenderer.invoke('sites:add', site),
    update: (id: string, updates: any) => ipcRenderer.invoke('sites:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('sites:delete', id),
    refreshAll: () => ipcRenderer.invoke('site:refreshAll'),
    checkinAll: () => ipcRenderer.invoke('site:checkinAll'),
  },
  launchChromeForLogin: (url: string) => ipcRenderer.invoke('launch-chrome-for-login', url),

  // 站点初始化状态事件监听
  onSiteInitStatus: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status);
    ipcRenderer.on('site-init-status', handler);
    return () => ipcRenderer.removeListener('site-init-status', handler);
  },
  appData: {
    onChanged: (
      callback: (payload: {
        domains: Array<'site-config' | 'site-overview' | 'route-overview' | 'config-file-profiles'>;
        emittedAt: number;
        restored?: boolean;
        generation?: string;
      }) => void
    ) => {
      const handler = (_event: any, payload: unknown) =>
        callback(
          (payload || {
            domains: [],
            emittedAt: Date.now(),
          }) as {
            domains: Array<
              'site-config' | 'site-overview' | 'route-overview' | 'config-file-profiles'
            >;
            emittedAt: number;
          }
        );
      ipcRenderer.on(APP_DATA_CHANGED_EVENT, handler);
      return () => ipcRenderer.removeListener(APP_DATA_CHANGED_EVENT, handler);
    },
  },
  // 主动关闭浏览器（用于添加站点后的自动刷新完成后关闭登录浏览器）
  closeBrowser: () => ipcRenderer.invoke('close-browser'),
  closeLoginBrowser: () => ipcRenderer.invoke('close-login-browser'),
  fetchWithCookies: (url: string, options: any) =>
    ipcRenderer.invoke('fetch-with-cookies', url, options),
  detectSite: (
    site: any,
    timeout: number,
    quickRefresh?: boolean,
    cachedData?: any,
    forceAcceptEmpty?: boolean,
    accountId?: string
  ) =>
    ipcRenderer.invoke(
      'detect-site',
      site,
      timeout,
      quickRefresh,
      cachedData,
      forceAcceptEmpty,
      accountId
    ),
  // 轻量级余额刷新（签到后使用）
  refreshBalanceOnly: (site: any, timeout: number, checkinStats?: any, accountId?: string) =>
    ipcRenderer.invoke('refresh-balance-only', site, timeout, checkinStats, accountId),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts'),

  // 令牌管理API (重构后的新接口)
  token: {
    // 初始化站点账号（一次性从浏览器获取所有数据）
    initializeSite: (baseUrl: string) => ipcRenderer.invoke('token:initialize-site', baseUrl),
    // 刷新显示数据（使用access_token获取余额、使用量等）
    refreshDisplayData: (account: any) => ipcRenderer.invoke('token:refresh-display-data', account),
    // 从浏览器登录态刷新账户基础信息（user_id / username / access_token）
    refreshAccountBasicInfo: (accountId: string) =>
      ipcRenderer.invoke('token:refresh-account-basic-info', accountId),
    // 验证令牌有效性
    validate: (account: any) => ipcRenderer.invoke('token:validate', account),
    // 获取API令牌列表（兼容旧接口）
    fetchApiTokens: (baseUrl: string, userId: number, accessToken: string, accountId?: string) =>
      ipcRenderer.invoke('token:fetch-api-tokens', baseUrl, userId, accessToken, accountId),
    resolveApiKeyValue: (siteUrl: string, apiKeyId: string | number, accountId?: string) =>
      ipcRenderer.invoke('token:resolve-api-key-value', siteUrl, apiKeyId, accountId),
    listLocalApiKeys: (accountId: string) =>
      ipcRenderer.invoke('token:list-local-api-keys', accountId),
    addLocalApiKey: (accountId: string, input: any) =>
      ipcRenderer.invoke('token:add-local-api-key', accountId, input),
    updateLocalApiKey: (accountId: string, keyId: string, input: any) =>
      ipcRenderer.invoke('token:update-local-api-key', accountId, keyId, input),
    deleteLocalApiKey: (accountId: string, keyId: string) =>
      ipcRenderer.invoke('token:delete-local-api-key', accountId, keyId),
    revealLocalApiKey: (accountId: string, keyId: string) =>
      ipcRenderer.invoke('token:reveal-local-api-key', accountId, keyId),
    refreshLocalApiKeys: (accountId: string, baseUrl: string, keyId?: string) =>
      ipcRenderer.invoke('token:refresh-local-api-keys', accountId, baseUrl, keyId),
    // 获取用户分组（兼容旧接口）
    fetchUserGroups: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:fetch-user-groups', baseUrl, userId, accessToken),
    // 获取模型定价（兼容旧接口）
    fetchModelPricing: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:fetch-model-pricing', baseUrl, userId, accessToken),
    // 创建新的 API 令牌
    createApiToken: (
      baseUrl: string,
      userId: number,
      accessToken: string,
      tokenData: any,
      accountId?: string
    ) =>
      ipcRenderer.invoke(
        'token:create-api-token',
        baseUrl,
        userId,
        accessToken,
        tokenData,
        accountId
      ),
    // 删除 API 令牌
    deleteApiToken: (
      baseUrl: string,
      userId: number,
      accessToken: string,
      tokenIdentifier: any,
      accountId?: string
    ) =>
      ipcRenderer.invoke(
        'token:delete-api-token',
        baseUrl,
        userId,
        accessToken,
        tokenIdentifier,
        accountId
      ),
    // 执行签到
    checkIn: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:check-in', baseUrl, userId, accessToken),
  },

  // 签到并刷新余额（原子操作，复用浏览器页面）
  checkinAndRefresh: (site: any, timeout: number, accountId?: string) =>
    ipcRenderer.invoke('checkin-and-refresh', site, timeout, accountId),

  // 账号存储API
  storage: {
    getAllAccounts: () => ipcRenderer.invoke('storage:get-all-accounts'),
    getAccount: (id: string) => ipcRenderer.invoke('storage:get-account', id),
    saveAccount: (account: any) => ipcRenderer.invoke('storage:save-account', account),
    deleteAccount: (id: string) => ipcRenderer.invoke('storage:delete-account', id),
    updateToken: (id: string, token: string) =>
      ipcRenderer.invoke('storage:update-token', id, token),
    export: () => ipcRenderer.invoke('storage:export'),
    import: (data: any) => ipcRenderer.invoke('storage:import', data),
  },

  // 备份管理 API
  backup: {
    // 列出所有备份
    list: () => ipcRenderer.invoke('backup:list'),
    // 获取备份目录路径
    getDir: () => ipcRenderer.invoke('backup:get-dir'),
    // 获取最新备份时间
    getLatestTime: () => ipcRenderer.invoke('backup:get-latest-time'),
    // 手动触发备份
    manual: () => ipcRenderer.invoke('backup:manual'),
    // 导出 portable 可迁移配置包（config.json + custom-cli-configs.json）
    exportPackage: (includeSecrets = false) =>
      ipcRenderer.invoke('backup:export-config-package', includeSecrets),
    // 导入 portable / full-manifest / legacy config-only 配置包
    importPackage: (content: string) => ipcRenderer.invoke('backup:import-config-package', content),
    // 从备份恢复配置
    restoreConfig: (backupFileName: string) =>
      ipcRenderer.invoke('backup:restore-config', backupFileName),
    // 打开备份目录
    openDir: () => ipcRenderer.invoke('backup:open-dir'),
  },

  // 主题设置 API
  theme: {
    // 保存主题设置到主进程存储（用于下次启动时设置窗口背景色）
    save: (themeMode: ThemeMode) => ipcRenderer.invoke('theme:save', themeMode),
    // 加载保存的主题设置
    load: () => ipcRenderer.invoke('theme:load'),
  },

  // WebDAV 备份 API
  webdav: {
    // 测试 WebDAV 连接
    testConnection: (config: any) => ipcRenderer.invoke('webdav:test-connection', config),
    // 上传备份到 WebDAV
    uploadBackup: () => ipcRenderer.invoke('webdav:upload-backup'),
    // 列出 WebDAV 备份
    listBackups: () => ipcRenderer.invoke('webdav:list-backups'),
    // 删除 WebDAV 备份
    deleteBackup: (filename: string) => ipcRenderer.invoke('webdav:delete-backup', filename),
    // 恢复 WebDAV 备份
    restoreBackup: (filename: string) => ipcRenderer.invoke('webdav:restore-backup', filename),
    // 保存 WebDAV 配置
    saveConfig: (config: any) => ipcRenderer.invoke('webdav:save-config', config),
    // 获取 WebDAV 配置
    getConfig: () => ipcRenderer.invoke('webdav:get-config'),
  },

  // 软件更新 API
  update: {
    // 检查更新
    check: () => ipcRenderer.invoke('update:check'),
    // 获取当前版本
    getCurrentVersion: () => ipcRenderer.invoke('update:get-current-version'),
    // 打开下载链接
    openDownload: (url: string) => ipcRenderer.invoke('update:open-download', url),
    // 获取更新设置
    getSettings: () => ipcRenderer.invoke('update:get-settings'),
    // 保存更新设置
    saveSettings: (settings: any) => ipcRenderer.invoke('update:save-settings', settings),
    // 开始下载更新
    startDownload: (url: string) => ipcRenderer.invoke('update:start-download', url),
    // 取消下载
    cancelDownload: () => ipcRenderer.invoke('update:cancel-download'),
    // 安装更新
    installUpdate: (filePath: string) => ipcRenderer.invoke('update:install', filePath),
    // 监听下载进度
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('update:download-progress', listener);
      // 返回清理函数
      return () => ipcRenderer.removeListener('update:download-progress', listener);
    },
  },

  // CLI 配置保存 API
  cliCompat: {
    // 保存 CLI 配置
    saveConfig: (siteUrl: string, config: any, accountId?: string) =>
      ipcRenderer.invoke('cli-compat:save-config', siteUrl, config, accountId),
    // 写入 CLI 配置文件到文件系统
    writeConfig: (params: {
      cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild';
      files: Array<{
        path: string;
        content: string;
      }>;
      applyMode?: 'merge' | 'overwrite';
    }) => ipcRenderer.invoke('cli-compat:write-config', params),
  },

  // CLI 配置检测 API
  configDetection: {
    // 检测单个 CLI 配置
    detectCliConfig: (
      cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild',
      sites: Array<{ id: string; name: string; url: string }>
    ) => ipcRenderer.invoke('detection:detect-cli-config', cliType, sites),
    // 检测所有 CLI 配置
    detectAllCliConfig: (sites: Array<{ id: string; name: string; url: string }>) =>
      ipcRenderer.invoke('detection:detect-all-cli-config', sites),
    // 清除 CLI 配置检测缓存
    clearCache: (cliType?: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') =>
      ipcRenderer.invoke('detection:clear-cli-config-cache', cliType),
    // 重置 CLI 配置：删除本地配置文件
    resetCliConfig: (cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') =>
      ipcRenderer.invoke('detection:reset-cli-config', cliType),
    // 读取 CLI 配置文件内容
    readCliConfigFiles: (cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') =>
      ipcRenderer.invoke('detection:read-cli-config-files', cliType),
    // 保存单个 CLI 配置文件
    saveCliConfigFile: (absolutePath: string, content: string) =>
      ipcRenderer.invoke('detection:save-cli-config-file', absolutePath, content),
  },

  // 窗口关闭行为 API
  closeBehavior: {
    // 获取当前设置
    getSettings: () => ipcRenderer.invoke('close-behavior:get-settings'),
    // 保存设置
    saveSettings: (settings: { behavior: 'ask' | 'quit' | 'minimize' }) =>
      ipcRenderer.invoke('close-behavior:save-settings', settings),
    // 监听显示对话框事件
    onShowDialog: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('close-behavior:show-dialog', handler);
      return () => ipcRenderer.removeListener('close-behavior:show-dialog', handler);
    },
    // 响应对话框选择
    respondToDialog: (response: { action: 'quit' | 'minimize'; remember: boolean }) =>
      ipcRenderer.invoke('close-behavior:dialog-response', response),
    // 最小化到托盘
    minimizeToTray: () => ipcRenderer.invoke('close-behavior:minimize-to-tray'),
    // 退出应用
    quitApp: () => ipcRenderer.invoke('close-behavior:quit-app'),
  },

  // 自定义 CLI 配置 API
  customCliConfig: {
    // 加载配置
    load: loadDirectConfigs,
    // 保存配置
    save: saveDirectConfigs,
    // 拉取模型列表（通过 configId，走 httpGet 接入系统代理）
    fetchModels: (configId: string) =>
      ipcRenderer.invoke('custom-cli-config:fetch-models', configId),
  },
  configFileProfiles: {
    load: () => ipcRenderer.invoke('config-file-profile:load'),
    upsert: (input: UpsertConfigFileProfileInput) =>
      ipcRenderer.invoke('config-file-profile:upsert', input),
    delete: (input: DeleteConfigFileProfileInput) =>
      ipcRenderer.invoke('config-file-profile:delete', input),
    generateRouteKey: (input: GenerateConfigFileProfileRouteKeyInput) =>
      ipcRenderer.invoke('config-file-profile:generate-route-key', input),
    getTargetCatalog: () => ipcRenderer.invoke('config-file-profile:target-catalog'),
    resolveValues: (input: ResolveConfigFileProfileValuesInput) =>
      ipcRenderer.invoke('config-file-profile:resolve-values', input),
    restoreBuiltin: (input: RestoreBuiltinConfigFileProfileInput) =>
      ipcRenderer.invoke('config-file-profile:restore-builtin', input),
    restoreMissingBuiltins: () =>
      ipcRenderer.invoke('config-file-profile:restore-missing-builtins'),
    switchAuthMode: (input: SwitchBuiltinConfigFileProfileAuthModeInput) =>
      ipcRenderer.invoke('config-file-profile:switch-auth-mode', input),
    readFiles: (profileId: string) =>
      ipcRenderer.invoke('config-file-profile:read-files', profileId),
    listBackups: (input: ConfigFileBackupInput) =>
      ipcRenderer.invoke('config-file-profile:list-backups', input),
    previewBackupRestore: (input: PreviewConfigFileBackupRestoreInput) =>
      ipcRenderer.invoke('config-file-profile:preview-backup-restore', input),
    preview: (input: PreviewConfigFileProfileInput) =>
      ipcRenderer.invoke('config-file-profile:preview', input),
    previewRouteKeyRotation: (input: PreviewConfigFileProfileRouteKeyRotationInput) =>
      ipcRenderer.invoke('config-file-profile:preview-route-key-rotation', input),
    previewDirectEdit: (input: PreviewConfigFileDirectEditInput) =>
      ipcRenderer.invoke('config-file-profile:preview-direct-edit', input),
    commit: (input: CommitConfigFileProfileInput) =>
      ipcRenderer.invoke('config-file-profile:commit', input),
    validateSessionRecord: (input: ValidateSessionRecordConnectorInput) =>
      ipcRenderer.invoke('config-file-profile:validate-session-record', input),
  },

  // DeepSeek Harness 会话级路由接入
  dshIntegration: {
    status: () => ipcRenderer.invoke('dsh-integration:status'),
    modelSources: () => ipcRenderer.invoke('dsh-integration:model-sources'),
    enable: (input: EnableDshSessionRoutingInput) =>
      ipcRenderer.invoke('dsh-integration:enable', input),
    rollback: () => ipcRenderer.invoke('dsh-integration:rollback'),
    migrateSessions: () => ipcRenderer.invoke('dsh-integration:migrate-sessions'),
  },

  // 多账户管理 API
  accounts: {
    list: (siteId: string) => ipcRenderer.invoke('accounts:list', siteId),
    add: (data: {
      site_id: string;
      account_name: string;
      user_id: string;
      username?: string;
      access_token: string;
      api_key?: string;
      auth_source: string;
      browser_profile_path?: string;
      automation_slot?: number;
      anyRouterConfig?: { userHash?: string };
    }) => ipcRenderer.invoke('accounts:add', data),
    update: (accountId: string, updates: any) =>
      ipcRenderer.invoke('accounts:update', accountId, updates),
    delete: (accountId: string) => ipcRenderer.invoke('accounts:delete', accountId),
  },

  // 浏览器 Profile 管理 API
  browserProfile: {
    detect: () => ipcRenderer.invoke('browser-profile:detect'),
    isChromeRunning: () => ipcRenderer.invoke('browser-profile:is-chrome-running'),
    listAccountOptions: (siteId: string, accountId: string) =>
      ipcRenderer.invoke('browser-profile:list-account-options', siteId, accountId),
    bindAccount: (siteId: string, accountId: string, optionId: BrowserProfileOptionId) =>
      ipcRenderer.invoke('browser-profile:bind-account', siteId, accountId, optionId),
    loginMain: (siteUrl: string) => ipcRenderer.invoke('browser-profile:login-main', siteUrl),
    loginIsolated: (siteId: string, siteUrl: string, accountId: string) =>
      ipcRenderer.invoke('browser-profile:login-isolated', siteId, siteUrl, accountId),
    openSite: (siteId: string | undefined, siteUrl: string, accountId?: string) =>
      ipcRenderer.invoke('browser-profile:open-site', siteId, siteUrl, accountId),
    openSiteForCheckin: (siteId: string | undefined, siteUrl: string, accountId?: string) =>
      ipcRenderer.invoke('browser-profile:open-site-for-checkin', siteId, siteUrl, accountId),
    persistCheckinCompletion: (
      siteId: string | undefined,
      accountId: string | undefined,
      cachedData: {
        last_refresh?: number;
        has_checkin?: boolean;
        can_check_in?: boolean;
        checkin_stats?: {
          today_quota?: number;
          checkin_count?: number;
          total_checkins?: number;
          site_type?: 'veloera' | 'newapi';
        };
      }
    ) =>
      ipcRenderer.invoke(
        'browser-profile:persist-checkin-completion',
        siteId,
        accountId,
        cachedData
      ),
    deleteProfile: (siteId: string, accountId: string) =>
      ipcRenderer.invoke('browser-profile:delete-profile', siteId, accountId),
  },

  endpointTest: {
    getState: (target: EndpointTestTarget) => ipcRenderer.invoke('endpoint-test:get-state', target),
    saveSelection: (input: EndpointTestSelectionInput) =>
      ipcRenderer.invoke('endpoint-test:save-selection', input),
    run: (input: EndpointTestSelectionInput) => ipcRenderer.invoke('endpoint-test:run', input),
  },

  // 路由代理 API
  route: {
    getConfig: () => invokeRoute('route:get-config'),
    saveServerConfig: (updates: any) => invokeRoute('route:save-server-config', updates),
    listRules: () => invokeRoute('route:list-rules'),
    upsertRule: (rule: any) => invokeRoute('route:upsert-rule', rule),
    deleteRule: (ruleId: string) => invokeRoute('route:delete-rule', ruleId),
    listStats: () => invokeRoute('route:list-stats'),
    resetStats: (ruleId?: string) => invokeRoute('route:reset-stats', ruleId),
    resetPathStates: (params?: RoutePathStateResetParams) =>
      invokeRoute('route:reset-path-states', params),
    getRuntimeStatus: () => invokeRoute('route:get-runtime-status'),
    startServer: () => invokeRoute('route:start-server'),
    stopServer: () => invokeRoute('route:stop-server'),
    regenerateApiKey: () => invokeRoute('route:regenerate-api-key'),
    getModelRegistry: () => invokeRoute('route:get-model-registry'),
    refreshModelMetadata: () => invokeRoute('route:refresh-model-metadata'),
    onModelMetadataUpdated: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('route:model-metadata-updated', handler);
      return () => ipcRenderer.removeListener('route:model-metadata-updated', handler);
    },
    rebuildModelRegistry: (params?: { force?: boolean }) =>
      invokeRoute('route:rebuild-model-registry', params),
    syncModelRegistrySources: (params?: { force?: boolean }) =>
      invokeRoute('route:sync-model-registry-sources', params),
    upsertModelMappingOverride: (override: any) =>
      invokeRoute('route:upsert-model-mapping-override', override),
    upsertModelDisplayItem: (displayItem: any) =>
      invokeRoute('route:upsert-model-display-item', displayItem),
    deleteModelDisplayItem: (displayItemId: string) =>
      invokeRoute('route:delete-model-display-item', { displayItemId }),
    deleteModelMappingOverride: (overrideId: string) =>
      invokeRoute('route:delete-model-mapping-override', { overrideId }),
    saveCliModelSelections: (selections: any) =>
      invokeRoute('route:save-cli-model-selections', { selections }),
    saveCliThinkingEffortSelections: (selections: any) =>
      invokeRoute('route:save-cli-thinking-effort-selections', { selections }),
    listSessions: (scope?: 'active' | 'recent' | 'history' | 'all') =>
      invokeRoute('route:list-sessions', scope),
    listRouteInstances: () => invokeRoute('route:list-route-instances'),
    updateClientRouting: (profileId: string, updates: Partial<RouteClientRoutingConfig>) =>
      invokeRoute('route:update-client-routing', profileId, updates),
    upsertGlobalModelRoute: (
      id: string | undefined,
      updates: Partial<Omit<GlobalModelRoute, 'id'>>
    ) => invokeRoute('route:upsert-global-model-route', id, updates),
    deleteGlobalModelRoute: (id: string) => invokeRoute('route:delete-global-model-route', id),
    createArmedRouteInstance: (input: { modelId?: string; reasoningEffort?: string }) =>
      invokeRoute('route:create-armed-route-instance', input),
    updateRouteInstance: (instanceId: string, updates: RouteInstanceUpdate) =>
      invokeRoute('route:update-route-instance', instanceId, updates),
    closeRouteInstance: (instanceId: string) =>
      invokeRoute('route:close-route-instance', instanceId),
    cancelArmedRouteInstance: (instanceId: string) =>
      invokeRoute('route:cancel-armed-route-instance', instanceId),
    archiveRouteInstance: (instanceId: string) =>
      invokeRoute('route:archive-route-instance', instanceId),
    restoreRouteInstance: (instanceId: string) =>
      invokeRoute('route:restore-route-instance', instanceId),
    upsertSessionOverride: (override: RouteSessionOverride) =>
      invokeRoute('route:upsert-session-override', override),
    deleteSessionOverride: (key: string) => invokeRoute('route:delete-session-override', key),
    previewProfileStateClear: (profileId: string) =>
      invokeRoute('route:preview-profile-state-clear', profileId) as Promise<{
        success: boolean;
        data?: RouteStateAffinitySummary;
        error?: string;
      }>,
    clearProfileState: (profileId: string) =>
      invokeRoute('route:clear-profile-state', profileId) as Promise<{
        success: boolean;
        data?: { removed: number };
        error?: string;
      }>,
    clearSessionActivity: (key?: string) => invokeRoute('route:clear-session-activity', key),
    listSessionRules: () => invokeRoute('route:list-session-rules'),
    upsertSessionRule: (rule: RouteSessionExtractionRule) =>
      invokeRoute('route:upsert-session-rule', rule),
    deleteSessionRule: (ruleId: string) => invokeRoute('route:delete-session-rule', ruleId),
    rollbackSessionRule: (ruleId: string, version: number) =>
      invokeRoute('route:rollback-session-rule', ruleId, version),
    listSessionCandidates: () => invokeRoute('route:list-session-candidates'),
    updateSessionSettings: (
      settings: Partial<
        Pick<
          RouteSessionRoutingConfig,
          | 'activeWindowMinutes'
          | 'recentWindowHours'
          | 'historyRetentionDays'
          | 'overrideRetentionDays'
        >
      >
    ) => invokeRoute('route:update-session-settings', settings),
    getAnalyticsSummary: (params: RouteAnalyticsWindowQuery) =>
      invokeRoute('route:get-analytics-summary', params),
    getAnalyticsDistribution: (params: RouteAnalyticsWindowQuery) =>
      invokeRoute('route:get-analytics-distribution', params),
    getAnalyticsOverview: (params: RouteAnalyticsWindowQuery) =>
      invokeRoute('route:get-analytics-overview', params),
    getObjectStats: (params: unknown) => invokeRoute('route:get-object-stats', params),
    resetAnalytics: (params?: any) => invokeRoute('route:reset-analytics', params),
    getRequestLogs: (params?: any) => invokeRoute('route:get-request-logs', params),
    clearRequestLogs: () => invokeRoute('route:clear-request-logs'),
    onRequestLogAppended: (callback: (item: RouteRequestLogItem) => void) => {
      const handler = (_event: any, item: RouteRequestLogItem) => callback(item);
      ipcRenderer.on(ROUTE_REQUEST_LOG_APPENDED_EVENT, handler);
      return () => ipcRenderer.removeListener(ROUTE_REQUEST_LOG_APPENDED_EVENT, handler);
    },
    fetchLatestLog: (params: { siteId: string; model?: string }) =>
      invokeRoute('route:fetch-latest-log', params),
    getHistoryBuckets: (query: {
      window: '48h';
      bucketSize: '2h';
      siteId?: string;
      accountId?: string;
    }) => invokeRoute('route:getHistoryBuckets', query),
  },
  overview: {
    getSiteDailySnapshots: (params?: { siteId?: string; days?: number }) =>
      ipcRenderer.invoke('overview:get-site-daily-snapshots', params),
  },

  // AnyRouter API
  anyrouter: {
    // 自动提取单个账户的 user hash
    extractUserHash: (params: { siteId: string; accountId: string }) =>
      ipcRenderer.invoke('anyrouter:extractUserHash', params),
    // 批量提取站点所有账户的 user hash
    extractAllUserHashes: (params: { siteId: string }) =>
      ipcRenderer.invoke('anyrouter:extractAllUserHashes', params),
  },
};
const bridge: ElectronAPI = electronAPI;
contextBridge.exposeInMainWorld('electronAPI', bridge);
