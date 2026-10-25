import type { CustomCliConfig } from './custom-cli-config';
import type { StateVersion } from './app-storage-contract';

export interface CustomCliSnapshot {
  configs: CustomCliConfig[];
  activeConfigId: string | null;
  storageVersion?: StateVersion;
}
export const CUSTOM_CLI_EDIT_FIELDS = [
  'name',
  'baseUrl',
  'apiKey',
  'apiKeys',
  'modelUrl',
  'models',
  'manualModels',
  'modelPricing',
  'gasStationUrl',
  'notes',
  'groupMultiplier',
  'enabled',
  'cliSettings',
  'supportedProtocols',
  'routeTargetProtocol',
  'routeTargetProtocolNeedsConfirmation',
  'routeAuthScheme',
  'createdAt',
  'updatedAt',
] as const;
export type CustomCliCommand =
  | { type: 'upsert'; id: string; create: boolean; fields: Record<string, unknown> }
  | { type: 'delete'; id: string }
  | { type: 'order'; ids: string[] }
  | { type: 'activate'; id: string | null };
export interface CustomCliCommandBatch {
  version: StateVersion;
  commands: CustomCliCommand[];
}

export function buildCustomCliCommands(
  base: CustomCliSnapshot,
  draft: CustomCliSnapshot
): CustomCliCommand[] {
  const result: CustomCliCommand[] = [];
  const ids = new Set<string>();
  for (const config of draft.configs) {
    if (!config.id || ids.has(config.id)) throw new Error('Invalid direct configuration identity');
    ids.add(config.id);
    const old = base.configs.find(item => item.id === config.id);
    const before = old as unknown as Record<string, unknown> | undefined;
    const after = config as unknown as Record<string, unknown>;
    const fields = Object.fromEntries(
      CUSTOM_CLI_EDIT_FIELDS.filter(
        key => JSON.stringify(before?.[key]) !== JSON.stringify(after[key])
      ).map(key => [key, after[key] ?? null])
    );
    if (!old || Object.keys(fields).length)
      result.push({ type: 'upsert', id: config.id, create: !old, fields });
  }
  for (const config of base.configs)
    if (!ids.has(config.id)) result.push({ type: 'delete', id: config.id });
  if (
    JSON.stringify(base.configs.map(config => config.id)) !==
    JSON.stringify(draft.configs.map(config => config.id))
  )
    result.push({ type: 'order', ids: draft.configs.map(config => config.id) });
  if (base.activeConfigId !== draft.activeConfigId)
    result.push({ type: 'activate', id: draft.activeConfigId });
  return result;
}
