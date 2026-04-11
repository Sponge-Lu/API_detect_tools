import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('vitest config format', () => {
  it('uses an ESM vitest config file', () => {
    const root = process.cwd();
    expect(fs.existsSync(path.join(root, 'vitest.config.mts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'vitest.config.ts'))).toBe(false);
  });
});
