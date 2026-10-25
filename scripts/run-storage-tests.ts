import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const testRoot = path.join(root, '.cache/storage-tests/src/__tests__/storage');
const tests = readdirSync(testRoot)
  .filter(name => name.endsWith('.integration.js'))
  .map(name => path.join(testRoot, name));
if (tests.length === 0) throw new Error('No storage integration tests were compiled');

// Native bindings must run with the same ABI as the application, not the host Node.js.
const result = spawnSync(require('electron') as string, ['--test', ...tests], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
