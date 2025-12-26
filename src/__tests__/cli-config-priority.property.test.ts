/**
 * 输入: 模拟的 CLI 配置数据
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CLI 配置优先级修复的属性测试
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: cli-config-priority-fix**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  GeminiCliConfig,
  GeminiEnvConfig,
  getEffectiveGeminiConfig,
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
  .map(s => `AIza${s}`);

// ============= Gemini CLI Config Arbitraries =============

/**
 * Generate a Gemini CLI config with google-login auth type
 */
const _geminiGoogleLoginConfigArb: fc.Arbitrary<GeminiCliConfig> = fc.constant({
  security: {
    auth: {
      selectedType: 'google-login',
    },
  },
});

/**
 * Generate a Gemini CLI config with vertex-ai auth type
 */
const _geminiVertexAiConfigArb: fc.Arbitrary<GeminiCliConfig> = fc.constant({
  security: {
    auth: {
      selectedType: 'vertex-ai',
    },
  },
});

/**
 * Generate a Gemini CLI config with gemini-api-key auth type
 */
const _geminiApiKeyConfigArb: fc.Arbitrary<GeminiCliConfig> = fc.constant({
  security: {
    auth: {
      selectedType: 'gemini-api-key',
    },
  },
});

/**
 * Generate a valid Gemini ENV config with base URL
 */
const geminiEnvConfigWithBaseUrlArb: fc.Arbitrary<GeminiEnvConfig> = fc.record({
  GEMINI_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
  GEMINI_MODEL: fc.option(fc.constantFrom('gemini-pro', 'gemini-1.5-pro'), { nil: undefined }),
  GOOGLE_GEMINI_BASE_URL: urlArb,
});

/**
 * Generate a valid Gemini ENV config without base URL but with API key
 */
const geminiEnvConfigWithApiKeyOnlyArb: fc.Arbitrary<GeminiEnvConfig> = fc.record({
  GEMINI_API_KEY: apiKeyArb,
  GEMINI_MODEL: fc.option(fc.constantFrom('gemini-pro', 'gemini-1.5-pro'), { nil: undefined }),
  GOOGLE_GEMINI_BASE_URL: fc.constant(undefined),
});

/**
 * Generate environment variables with base URL
 */
const processEnvWithBaseUrlArb = fc.record({
  GOOGLE_GEMINI_BASE_URL: urlArb,
  GEMINI_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
  GOOGLE_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
});

/**
 * Generate environment variables with API key only
 */
const _processEnvWithApiKeyOnlyArb = fc.record({
  GOOGLE_GEMINI_BASE_URL: fc.constant(undefined),
  GEMINI_API_KEY: apiKeyArb,
  GOOGLE_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
});

// ============= Property Tests =============

/**
 * **Property 1: Gemini CLI 订阅认证优先级**
 * **Validates: Requirements 1.1, 1.2**
 *
 * *For any* Gemini CLI configuration where `security.auth.selectedType` is "google-login" or "vertex-ai",
 * the detection result SHALL return `sourceType` as "subscription", regardless of any `GOOGLE_GEMINI_BASE_URL` configuration.
 */
describe('Property 1: Gemini CLI 订阅认证优先级', () => {
  it('should return subscription for google-login regardless of base_url in env config', () => {
    fc.assert(
      fc.property(fc.option(geminiEnvConfigWithBaseUrlArb, { nil: null }), envConfig => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'google-login' } },
        };

        const result = getEffectiveGeminiConfig(config, envConfig, {});

        expect(result.isSubscription).toBe(true);
        expect(result.authType).toBe('google-login');
        expect(result.hasApiKey).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should return subscription for google-login regardless of base_url in process.env', () => {
    fc.assert(
      fc.property(processEnvWithBaseUrlArb, processEnv => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'google-login' } },
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.isSubscription).toBe(true);
        expect(result.authType).toBe('google-login');
        expect(result.hasApiKey).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should return subscription for vertex-ai regardless of base_url in env config', () => {
    fc.assert(
      fc.property(fc.option(geminiEnvConfigWithBaseUrlArb, { nil: null }), envConfig => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'vertex-ai' } },
        };

        const result = getEffectiveGeminiConfig(config, envConfig, {});

        expect(result.isSubscription).toBe(true);
        expect(result.authType).toBe('vertex-ai');
        expect(result.hasApiKey).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should return subscription for vertex-ai regardless of base_url in process.env', () => {
    fc.assert(
      fc.property(processEnvWithBaseUrlArb, processEnv => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'vertex-ai' } },
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.isSubscription).toBe(true);
        expect(result.authType).toBe('vertex-ai');
        expect(result.hasApiKey).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 2: Gemini CLI API Key 认证时的 Base URL 检测**
 * **Validates: Requirements 1.3**
 *
 * *For any* Gemini CLI configuration where `security.auth.selectedType` is "gemini-api-key"
 * and `GOOGLE_GEMINI_BASE_URL` is configured, the detection result SHALL correctly detect
 * the base URL from environment variables (priority) or .env file.
 */
describe('Property 2: Gemini CLI API Key 认证时的 Base URL 检测', () => {
  it('should detect base_url from process.env when gemini-api-key auth type', () => {
    fc.assert(
      fc.property(urlArb, baseUrl => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const processEnv = {
          GOOGLE_GEMINI_BASE_URL: baseUrl,
          GEMINI_API_KEY: 'AIzaTestKey123',
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBe(baseUrl);
        expect(result.authType).toBe('gemini-api-key');
        expect(result.hasApiKey).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should detect base_url from .env file when gemini-api-key auth type and no env var', () => {
    fc.assert(
      fc.property(geminiEnvConfigWithBaseUrlArb, envConfig => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };

        const result = getEffectiveGeminiConfig(config, envConfig, {});

        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBe(envConfig.GOOGLE_GEMINI_BASE_URL);
      }),
      { numRuns: 100 }
    );
  });

  it('should prioritize process.env over .env file for base_url', () => {
    fc.assert(
      fc.property(urlArb, urlArb, (envBaseUrl, dotEnvBaseUrl) => {
        // Ensure URLs are different
        fc.pre(envBaseUrl !== dotEnvBaseUrl);

        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const envConfig: GeminiEnvConfig = {
          GOOGLE_GEMINI_BASE_URL: dotEnvBaseUrl,
          GEMINI_API_KEY: 'AIzaTestKey123',
        };
        const processEnv = {
          GOOGLE_GEMINI_BASE_URL: envBaseUrl,
          GEMINI_API_KEY: 'AIzaTestKey456',
        };

        const result = getEffectiveGeminiConfig(config, envConfig, processEnv);

        // Environment variable should take priority
        expect(result.baseUrl).toBe(envBaseUrl);
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from process.env GEMINI_API_KEY', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const processEnv = {
          GEMINI_API_KEY: apiKey,
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from process.env GOOGLE_API_KEY', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const processEnv = {
          GOOGLE_API_KEY: apiKey,
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 3: Gemini CLI 无 Base URL 时默认官方 API**
 * **Validates: Requirements 1.4**
 *
 * *For any* Gemini CLI configuration where `security.auth.selectedType` is "gemini-api-key",
 * no `GOOGLE_GEMINI_BASE_URL` is configured, and `GEMINI_API_KEY` exists,
 * the detection result SHALL return `authType` as "gemini-api-key" with no baseUrl.
 * (The sourceType will be determined by site-matcher as "official" when no baseUrl is present)
 */
describe('Property 3: Gemini CLI 无 Base URL 时默认官方 API', () => {
  it('should return gemini-api-key authType with no baseUrl when only API key is configured', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const processEnv = {
          GEMINI_API_KEY: apiKey,
          // No GOOGLE_GEMINI_BASE_URL
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should return gemini-api-key authType when API key is in .env file without base URL', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const envConfig: GeminiEnvConfig = {
          GEMINI_API_KEY: apiKey,
          // No GOOGLE_GEMINI_BASE_URL
        };

        const result = getEffectiveGeminiConfig(config, envConfig, {});

        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should return unknown authType when no API key and no base URL', () => {
    fc.assert(
      fc.property(fc.constantFrom('gemini-api-key', undefined), selectedType => {
        const config: GeminiCliConfig = selectedType
          ? { security: { auth: { selectedType } } }
          : {};

        const result = getEffectiveGeminiConfig(config, null, {});

        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(false);
        expect(result.authType).toBe('unknown');
      }),
      { numRuns: 50 }
    );
  });

  it('should fallback to checking env when settings.json has no selectedType', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        // No selectedType in config (simulating missing settings.json)
        const config: GeminiCliConfig = {};
        const processEnv = {
          GEMINI_API_KEY: apiKey,
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        // Should still detect API key even without selectedType
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
        expect(result.isSubscription).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should fallback to checking .env when settings.json is null', () => {
    fc.assert(
      fc.property(geminiEnvConfigWithApiKeyOnlyArb, envConfig => {
        const result = getEffectiveGeminiConfig(null, envConfig, {});

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
        expect(result.isSubscription).toBe(false);
        expect(result.baseUrl).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Claude Code Imports =============

import { ClaudeCodeConfig, getEffectiveClaudeCodeConfig } from '../main/utils/config-parsers';

// ============= Claude Code Config Arbitraries =============

/**
 * Generate a valid Claude Code config with base URL
 */
const claudeCodeConfigWithBaseUrlArb: fc.Arbitrary<ClaudeCodeConfig> = fc.record({
  env: fc.record({
    ANTHROPIC_BASE_URL: urlArb,
    ANTHROPIC_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
    ANTHROPIC_AUTH_TOKEN: fc.option(apiKeyArb, { nil: undefined }),
    ANTHROPIC_MODEL: fc.option(fc.constantFrom('claude-3-opus', 'claude-3-sonnet'), {
      nil: undefined,
    }),
  }),
});

/**
 * Generate a valid Claude Code config with API key only (no base URL)
 */
const claudeCodeConfigWithApiKeyOnlyArb: fc.Arbitrary<ClaudeCodeConfig> = fc.record({
  env: fc
    .record({
      ANTHROPIC_BASE_URL: fc.constant(undefined),
      ANTHROPIC_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
      ANTHROPIC_AUTH_TOKEN: fc.option(apiKeyArb, { nil: undefined }),
      ANTHROPIC_MODEL: fc.option(fc.constantFrom('claude-3-opus', 'claude-3-sonnet'), {
        nil: undefined,
      }),
    })
    .filter(env => !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)),
});

/**
 * Generate environment variables for Claude Code with base URL
 */
const _claudeCodeProcessEnvWithBaseUrlArb = fc.record({
  ANTHROPIC_BASE_URL: urlArb,
  ANTHROPIC_API_KEY: fc.option(apiKeyArb, { nil: undefined }),
  ANTHROPIC_AUTH_TOKEN: fc.option(apiKeyArb, { nil: undefined }),
});

/**
 * Generate environment variables for Claude Code with API key only
 */
const _claudeCodeProcessEnvWithApiKeyArb = fc.record({
  ANTHROPIC_BASE_URL: fc.constant(undefined),
  ANTHROPIC_API_KEY: apiKeyArb,
  ANTHROPIC_AUTH_TOKEN: fc.option(apiKeyArb, { nil: undefined }),
});

/**
 * Generate environment variables for Claude Code with auth token only
 */
const _claudeCodeProcessEnvWithAuthTokenArb = fc.record({
  ANTHROPIC_BASE_URL: fc.constant(undefined),
  ANTHROPIC_API_KEY: fc.constant(undefined),
  ANTHROPIC_AUTH_TOKEN: apiKeyArb,
});

// ============= Claude Code Property Tests =============

/**
 * **Property 4: Claude Code 环境变量优先级**
 * **Validates: Requirements 3.1, 3.2**
 *
 * *For any* Claude Code configuration, when `ANTHROPIC_BASE_URL` environment variable is set,
 * the detection result SHALL use the environment variable value, ignoring any `settings.json` configuration.
 */
describe('Property 4: Claude Code 环境变量优先级', () => {
  it('should use environment variable ANTHROPIC_BASE_URL over settings.json', () => {
    fc.assert(
      fc.property(urlArb, urlArb, (envBaseUrl, configBaseUrl) => {
        // Ensure URLs are different
        fc.pre(envBaseUrl !== configBaseUrl);

        const config: ClaudeCodeConfig = {
          env: {
            ANTHROPIC_BASE_URL: configBaseUrl,
            ANTHROPIC_API_KEY: 'sk-test-key-123',
          },
        };
        const processEnv = {
          ANTHROPIC_BASE_URL: envBaseUrl,
        };

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        // Environment variable should take priority
        expect(result.baseUrl).toBe(envBaseUrl);
      }),
      { numRuns: 100 }
    );
  });

  it('should fallback to settings.json when environment variable is not set', () => {
    fc.assert(
      fc.property(claudeCodeConfigWithBaseUrlArb, config => {
        const processEnv = {
          // No ANTHROPIC_BASE_URL in environment
        };

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        // Should use settings.json value
        expect(result.baseUrl).toBe(config.env?.ANTHROPIC_BASE_URL);
      }),
      { numRuns: 100 }
    );
  });

  it('should return undefined baseUrl when neither env nor config has base URL', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: ClaudeCodeConfig = {
          env: {
            ANTHROPIC_API_KEY: apiKey,
            // No ANTHROPIC_BASE_URL
          },
        };
        const processEnv = {
          // No ANTHROPIC_BASE_URL
        };

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.baseUrl).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should detect base URL from environment even when config is null', () => {
    fc.assert(
      fc.property(urlArb, baseUrl => {
        const processEnv = {
          ANTHROPIC_BASE_URL: baseUrl,
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.baseUrl).toBe(baseUrl);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 5: Claude Code 无 Base URL 时默认官方 API**
 * **Validates: Requirements 3.3**
 *
 * *For any* Claude Code configuration where `ANTHROPIC_BASE_URL` is not configured anywhere
 * and `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` exists, the detection result SHALL
 * return `authType` as "api-key" with no baseUrl.
 * (The sourceType will be determined by site-matcher as "official" when no baseUrl is present)
 */
describe('Property 5: Claude Code 无 Base URL 时默认官方 API', () => {
  it('should return api-key authType with no baseUrl when only API key is in env', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const processEnv = {
          ANTHROPIC_API_KEY: apiKey,
          // No ANTHROPIC_BASE_URL
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should return api-key authType with no baseUrl when only auth token is in env', () => {
    fc.assert(
      fc.property(apiKeyArb, authToken => {
        const processEnv = {
          ANTHROPIC_AUTH_TOKEN: authToken,
          // No ANTHROPIC_BASE_URL
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should return api-key authType with no baseUrl when API key is in settings.json only', () => {
    fc.assert(
      fc.property(claudeCodeConfigWithApiKeyOnlyArb, config => {
        const processEnv = {
          // No environment variables
        };

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should return unknown authType when no API key and no base URL', () => {
    fc.assert(
      fc.property(fc.constant({}), () => {
        const config: ClaudeCodeConfig = {};
        const processEnv = {};

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.baseUrl).toBeUndefined();
        expect(result.hasApiKey).toBe(false);
        expect(result.authType).toBe('unknown');
      }),
      { numRuns: 50 }
    );
  });
});

/**
 * **Property 6: Claude Code API Key 检测**
 * **Validates: Requirements 3.4**
 *
 * *For any* Claude Code configuration, when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`
 * is set in environment variables, `hasApiKey` SHALL be true.
 */
describe('Property 6: Claude Code API Key 检测', () => {
  it('should detect API key from environment variable ANTHROPIC_API_KEY', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const processEnv = {
          ANTHROPIC_API_KEY: apiKey,
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from environment variable ANTHROPIC_AUTH_TOKEN', () => {
    fc.assert(
      fc.property(apiKeyArb, authToken => {
        const processEnv = {
          ANTHROPIC_AUTH_TOKEN: authToken,
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from settings.json ANTHROPIC_API_KEY', () => {
    fc.assert(
      fc.property(apiKeyArb, apiKey => {
        const config: ClaudeCodeConfig = {
          env: {
            ANTHROPIC_API_KEY: apiKey,
          },
        };
        const processEnv = {};

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from settings.json ANTHROPIC_AUTH_TOKEN', () => {
    fc.assert(
      fc.property(apiKeyArb, authToken => {
        const config: ClaudeCodeConfig = {
          env: {
            ANTHROPIC_AUTH_TOKEN: authToken,
          },
        };
        const processEnv = {};

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect API key from either env or config (combined)', () => {
    fc.assert(
      fc.property(
        fc.option(apiKeyArb, { nil: undefined }),
        fc.option(apiKeyArb, { nil: undefined }),
        fc.option(apiKeyArb, { nil: undefined }),
        fc.option(apiKeyArb, { nil: undefined }),
        (envApiKey, envAuthToken, configApiKey, configAuthToken) => {
          // At least one must be set
          fc.pre(!!(envApiKey || envAuthToken || configApiKey || configAuthToken));

          const config: ClaudeCodeConfig = {
            env: {
              ANTHROPIC_API_KEY: configApiKey,
              ANTHROPIC_AUTH_TOKEN: configAuthToken,
            },
          };
          const processEnv: Record<string, string | undefined> = {
            ANTHROPIC_API_KEY: envApiKey,
            ANTHROPIC_AUTH_TOKEN: envAuthToken,
          };

          const result = getEffectiveClaudeCodeConfig(config, processEnv);

          expect(result.hasApiKey).toBe(true);
          expect(result.authType).toBe('api-key');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return hasApiKey false when no API key or auth token is configured', () => {
    fc.assert(
      fc.property(fc.option(urlArb, { nil: undefined }), baseUrl => {
        const config: ClaudeCodeConfig = baseUrl ? { env: { ANTHROPIC_BASE_URL: baseUrl } } : {};
        const processEnv: Record<string, string | undefined> = baseUrl
          ? { ANTHROPIC_BASE_URL: baseUrl }
          : {};

        const result = getEffectiveClaudeCodeConfig(config, processEnv);

        expect(result.hasApiKey).toBe(false);
        expect(result.authType).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Codex Imports =============

import {
  CodexConfig,
  CodexAuthConfig,
  getEffectiveCodexConfig,
  // checkCodexOAuthStatus is imported but used indirectly through getEffectiveCodexConfig
} from '../main/utils/config-parsers';

// ============= Codex Config Arbitraries =============

/**
 * Generate a valid Codex config with custom provider
 */
const codexConfigWithCustomProviderArb: fc.Arbitrary<CodexConfig> = fc
  .record({
    model_provider: fc
      .string({ minLength: 1, maxLength: 20 })
      .filter(s => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s)),
    model: fc.option(fc.constantFrom('gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'), { nil: undefined }),
  })
  .chain(base =>
    fc
      .record({
        name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
        base_url: urlArb,
        wire_api: fc.option(fc.constantFrom('chat', 'responses'), { nil: undefined }),
      })
      .map(provider => ({
        ...base,
        model_providers: {
          [base.model_provider!]: provider,
        },
      }))
  );

/**
 * Generate a valid Codex config without custom provider (default OpenAI)
 */
const _codexConfigWithoutCustomProviderArb: fc.Arbitrary<CodexConfig> = fc.record({
  model: fc.option(fc.constantFrom('gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'), { nil: undefined }),
  model_provider: fc.constant(undefined),
  model_providers: fc.constant(undefined),
});

/**
 * Generate a valid Codex auth config with API key
 */
const codexAuthConfigWithApiKeyArb: fc.Arbitrary<CodexAuthConfig> = fc.record({
  OPENAI_API_KEY: apiKeyArb.map(k => `sk-${k}`),
});

/**
 * Generate a valid Codex auth config with non-official API key (not starting with sk-)
 * Used for testing custom provider base_url detection
 */
const codexAuthConfigWithNonOfficialApiKeyArb: fc.Arbitrary<CodexAuthConfig> = fc.record({
  OPENAI_API_KEY: apiKeyArb.map(k => `custom-${k}`),
});

/**
 * Generate environment variables for Codex with API key
 */
const codexProcessEnvWithApiKeyArb = fc.record({
  OPENAI_API_KEY: apiKeyArb.map(k => `sk-${k}`),
});

/**
 * Generate environment variables for Codex with non-official API key
 * Used for testing custom provider base_url detection
 */
const codexProcessEnvWithNonOfficialApiKeyArb = fc.record({
  OPENAI_API_KEY: apiKeyArb.map(k => `custom-${k}`),
});

// ============= Codex Property Tests =============

/**
 * **Property 7: Codex OAuth 认证优先级**
 * **Validates: Requirements 2.1**
 *
 * *For any* Codex configuration where ChatGPT OAuth credentials exist and `model_provider`
 * is not explicitly set to a custom provider, the detection result SHALL return
 * `sourceType` as "official" with `authType` as "chatgpt-oauth".
 */
describe('Property 7: Codex OAuth 认证优先级', () => {
  it('should return chatgpt-oauth authType when OAuth exists and no custom provider', () => {
    fc.assert(
      fc.property(fc.option(codexAuthConfigWithApiKeyArb, { nil: null }), authConfig => {
        // No custom provider configured
        const config: CodexConfig = {};

        // OAuth status is true (credentials exist)
        const result = getEffectiveCodexConfig(config, authConfig, {}, true);

        expect(result.authType).toBe('chatgpt-oauth');
        expect(result.hasChatGptOAuth).toBe(true);
        expect(result.hasApiKey).toBe(false);
        expect(result.baseUrl).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should return chatgpt-oauth even when API key exists in auth.json but no custom provider', () => {
    fc.assert(
      fc.property(codexAuthConfigWithApiKeyArb, authConfig => {
        const config: CodexConfig = {
          model: 'gpt-4',
          // No model_provider set
        };

        const result = getEffectiveCodexConfig(config, authConfig, {}, true);

        // OAuth takes priority when no custom provider
        expect(result.authType).toBe('chatgpt-oauth');
        expect(result.hasChatGptOAuth).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should return chatgpt-oauth even when API key exists in env but no custom provider', () => {
    fc.assert(
      fc.property(codexProcessEnvWithApiKeyArb, processEnv => {
        const config: CodexConfig = {};

        const result = getEffectiveCodexConfig(config, null, processEnv, true);

        // OAuth takes priority when no custom provider
        expect(result.authType).toBe('chatgpt-oauth');
        expect(result.hasChatGptOAuth).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should return unknown when no OAuth and no API key', () => {
    fc.assert(
      fc.property(fc.constant({}), () => {
        const config: CodexConfig = {};

        const result = getEffectiveCodexConfig(config, null, {}, false);

        expect(result.authType).toBe('unknown');
        expect(result.hasChatGptOAuth).toBe(false);
        expect(result.hasApiKey).toBe(false);
      }),
      { numRuns: 50 }
    );
  });
});

/**
 * **Property 8: Codex 自定义 Provider 配置**
 * **Validates: Requirements 2.2, 2.3**
 *
 * *For any* Codex configuration where `model_provider` is set to a custom provider with `base_url`,
 * the detection result SHALL correctly detect and match the base URL when:
 * - No OAuth credentials exist, OR
 * - forced_login_method is set to 'api'
 *
 * When OAuth exists and forced_login_method is not 'api', OAuth takes priority.
 */
describe('Property 8: Codex 自定义 Provider 配置', () => {
  it('should use OAuth when OAuth exists and custom provider is configured (OAuth priority)', () => {
    fc.assert(
      fc.property(codexConfigWithCustomProviderArb, config => {
        // OAuth exists and custom provider is configured, but no forced_login_method = 'api'
        const result = getEffectiveCodexConfig(config, null, {}, true);

        // OAuth takes priority over custom provider
        expect(result.authType).toBe('chatgpt-oauth');
        expect(result.hasChatGptOAuth).toBe(true);
        expect(result.baseUrl).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should use custom provider base_url when forced_login_method is api', () => {
    fc.assert(
      fc.property(codexConfigWithCustomProviderArb, config => {
        // Add forced_login_method = 'api' to force API mode
        const configWithForced = {
          ...config,
          forced_login_method: 'api' as const,
        };

        const result = getEffectiveCodexConfig(configWithForced, null, {}, true);

        // Should use custom provider's base_url because forced_login_method = 'api'
        const expectedBaseUrl = config.model_providers?.[config.model_provider!]?.base_url;
        expect(result.baseUrl).toBe(expectedBaseUrl);
        expect(result.hasChatGptOAuth).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should detect custom provider base_url when no OAuth', () => {
    fc.assert(
      fc.property(
        codexConfigWithCustomProviderArb,
        codexAuthConfigWithNonOfficialApiKeyArb,
        (config, authConfig) => {
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          const expectedBaseUrl = config.model_providers?.[config.model_provider!]?.base_url;
          expect(result.baseUrl).toBe(expectedBaseUrl);
          expect(result.hasApiKey).toBe(true);
          expect(result.hasChatGptOAuth).toBe(false);
          expect(result.isOfficialApiKey).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect API key from auth.json when custom provider is set and no OAuth', () => {
    fc.assert(
      fc.property(
        codexConfigWithCustomProviderArb,
        codexAuthConfigWithNonOfficialApiKeyArb,
        (config, authConfig) => {
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          expect(result.hasApiKey).toBe(true);
          expect(result.authType).toBe('api-key');
          expect(result.isOfficialApiKey).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect API key from environment when custom provider is set and no OAuth', () => {
    fc.assert(
      fc.property(
        codexConfigWithCustomProviderArb,
        codexProcessEnvWithNonOfficialApiKeyArb,
        (config, processEnv) => {
          const result = getEffectiveCodexConfig(config, null, processEnv, false);

          expect(result.hasApiKey).toBe(true);
          expect(result.authType).toBe('api-key');
          expect(result.isOfficialApiKey).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return api-key authType when no OAuth but has API key and no custom provider', () => {
    fc.assert(
      fc.property(codexAuthConfigWithApiKeyArb, authConfig => {
        const config: CodexConfig = {};

        const result = getEffectiveCodexConfig(config, authConfig, {}, false);

        expect(result.authType).toBe('api-key');
        expect(result.hasApiKey).toBe(true);
        expect(result.hasChatGptOAuth).toBe(false);
        expect(result.baseUrl).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should return api-key authType when no OAuth but has API key in env and no custom provider', () => {
    fc.assert(
      fc.property(codexProcessEnvWithApiKeyArb, processEnv => {
        const config: CodexConfig = {};

        const result = getEffectiveCodexConfig(config, null, processEnv, false);

        expect(result.authType).toBe('api-key');
        expect(result.hasApiKey).toBe(true);
        expect(result.hasChatGptOAuth).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should return unknown authType when no OAuth, no API key, but has custom provider', () => {
    fc.assert(
      fc.property(codexConfigWithCustomProviderArb, config => {
        const result = getEffectiveCodexConfig(config, null, {}, false);

        // When no OAuth and no API key, but has custom provider
        expect(result.baseUrl).toBeDefined();
        expect(result.hasChatGptOAuth).toBe(false);
        expect(result.hasApiKey).toBe(false);
        expect(result.authType).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Site Matcher Imports =============

import { determineSourceType, normalizeUrl } from '../main/utils/site-matcher';
import { SiteInfo, OFFICIAL_API_URLS } from '../shared/types/config-detection';

// ============= Site Matcher Arbitraries =============

/**
 * Generate a valid site info
 */
const siteInfoArb: fc.Arbitrary<SiteInfo> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  url: urlArb,
});

/**
 * Generate a list of site infos
 */
const siteListArb: fc.Arbitrary<SiteInfo[]> = fc.array(siteInfoArb, {
  minLength: 0,
  maxLength: 10,
});

/**
 * Generate official API URLs for different CLI types
 */
const _officialUrlArb = fc.constantFrom(
  'https://api.anthropic.com',
  'https://api.anthropic.com/v1',
  'https://api.openai.com',
  'https://api.openai.com/v1',
  'https://generativelanguage.googleapis.com',
  'https://generativelanguage.googleapis.com/v1'
);

/**
 * Generate a non-official URL (other relay site)
 */
const nonOfficialUrlArb = fc.webUrl().filter(url => {
  const normalized = normalizeUrl(url);
  return (
    !normalized.includes('api.anthropic.com') &&
    !normalized.includes('api.openai.com') &&
    !normalized.includes('generativelanguage.googleapis.com')
  );
});

/**
 * Generate CLI type
 */
const cliTypeArb = fc.constantFrom('claudeCode', 'codex', 'geminiCli') as fc.Arbitrary<
  'claudeCode' | 'codex' | 'geminiCli'
>;

// ============= Property 9 Tests =============

/**
 * **Property 9: Base URL 匹配正确性**
 * **Validates: Requirements 4.3, 4.4, 4.5**
 *
 * *For any* base URL and site list, the `determineSourceType` function SHALL:
 * - Return "managed" with correct site info when URL matches a managed site
 * - Return "official" when URL matches official API URLs
 * - Return "other" when URL matches neither
 */
describe('Property 9: Base URL 匹配正确性', () => {
  it('should return "managed" with correct site info when URL matches a managed site', () => {
    fc.assert(
      fc.property(
        siteListArb.filter(sites => sites.length > 0),
        cliTypeArb,
        (sites, cliType) => {
          // Pick a random site from the list
          const targetSite = sites[0];

          const result = determineSourceType({
            baseUrl: targetSite.url,
            hasApiKey: true,
            cliType,
            sites,
          });

          expect(result.sourceType).toBe('managed');
          expect(result.siteName).toBe(targetSite.name);
          expect(result.siteId).toBe(targetSite.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return "official" when URL matches official API URLs for claudeCode', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OFFICIAL_API_URLS.claudeCode),
        siteListArb,
        (officialUrl, sites) => {
          const result = determineSourceType({
            baseUrl: officialUrl,
            hasApiKey: true,
            cliType: 'claudeCode',
            sites,
          });

          expect(result.sourceType).toBe('official');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return "official" when URL matches official API URLs for codex', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OFFICIAL_API_URLS.codex),
        siteListArb,
        (officialUrl, sites) => {
          const result = determineSourceType({
            baseUrl: officialUrl,
            hasApiKey: true,
            cliType: 'codex',
            sites,
          });

          expect(result.sourceType).toBe('official');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return "official" when URL matches official API URLs for geminiCli', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OFFICIAL_API_URLS.geminiCli),
        siteListArb,
        (officialUrl, sites) => {
          const result = determineSourceType({
            baseUrl: officialUrl,
            hasApiKey: true,
            cliType: 'geminiCli',
            sites,
          });

          expect(result.sourceType).toBe('official');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return "other" when URL matches neither managed sites nor official URLs', () => {
    fc.assert(
      fc.property(nonOfficialUrlArb, cliTypeArb, (baseUrl, cliType) => {
        // Empty site list to ensure no managed site match
        const sites: SiteInfo[] = [];

        const result = determineSourceType({
          baseUrl,
          hasApiKey: true,
          cliType,
          sites,
        });

        expect(result.sourceType).toBe('other');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "subscription" when authType is google-login regardless of baseUrl', () => {
    fc.assert(
      fc.property(fc.option(urlArb, { nil: undefined }), siteListArb, (baseUrl, sites) => {
        const result = determineSourceType({
          baseUrl,
          hasApiKey: false,
          authType: 'google-login',
          cliType: 'geminiCli',
          sites,
        });

        expect(result.sourceType).toBe('subscription');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "subscription" when authType is vertex-ai regardless of baseUrl', () => {
    fc.assert(
      fc.property(fc.option(urlArb, { nil: undefined }), siteListArb, (baseUrl, sites) => {
        const result = determineSourceType({
          baseUrl,
          hasApiKey: false,
          authType: 'vertex-ai',
          cliType: 'geminiCli',
          sites,
        });

        expect(result.sourceType).toBe('subscription');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "official" when authType is chatgpt-oauth regardless of baseUrl', () => {
    fc.assert(
      fc.property(fc.option(urlArb, { nil: undefined }), siteListArb, (baseUrl, sites) => {
        const result = determineSourceType({
          baseUrl,
          hasApiKey: false,
          authType: 'chatgpt-oauth',
          cliType: 'codex',
          sites,
        });

        expect(result.sourceType).toBe('official');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "official" when no baseUrl but hasApiKey is true', () => {
    fc.assert(
      fc.property(cliTypeArb, siteListArb, (cliType, sites) => {
        const result = determineSourceType({
          baseUrl: undefined,
          hasApiKey: true,
          cliType,
          sites,
        });

        expect(result.sourceType).toBe('official');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "unknown" when no baseUrl and no apiKey', () => {
    fc.assert(
      fc.property(cliTypeArb, siteListArb, (cliType, sites) => {
        const result = determineSourceType({
          baseUrl: undefined,
          hasApiKey: false,
          cliType,
          sites,
        });

        expect(result.sourceType).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });

  it('should prioritize authType over baseUrl matching', () => {
    fc.assert(
      fc.property(
        siteListArb.filter(sites => sites.length > 0),
        sites => {
          // Even if baseUrl matches a managed site, authType should take priority
          const targetSite = sites[0];

          const result = determineSourceType({
            baseUrl: targetSite.url,
            hasApiKey: false,
            authType: 'google-login',
            cliType: 'geminiCli',
            sites,
          });

          // authType takes priority, so should return subscription
          expect(result.sourceType).toBe('subscription');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============= Property 10 Tests =============

/**
 * **Property 10: API Key 认证类型标记**
 * **Validates: Requirements 5.4**
 *
 * *For any* CLI configuration using API key authentication (not OAuth or subscription),
 * the `authType` field SHALL be set to "api-key" or the specific API key type (e.g., "gemini-api-key").
 */
describe('Property 10: API Key 认证类型标记', () => {
  it('should set authType to "api-key" for Claude Code when using API key authentication', () => {
    fc.assert(
      fc.property(apiKeyArb, fc.option(urlArb, { nil: undefined }), (apiKey, baseUrl) => {
        const config: ClaudeCodeConfig = {
          env: {
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_BASE_URL: baseUrl,
          },
        };

        const result = getEffectiveClaudeCodeConfig(config, {});

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should set authType to "api-key" for Claude Code when using auth token', () => {
    fc.assert(
      fc.property(apiKeyArb, fc.option(urlArb, { nil: undefined }), (authToken, baseUrl) => {
        const processEnv: Record<string, string | undefined> = {
          ANTHROPIC_AUTH_TOKEN: authToken,
          ANTHROPIC_BASE_URL: baseUrl,
        };

        const result = getEffectiveClaudeCodeConfig(null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
      }),
      { numRuns: 100 }
    );
  });

  it('should set authType to "gemini-api-key" for Gemini CLI when using API key authentication', () => {
    fc.assert(
      fc.property(apiKeyArb, fc.option(urlArb, { nil: undefined }), (apiKey, baseUrl) => {
        const config: GeminiCliConfig = {
          security: { auth: { selectedType: 'gemini-api-key' } },
        };
        const processEnv: Record<string, string | undefined> = {
          GEMINI_API_KEY: apiKey,
          GOOGLE_GEMINI_BASE_URL: baseUrl,
        };

        const result = getEffectiveGeminiConfig(config, null, processEnv);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
        expect(result.isSubscription).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should set authType to "gemini-api-key" for Gemini CLI when API key is in .env file', () => {
    fc.assert(
      fc.property(apiKeyArb, fc.option(urlArb, { nil: undefined }), (apiKey, baseUrl) => {
        const config: GeminiCliConfig = {};
        const envConfig: GeminiEnvConfig = {
          GEMINI_API_KEY: apiKey,
          GOOGLE_GEMINI_BASE_URL: baseUrl,
        };

        const result = getEffectiveGeminiConfig(config, envConfig, {});

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('gemini-api-key');
        expect(result.isSubscription).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should set authType to "api-key" for Codex when using API key authentication (no OAuth)', () => {
    fc.assert(
      fc.property(
        codexAuthConfigWithApiKeyArb,
        fc.option(codexConfigWithCustomProviderArb, { nil: null }),
        (authConfig, config) => {
          const result = getEffectiveCodexConfig(config, authConfig, {}, false);

          expect(result.hasApiKey).toBe(true);
          expect(result.authType).toBe('api-key');
          expect(result.hasChatGptOAuth).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should set authType to "api-key" for Codex when API key is in environment', () => {
    fc.assert(
      fc.property(codexProcessEnvWithApiKeyArb, processEnv => {
        const result = getEffectiveCodexConfig(null, null, processEnv, false);

        expect(result.hasApiKey).toBe(true);
        expect(result.authType).toBe('api-key');
        expect(result.hasChatGptOAuth).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should NOT set authType to "api-key" for Gemini CLI when using google-login', () => {
    fc.assert(
      fc.property(
        fc.option(apiKeyArb, { nil: undefined }),
        fc.option(urlArb, { nil: undefined }),
        (apiKey, baseUrl) => {
          const config: GeminiCliConfig = {
            security: { auth: { selectedType: 'google-login' } },
          };
          const processEnv: Record<string, string | undefined> = {
            GEMINI_API_KEY: apiKey,
            GOOGLE_GEMINI_BASE_URL: baseUrl,
          };

          const result = getEffectiveGeminiConfig(config, null, processEnv);

          // Should be google-login, not api-key
          expect(result.authType).toBe('google-login');
          expect(result.isSubscription).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT set authType to "api-key" for Codex when using ChatGPT OAuth (no custom provider)', () => {
    fc.assert(
      fc.property(fc.option(codexAuthConfigWithApiKeyArb, { nil: null }), authConfig => {
        // No custom provider, OAuth exists
        const config: CodexConfig = {};

        const result = getEffectiveCodexConfig(config, authConfig, {}, true);

        // Should be chatgpt-oauth, not api-key
        expect(result.authType).toBe('chatgpt-oauth');
        expect(result.hasChatGptOAuth).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should set authType to "unknown" when no API key and no OAuth/subscription', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('claudeCode', 'codex', 'geminiCli') as fc.Arbitrary<
          'claudeCode' | 'codex' | 'geminiCli'
        >,
        cliType => {
          if (cliType === 'claudeCode') {
            const result = getEffectiveClaudeCodeConfig({}, {});
            expect(result.authType).toBe('unknown');
            expect(result.hasApiKey).toBe(false);
          } else if (cliType === 'codex') {
            const result = getEffectiveCodexConfig({}, null, {}, false);
            expect(result.authType).toBe('unknown');
            expect(result.hasApiKey).toBe(false);
          } else {
            const result = getEffectiveGeminiConfig({}, null, {});
            expect(result.authType).toBe('unknown');
            expect(result.hasApiKey).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
