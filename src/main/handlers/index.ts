/**
 * 输入: ChromeManager, ApiService, TokenService, BackupManager, UnifiedConfigManager, IPC handlers
 * 输出: 注册到 ipcMain 的 IPC 事件监听器
 * 定位: 集成层 - 注册所有 IPC 事件处理器，协调服务通信
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from '../utils/logger';
/**
 * IPC Handlers 统一注册入口
 * v2: 使用 UnifiedConfigManager 替代 ConfigManager + TokenStorage
 */

import { BrowserWindow } from 'electron';
import type { ChromeManager } from '../chrome-manager';
import type { ApiService } from '../api-service';
import type { TokenService } from '../token-service';
import type { BackupManager } from '../backup-manager';

import { registerUnifiedConfigHandlers } from './unified-config-handlers';
import { registerThemeHandlers } from './theme-handlers';
import { registerBackupHandlers } from './backup-handlers';
import { registerTokenHandlers } from './token-handlers';
import { registerDetectionHandlers } from './detection-handlers';
import { registerWebDAVHandlers } from './webdav-handlers';
import { registerUpdateHandlers } from './update-handlers';
import { registerCliCompatHandlers } from './cli-compat-handlers';
import { registerCloseBehaviorHandlers } from './close-behavior-handlers';
import { registerCreditHandlers } from './credit-handlers';
import type { CloseBehaviorManager } from '../close-behavior-manager';

interface HandlerDependencies {
  chromeManager: ChromeManager;
  apiService: ApiService;
  tokenService: TokenService;
  backupManager: BackupManager;
  getMainWindow: () => BrowserWindow | null;
  closeBehaviorManager?: CloseBehaviorManager;
}

/**
 * 注册所有 IPC 处理器
 */
export function registerAllHandlers(deps: HandlerDependencies) {
  const {
    chromeManager,
    apiService,
    tokenService,
    backupManager,
    getMainWindow,
    closeBehaviorManager,
  } = deps;

  // 统一配置相关（替代原 config-handlers 和 storage-handlers）
  registerUnifiedConfigHandlers();

  // 主题相关
  registerThemeHandlers();

  // 备份相关
  registerBackupHandlers(backupManager);

  // 令牌管理相关
  registerTokenHandlers(tokenService, chromeManager, getMainWindow);

  // 站点检测相关
  registerDetectionHandlers(apiService, chromeManager);

  // WebDAV 备份相关
  registerWebDAVHandlers();

  // 软件更新相关
  registerUpdateHandlers();

  // CLI 兼容性测试相关
  registerCliCompatHandlers();

  // 窗口关闭行为相关
  if (closeBehaviorManager) {
    registerCloseBehaviorHandlers(closeBehaviorManager);
  }

  // Credit 积分检测相关
  registerCreditHandlers();

  Logger.info('✅ [Handlers] 所有 IPC 处理器已注册');
}

// 导出各个 handler 模块（供单独使用）
export * from './unified-config-handlers';
export * from './theme-handlers';
export * from './backup-handlers';
export * from './token-handlers';
export * from './detection-handlers';
export * from './webdav-handlers';
export * from './update-handlers';
export * from './cli-compat-handlers';
export * from './close-behavior-handlers';
export * from './credit-handlers';
