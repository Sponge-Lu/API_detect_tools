import { describe, expect, it } from 'vitest';

import { extractModelFromPath, findMatchingRule, sortRules } from '../main/route-rule-engine';
import type { RouteRule } from '../shared/types/route-proxy';

function createRule(overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id: overrides.id ?? 'rule-1',
    name: overrides.name ?? 'Test Rule',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 10,
    cliType: overrides.cliType ?? 'codex',
    patternType: overrides.patternType ?? 'exact',
    pattern: overrides.pattern ?? '*',
    allowedSiteIds: overrides.allowedSiteIds,
    allowedAccountIds: overrides.allowedAccountIds,
    allowedApiKeyGroups: overrides.allowedApiKeyGroups,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe('route-rule-engine', () => {
  it('extracts Gemini model names from native generateContent paths', () => {
    expect(extractModelFromPath('/v1beta/models/Gemini-3.1-pro:generateContent', 'geminiCli')).toBe(
      'Gemini-3.1-pro'
    );

    expect(
      extractModelFromPath(
        '/v1beta/models/gemini-2.5-pro-preview-05-06:streamGenerateContent',
        'geminiCli'
      )
    ).toBe('gemini-2.5-pro-preview-05-06');
  });

  it('matches a canonical rule when the canonical model is provided', () => {
    const rules = sortRules([
      createRule({
        id: 'canonical-exact',
        name: 'Canonical Exact',
        pattern: 'gpt-5-4',
        patternType: 'exact',
      }),
    ]);

    const matched = findMatchingRule(rules, 'codex', 'gpt-5-4');

    expect(matched?.id).toBe('canonical-exact');
  });

  it('does not treat a raw model token as an implicit match for a canonical exact rule', () => {
    const rules = sortRules([
      createRule({
        id: 'canonical-exact',
        name: 'Canonical Exact',
        pattern: 'gpt-5-4',
        patternType: 'exact',
      }),
    ]);

    const matched = findMatchingRule(rules, 'codex', 'gpt-5.4-20260101');

    expect(matched).toBeNull();
  });

  it('keeps rule priority ordering when multiple canonical patterns match', () => {
    const rules = sortRules([
      createRule({
        id: 'wildcard-low-priority',
        name: 'Wildcard Low Priority',
        priority: 10,
        pattern: 'gpt-*',
        patternType: 'wildcard',
      }),
      createRule({
        id: 'canonical-high-priority',
        name: 'Canonical High Priority',
        priority: 50,
        pattern: 'gpt-5-4',
        patternType: 'exact',
      }),
    ]);

    const matched = findMatchingRule(rules, 'codex', 'gpt-5-4');

    expect(matched?.id).toBe('canonical-high-priority');
  });
});
