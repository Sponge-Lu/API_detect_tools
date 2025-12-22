/**
 * Property-Based Tests for CLI Config Generator Service
 *
 * **Feature: cli-config-generator**
 *
 * These tests verify the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeUrl,
  normalizeApiKey,
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  ConfigParams,
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
 * - A valid JSON settings.json containing ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, and ANTHROPIC_MODEL fields
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
        expect(settings.env).toBeDefined();
        expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe(normalizeApiKey(params.apiKey));
        expect(settings.env.ANTHROPIC_BASE_URL).toBe(normalizeUrl(params.siteUrl));
        expect(settings.env.ANTHROPIC_MODEL).toBe(params.model);
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
