/**
 * CLI 兼容性测试相关 IPC 处理器
 */

import { ipcMain } from 'electron';
import { CliCompatibilityResult } from '../cli-compat-service';
import { cliWrapperCompatService } from '../cli-wrapper-compat-service';
import { persistCliProbeSamples } from '../route-cli-probe-service';
import { unifiedConfigManager } from '../unified-config-manager';
import Logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { normalizeCodexFeatureFlagsToml } from '../../shared/types/cli-config';
import { buildProbeKey, buildSiteScopedProbeAccountId } from '../../shared/types/route-proxy';

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

type CliCompatExecutor = Pick<
  typeof cliWrapperCompatService,
  'testClaudeCodeWithDetail' | 'testCodexWithDetail' | 'testGeminiWithDetail'
>;

interface CliCompatibilityTestSample {
  cliType: 'claudeCode' | 'codex' | 'geminiCli';
  model: string;
  success: boolean;
  testedAt: number;
  statusCode?: number;
  error?: string;
  claudeDetail?: CliCompatibilityResult['claudeDetail'];
  codexDetail?: CliCompatibilityResult['codexDetail'];
  geminiDetail?: CliCompatibilityResult['geminiDetail'];
}

function extractStatusCodeFromMessage(message?: string): number | undefined {
  if (!message) {
    return undefined;
  }

  const patterns = [
    /status\s+code\s*[:=]?\s*(\d{3})/i,
    /\bhttp\s*[:=]?\s*(\d{3})\b/i,
    /"status"\s*:\s*(\d{3})/i,
    /\b(\d{3})\b(?=\s+(?:bad request|unauthorized|forbidden|not found|too many requests|server error))/i,
  ];

  for (const pattern of patterns) {
    const matched = message.match(pattern);
    const statusCode = matched?.[1] ? Number.parseInt(matched[1], 10) : Number.NaN;
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
      return statusCode;
    }
  }

  return undefined;
}

function summarizeCliFailure(message?: string, statusCode?: number): string | undefined {
  if (statusCode) {
    return `错误码 ${statusCode}`;
  }

  const normalized = message?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 93)}...`;
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
 * 合并 TOML section 内容
 * 只更新新配置中存在的参数，保留本地独有参数
 * @param existingLines - 现有 section 的行（键值对和注释）
 * @param newLines - 新 section 的行（键值对）
 * @returns 合并后的行数组
 */
function mergeSectionContent(existingLines: string[], newLines: string[]): string[] {
  // 解析新配置的键值对
  const newVars = new Map<string, string>();
  for (const line of newLines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      newVars.set(key, line);
    }
  }

  // 合并：更新现有的，保留独有的
  const resultLines: string[] = [];
  const updatedKeys = new Set<string>();

  for (const line of existingLines) {
    const trimmedLine = line.trim();
    // 保留注释和空行
    if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
      resultLines.push(line);
      continue;
    }

    const eqIndex = trimmedLine.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmedLine.substring(0, eqIndex).trim();
      if (newVars.has(key)) {
        // 更新现有参数
        resultLines.push(newVars.get(key)!);
        updatedKeys.add(key);
      } else {
        // 保留本地独有参数
        resultLines.push(line);
      }
    } else {
      resultLines.push(line);
    }
  }

  // 添加新配置中独有的参数
  for (const [key, value] of newVars) {
    if (!updatedKeys.has(key)) {
      resultLines.push(value);
    }
  }

  return resultLines;
}

/**
 * 获取 section 的父级前缀
 * 例如: "model_providers.MyProvider" -> "model_providers"
 * @param section - section 名称
 * @returns 父级前缀，如果没有则返回 null
 */
function getSectionParentPrefix(section: string): string | null {
  const dotIndex = section.indexOf('.');
  if (dotIndex > 0) {
    return section.substring(0, dotIndex);
  }
  return null;
}

/**
 * 合并 TOML 配置文件
 * 智能合并：
 * - 顶级参数：只更新新配置中存在的参数，保留本地独有参数
 * - 普通 section：合并 section 内容
 * - 嵌套 section（如 model_providers.XXX）：如果新配置有同一父级的 section，
 *   则移除旧的子 section，只保留新配置中的子 section
 * @param existingContent - 现有文件内容
 * @param newContent - 新配置内容
 * @returns 合并后的 TOML 内容
 */
function mergeTomlConfig(existingContent: string, newContent: string): string {
  // 解析新配置中的顶级键值对和 sections
  const newTopLevelVars = new Map<string, string>();
  const newSections = new Map<string, string[]>();
  const newSectionParents = new Set<string>(); // 新配置中有子 section 的父级前缀
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
      // 记录父级前缀
      const parent = getSectionParentPrefix(currentSection);
      if (parent) {
        newSectionParents.add(parent);
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

  // 解析现有配置，收集每个 section 的内容
  const existingSections = new Map<string, string[]>();
  let existingCurrentSection = '';
  const existingLines = existingContent.split('\n');

  for (const line of existingLines) {
    const trimmedLine = line.trim();
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      existingCurrentSection = sectionMatch[1];
      if (!existingSections.has(existingCurrentSection)) {
        existingSections.set(existingCurrentSection, []);
      }
    } else if (existingCurrentSection) {
      existingSections.get(existingCurrentSection)!.push(line);
    }
  }

  // 处理现有配置，构建结果
  const resultLines: string[] = [];
  const updatedTopLevelKeys = new Set<string>();
  const processedSections = new Set<string>();
  const skippedSections = new Set<string>(); // 需要跳过的旧 section
  existingCurrentSection = '';

  for (const line of existingLines) {
    const trimmedLine = line.trim();

    // 检测 section 头
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      existingCurrentSection = sectionMatch[1];

      // 检查是否是嵌套 section，且新配置有同一父级的 section
      const parent = getSectionParentPrefix(existingCurrentSection);
      if (parent && newSectionParents.has(parent) && !newSections.has(existingCurrentSection)) {
        // 新配置有同一父级的子 section，但不包含这个具体的子 section
        // 跳过这个旧的子 section（不保留）
        skippedSections.add(existingCurrentSection);
        continue;
      }

      resultLines.push(line);

      // 如果新配置有这个 section，合并 section 内容
      if (newSections.has(existingCurrentSection)) {
        const existingSectionLines = existingSections.get(existingCurrentSection) || [];
        const newSectionLines = newSections.get(existingCurrentSection)!;
        const mergedLines = mergeSectionContent(existingSectionLines, newSectionLines);
        resultLines.push(...mergedLines);
        processedSections.add(existingCurrentSection);
      } else {
        // 保留原有 section 内容
        const existingSectionLines = existingSections.get(existingCurrentSection) || [];
        resultLines.push(...existingSectionLines);
      }
      continue;
    }

    // 如果在被跳过的 section 内，跳过这些行
    if (skippedSections.has(existingCurrentSection)) {
      continue;
    }

    // 如果在 section 内，跳过（已经在上面处理过了）
    if (existingCurrentSection) {
      continue;
    }

    // 处理顶级键值对
    const eqIndex = trimmedLine.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmedLine.substring(0, eqIndex).trim();
      if (newTopLevelVars.has(key)) {
        resultLines.push(newTopLevelVars.get(key)!);
        updatedTopLevelKeys.add(key);
        continue;
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
      } else if (firstSectionIndex === 0) {
        resultLines.unshift(value);
      } else {
        resultLines.push(value);
      }
    }
  }

  // 添加新的 sections（不在现有文件中的）
  for (const [section, lines] of newSections) {
    if (!processedSections.has(section) && !existingSections.has(section)) {
      resultLines.push('');
      resultLines.push(`[${section}]`);
      for (const sectionLine of lines) {
        resultLines.push(sectionLine);
      }
    }
  }

  // 清理多余的连续空白行（保留最多一个空白行）
  const cleanedLines: string[] = [];
  let lastWasEmpty = false;
  for (const line of resultLines) {
    const isEmpty = line.trim() === '';
    if (isEmpty && lastWasEmpty) {
      // 跳过连续的空白行
      continue;
    }
    cleanedLines.push(line);
    lastWasEmpty = isEmpty;
  }

  // 移除开头和结尾的空白行
  while (cleanedLines.length > 0 && cleanedLines[0].trim() === '') {
    cleanedLines.shift();
  }
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
    cleanedLines.pop();
  }

  return cleanedLines.join('\n');
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
    return normalizeCodexFeatureFlagsToml(mergeTomlConfig(existingContent, newContent));
  } else if (ext === '.env' || basename === '.env') {
    return mergeEnvConfig(existingContent, newContent);
  }

  // 默认直接覆盖
  return newContent;
}

async function runCliCompatibilityTests(
  params: TestWithConfigParams,
  executor: CliCompatExecutor,
  options?: { parallel?: boolean }
): Promise<{ summary: Partial<CliCompatibilityResult>; samples: CliCompatibilityTestSample[] }> {
  const results: Partial<CliCompatibilityResult> = {
    claudeCode: null,
    claudeDetail: undefined,
    claudeError: undefined,
    codex: null,
    codexDetail: undefined,
    codexError: undefined,
    geminiCli: null,
    geminiDetail: undefined,
    geminiError: undefined,
  };
  const samples: CliCompatibilityTestSample[] = [];
  const latestFailureSummaryByCli: Partial<
    Record<CliCompatibilityTestSample['cliType'], string | undefined>
  > = {};

  const testSingleConfig = async (config: CliTestConfig) => {
    const testUrl = config.baseUrl || params.siteUrl;
    const testedAt = Date.now();

    try {
      switch (config.cliType) {
        case 'claudeCode': {
          const claudeResult = await executor.testClaudeCodeWithDetail(
            testUrl,
            config.apiKey,
            config.model
          );
          log.info(
            `CLI test ${config.cliType} (${config.model}, ${testUrl}): ${claudeResult.supported ? 'passed' : 'failed'}`
          );
          return {
            cliType: config.cliType,
            model: config.model,
            success: claudeResult.supported ?? false,
            testedAt,
            error: claudeResult.message,
            statusCode: extractStatusCodeFromMessage(claudeResult.message),
            claudeDetail: claudeResult.detail,
          };
        }
        case 'codex': {
          const codexResult = await executor.testCodexWithDetail(
            testUrl,
            config.apiKey,
            config.model
          );
          log.info(
            `CLI test ${config.cliType} (${config.model}, ${testUrl}): ${codexResult.supported ? 'passed' : 'failed'}`
          );
          return {
            cliType: config.cliType,
            model: config.model,
            success: codexResult.supported ?? false,
            testedAt,
            error: codexResult.message,
            statusCode: extractStatusCodeFromMessage(codexResult.message),
            codexDetail: codexResult.detail,
          };
        }
        case 'geminiCli': {
          const geminiResult = await executor.testGeminiWithDetail(
            testUrl,
            config.apiKey,
            config.model
          );
          log.info(
            `CLI test ${config.cliType} (${config.model}, ${testUrl}): ${geminiResult.supported ? 'passed' : 'failed'}`
          );
          return {
            cliType: config.cliType,
            model: config.model,
            success: geminiResult.supported ?? false,
            testedAt,
            error: geminiResult.message,
            statusCode: extractStatusCodeFromMessage(geminiResult.message),
            geminiDetail: geminiResult.detail,
          };
        }
      }
    } catch (error: any) {
      const message = error.message;
      log.warn(`CLI test ${config.cliType} (${config.model}) error: ${error.message}`);
      return {
        cliType: config.cliType,
        model: config.model,
        success: false,
        testedAt,
        error: message,
        statusCode: extractStatusCodeFromMessage(message),
      };
    }

    return null;
  };

  const testResults = options?.parallel
    ? await Promise.all(params.configs.map(testSingleConfig))
    : await (async () => {
        const sequentialResults: Array<Awaited<ReturnType<typeof testSingleConfig>>> = [];
        for (const config of params.configs) {
          sequentialResults.push(await testSingleConfig(config));
        }
        return sequentialResults;
      })();

  for (const testResult of testResults) {
    if (!testResult) continue;
    samples.push({
      cliType: testResult.cliType,
      model: testResult.model,
      success: testResult.success,
      testedAt: testResult.testedAt,
      statusCode: testResult.statusCode,
      error: testResult.error,
      claudeDetail: testResult.claudeDetail,
      codexDetail: testResult.codexDetail,
      geminiDetail: testResult.geminiDetail,
    });
    if (!testResult.success) {
      latestFailureSummaryByCli[testResult.cliType] = summarizeCliFailure(
        testResult.error,
        testResult.statusCode
      );
    }

    switch (testResult.cliType) {
      case 'claudeCode':
        results.claudeCode = results.claudeCode === true ? true : testResult.success;
        if (testResult.claudeDetail && (testResult.success || !results.claudeDetail)) {
          results.claudeDetail = testResult.claudeDetail;
        }
        break;
      case 'codex':
        results.codex = results.codex === true ? true : testResult.success;
        if (testResult.codexDetail && (testResult.success || !results.codexDetail)) {
          results.codexDetail = testResult.codexDetail;
        }
        break;
      case 'geminiCli':
        results.geminiCli = results.geminiCli === true ? true : testResult.success;
        if (testResult.geminiDetail && (testResult.success || !results.geminiDetail)) {
          results.geminiDetail = testResult.geminiDetail;
        }
        break;
    }
  }

  results.claudeError =
    results.claudeCode === false ? latestFailureSummaryByCli.claudeCode : undefined;
  results.codexError = results.codex === false ? latestFailureSummaryByCli.codex : undefined;
  results.geminiError =
    results.geminiCli === false ? latestFailureSummaryByCli.geminiCli : undefined;

  return { summary: results, samples };
}

/**
 * 注册 CLI 兼容性测试相关的 IPC 处理器
 */
export function registerCliCompatHandlers() {
  ipcMain.handle('cli-compat:test-with-wrapper', async (_, params: TestWithConfigParams) => {
    try {
      log.info(`Testing CLI compatibility with wrapper for site: ${params.siteUrl}`);
      const results = await runCliCompatibilityTests(params, cliWrapperCompatService, {
        parallel: false,
      });
      return { success: true, data: results.summary, samples: results.samples };
    } catch (error: any) {
      log.error(`CLI wrapper compatibility test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 保存 CLI 兼容性结果到缓存
  ipcMain.handle(
    'cli-compat:save-result',
    async (
      _,
      siteUrl: string,
      result: CliCompatibilityResult,
      accountId?: string,
      samples?: CliCompatibilityTestSample[]
    ) => {
      try {
        log.info(
          `Saving CLI compatibility result for ${accountId ? `account: ${accountId}` : `site: ${siteUrl}`}`
        );

        const site = unifiedConfigManager.getSiteByUrl(siteUrl);
        if (!site) {
          log.warn(`Site not found for URL: ${siteUrl}`);
          return { success: false, error: 'Site not found' };
        }

        if (accountId && !unifiedConfigManager.getAccountById(accountId)) {
          log.warn(`Account not found for id: ${accountId}`);
          return { success: false, error: 'Account not found' };
        }

        const ownerAccountId = accountId || buildSiteScopedProbeAccountId(site.id);
        const probeSamples = (samples || []).map((sample, index) => {
          const probeKey = buildProbeKey(site.id, ownerAccountId, sample.cliType, sample.model);
          return {
            sampleId: `manual_${Date.now()}_${index}`,
            probeKey,
            siteId: site.id,
            accountId: ownerAccountId,
            cliType: sample.cliType,
            canonicalModel: sample.model,
            rawModel: sample.model,
            success: sample.success,
            source: 'siteManual' as const,
            statusCode: sample.statusCode,
            error: sample.error,
            claudeDetail: sample.claudeDetail,
            codexDetail: sample.codexDetail,
            geminiDetail: sample.geminiDetail,
            testedAt:
              typeof sample.testedAt === 'number'
                ? sample.testedAt
                : typeof result.testedAt === 'number'
                  ? result.testedAt
                  : Date.now(),
          };
        });

        if (probeSamples.length > 0) {
          await persistCliProbeSamples(probeSamples);
        }

        log.info(`CLI compatibility result saved for ${siteUrl}`);
        return { success: true };
      } catch (error: any) {
        log.error(`Failed to save CLI compatibility result: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  );

  // 保存 CLI 配置到站点配置（不是 cached_data，这样备份时不会丢失）
  ipcMain.handle(
    'cli-compat:save-config',
    async (_, siteUrl: string, cliConfig: any, accountId?: string) => {
      try {
        log.info(
          `Saving CLI config for ${accountId ? `account: ${accountId}` : `site: ${siteUrl}`}`
        );

        if (accountId) {
          const updated = await unifiedConfigManager.updateAccount(accountId, {
            cli_config: cliConfig,
          });

          if (!updated) {
            log.warn(`Account not found for id: ${accountId}`);
            return { success: false, error: 'Account not found' };
          }

          log.info(`CLI config saved for account ${accountId}`);
          return { success: true };
        }

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
    }
  );

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
          if (path.basename(file.path).toLowerCase() === 'config.toml') {
            finalContent = normalizeCodexFeatureFlagsToml(finalContent);
          }

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
