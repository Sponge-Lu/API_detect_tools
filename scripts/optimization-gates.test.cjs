const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('bundle and warning gates reject missing assets, oversize chunks and new warnings', () => {
  const cache = path.join(__dirname, '..', '.cache', 'gate-tests');
  mkdirSync(cache, { recursive: true });
  const fixture = mkdtempSync(path.join(cache, 'fixture-'));
  const run = (script, input) =>
    spawnSync(process.execPath, [path.join(__dirname, script), input], { encoding: 'utf8' });
  try {
    assert.notEqual(run('check-bundle-budget.cjs', fixture).status, 0);
    writeFileSync(path.join(fixture, 'app.js'), 'export const value = 1;', 'utf8');
    writeFileSync(path.join(fixture, 'app.css'), 'body {}', 'utf8');
    assert.equal(run('check-bundle-budget.cjs', fixture).status, 0);
    writeFileSync(path.join(fixture, 'app.js'), 'x'.repeat(300000), 'utf8');
    assert.notEqual(run('check-bundle-budget.cjs', fixture).status, 0);
    const report = path.join(fixture, 'lint.json');
    writeFileSync(
      report,
      JSON.stringify([
        {
          filePath: path.join(__dirname, '../src/new-file.ts'),
          errorCount: 0,
          messages: [
            {
              severity: 1,
              ruleId: '@typescript-eslint/no-explicit-any',
              message: 'Unexpected any. Specify a different type.',
            },
          ],
        },
      ]),
      'utf8'
    );
    assert.notEqual(run('check-lint-baseline.cjs', report).status, 0);
    writeFileSync(report, '[]', 'utf8');
    assert.equal(run('check-lint-baseline.cjs', report).status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
