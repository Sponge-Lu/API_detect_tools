const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const probe = spawnSync(
  require('electron'),
  [
    '-e',
    "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();",
  ],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
  }
);
if (probe.error) throw probe.error;
if (probe.status !== 0) {
  if (process.platform !== 'win32')
    throw new Error(
      'SQLite must be rebuilt for Electron before starting the app. Run electron-builder install-app-deps.'
    );
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', path.join(__dirname, 'prepare-sqlite.ps1')],
    { cwd: root, stdio: 'inherit', windowsHide: true }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
