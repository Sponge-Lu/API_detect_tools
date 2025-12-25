/**
 * CLI 兼容性测试相关 IPC 处理器
 */

import { ipcMain } from 'electron';
import { cliCompatService, CliCompatibilityResult } from '../cli-compat-service';
import { unifiedConfigManager } from '../unified-config-manager';
import Logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const log = Logger.scope('CliCompatHandlers');

interface CliTestConfig {
  cliType: 'claudeCode' | 'codex' | 'geminiCli';
  apiKey: string;
  model: string;
  baseUrl?: string; // 可选的 baseUrl，如果提供则使用此 URL 而非 siteUrl
}

interface TestWithConfigParams {
  siteUrl: string;
  configs: CliTestConfig[];
}

/** 配置文件写入参数 */
interface WriteCliConfigParams {
  cliType: 'claudeCode' | 'codex' | 'geminiCli';
  files: Array<{
    path: string;
    content: string;
  }>;
  applyMode?: 'merge' | 'overwrite'; // 应用模式：合并或覆盖，默认合并
}

/** 配置文件写入结果 */
interface WriteCliConfigResult {
  success: boolean;
  writtenPaths: string[];
  error?: string;
}

/**
 * 解析配置文件路径，将 ~ 替换为用户主目录
 * @param filePath - 原始路径（可能包含 ~）
 * @returns 解析后的绝对路径
 */
function resolveConfigPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * 确保目录存在，如果不存在则创建
 * @param dirPath - 目录路径
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 深度合并两个对象
 * @param target - 目标对象（现有配置）
 * @param source - 源对象（新配置）
 * @returns 合并后的对象
 */
function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * 合并 JSON 配置文件
 * @param existingContent - 现有文件内容
 * @param newContent - 新配置内容
 * @returns 合并后的 JSON 字符串
 */
function mergeJsonConfig(existingContent: string, newContent: string): string {
  try {
    const existingConfig = JSON.parse(existingContent);
    const newConfig = JSON.parse(newContent);
    const mergedConfig = deepMerge(existingConfig, newConfig);
    return JSON.stringify(mergedConfig, null, 2);
  } catch {
    // 如果解析失败，直接使用新配置
    return newContent;
  }
}

/**
 * 合并 .env 配置文件
 * 只更新新配置中存在的环境变量，保留其他变量
 * @param existingContent - 现有文件内容
 * @param newContent - 新配置内容
 * @returns 合并后的 .env 内容
 */
function mergeEnvConfig(existingContent: string, newContent: string): string {
  // 解析现有的环境变量
  const existingVars = new Map<string, string>();
  const existingLines: string[] = [];

  for (const line of existingContent.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const eqIndex = trimmedLine.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmedLine.substring(0, eqIndex);
        const value = trimmedLine.substring(eqIndex + 1);
        existingVars.set(key, value);
      }
    }
    existingLines.push(line);
  }

  // 解析新的环境变量
  const newVars = new Map<string, string>();
  for (const line of newContent.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const eqIndex = trimmedLine.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmedLine.substring(0, eqIndex);
        const value = trimmedLine.substring(eqIndex + 1);
        newVars.set(key, value);
      }
    }
  }

  // 更新现有变量或添加新变量
  const resultLines: string[] = [];
  const updatedKeys = new Set<string>();

  for (const line of existingLines) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const eqIndex = trimmedLine.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmedLine.substring(0, eqIndex);
        if (newVars.has(key)) {
          // 更新现有变量
          resultLines.push(`${key}=${newVars.get(key)}`);
          updatedKeys.add(key);
        } else {
          // 保留原有变量
          resultLines.push(line);
        }
      } else {
        resultLines.push(line);
      }
    } else {
      resultLines.push(line);
    }
  }

  // 添加新的变量（不在现有文件中的）
  for (const [key, value] of newVars) {
    if (!updatedKeys.has(key)) {
      resultLines.push(`${key}=${value}`);
    }
  }

  return resultLines.join('\n');
}

/**
 * 合并 TOML 配置文件
 * 简单实现：只更新特定的配置项
 * @param existingContent - 现有文件内容
 * @param newContent - 新配置内容
 * @returns 合并后的 TOML 内容
 */
function mergeTomlConfig(existingContent: string, newContent: string): string {
  // 解析新配置中的顶级键值对
  const newTopLevelVars = new Map<string, string>();
  const newSections = new Map<string, string[]>();
  let currentSection = '';

  for (const line of newContent.split('\n')) {
    const trimmedLine = line.trim();

    // 跳过注释和空行
    if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
      continue;
    }

    // 检测 section 头
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!newSections.has(currentSection)) {
        newSections.set(currentSection, []);
      }
      continue;
    }

    // 解析键值对
    const eqIndex = trimmedLine.indexOf('=');
    if (eqIndex > 0) {
      if (currentSection) {
        newSections.get(currentSection)!.push(trimmedLine);
      } else {
        const key = trimmedLine.substring(0, eqIndex).trim();
        newTopLevelVars.set(key, trimmedLine);
      }
    }
  }

  // 处理现有配置
  const resultLines: string[] = [];
  const updatedTopLevelKeys = new Set<string>();
  const updatedSections = new Set<string>();
  let existingCurrentSection = '';
  let skipUntilNextSection = false;

  for (const line of existingContent.split('\n')) {
    const trimmedLine = line.trim();

    // 检测 section 头
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      existingCurrentSection = sectionMatch[1];

      // 如果新配置有这个 section，替换整个 section
      if (newSections.has(existingCurrentSection)) {
        resultLines.push(line);
        for (const sectionLine of newSections.get(existingCurrentSection)!) {
          resultLines.push(sectionLine);
        }
        updatedSections.add(existingCurrentSection);
        skipUntilNextSection = true;
        continue;
      } else {
        skipUntilNextSection = false;
      }
    }

    if (skipUntilNextSection) {
      // 跳过被替换 section 的内容
      if (!sectionMatch) continue;
    }

    // 处理顶级键值对
    if (!existingCurrentSection || sectionMatch) {
      const eqIndex = trimmedLine.indexOf('=');
      if (eqIndex > 0 && !existingCurrentSection) {
        const key = trimmedLine.substring(0, eqIndex).trim();
        if (newTopLevelVars.has(key)) {
          resultLines.push(newTopLevelVars.get(key)!);
          updatedTopLevelKeys.add(key);
          continue;
        }
      }
    }

    resultLines.push(line);
  }

  // 添加新的顶级变量
  for (const [key, value] of newTopLevelVars) {
    if (!updatedTopLevelKeys.has(key)) {
      // 在第一个 section 之前插入
      const firstSectionIndex = resultLines.findIndex(l => l.trim().startsWith('['));
      if (firstSectionIndex > 0) {
        resultLines.splice(firstSectionIndex, 0, value);
      } else {
        resultLines.unshift(value);
      }
    }
  }

  // 添加新的 sections
  for (const [section, lines] of newSections) {
    if (!updatedSections.has(section)) {
      resultLines.push('');
      resultLines.push(`[${section}]`);
      for (const sectionLine of lines) {
        resultLines.push(sectionLine);
      }
    }
  }

  return resultLines.join('\n');
}

/**
 * 根据文件类型合并配置
 * @param filePath - 文件路径
 * @param existingContent - 现有内容
 * @param newContent - 新内容
 * @returns 合并后的内容
 */
function mergeConfigByType(filePath: string, existingContent: string, newContent: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (ext === '.json') {
    return mergeJsonConfig(existingContent, newContent);
  } else if (ext === '.toml') {
    return mergeTomlConfig(existingContent, newContent);
  } else if (ext === '.env' || basename === '.env') {
    return mergeEnvConfig(existingContent, newContent);
  }

  // 默认直接覆盖
  return newContent;
}

/**
 * 注册 CLI 兼容性测试相关的 IPC 处理器
 */
export function registerCliCompatHandlers() {
  // 使用配置测试 CLI 兼容性
  ipcMain.handle('cli-compat:test-with-config', async (_, params: TestWithConfigParams) => {
    try {
      log.info(`Testing CLI compatibility for site: ${params.siteUrl}`);

      const results: Partial<CliCompatibilityResult> = {
        claudeCode: null,
        codex: null,
        codexDetail: undefined,
        geminiCli: null,
        geminiDetail: undefined,
      };

      // 并发测试所有配置的 CLI
      await Promise.all(
        params.configs.map(async config => {
          try {
            let success = false;
            // 优先使用配置中的 baseUrl，否则使用 siteUrl
            const testUrl = config.baseUrl || params.siteUrl;

            switch (config.cliType) {
              case 'claudeCode':
                success = await cliCompatService.testClaudeCode(
                  testUrl,
                  config.apiKey,
                  config.model
                );
                results.claudeCode = success;
                break;
              case 'codex': {
                // 使用 testCodexWithDetail 获取详细测试结果
                const codexResult = await cliCompatService.testCodexWithDetail(
                  testUrl,
                  config.apiKey,
                  config.model
                );
                results.codex = codexResult.supported;
                results.codexDetail = codexResult.detail;
                success = codexResult.supported ?? false;
                break;
              }
              case 'geminiCli': {
                // 使用 testGeminiWithDetail 获取详细测试结果
                const geminiResult = await cliCompatService.testGeminiWithDetail(
                  testUrl,
                  config.apiKey,
                  config.model
                );
                results.geminiCli = geminiResult.supported;
                results.geminiDetail = geminiResult.detail;
                success = geminiResult.supported ?? false;
                break;
              }
            }

            log.info(`CLI test ${config.cliType} (${testUrl}): ${success ? 'passed' : 'failed'}`);
          } catch (error: any) {
            log.warn(`CLI test ${config.cliType} error: ${error.message}`);
            results[config.cliType] = false;
          }
        })
      );

      return { success: true, data: results };
    } catch (error: any) {
      log.error(`CLI compatibility test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 保存 CLI 兼容性结果到缓存
  ipcMain.handle(
    'cli-compat:save-result',
    async (_, siteUrl: string, result: CliCompatibilityResult) => {
      try {
        log.info(`Saving CLI compatibility result for site: ${siteUrl}`);

        const site = unifiedConfigManager.getSiteByUrl(siteUrl);
        if (!site) {
          log.warn(`Site not found for URL: ${siteUrl}`);
          return { success: false, error: 'Site not found' };
        }

        // 更新站点的 cached_data，添加 cli_compatibility
        const currentCachedData = site.cached_data || {
          models: [],
          last_refresh: Date.now(),
        };

        await unifiedConfigManager.updateSite(site.id, {
          cached_data: {
            ...currentCachedData,
            cli_compatibility: {
              claudeCode: result.claudeCode,
              codex: result.codex,
              codexDetail: result.codexDetail, // 保存 Codex 详细测试结果
              geminiCli: result.geminiCli,
              geminiDetail: result.geminiDetail, // 保存 Gemini CLI 详细测试结果
              testedAt: result.testedAt,
              error: result.error,
            },
          },
        });

        log.info(`CLI compatibility result saved for ${siteUrl}`);
        return { success: true };
      } catch (error: any) {
        log.error(`Failed to save CLI compatibility result: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  );

  // 保存 CLI 配置到站点配置（不是 cached_data，这样备份时不会丢失）
  ipcMain.handle('cli-compat:save-config', async (_, siteUrl: string, cliConfig: any) => {
    try {
      log.info(`Saving CLI config for site: ${siteUrl}`);

      const site = unifiedConfigManager.getSiteByUrl(siteUrl);
      if (!site) {
        log.warn(`Site not found for URL: ${siteUrl}`);
        return { success: false, error: 'Site not found' };
      }

      // 直接更新站点的 cli_config 字段（不是 cached_data）
      await unifiedConfigManager.updateSite(site.id, {
        cli_config: cliConfig,
      });

      log.info(`CLI config saved for ${siteUrl}`);
      return { success: true };
    } catch (error: any) {
      log.error(`Failed to save CLI config: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 写入 CLI 配置文件到文件系统（支持合并和覆盖模式）
  ipcMain.handle(
    'cli-compat:write-config',
    async (_, params: WriteCliConfigParams): Promise<WriteCliConfigResult> => {
      const applyMode = params.applyMode || 'merge';
      try {
        log.info(`Writing CLI config files for: ${params.cliType} (${applyMode} mode)`);

        const writtenPaths: string[] = [];

        for (const file of params.files) {
          const resolvedPath = resolveConfigPath(file.path);
          const dirPath = path.dirname(resolvedPath);

          // 确保目录存在
          ensureDirectoryExists(dirPath);

          let finalContent = file.content;

          // 如果是合并模式且文件已存在，合并配置
          if (applyMode === 'merge' && fs.existsSync(resolvedPath)) {
            try {
              const existingContent = fs.readFileSync(resolvedPath, 'utf-8');
              finalContent = mergeConfigByType(file.path, existingContent, file.content);
              log.info(`Merged config file: ${resolvedPath}`);
            } catch (readError: any) {
              log.warn(`Failed to read existing config, will overwrite: ${readError.message}`);
            }
          } else if (applyMode === 'overwrite') {
            log.info(`Overwriting config file: ${resolvedPath}`);
          }

          // 写入文件
          fs.writeFileSync(resolvedPath, finalContent, 'utf-8');
          writtenPaths.push(resolvedPath);

          log.info(`Written config file: ${resolvedPath}`);
        }

        log.info(`CLI config files written successfully for ${params.cliType}`);
        return { success: true, writtenPaths };
      } catch (error: any) {
        log.error(`Failed to write CLI config files: ${error.message}`);
        return { success: false, writtenPaths: [], error: error.message };
      }
    }
  );

  log.info('CLI compatibility handlers registered');
}
