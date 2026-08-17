import { describe, expect, it } from 'vitest';

import {
  detectSourceProtocolFromPath,
  findMatchingProtocolRule,
  sortRules,
} from '../main/route-rule-engine';
import type { RouteRule } from '../shared/types/route-proxy';

function createRule(overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id: overrides.id ?? 'rule-1',
    name: overrides.name ?? 'Test Rule',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 10,
    sourceProtocol: overrides.sourceProtocol ?? 'openai-responses',
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
  it.each([
    ['/v1/messages', 'anthropic-messages'],
    ['/v1/messages/count_tokens', 'anthropic-messages'],
    ['/v1/responses', 'openai-responses'],
    ['/v1/responses/resp_1', 'openai-responses'],
    ['/v1/conversations/conv_1/items', 'openai-responses'],
    ['/v1/chat/completions', 'openai-chat-completions'],
  ] as const)('detects %s as %s', (pathname, expected) => {
    expect(detectSourceProtocolFromPath(pathname)).toBe(expected);
  });

  it('matches protocol rules without using client identity', () => {
    const rules = sortRules([
      createRule({
        id: 'responses-rule',
        sourceProtocol: 'openai-responses',
        patternType: 'wildcard',
        pattern: 'gpt-*',
      }),
    ]);

    expect(findMatchingProtocolRule(rules, 'openai-responses', 'gpt-5')?.id).toBe(
      'responses-rule'
    );
    expect(findMatchingProtocolRule(rules, 'anthropic-messages', 'gpt-5')).toBeNull();
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

    const matched = findMatchingProtocolRule(rules, 'openai-responses', 'gpt-5-4');

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

    const matched = findMatchingProtocolRule(
      rules,
      'openai-responses',
      'gpt-5.4-20260101'
    );

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

    const matched = findMatchingProtocolRule(rules, 'openai-responses', 'gpt-5-4');

    expect(matched?.id).toBe('canonical-high-priority');
  });
});
