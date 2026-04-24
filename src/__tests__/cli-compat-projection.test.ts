import { describe, expect, it } from 'vitest';
import { projectCliCompatibilityMap } from '../renderer/services/cli-compat-projection';
import { buildProbeKey } from '../shared/types/route-proxy';

describe('cli compatibility projection', () => {
  it('projects account-specific CLI results to the matching account card only', () => {
    const exactProbeKey = buildProbeKey('site-1', 'acct-b', 'codex', 'gpt-4.1-mini');
    const fallbackProbeKey = buildProbeKey('site-1', 'acct-a', 'codex', 'gpt-4.1-mini');

    const projection = projectCliCompatibilityMap({
      sites: [
        {
          id: 'site-1',
          name: 'Demo Site',
        },
      ] as any,
      accounts: [
        { id: 'acct-a', site_id: 'site-1', account_name: '默认账户' },
        { id: 'acct-b', site_id: 'site-1', account_name: '顺位账户' },
      ] as any,
      routing: {
        cliProbe: {
          latest: {
            [fallbackProbeKey]: {
              probeKey: fallbackProbeKey,
              siteId: 'site-1',
              accountId: 'acct-a',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: true,
              lastSample: {
                sampleId: 'sample-fallback',
                probeKey: fallbackProbeKey,
                siteId: 'site-1',
                accountId: 'acct-a',
                cliType: 'codex',
                canonicalModel: 'gpt-4.1-mini',
                rawModel: 'gpt-4.1-mini',
                success: true,
                source: 'routeProbe',
                codexDetail: { responses: true },
                testedAt: 100,
              },
            },
            [exactProbeKey]: {
              probeKey: exactProbeKey,
              siteId: 'site-1',
              accountId: 'acct-b',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: false,
              lastSample: {
                sampleId: 'sample-exact',
                probeKey: exactProbeKey,
                siteId: 'site-1',
                accountId: 'acct-b',
                cliType: 'codex',
                canonicalModel: 'gpt-4.1-mini',
                rawModel: 'gpt-4.1-mini',
                success: false,
                source: 'siteManual',
                error: 'manual failure',
                testedAt: 200,
              },
            },
          },
        },
      } as any,
    } as any);

    expect(projection['Demo Site::acct-a']).toMatchObject({
      codex: true,
      codexDetail: { responses: true },
      sourceLabel: '来自站点检测 · 默认账户',
      testedAt: 100,
    });
    expect(projection['Demo Site::acct-b']).toMatchObject({
      codex: false,
      sourceLabel: '来自站点管理测试 · 顺位账户',
      testedAt: 200,
      codexError: 'manual failure',
    });
  });

  it('does not merge probe summaries across different accounts of the same site', () => {
    const codexProbeKey = buildProbeKey('site-1', 'acct-a', 'codex', 'gpt-4.1-mini');
    const claudeProbeKey = buildProbeKey('site-1', 'acct-b', 'claudeCode', 'claude-3.7-sonnet');

    const projection = projectCliCompatibilityMap({
      sites: [
        {
          id: 'site-1',
          name: 'Demo Site',
        },
      ] as any,
      accounts: [
        { id: 'acct-a', site_id: 'site-1', account_name: '默认账户' },
        { id: 'acct-b', site_id: 'site-1', account_name: '顺位账户' },
      ] as any,
      routing: {
        cliProbe: {
          latest: {
            [codexProbeKey]: {
              probeKey: codexProbeKey,
              siteId: 'site-1',
              accountId: 'acct-a',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: true,
              lastSample: {
                sampleId: 'sample-route',
                probeKey: codexProbeKey,
                siteId: 'site-1',
                accountId: 'acct-a',
                cliType: 'codex',
                canonicalModel: 'gpt-4.1-mini',
                rawModel: 'gpt-4.1-mini',
                success: true,
                source: 'routeProbe',
                codexDetail: { responses: true },
                testedAt: 100,
              },
            },
            [claudeProbeKey]: {
              probeKey: claudeProbeKey,
              siteId: 'site-1',
              accountId: 'acct-b',
              cliType: 'claudeCode',
              canonicalModel: 'claude-3.7-sonnet',
              rawModel: 'claude-3.7-sonnet',
              healthy: true,
              lastSample: {
                sampleId: 'sample-manual',
                probeKey: claudeProbeKey,
                siteId: 'site-1',
                accountId: 'acct-b',
                cliType: 'claudeCode',
                canonicalModel: 'claude-3.7-sonnet',
                rawModel: 'claude-3.7-sonnet',
                success: true,
                source: 'siteManual',
                claudeDetail: { replyText: '2' },
                testedAt: 150,
              },
            },
          },
        },
      } as any,
    } as any);

    expect(projection['Demo Site::acct-a']).toMatchObject({
      codex: true,
      codexDetail: { responses: true },
      claudeCode: null,
      sourceLabel: '来自站点检测 · 默认账户',
      testedAt: 100,
    });
    expect(projection['Demo Site::acct-b']).toMatchObject({
      claudeCode: true,
      claudeDetail: { replyText: '2' },
      codex: null,
      sourceLabel: '来自站点管理测试 · 顺位账户',
      testedAt: 150,
    });
  });

  it('uses the newest sample for each CLI instead of optimistic multi-model aggregation', () => {
    const successProbeKey = buildProbeKey('site-1', 'acct-a', 'geminiCli', 'gemini-2.5-pro');
    const failureProbeKey = buildProbeKey('site-1', 'acct-a', 'geminiCli', 'gemini-2.5-flash');

    const projection = projectCliCompatibilityMap({
      sites: [
        {
          id: 'site-1',
          name: 'Demo Site',
        },
      ] as any,
      accounts: [{ id: 'acct-a', site_id: 'site-1', account_name: '默认账户' }] as any,
      routing: {
        cliProbe: {
          latest: {
            [successProbeKey]: {
              probeKey: successProbeKey,
              siteId: 'site-1',
              accountId: 'acct-a',
              cliType: 'geminiCli',
              canonicalModel: 'gemini-2.5-pro',
              rawModel: 'gemini-2.5-pro',
              healthy: true,
              lastSample: {
                sampleId: 'sample-success',
                probeKey: successProbeKey,
                siteId: 'site-1',
                accountId: 'acct-a',
                cliType: 'geminiCli',
                canonicalModel: 'gemini-2.5-pro',
                rawModel: 'gemini-2.5-pro',
                success: true,
                source: 'routeProbe',
                geminiDetail: { native: true, proxy: false },
                testedAt: 100,
              },
            },
            [failureProbeKey]: {
              probeKey: failureProbeKey,
              siteId: 'site-1',
              accountId: 'acct-a',
              cliType: 'geminiCli',
              canonicalModel: 'gemini-2.5-flash',
              rawModel: 'gemini-2.5-flash',
              healthy: false,
              lastSample: {
                sampleId: 'sample-failure',
                probeKey: failureProbeKey,
                siteId: 'site-1',
                accountId: 'acct-a',
                cliType: 'geminiCli',
                canonicalModel: 'gemini-2.5-flash',
                rawModel: 'gemini-2.5-flash',
                success: false,
                source: 'routeProbe',
                geminiDetail: { native: false, proxy: false },
                testedAt: 200,
              },
            },
          },
        },
      } as any,
    } as any);

    expect(projection['Demo Site::acct-a']).toMatchObject({
      geminiCli: false,
      geminiDetail: { native: false, proxy: false },
      sourceLabel: '来自站点检测 · 默认账户',
      testedAt: 200,
    });
  });
});
