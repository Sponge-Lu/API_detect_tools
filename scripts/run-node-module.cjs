#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const [, , moduleId, ...args] = process.argv;

if (!moduleId) {
  console.error('Usage: node scripts/run-node-module.cjs <module-id> [args...]');
  process.exit(1);
}

const maxOldSpaceSize = process.env.APP_BUILD_MAX_OLD_SPACE_MB || '16384';

function resolveModuleEntry(specifier) {
  try {
    return require.resolve(specifier, { paths: [process.cwd(), __dirname] });
  } catch (error) {
    const packageName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const subpath = specifier.slice(packageName.length + 1);

    if (!subpath) {
      throw error;
    }

    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [process.cwd(), __dirname],
    });

    return path.join(path.dirname(packageJsonPath), subpath);
  }
}

let resolvedEntry;

try {
  resolvedEntry = resolveModuleEntry(moduleId);
} catch (error) {
  console.error(`Failed to resolve module entry: ${moduleId}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [`--max-old-space-size=${maxOldSpaceSize}`, resolvedEntry, ...args],
  {
    stdio: 'inherit',
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
