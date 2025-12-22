/**
 * Property-Based Tests for Unified CLI Config Dialog
 *
 * **Feature: unified-cli-config**
 *
 * These tests verify the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import type { CliConfig } from '../shared/types/cli-config';
import { DEFAULT_CLI_CONFIG } from '../shared/types/cli-config';
import { filterValidCliConfigs } from '../renderer/components/dialogs/ApplyConfigPopover';
import { isCliEnabled } from '../renderer/components/CliCompatibilityIcons';

// ============= Types =============

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

const CLI_TYPES: CliType[] = ['claudeCode', 'codex', 'geminiCli'];

// ============= Arbitraries =============

/**
 * Generate a random CLI type
 */
const cliTypeArb = fc.constantFrom<CliType>(...CLI_TYPES);

/**
 * Generate a random boolean for enabled state
 */
const enabledStateArb = fc.boolean();

/**
 * Generate a random API Key ID (positive integer or null)
 */
const apiKeyIdArb = fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null });

/**
 * Generate a random model name
 */
const modelArb = fc.option(
  fc.oneof(
    fc.constantFrom(
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'gpt-4',
      'gpt-4-turbo',
      'gemini-pro'
    ),
    fc.string({ minLength: 5, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s))
  ),
  { nil: null }
);

/**
 * Generate a random CLI config item
 */
const cliConfigItemArb = fc.record({
  apiKeyId: apiKeyIdArb,
  model: modelArb,
  enabled: enabledStateArb,
});

/**
 * Generate a complete CLI config
 */
const cliConfigArb: fc.Arbitrary<CliConfig> = fc.record({
  claudeCode: cliConfigItemArb,
  codex: cliConfigItemArb,
  geminiCli: cliConfigItemArb,
});

// ============= Helper Functions =============

/**
 * Simulates toggling the enabled state for a CLI type
 * This mirrors the logic in UnifiedCliConfigDialog.handleToggleEnabled
 */
function toggleEnabledState(
  currentState: Record<CliType, boolean>,
  cliType: CliType
): Record<CliType, boolean> {
  return {
    ...currentState,
    [cliType]: !currentState[cliType],
  };
}

/**
 * Builds a CliConfig from enabled states and config items
 * This mirrors the logic in UnifiedCliConfigDialog.handleSave
 */
function buildCliConfig(
  enabledState: Record<CliType, boolean>,
  cliConfigs: Record<CliType, { apiKeyId: number | null; model: string | null }>
): CliConfig {
  return {
    claudeCode: {
      apiKeyId: cliConfigs.claudeCode.apiKeyId,
      model: cliConfigs.claudeCode.model,
      enabled: enabledState.claudeCode,
    },
    codex: {
      apiKeyId: cliConfigs.codex.apiKeyId,
      model: cliConfigs.codex.model,
      enabled: enabledState.codex,
    },
    geminiCli: {
      apiKeyId: cliConfigs.geminiCli.apiKeyId,
      model: cliConfigs.geminiCli.model,
      enabled: enabledState.geminiCli,
    },
  };
}

/**
 * Checks if a CLI config has valid configuration (both apiKeyId and model set)
 */
function hasValidConfig(config: CliConfig, cliType: CliType): boolean {
  const item = config[cliType];
  if (!item) return false;
  return item.apiKeyId !== null && item.model !== null;
}

// ============= Property Tests =============

/**
 * **Property 1: CLI enabled toggle updates state correctly**
 * **Validates: Requirements 2.3**
 *
 * *For any* CLI type and any initial enabled state, toggling the enable switch
 * SHALL result in the opposite enabled state being stored in the configuration.
 */
describe('Property 1: CLI enabled toggle updates state correctly', () => {
  it('should toggle enabled state to opposite value for any CLI type', () => {
    fc.assert(
      fc.property(
        cliTypeArb,
        fc.record({
          claudeCode: enabledStateArb,
          codex: enabledStateArb,
          geminiCli: enabledStateArb,
        }),
        (cliType, initialState) => {
          const newState = toggleEnabledState(initialState, cliType);

          // The toggled CLI should have opposite state
          expect(newState[cliType]).toBe(!initialState[cliType]);

          // Other CLIs should remain unchanged
          for (const otherCli of CLI_TYPES) {
            if (otherCli !== cliType) {
              expect(newState[otherCli]).toBe(initialState[otherCli]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - toggling twice returns to original state', () => {
    fc.assert(
      fc.property(
        cliTypeArb,
        fc.record({
          claudeCode: enabledStateArb,
          codex: enabledStateArb,
          geminiCli: enabledStateArb,
        }),
        (cliType, initialState) => {
          const afterFirstToggle = toggleEnabledState(initialState, cliType);
          const afterSecondToggle = toggleEnabledState(afterFirstToggle, cliType);

          // After toggling twice, state should be back to original
          expect(afterSecondToggle[cliType]).toBe(initialState[cliType]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve default enabled states when no config provided', () => {
    // Verify default states match expected values - all CLIs default to enabled
    expect(DEFAULT_CLI_CONFIG.claudeCode.enabled).toBe(true);
    expect(DEFAULT_CLI_CONFIG.codex.enabled).toBe(true);
    expect(DEFAULT_CLI_CONFIG.geminiCli.enabled).toBe(true);
  });
});

/**
 * **Property 2: CLI icon visibility follows enabled state**
 * **Validates: Requirements 2.4, 6.2**
 *
 * *For any* CLI type, the CLI icon SHALL be visible in the Site_Card
 * if and only if the CLI is enabled in the configuration.
 */
describe('Property 2: CLI icon visibility follows enabled state', () => {
  it('should return true for enabled CLI and false for disabled CLI', () => {
    fc.assert(
      fc.property(cliTypeArb, enabledStateArb, (cliType, enabled) => {
        // Create a config with the specified enabled state
        const config: CliConfig = {
          claudeCode: {
            apiKeyId: 1,
            model: 'test',
            enabled: cliType === 'claudeCode' ? enabled : true,
          },
          codex: { apiKeyId: 1, model: 'test', enabled: cliType === 'codex' ? enabled : true },
          geminiCli: {
            apiKeyId: 1,
            model: 'test',
            enabled: cliType === 'geminiCli' ? enabled : false,
          },
        };

        const isEnabled = isCliEnabled(config, cliType);
        expect(isEnabled).toBe(enabled);
      }),
      { numRuns: 100 }
    );
  });

  it('should use default enabled state when config is null', () => {
    fc.assert(
      fc.property(cliTypeArb, cliType => {
        const isEnabled = isCliEnabled(null, cliType);
        expect(isEnabled).toBe(DEFAULT_CLI_CONFIG[cliType].enabled);
      }),
      { numRuns: 100 }
    );
  });

  it('should use default enabled state when CLI config item is undefined', () => {
    fc.assert(
      fc.property(cliTypeArb, cliType => {
        // Create a config with undefined item for the CLI type
        const config: CliConfig = {
          claudeCode:
            cliType === 'claudeCode' ? undefined : { apiKeyId: 1, model: 'test', enabled: true },
          codex: cliType === 'codex' ? undefined : { apiKeyId: 1, model: 'test', enabled: true },
          geminiCli:
            cliType === 'geminiCli' ? undefined : { apiKeyId: 1, model: 'test', enabled: false },
        } as CliConfig;

        const isEnabled = isCliEnabled(config, cliType);
        expect(isEnabled).toBe(DEFAULT_CLI_CONFIG[cliType].enabled);
      }),
      { numRuns: 100 }
    );
  });

  it('should use default enabled state when enabled field is undefined (legacy config)', () => {
    fc.assert(
      fc.property(cliTypeArb, cliType => {
        // Create a config without enabled field (legacy format)
        const config: CliConfig = {
          claudeCode: { apiKeyId: 1, model: 'test' } as any,
          codex: { apiKeyId: 1, model: 'test' } as any,
          geminiCli: { apiKeyId: 1, model: 'test' } as any,
        };

        const isEnabled = isCliEnabled(config, cliType);
        expect(isEnabled).toBe(DEFAULT_CLI_CONFIG[cliType].enabled);
      }),
      { numRuns: 100 }
    );
  });

  it('should correctly reflect visibility for all CLI types in a config', () => {
    fc.assert(
      fc.property(cliConfigArb, config => {
        for (const cliType of CLI_TYPES) {
          const isEnabled = isCliEnabled(config, cliType);
          const configItem = config[cliType];

          if (configItem && configItem.enabled !== undefined) {
            // If enabled is explicitly set, use that value
            expect(isEnabled).toBe(configItem.enabled);
          } else {
            // Otherwise use default
            expect(isEnabled).toBe(DEFAULT_CLI_CONFIG[cliType].enabled);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 5: Save persists all configuration fields**
 * **Validates: Requirements 4.2**
 *
 * *For any* valid configuration (with API Key ID, model, and enabled state),
 * clicking Save SHALL persist all three fields to the site's cliConfig.
 */
describe('Property 5: Save persists all configuration fields', () => {
  it('should persist all fields (apiKeyId, model, enabled) for each CLI type', () => {
    fc.assert(
      fc.property(
        fc.record({
          claudeCode: enabledStateArb,
          codex: enabledStateArb,
          geminiCli: enabledStateArb,
        }),
        fc.record({
          claudeCode: fc.record({ apiKeyId: apiKeyIdArb, model: modelArb }),
          codex: fc.record({ apiKeyId: apiKeyIdArb, model: modelArb }),
          geminiCli: fc.record({ apiKeyId: apiKeyIdArb, model: modelArb }),
        }),
        (enabledState, cliConfigs) => {
          const savedConfig = buildCliConfig(enabledState, cliConfigs);

          // Verify all fields are persisted for each CLI type
          for (const cliType of CLI_TYPES) {
            const item = savedConfig[cliType];
            expect(item).toBeDefined();
            expect(item!.apiKeyId).toBe(cliConfigs[cliType].apiKeyId);
            expect(item!.model).toBe(cliConfigs[cliType].model);
            expect(item!.enabled).toBe(enabledState[cliType]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve null values for unconfigured fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          claudeCode: enabledStateArb,
          codex: enabledStateArb,
          geminiCli: enabledStateArb,
        }),
        enabledState => {
          // Create config with all null apiKeyId and model
          const cliConfigs = {
            claudeCode: { apiKeyId: null, model: null },
            codex: { apiKeyId: null, model: null },
            geminiCli: { apiKeyId: null, model: null },
          };

          const savedConfig = buildCliConfig(enabledState, cliConfigs);

          // Verify null values are preserved
          for (const cliType of CLI_TYPES) {
            const item = savedConfig[cliType];
            expect(item!.apiKeyId).toBeNull();
            expect(item!.model).toBeNull();
            // But enabled state should still be set
            expect(item!.enabled).toBe(enabledState[cliType]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should correctly identify valid configurations', () => {
    fc.assert(
      fc.property(cliConfigArb, config => {
        for (const cliType of CLI_TYPES) {
          const item = config[cliType];
          const isValid = hasValidConfig(config, cliType);

          if (item && item.apiKeyId !== null && item.model !== null) {
            expect(isValid).toBe(true);
          } else {
            expect(isValid).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 6: Apply popover shows only valid configurations**
 * **Validates: Requirements 5.3**
 *
 * *For any* CLI configuration state, the Apply_Popover SHALL display only
 * CLI types that have both apiKeyId and model set to non-null values.
 */
describe('Property 6: Apply popover shows only valid configurations', () => {
  it('should filter to show only CLIs with both apiKeyId and model set', () => {
    fc.assert(
      fc.property(cliConfigArb, config => {
        // Use the actual filterValidCliConfigs function from ApplyConfigPopover
        const validCliTypes = filterValidCliConfigs(config);

        // Verify each valid CLI has both fields set
        for (const cliType of validCliTypes) {
          const item = config[cliType];
          expect(item).toBeDefined();
          expect(item!.apiKeyId).not.toBeNull();
          expect(item!.model).not.toBeNull();
        }

        // Verify excluded CLIs are missing at least one field
        const supportedTypes: ('claudeCode' | 'codex')[] = ['claudeCode', 'codex'];
        const excludedCliTypes = supportedTypes.filter(cliType => !validCliTypes.includes(cliType));
        for (const cliType of excludedCliTypes) {
          const item = config[cliType];
          const hasApiKeyId = item && item.apiKeyId !== null;
          const hasModel = item && item.model !== null;
          expect(hasApiKeyId && hasModel).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return empty list when no CLI has valid configuration', () => {
    // Config with all null values
    const emptyConfig: CliConfig = {
      claudeCode: { apiKeyId: null, model: null, enabled: true },
      codex: { apiKeyId: null, model: null, enabled: true },
      geminiCli: { apiKeyId: null, model: null, enabled: false },
    };

    const validCliTypes = filterValidCliConfigs(emptyConfig);
    expect(validCliTypes).toHaveLength(0);
  });

  it('should return empty list when config is null', () => {
    const validCliTypes = filterValidCliConfigs(null);
    expect(validCliTypes).toHaveLength(0);
  });

  it('should include CLI even if disabled but has valid config', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
        (apiKeyId, model) => {
          // Config with valid but disabled CLI
          const config: CliConfig = {
            claudeCode: { apiKeyId, model, enabled: false }, // disabled but valid
            codex: { apiKeyId: null, model: null, enabled: true },
            geminiCli: { apiKeyId: null, model: null, enabled: false },
          };

          // filterValidCliConfigs should return claudeCode regardless of enabled state
          const validCliTypes = filterValidCliConfigs(config);
          expect(validCliTypes).toContain('claudeCode');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return all supported CLI types (claudeCode, codex, geminiCli)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
        (apiKeyId, model) => {
          // Config with all CLIs having valid config
          const config: CliConfig = {
            claudeCode: { apiKeyId, model, enabled: true },
            codex: { apiKeyId, model, enabled: true },
            geminiCli: { apiKeyId, model, enabled: true },
          };

          const validCliTypes = filterValidCliConfigs(config);

          // Should include all three supported types
          expect(validCliTypes).toContain('claudeCode');
          expect(validCliTypes).toContain('codex');
          expect(validCliTypes).toContain('geminiCli');
          expect(validCliTypes).toHaveLength(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 7: Apply writes correct configuration files**
 * **Validates: Requirements 5.4**
 *
 * *For any* CLI type selected in the Apply_Popover, the system SHALL generate
 * and write the correct configuration files to the corresponding paths.
 */
describe('Property 7: Apply writes correct configuration files', () => {
  // Import config generators for testing - use dynamic import compatible with vitest
  let generateClaudeCodeConfig: any;
  let generateCodexConfig: any;
  let normalizeUrl: any;
  let normalizeApiKey: any;

  beforeAll(async () => {
    const module = await import('../renderer/services/cli-config-generator');
    generateClaudeCodeConfig = module.generateClaudeCodeConfig;
    generateCodexConfig = module.generateCodexConfig;
    normalizeUrl = module.normalizeUrl;
    normalizeApiKey = module.normalizeApiKey;
  });

  /**
   * Generate valid site URL
   */
  const siteUrlArb = fc.webUrl({ validSchemes: ['https'] }).filter(url => url.length > 10);

  /**
   * Generate valid site name (alphanumeric with spaces)
   */
  const siteNameArb = fc
    .string({ minLength: 3, maxLength: 30 })
    .filter(s => /^[a-zA-Z][a-zA-Z0-9 ]*$/.test(s));

  /**
   * Generate valid API key
   */
  const apiKeyArb = fc
    .string({ minLength: 20, maxLength: 100 })
    .filter(s => /^[a-zA-Z0-9_-]+$/.test(s));

  /**
   * Generate valid model name
   */
  const modelNameArb = fc.oneof(
    fc.constantFrom(
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o'
    ),
    fc.string({ minLength: 5, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s))
  );

  it('should generate Claude Code config with all required fields', () => {
    fc.assert(
      fc.property(
        siteUrlArb,
        siteNameArb,
        apiKeyArb,
        modelNameArb,
        (siteUrl, siteName, apiKey, model) => {
          const config = generateClaudeCodeConfig({ siteUrl, siteName, apiKey, model });

          // Should generate exactly 2 files
          expect(config.files).toHaveLength(2);

          // Check settings.json
          const settingsFile = config.files.find((f: any) => f.path === '~/.claude/settings.json');
          expect(settingsFile).toBeDefined();
          expect(settingsFile!.language).toBe('json');

          const settings = JSON.parse(settingsFile!.content);
          expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe(normalizeApiKey(apiKey));
          expect(settings.env.ANTHROPIC_BASE_URL).toBe(normalizeUrl(siteUrl));
          expect(settings.env.ANTHROPIC_MODEL).toBe(model);
          expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(model);
          expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(model);
          expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(model);

          // Check config.json
          const configFile = config.files.find((f: any) => f.path === '~/.claude/config.json');
          expect(configFile).toBeDefined();
          expect(configFile!.language).toBe('json');

          const configJson = JSON.parse(configFile!.content);
          expect(configJson.primaryApiKey).toBe('any');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should generate Codex config with all required fields', () => {
    fc.assert(
      fc.property(
        siteUrlArb,
        siteNameArb,
        apiKeyArb,
        modelNameArb,
        (siteUrl, siteName, apiKey, model) => {
          const config = generateCodexConfig({ siteUrl, siteName, apiKey, model });

          // Should generate exactly 2 files
          expect(config.files).toHaveLength(2);

          // Check config.toml
          const configTomlFile = config.files.find((f: any) => f.path === '~/.codex/config.toml');
          expect(configTomlFile).toBeDefined();
          expect(configTomlFile!.language).toBe('toml');

          const tomlContent = configTomlFile!.content;
          const providerName = siteName.replace(/\s+/g, '_');

          // Verify required fields in TOML
          expect(tomlContent).toContain(`model_provider = "${providerName}"`);
          expect(tomlContent).toContain(`model = "${model}"`);
          expect(tomlContent).toContain(`base_url = "${normalizeUrl(siteUrl)}/v1"`);
          expect(tomlContent).toContain(`[model_providers.${providerName}]`);

          // Check auth.json
          const authFile = config.files.find((f: any) => f.path === '~/.codex/auth.json');
          expect(authFile).toBeDefined();
          expect(authFile!.language).toBe('json');

          const authJson = JSON.parse(authFile!.content);
          expect(authJson.OPENAI_API_KEY).toBe(normalizeApiKey(apiKey));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should normalize URL by removing trailing slashes', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['https'] }),
        fc.constantFrom('', '/', '//', '///'),
        (baseUrl, trailingSlashes) => {
          const urlWithSlashes = baseUrl + trailingSlashes;
          const normalized = normalizeUrl(urlWithSlashes);

          // Should not end with slash
          expect(normalized.endsWith('/')).toBe(false);

          // Should preserve the base URL
          expect(normalized).toBe(baseUrl.replace(/\/+$/, ''));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should generate valid JSON for Claude Code config files', () => {
    fc.assert(
      fc.property(
        siteUrlArb,
        siteNameArb,
        apiKeyArb,
        modelNameArb,
        (siteUrl, siteName, apiKey, model) => {
          const config = generateClaudeCodeConfig({ siteUrl, siteName, apiKey, model });

          // All JSON files should be parseable
          for (const file of config.files) {
            if (file.language === 'json') {
              expect(() => JSON.parse(file.content)).not.toThrow();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should generate valid JSON for Codex auth file', () => {
    fc.assert(
      fc.property(
        siteUrlArb,
        siteNameArb,
        apiKeyArb,
        modelNameArb,
        (siteUrl, siteName, apiKey, model) => {
          const config = generateCodexConfig({ siteUrl, siteName, apiKey, model });

          // auth.json should be parseable
          const authFile = config.files.find((f: any) => f.path === '~/.codex/auth.json');
          expect(() => JSON.parse(authFile!.content)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use correct file paths for each CLI type', () => {
    fc.assert(
      fc.property(
        siteUrlArb,
        siteNameArb,
        apiKeyArb,
        modelNameArb,
        (siteUrl, siteName, apiKey, model) => {
          const params = { siteUrl, siteName, apiKey, model };

          // Claude Code paths
          const claudeConfig = generateClaudeCodeConfig(params);
          const claudePaths = claudeConfig.files.map((f: any) => f.path);
          expect(claudePaths).toContain('~/.claude/settings.json');
          expect(claudePaths).toContain('~/.claude/config.json');

          // Codex paths
          const codexConfig = generateCodexConfig(params);
          const codexPaths = codexConfig.files.map((f: any) => f.path);
          expect(codexPaths).toContain('~/.codex/config.toml');
          expect(codexPaths).toContain('~/.codex/auth.json');
        }
      ),
      { numRuns: 100 }
    );
  });
});
