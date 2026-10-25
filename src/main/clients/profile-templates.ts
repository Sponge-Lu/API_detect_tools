import { createHash, randomUUID } from 'crypto';

import type {
  ConfigFileDefinition,
  ConfigFileProfile,
  ConfigFileAuthMode,
  AgentLogoId,
  SessionRecordConnector,
} from '../../shared/types/config-file-profile';
import {
  DEFAULT_CONFIG_FILE_AUTH_MODE,
  DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS,
  isAgentLogoId,
  normalizeConfigFileAuthMode,
} from '../../shared/types/config-file-profile';
import {
  BUILTIN_CLI_IDS,
  BUILTIN_CLI_TYPES,
  type BuiltinCliType,
  type EditedConfigFile,
} from '../../shared/types/cli-config';

import { getBuiltinClientConfigTemplates } from '../../shared/config/builtin-client-configs';

import { isDshConfigProfile } from '../../shared/config/dsh-client-config';

import { createDshConfigFileProfile } from '../dsh-config-file-profile';

export const DEFAULT_TOKENS = DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS;

export const BUILTIN_TEMPLATE_VERSION = 6;

export const BUILTIN_NAMES: Record<BuiltinCliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  openCode: 'OpenCode',
  grokBuild: 'Grok Build',
};

export const LEGACY_SIMPLIFIED_EXAMPLES: Record<
  BuiltinCliType,
  { path: string; template: string }
> = {
  claudeCode: {
    path: '~/.claude/settings.json',
    template:
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "{{BASE_URL}}",\n    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",\n    "ANTHROPIC_MODEL": "{{MODEL}}"\n  }\n}',
  },
  codex: {
    path: '~/.codex/config.toml',
    template:
      'model = "{{MODEL}}"\nmodel_provider = "api-detect"\n\n[model_providers.api-detect]\nbase_url = "{{BASE_URL}}"\nenv_key = "API_DETECT_KEY"',
  },
  openCode: {
    path: '~/.config/opencode/opencode.json',
    template:
      '{\n  "provider": {\n    "api-detect": {\n      "options": { "baseURL": "{{BASE_URL}}", "apiKey": "{{API_KEY}}" },\n      "models": { "{{MODEL}}": {} }\n    }\n  },\n  "model": "api-detect/{{MODEL}}"\n}',
  },
  grokBuild: {
    path: '~/.grok/config.toml',
    template: 'default = "{{MODEL}}"\nbase_url = "{{BASE_URL}}"\napi_key = "{{API_KEY}}"',
  },
};

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function profileFingerprint(profile: Pick<ConfigFileProfile, 'name' | 'files'>): string {
  return hashContent(JSON.stringify({ name: profile.name, files: profile.files }));
}

export function createBuiltinConfigFileProfile(
  clientType: BuiltinCliType,
  authMode: ConfigFileAuthMode,
  now: number
): ConfigFileProfile {
  const id = BUILTIN_CLI_IDS[clientType];
  const files = getBuiltinClientConfigTemplates(clientType, authMode).map((file, index) => ({
    id: `${id}:file:${index + 1}`,
    path: file.path,
    template: file.content,
    format: file.format,
  }));
  const profile: ConfigFileProfile = {
    id,
    name: BUILTIN_NAMES[clientType],
    authMode,
    files,
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    target: { kind: 'local-route', model: null },
    isExample: true,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  profile.builtin = {
    clientType,
    version: BUILTIN_TEMPLATE_VERSION,
    fingerprint: profileFingerprint(profile),
  };
  return profile;
}

export function createDefaultConfigFileProfiles(now = Date.now()): ConfigFileProfile[] {
  return [
    ...BUILTIN_CLI_TYPES.map(clientType =>
      createBuiltinConfigFileProfile(clientType, DEFAULT_CONFIG_FILE_AUTH_MODE, now)
    ),
    createDshConfigFileProfile(now),
  ];
}

export function replaceLiteral(
  content: string,
  value: string | null | undefined,
  token: string
): string {
  return value ? content.split(value).join(token) : content;
}

export function migrateEditedFiles(
  profile: ConfigFileProfile,
  editedFiles: EditedConfigFile[],
  values: { baseUrl?: string; apiKey?: string; model?: string }
): void {
  profile.files = editedFiles.map((file, index) => ({
    id: `${profile.id}:migrated:${index + 1}`,
    path: file.path,
    template: replaceLiteral(
      replaceLiteral(
        replaceLiteral(file.content, values.apiKey, DEFAULT_TOKENS.apiKey),
        values.baseUrl,
        DEFAULT_TOKENS.baseUrl
      ),
      values.model,
      DEFAULT_TOKENS.model
    ),
    format: 'auto',
  }));
}

export function cloneMigratedProfile(
  source: ConfigFileProfile,
  sourceId: string,
  name: string
): ConfigFileProfile {
  const now = Date.now();
  const id = `migrated:${hashContent(sourceId).slice(0, 20)}`;
  return {
    ...source,
    id,
    name,
    files: source.files.map((file, index) => ({ ...file, id: `${id}:file:${index + 1}` })),
    isExample: false,
    builtin: source.builtin ? { ...source.builtin, migrationSourceId: sourceId } : undefined,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeDefinition(
  definition: Partial<ConfigFileDefinition>,
  fallbackId: string
): ConfigFileDefinition {
  return {
    id: String(definition.id || fallbackId),
    path: String(definition.path || '').trim(),
    template: String(definition.template || ''),
    format: ['auto', 'json', 'toml', 'env', 'yaml', 'text'].includes(String(definition.format))
      ? definition.format
      : 'auto',
  };
}

export function normalizeSessionRecordConnector(
  connector: Partial<SessionRecordConnector>,
  fallbackId: string
): SessionRecordConnector {
  return {
    id: String(connector.id || fallbackId),
    path: String(connector.path || '').trim(),
    format: connector.format === 'jsonl' ? 'jsonl' : 'json',
    namespace: String(connector.namespace || '').trim(),
    recordsPath: String(connector.recordsPath || '').trim() || undefined,
    sessionIdPath: String(connector.sessionIdPath || '').trim(),
    displayNamePath: String(connector.displayNamePath || '').trim() || undefined,
    workspacePath: String(connector.workspacePath || '').trim() || undefined,
    updatedAtPath: String(connector.updatedAtPath || '').trim() || undefined,
    activePath: String(connector.activePath || '').trim() || undefined,
    windowOpenPath: String(connector.windowOpenPath || '').trim() || undefined,
    currentSessionIdPath: String(connector.currentSessionIdPath || '').trim() || undefined,
    recursive: connector.recursive === true,
  };
}

export function normalizeProfile(profile: ConfigFileProfile): ConfigFileProfile {
  const legacyPaths = Array.isArray(profile.filePaths) ? profile.filePaths : [];
  const legacySessionPaths = Array.isArray(profile.sessionRecordPaths)
    ? profile.sessionRecordPaths.map(String).filter(Boolean)
    : [];
  const sourceFiles = Array.isArray(profile.files)
    ? profile.files
    : legacyPaths.map((pathname, index) => ({
        id: `${profile.id}:file:${index + 1}`,
        path: pathname,
        template: profile.template || '',
      }));
  return {
    id: String(profile.id),
    name: String(profile.name || '未命名配置'),
    agentLogoId: isAgentLogoId(profile.agentLogoId)
      ? (profile.agentLogoId as AgentLogoId)
      : undefined,
    credentialOnly: profile.credentialOnly === true,
    requiresConfiguration: profile.requiresConfiguration === true,
    dsh: isDshConfigProfile(profile)
      ? {
          modelSourceId: String(profile.dsh?.modelSourceId || '').trim() || undefined,
          allowedModels: Array.isArray(profile.dsh?.allowedModels)
            ? Array.from(
                new Set(
                  profile.dsh.allowedModels
                    .map(String)
                    .map(item => item.trim())
                    .filter(Boolean)
                )
              )
            : undefined,
        }
      : undefined,
    authMode: normalizeConfigFileAuthMode(profile.authMode),
    files: sourceFiles.map((item, index) =>
      normalizeDefinition(item, `${profile.id}:file:${index + 1}`)
    ),
    sessionRecordConnectors:
      Array.isArray(profile.sessionRecordConnectors) && profile.sessionRecordConnectors.length > 0
        ? profile.sessionRecordConnectors.map((connector, index) =>
            normalizeSessionRecordConnector(connector, `${profile.id}:session:${index + 1}`)
          )
        : legacySessionPaths.map((pathname, index) =>
            normalizeSessionRecordConnector(
              {
                id: `${profile.id}:legacy-session:${index + 1}`,
                path: pathname,
                format: pathname.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json',
                namespace: profile.id,
                sessionIdPath: 'session_id',
              },
              `${profile.id}:legacy-session:${index + 1}`
            )
          ),
    sessionRecordPaths: legacySessionPaths,
    target: profile.target || { kind: 'local-route', model: null },
    localRouteCredential: profile.localRouteCredential
      ? {
          id: String(profile.localRouteCredential.id || randomUUID()),
          apiKey: String(profile.localRouteCredential.apiKey || ''),
          createdAt: Number(profile.localRouteCredential.createdAt) || Date.now(),
          rotatedAt: profile.localRouteCredential.rotatedAt
            ? Number(profile.localRouteCredential.rotatedAt)
            : undefined,
        }
      : undefined,
    lastApplied:
      profile.lastApplied &&
      typeof profile.lastApplied.baseUrl === 'string' &&
      typeof profile.lastApplied.targetLabel === 'string'
        ? {
            targetLabel: profile.lastApplied.targetLabel,
            baseUrl: profile.lastApplied.baseUrl,
            apiKeyName: String(profile.lastApplied.apiKeyName || '未命名 API Key'),
            model: String(profile.lastApplied.model || ''),
            appliedAt: Number(profile.lastApplied.appliedAt) || Date.now(),
          }
        : undefined,
    isExample: profile.isExample === true,
    builtin:
      profile.builtin &&
      [...BUILTIN_CLI_TYPES, 'deepseekHarness'].includes(profile.builtin.clientType)
        ? {
            clientType: profile.builtin.clientType,
            version: Math.max(1, Number(profile.builtin.version) || 1),
            fingerprint: String(profile.builtin.fingerprint || ''),
            migrationSourceId: profile.builtin.migrationSourceId,
          }
        : undefined,
    revision: Math.max(1, Number(profile.revision) || 1),
    createdAt: Number(profile.createdAt) || Date.now(),
    updatedAt: Number(profile.updatedAt) || Date.now(),
  };
}

export function upgradeBuiltinProfiles(profiles: ConfigFileProfile[]): ConfigFileProfile[] {
  return profiles.map(profile => {
    if (isDshConfigProfile(profile)) return profile;
    if (!profile.isExample) return profile;
    const legacyClient = BUILTIN_CLI_TYPES.find(
      clientType => BUILTIN_CLI_IDS[clientType] === profile.id
    );
    const clientType = profile.builtin?.clientType || legacyClient;
    if (!clientType || clientType === 'deepseekHarness' || profile.builtin?.migrationSourceId)
      return profile;
    const authMode = normalizeConfigFileAuthMode(profile.authMode);
    const latest = createBuiltinConfigFileProfile(clientType, authMode, Date.now());
    const isUntouchedLegacy =
      !profile.builtin &&
      profile.files.length === 1 &&
      profile.files[0].path === LEGACY_SIMPLIFIED_EXAMPLES[clientType].path &&
      profile.files[0].template === LEGACY_SIMPLIFIED_EXAMPLES[clientType].template;
    const isUntouchedVersioned =
      !!profile.builtin &&
      profile.builtin.version < latest.builtin!.version &&
      profileFingerprint(profile) === profile.builtin.fingerprint;
    if (!isUntouchedLegacy && !isUntouchedVersioned) return profile;
    return {
      ...latest,
      name: profile.name,
      agentLogoId: profile.agentLogoId,
      target: profile.target,
      localRouteCredential: profile.localRouteCredential,
      lastApplied: profile.lastApplied,
      sessionRecordConnectors: profile.sessionRecordConnectors,
      sessionRecordPaths: profile.sessionRecordPaths,
      createdAt: profile.createdAt,
      revision: (profile.revision || 1) + 1,
    };
  });
}
