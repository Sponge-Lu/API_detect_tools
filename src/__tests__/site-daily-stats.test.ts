import { describe, expect, it } from 'vitest';
import { getSiteDailyStats } from '../renderer/utils/siteDailyStats';

describe('site daily stats', () => {
  it('keeps same-day values and derives rpm/tpm', () => {
    const stats = getSiteDailyStats(
      {
        todayUsage: 3.5,
        todayPromptTokens: 1200,
        todayCompletionTokens: 300,
        todayTotalTokens: 1500,
        todayRequests: 6,
        lastRefresh: new Date('2026-04-09T08:30:00').getTime(),
      } as any,
      new Date('2026-04-09T12:00:00')
    );

    expect(stats.todayTotalTokens).toBe(1500);
    expect(stats.todayRequests).toBe(6);
    expect(stats.rpm).toBeCloseTo(6 / 720, 6);
    expect(stats.tpm).toBeCloseTo(1500 / 720, 6);
  });

  it('zeros stale values when lastRefresh is from the previous local day', () => {
    const stats = getSiteDailyStats(
      {
        todayUsage: 8,
        todayPromptTokens: 8000,
        todayCompletionTokens: 2000,
        todayTotalTokens: 10000,
        todayRequests: 25,
        lastRefresh: new Date('2026-04-08T23:55:00').getTime(),
      } as any,
      new Date('2026-04-09T00:05:00')
    );

    expect(stats.todayUsage).toBe(0);
    expect(stats.todayTotalTokens).toBe(0);
    expect(stats.todayRequests).toBe(0);
    expect(stats.rpm).toBe(0);
    expect(stats.tpm).toBe(0);
  });
});
