import { describe, expect, it } from 'vitest';
import {
  getCustomCliModelGroups,
  normalizeCustomCliApiKeys,
} from '../shared/types/custom-cli-config';
import { normalizeCircledGroupLabel } from '../shared/utils/groupLabel';

describe('group label helpers', () => {
  it.each([
    ['1 默认分组', '① 默认分组'],
    ['12 高级', '⑫ 高级'],
    ['５０ 企业', '㊿ 企业'],
    ['① 默认分组', '① 默认分组'],
    ['团队 2', '团队 2'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCircledGroupLabel(input)).toBe(expected);
  });

  it('normalizes persisted key groups and aggregates model ownership in key order', () => {
    const keys = normalizeCustomCliApiKeys([
      {
        id: 'a',
        name: 'A',
        key: 'sk-a',
        group: '1 默认',
        groupMultiplier: 1,
        models: ['model-a', 'model-b'],
      },
      {
        id: 'b',
        name: 'B',
        key: 'sk-b',
        group: '2 高级',
        groupMultiplier: 2,
        models: ['model-b'],
      },
    ]);

    expect(getCustomCliModelGroups(keys, 'model-a')).toEqual(['① 默认']);
    expect(getCustomCliModelGroups(keys, 'model-b')).toEqual(['① 默认', '② 高级']);
  });
});
