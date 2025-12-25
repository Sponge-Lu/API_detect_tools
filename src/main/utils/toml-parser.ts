/**
 * 输入: TOML 文件路径
 * 输出: 解析后的 JavaScript 对象或 null
 * 定位: 工具层 - TOML 文件解析器
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import * as fs from 'fs';
import * as TOML from '@iarna/toml';

// 简单的日志函数，避免在测试环境中依赖 electron
const log = {
  debug: (msg: string) => {
    if (process.env.NODE_ENV !== 'test') {
      console.debug(msg);
    }
  },
  error: (msg: string, error?: unknown) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(msg, error);
    }
  },
};

/**
 * 解析 TOML 文件
 * @param filePath TOML 文件的完整路径
 * @returns 解析后的对象，如果文件不存在或解析失败则返回 null
 */
export function parseTomlFile<T = Record<string, unknown>>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      log.debug(`TOML file not found: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = TOML.parse(content) as T;
    return parsed;
  } catch (error) {
    log.error(`Failed to parse TOML file: ${filePath}`, error);
    return null;
  }
}

/**
 * 安全地解析 TOML 字符串
 * @param content TOML 格式的字符串
 * @returns 解析后的对象，如果解析失败则返回 null
 */
export function parseTomlString<T = Record<string, unknown>>(content: string): T | null {
  try {
    const parsed = TOML.parse(content) as T;
    return parsed;
  } catch (error) {
    log.error('Failed to parse TOML string', error);
    return null;
  }
}
