#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const DEV_PORTS = [5173, 5174, 5175];
const electronBinary = require('electron');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function cleanupWindows() {
  const escapedElectronPath = electronBinary.replace(/'/g, "''");
  const script = `
$ports = @(${DEV_PORTS.join(',')})
$portPids = @()
foreach ($port in $ports) {
  $portPids += (
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess
  )
}

$electronPids = (
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.ExecutablePath -eq '${escapedElectronPath}' } |
    Select-Object -ExpandProperty ProcessId
)

$allPids = @($portPids + $electronPids) |
  Where-Object { $_ -and $_ -ne $PID } |
  Sort-Object -Unique

if ($allPids.Count -gt 0) {
  Stop-Process -Id $allPids -Force -ErrorAction SilentlyContinue
  Write-Output ('[dev-cleanup] stopped pids: ' + ($allPids -join ', '))
} else {
  Write-Output '[dev-cleanup] nothing to stop'
}
`;

  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

function cleanupUnix() {
  const lsof = spawnSync('lsof', ['-ti', `TCP:${DEV_PORTS.join(',')}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });

  if (lsof.error) {
    console.log('[dev-cleanup] lsof unavailable, skip port cleanup');
    return;
  }

  const portPids = lsof.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (portPids.length > 0) {
    run('kill', ['-9', ...portPids]);
    console.log(`[dev-cleanup] stopped pids: ${portPids.join(', ')}`);
  } else {
    console.log('[dev-cleanup] nothing to stop');
  }
}

if (process.platform === 'win32') {
  cleanupWindows();
} else {
  cleanupUnix();
}
