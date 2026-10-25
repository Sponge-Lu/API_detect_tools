import { getApplicationStorage, readStorageTextSync } from '../storage/application-storage';

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import Logger from '../utils/logger';

import { resolveBundledBrowserPath } from './bundled-resolver';

export function getChromePath(): string | null {
  const platform = process.platform;

  /**
   * 1. 优先读取环境变量中的自定义路径
   *    - CHROME_PATH / BROWSER_PATH
   */
  const envPath = process.env.CHROME_PATH || process.env.BROWSER_PATH;
  if (envPath && fs.existsSync(envPath)) {
    Logger.info(`🔍 [ChromeManager] 使用环境变量中的浏览器路径: ${envPath}`);
    return envPath;
  }

  /**
   * 2. 从配置文件中读取自定义浏览器路径（settings.browser_path）
   *    用于支持用户指定的便携版 Chrome / Edge / 其他 Chromium 浏览器
   */
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.json');
    if (getApplicationStorage() || fs.existsSync(configPath)) {
      const raw = readStorageTextSync(configPath);
      const config = JSON.parse(raw);
      const customPath: string | undefined =
        config?.settings?.browser_path ||
        config?.settings?.chrome_path ||
        config?.settings?.chromium_path;

      if (customPath && typeof customPath === 'string' && fs.existsSync(customPath)) {
        Logger.info(`🔍 [ChromeManager] 使用配置文件中的浏览器路径: ${customPath}`);
        return customPath;
      } else if (customPath) {
        Logger.warn(`⚠️ [ChromeManager] 配置文件中的浏览器路径不存在: ${customPath}`);
      }
    }
  } catch (e: any) {
    Logger.warn('⚠️ [ChromeManager] 读取配置文件中的浏览器路径失败:', e?.message || e);
  }

  /**
   * 3. 打包内置的 Chromium（三端开箱即用的主路径）
   */
  const bundledPath = resolveBundledBrowserPath();
  if (bundledPath && fs.existsSync(bundledPath)) {
    Logger.info(`🔍 [ChromeManager] 使用内置浏览器: ${bundledPath}`);
    return bundledPath;
  }

  /**
   * 4. 根据平台自动检测本机已安装的 Chromium 内核浏览器（兜底）
   */
  if (platform === 'win32') {
    // 4.1 Windows: 优先尝试系统默认浏览器（如果是 Chromium 内核）
    const defaultBrowserPath = getSystemDefaultBrowserPathWin();
    if (defaultBrowserPath && fs.existsSync(defaultBrowserPath)) {
      const exeName = path.basename(defaultBrowserPath).toLowerCase();
      const chromiumLike = [
        'chrome.exe',
        'msedge.exe',
        'chromium.exe',
        'brave.exe',
        'vivaldi.exe',
        'opera.exe',
      ];
      if (chromiumLike.includes(exeName)) {
        Logger.info(`🔍 [ChromeManager] 使用系统默认浏览器 (Chromium 内核): ${defaultBrowserPath}`);
        return defaultBrowserPath;
      } else {
        Logger.warn(
          `⚠️ [ChromeManager] 系统默认浏览器不是 Chromium 内核 (${defaultBrowserPath})，跳过该路径`
        );
      }
    }

    // 4.2 回退到内置候选列表
    const candidates = new Set<string>();
    const username =
      process.env.USERNAME ||
      (process.env.USERPROFILE ? path.basename(process.env.USERPROFILE) : '');

    // ===== 系统安装的 Chrome =====
    candidates.add('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.add('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
    if (username) {
      candidates.add(
        `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`
      );
    }

    // ===== 系统安装的 Microsoft Edge =====
    candidates.add('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
    candidates.add('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    if (username) {
      candidates.add(
        `C:\\Users\\${username}\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe`
      );
    }

    // ===== 当前应用目录附近的便携版 Chrome / Edge =====
    const execDir = path.dirname(process.execPath);
    const portableCandidates = [
      path.join(execDir, 'chrome.exe'),
      path.join(execDir, 'Chrome', 'chrome.exe'),
      path.join(execDir, 'Chrome', 'Application', 'chrome.exe'),
      path.join(execDir, 'Chromium', 'chrome.exe'),
      path.join(execDir, 'ChromePortable', 'App', 'Chrome-bin', 'chrome.exe'),
      path.join(execDir, 'msedge.exe'),
    ];
    portableCandidates.forEach(p => candidates.add(p));

    for (const browserPath of candidates) {
      if (fs.existsSync(browserPath)) {
        Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
        return browserPath;
      }
    }

    Logger.warn(
      '⚠️ [ChromeManager] 未检测到内置浏览器，也未找到本机 Chrome/Edge。请在设置中手动指定浏览器路径。'
    );
    return null;
  } else if (platform === 'darwin') {
    // macOS: 优先 Chrome，其次 Edge
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];

    for (const browserPath of macCandidates) {
      if (fs.existsSync(browserPath)) {
        Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
        return browserPath;
      }
    }

    Logger.warn(
      '⚠️ [ChromeManager] 未找到内置浏览器与本机 Chrome/Edge。请在设置中手动指定浏览器路径。'
    );
    return null;
  } else {
    // Linux: 常见的 chrome / chromium 安装路径
    const linuxCandidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];

    for (const browserPath of linuxCandidates) {
      if (fs.existsSync(browserPath)) {
        Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
        return browserPath;
      }
    }

    Logger.warn(
      '⚠️ [ChromeManager] 未找到内置浏览器与常见 Chromium 浏览器。请安装 chromium 或在设置中手动指定路径。'
    );
    return null;
  }
}

export function getSystemDefaultBrowserPathWin(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const { execSync } = require('child_process');
    /**
     * Windows 10+ 正确的默认浏览器查询方式：
     * 1. 读取 UserChoice 中的 ProgId：HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice
     * 2. 再根据 ProgId 读取：HKCR\<ProgId>\shell\open\command
     */
    try {
      const userChoiceOutput: string = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
        { encoding: 'utf8' }
      );

      const progIdMatch = userChoiceOutput.match(/ProgId\s+REG_SZ\s+(.+)\s*$/m);
      const progId = progIdMatch ? progIdMatch[1].trim() : null;

      if (progId) {
        const commandOutput: string = execSync(
          `reg query "HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command" /ve`,
          { encoding: 'utf8' }
        );

        const commandMatch = commandOutput.match(/REG_SZ\s+(.+)\s*$/m);
        if (commandMatch) {
          const command = commandMatch[1].trim();

          // 优先从双引号中提取 exe 路径
          if (command.startsWith('"')) {
            const endQuote = command.indexOf('"', 1);
            if (endQuote > 1) {
              const exePath = command.slice(1, endQuote);
              return exePath || null;
            }
          }

          // 回退：从字符串中截取到 .exe 结尾
          const lower = command.toLowerCase();
          const exeIndex = lower.indexOf('.exe');
          if (exeIndex !== -1) {
            const exePath = command.slice(0, exeIndex + 4);
            return exePath || null;
          }
        }
      }
    } catch (innerError: any) {
      Logger.warn(
        '⚠️ [ChromeManager] 通过 UserChoice 查询默认浏览器失败，尝试回退方案:',
        innerError?.message || innerError
      );
    }

    /**
     * 回退方案：旧方式，直接从 HKCR\HTTP\shell\open\command 读取
     * 在某些系统上仍然有效
     */
    try {
      const output: string = execSync(
        'reg query "HKEY_CLASSES_ROOT\\HTTP\\shell\\open\\command" /ve',
        { encoding: 'utf8' }
      );

      const match = output.match(/REG_SZ\s+(.+)\s*$/m);
      if (!match) {
        return null;
      }

      const command = match[1].trim();

      if (command.startsWith('"')) {
        const endQuote = command.indexOf('"', 1);
        if (endQuote > 1) {
          const exePath = command.slice(1, endQuote);
          return exePath || null;
        }
      }

      const lower = command.toLowerCase();
      const exeIndex = lower.indexOf('.exe');
      if (exeIndex !== -1) {
        const exePath = command.slice(0, exeIndex + 4);
        return exePath || null;
      }
    } catch (fallbackError: any) {
      Logger.warn(
        '⚠️ [ChromeManager] 通过 HTTP 关联查询默认浏览器失败:',
        fallbackError?.message || fallbackError
      );
    }

    return null;
  } catch (e: any) {
    Logger.warn('⚠️ [ChromeManager] 读取系统默认浏览器失败:', e?.message || e);
    return null;
  }
}
