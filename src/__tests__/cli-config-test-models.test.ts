import { describe, expect, it } from 'vitest';
import {
  CLI_TEST_MODEL_SLOT_COUNT,
  DEFAULT_CLI_CONFIG,
  normalizeCliTestModels,
  normalizeCodexFeatureFlagsToml,
  sanitizeCliTestModels,
} from '../shared/types/cli-config';

describe('CLI test model helpers', () => {
  it('falls back to legacy testModel when testModels is missing', () => {
    expect(
      normalizeCliTestModels({
        testModel: 'gpt-4.1',
      })
    ).toEqual(['gpt-4.1']);
  });

  it('prefers testModels over legacy testModel and trims blanks', () => {
    expect(
      normalizeCliTestModels({
        testModel: 'legacy-model',
        testModels: [' claude-3.7 ', '', 'gpt-4.1', 'gemini-2.5'],
      })
    ).toEqual(['claude-3.7', 'gpt-4.1', 'gemini-2.5']);
  });

  it('sanitizes editor slots by removing blanks and limiting to slot count', () => {
    expect(
      sanitizeCliTestModels(['claude-3.7', '', 'gpt-4.1', undefined, 'gemini-2.5', 'extra-model'])
    ).toEqual(['claude-3.7', 'gpt-4.1', 'gemini-2.5']);
  });

  it('never returns more than the configured slot count', () => {
    expect(
      normalizeCliTestModels({
        testModels: ['m1', 'm2', 'm3', 'm4'],
      })
    ).toHaveLength(CLI_TEST_MODEL_SLOT_COUNT);
  });

  it('initializes default CLI configs with empty persisted test result slots', () => {
    expect(DEFAULT_CLI_CONFIG.claudeCode.testResults).toEqual([]);
    expect(DEFAULT_CLI_CONFIG.codex.testResults).toEqual([]);
    expect(DEFAULT_CLI_CONFIG.geminiCli.testResults).toEqual([]);
  });

  it('migrates deprecated Codex collab flags to multi_agent', () => {
    const migrated = normalizeCodexFeatureFlagsToml(`[features]
collab = true
other_flag = false`);

    expect(migrated).toContain('multi_agent = true');
    expect(migrated).not.toContain('collab =');
    expect(migrated).toContain('other_flag = false');
  });

  it('adds multi_agent to an existing Codex features section when it is missing', () => {
    const migrated = normalizeCodexFeatureFlagsToml(`[features]
other_flag = false

[model_providers.OpenAI]
name = "openai"`);

    expect(migrated).toContain('[features]');
    expect(migrated).toContain('multi_agent = true');
    expect(migrated).toContain('other_flag = false');
  });
});
