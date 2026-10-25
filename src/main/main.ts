/**
 * 输入: Electron app/BrowserWindow, ChromeManager, ApiService, TokenService, BackupManager, UnifiedConfigManager, PowerManager, IPC handlers
 * 输出: BrowserWindow 实例, IPC 事件监听器, 应用生命周期管理
 * 定位: 应用入口 - 初始化 Electron 应用；显式开发 URL 加载热更新页面，其余模式加载构建产物；管理主窗口与服务
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from './utils/logger';
import {
  initializeApplicationStorage,
  getApplicationStorage,
  readStorageText,
} from './storage/application-storage';
import { app, BrowserWindow, dialog } from 'electron';

// 解决 Electron 打包后 BoringSSL 与某些服务器 TLS 握手失败的问题
// 允许使用更多的加密套件和 TLS 版本
app.commandLine.appendSwitch('ignore-certificate-errors', 'false');
app.commandLine.appendSwitch('disable-http2'); // 某些服务器 HTTP/2 实现有问题
import * as path from 'path';

import * as os from 'os';
import { ChromeManager } from './chrome-manager';
import { ApiService } from './api-service';
import { TokenService } from './token-service';
import { backupManager } from './backup-manager';
import { registerAllHandlers } from './handlers';
import { unifiedConfigManager } from './unified-config-manager';
import { routeStateManager } from './route-state-manager';
import { cleanupStaleTempFiles } from './utils/atomic-json';
import { flushToStorage as flushRouteStats, invalidateRouteStats } from './route-stats-service';
import { flushRouteAnalytics, invalidateRouteAnalytics } from './route-analytics-service';
import { routeStateAffinityService } from './route-state-affinity-service';
import { endpointTestStateService } from './endpoint-test-state-service';
import {
  invalidateConfigFileProfiles,
  loadConfigFileProfiles,
} from './config-file-profile-service';
import { updateService } from './update-service';
import { browserProfileManager } from './browser-profile-manager';
import { recoverCliOperations } from './storage/cli-operation-journal';
import { createCloseBehaviorManager, CloseBehaviorManager } from './close-behavior-manager';
import { powerManager } from './power-manager';
import {
  initializeRouteProxy,
  stopProxyServer,
  clearRequestFatalNegativeCache,
} from './route-proxy-service';
import { requestManager } from './utils/request-manager';
import { configDetectionService } from './config-detection-service';
import { loadModelMetadata } from './model-metadata-service';
import {
  getModelRegistry,
  refreshModelRegistryMetadata,
  syncModelRegistrySources,
} from './route-model-registry-service';
import { broadcastRendererEvent } from './app-data-events';
import { configureRouteApiKeyResolver } from './route-channel-resolver';
import {
  getWindowBackgroundColor,
  normalizeThemeMode,
  type ThemeMode,
} from '../shared/theme/themePresets';
import { createRendererHealthMonitor, loadApplicationRenderer } from './window-health-manager';
import { routeSessionActivityService } from './route-session-activity-service';
import { routeSessionBindingService } from './route-session-binding-service';

// 设置Windows控制台编码为UTF-8，解决中文乱码问题
if (os.platform() === 'win32') {
  process.env['PYTHONIOENCODING'] = 'utf-8';
  // 尝试设置控制台代码页为UTF-8
  try {
    const { execSync } = require('child_process');
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 忽略错误
  }
}

let mainWindow: BrowserWindow | null = null;
const chromeManager = new ChromeManager();
let tokenService: TokenService;
let apiService: ApiService;
let closeBehaviorManager: CloseBehaviorManager | null = null;
let automaticBackup: ReturnType<typeof setTimeout> | undefined;

// 主题设置文件路径（与渲染进程保持一致）
function getThemeSettingsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'theme-settings.json');
}

// 读取保存的主题设置
async function getSavedTheme(): Promise<ThemeMode> {
  try {
    const themePath = getThemeSettingsPath();
    const data = await readStorageText(themePath);
    const settings = JSON.parse(data);
    return normalizeThemeMode(settings.themeMode);
  } catch {
    return normalizeThemeMode(null);
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

  const window = new BrowserWindow({
    // 默认窗口尺寸：日志九列 + 侧栏 + 总览/路由固定布局
    width: 1320,
    height: 800,
    minWidth: 1200,
    minHeight: 720,
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
  mainWindow = window;

  // 窗口准备好后再显示，避免白屏闪烁
  window.once('ready-to-show', () => {
    window.show();
  });

  // 完全移除菜单栏
  window.setMenu(null);

  const loadRenderer = () =>
    loadApplicationRenderer(window, {
      isPackaged: app.isPackaged,
      htmlPath: path.join(__dirname, '../../dist-renderer/index.html'),
      devServerUrl: process.env.API_HUB_DEV_SERVER_URL,
    });

  const rendererHealth = createRendererHealthMonitor(window.webContents, {
    loadRenderer,
    logger: Logger,
  });
  window.on('closed', () => rendererHealth.dispose());
  await rendererHealth.load();
}

app
  .whenReady()
  .then(async () => {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('second-instance', () => {
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    });
    // 启动电源保护，阻止系统休眠（特别是远程桌面环境）
    powerManager.start();
    Logger.info('✅ [Main] 电源保护已启动');

    // 初始化统一配置管理器（自动迁移旧格式）
    const storage = await initializeApplicationStorage(app.getPath('userData'), documents =>
      unifiedConfigManager.prepareLegacyDocuments(documents)
    );
    const pendingClientOperations = await recoverCliOperations(storage);
    if (pendingClientOperations.length)
      Logger.warn('Client file recovery requires review:', pendingClientOperations);
    await unifiedConfigManager.loadConfig();
    storage.setHooks({
      committed: () => {
        if (automaticBackup) clearTimeout(automaticBackup);
        automaticBackup = setTimeout(() => {
          automaticBackup = undefined;
          void backupManager.backupManifestBundle({ reason: 'stable-data-changed' });
        }, 500);
        automaticBackup.unref();
      },
      flush: async () => {
        await Promise.all([
          routeSessionActivityService.flush(),
          routeSessionBindingService.flush(),
          flushRouteAnalytics(),
          flushRouteStats().then(() => unifiedConfigManager.flushRouteRuntimeState()),
        ]);
      },
      reload: async () => {
        await stopProxyServer();
        requestManager.clear();
        configDetectionService.clearCache();
        apiService?.invalidate();
        clearRequestFatalNegativeCache();
        routeSessionActivityService.invalidate();
        routeSessionBindingService.invalidate();
        routeStateAffinityService.invalidate();
        endpointTestStateService.invalidate();
        invalidateRouteStats();
        invalidateRouteAnalytics();
        invalidateConfigFileProfiles();
        updateService.invalidateSettings();
        await unifiedConfigManager.loadConfig();
        await syncModelRegistrySources(true);
        await Promise.all([
          routeSessionBindingService.load(),
          routeStateAffinityService.load(),
          loadConfigFileProfiles(),
          closeBehaviorManager?.loadSettings(),
        ]);
        await browserProfileManager.reconcileIsolatedProfilesAfterRestore();
        await initializeRouteProxy();
      },
      changed: () =>
        broadcastRendererEvent('app-data:changed', {
          domains: ['site-config', 'site-overview', 'route-overview', 'config-file-profiles'],
          emittedAt: Date.now(),
          restored: true,
          generation: storage.coordinator.version('app-config').generation,
          versions: ['app-config', 'custom-cli-configs', 'config-file-profiles'].map(scope =>
            storage.coordinator.version(
              scope as 'app-config' | 'custom-cli-configs' | 'config-file-profiles'
            )
          ),
        }),
    });
    Logger.info('✅ [Main] 统一配置管理器已初始化');

    // 上次进程崩溃/断电可能在 state 目录留下孤儿临时文件（正常写入只存活数毫秒）
    cleanupStaleTempFiles(routeStateManager.getStateDir())
      .then(removed => {
        if (removed > 0) Logger.info(`🧹 [Main] 清理了 ${removed} 个残留路由状态临时文件`);
      })
      .catch(() => undefined);

    // 初始化其他服务
    tokenService = new TokenService(chromeManager);
    apiService = new ApiService(tokenService);
    configureRouteApiKeyResolver(tokenService);

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

    // 初始化路由代理服务（如已启用则启动本地代理）
    await loadModelMetadata();
    getModelRegistry();
    await initializeRouteProxy();
    void storage
      .withActivity(() => refreshModelRegistryMetadata())
      .then(() => broadcastRendererEvent('route:model-metadata-updated', {}))
      .catch(error =>
        Logger.warn('Model metadata refresh failed; keeping cached metadata', String(error))
      );
    Logger.info('✅ [Main] 路由代理服务已初始化');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch(error => {
    Logger.error('Application initialization failed', error);
    dialog.showErrorBox('应用数据加载失败', error instanceof Error ? error.message : String(error));
    app.exit(1);
  });

app.on('window-all-closed', () => {
  // 停止电源保护
  powerManager.stop();
  chromeManager.cleanup();
  // 清理托盘资源
  if (closeBehaviorManager) {
    closeBehaviorManager.destroyTray();
  }
  if (process.platform !== 'darwin') app.quit();
});

let routeActivityFlushedForQuit = false;
let routeActivityFlushInProgress = false;
app.on('before-quit', event => {
  if (automaticBackup) clearTimeout(automaticBackup);
  if (routeActivityFlushedForQuit) return;
  event.preventDefault();
  if (routeActivityFlushInProgress) return;
  routeActivityFlushInProgress = true;
  void (async () => {
    try {
      await stopProxyServer();
      await getApplicationStorage()?.close();
    } catch (error) {
      Logger.error('Application storage shutdown failed', error);
    } finally {
      routeActivityFlushedForQuit = true;
      routeActivityFlushInProgress = false;
      app.quit();
    }
  })();
});
