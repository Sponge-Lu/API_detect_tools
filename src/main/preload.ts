import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 原有的API
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  launchChromeForLogin: (url: string) => ipcRenderer.invoke('launch-chrome-for-login', url),
  // 主动关闭浏览器（用于添加站点后的自动刷新完成后关闭登录浏览器）
  closeBrowser: () => ipcRenderer.invoke('close-browser'),
  getCookies: (url: string) => ipcRenderer.invoke('get-cookies', url),
  fetchWithCookies: (url: string, options: any) => ipcRenderer.invoke('fetch-with-cookies', url, options),
  detectSite: (site: any, timeout: number, quickRefresh?: boolean, cachedData?: any) => 
    ipcRenderer.invoke('detect-site', site, timeout, quickRefresh, cachedData),
  detectAllSites: (config: any, quickRefresh?: boolean, cachedResults?: any) => 
    ipcRenderer.invoke('detect-all-sites', config, quickRefresh, cachedResults),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts'),
  
  // 令牌管理API (重构后的新接口)
  token: {
    // 初始化站点账号（一次性从浏览器获取所有数据）
    initializeSite: (baseUrl: string) =>
      ipcRenderer.invoke('token:initialize-site', baseUrl),
    // 刷新显示数据（使用access_token获取余额、使用量等）
    refreshDisplayData: (account: any) =>
      ipcRenderer.invoke('token:refresh-display-data', account),
    // 验证令牌有效性
    validate: (account: any) =>
      ipcRenderer.invoke('token:validate', account),
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
      ipcRenderer.invoke('token:check-in', baseUrl, userId, accessToken)
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
    import: (data: any) => ipcRenderer.invoke('storage:import', data)
  },
  
  // 从 token-storage.json 恢复站点配置
  recoverSitesFromStorage: () => ipcRenderer.invoke('recover-sites-from-storage')
});