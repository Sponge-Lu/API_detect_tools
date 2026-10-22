const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');

function verifyPackagedApplication(resourceRoot) {
  const { extractFile } = require('@electron/asar');
  const projectRoot = path.resolve(__dirname, '..');
  const archive = path.join(resourceRoot, 'app.asar');
  const readPackagedFile = relative => extractFile(archive, path.normalize(relative));
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const packagedPackage = JSON.parse(readPackagedFile('package.json').toString('utf8'));
  if (
    packagedPackage.name !== sourcePackage.name ||
    packagedPackage.version !== sourcePackage.version ||
    packagedPackage.main !== sourcePackage.main
  ) {
    throw new Error('Packaged application metadata differs from the current workspace');
  }
  const digest = data => createHash('sha256').update(data).digest('hex');
  let verified = 0;
  function verifyDirectory(relativeDirectory) {
    for (const entry of fs.readdirSync(path.join(projectRoot, relativeDirectory), {
      withFileTypes: true,
    })) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        verifyDirectory(relative);
      } else if (entry.isFile() && !/\.(map|md)$/.test(relative)) {
        if (
          digest(fs.readFileSync(path.join(projectRoot, relative))) !==
          digest(readPackagedFile(relative))
        ) {
          throw new Error('Packaged file differs from the current build: ' + relative);
        }
        verified += 1;
      }
    }
  }
  for (const entry of [sourcePackage.main, 'dist/main/preload.js', 'dist-renderer/index.html']) {
    if (readPackagedFile(entry).length === 0) throw new Error('Empty packaged entry: ' + entry);
  }
  verifyDirectory('dist');
  verifyDirectory('dist-renderer');
  for (const dependency of Object.keys(sourcePackage.dependencies)) {
    const manifest = 'node_modules/' + dependency + '/package.json';
    const localVersion = JSON.parse(
      fs.readFileSync(path.join(projectRoot, manifest), 'utf8')
    ).version;
    const packagedVersion = JSON.parse(readPackagedFile(manifest).toString('utf8')).version;
    if (localVersion !== packagedVersion)
      throw new Error('Packaged dependency version differs: ' + dependency);
  }
  console.log(
    'Packaged application matches the current build: ' +
      verified +
      ' files and all direct runtime dependencies'
  );
}

async function main() {
  const verifyApp = process.argv.includes('--verify-app');
  const args = process.argv.slice(2).filter(arg => arg !== '--verify-app');
  if (verifyApp && !args[0])
    throw new Error('Pass the packaged resources directory to verify:packaged');
  const platform = args[1] || process.platform;
  const arch = args[2] || process.arch;
  const osName = { win32: 'win', darwin: 'mac', linux: 'linux' }[platform];
  const root = path.resolve(args[0] || 'resources');
  if (verifyApp) verifyPackagedApplication(root);
  const directory = path.join(root, 'chromium', osName + '-' + arch);
  const relative =
    platform === 'win32'
      ? 'chrome.exe'
      : platform === 'darwin'
        ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        : 'chrome';
  const executablePath = path.join(directory, relative);
  const version = fs.readFileSync(path.join(directory, 'VERSION'), 'utf8').trim();
  const { CHROMIUM_VERSION } = await import('./fetch-chromium.mjs');
  if (version !== CHROMIUM_VERSION)
    throw new Error('Bundled browser version differs from the pinned development version');
  if (!version || !fs.statSync(executablePath).isFile() || fs.statSync(executablePath).size === 0)
    throw new Error('Bundled browser is incomplete');
  if (platform !== process.platform || arch !== process.arch) {
    console.log('Bundled browser resources verified for ' + platform + '-' + arch);
    return;
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-hub-browser-smoke-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      userDataDir,
      headless: 'new',
      timeout: 30000,
      // CI 的 Linux runner（Ubuntu 24.04 + AppArmor 限制 unprivileged userns）无法启用 Chrome 沙箱，
      // 且 /dev/shm 偏小，这里显式降级；仅用于冒烟测试，不涉及产品运行配置。
      args:
        platform === 'linux'
          ? ['--no-first-run', '--no-sandbox', '--disable-dev-shm-usage']
          : ['--no-first-run'],
    });
    const page = await browser.newPage();
    await page.setContent('<title>bundled-browser-smoke</title>');
    if ((await page.title()) !== 'bundled-browser-smoke')
      throw new Error('Browser page smoke failed');
    const runningVersion = await browser.version();
    if (runningVersion.split('/').pop() !== version)
      throw new Error('Browser binary differs from its VERSION marker');
    console.log('Bundled browser smoke passed: ' + runningVersion);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  // 输出 workflow command，使失败原因出现在 GitHub 注解里（无需下载日志）
  console.log('::error::' + message.replace(/\r?\n/g, ' | '));
  process.exitCode = 1;
});
