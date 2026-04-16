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
import type { ThemeMode } from '../shared/theme/themePresets';

contextBridge.exposeInMainWorld('electronAPI', {
  // 原有的API
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  sites: {
    add: (site: any) => ipcRenderer.invoke('sites:add', site),
    update: (id: string, updates: any) => ipcRenderer.invoke('sites:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('sites:delete', id),
  },
  launchChromeForLogin: (url: string) => ipcRenderer.invoke('launch-chrome-for-login', url),

  // 站点初始化状态事件监听
  onSiteInitStatus: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status);
    ipcRenderer.on('site-init-status', handler);
    return () => ipcRenderer.removeListener('site-init-status', handler);
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
  detectAllSites: (config: any, quickRefresh?: boolean, cachedResults?: any) =>
    ipcRenderer.invoke('detect-all-sites', config, quickRefresh, cachedResults),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts'),

  // 令牌管理API (重构后的新接口)
  token: {
    // 初始化站点账号（一次性从浏览器获取所有数据）
    initializeSite: (baseUrl: string) => ipcRenderer.invoke('token:initialize-site', baseUrl),
    // 初始化并保存为 AccountCredential（多账户流程）
    initializeAccount: (params: {
      siteId: string;
      baseUrl: string;
      accountName?: string;
      authSource: 'main_profile' | 'isolated_profile' | 'manual';
      profilePath?: string;
    }) => ipcRenderer.invoke('token:initialize-account', params),
    // 刷新显示数据（使用access_token获取余额、使用量等）
    refreshDisplayData: (account: any) => ipcRenderer.invoke('token:refresh-display-data', account),
    // 验证令牌有效性
    validate: (account: any) => ipcRenderer.invoke('token:validate', account),
    // 获取API令牌列表（兼容旧接口）
    fetchApiTokens: (baseUrl: string, userId: number, accessToken: string, accountId?: string) =>
      ipcRenderer.invoke('token:fetch-api-tokens', baseUrl, userId, accessToken, accountId),
    resolveApiKeyValue: (siteUrl: string, apiKeyId: string | number, accountId?: string) =>
      ipcRenderer.invoke('token:resolve-api-key-value', siteUrl, apiKeyId, accountId),
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

  // CLI 兼容性测试 API
  cliCompat: {
    // 使用真实 CLI wrapper 测试 CLI 兼容性
    testWithWrapper: (params: {
      siteUrl: string;
      configs: Array<{
        cliType: 'claudeCode' | 'codex' | 'geminiCli';
        apiKey: string;
        model: string;
        baseUrl?: string;
      }>;
    }) => ipcRenderer.invoke('cli-compat:test-with-wrapper', params),
    // 保存 CLI 兼容性结果到缓存
    saveResult: (siteUrl: string, result: any, accountId?: string) =>
      ipcRenderer.invoke('cli-compat:save-result', siteUrl, result, accountId),
    // 保存 CLI 配置
    saveConfig: (siteUrl: string, config: any, accountId?: string) =>
      ipcRenderer.invoke('cli-compat:save-config', siteUrl, config, accountId),
    // 写入 CLI 配置文件到文件系统
    writeConfig: (params: {
      cliType: 'claudeCode' | 'codex' | 'geminiCli';
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
      cliType: 'claudeCode' | 'codex' | 'geminiCli',
      sites: Array<{ id: string; name: string; url: string }>
    ) => ipcRenderer.invoke('detection:detect-cli-config', cliType, sites),
    // 检测所有 CLI 配置
    detectAllCliConfig: (sites: Array<{ id: string; name: string; url: string }>) =>
      ipcRenderer.invoke('detection:detect-all-cli-config', sites),
    // 清除 CLI 配置检测缓存
    clearCache: (cliType?: 'claudeCode' | 'codex' | 'geminiCli') =>
      ipcRenderer.invoke('detection:clear-cli-config-cache', cliType),
    // 重置 CLI 配置：删除本地配置文件
    resetCliConfig: (cliType: 'claudeCode' | 'codex' | 'geminiCli') =>
      ipcRenderer.invoke('detection:reset-cli-config', cliType),
    // 读取 CLI 配置文件内容
    readCliConfigFiles: (cliType: 'claudeCode' | 'codex' | 'geminiCli') =>
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

  // Linux Do Credit 积分检测 API
  credit: {
    // 获取积分数据
    fetch: () => ipcRenderer.invoke('credit:fetch'),
    // 获取每日统计数据
    fetchDailyStats: (days?: number) => ipcRenderer.invoke('credit:fetch-daily-stats', days),
    // 获取交易记录
    fetchTransactions: (page?: number, pageSize?: number) =>
      ipcRenderer.invoke('credit:fetch-transactions', page, pageSize),
    // 刷新所有数据（积分、每日统计、交易记录）- 在单个浏览器页面中完成
    refreshAll: () => ipcRenderer.invoke('credit:refresh-all'),
    // 启动登录
    login: () => ipcRenderer.invoke('credit:login'),
    // 登出
    logout: () => ipcRenderer.invoke('credit:logout'),
    // 获取登录状态
    getStatus: () => ipcRenderer.invoke('credit:get-status'),
    // 保存配置
    saveConfig: (config: any) => ipcRenderer.invoke('credit:save-config', config),
    // 加载配置
    loadConfig: () => ipcRenderer.invoke('credit:load-config'),
    // 获取缓存数据
    getCached: () => ipcRenderer.invoke('credit:get-cached'),
    // 获取缓存的每日统计数据
    getCachedDailyStats: () => ipcRenderer.invoke('credit:get-cached-daily-stats'),
    // 获取缓存的交易记录
    getCachedTransactions: () => ipcRenderer.invoke('credit:get-cached-transactions'),
    // 发起充值
    initiateRecharge: (request: { siteUrl: string; amount: number; token: string }) =>
      ipcRenderer.invoke('credit:initiate-recharge', request),
  },

  // 自定义 CLI 配置 API
  customCliConfig: {
    // 加载配置
    load: () => ipcRenderer.invoke('custom-cli-config:load'),
    // 保存配置
    save: (data: { configs: any[]; activeConfigId: string | null }) =>
      ipcRenderer.invoke('custom-cli-config:save', data),
    // 拉取模型列表
    fetchModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('custom-cli-config:fetch-models', baseUrl, apiKey),
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
      auth_source: string;
      browser_profile_path?: string;
    }) => ipcRenderer.invoke('accounts:add', data),
    update: (accountId: string, updates: any) =>
      ipcRenderer.invoke('accounts:update', accountId, updates),
    delete: (accountId: string) => ipcRenderer.invoke('accounts:delete', accountId),
  },

  // 浏览器 Profile 管理 API
  browserProfile: {
    detect: () => ipcRenderer.invoke('browser-profile:detect'),
    isChromeRunning: () => ipcRenderer.invoke('browser-profile:is-chrome-running'),
    loginMain: (siteUrl: string) => ipcRenderer.invoke('browser-profile:login-main', siteUrl),
    loginIsolated: (siteId: string, siteUrl: string, accountId: string) =>
      ipcRenderer.invoke('browser-profile:login-isolated', siteId, siteUrl, accountId),
    openSite: (siteId: string | undefined, siteUrl: string, accountId?: string) =>
      ipcRenderer.invoke('browser-profile:open-site', siteId, siteUrl, accountId),
    deleteProfile: (siteId: string, accountId: string) =>
      ipcRenderer.invoke('browser-profile:delete-profile', siteId, accountId),
  },

  // 路由代理 API
  route: {
    getConfig: () => ipcRenderer.invoke('route:get-config'),
    saveServerConfig: (updates: any) => ipcRenderer.invoke('route:save-server-config', updates),
    listRules: () => ipcRenderer.invoke('route:list-rules'),
    upsertRule: (rule: any) => ipcRenderer.invoke('route:upsert-rule', rule),
    deleteRule: (ruleId: string) => ipcRenderer.invoke('route:delete-rule', ruleId),
    listStats: () => ipcRenderer.invoke('route:list-stats'),
    resetStats: (ruleId?: string) => ipcRenderer.invoke('route:reset-stats', ruleId),
    getHealth: () => ipcRenderer.invoke('route:get-health'),
    runHealthCheck: () => ipcRenderer.invoke('route:run-health-check'),
    getRuntimeStatus: () => ipcRenderer.invoke('route:get-runtime-status'),
    startServer: () => ipcRenderer.invoke('route:start-server'),
    stopServer: () => ipcRenderer.invoke('route:stop-server'),
    regenerateApiKey: () => ipcRenderer.invoke('route:regenerate-api-key'),
    getModelRegistry: () => ipcRenderer.invoke('route:get-model-registry'),
    rebuildModelRegistry: (params?: { force?: boolean }) =>
      ipcRenderer.invoke('route:rebuild-model-registry', params),
    upsertModelMappingOverride: (override: any) =>
      ipcRenderer.invoke('route:upsert-model-mapping-override', override),
    deleteModelMappingOverride: (overrideId: string) =>
      ipcRenderer.invoke('route:delete-model-mapping-override', { overrideId }),
    saveCliModelSelections: (selections: any) =>
      ipcRenderer.invoke('route:save-cli-model-selections', { selections }),
    saveCliProbeConfig: (updates: any) =>
      ipcRenderer.invoke('route:save-cli-probe-config', updates),
    runCliProbeNow: (params?: any) => ipcRenderer.invoke('route:run-cli-probe-now', params),
    getCliProbeLatest: (params?: any) => ipcRenderer.invoke('route:get-cli-probe-latest', params),
    getCliProbeHistory: (params: any) => ipcRenderer.invoke('route:get-cli-probe-history', params),
    getCliProbeView: (params: any) => ipcRenderer.invoke('route:get-cli-probe-view', params),
    getAnalyticsSummary: (params: any) => ipcRenderer.invoke('route:get-analytics-summary', params),
    getAnalyticsDistribution: (params: any) =>
      ipcRenderer.invoke('route:get-analytics-distribution', params),
    resetAnalytics: (params?: any) => ipcRenderer.invoke('route:reset-analytics', params),
    fetchLatestLog: (params: { siteId: string; model?: string }) =>
      ipcRenderer.invoke('route:fetch-latest-log', params),
  },
});
