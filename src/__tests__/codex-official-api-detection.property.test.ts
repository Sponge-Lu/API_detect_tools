/**
 * 输入: 模拟的 API Key 字符串
 * 输出: 属性测试验证结果
 * 定位: 测试层 - Codex 官方 API Key 检测的属性测试
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **Feature: codex-official-api-detection**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 *
 * Property 1: 官方 API Key 格式识别 (Requirements 1.1, 1.2, 1.3)
 * Property 2: 官方 API Key 优先级 (Requirements 2.1, 2.2, 3.1)
 * Property 3: 非官方 API Key 回退到站点配置 (Requirements 2.3, 3.2)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isOfficialOpenAIApiKey,
  getEffectiveCodexConfig,
  CodexConfig,
  CodexAuthConfig,
} from '../main/utils/config-parsers';

// ============= Arbitraries =============

/**
 * 生成官方 OpenAI API Key (以 sk- 开头)
 */
const officialApiKeyArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
  .map(s => `sk-${s}`);

/**
 * 生成官方 OpenAI 项目级 API Key (以 sk-proj- 开头)
 */
const officialProjectApiKeyArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
  .map(s => `sk-proj-${s}`);

/**
 * 生成非官方 API Key (不以 sk- 开头)
 */
const nonOfficialApiKeyArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(s => !s.startsWith('sk-') && s.length > 0);

// ============= Property Tests =============

/**
 * **Property 1: 官方 API Key 格式识别**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * *For any* API Key 字符串，`isOfficialOpenAIApiKey` 函数返回 `true` 当且仅当该字符串以 `sk-` 开头。
 */
describe('Feature: codex-official-api-detection, Property 1: 官方 API Key 格式识别', () => {
  describe('官方 API Key 识别', () => {
    it('以 sk-proj- 开头的 API Key 应返回 true', () => {
      fc.assert(
        fc.property(officialProjectApiKeyArb, apiKey => {
          expect(isOfficialOpenAIApiKey(apiKey)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('以 sk- 开头的 API Key 应返回 true', () => {
      fc.assert(
        fc.property(officialApiKeyArb, apiKey => {
          expect(isOfficialOpenAIApiKey(apiKey)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('非官方 API Key 识别', () => {
    it('不以 sk- 开头的 API Key 应返回 false', () => {
      fc.assert(
        fc.property(nonOfficialApiKeyArb, apiKey => {
          expect(isOfficialOpenAIApiKey(apiKey)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('边界情况处理', () => {
    it('null 应返回 false', () => {
      expect(isOfficialOpenAIApiKey(null)).toBe(false);
    });

    it('undefined 应返回 false', () => {
      expect(isOfficialOpenAIApiKey(undefined)).toBe(false);
    });

    it('空字符串应返回 false', () => {
      expect(isOfficialOpenAIApiKey('')).toBe(false);
    });

    it('仅包含 sk- 的字符串应返回 true', () => {
      expect(isOfficialOpenAIApiKey('sk-')).toBe(true);
    });
  });

  describe('一致性验证', () => {
    it('isOfficialOpenAIApiKey 返回值应与 startsWith("sk-") 一致', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 100 }), apiKey => {
          const expected = typeof apiKey === 'string' && apiKey.startsWith('sk-');
          expect(isOfficialOpenAIApiKey(apiKey)).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });
  });
});

// ============= Codex Config Arbitraries =============

/**
 * 生成有效的 URL
 */
const urlArb = fc
  .webUrl()
  .map(url => url.replace(/\/+$/, ''))
  .filter(url => url.length > 0);

/**
 * 生成有效的 provider 名称
 */
const providerNameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s));

/**
 * 生成带有自定义 provider 的 Codex 配置
 */
const codexConfigWithProviderArb: fc.Arbitrary<CodexConfig> = fc
  .tuple(providerNameArb, urlArb)
  .map(([providerName, baseUrl]) => ({
    model_provider: providerName,
    model_providers: {
      [providerName]: {
        name: providerName,
        base_url: baseUrl,
      },
    },
  }));

/**
 * 生成空的 Codex 配置
 */
const emptyCodexConfigArb: fc.Arbitrary<CodexConfig | null> = fc.constantFrom(null, {});

// ============= Property 2 Tests =============

/**
 * **Property 2: 官方 API Key 优先级**
 * **Validates: Requirements 2.1, 2.2, 3.1**
 *
 * *For any* Codex 配置，当 `auth.json` 或环境变量中存在官方 API Key 时，
 * 无论 `config.toml` 中是否有站点配置，`getEffectiveCodexConfig` 返回的
 * `isOfficialApiKey` 应为 `true`。
 */
describe('Feature: codex-official-api-detection, Property 2: 官方 API Key 优先级', () => {
  describe('官方 API Key 在 auth.json 中', () => {
    it('当 auth.json 中有官方 API Key 且存在站点配置时，isOfficialApiKey 应为 true', () => {
      fc.assert(
        fc.property(codexConfigWithProviderArb, officialApiKeyArb, (config, apiKey) => {
          const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          expect(result.isOfficialApiKey).toBe(true);
          expect(result.hasApiKey).toBe(true);
          // 官方 API Key 优先，不应返回 baseUrl
          expect(result.baseUrl).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('当 auth.json 中有官方 API Key 且无站点配置时，isOfficialApiKey 应为 true', () => {
      fc.assert(
        fc.property(emptyCodexConfigArb, officialApiKeyArb, (config, apiKey) => {
          const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          expect(result.isOfficialApiKey).toBe(true);
          expect(result.hasApiKey).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('官方 API Key 在环境变量中', () => {
    it('当环境变量中有官方 API Key 且存在站点配置时，isOfficialApiKey 应为 true', () => {
      fc.assert(
        fc.property(codexConfigWithProviderArb, officialApiKeyArb, (config, apiKey) => {
          const result = getEffectiveCodexConfig(config, null, { OPENAI_API_KEY: apiKey }, false);

          expect(result.isOfficialApiKey).toBe(true);
          expect(result.hasApiKey).toBe(true);
          // 官方 API Key 优先，不应返回 baseUrl
          expect(result.baseUrl).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('当环境变量中有官方 API Key 且无站点配置时，isOfficialApiKey 应为 true', () => {
      fc.assert(
        fc.property(emptyCodexConfigArb, officialApiKeyArb, (config, apiKey) => {
          const result = getEffectiveCodexConfig(config, null, { OPENAI_API_KEY: apiKey }, false);

          expect(result.isOfficialApiKey).toBe(true);
          expect(result.hasApiKey).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('OAuth 优先级', () => {
    it('当有 OAuth 凭证时，应优先返回 chatgpt-oauth（即使有官方 API Key）', () => {
      fc.assert(
        fc.property(emptyCodexConfigArb, officialApiKeyArb, (config, apiKey) => {
          const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
          // oauthStatus = true 表示有 OAuth 凭证
          const result = getEffectiveCodexConfig(config, authConfig, {}, true);

          expect(result.authType).toBe('chatgpt-oauth');
          expect(result.hasChatGptOAuth).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('当有 OAuth 凭证但 forced_login_method=api 时，应使用 API Key', () => {
      fc.assert(
        fc.property(officialApiKeyArb, apiKey => {
          const config: CodexConfig = { forced_login_method: 'api' };
          const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
          const result = getEffectiveCodexConfig(config, authConfig, {}, true);

          expect(result.isOfficialApiKey).toBe(true);
          expect(result.hasApiKey).toBe(true);
          expect(result.authType).toBe('api-key');
        }),
        { numRuns: 100 }
      );
    });
  });
});

// ============= Property 3 Tests =============

import { determineSourceType } from '../main/utils/site-matcher';
import { SiteInfo } from '../shared/types/config-detection';

/**
 * 生成有效的站点 ID
 */
const siteIdArb = fc.uuid();

/**
 * 生成有效的站点名称
 */
const siteNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/**
 * 生成站点信息
 */
const siteInfoArb: fc.Arbitrary<SiteInfo> = fc
  .tuple(siteIdArb, siteNameArb, urlArb)
  .map(([id, name, url]) => ({
    id,
    name,
    url,
  }));

/**
 * **Property 3: 非官方 API Key 回退到站点配置**
 * **Validates: Requirements 2.3, 3.2**
 *
 * *For any* Codex 配置，当 API Key 不是官方格式且存在站点配置时，`sourceType` 应为 `managed`。
 */
describe('Feature: codex-official-api-detection, Property 3: 非官方 API Key 回退到站点配置', () => {
  describe('非官方 API Key 与站点配置匹配', () => {
    it('当有非官方 API Key 且 baseUrl 匹配站点时，sourceType 应为 managed', () => {
      fc.assert(
        fc.property(siteInfoArb, nonOfficialApiKeyArb, (site, apiKey) => {
          const sites: SiteInfo[] = [site];

          const result = determineSourceType({
            baseUrl: site.url,
            hasApiKey: true,
            authType: 'api-key',
            isOfficialApiKey: false,
            cliType: 'codex',
            sites,
          });

          expect(result.sourceType).toBe('managed');
          expect(result.siteName).toBe(site.name);
          expect(result.siteId).toBe(site.id);
        }),
        { numRuns: 100 }
      );
    });

    it('当 isOfficialApiKey 为 false 且有匹配站点时，应返回 managed', () => {
      fc.assert(
        fc.property(siteInfoArb, site => {
          const sites: SiteInfo[] = [site];

          const result = determineSourceType({
            baseUrl: site.url,
            hasApiKey: true,
            authType: 'api-key',
            isOfficialApiKey: false,
            cliType: 'codex',
            sites,
          });

          expect(result.sourceType).toBe('managed');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('官方 API Key 优先于站点配置', () => {
    it('当 isOfficialApiKey 为 true 时，即使有匹配站点也应返回 official', () => {
      fc.assert(
        fc.property(siteInfoArb, site => {
          const sites: SiteInfo[] = [site];

          const result = determineSourceType({
            baseUrl: site.url,
            hasApiKey: true,
            authType: 'api-key',
            isOfficialApiKey: true,
            cliType: 'codex',
            sites,
          });

          expect(result.sourceType).toBe('official');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('getEffectiveCodexConfig 与 determineSourceType 集成', () => {
    it('非官方 API Key 应使 getEffectiveCodexConfig 返回 isOfficialApiKey=false', () => {
      fc.assert(
        fc.property(codexConfigWithProviderArb, nonOfficialApiKeyArb, (config, apiKey) => {
          const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          expect(result.isOfficialApiKey).toBe(false);
          expect(result.hasApiKey).toBe(true);
          // 非官方 API Key 应返回 baseUrl
          expect(result.baseUrl).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('非官方 API Key 配合站点配置应使 determineSourceType 返回 managed', () => {
      fc.assert(
        fc.property(
          codexConfigWithProviderArb,
          nonOfficialApiKeyArb,
          siteInfoArb,
          (config, apiKey, site) => {
            // 使用站点的 URL 作为 config 的 baseUrl
            const configWithSiteUrl: CodexConfig = {
              model_provider: config.model_provider,
              model_providers: {
                [config.model_provider!]: {
                  name: config.model_provider,
                  base_url: site.url,
                },
              },
            };

            const authConfig: CodexAuthConfig = { OPENAI_API_KEY: apiKey };
            const effectiveConfig = getEffectiveCodexConfig(
              configWithSiteUrl,
              authConfig,
              {},
              false
            );

            const sites: SiteInfo[] = [site];
            const result = determineSourceType({
              baseUrl: effectiveConfig.baseUrl,
              hasApiKey: effectiveConfig.hasApiKey,
              authType: effectiveConfig.authType,
              isOfficialApiKey: effectiveConfig.isOfficialApiKey,
              cliType: 'codex',
              sites,
            });

            expect(result.sourceType).toBe('managed');
            expect(result.siteName).toBe(site.name);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
