import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { AppDatabase } from '../../main/storage/database/app-database';
import { DocumentStore } from '../../main/storage/repositories/document-store';

const root = path.resolve('.cache/architecture-refactor-tests/analytics');
mkdirSync(root, { recursive: true });
function bucket(key: string, start: number, endpoint = '/v1/messages') {
  return {
    bucketKey: key,
    bucketStart: start,
    bucketSize: 'hour',
    cliType: 'claudeCode',
    siteId: 'deleted-site',
    accountId: 'deleted-account',
    targetEndpoint: endpoint,
    requestCount: 4,
    successCount: 3,
    failureCount: 1,
    neutralCount: 0,
    promptTokens: 10,
    completionTokens: 2,
    totalTokens: 12,
    updatedAt: start,
  };
}

test('a dirty bucket updates constant rows with 50000 historical buckets and retains endpoint identity', () => {
  const directory = mkdtempSync(path.join(root, 'case-'));
  const db = new AppDatabase(path.join(directory, 'app.db'));
  const repository = new DocumentStore(db);
  const now = Date.now();
  try {
    const records = Object.fromEntries(
      Array.from({ length: 50000 }, (_, index) => [
        String(index),
        bucket(String(index), now - index * 1000),
      ])
    );
    const initial = performance.now();
    repository.write('route-analytics-state', { version: '1', buckets: records });
    const importMs = performance.now() - initial;
    const before = db.connection.prepare('SELECT total_changes()').pluck().get() as number;
    const changed = {
      ...records['0'],
      requestCount: 5,
      successCount: 4,
      targetEndpoint: '/v1/responses',
    };
    const update = performance.now();
    repository.upsertCollection('route-analytics-state', 'buckets', { '0': changed });
    const updateMs = performance.now() - update;
    const after = db.connection.prepare('SELECT total_changes()').pluck().get() as number;
    assert.equal(after - before, 2);
    assert.equal(
      db.connection.prepare('SELECT COUNT(*) FROM route_analytics_buckets').pluck().get(),
      50000
    );
    const selected = repository.analyticsBuckets(now - 1, now + 1);
    assert.deepEqual(selected, [changed]);
    const comparison = [];
    for (const size of [1000, 10000, 50000]) {
      const subset = Object.fromEntries(Object.entries(records).slice(0, size));
      const jsonMs: number[] = [];
      const sqliteMs: number[] = [];
      for (let sample = 0; sample < 10; sample++) {
        const value = { ...changed, requestCount: 6 + sample, successCount: 5 + sample };
        subset['0'] = value;
        const jsonStart = performance.now();
        const temporary = path.join(directory, 'legacy.pending');
        const fd = openSync(temporary, 'w');
        try {
          writeSync(fd, JSON.stringify({ version: '1', buckets: subset }));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, path.join(directory, 'legacy.json'));
        jsonMs.push(performance.now() - jsonStart);
        const sqliteStart = performance.now();
        repository.upsertCollection('route-analytics-state', 'buckets', { '0': value });
        sqliteMs.push(performance.now() - sqliteStart);
      }
      const p95 = (values: number[]) =>
        [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
      comparison.push({
        jsonHistoricalBuckets: size,
        sqliteHistoricalBuckets: 50000,
        samples: 10,
        jsonWholeDocumentP95Ms: p95(jsonMs),
        sqliteDirtyBucketP95Ms: p95(sqliteMs),
        jsonMs,
        sqliteMs,
      });
    }
    repository.upsertCollection('route-analytics-state', 'buckets', { '0': changed });
    assert.ok(
      (
        db.connection
          .prepare(
            'EXPLAIN QUERY PLAN SELECT payload FROM route_analytics_buckets WHERE bucket_start >= ? AND bucket_start < ?'
          )
          .all(now - 1, now + 1) as Array<{ detail: string }>
      ).some(row => row.detail.includes('analytics_time'))
    );
    repository.upsertCollection('route-analytics-state', 'buckets', {
      expired: bucket('expired', now - 31 * 86400000),
    });
    repository.pruneAnalytics(now);
    assert.equal(
      db.connection
        .prepare("SELECT 1 FROM route_analytics_buckets WHERE bucket_key = 'expired'")
        .get(),
      undefined
    );
    assert.equal(
      db.connection.prepare('SELECT COUNT(*) FROM route_analytics_buckets').pluck().get(),
      50000
    );
    assert.deepEqual(repository.analyticsBuckets(now - 1, now + 1), [changed]);
    writeFileSync(
      path.join(directory, 'benchmark.json'),
      JSON.stringify({
        importMs,
        updateMs,
        historicalBuckets: 50000,
        changedRows: after - before,
        comparison,
      }),
      'utf8'
    );
  } finally {
    db.close();
  }
});
