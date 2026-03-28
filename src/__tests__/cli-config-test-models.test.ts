import { describe, expect, it } from 'vitest';
import {
  CLI_TEST_MODEL_SLOT_COUNT,
  normalizeCliTestModels,
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
});
