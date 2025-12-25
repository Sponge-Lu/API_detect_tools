/**
 * 输入: 日志消息, 日志级别
 * 输出: 格式化的控制台日志
 * 定位: 工具层 - 前端日志工具类，生产环境自动禁用 debug 级别日志
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// Vite 环境变量
const isDev =
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? process.env.NODE_ENV !== 'production';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel: LogLevel = isDev ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function formatArgs(prefix: string, args: unknown[]): unknown[] {
  const timestamp = new Date().toLocaleTimeString();
  return [`[${timestamp}] ${prefix}`, ...args];
}

export const Logger = {
  error: (...args: unknown[]) => {
    if (shouldLog('error')) console.error(...formatArgs('❌', args));
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) console.warn(...formatArgs('⚠️', args));
  },
  info: (...args: unknown[]) => {
    if (shouldLog('info')) console.log(...formatArgs('ℹ️', args));
  },
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) console.log(...formatArgs('🔍', args));
  },
  scope: (name: string) => ({
    error: (...args: unknown[]) => Logger.error(`[${name}]`, ...args),
    warn: (...args: unknown[]) => Logger.warn(`[${name}]`, ...args),
    info: (...args: unknown[]) => Logger.info(`[${name}]`, ...args),
    debug: (...args: unknown[]) => Logger.debug(`[${name}]`, ...args),
  }),
};

export default Logger;
