import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32')
  throw new Error('Product packaging smoke currently verifies Windows only');
const root = process.cwd();
const fixture = path.join(
  root,
  '.cache/architecture-refactor-tests',
  `packaged-product-${Date.now()}`
);
mkdirSync(fixture, { recursive: true });
const env: NodeJS.ProcessEnv = {
  ...process.env,
  STORAGE_SMOKE_ROOT: path.join(fixture, 'user-data'),
};
for (const [key, relative] of Object.entries({
  APPDATA: 'appdata',
  LOCALAPPDATA: 'localappdata',
  USERPROFILE: 'home',
  HOME: 'home',
  TEMP: 'temporary',
  TMP: 'temporary',
  ELECTRON_BUILDER_CACHE: 'builder-cache',
})) {
  env[key] = path.join(fixture, relative);
  mkdirSync(env[key]!, { recursive: true });
}
env.npm_config_cache = path.join(root, '.cache/npm');
delete env.ELECTRON_RUN_AS_NODE;
const configuration = path.join(fixture, 'electron-builder.json');
writeFileSync(
  configuration,
  JSON.stringify(
    {
      extends: null,
      appId: 'local.api-hub.storage-product-smoke',
      productName: 'StorageProductSmoke',
      electronVersion: '28.3.3',
      electronDist: path.join(root, 'node_modules/electron/dist'),
      beforePack: null,
      npmRebuild: false,
      asar: true,
      asarUnpack: ['**/*.node'],
      extraMetadata: { main: 'product-smoke.js' },
      extraResources: [],
      files: [
        'dist/**/*',
        'dist-renderer/**/*',
        'package.json',
        {
          from: path.join(root, '.cache/storage-tests/src/__tests__/storage'),
          to: '.',
          filter: ['product-smoke.js', 'product-route-smoke.js'],
        },
      ],
      directories: { output: path.join(fixture, 'out') },
      win: { target: 'dir', signAndEditExecutable: false },
    },
    null,
    2
  ),
  'utf8'
);
function run(executable: string, args: string[]): void {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Product storage smoke failed with ${result.status}; evidence: ${fixture}`);
}
run(process.execPath, [
  path.join(root, 'node_modules/electron-builder/cli.js'),
  '--config',
  configuration,
  '--win',
  'dir',
]);
for (let phase = 1; phase <= 3; phase++) {
  if (phase === 3) {
    env.STORAGE_SMOKE_ROOT = path.join(fixture, 'new-user');
    env.USERPROFILE = env.HOME = path.join(fixture, 'new-home');
    mkdirSync(env.USERPROFILE, { recursive: true });
  }
  env.STORAGE_SMOKE_PHASE = String(phase);
  run(path.join(fixture, 'out/win-unpacked/StorageProductSmoke.exe'), []);
  const report = JSON.parse(
    readFileSync(path.join(env.STORAGE_SMOKE_ROOT!, `product-result-${phase}.json`), 'utf8')
  );
  assert.equal(report.packaged, true);
  assert.equal(report.phase, phase);
}
console.log(`Full product migration/edit/rollback/backup/restore/restart passed: ${fixture}`);
