/**
 * 输入: probe-lock 首个上游结果的记录/读取/等待调用序列
 * 输出: terminal-wins / transient-overwritable 记录语义与 waiter 仅终结结果 resolve 的回归结果
 * 定位: 测试层 - 验证瞬时结果可被后续成功/终结失败覆盖、终结结果 first-wins 且锁定等待者
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { describe, expect, it } from 'vitest';

import {
  clearRouteProbeLockTerminalFailure,
  getRouteProbeLockFirstUpstreamResult,
  recordRouteProbeLockFirstUpstreamResult,
  waitForRouteProbeLockFirstUpstreamResult,
  type RouteProbeLockUpstreamResult,
} from '../main/route-probe-lock';

function makeResult(
  routeApiKey: string,
  overrides: Partial<RouteProbeLockUpstreamResult> = {}
): RouteProbeLockUpstreamResult {
  return {
    routeApiKey,
    cliType: 'claudeCode',
    success: false,
    finishedAt: Date.now(),
    ...overrides,
  };
}

describe('route-probe-lock first upstream result recording', () => {
  it('records a transient result as non-terminal and lets a later success overwrite it', () => {
    const key = 'unit-transient-overwrite';
    clearRouteProbeLockTerminalFailure(key);

    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { statusCode: 503 }), {
      terminal: false,
    });
    expect(getRouteProbeLockFirstUpstreamResult(key)).toMatchObject({
      success: false,
      statusCode: 503,
    });

    // 终值覆盖瞬时结果。
    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { success: true, statusCode: 200 }));
    expect(getRouteProbeLockFirstUpstreamResult(key)).toMatchObject({
      success: true,
      statusCode: 200,
    });

    // 终值锁定后，后续瞬时结果不再覆盖。
    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { statusCode: 429 }), {
      terminal: false,
    });
    expect(getRouteProbeLockFirstUpstreamResult(key)).toMatchObject({
      success: true,
      statusCode: 200,
    });

    clearRouteProbeLockTerminalFailure(key);
  });

  it('locks terminal results and resolves waiters immediately', async () => {
    const key = 'unit-terminal-lock';
    clearRouteProbeLockTerminalFailure(key);

    recordRouteProbeLockFirstUpstreamResult(
      makeResult(key, { statusCode: 401, error: 'authentication_error' })
    );

    await expect(waitForRouteProbeLockFirstUpstreamResult(key, 1000)).resolves.toMatchObject({
      success: false,
      statusCode: 401,
    });

    // 终值 first-wins：后续终值不覆盖第一条终值。
    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { success: true, statusCode: 200 }));
    expect(getRouteProbeLockFirstUpstreamResult(key)).toMatchObject({
      success: false,
      statusCode: 401,
    });

    clearRouteProbeLockTerminalFailure(key);
  });

  it('does not resolve a waiter on a transient record but resolves on a later terminal one', async () => {
    const key = 'unit-waiter-terminal-only';
    clearRouteProbeLockTerminalFailure(key);

    const waiter = waitForRouteProbeLockFirstUpstreamResult(key, 1000);
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });

    // 瞬时结果：更新缓存但不 resolve 等待者。
    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { statusCode: 503 }), {
      terminal: false,
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(getRouteProbeLockFirstUpstreamResult(key)).toMatchObject({
      success: false,
      statusCode: 503,
    });

    // 终值：resolve 等待者。
    recordRouteProbeLockFirstUpstreamResult(makeResult(key, { success: true, statusCode: 200 }));
    await expect(waiter).resolves.toMatchObject({ success: true, statusCode: 200 });

    clearRouteProbeLockTerminalFailure(key);
  });
});
