#!/usr/bin/env node

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const shellCommand = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : null;

function prefixStream(stream, prefix) {
  const rl = readline.createInterface({ input: stream });
  rl.on('line', line => {
    process.stdout.write(`${prefix} ${line}\n`);
  });
  return rl;
}

function spawnScript(scriptName, prefix) {
  const child =
    process.platform === 'win32'
      ? spawn(shellCommand, ['/d', '/s', '/c', `npm run ${scriptName}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        })
      : spawn('npm', ['run', scriptName], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });

  const stdout = prefixStream(child.stdout, prefix);
  const stderr = prefixStream(child.stderr, prefix);

  child.on('close', () => {
    stdout.close();
    stderr.close();
  });

  return child;
}

const children = [
  { name: 'dev:main', prefix: '[0]' },
  { name: 'dev:renderer', prefix: '[1]' },
].map(({ name, prefix }) => ({
  name,
  child: spawnScript(name, prefix),
}));

let shuttingDown = false;

function stopChild(entry) {
  if (entry.child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    killer.on('error', () => {});
    return;
  }

  entry.child.kill('SIGTERM');
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const entry of children) {
    stopChild(entry);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 300);
}

for (const entry of children) {
  entry.child.on('error', error => {
    process.stderr.write(`[dev] failed to start ${entry.name}: ${error.message}\n`);
    shutdown(1);
  });

  entry.child.on('exit', code => {
    if (shuttingDown) {
      return;
    }

    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
