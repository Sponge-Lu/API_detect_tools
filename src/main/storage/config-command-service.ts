import { SITE_EDIT_FIELDS, type ConfigCommand } from '../../shared/types/config-commands';
import { parseStateVersion } from '../../shared/types/app-storage-contract';
import type { UnifiedSite } from '../../shared/types/site';
import { unifiedConfigManager } from '../unified-config-manager';
import { getApplicationStorage } from './application-storage';
import { StorageConflictError } from './database/storage-coordinator';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('Unexpected command field');
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512)
    throw new Error('Invalid identity');
  return value;
}
function reorder<T extends { id: string }>(items: T[], value: unknown): T[] {
  if (
    !Array.isArray(value) ||
    new Set(value).size !== items.length ||
    value.length !== items.length
  )
    throw new Error('Order must include every current identity exactly once');
  const indexed = new Map(items.map(item => [item.id, item]));
  return value.map(id => {
    const item = indexed.get(identity(id));
    if (!item) throw new Error('Unknown identity in order');
    return item;
  });
}

export async function applyConfigCommands(input: unknown): Promise<void> {
  const batch = object(input);
  exact(batch, ['version', 'commands']);
  const version = parseStateVersion(batch.version);
  if (
    version.scope !== 'app-config' ||
    !Array.isArray(batch.commands) ||
    batch.commands.length > 10000
  )
    throw new Error('Invalid command batch');
  const commands = batch.commands as ConfigCommand[];
  const storage = getApplicationStorage();
  if (!storage) throw new Error('Application database is not initialized');
  await unifiedConfigManager.mutateConfig(async () => {
    const current = storage.coordinator.version('app-config');
    if (JSON.stringify(version) !== JSON.stringify(current))
      throw new StorageConflictError(current);
    const config = await unifiedConfigManager.getConfig();
    // Groups must exist before site moves; removals run after those moves.
    for (const raw of commands) {
      const command = object(raw);
      if (command.type !== 'group.upsert') continue;
      exact(command, ['type', 'id', 'name']);
      const id = identity(command.id);
      const name = identity(command.name);
      const existing = config.siteGroups.find(group => group.id === id);
      if (existing) existing.name = name;
      else config.siteGroups.push({ id, name });
    }
    for (const raw of commands) {
      const command = object(raw);
      switch (command.type) {
        case 'group.upsert':
          break;
        case 'site.upsert': {
          exact(command, ['type', 'id', 'fields', 'create']);
          const id = identity(command.id);
          const fields = object(command.fields);
          exact(fields, [...SITE_EDIT_FIELDS]);
          const existing = config.sites.find(site => site.id === id);
          if (command.create === true ? existing : !existing)
            throw new Error('Site existence changed; reload before saving');
          if (typeof command.create !== 'boolean') throw new Error('Invalid create flag');
          const updates = Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [
              key === 'system_token' ? 'access_token' : key,
              value === null ? undefined : value,
            ])
          );
          const next = { ...existing, ...updates, id } as UnifiedSite;
          if (
            typeof next.name !== 'string' ||
            !next.name.trim() ||
            typeof next.url !== 'string' ||
            !/^https?:\/\//i.test(next.url) ||
            typeof next.enabled !== 'boolean'
          )
            throw new Error('Invalid site fields');
          if (!config.siteGroups.some(group => group.id === (next.group ?? 'default')))
            throw new Error('Unknown site group');
          if (existing) await unifiedConfigManager.updateSite(id, updates);
          else await unifiedConfigManager.addSite({ ...next, group: next.group ?? 'default' });
          break;
        }
        case 'site.delete':
          exact(command, ['type', 'id']);
          await unifiedConfigManager.deleteSite(identity(command.id));
          break;
        case 'site.order':
          exact(command, ['type', 'ids']);
          config.sites = reorder(config.sites, command.ids);
          break;
        case 'group.delete': {
          exact(command, ['type', 'id']);
          const id = identity(command.id);
          if (['default', 'unavailable'].includes(id))
            throw new Error('Built-in groups cannot be deleted');
          if (config.sites.some(site => site.group === id))
            throw new Error('Move sites before deleting a group');
          config.siteGroups = config.siteGroups.filter(group => group.id !== id);
          break;
        }
        case 'group.order':
          exact(command, ['type', 'ids']);
          config.siteGroups = reorder(config.siteGroups, command.ids);
          break;
        case 'settings.patch': {
          exact(command, ['type', 'fields']);
          const fields = object(command.fields);
          exact(fields, [
            'timeout',
            'concurrent',
            'max_concurrent',
            'show_disabled',
            'browser_path',
            'webdav',
            'sort',
            'browser_profile',
          ]);
          if (
            fields.timeout !== undefined &&
            (typeof fields.timeout !== 'number' ||
              !Number.isFinite(fields.timeout) ||
              fields.timeout <= 0)
          )
            throw new Error('Invalid timeout');
          config.settings = { ...config.settings, ...fields };
          break;
        }
        default:
          throw new Error('Unknown configuration command');
      }
    }
    if (commands.length) await unifiedConfigManager.saveConfig();
  });
}
