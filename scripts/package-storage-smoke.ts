import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32')
  throw new Error('This packaging check currently verifies Windows only');
const root = process.cwd();
const fixture = path.join(
  root,
  '.cache/architecture-refactor-tests',
  `packaged-driver-${Date.now()}`
);
const userData = path.join(fixture, 'user-data');
const temporary = path.join(fixture, 'temporary');
mkdirSync(fixture, { recursive: true });
mkdirSync(temporary, { recursive: true });
const env = {
  ...process.env,
  STORAGE_SMOKE_FIXTURE: fixture,
  STORAGE_SMOKE_ROOT: userData,
  APPDATA: path.join(fixture, 'appdata'),
  LOCALAPPDATA: path.join(fixture, 'localappdata'),
  USERPROFILE: path.join(fixture, 'home'),
  HOME: path.join(fixture, 'home'),
  TEMP: temporary,
  TMP: temporary,
  ELECTRON_BUILDER_CACHE: path.join(fixture, 'builder-cache'),
  npm_config_cache: path.join(root, '.cache/npm'),
};
delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
// npm run propagates allow-scripts as an environment flag; npm rejects that
// flag for nested project installs, which already disable all install scripts.
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'npm_config_allow_scripts') delete (env as NodeJS.ProcessEnv)[key];
}
function run(executable: string, args: string[]): void {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Storage packaging check failed with exit code ${result.status}`);
}
writeFileSync(
  path.join(fixture, 'package.json'),
  JSON.stringify(
    {
      name: 'storage-driver-smoke',
      version: '1.0.0',
      main: 'main.js',
      author: 'API Hub',
      description: 'Isolated SQLite packaging verification',
      dependencies: { 'better-sqlite3': '11.10.0' },
    },
    null,
    2
  ),
  'utf8'
);
copyFileSync(
  path.join(root, '.cache/storage-tests/src/__tests__/storage/packaged-smoke.js'),
  path.join(fixture, 'main.js')
);
const configuration = path.join(fixture, 'electron-builder.json');
writeFileSync(
  configuration,
  JSON.stringify(
    {
      appId: 'local.api-hub.storage-driver-smoke',
      productName: 'StorageDriverSmoke',
      electronVersion: '28.3.3',
      electronDist: path.join(root, 'node_modules/electron/dist'),
      npmRebuild: false,
      asar: true,
      asarUnpack: ['**/*.node'],
      directories: { output: path.join(fixture, 'out') },
      files: ['main.js', 'node_modules/**/*', 'package.json'],
      win: { target: 'dir', signAndEditExecutable: false },
    },
    null,
    2
  ),
  'utf8'
);
run('pwsh', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  "$ErrorActionPreference = 'Stop'; npm install --prefix $env:STORAGE_SMOKE_FIXTURE --ignore-scripts --omit dev; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
]);
const bindingDirectory = path.join(fixture, 'node_modules/better-sqlite3/build/Release');
mkdirSync(bindingDirectory, { recursive: true });
copyFileSync(
  path.join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  path.join(bindingDirectory, 'better_sqlite3.node')
);
run(process.execPath, [
  path.join(root, 'node_modules/electron-builder/cli.js'),
  '--projectDir',
  fixture,
  '--config',
  configuration,
  '--win',
  'dir',
]);
for (let attempt = 1; attempt <= 2; attempt++) {
  run(path.join(fixture, 'out/win-unpacked/StorageDriverSmoke.exe'), []);
  const report = JSON.parse(readFileSync(path.join(userData, 'result.json'), 'utf8')) as {
    packaged: boolean;
    visits: number;
  };
  assert.equal(report.packaged, true);
  assert.equal(report.visits, attempt);
}
console.log(`Packaged SQLite write/restart/backup checks passed: ${fixture}`);
