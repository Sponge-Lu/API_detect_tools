/**
 * 输入: 模拟的 CLI 配置生成参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CLI 配置生成器的属性测试，验证端点选择逻辑正确性
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: cli-config-generator**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeUrl,
  normalizeApiKey,
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  resolveClaudeCodeDisplayModel,
  selectEndpointFormat,
  generateEndpointComment,
  ConfigParams,
  GeminiConfigParams,
} from '../renderer/services/cli-config-generator';

// ============= Arbitraries =============

/**
 * Generate a valid URL without trailing slashes
 */
const baseUrlArb = fc
  .webUrl()
  .map(url => url.replace(/\/+$/, ''))
  .filter(url => url.length > 0);

/**
 * Generate a URL with trailing slashes
 */
const urlWithTrailingSlashesArb = fc
  .tuple(baseUrlArb, fc.integer({ min: 1, max: 10 }))
  .map(([url, count]) => url + '/'.repeat(count));

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
  fc.constantFrom(
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'gpt-4',
    'gpt-4-turbo',
    'gpt-3.5-turbo'
  ),
  fc
    .tuple(
      fc.constantFrom('claude-', 'gpt-'),
      fc.integer({ min: 1, max: 5 }),
      fc.option(fc.constantFrom('-turbo', '-preview', '-mini'), { nil: '' })
    )
    .map(([prefix, version, suffix]) => `${prefix}${version}${suffix || ''}`)
);

/**
 * Generate a valid site name
 */
const siteNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter(s => /^[a-zA-Z0-9 _-]+$/.test(s) && s.trim().length > 0);

/**
 * Generate valid ConfigParams
 */
const configParamsArb: fc.Arbitrary<ConfigParams> = fc.record({
  siteUrl: baseUrlArb,
  siteName: siteNameArb,
  apiKey: apiKeyArb,
  model: modelNameArb,
});

/**
 * Generate ConfigParams with trailing slashes in URL
 */
const configParamsWithTrailingSlashArb: fc.Arbitrary<ConfigParams> = fc.record({
  siteUrl: urlWithTrailingSlashesArb,
  siteName: siteNameArb,
  apiKey: apiKeyArb,
  model: modelNameArb,
});

// ============= Property Tests =============

/**
 * **Property 3: URL normalization removes trailing slashes**
 * **Validates: Requirements 3.5**
 *
 * *For any* site URL with one or more trailing slashes, the generated
 * configuration SHALL contain the URL without trailing slashes
 */
describe('Property 3: URL normalization removes trailing slashes', () => {
  it('should remove all trailing slashes from URL', () => {
    fc.assert(
      fc.property(urlWithTrailingSlashesArb, url => {
        const normalized = normalizeUrl(url);
        expect(normalized).not.toMatch(/\/$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve URL without trailing slashes', () => {
    fc.assert(
      fc.property(baseUrlArb, url => {
        const normalized = normalizeUrl(url);
        expect(normalized).toBe(url);
      }),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - normalizing twice produces same result', () => {
    fc.assert(
      fc.property(urlWithTrailingSlashesArb, url => {
        const once = normalizeUrl(url);
        const twice = normalizeUrl(once);
        expect(once).toBe(twice);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 1: Claude Code config generation produces valid output with all required fields**
 * **Validates: Requirements 3.1, 3.2**
 *
 * *For any* valid site URL, API key, and model combination, generating Claude Code
 * configuration SHALL produce:
 * - A valid JSON settings.json containing top-level model plus ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, and the three ANTHROPIC_DEFAULT_* model fields
 * - A valid JSON config.json containing primaryApiKey field
 */
describe('Property 1: Claude Code config generation produces valid output', () => {
  it('should generate valid JSON for settings.json with all required fields', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateClaudeCodeConfig(params);

        // Find settings.json file
        const settingsFile = config.files.find(f => f.path.includes('settings.json'));
        expect(settingsFile).toBeDefined();
        expect(settingsFile!.language).toBe('json');

        // Parse and validate JSON
        const settings = JSON.parse(settingsFile!.content);
        expect(settings.model).toBe(resolveClaudeCodeDisplayModel(params.model));
        expect(settings.env).toBeDefined();
        expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe(normalizeApiKey(params.apiKey));
        expect(settings.env.ANTHROPIC_BASE_URL).toBe(normalizeUrl(params.siteUrl));
        expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(params.model);
        expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(params.model);
        expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(params.model);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate valid JSON for config.json with primaryApiKey field', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateClaudeCodeConfig(params);

        // Find config.json file
        const configFile = config.files.find(f => f.path.includes('config.json'));
        expect(configFile).toBeDefined();
        expect(configFile!.language).toBe('json');

        // Parse and validate JSON
        const configJson = JSON.parse(configFile!.content);
        expect(configJson.primaryApiKey).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize URL in generated config (remove trailing slashes)', () => {
    fc.assert(
      fc.property(configParamsWithTrailingSlashArb, params => {
        const config = generateClaudeCodeConfig(params);

        const settingsFile = config.files.find(f => f.path.includes('settings.json'));
        const settings = JSON.parse(settingsFile!.content);

        // URL should not have trailing slashes
        expect(settings.env.ANTHROPIC_BASE_URL).not.toMatch(/\/$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate exactly 2 config files', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateClaudeCodeConfig(params);
        expect(config.files.length).toBe(2);
      }),
      { numRuns: 100 }
    );
  });

  it('should use correct file paths', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateClaudeCodeConfig(params);

        const paths = config.files.map(f => f.path);
        expect(paths).toContain('~/.claude/settings.json');
        expect(paths).toContain('~/.claude/config.json');
      }),
      { numRuns: 100 }
    );
  });

  it('should map Claude 4.6+ sonnet and opus models to the 1m aliases only for the top-level model field', () => {
    expect(resolveClaudeCodeDisplayModel('claude-sonnet-4-6')).toBe('sonnet[1m]');
    expect(resolveClaudeCodeDisplayModel('claude-opus-4.6-20260201')).toBe('opus[1m]');
    expect(resolveClaudeCodeDisplayModel('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
    expect(resolveClaudeCodeDisplayModel('claude-haiku-4-6')).toBe('claude-haiku-4-6');

    const config = generateClaudeCodeConfig({
      siteUrl: 'https://example.com',
      siteName: 'Example',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
    });
    const settingsFile = config.files.find(f => f.path.includes('settings.json'));
    const settings = JSON.parse(settingsFile!.content);

    expect(settings.model).toBe('sonnet[1m]');
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6');
  });
});

/**
 * **Property 2: Codex config generation produces valid output with all required fields**
 * **Validates: Requirements 3.3, 3.4**
 *
 * *For any* valid site URL, API key, and model combination, generating Codex
 * configuration SHALL produce:
 * - A valid TOML config.toml containing model_provider, model, base_url, and wire_api fields
 * - A valid JSON auth.json containing OPENAI_API_KEY field
 */
describe('Property 2: Codex config generation produces valid output', () => {
  it('should generate config.toml with all required fields', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        // Find config.toml file
        const configFile = config.files.find(f => f.path.includes('config.toml'));
        expect(configFile).toBeDefined();
        expect(configFile!.language).toBe('toml');

        const content = configFile!.content;

        // Verify required fields exist in TOML
        expect(content).toContain('model_provider');
        expect(content).toContain('model');
        expect(content).toContain('base_url');
        expect(content).toContain('wire_api');
      }),
      { numRuns: 100 }
    );
  });

  it('should generate valid JSON for auth.json with OPENAI_API_KEY field', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        // Find auth.json file
        const authFile = config.files.find(f => f.path.includes('auth.json'));
        expect(authFile).toBeDefined();
        expect(authFile!.language).toBe('json');

        // Parse and validate JSON
        const authJson = JSON.parse(authFile!.content);
        expect(authJson.OPENAI_API_KEY).toBe(params.apiKey);
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize URL in generated config (remove trailing slashes)', () => {
    fc.assert(
      fc.property(configParamsWithTrailingSlashArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        // Extract base_url value and verify no trailing slashes before /v1
        const baseUrlMatch = content.match(/base_url\s*=\s*"([^"]+)"/);
        expect(baseUrlMatch).toBeDefined();
        const baseUrl = baseUrlMatch![1];

        // URL should end with /v1, not //v1 or ///v1
        expect(baseUrl).toMatch(/[^/]\/v1$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate exactly 2 config files', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);
        expect(config.files.length).toBe(2);
      }),
      { numRuns: 100 }
    );
  });

  it('should use correct file paths', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const paths = config.files.map(f => f.path);
        expect(paths).toContain('~/.codex/config.toml');
        expect(paths).toContain('~/.codex/auth.json');
      }),
      { numRuns: 100 }
    );
  });

  it('should include model value in config.toml', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        // Verify model is included
        expect(content).toContain(`model = "${params.model}"`);
      }),
      { numRuns: 100 }
    );
  });

  it('should use multi_agent instead of the deprecated collab feature flag', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);
        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        expect(content).toContain('[features]');
        expect(content).toContain('multi_agent = true');
        expect(content).not.toContain('collab =');
      }),
      { numRuns: 100 }
    );
  });

  it('should always use OpenAI as the Codex provider name', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        expect(content).toContain('model_provider = "OpenAI"');
        expect(content).toContain('[model_providers.OpenAI]');
        expect(content).toContain('name = "openai"');
      }),
      { numRuns: 100 }
    );
  });

  it('should include wire_api = "responses" in config.toml', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        expect(content).toContain('wire_api = "responses"');
      }),
      { numRuns: 100 }
    );
  });

  it('should default Codex reasoning effort to xhigh', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        expect(content).toContain('model_reasoning_effort = "xhigh"');
        expect(content).not.toContain('model_reasoning_effort = "high"');
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 4: Gemini CLI config generation produces valid output with all required fields**
 * **Validates: Requirements 3.5, 3.6**
 *
 * *For any* valid site URL, API key, and model combination, generating Gemini CLI
 * configuration SHALL produce:
 * - A valid JSON settings.json containing security.auth.selectedType field
 * - A valid .env file containing GEMINI_API_KEY, GEMINI_MODEL, and GOOGLE_GEMINI_BASE_URL fields
 */
describe('Property 4: Gemini CLI config generation produces valid output', () => {
  it('should generate valid JSON for settings.json with all required fields', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateGeminiCliConfig(params);

        // Find settings.json file
        const settingsFile = config.files.find(f => f.path.includes('settings.json'));
        expect(settingsFile).toBeDefined();
        expect(settingsFile!.language).toBe('json');

        // Parse and validate JSON
        const settings = JSON.parse(settingsFile!.content);
        expect(settings.security).toBeDefined();
        expect(settings.security.auth).toBeDefined();
        expect(settings.security.auth.selectedType).toBe('gemini-api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should generate .env file with all required fields', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateGeminiCliConfig(params);

        // Find .env file
        const envFile = config.files.find(f => f.path.includes('.env'));
        expect(envFile).toBeDefined();

        const content = envFile!.content;

        // Verify required fields exist
        expect(content).toContain('GEMINI_API_KEY=');
        expect(content).toContain('GEMINI_MODEL=');
        expect(content).toContain('GOOGLE_GEMINI_BASE_URL=');
        expect(content).toContain(params.model);
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize URL in generated config (remove trailing slashes)', () => {
    fc.assert(
      fc.property(configParamsWithTrailingSlashArb, params => {
        const config = generateGeminiCliConfig(params);

        const envFile = config.files.find(f => f.path.includes('.env'));
        const content = envFile!.content;

        // Extract GOOGLE_GEMINI_BASE_URL value and verify no trailing slashes
        const urlMatch = content.match(/GOOGLE_GEMINI_BASE_URL=(.+)/);
        expect(urlMatch).toBeDefined();
        const baseUrl = urlMatch![1];

        // URL should not have trailing slashes
        expect(baseUrl).not.toMatch(/\/$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate exactly 2 config files', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateGeminiCliConfig(params);
        expect(config.files.length).toBe(2);
      }),
      { numRuns: 100 }
    );
  });

  it('should use correct file paths', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateGeminiCliConfig(params);

        const paths = config.files.map(f => f.path);
        expect(paths).toContain('~/.gemini/settings.json');
        expect(paths).toContain('~/.gemini/.env');
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize API key with sk- prefix', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateGeminiCliConfig(params);

        const envFile = config.files.find(f => f.path.includes('.env'));
        const content = envFile!.content;

        // Extract GEMINI_API_KEY value
        const keyMatch = content.match(/GEMINI_API_KEY=(.+)/);
        expect(keyMatch).toBeDefined();
        const apiKey = keyMatch![1];

        // API key should start with sk-
        expect(apiKey).toMatch(/^sk-/);
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Gemini Detail Arbitraries =============

/**
 * Generate a valid GeminiDetail object
 */
const geminiDetailArb = fc.record({
  native: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  proxy: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
});

/**
 * Generate valid GeminiConfigParams
 */
const geminiConfigParamsArb: fc.Arbitrary<GeminiConfigParams> = fc.record({
  siteUrl: baseUrlArb,
  siteName: siteNameArb,
  apiKey: apiKeyArb,
  model: modelNameArb,
  geminiDetail: fc.option(geminiDetailArb, { nil: undefined }),
});

// ============= Property 2: 端点格式选择正确性 =============

/**
 * **Property 2: 端点格式选择正确性**
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * *For any* combination of Gemini test results (native: boolean | null, proxy: boolean | null),
 * the `selectEndpointFormat` function SHALL return:
 * - 'proxy' when proxy === true (regardless of native)
 * - 'native' when proxy !== true AND native === true
 * - 'proxy' when both are false or null (default)
 */
describe('Property 2: 端点格式选择正确性', () => {
  it('should return proxy when proxy === true (regardless of native)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)), native => {
        const result = selectEndpointFormat({ native, proxy: true });
        expect(result).toBe('proxy');
      }),
      { numRuns: 100 }
    );
  });

  it('should return native when proxy !== true AND native === true', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(false), fc.constant(null)), proxy => {
        const result = selectEndpointFormat({ native: true, proxy });
        expect(result).toBe('native');
      }),
      { numRuns: 100 }
    );
  });

  it('should return proxy when both are false or null (default)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(false), fc.constant(null)),
        fc.oneof(fc.constant(false), fc.constant(null)),
        (native, proxy) => {
          const result = selectEndpointFormat({ native, proxy });
          expect(result).toBe('proxy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return proxy when geminiDetail is undefined', () => {
    const result = selectEndpointFormat(undefined);
    expect(result).toBe('proxy');
  });

  it('should always return either proxy or native', () => {
    fc.assert(
      fc.property(geminiDetailArb, detail => {
        const result = selectEndpointFormat(detail);
        expect(['proxy', 'native']).toContain(result);
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Property 3: 配置注释包含测试结果 =============

/**
 * **Property 3: 配置注释包含测试结果**
 * **Validates: Requirements 2.4**
 *
 * *For any* Gemini CLI configuration generation with geminiDetail provided,
 * the generated `.env` file content SHALL contain a comment line showing the test results
 * in format `# 端点测试结果: native=X, proxy=Y` where X and Y are ✓, ✗, or ?.
 */
describe('Property 3: 配置注释包含测试结果', () => {
  it('should include endpoint comment in .env file when geminiDetail is provided', () => {
    fc.assert(
      fc.property(geminiConfigParamsArb, params => {
        const config = generateGeminiCliConfig(params);
        const envFile = config.files.find(f => f.path.includes('.env'));
        expect(envFile).toBeDefined();

        const content = envFile!.content;

        if (params.geminiDetail) {
          // Should contain test result comment
          expect(content).toContain('# 端点测试结果:');
          expect(content).toContain('native=');
          expect(content).toContain('proxy=');
        } else {
          // Should contain default comment (端点格式说明)
          expect(content).toContain('# 端点格式说明:');
          expect(content).toContain('native');
          expect(content).toContain('proxy');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should use correct status symbols in comment', () => {
    fc.assert(
      fc.property(geminiDetailArb, detail => {
        const comment = generateEndpointComment(detail);

        const nativeExpected = detail.native === true ? '✓' : detail.native === false ? '✗' : '?';
        const proxyExpected = detail.proxy === true ? '✓' : detail.proxy === false ? '✗' : '?';

        expect(comment).toContain(`native=${nativeExpected}`);
        expect(comment).toContain(`proxy=${proxyExpected}`);
      }),
      { numRuns: 100 }
    );
  });

  it('should return default comment when geminiDetail is undefined', () => {
    const comment = generateEndpointComment(undefined);
    expect(comment).toContain('# 端点格式说明:');
    expect(comment).toContain('proxy');
    expect(comment).toContain('native');
  });
});
