const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baseline = JSON.parse(readFileSync(path.join(__dirname, 'lint-baseline.json'), 'utf8'));
let output;
if (process.argv[2]) {
  output = readFileSync(process.argv[2], 'utf8');
} else {
  try {
    output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, 'run-node-module.cjs'),
        'eslint/bin/eslint.js',
        'src',
        '--ext',
        '.ts,.tsx',
        '--format',
        'json',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
  } catch (error) {
    output = error.stdout;
    if (!output) throw error;
  }
}
const actual = {};
let errors = 0;
for (const file of JSON.parse(output)) {
  errors += file.errorCount;
  for (const message of file.messages.filter(message => message.severity === 1)) {
    const key = [
      path.relative(root, file.filePath).replaceAll('\\', '/'),
      message.ruleId,
      message.message,
    ]
      .join('|')
      .replaceAll('␍', '');
    actual[key] = (actual[key] || 0) + 1;
  }
}
const increases = Object.entries(actual).filter(([key, count]) => count > (baseline[key] || 0));
for (const [key, count] of increases) console.error(`${key}: ${baseline[key] || 0} -> ${count}`);
console.log(
  `Lint errors ${errors}, warnings ${Object.values(actual).reduce((sum, count) => sum + count, 0)}, increased categories ${increases.length}`
);
process.exitCode = errors || increases.length ? 1 : 0;
