/**
 * 输入: ENV 文件路径
 * 输出: 解析后的键值对对象或 null
 * 定位: 工具层 - ENV 文件解析器
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import * as fs from 'fs';

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
 * 解析 ENV 文件
 * @param filePath ENV 文件的完整路径
 * @returns 解析后的键值对对象，如果文件不存在或解析失败则返回 null
 */
export function parseEnvFile<T = Record<string, string>>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      log.debug(`ENV file not found: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return parseEnvString<T>(content);
  } catch (error) {
    log.error(`Failed to parse ENV file: ${filePath}`, error);
    return null;
  }
}

/**
 * 解析 ENV 格式的字符串
 * @param content ENV 格式的字符串
 * @returns 解析后的键值对对象
 */
export function parseEnvString<T = Record<string, string>>(content: string): T {
  const result: Record<string, string> = {};

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    // 跳过空行和注释
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // 查找第一个等号的位置
    const equalIndex = trimmedLine.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmedLine.substring(0, equalIndex).trim();
    let value = trimmedLine.substring(equalIndex + 1).trim();

    // 移除引号（支持单引号和双引号）
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // 处理转义字符（仅在双引号内）
    if (
      trimmedLine
        .substring(equalIndex + 1)
        .trim()
        .startsWith('"')
    ) {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }

    if (key) {
      result[key] = value;
    }
  }

  return result as T;
}
