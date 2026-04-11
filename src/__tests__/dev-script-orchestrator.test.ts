import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
  scripts?: Record<string, string>;
};

describe('dev script orchestration', () => {
  it('does not route npm run dev through concurrently', () => {
    expect(packageJson.scripts?.dev).not.toContain('concurrently');
  });
});
