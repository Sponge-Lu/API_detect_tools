import type { Config } from './renderer-config';
import type { StateVersion } from './app-storage-contract';

export const SITE_EDIT_FIELDS = [
  'name',
  'url',
  'site_type',
  'enabled',
  'group',
  'has_checkin',
  'force_enable_checkin',
  'extra_links',
  'proxy_url',
  'auto_refresh',
  'auto_refresh_interval',
  'api_key',
  'system_token',
  'user_id',
] as const;
export type SiteEditField = (typeof SITE_EDIT_FIELDS)[number];
export type ConfigCommand =
  | {
      type: 'site.upsert';
      id: string;
      fields: Partial<Pick<Config['sites'][number], SiteEditField>>;
      create: boolean;
    }
  | { type: 'site.delete'; id: string }
  | { type: 'site.order'; ids: string[] }
  | { type: 'group.upsert'; id: string; name: string }
  | { type: 'group.delete'; id: string }
  | { type: 'group.order'; ids: string[] }
  | { type: 'settings.patch'; fields: Partial<Config['settings']> };
export interface ConfigCommandBatch {
  version: StateVersion;
  commands: ConfigCommand[];
}

export function buildConfigCommands(base: Config, draft: Config): ConfigCommand[] {
  const commands: ConfigCommand[] = [];
  const previous = new Map(base.sites.map(site => [site.id, site]));
  const ids = new Set<string>();
  for (const site of draft.sites) {
    if (!site.id || ids.has(site.id)) throw new Error('Site identity is missing or duplicated');
    ids.add(site.id);
    const old = previous.get(site.id);
    const fields = Object.fromEntries(
      SITE_EDIT_FIELDS.filter(key => JSON.stringify(old?.[key]) !== JSON.stringify(site[key])).map(
        key => [key, site[key] ?? null]
      )
    );
    if (!old || Object.keys(fields).length)
      commands.push({ type: 'site.upsert', id: site.id, fields, create: !old });
  }
  for (const site of base.sites)
    if (site.id && !ids.has(site.id)) commands.push({ type: 'site.delete', id: site.id });
  if (
    JSON.stringify(base.sites.map(site => site.id)) !==
    JSON.stringify(draft.sites.map(site => site.id))
  )
    commands.push({ type: 'site.order', ids: draft.sites.map(site => site.id!) });
  if (draft.siteGroups) {
    const groups = new Map((base.siteGroups ?? []).map(group => [group.id, group]));
    for (const group of draft.siteGroups)
      if (groups.get(group.id)?.name !== group.name)
        commands.push({ type: 'group.upsert', ...group });
    for (const group of base.siteGroups ?? [])
      if (!draft.siteGroups.some(item => item.id === group.id))
        commands.push({ type: 'group.delete', id: group.id });
    if (
      JSON.stringify((base.siteGroups ?? []).map(group => group.id)) !==
      JSON.stringify(draft.siteGroups.map(group => group.id))
    )
      commands.push({ type: 'group.order', ids: draft.siteGroups.map(group => group.id) });
  }
  const fields = Object.fromEntries(
    Object.entries(draft.settings).filter(
      ([key, value]) =>
        JSON.stringify(base.settings[key as keyof Config['settings']]) !== JSON.stringify(value)
    )
  );
  if (Object.keys(fields).length) commands.push({ type: 'settings.patch', fields });
  return commands;
}
