import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  ConfigFileProfile,
  ConfigFileResolvedTargetValues,
} from '../shared/types/config-file-profile';
import {
  DSH_CONFIG_PROFILE_ID,
  getDshWriteModels,
  isDshConfigProfile,
} from '../shared/config/dsh-client-config';
import {
  applyCredentialDocument,
  applyPatchDocument,
  listDshModelSources,
  readPatchSnapshot,
  resolveBaseUrl,
  resolveDshHome,
  resolveDshPaths,
} from './dsh-integration-service';

export function createDshConfigFileProfile(
  now = Date.now(),
  id = DSH_CONFIG_PROFILE_ID
): ConfigFileProfile {
  const paths = resolveDshPaths(resolveDshHome());
  const files = [
    {
      id: `${id}:patch`,
      path: paths.patchFilePath,
      template: applyPatchDocument('', {
        baseUrl: '{{BASE_URL}}',
        models: ['{{MODEL}}'],
        defaultModel: '{{MODEL}}',
        allowedModels: ['{{MODEL}}'],
      }),
      format: 'yaml' as const,
    },
    {
      id: `${id}:credentials`,
      path: paths.credentialsFilePath,
      template: applyCredentialDocument(null, '{{API_KEY}}'),
      format: 'yaml' as const,
    },
  ];
  return {
    id,
    name: 'DeepSeek Harness',
    agentLogoId: 'deepseekHarness',
    authMode: 'third-party',
    files,
    dsh: {},
    target: { kind: 'local-route', model: null },
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    isExample: true,
    builtin: {
      clientType: 'deepseekHarness',
      version: 1,
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ name: 'DeepSeek Harness', files }))
        .digest('hex'),
    },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function migrateDshConfigFileProfiles(profiles: ConfigFileProfile[]): ConfigFileProfile[] {
  if (profiles.some(isDshConfigProfile)) return profiles;
  const legacy = profiles.find(
    profile =>
      profile.target.kind === 'local-route' &&
      profile.files.length === 0 &&
      (profile.agentLogoId === 'deepseekHarness' ||
        /^(dsh|deepseek[\s_-]*harness)$/i.test(profile.name.trim()))
  );
  if (!legacy) return [...profiles, createDshConfigFileProfile()];
  return profiles.map(profile =>
    profile === legacy
      ? {
          ...profile,
          ...createDshConfigFileProfile(Date.now(), profile.id),
          credentialOnly: false,
          name: profile.name,
          target: profile.target,
          localRouteCredential: profile.localRouteCredential,
          lastApplied: profile.lastApplied,
          createdAt: profile.createdAt,
          revision: (profile.revision || 1) + 1,
        }
      : profile
  );
}

export function validateDshConfigFileProfile(profile: ConfigFileProfile): void {
  const expected = createDshConfigFileProfile(0, profile.id);
  if (
    profile.authMode === 'official' ||
    profile.target.kind !== 'local-route' ||
    profile.files.length !== expected.files.length ||
    profile.files.some(
      (file, index) =>
        path.resolve(file.path) !== path.resolve(expected.files[index].path) ||
        file.template !== expected.files[index].template
    )
  ) {
    throw new Error('DSH 使用专用的本地路由配置，请恢复最新示例后重试');
  }
}

export async function resolveDshProfileConfig(profile: ConfigFileProfile): Promise<{
  values: ConfigFileResolvedTargetValues;
  models: string[];
  modelSourceId: string;
}> {
  const paths = resolveDshPaths(resolveDshHome());
  const raw = await fs.readFile(paths.patchFilePath, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '';
  });
  const snapshot = readPatchSnapshot(raw);
  const sources = await listDshModelSources();
  const preferred = profile.dsh?.modelSourceId;
  const matchedSource = sources.find(
    item =>
      item.models.length === snapshot.models.length &&
      item.models.every(model => snapshot.models.includes(model))
  );
  const source = preferred
    ? sources.find(item => item.id === preferred)
    : matchedSource || sources.find(item => item.kind === 'local-route') || sources[0];
  if (!source) throw new Error('DSH 模型来源已不可用，请重新选择模型来源');
  const model =
    profile.target.model ||
    (snapshot.defaultModel && source.models.includes(snapshot.defaultModel)
      ? snapshot.defaultModel
      : source.models[0]);
  if (!source.models.includes(model)) throw new Error('DSH 默认模型已不可用，请重新选择');
  if (!profile.localRouteCredential?.apiKey) {
    throw new Error('请先为此配置卡片生成独立的本地路由 API Key');
  }
  const { unifiedConfigManager } = await import('./unified-config-manager');
  return {
    values: {
      baseUrl: resolveBaseUrl(unifiedConfigManager.getRoutingConfig().server),
      apiKey: profile.localRouteCredential.apiKey,
      model,
      targetLabel: `本地路由 · ${source.label}`,
      apiKeyName: '独立路由 API Key',
    },
    models: getDshWriteModels(profile.target.model, source.models),
    modelSourceId: source.id,
  };
}

export async function assertDshProfileInitialized(): Promise<void> {
  const paths = resolveDshPaths(resolveDshHome());
  await fs.access(path.join(paths.profileDir, 'package.json')).catch(() => {
    throw new Error('请先启动一次 DeepSeek Harness 完成初始化');
  });
}
