import { describe, expect, it } from 'vitest';
import { normalizeSiteSortField } from '../renderer/utils/siteSort';

describe('site sort compatibility', () => {
  it('maps legacy token split fields to totalTokens and keeps currently visible folded-row sorting', () => {
    expect(normalizeSiteSortField('promptTokens')).toBe('totalTokens');
    expect(normalizeSiteSortField('completionTokens')).toBe('totalTokens');
    expect(normalizeSiteSortField('requests')).toBeNull();
    expect(normalizeSiteSortField('rpm')).toBeNull();
    expect(normalizeSiteSortField('tpm')).toBeNull();
    expect(normalizeSiteSortField('lastUpdate')).toBeNull();
    expect(normalizeSiteSortField('ldcRatio')).toBe('ldcRatio');
  });

  it('keeps supported visible fields unchanged', () => {
    expect(normalizeSiteSortField('balance')).toBe('balance');
    expect(normalizeSiteSortField('todayUsage')).toBe('todayUsage');
    expect(normalizeSiteSortField('totalTokens')).toBe('totalTokens');
    expect(normalizeSiteSortField('modelCount')).toBe('modelCount');
    expect(normalizeSiteSortField(null)).toBeNull();
  });
});
