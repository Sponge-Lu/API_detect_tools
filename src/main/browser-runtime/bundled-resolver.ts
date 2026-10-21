import path from 'path';
import fs from 'fs';
import Logger from '../utils/logger';

/**
 * 内置 Chromium 解析（P1-1，见 docs/BROWSER_RUNTIME_REFACTOR_PLAN.md）。
 *
 * 目录约定（与 electron-builder extraResources 的 `${os}-${arch}` 宏一致）：
 *   <resources>/chromium/<os>-<arch>/
 * 其中 <os> 为 electron-builder 的 buildConfigurationKey（win/mac/linux，见
 * BUILD_OS_NAME 映射），<arch> 取 `process.arch`（x64/arm64）。
 * fetch:chromium（scripts/fetch-chromium.mjs）负责把 Chrome for Testing 产物落到
 * 该目录并在成功后写入 VERSION 标记。
 *
 * 校验规则：
 *   - 平台目录必须存在且含平台对应的可执行文件；
 *   - 必须带非空 VERSION 标记，缺失视为下载/解包不完整，不参与降级链。
 *
 * 查找顺序：打包资源目录（process.resourcesPath，开发态不存在则跳过）→
 * 仓库内 resources/chromium（开发态联调内置浏览器）。全部缺失返回 null，
 * 由调用方继续走本机浏览器降级链。
 */

/** electron-builder 的 ${os} 宏取值（buildConfigurationKey），用于拼接平台目录名 */
const BUILD_OS_NAME: Record<string, string> = {
  win32: 'win',
  darwin: 'mac',
  linux: 'linux',
};

/** 下载成功后由 fetch:chromium 写入的版本标记文件名 */
const VERSION_MARKER = 'VERSION';

/** 各平台可执行文件的相对路径候选（按 Chrome for Testing 解包布局） */
const EXECUTABLE_CANDIDATES: Record<string, string[]> = {
  win32: ['chrome.exe'],
  darwin: [
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['chrome', 'chromium'],
};

/** 打包态资源根：<resources>/chromium；非 Electron 环境（单测）返回 undefined */
function packagedChromiumBase(): string | undefined {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' ? path.join(resourcesPath, 'chromium') : undefined;
}

/** 开发态资源根：从 __dirname 向上找仓库根下的 resources/（dist/main/browser-runtime → 仓库根） */
function repoChromiumBase(): string | undefined {
  let dir = __dirname;
  for (let depth = 0; depth < 6 && dir !== path.dirname(dir); depth += 1) {
    const candidate = path.join(dir, 'resources', 'chromium');
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/** 在单个平台目录内校验 VERSION 标记与可执行文件存在性，返回可执行文件绝对路径 */
function resolveInPlatformDir(platformDir: string): string | null {
  try {
    if (!fs.existsSync(platformDir) || !fs.statSync(platformDir).isDirectory()) {
      return null;
    }
    const markerPath = path.join(platformDir, VERSION_MARKER);
    if (!fs.existsSync(markerPath) || !fs.readFileSync(markerPath, 'utf8').trim()) {
      return null;
    }
    for (const relative of EXECUTABLE_CANDIDATES[process.platform] ?? []) {
      const executablePath = path.join(platformDir, relative);
      if (
        fs.existsSync(executablePath) &&
        fs.statSync(executablePath).isFile() &&
        fs.statSync(executablePath).size > 0
      ) {
        fs.accessSync(
          executablePath,
          process.platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK
        );
        return executablePath;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析打包内置浏览器可执行文件路径；不可用（未打包/未下载/不完整）时返回 null，
 * 降级链由调用方（chrome-manager getChromePath）继续。
 */
export function resolveBundledBrowserPath(): string | null {
  const osName = BUILD_OS_NAME[process.platform];
  if (!osName) {
    return null;
  }
  const dirName = `${osName}-${process.arch}`;
  for (const base of [packagedChromiumBase(), repoChromiumBase()]) {
    if (!base) continue;
    const found = resolveInPlatformDir(path.join(base, dirName));
    if (found) {
      Logger.info(`🔍 [BrowserRuntime] 已解析内置浏览器: ${found}`);
      return found;
    }
  }
  return null;
}
