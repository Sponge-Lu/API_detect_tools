import { describe, expect, it } from 'vitest';
import { normalizeCodexFeatureFlagsToml } from '../shared/types/cli-config';

describe('CLI config normalization', () => {
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

[model_providers.AnyAPI]
name = "AnyAPI"`);

    expect(migrated).toContain('[features]');
    expect(migrated).toContain('multi_agent = true');
    expect(migrated).toContain('other_flag = false');
  });
});
