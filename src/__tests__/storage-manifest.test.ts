import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  APP_STORAGE_ENTRIES,
  APP_STORAGE_MANIFEST_VERSION,
  findAppStorageEntry,
  resolveAppStorageManifest,
} from '../main/app-storage-manifest';

describe('app storage manifest', () => {
  it('declares the required storage families with stable unique ids', () => {
    const ids = APP_STORAGE_ENTRIES.map(entry => entry.id);

    expect(APP_STORAGE_MANIFEST_VERSION).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'stable-config',
        'runtime-detection-cache',
        'route-runtime-state',
        'route-endpoint-test-state',
        'route-analytics-state',
        'model-registry-source-state',
        'local-config-backups',
        'persistent-browser-profiles',
        'temp-main-browser-profile',
        'temp-login-browser-profile',
        'temp-isolated-browser-profiles',
      ])
    );
  });

  it('keeps protected browser operational state out of mutation and default backup scope', () => {
    const browserEntries = APP_STORAGE_ENTRIES.filter(
      entry => entry.kind === 'browser-operational-state'
    );

    expect(browserEntries.length).toBeGreaterThanOrEqual(4);
    for (const entry of browserEntries) {
      expect(entry.mutationPolicy).toBe('protected-do-not-mutate');
      expect(entry.retention.mode).toBe('external-owner');
      expect(entry.backup.defaultIncluded).toBe(false);
      expect(entry.backup.modes).toEqual([]);
    }
  });

  it('includes field-encrypted custom-cli-configs in full-manifest and portable backups', () => {
    const entry = findAppStorageEntry('custom-cli-configs');

    expect(entry?.containsSecrets).toBe(true);
    expect(entry?.backup.defaultIncluded).toBe(true);
    expect(entry?.backup.requiresExplicitInclude).toBeFalsy();
    expect(entry?.backup.modes).toEqual(['full-manifest', 'portable-config']);
  });

  it('marks stable-config as portable and lightweight', () => {
    const entry = findAppStorageEntry('stable-config');

    expect(entry?.backup.defaultIncluded).toBe(true);
    expect(entry?.backup.modes).toEqual(
      expect.arrayContaining(['lightweight-config', 'full-manifest', 'portable-config'])
    );
  });

  it('keeps runtime/settings out of portable-config mode', () => {
    const portableIds = APP_STORAGE_ENTRIES.filter(entry =>
      entry.backup.modes.includes('portable-config')
    ).map(entry => entry.id);

    expect(portableIds).toEqual(['stable-config', 'custom-cli-configs', 'config-file-profiles']);
  });

  it('requires explicit backup inclusion for credit cookies', () => {
    const entry = findAppStorageEntry('credit-settings');

    expect(entry?.containsSecrets).toBe(true);
    expect(entry?.backup.defaultIncluded).toBe(false);
    expect(entry?.backup.requiresExplicitInclude).toBe(true);
    expect(entry?.backup.modes).toEqual(['explicit-sensitive']);
  });

  it('bounds every app-managed runtime, cache, statistics, log, and update file', () => {
    const noisyEntries = APP_STORAGE_ENTRIES.filter(
      entry =>
        entry.mutationPolicy === 'app-managed' &&
        ['runtime-cache', 'runtime-state', 'statistics', 'logs', 'update-cache'].includes(
          entry.kind
        )
    );

    expect(noisyEntries.length).toBeGreaterThan(0);
    for (const entry of noisyEntries) {
      const hasTtl = typeof entry.retention.ttlDays === 'number';
      const hasItemCap = typeof entry.retention.maxItems === 'number';
      const hasSizeCap = typeof entry.retention.maxBytes === 'number';

      expect(entry.retention.mode).not.toBe('none');
      expect(hasTtl || hasItemCap || hasSizeCap).toBe(true);
      if (entry.retention.mode !== 'size-cap') {
        expect(entry.retention.dedupeKey).toBeTruthy();
      }
    }
  });

  it('resolves absolute paths from supplied roots without touching the filesystem', () => {
    const roots = {
      userData: path.join('C:', 'Users', 'Example', 'AppData', 'Roaming', 'api-hub'),
      home: path.join('C:', 'Users', 'Example'),
      temp: path.join('C:', 'Users', 'Example', 'AppData', 'Local', 'Temp'),
      localAppData: path.join('C:', 'Users', 'Example', 'AppData', 'Local'),
    };

    const resolved = resolveAppStorageManifest(roots);

    expect(resolved.find(entry => entry.id === 'stable-config')?.absolutePath).toBe(
      path.join(roots.userData, 'config.json')
    );
    expect(resolved.find(entry => entry.id === 'local-config-backups')?.absolutePath).toBe(
      path.join(roots.home, '.api-hub-management-tools')
    );
    expect(resolved.find(entry => entry.id === 'updater-cache')?.absolutePath).toBe(
      path.join(roots.localAppData, 'api-hub-management-tools-updater')
    );
  });
});
