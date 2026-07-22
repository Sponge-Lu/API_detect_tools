/**
 * 输入: 模拟的 CLI 配置数据
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CLI 配置检测的属性测试，验证配置解析正确性
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: cli-config-detection**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseEnvString } from '../main/utils/env-parser';
import { parseTomlFile, parseTomlString } from '../main/utils/toml-parser';
import {
  ClaudeCodeConfig,
  CodexConfig,
  CodexAuthConfig,
  GrokBuildConfig,
  extractClaudeCodeInfo,
  extractCodexInfo,
  getEffectiveGrokBuildConfig,
} from '../main/utils/config-parsers';

// ============= Arbitraries =============

/**
 * Generate a valid URL
 */
const urlArb = fc
  .webUrl()
  .map(url => url.replace(/\/+$/, ''))
  .filter(url => url.length > 0);

/**
 * Generate a valid API key
 */
const apiKeyArb = fc
  .string({ minLength: 10, maxLength: 100 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
  .map(s => `sk-${s}`);

/**
 * Generate a valid model name
 */
const modelNameArb = fc.oneof(
  fc.constantFrom('claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'gpt-4', 'gpt-4-turbo'),
  fc
    .tuple(fc.constantFrom('claude-', 'gpt-'), fc.integer({ min: 1, max: 5 }))
    .map(([prefix, version]) => `${prefix}${version}`)
);

/**
 * Generate a valid provider name (alphanumeric with underscores)
 */
const providerNameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s));

// ============= Claude Code Config Arbitraries =============

/**
 * Generate a valid Claude Code config
 */
const claudeCodeConfigArb: fc.Arbitrary<ClaudeCodeConfig> = fc.record({
  env: fc.option(
    fc.record({
      ANTHROPIC_BASE_URL: fc.option(urlArb, { nil: undefined }),
      ANTHROPIC_AUTH_TOKEN: fc.option(apiKeyArb, { nil: undefined }),
      ANTHROPIC_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
      ANTHROPIC_MODEL: fc.option(modelNameArb, { nil: undefined }),
    }),
    { nil: undefined }
  ),
});

// ============= Codex Config Arbitraries =============

/**
 * Generate a valid Codex config
 */
const codexConfigArb: fc.Arbitrary<CodexConfig> = fc.record({
  model_provider: fc.option(providerNameArb, { nil: undefined }),
  model: fc.option(modelNameArb, { nil: undefined }),
  model_providers: fc.option(
    fc.dictionary(
      providerNameArb,
      fc.record({
        name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
        base_url: fc.option(urlArb, { nil: undefined }),
        wire_api: fc.option(fc.constant('responses'), { nil: undefined }),
      })
    ),
    { nil: undefined }
  ),
});

/**
 * Generate a valid Codex auth config
 */
const codexAuthConfigArb: fc.Arbitrary<CodexAuthConfig> = fc.record({
  OPENAI_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
});

// ============= Property Tests =============

/**
 * **Property 1: Config Parsing Correctness**
 * **Validates: Requirements 1.3, 1.4, 2.3, 2.4, 3.3, 3.4**
 *
 * *For any* valid CLI configuration file (Claude Code settings.json, Codex config.toml/auth.json),
 * parsing the file and extracting the URL and API key fields
 * SHALL produce values that exactly match the original input values.
 */
describe('Property 1: Config Parsing Correctness', () => {
  it('resolves the active Grok Build model from static TOML config without probing', () => {
    const config: GrokBuildConfig = {
      models: { default: 'api-detect-grok-messages' },
      model: {
        'api-detect-grok-responses': {
          base_url: 'http://127.0.0.1:3210/v1',
          api_key: 'sk-responses',
        },
        'api-detect-grok-messages': {
          base_url: 'https://messages.example.com/v1',
          env_key: 'GROK_ROUTE_KEY',
        },
      },
    };

    expect(getEffectiveGrokBuildConfig(config, { GROK_ROUTE_KEY: 'sk-messages' })).toEqual({
      baseUrl: 'https://messages.example.com/v1',
      hasApiKey: true,
      authType: 'api-key',
      modelId: 'api-detect-grok-messages',
    });
  });

  it('resolves Grok Build env_key arrays using the first populated environment variable', () => {
    const config: GrokBuildConfig = {
      models: { default: 'custom-messages' },
      model: {
        'custom-messages': {
          base_url: 'https://messages.example.com/v1',
          env_key: ['MISSING_GROK_KEY', 'GROK_ROUTE_KEY'],
        },
      },
    };

    expect(getEffectiveGrokBuildConfig(config, { GROK_ROUTE_KEY: 'route-key' })).toMatchObject({
      hasApiKey: true,
      authType: 'api-key',
      modelId: 'custom-messages',
    });
  });

  it.each([
    {
      name: 'model x-api-key header',
      config: {
        models: { default: 'custom-messages' },
        model: {
          'custom-messages': {
            base_url: 'https://messages.example.com/v1',
            extra_headers: { 'x-api-key': 'header-key' },
          },
        },
      } satisfies GrokBuildConfig,
      env: {},
    },
    {
      name: 'global authorization header',
      config: {
        models: {
          default: 'custom-responses',
          extra_headers: { Authorization: 'Bearer header-key' },
        },
        model: {
          'custom-responses': { base_url: 'https://responses.example.com/v1' },
        },
      } satisfies GrokBuildConfig,
      env: {},
    },
    {
      name: 'legacy Grok environment key',
      config: {
        models: { default: 'custom-responses' },
        model: {
          'custom-responses': { base_url: 'https://responses.example.com/v1' },
        },
      } satisfies GrokBuildConfig,
      env: { GROK_CODE_XAI_API_KEY: 'legacy-key' },
    },
  ])('recognizes Grok Build credentials from $name', ({ config, env }) => {
    expect(getEffectiveGrokBuildConfig(config, env)).toMatchObject({
      hasApiKey: true,
      authType: 'api-key',
    });
  });

  describe('ENV Parser Round Trip', () => {
    it('should correctly parse ENV format strings', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z][A-Z0-9_]*$/.test(s)),
            // 值只包含字母数字和基本符号，不包含引号、换行、等号、空格
            fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          ),
          envVars => {
            // Generate ENV string
            const envString = Object.entries(envVars)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n');

            // Parse it back
            const parsed = parseEnvString(envString);

            // Verify all values match
            for (const [key, value] of Object.entries(envVars)) {
              expect(parsed[key]).toBe(value);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle quoted values correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z][A-Z0-9_]*$/.test(s)),
          // 引号内的值可以包含空格，但不能包含引号和换行
          fc.string({ minLength: 0, maxLength: 50 }).filter(s => /^[a-zA-Z0-9 _-]*$/.test(s)),
          (key, value) => {
            const envString = `${key}="${value}"`;
            const parsed = parseEnvString(envString);
            expect(parsed[key]).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should skip comments and empty lines', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z][A-Z0-9_]*$/.test(s)),
          // 值只包含字母数字
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          (key, value) => {
            const envString = `# This is a comment\n\n${key}=${value}\n# Another comment`;
            const parsed = parseEnvString(envString);
            expect(parsed[key]).toBe(value);
            expect(Object.keys(parsed).length).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('TOML Parser', () => {
    // 过滤掉 JavaScript 保留属性名
    const reservedNames = [
      'constructor',
      'prototype',
      '__proto__',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ];
    const validKeyArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter(s => /^[a-z][a-z0-9_]*$/.test(s) && !reservedNames.includes(s));
    const validSectionArb = fc
      .string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-z][a-z0-9_]*$/.test(s) && !reservedNames.includes(s));

    it('should correctly parse simple TOML strings', () => {
      fc.assert(
        fc.property(
          validKeyArb,
          // 过滤掉包含特殊字符的值（反斜杠、引号、换行等）
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9 _-]+$/.test(s)),
          (key, value) => {
            const tomlString = `${key} = "${value}"`;
            const parsed = parseTomlString<Record<string, string>>(tomlString);
            expect(parsed).not.toBeNull();
            expect(parsed![key]).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly parse nested TOML structures', () => {
      fc.assert(
        fc.property(
          validSectionArb,
          validKeyArb,
          // 过滤掉包含特殊字符的值
          fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9 _-]+$/.test(s)),
          (section, key, value) => {
            const tomlString = `[${section}]\n${key} = "${value}"`;
            const parsed = parseTomlString<Record<string, Record<string, string>>>(tomlString);
            expect(parsed).not.toBeNull();
            expect(parsed![section]).toBeDefined();
            expect(parsed![section][key]).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should parse UTF-8 BOM-prefixed TOML files', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-detect-toml-'));
      const configPath = path.join(tempDir, 'config.toml');

      try {
        fs.writeFileSync(configPath, '\uFEFF[models]\ndefault = "grok-code-fast-1"', 'utf-8');

        expect(parseTomlFile<{ models: { default: string } }>(configPath)).toEqual({
          models: { default: 'grok-code-fast-1' },
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Claude Code Config Extraction', () => {
    it('should correctly extract URL and API key from Claude Code config', () => {
      fc.assert(
        fc.property(claudeCodeConfigArb, config => {
          const result = extractClaudeCodeInfo(config);

          // Verify URL extraction
          if (config.env?.ANTHROPIC_BASE_URL) {
            expect(result.baseUrl).toBe(config.env.ANTHROPIC_BASE_URL);
          } else {
            expect(result.baseUrl).toBeUndefined();
          }

          // Verify API key detection
          const hasKey = !!(config.env?.ANTHROPIC_AUTH_TOKEN || config.env?.ANTHROPIC_API_KEY);
          expect(result.hasApiKey).toBe(hasKey);
        }),
        { numRuns: 100 }
      );
    });

    it('should return hasApiKey=false when config is null', () => {
      const result = extractClaudeCodeInfo(null);
      expect(result.hasApiKey).toBe(false);
      expect(result.baseUrl).toBeUndefined();
    });
  });

  describe('Codex Config Extraction', () => {
    it('should correctly extract URL and API key from Codex config', () => {
      fc.assert(
        fc.property(codexConfigArb, codexAuthConfigArb, (config, authConfig) => {
          const result = extractCodexInfo(config, authConfig);

          // Verify URL extraction from model_providers
          if (config.model_provider && config.model_providers?.[config.model_provider]?.base_url) {
            expect(result.baseUrl).toBe(config.model_providers[config.model_provider].base_url);
          }

          // Verify API key detection
          expect(result.hasApiKey).toBe(!!authConfig.OPENAI_API_KEY);
        }),
        { numRuns: 100 }
      );
    });

    it('should return hasApiKey=false when both configs are null', () => {
      const result = extractCodexInfo(null, null);
      expect(result.hasApiKey).toBe(false);
      expect(result.baseUrl).toBeUndefined();
    });
  });
});

// ============= Site Matcher Imports =============
import { normalizeUrl, urlsEqual } from '../main/utils/site-matcher';

// ============= URL Normalization Arbitraries =============

/**
 * Generate a valid hostname
 */
const hostnameArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
    fc.constantFrom('.com', '.org', '.net', '.io', '.dev', '.ai')
  )
  .map(([name, tld]) => `${name}${tld}`);

/**
 * Generate an optional path
 */
const pathArb = fc.option(
  fc
    .array(
      fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z0-9-]+$/.test(s)),
      { minLength: 1, maxLength: 3 }
    )
    .map(parts => '/' + parts.join('/')),
  { nil: '' }
);

/**
 * Generate a protocol
 */
const protocolArb = fc.constantFrom('http://', 'https://');

/**
 * Generate trailing slashes
 */
const trailingSlashArb = fc.constantFrom('', '/', '//', '///');

/**
 * Generate an optional port
 */
const portArb = fc.option(fc.constantFrom(':80', ':443', ':8080', ':3000'), { nil: '' });

// ============= Property 2: URL Normalization Consistency =============

/**
 * **Property 2: URL Normalization Consistency**
 * **Validates: Requirements 4.2**
 *
 * *For any* URL string, normalizing it (removing trailing slashes, standardizing protocol)
 * and then comparing with another normalized URL that represents the same endpoint
 * SHALL return true.
 */
describe('Property 2: URL Normalization Consistency', () => {
  describe('Trailing Slash Invariance', () => {
    it('URLs with and without trailing slashes should be considered equal', () => {
      fc.assert(
        fc.property(protocolArb, hostnameArb, pathArb, (protocol, hostname, path) => {
          const urlWithoutSlash = `${protocol}${hostname}${path}`;
          const urlWithSlash = `${protocol}${hostname}${path}/`;
          const urlWithMultipleSlashes = `${protocol}${hostname}${path}///`;

          // All variations should normalize to the same value
          const normalized = normalizeUrl(urlWithoutSlash);
          expect(normalizeUrl(urlWithSlash)).toBe(normalized);
          expect(normalizeUrl(urlWithMultipleSlashes)).toBe(normalized);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Protocol Invariance', () => {
    it('HTTP and HTTPS URLs should be considered equal after normalization', () => {
      fc.assert(
        fc.property(hostnameArb, pathArb, (hostname, path) => {
          const httpUrl = `http://${hostname}${path}`;
          const httpsUrl = `https://${hostname}${path}`;

          // Both should normalize to the same value (without protocol)
          expect(normalizeUrl(httpUrl)).toBe(normalizeUrl(httpsUrl));
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Default Port Removal', () => {
    it('URLs with default ports (80, 443) should normalize to URLs without ports', () => {
      fc.assert(
        fc.property(hostnameArb, pathArb, (hostname, path) => {
          const urlWithPort80 = `http://${hostname}:80${path}`;
          const urlWithPort443 = `https://${hostname}:443${path}`;
          const urlWithoutPort = `https://${hostname}${path}`;

          const normalizedWithoutPort = normalizeUrl(urlWithoutPort);
          expect(normalizeUrl(urlWithPort80)).toBe(normalizedWithoutPort);
          expect(normalizeUrl(urlWithPort443)).toBe(normalizedWithoutPort);
        }),
        { numRuns: 100 }
      );
    });

    it('URLs with non-default ports should preserve the port', () => {
      fc.assert(
        fc.property(
          hostnameArb,
          fc.constantFrom(':8080', ':3000', ':9000'),
          pathArb,
          (hostname, port, path) => {
            const urlWithPort = `https://${hostname}${port}${path}`;
            const normalized = normalizeUrl(urlWithPort);

            // Port should be preserved in normalized URL
            expect(normalized).toContain(port);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Case Insensitivity', () => {
    it('URLs should be normalized to lowercase', () => {
      fc.assert(
        fc.property(hostnameArb, pathArb, (hostname, path) => {
          const lowerUrl = `https://${hostname}${path}`;
          const upperUrl = `HTTPS://${hostname.toUpperCase()}${path.toUpperCase()}`;
          const mixedUrl = `HtTpS://${hostname}${path}`;

          const normalizedLower = normalizeUrl(lowerUrl);
          expect(normalizeUrl(upperUrl)).toBe(normalizedLower);
          expect(normalizeUrl(mixedUrl)).toBe(normalizedLower);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Idempotence', () => {
    it('Normalizing a URL twice should produce the same result as normalizing once', () => {
      fc.assert(
        fc.property(
          protocolArb,
          hostnameArb,
          portArb,
          pathArb,
          trailingSlashArb,
          (protocol, hostname, port, path, trailingSlash) => {
            const url = `${protocol}${hostname}${port}${path}${trailingSlash}`;
            const normalizedOnce = normalizeUrl(url);
            const normalizedTwice = normalizeUrl(normalizedOnce);

            expect(normalizedTwice).toBe(normalizedOnce);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('urlsEqual Function', () => {
    it('Equivalent URLs should be considered equal', () => {
      fc.assert(
        fc.property(hostnameArb, pathArb, (hostname, path) => {
          const url1 = `https://${hostname}${path}`;
          const url2 = `http://${hostname}${path}/`;

          expect(urlsEqual(url1, url2)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('Different URLs should not be considered equal', () => {
      fc.assert(
        fc.property(hostnameArb, hostnameArb, (hostname1, hostname2) => {
          // Only test when hostnames are actually different
          fc.pre(hostname1 !== hostname2);

          const url1 = `https://${hostname1}`;
          const url2 = `https://${hostname2}`;

          expect(urlsEqual(url1, url2)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('Empty string should normalize to empty string', () => {
      expect(normalizeUrl('')).toBe('');
    });

    it('Null/undefined should be handled gracefully', () => {
      expect(normalizeUrl(null as unknown as string)).toBe('');
      expect(normalizeUrl(undefined as unknown as string)).toBe('');
    });

    it('Whitespace-only string should normalize to empty string', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 })
            .map(arr => arr.join('')),
          whitespace => {
            expect(normalizeUrl(whitespace)).toBe('');
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});

// ============= Additional Site Matcher Imports =============
import { matchSite, isOfficialUrl, determineSourceType } from '../main/utils/site-matcher';
import { SiteInfo, CliType, OFFICIAL_API_URLS } from '../shared/types/config-detection';
import type { CliDetectionResult } from '../shared/types/config-detection';

// ============= Site Matching Arbitraries =============

/**
 * Generate a valid site ID
 */
const siteIdArb = fc.uuid();

/**
 * Generate a valid site name
 */
const siteNameArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(s => /^[a-zA-Z0-9\u4e00-\u9fa5 _-]+$/.test(s));

/**
 * Generate a valid SiteInfo
 */
const siteInfoArb: fc.Arbitrary<SiteInfo> = fc.record({
  id: siteIdArb,
  name: siteNameArb,
  url: urlArb,
});

/**
 * Generate a list of SiteInfo
 */
const siteListArb = fc.array(siteInfoArb, { minLength: 0, maxLength: 10 });

/**
 * Generate a CLI type
 */
const cliTypeArb: fc.Arbitrary<CliType> = fc.constantFrom('claudeCode', 'codex');

// ============= Property 3: Site Matching Correctness =============

/**
 * **Property 3: Site Matching Correctness**
 * **Validates: Requirements 4.1, 4.3, 4.4, 4.5**
 *
 * *For any* extracted base URL and list of managed sites:
 * - If the URL matches a managed site URL (after normalization), sourceType SHALL be "managed" with the correct site name
 * - If the URL is an official API URL and no custom URL is configured, sourceType SHALL be "official"
 * - If the URL does not match any managed site and is not an official URL, sourceType SHALL be "other"
 * - If no URL or API key is configured, sourceType SHALL be "unknown"
 */
describe('Property 3: Site Matching Correctness', () => {
  describe('matchSite Function', () => {
    it('should match when config URL equals site URL', () => {
      fc.assert(
        fc.property(siteInfoArb, site => {
          const result = matchSite(site.url, [site]);
          expect(result.matched).toBe(true);
          expect(result.siteId).toBe(site.id);
          expect(result.siteName).toBe(site.name);
        }),
        { numRuns: 100 }
      );
    });

    it('should match when config URL equals site URL with different protocol/trailing slash', () => {
      fc.assert(
        fc.property(siteInfoArb, protocolArb, trailingSlashArb, (site, protocol, trailingSlash) => {
          // Create a variant of the site URL
          const normalizedSiteUrl = site.url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
          const variantUrl = `${protocol}${normalizedSiteUrl}${trailingSlash}`;

          const result = matchSite(variantUrl, [site]);
          expect(result.matched).toBe(true);
          expect(result.siteId).toBe(site.id);
        }),
        { numRuns: 100 }
      );
    });

    it('should not match when config URL does not match any site', () => {
      fc.assert(
        fc.property(hostnameArb, siteListArb, (hostname, sites) => {
          // Create a URL that is guaranteed to be different from all sites
          const uniqueUrl = `https://unique-${hostname}-${Date.now()}`;

          // Filter out any sites that might accidentally match
          const filteredSites = sites.filter(s => normalizeUrl(s.url) !== normalizeUrl(uniqueUrl));

          const result = matchSite(uniqueUrl, filteredSites);
          expect(result.matched).toBe(false);
          expect(result.siteId).toBeUndefined();
          expect(result.siteName).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should return not matched for empty site list', () => {
      fc.assert(
        fc.property(urlArb, url => {
          const result = matchSite(url, []);
          expect(result.matched).toBe(false);
        }),
        { numRuns: 50 }
      );
    });

    it('should return not matched for empty URL', () => {
      fc.assert(
        fc.property(siteListArb, sites => {
          const result = matchSite('', sites);
          expect(result.matched).toBe(false);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('isOfficialUrl Function', () => {
    it('should return true for official API URLs', () => {
      fc.assert(
        fc.property(cliTypeArb, cliType => {
          const officialUrls = OFFICIAL_API_URLS[cliType];
          for (const officialUrl of officialUrls) {
            expect(isOfficialUrl(officialUrl, cliType)).toBe(true);
          }
        }),
        { numRuns: 10 }
      );
    });

    it('should return true for official URLs with different protocols/trailing slashes', () => {
      fc.assert(
        fc.property(
          cliTypeArb,
          protocolArb,
          trailingSlashArb,
          (cliType, protocol, trailingSlash) => {
            const officialUrls = OFFICIAL_API_URLS[cliType];
            const baseOfficialUrl = officialUrls[0].replace(/^https?:\/\//, '').replace(/\/+$/, '');
            const variantUrl = `${protocol}${baseOfficialUrl}${trailingSlash}`;

            expect(isOfficialUrl(variantUrl, cliType)).toBe(true);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should return false for non-official URLs', () => {
      fc.assert(
        fc.property(cliTypeArb, hostnameArb, (cliType, hostname) => {
          // Create a URL that is guaranteed to be different from official URLs
          const nonOfficialUrl = `https://custom-${hostname}`;

          // Make sure it doesn't accidentally match official URLs
          const officialUrls = OFFICIAL_API_URLS[cliType];
          const isActuallyOfficial = officialUrls.some(official => {
            const normalizedOfficial = normalizeUrl(official);
            const normalizedTest = normalizeUrl(nonOfficialUrl);
            return (
              normalizedTest === normalizedOfficial ||
              normalizedTest.startsWith(normalizedOfficial + '/')
            );
          });

          if (!isActuallyOfficial) {
            expect(isOfficialUrl(nonOfficialUrl, cliType)).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should return false for empty URL', () => {
      fc.assert(
        fc.property(cliTypeArb, cliType => {
          expect(isOfficialUrl('', cliType)).toBe(false);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('determineSourceType Function', () => {
    it('should return "subscription" when isSubscription is true', () => {
      fc.assert(
        fc.property(
          fc.option(urlArb, { nil: undefined }),
          fc.boolean(),
          cliTypeArb,
          siteListArb,
          (baseUrl, hasApiKey, cliType, sites) => {
            const result = determineSourceType({
              baseUrl,
              hasApiKey,
              isSubscription: true,
              cliType,
              sites,
            });

            expect(result.sourceType).toBe('subscription');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return "managed" when URL matches a managed site', () => {
      fc.assert(
        fc.property(siteInfoArb, fc.boolean(), cliTypeArb, (site, hasApiKey, cliType) => {
          const result = determineSourceType({
            baseUrl: site.url,
            hasApiKey,
            isSubscription: false,
            cliType,
            sites: [site],
          });

          expect(result.sourceType).toBe('managed');
          expect(result.siteName).toBe(site.name);
          expect(result.siteId).toBe(site.id);
        }),
        { numRuns: 100 }
      );
    });

    it('should return "official" when URL is official API URL', () => {
      fc.assert(
        fc.property(cliTypeArb, fc.boolean(), (cliType, hasApiKey) => {
          const officialUrl = OFFICIAL_API_URLS[cliType][0];

          const result = determineSourceType({
            baseUrl: officialUrl,
            hasApiKey,
            isSubscription: false,
            cliType,
            sites: [], // Empty sites list to ensure no managed match
          });

          expect(result.sourceType).toBe('official');
        }),
        { numRuns: 30 }
      );
    });

    it('should return "official" when no URL but has API key', () => {
      fc.assert(
        fc.property(cliTypeArb, siteListArb, (cliType, sites) => {
          const result = determineSourceType({
            baseUrl: undefined,
            hasApiKey: true,
            isSubscription: false,
            cliType,
            sites,
          });

          expect(result.sourceType).toBe('official');
        }),
        { numRuns: 50 }
      );
    });

    it('should return "other" when URL does not match any site and is not official', () => {
      fc.assert(
        fc.property(
          hostnameArb,
          fc.boolean(),
          cliTypeArb,
          siteListArb,
          (hostname, hasApiKey, cliType, sites) => {
            // Create a URL that is guaranteed to be different
            const customUrl = `https://custom-proxy-${hostname}`;

            // Make sure it doesn't match any site or official URL
            const matchesSite = sites.some(s => normalizeUrl(s.url) === normalizeUrl(customUrl));
            const isOfficial = isOfficialUrl(customUrl, cliType);

            if (!matchesSite && !isOfficial) {
              const result = determineSourceType({
                baseUrl: customUrl,
                hasApiKey,
                isSubscription: false,
                cliType,
                sites,
              });

              expect(result.sourceType).toBe('other');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return "unknown" when no URL and no API key', () => {
      fc.assert(
        fc.property(cliTypeArb, siteListArb, (cliType, sites) => {
          const result = determineSourceType({
            baseUrl: undefined,
            hasApiKey: false,
            isSubscription: false,
            cliType,
            sites,
          });

          expect(result.sourceType).toBe('unknown');
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Priority Order', () => {
    it('subscription should take priority over managed site match', () => {
      fc.assert(
        fc.property(siteInfoArb, cliTypeArb, (site, cliType) => {
          const result = determineSourceType({
            baseUrl: site.url,
            hasApiKey: true,
            isSubscription: true,
            cliType,
            sites: [site],
          });

          // Even though URL matches a site, subscription takes priority
          expect(result.sourceType).toBe('subscription');
        }),
        { numRuns: 50 }
      );
    });

    it('managed site should take priority over official URL', () => {
      fc.assert(
        fc.property(cliTypeArb, cliType => {
          const officialUrl = OFFICIAL_API_URLS[cliType][0];
          const site: SiteInfo = {
            id: 'test-site-id',
            name: 'Test Site',
            url: officialUrl,
          };

          const result = determineSourceType({
            baseUrl: officialUrl,
            hasApiKey: true,
            isSubscription: false,
            cliType,
            sites: [site],
          });

          // Managed site match takes priority
          expect(result.sourceType).toBe('managed');
          expect(result.siteName).toBe('Test Site');
        }),
        { numRuns: 10 }
      );
    });
  });
});

// ============= Property 5: Caching Behavior =============

import { ConfigDetectionService } from '../main/config-detection-service';

/**
 * **Property 5: Caching Behavior**
 * **Validates: Requirements 6.3**
 *
 * *For any* sequence of detection calls without cache invalidation, the second and subsequent
 * calls SHALL NOT re-read the configuration files from disk (verified by cache hit).
 */
describe('Property 5: Caching Behavior', () => {
  describe('Cache Hit Behavior', () => {
    it('should return cached result on second call without re-reading files', async () => {
      await fc.assert(
        fc.asyncProperty(siteListArb, cliTypeArb, async (sites, cliType) => {
          // Create a new service instance with short TTL for testing
          const service = new ConfigDetectionService({ ttl: 60000 }); // 1 minute TTL

          // First call - should not have cache
          expect(service.hasCacheFor(cliType)).toBe(false);

          // Perform detection based on CLI type
          let firstResult: CliDetectionResult;
          if (cliType === 'claudeCode') {
            firstResult = await service.detectClaudeCode(sites);
          } else {
            firstResult = await service.detectCodex(sites);
          }

          // After first call - should have cache
          expect(service.hasCacheFor(cliType)).toBe(true);

          // Second call - should return cached result
          let secondResult: CliDetectionResult;
          if (cliType === 'claudeCode') {
            secondResult = await service.detectClaudeCode(sites);
          } else {
            secondResult = await service.detectCodex(sites);
          }

          // Results should be identical (same object from cache)
          expect(secondResult).toEqual(firstResult);
          expect(secondResult.detectedAt).toBe(firstResult.detectedAt);
        }),
        { numRuns: 30 }
      );
    });

    it('should clear cache when clearCache is called', async () => {
      await fc.assert(
        fc.asyncProperty(siteListArb, cliTypeArb, async (sites, cliType) => {
          const service = new ConfigDetectionService({ ttl: 60000 });

          // Perform detection
          if (cliType === 'claudeCode') {
            await service.detectClaudeCode(sites);
          } else {
            await service.detectCodex(sites);
          }

          // Should have cache
          expect(service.hasCacheFor(cliType)).toBe(true);

          // Clear cache
          service.clearCache();

          // Should not have cache anymore
          expect(service.hasCacheFor(cliType)).toBe(false);
        }),
        { numRuns: 30 }
      );
    });

    it('should clear specific CLI cache when clearCacheFor is called', async () => {
      await fc.assert(
        fc.asyncProperty(siteListArb, async sites => {
          const service = new ConfigDetectionService({ ttl: 60000 });

          // Detect all supported CLIs
          await service.detectAll(sites);

          // All supported CLIs should have cache
          expect(service.hasCacheFor('claudeCode')).toBe(true);
          expect(service.hasCacheFor('codex')).toBe(true);
          expect(service.hasCacheFor('grokBuild')).toBe(true);

          // Clear only claudeCode cache
          service.clearCacheFor('claudeCode');

          // Only claudeCode should not have cache
          expect(service.hasCacheFor('claudeCode')).toBe(false);
          expect(service.hasCacheFor('codex')).toBe(true);
          expect(service.hasCacheFor('grokBuild')).toBe(true);
        }),
        { numRuns: 20 }
      );
    });

    it('should expire cache after TTL', async () => {
      // Use a very short TTL for testing
      const service = new ConfigDetectionService({ ttl: 10 }); // 10ms TTL
      const sites: SiteInfo[] = [];

      // First detection
      const firstResult = await service.detectClaudeCode(sites);
      expect(service.hasCacheFor('claudeCode')).toBe(true);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Cache should be expired
      expect(service.hasCacheFor('claudeCode')).toBe(false);

      // Second detection should get fresh result
      const secondResult = await service.detectClaudeCode(sites);

      // detectedAt should be different (new detection)
      expect(secondResult.detectedAt).toBeGreaterThan(firstResult.detectedAt);
    });

    it('detectAll should use cache for all CLIs', async () => {
      await fc.assert(
        fc.asyncProperty(siteListArb, async sites => {
          const service = new ConfigDetectionService({ ttl: 60000 });

          // First detectAll
          const firstResult = await service.detectAll(sites);

          // All supported CLIs should have cache
          expect(service.hasCacheFor('claudeCode')).toBe(true);
          expect(service.hasCacheFor('codex')).toBe(true);
          expect(service.hasCacheFor('grokBuild')).toBe(true);

          // Second detectAll should return cached results
          const secondResult = await service.detectAll(sites);

          // Results should be identical
          expect(secondResult.claudeCode.detectedAt).toBe(firstResult.claudeCode.detectedAt);
          expect(secondResult.codex.detectedAt).toBe(firstResult.codex.detectedAt);
          expect(secondResult.grokBuild.detectedAt).toBe(firstResult.grokBuild.detectedAt);
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('Cache Isolation', () => {
    it('different service instances should have independent caches', async () => {
      await fc.assert(
        fc.asyncProperty(siteListArb, async sites => {
          const service1 = new ConfigDetectionService({ ttl: 60000 });
          const service2 = new ConfigDetectionService({ ttl: 60000 });

          // Detect with service1
          await service1.detectClaudeCode(sites);

          // service1 should have cache, service2 should not
          expect(service1.hasCacheFor('claudeCode')).toBe(true);
          expect(service2.hasCacheFor('claudeCode')).toBe(false);
        }),
        { numRuns: 20 }
      );
    });
  });
});
