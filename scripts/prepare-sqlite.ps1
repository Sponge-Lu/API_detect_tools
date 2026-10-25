$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskRoot = Join-Path $projectRoot '.cache/architecture-refactor-tests/native-driver'
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$moduleRoot = Join-Path $projectRoot 'node_modules/better-sqlite3'
$electronPath = Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $electronPath)) { throw 'Install the pinned Electron dependency first' }
$driver = Get-Content -LiteralPath (Join-Path $moduleRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$probePath = Join-Path $taskRoot 'probe.cjs'
@'
const result = {electron: process.versions.electron, abi: process.versions.modules, arch: process.arch};
try {
  const Database = require(process.cwd() + '/node_modules/better-sqlite3');
  const db = new Database(':memory:');
  result.sqlite = db.prepare('SELECT sqlite_version()').pluck().get();
  db.close();
} catch {
  result.bindingAvailable = false;
}
console.log(JSON.stringify(result));
process.exit(result.bindingAvailable === false ? 1 : 0);
'@ | Set-Content -LiteralPath $probePath -Encoding UTF8
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $stdout = Join-Path $taskRoot 'probe.json'
  $stderr = Join-Path $taskRoot 'probe-error.txt'
  $probe = Start-Process -FilePath $electronPath -ArgumentList ('"{0}"' -f $probePath) -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $runtime = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($probe.ExitCode -eq 0) { $runtime | ConvertTo-Json; exit 0 }
  if ($runtime.abi -notmatch '^\d+$' -or $runtime.arch -notmatch '^(x64|arm64)$' -or $driver.version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Unexpected runtime or driver version'
  }
  $asset = 'better-sqlite3-v{0}-electron-v{1}-win32-{2}.tar.gz' -f $driver.version,$runtime.abi,$runtime.arch
  $archivePath = Join-Path $taskRoot $asset
  $uri = 'https://github.com/WiseLibs/better-sqlite3/releases/download/v{0}/{1}' -f $driver.version,$asset
  Invoke-WebRequest -Uri $uri -OutFile $archivePath
  $entries = @(& tar -tzf $archivePath)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect native driver archive' }
  if ($entries.Count -eq 0 -or @($entries | Where-Object { $_ -notin @('build/','build/Release/','build/Release/better_sqlite3.node') }).Count -gt 0) {
    throw 'Unexpected native driver archive paths'
  }
  $resolvedModuleRoot = (Resolve-Path -LiteralPath $moduleRoot).Path
  if (-not $resolvedModuleRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Native driver destination is outside this project'
  }
  & tar -xzf $archivePath -C $resolvedModuleRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not extract native driver archive' }
  $probe = Start-Process -FilePath $electronPath -ArgumentList ('"{0}"' -f $probePath) -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($probe.ExitCode -ne 0) { throw 'Downloaded native driver failed the Electron runtime probe' }
  Get-Content -LiteralPath $stdout -Encoding UTF8
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
}
