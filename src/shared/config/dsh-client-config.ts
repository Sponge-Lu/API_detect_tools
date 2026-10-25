import type { ConfigFileProfile } from '../types/config-file-profile';
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { DSH_AGENT_DEFAULT_MODEL_ENTRY_ID, DSH_PATCH_ENTRY_ID } from '../types/dsh-integration';

export const DSH_CONFIG_PROFILE_ID = 'builtin-deepseek-harness';

export function isDshConfigProfile(profile: ConfigFileProfile): boolean {
  return profile.builtin?.clientType === 'deepseekHarness' || profile.dsh !== undefined;
}

export function getDshWriteModels(
  model: string | null | undefined,
  availableModels: string[]
): string[] {
  return model ? [model] : [...availableModels];
}

export function buildDshModelTemplate(
  template: string,
  models: string[],
  defaultModel: string
): string {
  const doc = parseDocument(template);
  if (doc.errors.length > 0) throw new Error('DSH 配置模板不是有效的 YAML');
  if (!isSeq(doc.contents)) return template;
  for (const entry of doc.contents.items) {
    if (!isMap(entry)) continue;
    const row = entry as YAMLMap;
    const config = row.get('config');
    if (!isMap(config)) continue;
    if (row.get('id') === DSH_PATCH_ENTRY_ID) {
      config.set(
        'models',
        models.map(id => ({ id, name: id }))
      );
    } else if (row.get('id') === DSH_AGENT_DEFAULT_MODEL_ENTRY_ID) {
      config.set('model', defaultModel);
    }
  }
  return doc.toString({ lineWidth: 0 });
}
