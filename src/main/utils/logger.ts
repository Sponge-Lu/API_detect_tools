/**
 * 输入: 日志消息, 日志级别, 元数据
 * 输出: 格式化的日志输出 (控制台 + 文件)
 * 定位: 工具层 - 日志工具类，基于 electron-log 封装，支持文件持久化和级别控制
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import log from 'electron-log/main';
import { app } from 'electron';
import * as path from 'path';

// 日志级别类型
type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';

// 是否已完成完整初始化
let isFullyInitialized = false;

// 配置日志（仅在 app ready 后调用）
function setupLogger() {
  if (isFullyInitialized) return;

  try {
    // 设置日志文件路径
    const userDataPath = app.getPath('userData');
    const logPath = path.join(userDataPath, 'logs');

    // 配置文件输出
    log.transports.file.resolvePathFn = () => path.join(logPath, 'main.log');
    log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

    // 配置控制台输出
    log.transports.console.format = '{h}:{i}:{s} [{level}] {text}';

    // 根据环境设置日志级别
    const isDev = !app.isPackaged;
    const level: LogLevel = isDev ? 'debug' : 'info';

    log.transports.file.level = level;
    log.transports.console.level = level;

    // 捕获未处理的错误
    log.errorHandler.startCatching();

    isFullyInitialized = true;
    log.info('📝 日志系统初始化完成');
    log.info(`📁 日志文件路径: ${logPath}`);
    log.info(`🔧 日志级别: ${level}`);
  } catch {
    // app 未 ready，使用默认配置
  }
}

// 在 app ready 后初始化
if (app.isReady()) {
  setupLogger();
} else {
  app.whenReady().then(setupLogger);
}

// 导出日志方法（直接使用 log，它在 app ready 前也能工作，只是不写文件）
export const Logger = {
  error: (...args: unknown[]) => log.error(...args),
  warn: (...args: unknown[]) => log.warn(...args),
  info: (...args: unknown[]) => log.info(...args),
  verbose: (...args: unknown[]) => log.verbose(...args),
  debug: (...args: unknown[]) => log.debug(...args),
  scope: (prefix: string) => ({
    error: (...args: unknown[]) => log.error(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => log.warn(`[${prefix}]`, ...args),
    info: (...args: unknown[]) => log.info(`[${prefix}]`, ...args),
    verbose: (...args: unknown[]) => log.verbose(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => log.debug(`[${prefix}]`, ...args),
  }),
  getLogPath: () => {
    if (!app.isReady()) return '';
    return path.join(app.getPath('userData'), 'logs');
  },
};

export default Logger;
