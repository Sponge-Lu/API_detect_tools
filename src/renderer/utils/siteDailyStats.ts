import type { DetectionResult } from '../../shared/types/site';

type DailyStatsSource =
  | Pick<
      DetectionResult,
      | 'todayUsage'
      | 'todayPromptTokens'
      | 'todayCompletionTokens'
      | 'todayTotalTokens'
      | 'todayRequests'
      | 'lastRefresh'
    >
  | undefined;

export function getSiteDailyStats(source: DailyStatsSource, now: Date = new Date()) {
  const isFreshToday =
    typeof source?.lastRefresh === 'number' &&
    new Date(source.lastRefresh).toDateString() === now.toDateString();
  const todayPromptTokens = isFreshToday ? (source?.todayPromptTokens ?? 0) : 0;
  const todayCompletionTokens = isFreshToday ? (source?.todayCompletionTokens ?? 0) : 0;
  const todayTotalTokens = isFreshToday
    ? (source?.todayTotalTokens ?? todayPromptTokens + todayCompletionTokens)
    : 0;
  const todayRequests = isFreshToday ? (source?.todayRequests ?? 0) : 0;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const minutesSinceStart = Math.max((now.getTime() - dayStart.getTime()) / 60000, 1);

  return {
    todayUsage: isFreshToday ? (source?.todayUsage ?? 0) : 0,
    todayPromptTokens,
    todayCompletionTokens,
    todayTotalTokens,
    todayRequests,
    rpm: todayRequests > 0 ? todayRequests / minutesSinceStart : 0,
    tpm: todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0,
  };
}
