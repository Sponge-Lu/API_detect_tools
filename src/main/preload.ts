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

contextBridge.exposeInMainWorld('electronAPI', {
  // 原有的API
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  launchChromeForLogin: (url: string) => ipcRenderer.invoke('launch-chrome-for-login', url),

  // 站点初始化状态事件监听
  onSiteInitStatus: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status);
    ipcRenderer.on('site-init-status', handler);
    return () => ipcRenderer.removeListener('site-init-status', handler);
  },
  // 主动关闭浏览器（用于添加站点后的自动刷新完成后关闭登录浏览器）
  closeBrowser: () => ipcRenderer.invoke('close-browser'),
  fetchWithCookies: (url: string, options: any) =>
    ipcRenderer.invoke('fetch-with-cookies', url, options),
  detectSite: (
    site: any,
    timeout: number,
    quickRefresh?: boolean,
    cachedData?: any,
    forceAcceptEmpty?: boolean
  ) => ipcRenderer.invoke('detect-site', site, timeout, quickRefresh, cachedData, forceAcceptEmpty),
  detectAllSites: (config: any, quickRefresh?: boolean, cachedResults?: any) =>
    ipcRenderer.invoke('detect-all-sites', config, quickRefresh, cachedResults),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts'),

  // 令牌管理API (重构后的新接口)
  token: {
    // 初始化站点账号（一次性从浏览器获取所有数据）
    initializeSite: (baseUrl: string) => ipcRenderer.invoke('token:initialize-site', baseUrl),
    // 刷新显示数据（使用access_token获取余额、使用量等）
    refreshDisplayData: (account: any) => ipcRenderer.invoke('token:refresh-display-data', account),
    // 验证令牌有效性
    validate: (account: any) => ipcRenderer.invoke('token:validate', account),
    // 获取API令牌列表（兼容旧接口）
    fetchApiTokens: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:fetch-api-tokens', baseUrl, userId, accessToken),
    // 获取用户分组（兼容旧接口）
    fetchUserGroups: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:fetch-user-groups', baseUrl, userId, accessToken),
    // 获取模型定价（兼容旧接口）
    fetchModelPricing: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:fetch-model-pricing', baseUrl, userId, accessToken),
    // 创建新的 API 令牌
    createApiToken: (baseUrl: string, userId: number, accessToken: string, tokenData: any) =>
      ipcRenderer.invoke('token:create-api-token', baseUrl, userId, accessToken, tokenData),
    // 删除 API 令牌
    deleteApiToken: (baseUrl: string, userId: number, accessToken: string, tokenIdentifier: any) =>
      ipcRenderer.invoke('token:delete-api-token', baseUrl, userId, accessToken, tokenIdentifier),
    // 执行签到
    checkIn: (baseUrl: string, userId: number, accessToken: string) =>
      ipcRenderer.invoke('token:check-in', baseUrl, userId, accessToken),
  },

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
    save: (themeMode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:save', themeMode),
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
  },

  // CLI 兼容性测试 API
  cliCompat: {
    // 使用配置测试 CLI 兼容性
    testWithConfig: (params: {
      siteUrl: string;
      configs: Array<{
        cliType: 'claudeCode' | 'codex' | 'geminiCli';
        apiKey: string;
        model: string;
      }>;
    }) => ipcRenderer.invoke('cli-compat:test-with-config', params),
    // 保存 CLI 兼容性结果到缓存
    saveResult: (siteUrl: string, result: any) =>
      ipcRenderer.invoke('cli-compat:save-result', siteUrl, result),
    // 保存 CLI 配置
    saveConfig: (siteUrl: string, config: any) =>
      ipcRenderer.invoke('cli-compat:save-config', siteUrl, config),
    // 写入 CLI 配置文件到文件系统
    writeConfig: (params: {
      cliType: 'claudeCode' | 'codex';
      files: Array<{
        path: string;
        content: string;
      }>;
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
});
