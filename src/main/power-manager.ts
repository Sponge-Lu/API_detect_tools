/**
 * 输入: Electron powerSaveBlocker API
 * 输出: 电源管理控制接口
 * 定位: 电源管理器 - 阻止系统在应用运行时进入休眠/睡眠状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { powerSaveBlocker } from 'electron';
import Logger from './utils/logger';

/**
 * 电源管理器
 * 使用 Electron 的 powerSaveBlocker API 阻止系统休眠
 */
class PowerManager {
  private blockerId: number | null = null;
  private isBlocking: boolean = false;

  /**
   * 启动电源保护，阻止系统休眠
   * 使用 'prevent-display-sleep' 模式，同时阻止显示器休眠和系统休眠
   */
  start(): boolean {
    if (this.isBlocking) {
      Logger.info('⚡ [PowerManager] 电源保护已在运行中');
      return true;
    }

    try {
      // 'prevent-display-sleep' 会同时阻止显示器和系统休眠
      // 'prevent-app-suspension' 只阻止应用挂起，不阻止系统休眠
      this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
      this.isBlocking = true;
      Logger.info(`⚡ [PowerManager] 电源保护已启动 (ID: ${this.blockerId})`);
      return true;
    } catch (error) {
      Logger.error('❌ [PowerManager] 启动电源保护失败:', error);
      return false;
    }
  }

  /**
   * 停止电源保护，允许系统休眠
   */
  stop(): boolean {
    if (!this.isBlocking || this.blockerId === null) {
      Logger.info('⚡ [PowerManager] 电源保护未在运行');
      return true;
    }

    try {
      powerSaveBlocker.stop(this.blockerId);
      Logger.info(`⚡ [PowerManager] 电源保护已停止 (ID: ${this.blockerId})`);
      this.blockerId = null;
      this.isBlocking = false;
      return true;
    } catch (error) {
      Logger.error('❌ [PowerManager] 停止电源保护失败:', error);
      return false;
    }
  }

  /**
   * 检查电源保护是否正在运行
   */
  isRunning(): boolean {
    if (this.blockerId === null) {
      return false;
    }
    return powerSaveBlocker.isStarted(this.blockerId);
  }

  /**
   * 获取当前状态信息
   */
  getStatus(): { isBlocking: boolean; blockerId: number | null } {
    return {
      isBlocking: this.isBlocking,
      blockerId: this.blockerId,
    };
  }
}

// 导出单例实例
export const powerManager = new PowerManager();
export { PowerManager };
