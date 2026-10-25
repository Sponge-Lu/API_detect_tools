import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(path.resolve(file), 'utf8');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}

describe('architecture boundaries', () => {
  it('keeps shared and renderer imports within their process boundaries', () => {
    const specifiers = (filename: string) =>
      Array.from(
        source(filename).matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g),
        match => match[1]
      );
    for (const filename of files('src/shared'))
      for (const specifier of specifiers(filename))
        expect(specifier, filename).not.toMatch(/(?:^electron$|\/main(?:\/|$)|\/renderer(?:\/|$))/);
    for (const filename of files('src/renderer'))
      for (const specifier of specifiers(filename))
        expect(specifier, filename).not.toMatch(
          /(?:^node:|^(?:electron|better-sqlite3|fs|path|child_process)(?:\/|$)|\/main\/)/
        );
    for (const filename of [
      ...files('src/main/storage/database'),
      ...files('src/main/storage/repositories'),
    ])
      for (const specifier of specifiers(filename))
        expect(specifier, filename).not.toMatch(
          /(?:unified-config-manager|chrome-manager|\/renderer\/)/
        );
  });
  it('keeps shared configuration contracts independent of the application component', () => {
    for (const filename of files('src/renderer')) {
      if (filename.endsWith('App.tsx') || filename.endsWith('main.tsx')) continue;
      expect(source(filename), filename).not.toMatch(/from\s+['"][^'"]*\/App['"]/);
    }
    expect(source('src/shared/types/electron-api.ts')).toContain('interface ElectronAPI');
    expect(source('src/main/preload.ts')).toContain('const bridge: ElectronAPI');
  });

  it('keeps repositories and pure view calculations free of renderer and Electron state', () => {
    const pureFiles = [
      ...files('src/main/storage/repositories'),
      'src/main/auth/api-key-policy.ts',
      'src/main/clients/session-record-parser.ts',
      'src/renderer/pages/overview/metrics.ts',
      'src/renderer/components/Route/Redirection/model-redirection-view.ts',
      'src/renderer/pages/sites/site-projections.ts',
      'src/renderer/components/Route/config-profile-view.ts',
    ];
    for (const filename of pureFiles)
      expect(source(filename), filename).not.toMatch(
        /from\s+['"](?:electron|react|zustand|[^'"]*\/store\/[^'"]*)['"]/
      );
  });

  it('does not expose legacy full-list persistence through preload', () => {
    const preload = source('src/main/preload.ts');
    expect(preload).not.toMatch(/invoke\(['"](?:save-config|custom-cli-config:save)['"]/);
    expect(preload).toContain("invoke('config:commands'");
    expect(preload).toContain("invoke('custom-cli-config:commands'");
    expect(source('src/main/handlers/unified-config-handlers.ts')).toContain(
      'LEGACY_WRITE_DISABLED'
    );
  });

  it('assembles database ownership before publishing configuration or opening the window', () => {
    const main = source('src/main/main.ts');
    const initialize = main.indexOf('await initializeApplicationStorage(');
    expect(initialize).toBeGreaterThan(0);
    expect(initialize).toBeLessThan(main.indexOf('await unifiedConfigManager.loadConfig()'));
    expect(main).toContain('requestSingleInstanceLock');
    expect(source('scripts/build-preload.cjs')).toContain("external: ['electron']");
  });
});
