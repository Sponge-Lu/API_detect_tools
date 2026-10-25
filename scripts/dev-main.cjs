#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const electronBinary = require('electron');
const DEV_SERVER_URLS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const WAIT_RETRY_MS = 500;
const WAIT_MAX_ATTEMPTS = 60;
const projectRoot = path.resolve(__dirname, '..');

function compileMainProcess() {
  require('./prepare-native.cjs');
  const runner = path.join(__dirname, 'run-node-module.cjs');
  const result = spawnSync(
    process.execPath,
    [runner, 'typescript/bin/tsc', '-p', 'tsconfig.main.json'],
    {
      stdio: 'inherit',
      cwd: projectRoot,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
  require('./build-preload.cjs');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDevServer() {
  let lastError = null;

  for (let attempt = 1; attempt <= WAIT_MAX_ATTEMPTS; attempt += 1) {
    for (const url of DEV_SERVER_URLS) {
      const ready = await new Promise(resolve => {
        const request = http.get(url, response => {
          response.resume();
          resolve(response.statusCode === 200);
        });

        request.on('error', error => {
          lastError = error;
          resolve(false);
        });

        request.setTimeout(WAIT_RETRY_MS, () => {
          request.destroy(new Error('timeout'));
        });
      });

      if (!ready) {
        continue;
      }

      if (attempt > 1) {
        console.log(`[dev-main] renderer ready after ${attempt} attempts: ${url}`);
      }
      return url;
    }

    await wait(WAIT_RETRY_MS);
  }

  const message =
    lastError instanceof Error ? lastError.message : 'renderer dev server did not become ready';
  throw new Error(
    `[dev-main] failed to reach renderer at ${DEV_SERVER_URLS.join(', ')}: ${message}`
  );
}

async function main() {
  const { ensureChromium, CHROMIUM_VERSION } = await import('./fetch-chromium.mjs');
  await ensureChromium({
    platform: process.platform,
    arch: process.arch,
    version: CHROMIUM_VERSION,
  });
  compileMainProcess();
  const preview = process.argv.includes('--preview');
  const devServerUrl = preview ? '' : await waitForDevServer();
  const env = { ...process.env, API_HUB_DEV_SERVER_URL: devServerUrl };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronProcess = spawn(electronBinary, [projectRoot], {
    stdio: 'inherit',
    cwd: projectRoot,
    env,
  });

  const forwardSignal = signal => {
    if (!electronProcess.killed) {
      electronProcess.kill(signal);
    }
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  electronProcess.on('error', error => {
    console.error('[dev-main] failed to start electron:', error.message);
    process.exit(1);
  });

  electronProcess.on('exit', code => {
    process.exit(code ?? 0);
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
