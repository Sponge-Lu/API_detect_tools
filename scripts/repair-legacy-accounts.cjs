#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function generateAccountId() {
  return `acct_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function resolveDefaultConfigPath() {
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'api-hub-management-tools', 'config.json');
  }

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'api-hub-management-tools',
      'config.json'
    );
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfigHome, 'api-hub-management-tools', 'config.json');
}

function parseArgs(argv) {
  const args = {
    path: resolveDefaultConfigPath(),
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }

    if (current === '--path') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --path');
      }
      args.path = path.resolve(next);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/repair-legacy-accounts.cjs [--path <config.json>] [--dry-run]

Options:
  --path     Config file path. Defaults to the app's standard userData config path.
  --dry-run  Print the repair summary without writing changes.
  -h, --help Show this help message.
`);
}

function repairLegacyAccounts(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config root must be an object');
  }

  if (!Array.isArray(config.sites)) {
    throw new Error('Config must contain a sites array');
  }

  if (!Array.isArray(config.accounts)) {
    config.accounts = [];
  }

  const repairedSites = [];
  const now = Date.now();

  for (const site of config.sites) {
    if (!site || typeof site !== 'object') {
      continue;
    }

    const siteId = site.id;
    if (!siteId) {
      continue;
    }

    const existingAccounts = config.accounts.filter(account => account.site_id === siteId);
    if (existingAccounts.length > 0) {
      continue;
    }

    const accessToken = site.access_token || site.system_token;
    const userId = site.user_id;
    if (!accessToken || !userId) {
      continue;
    }

    config.accounts.push({
      id: generateAccountId(),
      site_id: siteId,
      account_name: '默认账户',
      user_id: userId,
      access_token: accessToken,
      auth_source: 'manual',
      status: 'active',
      cached_data: site.cached_data ? { ...site.cached_data } : undefined,
      cli_config: site.cli_config ? { ...site.cli_config } : undefined,
      created_at: now,
      updated_at: now,
    });

    repairedSites.push(site.name || siteId);
  }

  return repairedSites;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(args.path)) {
    throw new Error(`Config file not found: ${args.path}`);
  }

  const raw = fs.readFileSync(args.path, 'utf-8');
  const config = JSON.parse(raw);
  const repairedSites = repairLegacyAccounts(config);

  if (repairedSites.length === 0) {
    console.log('No legacy site-level auth records required repair.');
    return;
  }

  console.log(`Found ${repairedSites.length} legacy site(s) requiring default accounts:`);
  repairedSites.forEach(siteName => {
    console.log(`- ${siteName}`);
  });

  if (args.dryRun) {
    console.log('Dry run enabled. No changes were written.');
    return;
  }

  const backupPath = args.path.replace(
    /\.json$/i,
    `.before-legacy-account-repair.${Date.now()}.json`
  );
  fs.copyFileSync(args.path, backupPath);
  fs.writeFileSync(args.path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

  console.log(`Backup created: ${backupPath}`);
  console.log(`Config updated: ${args.path}`);
}

try {
  main();
} catch (error) {
  console.error(`[repair-legacy-accounts] ${error.message}`);
  process.exitCode = 1;
}
