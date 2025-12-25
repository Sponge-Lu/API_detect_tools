/**
 * 输入: 模拟的 CLI 兼容性持久化参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CLI 兼容性持久化的属性测试，验证数据存储和恢复逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: cli-compat-persistence**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ============= Types =============

/** CLI 兼容性测试结果 */
interface CliCompatibilityResult {
  claudeCode: boolean | null;
  codex: boolean | null;
  geminiCli: boolean | null;
  testedAt: number | null;
  error?: string;
}

/** 站点配置（简化版，用于测试） */
interface SiteConfig {
  name: string;
  url: string;
  cached_data?: {
    models: string[];
    last_refresh: number;
    cli_compatibility?: CliCompatibilityResult;
  };
  cli_compatibility?: CliCompatibilityResult; // 兼容旧版本数据结构
}

/** Config 类型（简化版） */
interface Config {
  sites: SiteConfig[];
}

// ============= 纯函数实现（从 useDataLoader.ts 提取的核心逻辑） =============

/**
 * 验证 CLI 兼容性数据格式是否有效
 */
function isValidCliCompatibility(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return 'claudeCode' in obj || 'codex' in obj || 'geminiCli' in obj;
}

/**
 * 规范化 CLI 兼容性数据，处理部分损坏的数据
 */
function normalizeCliCompatibility(data: unknown): CliCompatibilityResult | null {
  if (!isValidCliCompatibility(data)) {
    return null;
  }

  const obj = data as Record<string, unknown>;
  return {
    claudeCode: typeof obj.claudeCode === 'boolean' ? obj.claudeCode : null,
    codex: typeof obj.codex === 'boolean' ? obj.codex : null,
    geminiCli: typeof obj.geminiCli === 'boolean' ? obj.geminiCli : null,
    testedAt: typeof obj.testedAt === 'number' ? obj.testedAt : null,
    error: typeof obj.error === 'string' ? obj.error : undefined,
  };
}

/**
 * 从站点配置中提取 CLI 兼容性数据
 * 优先从 cached_data 加载，兼容从站点根级别加载
 */
function extractCliCompatibility(site: SiteConfig): CliCompatibilityResult | null {
  const rawData = site.cached_data?.cli_compatibility || site.cli_compatibility;
  if (!rawData) {
    return null;
  }
  return normalizeCliCompatibility(rawData);
}

/**
 * 模拟 loadCachedData 中的 CLI 兼容性加载逻辑
 * 返回一个 Record<siteName, CliCompatibilityResult>
 */
function loadCliCompatibilityFromConfig(config: Config): Record<string, CliCompatibilityResult> {
  const result: Record<string, CliCompatibilityResult> = {};

  for (const site of config.sites) {
    const cliCompatibility = extractCliCompatibility(site);
    if (cliCompatibility) {
      result[site.name] = cliCompatibility;
    }
  }

  return result;
}

// ============= Arbitraries =============

/**
 * 生成有效的 CLI 兼容性结果
 */
const cliCompatibilityResultArb: fc.Arbitrary<CliCompatibilityResult> = fc.record({
  claudeCode: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  codex: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  geminiCli: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  testedAt: fc.oneof(fc.integer({ min: 0, max: Date.now() + 1000000 }), fc.constant(null)),
  error: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
});

/**
 * 生成站点名称
 */
const siteNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0 && !s.includes('\n'));

/**
 * 生成站点 URL
 */
const siteUrlArb = fc.webUrl();

/**
 * 生成带有 CLI 兼容性数据的站点配置（数据在 cached_data 中）
 */
const siteWithCachedCliCompatArb: fc.Arbitrary<SiteConfig> = fc.record({
  name: siteNameArb,
  url: siteUrlArb,
  cached_data: fc.record({
    models: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
    last_refresh: fc.integer({ min: 0, max: Date.now() + 1000000 }),
    cli_compatibility: cliCompatibilityResultArb,
  }),
});

/**
 * 生成带有 CLI 兼容性数据的站点配置（数据在站点根级别，兼容旧版本）
 */
const siteWithRootCliCompatArb: fc.Arbitrary<SiteConfig> = fc.record({
  name: siteNameArb,
  url: siteUrlArb,
  cli_compatibility: cliCompatibilityResultArb,
});

/**
 * 生成不带 CLI 兼容性数据的站点配置
 */
const siteWithoutCliCompatArb: fc.Arbitrary<SiteConfig> = fc.record({
  name: siteNameArb,
  url: siteUrlArb,
  cached_data: fc.option(
    fc.record({
      models: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
      last_refresh: fc.integer({ min: 0, max: Date.now() + 1000000 }),
    }),
    { nil: undefined }
  ),
});

/**
 * 生成损坏的 CLI 兼容性数据
 */
const corruptedCliCompatArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant('invalid'),
  fc.constant(123),
  fc.constant([]),
  fc.record({}) // 空对象，没有任何 CLI 字段
);

/**
 * 生成带有损坏 CLI 兼容性数据的站点配置
 */
const siteWithCorruptedCliCompatArb: fc.Arbitrary<SiteConfig> = fc
  .tuple(siteNameArb, siteUrlArb, corruptedCliCompatArb)
  .map(([name, url, corruptedData]) => ({
    name,
    url,
    cached_data: {
      models: [],
      last_refresh: Date.now(),
      cli_compatibility: corruptedData as any,
    },
  }));

// ============= Round-trip 模拟函数 =============

/**
 * 模拟保存 CLI 兼容性结果到 cached_data
 * 这是 cli-compat-handlers.ts 中 cli-compat:save-result 的核心逻辑
 */
function saveCliCompatibilityResult(site: SiteConfig, result: CliCompatibilityResult): SiteConfig {
  const currentCachedData = site.cached_data || {
    models: [],
    last_refresh: Date.now(),
  };

  return {
    ...site,
    cached_data: {
      ...currentCachedData,
      cli_compatibility: {
        claudeCode: result.claudeCode,
        codex: result.codex,
        geminiCli: result.geminiCli,
        testedAt: result.testedAt,
        error: result.error,
      },
    },
  };
}

/**
 * 比较两个 CLI 兼容性结果是否等价（保留用于未来扩展）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function areCliCompatibilityResultsEqual(
  a: CliCompatibilityResult,
  b: CliCompatibilityResult
): boolean {
  return (
    a.claudeCode === b.claudeCode &&
    a.codex === b.codex &&
    a.geminiCli === b.geminiCli &&
    a.testedAt === b.testedAt &&
    a.error === b.error
  );
}

// ============= Property Tests =============

describe('CLI Compatibility Persistence Property Tests', () => {
  /**
   * **Property 1: CLI compatibility data round-trip persistence**
   * **Validates: Requirements 1.2, 2.2**
   *
   * *For any* valid CLI compatibility test result, saving it to persistent storage
   * and then loading it back should produce an equivalent result with all fields
   * preserved (including testedAt timestamp).
   */
  describe('Property 1: CLI compatibility data round-trip persistence', () => {
    it('should preserve all fields after save and load round-trip', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          cliCompatibilityResultArb,
          (name, url, originalResult) => {
            // 创建初始站点配置
            const initialSite: SiteConfig = {
              name,
              url,
              cached_data: {
                models: ['gpt-4', 'claude-3'],
                last_refresh: Date.now(),
              },
            };

            // 保存 CLI 兼容性结果
            const siteAfterSave = saveCliCompatibilityResult(initialSite, originalResult);

            // 从保存后的配置中加载
            const config: Config = { sites: [siteAfterSave] };
            const loaded = loadCliCompatibilityFromConfig(config);

            // 验证加载的结果与原始结果等价
            const loadedResult = loaded[name];
            expect(loadedResult).toBeDefined();

            // 验证每个字段
            expect(loadedResult.claudeCode).toBe(
              typeof originalResult.claudeCode === 'boolean' ? originalResult.claudeCode : null
            );
            expect(loadedResult.codex).toBe(
              typeof originalResult.codex === 'boolean' ? originalResult.codex : null
            );
            expect(loadedResult.geminiCli).toBe(
              typeof originalResult.geminiCli === 'boolean' ? originalResult.geminiCli : null
            );
            expect(loadedResult.testedAt).toBe(
              typeof originalResult.testedAt === 'number' ? originalResult.testedAt : null
            );
            // error 字段：如果原始是 string 则保留，否则为 undefined
            if (typeof originalResult.error === 'string') {
              expect(loadedResult.error).toBe(originalResult.error);
            } else {
              expect(loadedResult.error).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve testedAt timestamp exactly', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.integer({ min: 1000000000000, max: 2000000000000 }), // Unix timestamp range
          (name, url, timestamp) => {
            const originalResult: CliCompatibilityResult = {
              claudeCode: true,
              codex: false,
              geminiCli: null,
              testedAt: timestamp,
            };

            const initialSite: SiteConfig = { name, url };
            const siteAfterSave = saveCliCompatibilityResult(initialSite, originalResult);
            const config: Config = { sites: [siteAfterSave] };
            const loaded = loadCliCompatibilityFromConfig(config);

            expect(loaded[name].testedAt).toBe(timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve error message exactly', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.string({ minLength: 1, maxLength: 500 }),
          (name, url, errorMessage) => {
            const originalResult: CliCompatibilityResult = {
              claudeCode: null,
              codex: null,
              geminiCli: null,
              testedAt: Date.now(),
              error: errorMessage,
            };

            const initialSite: SiteConfig = { name, url };
            const siteAfterSave = saveCliCompatibilityResult(initialSite, originalResult);
            const config: Config = { sites: [siteAfterSave] };
            const loaded = loadCliCompatibilityFromConfig(config);

            expect(loaded[name].error).toBe(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all boolean combinations', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
          fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
          fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
          (name, url, claudeCode, codex, geminiCli) => {
            const originalResult: CliCompatibilityResult = {
              claudeCode,
              codex,
              geminiCli,
              testedAt: Date.now(),
            };

            const initialSite: SiteConfig = { name, url };
            const siteAfterSave = saveCliCompatibilityResult(initialSite, originalResult);
            const config: Config = { sites: [siteAfterSave] };
            const loaded = loadCliCompatibilityFromConfig(config);

            expect(loaded[name].claudeCode).toBe(claudeCode);
            expect(loaded[name].codex).toBe(codex);
            expect(loaded[name].geminiCli).toBe(geminiCli);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not lose existing cached_data when saving CLI compatibility', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1000000000000, max: 2000000000000 }),
          cliCompatibilityResultArb,
          (name, url, models, lastRefresh, cliResult) => {
            // 创建带有现有 cached_data 的站点
            const initialSite: SiteConfig = {
              name,
              url,
              cached_data: {
                models,
                last_refresh: lastRefresh,
              },
            };

            // 保存 CLI 兼容性结果
            const siteAfterSave = saveCliCompatibilityResult(initialSite, cliResult);

            // 验证原有的 cached_data 字段被保留
            expect(siteAfterSave.cached_data?.models).toEqual(models);
            expect(siteAfterSave.cached_data?.last_refresh).toBe(lastRefresh);

            // 验证 CLI 兼容性数据被正确添加
            expect(siteAfterSave.cached_data?.cli_compatibility).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple save operations (idempotence)', () => {
      fc.assert(
        fc.property(siteNameArb, siteUrlArb, cliCompatibilityResultArb, (name, url, result) => {
          const initialSite: SiteConfig = { name, url };

          // 保存两次相同的结果
          const siteAfterFirstSave = saveCliCompatibilityResult(initialSite, result);
          const siteAfterSecondSave = saveCliCompatibilityResult(siteAfterFirstSave, result);

          // 两次保存后的结果应该相同
          const config1: Config = { sites: [siteAfterFirstSave] };
          const config2: Config = { sites: [siteAfterSecondSave] };

          const loaded1 = loadCliCompatibilityFromConfig(config1);
          const loaded2 = loadCliCompatibilityFromConfig(config2);

          expect(loaded1[name].claudeCode).toBe(loaded2[name].claudeCode);
          expect(loaded1[name].codex).toBe(loaded2[name].codex);
          expect(loaded1[name].geminiCli).toBe(loaded2[name].geminiCli);
          expect(loaded1[name].testedAt).toBe(loaded2[name].testedAt);
          expect(loaded1[name].error).toBe(loaded2[name].error);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 2: Application startup restores CLI compatibility state**
   * **Validates: Requirements 1.1, 1.3**
   *
   * *For any* configuration containing CLI compatibility data in cached_data,
   * when the application loads this configuration, the frontend state store
   * should contain the same CLI compatibility data for each site.
   */
  describe('Property 2: Application startup restores CLI compatibility state', () => {
    it('should restore CLI compatibility data from cached_data', () => {
      fc.assert(
        fc.property(
          fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 10 }),
          sites => {
            // 确保站点名称唯一
            const uniqueSites = sites.filter(
              (site, index, self) => self.findIndex(s => s.name === site.name) === index
            );
            if (uniqueSites.length === 0) return;

            const config: Config = { sites: uniqueSites };
            const loaded = loadCliCompatibilityFromConfig(config);

            // 验证每个站点的 CLI 兼容性数据都被正确加载
            for (const site of uniqueSites) {
              const original = site.cached_data?.cli_compatibility;
              const restored = loaded[site.name];

              expect(restored).toBeDefined();
              expect(restored.claudeCode).toBe(
                typeof original?.claudeCode === 'boolean' ? original.claudeCode : null
              );
              expect(restored.codex).toBe(
                typeof original?.codex === 'boolean' ? original.codex : null
              );
              expect(restored.geminiCli).toBe(
                typeof original?.geminiCli === 'boolean' ? original.geminiCli : null
              );
              expect(restored.testedAt).toBe(
                typeof original?.testedAt === 'number' ? original.testedAt : null
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should restore CLI compatibility data from site root level (legacy format)', () => {
      fc.assert(
        fc.property(fc.array(siteWithRootCliCompatArb, { minLength: 1, maxLength: 10 }), sites => {
          // 确保站点名称唯一
          const uniqueSites = sites.filter(
            (site, index, self) => self.findIndex(s => s.name === site.name) === index
          );
          if (uniqueSites.length === 0) return;

          const config: Config = { sites: uniqueSites };
          const loaded = loadCliCompatibilityFromConfig(config);

          // 验证每个站点的 CLI 兼容性数据都被正确加载
          for (const site of uniqueSites) {
            const original = site.cli_compatibility;
            const restored = loaded[site.name];

            expect(restored).toBeDefined();
            expect(restored.claudeCode).toBe(
              typeof original?.claudeCode === 'boolean' ? original.claudeCode : null
            );
            expect(restored.codex).toBe(
              typeof original?.codex === 'boolean' ? original.codex : null
            );
            expect(restored.geminiCli).toBe(
              typeof original?.geminiCli === 'boolean' ? original.geminiCli : null
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should prioritize cached_data over root level cli_compatibility', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          cliCompatibilityResultArb,
          cliCompatibilityResultArb,
          (name, url, cachedCompat, rootCompat) => {
            // 创建一个同时有 cached_data 和 root level 数据的站点
            const site: SiteConfig = {
              name,
              url,
              cached_data: {
                models: [],
                last_refresh: Date.now(),
                cli_compatibility: cachedCompat,
              },
              cli_compatibility: rootCompat,
            };

            const config: Config = { sites: [site] };
            const loaded = loadCliCompatibilityFromConfig(config);

            // 应该使用 cached_data 中的数据
            const restored = loaded[name];
            expect(restored).toBeDefined();
            expect(restored.claudeCode).toBe(
              typeof cachedCompat.claudeCode === 'boolean' ? cachedCompat.claudeCode : null
            );
            expect(restored.codex).toBe(
              typeof cachedCompat.codex === 'boolean' ? cachedCompat.codex : null
            );
            expect(restored.geminiCli).toBe(
              typeof cachedCompat.geminiCli === 'boolean' ? cachedCompat.geminiCli : null
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not load CLI compatibility for sites without data', () => {
      fc.assert(
        fc.property(fc.array(siteWithoutCliCompatArb, { minLength: 1, maxLength: 10 }), sites => {
          // 确保站点名称唯一
          const uniqueSites = sites.filter(
            (site, index, self) => self.findIndex(s => s.name === site.name) === index
          );
          if (uniqueSites.length === 0) return;

          const config: Config = { sites: uniqueSites };
          const loaded = loadCliCompatibilityFromConfig(config);

          // 没有 CLI 兼容性数据的站点不应该出现在结果中
          expect(Object.keys(loaded).length).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle corrupted CLI compatibility data gracefully', () => {
      fc.assert(
        fc.property(
          fc.array(siteWithCorruptedCliCompatArb, { minLength: 1, maxLength: 10 }),
          sites => {
            // 确保站点名称唯一
            const uniqueSites = sites.filter(
              (site, index, self) => self.findIndex(s => s.name === site.name) === index
            );
            if (uniqueSites.length === 0) return;

            const config: Config = { sites: uniqueSites };

            // 不应该抛出异常
            expect(() => loadCliCompatibilityFromConfig(config)).not.toThrow();

            const loaded = loadCliCompatibilityFromConfig(config);

            // 损坏的数据不应该被加载
            expect(Object.keys(loaded).length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve testedAt timestamp when loading', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.integer({ min: 1000000000000, max: Date.now() + 1000000 }),
          (name, url, timestamp) => {
            const site: SiteConfig = {
              name,
              url,
              cached_data: {
                models: [],
                last_refresh: Date.now(),
                cli_compatibility: {
                  claudeCode: true,
                  codex: false,
                  geminiCli: null,
                  testedAt: timestamp,
                },
              },
            };

            const config: Config = { sites: [site] };
            const loaded = loadCliCompatibilityFromConfig(config);

            expect(loaded[name].testedAt).toBe(timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle mixed sites (with and without CLI compatibility data)', () => {
      fc.assert(
        fc.property(
          fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 5 }),
          fc.array(siteWithoutCliCompatArb, { minLength: 1, maxLength: 5 }),
          (sitesWithCompat, sitesWithoutCompat) => {
            // 确保所有站点名称唯一
            const allSites = [...sitesWithCompat, ...sitesWithoutCompat];
            const uniqueSites = allSites.filter(
              (site, index, self) => self.findIndex(s => s.name === site.name) === index
            );

            const sitesWithCompatNames = new Set(
              sitesWithCompat.filter(s => uniqueSites.includes(s)).map(s => s.name)
            );

            if (sitesWithCompatNames.size === 0) return;

            const config: Config = { sites: uniqueSites };
            const loaded = loadCliCompatibilityFromConfig(config);

            // 只有有 CLI 兼容性数据的站点应该被加载
            expect(Object.keys(loaded).length).toBe(sitesWithCompatNames.size);

            for (const name of Object.keys(loaded)) {
              expect(sitesWithCompatNames.has(name)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 3: Export/Import preserves CLI compatibility data**
   * **Validates: Requirements 3.1, 3.2**
   *
   * *For any* configuration with CLI compatibility data, exporting and then
   * importing the configuration should preserve all CLI compatibility test results.
   */
  describe('Property 3: Export/Import preserves CLI compatibility data', () => {
    /**
     * 模拟 UnifiedConfigManager.exportConfig 的核心逻辑
     * 返回完整的配置对象
     */
    function exportConfig(config: Config): Config {
      return { ...config, sites: config.sites.map(site => ({ ...site })) };
    }

    /**
     * 模拟 UnifiedConfigManager.importConfig 的核心逻辑
     * 规范化配置并返回
     */
    function importConfig(data: Config): Config {
      // 模拟 normalizeConfig 的行为
      const normalizedSites = data.sites.map(site => ({
        ...site,
        // normalizeConfig 会保留 cached_data
        cached_data: site.cached_data,
      }));
      return { sites: normalizedSites };
    }

    it('should preserve CLI compatibility data after export/import round-trip', () => {
      fc.assert(
        fc.property(
          fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 10 }),
          sites => {
            // 确保站点名称唯一
            const uniqueSites = sites.filter(
              (site, index, self) => self.findIndex(s => s.name === site.name) === index
            );
            if (uniqueSites.length === 0) return;

            const originalConfig: Config = { sites: uniqueSites };

            // 导出配置
            const exported = exportConfig(originalConfig);

            // 导入配置
            const imported = importConfig(exported);

            // 从导入的配置中加载 CLI 兼容性数据
            const loadedFromOriginal = loadCliCompatibilityFromConfig(originalConfig);
            const loadedFromImported = loadCliCompatibilityFromConfig(imported);

            // 验证导入后的数据与原始数据一致
            expect(Object.keys(loadedFromImported).length).toBe(
              Object.keys(loadedFromOriginal).length
            );

            for (const siteName of Object.keys(loadedFromOriginal)) {
              const original = loadedFromOriginal[siteName];
              const restored = loadedFromImported[siteName];

              expect(restored).toBeDefined();
              expect(restored.claudeCode).toBe(original.claudeCode);
              expect(restored.codex).toBe(original.codex);
              expect(restored.geminiCli).toBe(original.geminiCli);
              expect(restored.testedAt).toBe(original.testedAt);
              expect(restored.error).toBe(original.error);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve testedAt timestamp after export/import', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.integer({ min: 1000000000000, max: 2000000000000 }),
          (name, url, timestamp) => {
            const site: SiteConfig = {
              name,
              url,
              cached_data: {
                models: ['gpt-4'],
                last_refresh: Date.now(),
                cli_compatibility: {
                  claudeCode: true,
                  codex: false,
                  geminiCli: null,
                  testedAt: timestamp,
                },
              },
            };

            const originalConfig: Config = { sites: [site] };
            const exported = exportConfig(originalConfig);
            const imported = importConfig(exported);

            const loaded = loadCliCompatibilityFromConfig(imported);
            expect(loaded[name].testedAt).toBe(timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle sites without CLI compatibility data during import', () => {
      fc.assert(
        fc.property(fc.array(siteWithoutCliCompatArb, { minLength: 1, maxLength: 10 }), sites => {
          // 确保站点名称唯一
          const uniqueSites = sites.filter(
            (site, index, self) => self.findIndex(s => s.name === site.name) === index
          );
          if (uniqueSites.length === 0) return;

          const originalConfig: Config = { sites: uniqueSites };
          const exported = exportConfig(originalConfig);
          const imported = importConfig(exported);

          // 不应该抛出异常
          expect(() => loadCliCompatibilityFromConfig(imported)).not.toThrow();

          // 没有 CLI 兼容性数据的站点不应该出现在结果中
          const loaded = loadCliCompatibilityFromConfig(imported);
          expect(Object.keys(loaded).length).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve CLI compatibility data for mixed sites', () => {
      fc.assert(
        fc.property(
          fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 5 }),
          fc.array(siteWithoutCliCompatArb, { minLength: 1, maxLength: 5 }),
          (sitesWithCompat, sitesWithoutCompat) => {
            // 确保所有站点名称唯一
            const allSites = [...sitesWithCompat, ...sitesWithoutCompat];
            const uniqueSites = allSites.filter(
              (site, index, self) => self.findIndex(s => s.name === site.name) === index
            );

            const sitesWithCompatNames = new Set(
              sitesWithCompat.filter(s => uniqueSites.includes(s)).map(s => s.name)
            );

            if (sitesWithCompatNames.size === 0) return;

            const originalConfig: Config = { sites: uniqueSites };
            const exported = exportConfig(originalConfig);
            const imported = importConfig(exported);

            const loadedFromOriginal = loadCliCompatibilityFromConfig(originalConfig);
            const loadedFromImported = loadCliCompatibilityFromConfig(imported);

            // 只有有 CLI 兼容性数据的站点应该被保留
            expect(Object.keys(loadedFromImported).length).toBe(
              Object.keys(loadedFromOriginal).length
            );

            for (const name of Object.keys(loadedFromOriginal)) {
              expect(loadedFromImported[name]).toBeDefined();
              expect(loadedFromImported[name].claudeCode).toBe(loadedFromOriginal[name].claudeCode);
              expect(loadedFromImported[name].codex).toBe(loadedFromOriginal[name].codex);
              expect(loadedFromImported[name].geminiCli).toBe(loadedFromOriginal[name].geminiCli);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve error messages after export/import', () => {
      fc.assert(
        fc.property(
          siteNameArb,
          siteUrlArb,
          fc.string({ minLength: 1, maxLength: 500 }),
          (name, url, errorMessage) => {
            const site: SiteConfig = {
              name,
              url,
              cached_data: {
                models: [],
                last_refresh: Date.now(),
                cli_compatibility: {
                  claudeCode: null,
                  codex: null,
                  geminiCli: null,
                  testedAt: Date.now(),
                  error: errorMessage,
                },
              },
            };

            const originalConfig: Config = { sites: [site] };
            const exported = exportConfig(originalConfig);
            const imported = importConfig(exported);

            const loaded = loadCliCompatibilityFromConfig(imported);
            expect(loaded[name].error).toBe(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple export/import cycles (idempotence)', () => {
      fc.assert(
        fc.property(fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 5 }), sites => {
          // 确保站点名称唯一
          const uniqueSites = sites.filter(
            (site, index, self) => self.findIndex(s => s.name === site.name) === index
          );
          if (uniqueSites.length === 0) return;

          const originalConfig: Config = { sites: uniqueSites };

          // 执行多次导出/导入循环
          let currentConfig = originalConfig;
          for (let i = 0; i < 3; i++) {
            const exported = exportConfig(currentConfig);
            currentConfig = importConfig(exported);
          }

          // 最终结果应该与原始数据一致
          const loadedFromOriginal = loadCliCompatibilityFromConfig(originalConfig);
          const loadedFromFinal = loadCliCompatibilityFromConfig(currentConfig);

          expect(Object.keys(loadedFromFinal).length).toBe(Object.keys(loadedFromOriginal).length);

          for (const siteName of Object.keys(loadedFromOriginal)) {
            const original = loadedFromOriginal[siteName];
            const final = loadedFromFinal[siteName];

            expect(final.claudeCode).toBe(original.claudeCode);
            expect(final.codex).toBe(original.codex);
            expect(final.geminiCli).toBe(original.geminiCli);
            expect(final.testedAt).toBe(original.testedAt);
            expect(final.error).toBe(original.error);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * 数据验证测试
   */
  describe('Data Validation', () => {
    it('should validate CLI compatibility data structure', () => {
      fc.assert(
        fc.property(cliCompatibilityResultArb, result => {
          expect(isValidCliCompatibility(result)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid data structures', () => {
      fc.assert(
        fc.property(corruptedCliCompatArb, data => {
          expect(isValidCliCompatibility(data)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should normalize partial data correctly', () => {
      // 测试只有部分字段的数据
      const partialData = { claudeCode: true };
      const normalized = normalizeCliCompatibility(partialData);

      expect(normalized).not.toBeNull();
      expect(normalized!.claudeCode).toBe(true);
      expect(normalized!.codex).toBeNull();
      expect(normalized!.geminiCli).toBeNull();
      expect(normalized!.testedAt).toBeNull();
      expect(normalized!.error).toBeUndefined();
    });

    it('should handle non-boolean values in CLI fields', () => {
      const invalidData = {
        claudeCode: 'yes', // 应该是 boolean
        codex: 1, // 应该是 boolean
        geminiCli: {}, // 应该是 boolean
        testedAt: 'now', // 应该是 number
        error: 123, // 应该是 string
      };

      const normalized = normalizeCliCompatibility(invalidData);

      expect(normalized).not.toBeNull();
      expect(normalized!.claudeCode).toBeNull(); // 非 boolean 转为 null
      expect(normalized!.codex).toBeNull();
      expect(normalized!.geminiCli).toBeNull();
      expect(normalized!.testedAt).toBeNull(); // 非 number 转为 null
      expect(normalized!.error).toBeUndefined(); // 非 string 转为 undefined
    });
  });
});
