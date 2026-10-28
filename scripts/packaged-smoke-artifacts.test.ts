import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createPackagedSmokeArtifacts } from './packaged-smoke-artifacts';

function workspace(t: TestContext): string {
  const base = path.join(realpathSync(process.cwd()), '.cache', 'storage-tests');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'artifact-retention-'));
  t.after(() => {
    assert.equal(realpathSync(root), root);
    assert.equal(path.dirname(root), base);
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('keeps the latest success and failure per kind, without touching active or unknown runs', t => {
  const root = workspace(t);
  const oldSuccess = createPackagedSmokeArtifacts(root, 'product');
  oldSuccess.finish(true);
  const oldFailure = createPackagedSmokeArtifacts(root, 'product');
  oldFailure.finish(false);
  const driver = createPackagedSmokeArtifacts(root, 'driver');
  driver.finish(true);
  const active = createPackagedSmokeArtifacts(root, 'product');
  const unknown = createPackagedSmokeArtifacts(root, 'product');
  writeFileSync(path.join(unknown.fixture, 'smoke-artifact-result.json'), 'invalid', 'utf8');
  const latestFailure = createPackagedSmokeArtifacts(root, 'product');
  latestFailure.finish(false);
  const latestSuccess = createPackagedSmokeArtifacts(root, 'product');
  latestSuccess.finish(true);
  assert.equal(existsSync(oldSuccess.fixture), false);
  assert.equal(existsSync(oldFailure.fixture), false);
  for (const run of [driver, active, unknown, latestFailure, latestSuccess]) {
    assert.equal(existsSync(run.fixture), true);
  }
  latestSuccess.finish(false);
  assert.equal(
    JSON.parse(readFileSync(path.join(latestSuccess.fixture, 'smoke-artifact-result.json'), 'utf8'))
      .outcome,
    'passed'
  );
});

test('rejects redirected cache roots and never follows artifact junctions', t => {
  const root = workspace(t);
  const outside = path.join(root, 'protected');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'keep.txt'), 'keep', 'utf8');
  const redirected = path.join(root, 'redirected');
  mkdirSync(redirected);
  symlinkSync(outside, path.join(redirected, '.cache'), 'junction');
  assert.throws(() => createPackagedSmokeArtifacts(redirected, 'product'), /inside the project/);
  assert.equal(existsSync(path.join(outside, 'architecture-refactor-tests')), false);
  const run = createPackagedSmokeArtifacts(root, 'product');
  const junction = path.join(path.dirname(run.fixture), 'packaged-product-1');
  writeFileSync(
    path.join(outside, 'smoke-artifact-result.json'),
    JSON.stringify({ version: 1, outcome: 'passed', completedAt: 1 }),
    'utf8'
  );
  symlinkSync(outside, junction, 'junction');
  run.finish(true);
  assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(existsSync(junction), true);
});

test('records uncaught failure on exit and prunes only older completed failures', t => {
  const root = workspace(t);
  const old = createPackagedSmokeArtifacts(root, 'driver');
  old.finish(false);
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const { createPackagedSmokeArtifacts } = require(process.argv[1]);
    const artifacts = createPackagedSmokeArtifacts(process.argv[2], 'driver');
    process.once('exit', code => artifacts.finish(code === 0));
    console.log(artifacts.fixture);
    throw new Error('simulated packaging failure');
  `,
      path.join(__dirname, 'packaged-smoke-artifacts.js'),
      root,
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  const fixture = child.stdout.trim();
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture, 'smoke-artifact-result.json'), 'utf8')).outcome,
    'failed'
  );
  assert.equal(existsSync(old.fixture), false);
});
