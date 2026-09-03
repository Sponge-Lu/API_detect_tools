import { describe, expect, it } from 'vitest';
import {
  ROUTE_RETRY_AFTER_MAX_MS,
  classifyRouteStatusCode,
  classifyUpstreamFailure,
  failureClassToOutcome,
  isTransientUpstreamStatus,
  isUpstreamQuotaExhaustionResponse,
  parseRetryAfterMs,
  resolveRoutePathDisabledReason,
  retainUpstreamFailure,
  summarizeUpstreamFailureBodyForLog,
  summarizeUpstreamFailureBodyRaw,
  type RouteUpstreamFailure,
} from '../main/route-upstream-failure';

const body = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf-8');

const classOf = (statusCode: number, payload: unknown = { error: 'boom' }) =>
  classifyUpstreamFailure({ statusCode, body: body(payload) }).failureClass;

describe('classifyUpstreamFailure', () => {
  it('classifies a transport exception as transient without a status code', () => {
    const failure = classifyUpstreamFailure({ error: new Error('ETIMEDOUT reading upstream') });

    expect(failure.failureClass).toBe('transient');
    expect(failure.statusCode).toBeUndefined();
    expect(failure.summary).toBe('ETIMEDOUT reading upstream');
  });

  it('classifies request-side rejections as request_fatal', () => {
    expect(classOf(400)).toBe('request_fatal');
    expect(classOf(413)).toBe('request_fatal');
    expect(classOf(422)).toBe('request_fatal');
  });

  it('classifies credential and capability rejections as channel_fatal', () => {
    for (const statusCode of [401, 402, 403, 404, 405, 410]) {
      expect(classOf(statusCode)).toBe('channel_fatal');
    }
  });

  it('classifies gateway and rate-limit statuses as transient', () => {
    for (const statusCode of [408, 425, 429, 500, 502, 503, 504, 524, 530]) {
      expect(classOf(statusCode)).toBe('transient');
    }
  });

  it('falls back to unknown for unmapped failure statuses', () => {
    expect(classOf(418)).toBe('unknown');
    expect(classOf(451)).toBe('unknown');
  });

  it('gives quota markers precedence over the 403 and 429 status mappings', () => {
    expect(classOf(403, { error: { message: 'INSUFFICIENT_BALANCE' } })).toBe('quota_exhausted');
    expect(classOf(429, { error: { message: '用户额度不足' } })).toBe('quota_exhausted');
    expect(classOf(400, { error: { message: '预扣费额度失败' } })).toBe('quota_exhausted');
  });

  it('keeps ordinary rate limits and permission errors out of the quota class', () => {
    expect(classOf(429, { error: { message: 'rate_limit_error' } })).toBe('transient');
    expect(classOf(403, { error: { message: 'permission denied' } })).toBe('channel_fatal');
    expect(classOf(429, { error: { message: 'Codex rolling spend limit exceeded' } })).toBe(
      'transient'
    );
  });

  it('retains the upstream body and headers for passthrough', () => {
    const raw = body({ error: { message: 'upstream exploded' } });
    const failure = classifyUpstreamFailure({
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: raw,
    });

    expect(failure.rawBody).toBe(raw);
    expect(failure.headers).toEqual({ 'content-type': 'application/json' });
    expect(failure.summary).toBe('upstream exploded');
  });
});

describe('failureClassToOutcome', () => {
  it('records only request_fatal as neutral', () => {
    expect(failureClassToOutcome('request_fatal')).toBe('neutral');
    expect(failureClassToOutcome('channel_fatal')).toBe('failure');
    expect(failureClassToOutcome('transient')).toBe('failure');
    expect(failureClassToOutcome('quota_exhausted')).toBe('failure');
    expect(failureClassToOutcome('unknown')).toBe('failure');
  });
});

describe('resolveRoutePathDisabledReason', () => {
  const reasonOf = (statusCode: number, payload: unknown = { error: 'boom' }) =>
    resolveRoutePathDisabledReason(classifyUpstreamFailure({ statusCode, body: body(payload) }));

  it('maps rejected credentials to upstream_credential_rejected', () => {
    for (const statusCode of [401, 402, 403]) {
      expect(reasonOf(statusCode)).toBe('upstream_credential_rejected');
    }
  });

  it('maps unavailable models to upstream_model_unavailable', () => {
    for (const statusCode of [404, 405, 410]) {
      expect(reasonOf(statusCode)).toBe('upstream_model_unavailable');
    }
  });

  it('maps quota exhaustion regardless of the carrying status code', () => {
    expect(reasonOf(403, { error: { message: 'INSUFFICIENT_BALANCE' } })).toBe(
      'upstream_quota_exhausted'
    );
    expect(reasonOf(429, { error: { message: '用户额度不足' } })).toBe('upstream_quota_exhausted');
  });

  it('gives no confirmed reason for transient or unknown failures', () => {
    expect(reasonOf(429)).toBeUndefined();
    expect(reasonOf(500)).toBeUndefined();
    expect(reasonOf(503)).toBeUndefined();
    expect(reasonOf(418)).toBeUndefined();
    expect(
      resolveRoutePathDisabledReason(classifyUpstreamFailure({ error: new Error('ETIMEDOUT') }))
    ).toBeUndefined();
  });

  it('never lets a request-side rejection disable a channel', () => {
    for (const statusCode of [400, 413, 422]) {
      expect(reasonOf(statusCode)).toBeUndefined();
    }
  });
});

describe('retainUpstreamFailure', () => {
  const failure = (
    failureClass: RouteUpstreamFailure['failureClass'],
    summary: string
  ): RouteUpstreamFailure => ({ failureClass, summary });

  it('prefers the more informative class', () => {
    const retained = retainUpstreamFailure(
      failure('transient', 'gateway'),
      failure('channel_fatal', 'bad key')
    );

    expect(retained?.summary).toBe('bad key');
  });

  it('keeps the earlier observation on a tie', () => {
    const retained = retainUpstreamFailure(
      failure('transient', 'first'),
      failure('transient', 'second')
    );

    expect(retained?.summary).toBe('first');
  });

  it('does not downgrade to a lower-ranked class', () => {
    const retained = retainUpstreamFailure(
      failure('request_fatal', 'bad payload'),
      failure('transient', 'gateway')
    );

    expect(retained?.summary).toBe('bad payload');
  });

  it('never retains quota exhaustion, so its body cannot reach the CLI', () => {
    expect(retainUpstreamFailure(undefined, failure('quota_exhausted', 'balance'))).toBeUndefined();
    expect(
      retainUpstreamFailure(failure('transient', 'gateway'), failure('quota_exhausted', 'balance'))
        ?.summary
    ).toBe('gateway');
  });
});

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-08-29T00:00:00.000Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' }, now)).toBe(2000);
  });

  it('parses an HTTP-date into the remaining delay', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2026-08-29T00:00:05.000Z' }, now)).toBe(5000);
  });

  it('clamps to the configured ceiling', () => {
    expect(parseRetryAfterMs({ 'retry-after': '86400' }, now)).toBe(ROUTE_RETRY_AFTER_MAX_MS);
  });

  it('ignores missing, empty, non-positive, past, and unparsable values', () => {
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
    expect(parseRetryAfterMs({}, now)).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': '   ' }, now)).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': '0' }, now)).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': '-5' }, now)).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': '2020-01-01T00:00:00.000Z' }, now)).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': 'soon' }, now)).toBeUndefined();
  });

  it('reads the first value of a repeated header', () => {
    expect(parseRetryAfterMs({ 'retry-after': ['3', '9'] }, now)).toBe(3000);
  });
});

describe('moved helpers keep their previous behavior', () => {
  it('classifies route status codes unchanged', () => {
    expect(classifyRouteStatusCode(200)).toBe('success');
    expect(classifyRouteStatusCode(302)).toBe('success');
    expect(classifyRouteStatusCode(400)).toBe('failure');
    expect(classifyRouteStatusCode(502)).toBe('failure');
  });

  it('reports transient statuses unchanged', () => {
    expect(isTransientUpstreamStatus(429)).toBe(true);
    expect(isTransientUpstreamStatus(401)).toBe(false);
    expect(isTransientUpstreamStatus(undefined)).toBe(false);
  });

  it('requires a failure status before matching quota markers', () => {
    expect(isUpstreamQuotaExhaustionResponse(200, body({ error: '余额不足' }))).toBe(false);
    expect(isUpstreamQuotaExhaustionResponse(403, body({ error: '余额不足' }))).toBe(true);
  });

  it('strips NUL padding when reading a failure body', () => {
    const padded = Buffer.concat([body('plain text failure'), Buffer.from([0, 0, 0])]);

    expect(summarizeUpstreamFailureBodyRaw(padded)).toBe('plain text failure');
  });

  it('preserves inner whitespace while collapsing runs', () => {
    expect(summarizeUpstreamFailureBodyForLog(body({ error: { message: 'a  b\n c' } }))).toBe(
      'a b c'
    );
  });
});
