import { describe, expect, it } from 'vitest';
import { normalizeSiteSortField } from '../renderer/utils/siteSort';

describe('site sort compatibility', () => {
  it('maps removed sort fields to supported values or null', () => {
    expect(normalizeSiteSortField('promptTokens')).toBe('totalTokens');
    expect(normalizeSiteSortField('completionTokens')).toBe('totalTokens');
    expect(normalizeSiteSortField('requests')).toBeNull();
    expect(normalizeSiteSortField('rpm')).toBeNull();
    expect(normalizeSiteSortField('tpm')).toBeNull();
    expect(normalizeSiteSortField('ldcRatio')).toBeNull();
  });
});
