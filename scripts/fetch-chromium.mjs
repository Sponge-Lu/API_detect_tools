#!/usr/bin/env node
/**
 * fetch:chromium — 下载 Chrome for Testing 产物到 resources/chromium/<platform>-<arch>/
 *
 * 产物布局与 src/main/browser-runtime/bundled-resolver.ts 的约定一致：
 *   resources/chromium/<os>-<arch>/                 # os 为 electron-builder ${os} 宏取值（win/mac/linux）
 *     VERSION                                       # 版本标记（非空才被视为有效安装）
 *     chrome.exe | chrome | Google Chrome for Testing.app/...
 *
 * 用法：
 *   node scripts/fetch-chromium.mjs [--version version | --channel stable|beta|dev|canary] [--force] [--dry-run]
 *
 * 说明：
 *   - 数据源：Chrome for Testing 官方 last-known-good 索引 + storage.googleapis.com
 *   - CfT 仅提供 win64/linux64/mac-x64/mac-arm64；win32-arm64 / linux-arm64 无官方产物
 */
import { spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
  accessSync,
  constants,
} from 'node:fs';
import { mkdtempSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const CHROMIUM_VERSION = '155.0.8059.39';
const CFT_INDEX_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_ROOT = path.join(REPO_ROOT, 'resources', 'chromium');

/** CfT 索引里的频道名为首字母大写，命令行参数大小写不敏感 */
const CFT_CHANNELS = { stable: 'Stable', beta: 'Beta', dev: 'Dev', canary: 'Canary' };

function canonicalChannel(name) {
  const key = String(name || '').toLowerCase();
  const channel = CFT_CHANNELS[key];
  if (!channel) {
    throw new Error(`未知频道: ${name}（可选 stable/beta/dev/canary）`);
  }
  return channel;
}

/** process.platform → electron-builder ${os} 宏取值（目录命名与 bundled-resolver 对应） */
function buildOsName(platform) {
  const mapping = { win32: 'win', darwin: 'mac', linux: 'linux' };
  const osName = mapping[platform];
  if (!osName) throw new Error(`不支持的平台: ${platform}`);
  return osName;
}

/** CfT 下载命名 → 本仓库目录命名（与 bundled-resolver 的 <os>-<arch> 约定对应） */
function cftPlatformName(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'x64') return 'win64';
    throw new Error(`Chrome for Testing 不提供 win32-${arch} 官方产物`);
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'mac-x64';
    if (arch === 'arm64') return 'mac-arm64';
    throw new Error(`Chrome for Testing 不提供 darwin-${arch} 官方产物`);
  }
  if (platform === 'linux') {
    if (arch === 'x64') return 'linux64';
    throw new Error(`Chrome for Testing 不提供 linux-${arch} 官方产物`);
  }
  throw new Error(`不支持的平台: ${platform}`);
}

/** 各平台解包后应出现在平台目录根部的可执行文件（与 bundled-resolver 候选一致） */
function expectedExecutable(platform) {
  if (platform === 'win32') return 'chrome.exe';
  if (platform === 'darwin')
    return 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  if (platform === 'linux') return 'chrome';
  throw new Error(`不支持的平台: ${platform}`);
}

function parseArgs(argv) {
  const options = {
    channel: undefined,
    version: CHROMIUM_VERSION,
    force: false,
    dryRun: false,
    platform: process.platform,
    arch: process.arch,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      ['--channel', '--version', '--platform', '--arch'].includes(arg) &&
      (!argv[i + 1] || argv[i + 1].startsWith('--'))
    )
      throw new Error(`Missing value for ${arg}`);
    if (arg === '--channel') options.channel = argv[++i];
    else if (arg === '--version') options.version = argv[++i];
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--arch') options.arch = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(
        '用法: node scripts/fetch-chromium.mjs [--channel stable] [--force] [--dry-run] [--platform p] [--arch a]'
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`拉取索引失败 ${res.status}: ${url}`);
  return res.json();
}

async function downloadFile(url, destFile) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  if (!res.body) throw new Error(`响应无内容: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
  const length = Number(res.headers.get('content-length'));
  if (length && statSync(destFile).size !== length) throw new Error('Incomplete browser download');
}

/** 用 tar（win/mac 自带 bsdtar，可解 zip）或 unzip（linux）解压 */
function extractZip(zipFile, destDir, platform) {
  if (process.platform === 'linux') {
    const unzip = spawnSync('unzip', ['-q', zipFile, '-d', destDir], { stdio: 'inherit' });
    if (unzip.error || unzip.status !== 0) {
      throw new Error('linux 解压需要 unzip（或改用支持 zip 的解压工具）');
    }
    return;
  }
  const tar = spawnSync('tar', ['-xf', zipFile, '-C', destDir], { stdio: 'inherit' });
  if (tar.error || tar.status !== 0) {
    throw new Error(`解压失败（tar${platform === 'win32' ? '' : '，可尝试安装 unzip'}）`);
  }
}

/** 把解压出的单个顶层目录内容拍平到平台目录根部（.app bundle 整体移动，不破坏结构） */
function flattenExtracted(extractDir, platformDir) {
  const entries = readdirSync(extractDir);
  if (entries.length !== 1) {
    throw new Error(`解压产物顶层应只有 1 个目录，实际: ${entries.join(', ')}`);
  }
  const inner = path.join(extractDir, entries[0]);
  for (const name of readdirSync(inner)) {
    renameSync(path.join(inner, name), path.join(platformDir, name));
  }
}

export async function ensureChromium(options) {
  const cftPlatform = cftPlatformName(options.platform, options.arch);
  const dirName = `${buildOsName(options.platform)}-${options.arch}`;
  const platformDir = path.join(DEST_ROOT, dirName);
  const executable = expectedExecutable(options.platform);
  const markerPath = path.join(platformDir, 'VERSION');

  console.log(`[fetch:chromium] 目标: ${path.relative(REPO_ROOT, platformDir)}`);

  if (
    !options.force &&
    isValidInstall(platformDir, executable, options.version) &&
    !options.channel
  ) {
    console.log(
      `[fetch:chromium] 已存在（版本 ${readFileSync(markerPath, 'utf8').trim()}），跳过。需要重下请加 --force`
    );
    return;
  }

  const channelName = options.channel ? canonicalChannel(options.channel) : 'Pinned';
  const index = await retry(() =>
    fetchJson(
      options.channel
        ? CFT_INDEX_URL
        : 'https://googlechromelabs.github.io/chrome-for-testing/' + options.version + '.json'
    )
  );
  const channel = options.channel ? index.channels?.[channelName] : index;
  if (!channel?.downloads?.chrome) {
    throw new Error(`索引中找不到 ${channelName} 频道的 chrome 下载项`);
  }
  const version = channel.version;
  const download = channel.downloads.chrome.find(item => item.platform === cftPlatform);
  if (!download) {
    throw new Error(`Chrome ${version} 没有 ${cftPlatform} 的下载项`);
  }

  console.log(`[fetch:chromium] ${channelName} → Chrome for Testing ${version} (${cftPlatform})`);
  if (options.dryRun) {
    console.log(`[fetch:chromium] --dry-run: ${download.url}`);
    return;
  }

  mkdirSync(DEST_ROOT, { recursive: true });
  const workDir = mkdtempSync(path.join(DEST_ROOT, '.fetch-chromium-'));
  const backup = path.join(workDir, 'previous');
  try {
    const zipFile = path.join(workDir, `chrome-${cftPlatform}.zip`);
    console.log(`[fetch:chromium] 下载中…`);
    await retry(() => downloadFile(download.url, zipFile));
    const extractDir = path.join(workDir, 'extracted');
    mkdirSync(extractDir);
    extractZip(zipFile, extractDir, options.platform);
    const stagedDir = path.join(workDir, 'staged');
    mkdirSync(stagedDir);
    flattenExtracted(extractDir, stagedDir);
    writeFileSync(path.join(stagedDir, 'VERSION'), version + String.fromCharCode(10), 'utf8');
    if (!isValidInstall(stagedDir, executable, version))
      throw new Error('Incomplete browser installation');
    if (existsSync(platformDir)) renameSync(platformDir, backup);
    try {
      renameSync(stagedDir, platformDir);
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, platformDir);
      throw error;
    }
    console.log(
      `[fetch:chromium] 完成: ${path.relative(REPO_ROOT, path.join(platformDir, executable))} (v${version})`
    );
  } finally {
    if (!existsSync(backup) || existsSync(platformDir))
      rmSync(workDir, { recursive: true, force: true });
  }
}

function isValidInstall(directory, executable, version) {
  try {
    if (readFileSync(path.join(directory, 'VERSION'), 'utf8').trim() !== version) return false;
    const file = path.join(directory, executable);
    if (!statSync(file).isFile() || statSync(file).size === 0) return false;
    accessSync(file, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function retry(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2) throw error;
      console.warn('[fetch:chromium] Retrying: ' + error.message);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureChromium(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(`[fetch:chromium] ${error.message}`);
    // 不用 process.exit()：Windows 下有未决 I/O 句柄时会触发 libuv 断言崩溃
    process.exitCode = 1;
  });
}
