import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { ChromeManager } from './chrome-manager';
import { ApiService } from './api-service';
import { ConfigManager } from './config-manager';
import { TokenService } from './token-service';
import { TokenStorage } from './token-storage';

// 设置Windows控制台编码为UTF-8，解决中文乱码问题
if (os.platform() === 'win32') {
  process.env['PYTHONIOENCODING'] = 'utf-8';
  // 尝试设置控制台代码页为UTF-8
  try {
    const { execSync } = require('child_process');
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {
    // 忽略错误
  }
}

let mainWindow: BrowserWindow | null = null;
const chromeManager = new ChromeManager();
const configManager = new ConfigManager();
const tokenStorage = new TokenStorage();
const tokenService = new TokenService(chromeManager);
const apiService = new ApiService(tokenService, tokenStorage);

async function createWindow() {
  // 根据环境选择合适的图标，打包后从 resources 目录读取 ico 文件
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.png');
  
  console.log('📍 图标路径:', iconPath);
  console.log('📦 是否已打包:', app.isPackaged);
  
  mainWindow = new BrowserWindow({
    // 默认窗口宽度调整为 1280，兼顾多列统计信息展示与常见屏幕适配
    width: 1280,
    height: 800,
    title: 'API Hub Management Tools',
    // 无论开发还是生产都显式指定窗口图标，防止 EXE 默认图标被沿用
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 完全移除菜单栏
  mainWindow.setMenu(null);

  // 根据环境加载不同的URL
  if (app.isPackaged) {
    // 生产环境：加载打包后的HTML文件
    await mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  } else {
    // 开发环境：尝试多个常用端口，避免5173被占用时出现空白
    const ports = [5173, 5174, 5175];
    let loaded = false;
    for (const p of ports) {
      const url = `http://localhost:${p}`;
      try {
        await mainWindow.loadURL(url);
        loaded = true;
        break;
      } catch (e) {
        console.warn(`[Dev] 加载失败，尝试下一个端口: ${url}`);
      }
    }
    if (!loaded) {
      // 如果都失败，仍尝试默认端口，便于调试
      await mainWindow.loadURL('http://localhost:5173');
    }
    // 开发环境可按需打开开发者工具
    // mainWindow.webContents.openDevTools();
  }
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

/**
 * 主动关闭浏览器（登录/检测完成后调用）
 * 说明：
 * - 内部会检查引用计数，只有在 browserRefCount === 0 时才会真正关闭浏览器
 * - 如果正在被其他检测任务使用，则本次调用会被忽略
 */
ipcMain.handle('close-browser', async () => {
  try {
    chromeManager.cleanup();
  } catch (error: any) {
    console.error('❌ [IPC] 关闭浏览器失败:', error?.message || error);
  }
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
 * 创建新的 API 令牌
 */
ipcMain.handle('token:create-api-token', async (_, baseUrl: string, userId: number, accessToken: string, tokenData: any) => {
  try {
    console.log('🆕 [IPC] 收到创建 API 令牌请求');
    const result = await tokenService.createApiToken(baseUrl, userId, accessToken, tokenData);
    return { success: result.success, data: result.data };
  } catch (error: any) {
    console.error('❌ [IPC] 创建 API 令牌失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 删除 API 令牌
 */
ipcMain.handle('token:delete-api-token', async (_, baseUrl: string, userId: number, accessToken: string, tokenIdentifier: any) => {
  try {
    console.log('🗑 [IPC] 收到删除 API 令牌请求');
    const result = await tokenService.deleteApiToken(baseUrl, userId, accessToken, tokenIdentifier);
    return { success: result.success, data: result.data };
  } catch (error: any) {
    console.error('❌ [IPC] 删除 API 令牌失败:', error);
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

/**
 * 执行签到
 */
ipcMain.handle('token:check-in', async (_, baseUrl: string, userId: number, accessToken: string) => {
  try {
    console.log('📝 [IPC] 收到签到请求');
    const result = await tokenService.checkIn(baseUrl, userId, accessToken);
    return result;
  } catch (error: any) {
    console.error('❌ [IPC] 签到失败:', error);
    return { success: false, message: error.message };
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

/**
 * 从 token-storage.json 恢复站点配置到 config.json
 * 用于配置文件丢失时恢复站点列表
 */
ipcMain.handle('recover-sites-from-storage', async () => {
  try {
    console.log('🔄 [IPC] 开始从 token-storage.json 恢复站点配置...');
    
    // 获取所有账号
    const accounts = await tokenStorage.getAllAccounts();
    
    if (!accounts || accounts.length === 0) {
      return { success: false, error: 'token-storage.json 中没有账号数据' };
    }
    
    console.log(`📦 [IPC] 找到 ${accounts.length} 个账号，开始恢复...`);
    
    // 加载当前配置
    const currentConfig = await configManager.loadConfig();
    
    // 从账号数据恢复站点配置
    const recoveredSites: any[] = [];
    
    for (const account of accounts) {
      // 检查是否已存在相同 URL 的站点
      const existingSite = currentConfig.sites.find((s: any) => {
        try {
          return new URL(s.url).origin === new URL(account.site_url).origin;
        } catch {
          return false;
        }
      });
      
      if (existingSite) {
        console.log(`⏭️ [IPC] 跳过已存在的站点: ${account.site_name} (${account.site_url})`);
        continue;
      }
      
      // 构建站点配置
      const siteConfig = {
        name: account.site_name || '恢复的站点',
        url: account.site_url,
        api_key: '', // API Key 需要用户重新创建
        system_token: account.access_token || '',
        user_id: account.user_id?.toString() || '',
        enabled: true,
        has_checkin: account.supports_check_in || account.can_check_in || false,
        force_enable_checkin: account.supports_check_in || false,
        extra_links: '',
        group: 'default'
      };
      
      recoveredSites.push(siteConfig);
      console.log(`✅ [IPC] 恢复站点: ${siteConfig.name} (${siteConfig.url})`);
    }
    
    if (recoveredSites.length === 0) {
      return { success: true, message: '没有需要恢复的站点（所有站点已存在）', count: 0 };
    }
    
    // 合并到配置中
    const newConfig = {
      ...currentConfig,
      sites: [...currentConfig.sites, ...recoveredSites]
    };
    
    // 保存配置
    await configManager.saveConfig(newConfig);
    
    console.log(`🎉 [IPC] 成功恢复 ${recoveredSites.length} 个站点`);
    
    return { 
      success: true, 
      message: `成功恢复 ${recoveredSites.length} 个站点`, 
      count: recoveredSites.length,
      sites: recoveredSites.map(s => s.name)
    };
  } catch (error: any) {
    console.error('❌ [IPC] 恢复站点失败:', error);
    return { success: false, error: error.message };
  }
});
