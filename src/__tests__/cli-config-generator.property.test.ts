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
  CODEX_PROVIDER_NAME,
  normalizeUrl,
  normalizeApiKey,
  generateClaudeCodeConfig,
  generateClaudeCodeRouteConfig,
  generateCodexConfig,
  generateCodexRouteConfig,
  generateGrokBuildConfig,
  generateGrokBuildRouteConfig,
  generateOpenCodeConfig,
  generateOpenCodeRouteConfig,
  GROK_BUILD_MANAGED_MODEL_IDS,
  OPENCODE_ROUTE_PROVIDER_IDS,
  resolveClaudeCodeDisplayModel,
  ConfigParams,
} from '../renderer/services/cli-config-generator';
import {
  getCliTargetEndpoint,
  isCliTargetProtocolNativeEquivalent,
} from '../shared/types/cli-config';
import { ROUTE_CLI_MARKER_HEADER, ROUTE_CLI_MARKER_VALUES } from '../shared/types/route-proxy';

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
        expect(settings.env.HTTPS_PROXY).toBeUndefined();
        expect(settings.env.HTTP_PROXY).toBeUndefined();
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

  it('should always use AnyAPI as the Codex provider name', () => {
    fc.assert(
      fc.property(configParamsArb, params => {
        const config = generateCodexConfig(params);

        const configFile = config.files.find(f => f.path.includes('config.toml'));
        const content = configFile!.content;

        expect(content).toContain(`model_provider = "${CODEX_PROVIDER_NAME}"`);
        expect(content).toContain(`[model_providers.${CODEX_PROVIDER_NAME}]`);
        expect(content).toContain(`name = "${CODEX_PROVIDER_NAME}"`);
        expect(content).toContain('env_key = "OPENAI_API_KEY"');
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

describe('OpenCode config generation', () => {
  const params = {
    siteUrl: 'https://api.example.com',
    siteName: 'AnyAPI',
    apiKey: 'sk-test-key',
    model: 'test-model',
  };

  it('should enable a 16000-token thinking budget for Anthropic Messages', () => {
    const config = generateOpenCodeConfig({ ...params, targetProtocol: 'anthropic-messages' });
    const configFile = config.files.find(file => file.path.endsWith('/opencode.json'));
    const content = JSON.parse(configFile!.content);

    expect(content).toMatchObject({
      model: 'anthropic/test-model',
      provider: {
        anthropic: {
          models: {
            'test-model': {
              options: {
                thinking: {
                  type: 'enabled',
                  budgetTokens: 16000,
                },
              },
            },
          },
        },
      },
    });
  });

  it.each([undefined, 'native'] as const)(
    'should default %s target protocol to OpenAI Responses',
    targetProtocol => {
      const config = generateOpenCodeConfig({ ...params, targetProtocol });
      const configFile = config.files.find(file => file.path.endsWith('/opencode.json'));
      const content = JSON.parse(configFile!.content);

      expect(content).toMatchObject({
        model: 'openai/test-model',
        provider: {
          openai: {
            models: {
              'test-model': {
                options: { reasoningEffort: 'high' },
              },
            },
          },
        },
      });
    }
  );

  it('should treat OpenAI Responses as the OpenCode native protocol', () => {
    expect(getCliTargetEndpoint('openCode', 'native')).toBe('/v1/responses');
    expect(isCliTargetProtocolNativeEquivalent('openCode', 'openai-responses')).toBe(true);
    expect(isCliTargetProtocolNativeEquivalent('openCode', 'openai-chat-completions')).toBe(false);
  });

  it.each(['openai-responses', 'openai-chat-completions'] as const)(
    'should default reasoning effort to high for %s',
    targetProtocol => {
      const config = generateOpenCodeConfig({ ...params, targetProtocol });
      const configFile = config.files.find(file => file.path.endsWith('/opencode.json'));
      const content = JSON.parse(configFile!.content);
      const providerId = targetProtocol === 'openai-responses' ? 'openai' : 'anyapi';

      expect(content.provider[providerId].models['test-model'].options).toEqual({
        reasoningEffort: 'high',
      });
    }
  );

  it('should generate three isolated providers for the managed OpenCode route', () => {
    const config = generateOpenCodeRouteConfig(params);
    const configFile = config.files.find(file => file.path.endsWith('/opencode.json'));
    const authFile = config.files.find(file => file.path.endsWith('/auth.json'));
    const content = JSON.parse(configFile!.content);
    const auth = JSON.parse(authFile!.content);

    expect(content.model).toBe(`${OPENCODE_ROUTE_PROVIDER_IDS.responses}/test-model`);
    expect(Object.keys(content.provider)).toEqual(
      expect.arrayContaining(Object.values(OPENCODE_ROUTE_PROVIDER_IDS))
    );
    expect(content.provider[OPENCODE_ROUTE_PROVIDER_IDS.anthropic].npm).toBe('@ai-sdk/anthropic');
    expect(content.provider[OPENCODE_ROUTE_PROVIDER_IDS.responses].npm).toBe('@ai-sdk/openai');
    expect(content.provider[OPENCODE_ROUTE_PROVIDER_IDS.chat].npm).toBe(
      '@ai-sdk/openai-compatible'
    );

    for (const providerId of Object.values(OPENCODE_ROUTE_PROVIDER_IDS)) {
      expect(content.provider[providerId].options).toMatchObject({
        baseURL: 'https://api.example.com/v1',
      });
      expect(content.provider[providerId].options.headers).toBeUndefined();
      expect(content.provider[providerId].models['test-model']).toEqual({ name: 'test-model' });
      expect(auth[providerId]).toEqual({ type: 'api', key: 'sk-test-key' });
    }
  });

  it('should generate three managed Grok Build models and mark only route configs', () => {
    const direct = generateGrokBuildConfig({ ...params, targetProtocol: 'native' });
    const route = generateGrokBuildRouteConfig(params);
    const directToml = direct.files[0].content;
    const routeToml = route.files[0].content;

    expect(direct.files[0].path).toBe('~/.grok/config.toml');
    expect(routeToml).toContain(`default = "${GROK_BUILD_MANAGED_MODEL_IDS.responses}"`);
    expect(routeToml).toContain(`[model.${GROK_BUILD_MANAGED_MODEL_IDS.responses}]`);
    expect(routeToml).toContain('api_backend = "responses"');
    expect(routeToml).toContain(`[model.${GROK_BUILD_MANAGED_MODEL_IDS.chat}]`);
    expect(routeToml).toContain('api_backend = "chat_completions"');
    expect(routeToml).toContain(`[model.${GROK_BUILD_MANAGED_MODEL_IDS.messages}]`);
    expect(routeToml).toContain('api_backend = "messages"');
    expect(routeToml.match(/supports_backend_search = false/g)).toHaveLength(3);
    expect(routeToml.match(/stream_tool_calls = false/g)).toHaveLength(3);
    expect(directToml).not.toContain(ROUTE_CLI_MARKER_HEADER);
    expect(routeToml).not.toContain(ROUTE_CLI_MARKER_HEADER);
    expect(directToml).toContain('extra_headers = { "x-api-key" = "sk-test-key" }');
    expect(routeToml).toContain('extra_headers = { "x-api-key" = "sk-test-key" }');
  });

  it('should preserve Grok Build API keys with non-OpenAI prefixes', () => {
    const config = generateGrokBuildConfig({
      ...params,
      apiKey: 'xai-test-key',
      targetProtocol: 'native',
    });

    expect(config.files[0].content).toContain('api_key = "xai-test-key"');
    expect(config.files[0].content).toContain('extra_headers = { "x-api-key" = "xai-test-key" }');
    expect(config.files[0].content).not.toContain('sk-xai-test-key');
    const messagesBlock = config.files[0].content.split(
      `[model.${GROK_BUILD_MANAGED_MODEL_IDS.messages}]`
    )[1];
    expect(messagesBlock).not.toContain('\napi_key =');
  });

  it('does not add legacy CLI markers to newly generated route configs', () => {
    const directClaude = generateClaudeCodeConfig(params);
    const routeClaude = generateClaudeCodeRouteConfig(params);
    const directClaudeSettings = JSON.parse(directClaude.files[0].content);
    const routeClaudeSettings = JSON.parse(routeClaude.files[0].content);

    expect(directClaudeSettings.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(routeClaudeSettings.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();

    const directCodex = generateCodexConfig(params).files[0].content;
    const routeCodex = generateCodexRouteConfig(params).files[0].content;
    expect(directCodex).not.toContain(ROUTE_CLI_MARKER_HEADER);
    expect(routeCodex).not.toContain(ROUTE_CLI_MARKER_HEADER);
  });
});
