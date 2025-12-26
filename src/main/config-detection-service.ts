/**
 * 输入: 站点列表
 * 输出: CLI 配置检测结果
 * 定位: 服务层 - CLI 配置检测服务
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  CliDetectionResult,
  AllCliDetectionResult,
  SiteInfo,
  CliType,
  createDefaultDetectionResult,
} from '../shared/types/config-detection';
import {
  getEffectiveGeminiConfig,
  getEffectiveClaudeCodeConfig,
  getEffectiveCodexConfig,
} from './utils/config-parsers';
import { determineSourceType } from './utils/site-matcher';

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
 * 缓存条目
 */
interface CacheEntry {
  result: CliDetectionResult;
  timestamp: number;
}

/**
 * 缓存配置
 */
interface CacheConfig {
  /** 缓存过期时间（毫秒），默认 5 分钟 */
  ttl: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 5 * 60 * 1000, // 5 分钟
};

/**
 * CLI 配置检测服务
 *
 * 负责检测 Claude Code、Codex、Gemini CLI 三个 CLI 工具当前正在使用的配置来源
 */
export class ConfigDetectionService {
  private cache: Map<CliType, CacheEntry> = new Map();
  private cacheConfig: CacheConfig;

  constructor(cacheConfig: Partial<CacheConfig> = {}) {
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
  }

  /**
   * 检测所有 CLI 配置
   * @param sites 站点列表
   * @returns 所有 CLI 的检测结果
   */
  async detectAll(sites: SiteInfo[]): Promise<AllCliDetectionResult> {
    const [claudeCode, codex, geminiCli] = await Promise.all([
      this.detectClaudeCode(sites),
      this.detectCodex(sites),
      this.detectGeminiCli(sites),
    ]);

    return {
      claudeCode,
      codex,
      geminiCli,
    };
  }

  /**
   * 检测 Claude Code 配置
   *
   * 使用 getEffectiveClaudeCodeConfig() 获取真正生效的配置，
   * 正确处理配置优先级：
   * 1. 环境变量 ANTHROPIC_BASE_URL
   * 2. settings.json env.ANTHROPIC_BASE_URL
   *
   * @param sites 站点列表
   * @returns 检测结果
   *
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
   */
  async detectClaudeCode(sites: SiteInfo[]): Promise<CliDetectionResult> {
    // 检查缓存
    const cached = this.getFromCache('claudeCode');
    if (cached) {
      return cached;
    }

    try {
      // 使用新的有效配置获取函数
      const { baseUrl, hasApiKey, authType } = getEffectiveClaudeCodeConfig();

      const { sourceType, siteName, siteId } = determineSourceType({
        baseUrl,
        hasApiKey,
        authType,
        cliType: 'claudeCode',
        sites,
      });

      const result: CliDetectionResult = {
        sourceType,
        siteName,
        siteId,
        baseUrl,
        hasApiKey,
        authType,
        detectedAt: Date.now(),
      };

      // 存入缓存
      this.setCache('claudeCode', result);

      return result;
    } catch (error) {
      log.error('Failed to detect Claude Code config', error);
      const result: CliDetectionResult = {
        ...createDefaultDetectionResult(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      return result;
    }
  }

  /**
   * 检测 Codex 配置
   *
   * 使用 getEffectiveCodexConfig() 获取真正生效的配置，
   * 正确处理配置优先级：
   * 1. ChatGPT OAuth 凭证存在 → official
   * 2. 官方 API Key (sk-*) → official (优先于站点配置)
   * 3. config.toml model_provider.base_url
   * 4. 环境变量/auth.json OPENAI_API_KEY
   *
   * @param sites 站点列表
   * @returns 检测结果
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4
   */
  async detectCodex(sites: SiteInfo[]): Promise<CliDetectionResult> {
    // 检查缓存
    const cached = this.getFromCache('codex');
    if (cached) {
      return cached;
    }

    try {
      // 使用新的有效配置获取函数
      const { baseUrl, hasApiKey, authType, isOfficialApiKey } = getEffectiveCodexConfig();

      // Requirements 2.1, 2.2, 2.3: 传递 isOfficialApiKey 参数给 determineSourceType
      const { sourceType, siteName, siteId } = determineSourceType({
        baseUrl,
        hasApiKey,
        authType,
        isOfficialApiKey,
        cliType: 'codex',
        sites,
      });

      const result: CliDetectionResult = {
        sourceType,
        siteName,
        siteId,
        baseUrl,
        hasApiKey,
        authType,
        detectedAt: Date.now(),
      };

      // 存入缓存
      this.setCache('codex', result);

      return result;
    } catch (error) {
      log.error('Failed to detect Codex config', error);
      const result: CliDetectionResult = {
        ...createDefaultDetectionResult(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      return result;
    }
  }

  /**
   * 检测 Gemini CLI 配置
   *
   * 使用 getEffectiveGeminiConfig() 获取真正生效的配置，
   * 正确处理认证类型优先级：
   * 1. google-login/vertex-ai → subscription
   * 2. gemini-api-key → 检测 base_url
   *
   * @param sites 站点列表
   * @returns 检测结果
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
   */
  async detectGeminiCli(sites: SiteInfo[]): Promise<CliDetectionResult> {
    // 检查缓存
    const cached = this.getFromCache('geminiCli');
    if (cached) {
      return cached;
    }

    try {
      // 使用新的有效配置获取函数
      const { baseUrl, hasApiKey, authType, isSubscription } = getEffectiveGeminiConfig();

      const { sourceType, siteName, siteId } = determineSourceType({
        baseUrl,
        hasApiKey,
        authType,
        isSubscription,
        cliType: 'geminiCli',
        sites,
      });

      const result: CliDetectionResult = {
        sourceType,
        siteName,
        siteId,
        baseUrl,
        hasApiKey,
        authType,
        detectedAt: Date.now(),
      };

      // 存入缓存
      this.setCache('geminiCli', result);

      return result;
    } catch (error) {
      log.error('Failed to detect Gemini CLI config', error);
      const result: CliDetectionResult = {
        ...createDefaultDetectionResult(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      return result;
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清除指定 CLI 的缓存
   * @param cliType CLI 类型
   */
  clearCacheFor(cliType: CliType): void {
    this.cache.delete(cliType);
  }

  /**
   * 检查缓存是否有效
   * @param cliType CLI 类型
   * @returns 是否有有效缓存
   */
  hasCacheFor(cliType: CliType): boolean {
    const entry = this.cache.get(cliType);
    if (!entry) {
      return false;
    }
    return Date.now() - entry.timestamp < this.cacheConfig.ttl;
  }

  /**
   * 从缓存获取结果
   * @param cliType CLI 类型
   * @returns 缓存的结果，如果缓存无效则返回 null
   */
  private getFromCache(cliType: CliType): CliDetectionResult | null {
    const entry = this.cache.get(cliType);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp >= this.cacheConfig.ttl) {
      this.cache.delete(cliType);
      return null;
    }

    log.debug(`Cache hit for ${cliType}`);
    return entry.result;
  }

  /**
   * 设置缓存
   * @param cliType CLI 类型
   * @param result 检测结果
   */
  private setCache(cliType: CliType, result: CliDetectionResult): void {
    this.cache.set(cliType, {
      result,
      timestamp: Date.now(),
    });
  }
}

// 导出单例实例
export const configDetectionService = new ConfigDetectionService();
