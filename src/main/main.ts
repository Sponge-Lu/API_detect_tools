/**
 * 输入: Electron app/BrowserWindow, ChromeManager, ApiService, TokenService, BackupManager, UnifiedConfigManager, IPC handlers
 * 输出: BrowserWindow 实例, IPC 事件监听器, 应用生命周期管理
 * 定位: 应用入口 - 初始化 Electron 应用，管理主窗口，协调所有服务
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from './utils/logger';
import { app, BrowserWindow } from 'electron';

// 解决 Electron 打包后 BoringSSL 与某些服务器 TLS 握手失败的问题
// 允许使用更多的加密套件和 TLS 版本
app.commandLine.appendSwitch('ignore-certificate-errors', 'false');
app.commandLine.appendSwitch('disable-http2'); // 某些服务器 HTTP/2 实现有问题
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { ChromeManager } from './chrome-manager';
import { ApiService } from './api-service';
import { TokenService } from './token-service';
import { backupManager } from './backup-manager';
import { registerAllHandlers } from './handlers';
import { unifiedConfigManager } from './unified-config-manager';
import { createCloseBehaviorManager, CloseBehaviorManager } from './close-behavior-manager';

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
let tokenService: TokenService;
let apiService: ApiService;
let closeBehaviorManager: CloseBehaviorManager | null = null;

// 发送站点初始化状态到渲染进程
function sendSiteInitStatus(status: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('site-init-status', status);
  }
}

// 主题设置文件路径（与渲染进程保持一致）
function getThemeSettingsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'theme-settings.json');
}

// 读取保存的主题设置
async function getSavedTheme(): Promise<'light' | 'dark' | 'system'> {
  try {
    const themePath = getThemeSettingsPath();
    const data = await fs.readFile(themePath, 'utf-8');
    const settings = JSON.parse(data);
    if (
      settings.themeMode === 'light' ||
      settings.themeMode === 'dark' ||
      settings.themeMode === 'system'
    ) {
      return settings.themeMode;
    }
  } catch (e) {
    // 文件不存在或解析失败，返回默认值
  }
  return 'system';
}

// 根据主题模式获取窗口背景色
function getWindowBackgroundColor(themeMode: 'light' | 'dark' | 'system'): string {
  if (themeMode === 'dark') {
    return '#1a1b1e'; // 深色主题背景色
  } else if (themeMode === 'light') {
    return '#f8fafc'; // 浅色主题背景色
  } else {
    // system 模式：根据系统主题决定
    const { nativeTheme } = require('electron');
    return nativeTheme.shouldUseDarkColors ? '#1a1b1e' : '#f8fafc';
  }
}

async function createWindow() {
  // 根据环境选择合适的图标，打包后从 resources 目录读取 ico 文件
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico');

  Logger.info('📍 图标路径:', iconPath);
  Logger.info('📦 是否已打包:', app.isPackaged);

  // 读取保存的主题设置，设置对应的窗口背景色以避免白屏
  const savedTheme = await getSavedTheme();
  const backgroundColor = getWindowBackgroundColor(savedTheme);

  mainWindow = new BrowserWindow({
    // 默认窗口宽度调整为 1280，兼顾多列统计信息展示与常见屏幕适配
    width: 1280,
    height: 800,
    title: 'API Hub Management Tools',
    // 无论开发还是生产都显式指定窗口图标，防止 EXE 默认图标被沿用
    icon: iconPath,
    // 防止白屏：设置初始背景色，窗口先隐藏
    backgroundColor,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 完全移除菜单栏
  mainWindow.setMenu(null);

  // 根据环境加载不同的URL
  if (app.isPackaged) {
    // 生产环境：加载打包后的HTML文件
    // __dirname 在打包后是 dist/main/，需要向上两级到根目录
    await mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
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
        Logger.warn(`[Dev] 加载失败，尝试下一个端口: ${url}`);
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

app.whenReady().then(async () => {
  // 初始化统一配置管理器（自动迁移旧格式）
  await unifiedConfigManager.loadConfig();
  Logger.info('✅ [Main] 统一配置管理器已初始化');

  // 初始化其他服务
  tokenService = new TokenService(chromeManager);
  apiService = new ApiService(tokenService, null as any); // tokenStorage 不再需要

  // 创建窗口
  await createWindow();

  // 初始化窗口关闭行为管理器（需要在窗口创建后）
  if (mainWindow) {
    closeBehaviorManager = createCloseBehaviorManager(mainWindow);
    await closeBehaviorManager.initialize();
    Logger.info('✅ [Main] 窗口关闭行为管理器已初始化');
  }

  // 注册所有 IPC 处理器
  registerAllHandlers({
    chromeManager,
    apiService,
    tokenService,
    backupManager,
    getMainWindow: () => mainWindow,
    closeBehaviorManager: closeBehaviorManager || undefined,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  chromeManager.cleanup();
  // 清理托盘资源
  if (closeBehaviorManager) {
    closeBehaviorManager.destroyTray();
  }
  if (process.platform !== 'darwin') app.quit();
});
