import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ChromeManager } from './chrome-manager';
import { ApiService } from './api-service';
import { ConfigManager } from './config-manager';
import { TokenService } from './token-service';
import { TokenStorage } from './token-storage';

let mainWindow: BrowserWindow | null = null;
const chromeManager = new ChromeManager();
const configManager = new ConfigManager();
const tokenStorage = new TokenStorage();
const tokenService = new TokenService(chromeManager);
const apiService = new ApiService(tokenService, tokenStorage);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 开发环境加载Vite服务器
  mainWindow.loadURL('http://localhost:5173');
  
  // 打开开发者工具
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  chromeManager.cleanup();
  if (process.platform !== 'darwin') app.quit();
});

// IPC处理器
ipcMain.handle('load-config', async () => {
  return await configManager.loadConfig();
});

ipcMain.handle('save-config', async (_, config) => {
  return await configManager.saveConfig(config);
});

ipcMain.handle('launch-chrome-for-login', async (_, url: string) => {
  return await chromeManager.launchForLogin(url);
});

ipcMain.handle('get-cookies', async (_, url: string) => {
  return await chromeManager.getCookies(url);
});

ipcMain.handle('fetch-with-cookies', async (_, url: string, options: any) => {
  try {
    const axios = require('axios');
    const response = await axios({
      method: options.method || 'GET',
      url: url,
      headers: options.headers || {},
      timeout: 30000,
      validateStatus: () => true // 接受所有状态码
    });
    
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      data: response.data
    };
  } catch (error: any) {
    console.error('fetch-with-cookies错误:', error);
    return {
      ok: false,
      status: 0,
      statusText: error.message,
      data: null
    };
  }
});

ipcMain.handle('detect-site', async (_, site, timeout, quickRefresh = false, cachedData = undefined) => {
  return await apiService.detectSite(site, timeout, quickRefresh, cachedData);
});

ipcMain.handle('detect-all-sites', async (_, config, quickRefresh = false, cachedResults = undefined) => {
  return await apiService.detectAllSites(config, quickRefresh, cachedResults);
});

ipcMain.handle('open-url', async (_, url: string) => {
  await shell.openExternal(url);
});

// 新增：获取所有站点账号（含缓存数据）
ipcMain.handle('get-all-accounts', async () => {
  return await tokenStorage.getAllAccounts();
});

// ============= 令牌管理相关IPC处理器 =============

/**
 * 初始化站点账号（一次性从浏览器获取所有数据）
 */
ipcMain.handle('token:initialize-site', async (_, baseUrl: string) => {
  try {
    const siteAccount = await tokenService.initializeSiteAccount(baseUrl);
    return { success: true, data: siteAccount };
  } catch (error: any) {
    console.error('初始化站点失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 刷新显示数据（使用access_token获取余额、使用量等）
 */
ipcMain.handle('token:refresh-display-data', async (_, account: any) => {
  try {
    const result = await tokenService.refreshDisplayData(account);
    return { success: result.success, data: result.data, healthStatus: result.healthStatus };
  } catch (error: any) {
    console.error('刷新显示数据失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 验证令牌有效性
 */
ipcMain.handle('token:validate', async (_, account: any) => {
  try {
    const isValid = await tokenService.validateToken(account);
    return { success: true, data: { isValid } };
  } catch (error: any) {
    console.error('验证令牌失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取API令牌列表（用户创建的API keys）
 */
ipcMain.handle('token:fetch-api-tokens', async (_, baseUrl: string, userId: number, accessToken: string) => {
  try {
    console.log('📡 [IPC] 收到获取API令牌列表请求');
    const tokens = await tokenService.fetchApiTokens(baseUrl, userId, accessToken);
    return { success: true, data: tokens };
  } catch (error: any) {
    console.error('❌ [IPC] 获取API令牌列表失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取用户分组信息
 */
ipcMain.handle('token:fetch-user-groups', async (_, baseUrl: string, userId: number, accessToken: string) => {
  try {
    console.log('📊 [IPC] 收到获取用户分组请求');
    const result = await tokenService.fetchUserGroups(baseUrl, userId, accessToken);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('❌ [IPC] 获取用户分组失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取模型定价信息
 */
ipcMain.handle('token:fetch-model-pricing', async (_, baseUrl: string, userId: number, accessToken: string) => {
  try {
    console.log('💰 [IPC] 收到获取模型定价请求');
    const result = await tokenService.fetchModelPricing(baseUrl, userId, accessToken);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('❌ [IPC] 获取模型定价失败:', error);
    return { success: false, error: error.message };
  }
});

// ============= 账号存储相关IPC处理器 =============

/**
 * 获取所有账号
 */
ipcMain.handle('storage:get-all-accounts', async () => {
  try {
    const accounts = await tokenStorage.getAllAccounts();
    return { success: true, data: accounts };
  } catch (error: any) {
    console.error('获取账号列表失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 根据ID获取账号
 */
ipcMain.handle('storage:get-account', async (_, id: string) => {
  try {
    const account = await tokenStorage.getAccountById(id);
    return { success: true, data: account };
  } catch (error: any) {
    console.error('获取账号失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 保存账号
 */
ipcMain.handle('storage:save-account', async (_, account: any) => {
  try {
    // 如果没有ID，生成一个
    if (!account.id) {
      account.id = tokenStorage.generateId();
    }
    await tokenStorage.saveAccount(account);
    return { success: true, data: { id: account.id } };
  } catch (error: any) {
    console.error('保存账号失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 删除账号
 */
ipcMain.handle('storage:delete-account', async (_, id: string) => {
  try {
    const result = await tokenStorage.deleteAccount(id);
    return { success: result };
  } catch (error: any) {
    console.error('删除账号失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 更新账号令牌
 */
ipcMain.handle('storage:update-token', async (_, id: string, accessToken: string) => {
  try {
    const result = await tokenStorage.updateAccountToken(id, accessToken);
    return { success: result };
  } catch (error: any) {
    console.error('更新令牌失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 导出数据
 */
ipcMain.handle('storage:export', async () => {
  try {
    const data = await tokenStorage.exportData();
    return { success: true, data };
  } catch (error: any) {
    console.error('导出数据失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 导入数据
 */
ipcMain.handle('storage:import', async (_, data: any) => {
  try {
    await tokenStorage.importData(data);
    return { success: true };
  } catch (error: any) {
    console.error('导入数据失败:', error);
    return { success: false, error: error.message };
  }
});
