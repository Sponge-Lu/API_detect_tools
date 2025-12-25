/**
 * 输入: BrowserWindow (主窗口), Electron app/Tray/Menu, FileSystem (设置文件)
 * 输出: 窗口关闭行为控制, 系统托盘管理, 设置持久化
 * 定位: 基础设施层 - 管理窗口关闭行为和系统托盘功能
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Logger from './utils/logger';

export type CloseBehavior = 'ask' | 'quit' | 'minimize';

export interface CloseBehaviorSettings {
  behavior: CloseBehavior;
}

interface CloseBehaviorSettingsFile {
  behavior: CloseBehavior;
  version: string;
}

const DEFAULT_SETTINGS: CloseBehaviorSettingsFile = {
  behavior: 'ask',
  version: '1.0',
};

export class CloseBehaviorManager {
  private settings: CloseBehaviorSettings;
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private settingsPath: string;
  private isQuitting: boolean = false;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.settingsPath = path.join(app.getPath('userData'), 'close-behavior-settings.json');
    this.settings = { behavior: 'ask' };
  }

  /**
   * 初始化：加载设置、设置窗口关闭拦截
   */
  async initialize(): Promise<void> {
    await this.loadSettings();
    this.setupCloseHandler();
    Logger.info('✅ [CloseBehaviorManager] 已初始化');
  }

  /**
   * 加载设置文件
   */
  private async loadSettings(): Promise<void> {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed: CloseBehaviorSettingsFile = JSON.parse(data);
        if (this.isValidBehavior(parsed.behavior)) {
          this.settings = { behavior: parsed.behavior };
          Logger.info(`📖 [CloseBehaviorManager] 已加载设置: ${this.settings.behavior}`);
          return;
        }
      }
    } catch (error) {
      Logger.warn('⚠️ [CloseBehaviorManager] 加载设置失败，使用默认值:', error);
    }
    this.settings = { behavior: DEFAULT_SETTINGS.behavior };
  }

  /**
   * 验证行为值是否有效
   */
  private isValidBehavior(behavior: any): behavior is CloseBehavior {
    return behavior === 'ask' || behavior === 'quit' || behavior === 'minimize';
  }

  /**
   * 设置窗口关闭事件拦截
   */
  private setupCloseHandler(): void {
    if (!this.mainWindow) return;

    this.mainWindow.on('close', event => {
      if (this.isQuitting) {
        // 正在退出，允许关闭
        return;
      }

      event.preventDefault();
      this.handleClose();
    });
  }

  /**
   * 处理窗口关闭事件
   */
  async handleClose(): Promise<void> {
    const behavior = this.settings.behavior;

    if (behavior === 'quit') {
      this.quitApp();
    } else if (behavior === 'minimize') {
      this.minimizeToTray();
    } else {
      // behavior === 'ask'
      // 发送事件到渲染进程显示对话框
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('close-behavior:show-dialog');
      }
    }
  }

  /**
   * 处理对话框响应
   */
  async handleDialogResponse(response: {
    action: 'quit' | 'minimize';
    remember: boolean;
  }): Promise<void> {
    if (response.remember) {
      await this.saveSettings({ behavior: response.action });
    }

    if (response.action === 'quit') {
      this.quitApp();
    } else {
      this.minimizeToTray();
    }
  }

  /**
   * 获取当前设置
   */
  getSettings(): CloseBehaviorSettings {
    return { ...this.settings };
  }

  /**
   * 保存设置
   */
  async saveSettings(settings: CloseBehaviorSettings): Promise<void> {
    if (!this.isValidBehavior(settings.behavior)) {
      throw new Error(`Invalid behavior: ${settings.behavior}`);
    }

    this.settings = { ...settings };

    const fileData: CloseBehaviorSettingsFile = {
      behavior: this.settings.behavior,
      version: '1.0',
    };

    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(fileData, null, 2), 'utf-8');
      Logger.info(`💾 [CloseBehaviorManager] 已保存设置: ${this.settings.behavior}`);
    } catch (error) {
      Logger.error('❌ [CloseBehaviorManager] 保存设置失败:', error);
      throw error;
    }
  }

  /**
   * 最小化到托盘
   */
  minimizeToTray(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    // 创建托盘（如果不存在）
    if (!this.tray) {
      this.createTray();
    }

    this.mainWindow.hide();
    Logger.info('📥 [CloseBehaviorManager] 窗口已最小化到托盘');
  }

  /**
   * 从托盘恢复窗口
   */
  restoreFromTray(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    this.mainWindow.show();
    this.mainWindow.focus();
    Logger.info('📤 [CloseBehaviorManager] 窗口已从托盘恢复');
  }

  /**
   * 创建系统托盘
   */
  private createTray(): void {
    try {
      // 获取图标路径
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.ico')
        : path.join(app.getAppPath(), 'build', 'icon.ico');

      // 创建托盘图标
      const icon = nativeImage.createFromPath(iconPath);
      this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

      // 设置托盘提示文字
      this.tray.setToolTip('API Hub Management Tools');

      // 创建右键菜单
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示窗口',
          click: () => this.restoreFromTray(),
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => this.quitApp(),
        },
      ]);

      this.tray.setContextMenu(contextMenu);

      // 点击托盘图标恢复窗口
      this.tray.on('click', () => {
        this.restoreFromTray();
      });

      Logger.info('🔔 [CloseBehaviorManager] 系统托盘已创建');
    } catch (error) {
      Logger.error('❌ [CloseBehaviorManager] 创建系统托盘失败:', error);
      // 托盘创建失败时，回退到直接退出
      this.quitApp();
    }
  }

  /**
   * 销毁系统托盘
   */
  destroyTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      Logger.info('🔕 [CloseBehaviorManager] 系统托盘已销毁');
    }
  }

  /**
   * 退出应用
   */
  quitApp(): void {
    this.isQuitting = true;
    this.destroyTray();
    app.quit();
  }

  /**
   * 设置主窗口引用（用于窗口重建场景）
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    this.setupCloseHandler();
  }

  /**
   * 获取设置文件路径（用于测试）
   */
  getSettingsPath(): string {
    return this.settingsPath;
  }
}

// 导出单例实例（延迟初始化）
let closeBehaviorManagerInstance: CloseBehaviorManager | null = null;

export function getCloseBehaviorManager(): CloseBehaviorManager | null {
  return closeBehaviorManagerInstance;
}

export function createCloseBehaviorManager(mainWindow: BrowserWindow): CloseBehaviorManager {
  closeBehaviorManagerInstance = new CloseBehaviorManager(mainWindow);
  return closeBehaviorManagerInstance;
}
