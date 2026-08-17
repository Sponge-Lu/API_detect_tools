import type { CliTargetProtocol } from './cli-config';

export const AGENT_LOGO_IDS = [
  'claudeCode',
  'codex',
  'deepseekHarness',
  'openCode',
  'grokBuild',
  'pi',
  'zcode',
  'amp',
  'amazonQ',
  'cline',
  'codeBuddy',
  'continue',
  'cursor',
  'devin',
  'geminiCli',
  'githubCopilot',
  'goose',
  'kiloCode',
  'kiro',
  'openClaw',
  'openHands',
  'qoder',
  'qwenCode',
  'rooCode',
  'trae',
  'windsurf',
] as const;

export type AgentLogoId = (typeof AGENT_LOGO_IDS)[number];

export function isAgentLogoId(value: unknown): value is AgentLogoId {
  return typeof value === 'string' && (AGENT_LOGO_IDS as readonly string[]).includes(value);
}

export type ConfigFileTarget =
  | { kind: 'local-route'; model?: string | null }
  | { kind: 'managed'; siteId: string; accountId: string; apiKeyId?: string; model?: string | null }
  | { kind: 'direct'; configId: string; model?: string | null };

export type ConfigFileApplyMode = 'merge' | 'overwrite';
export type ConfigFileFormat = 'auto' | 'json' | 'toml' | 'env' | 'text';
export type ConfigFileOperation = 'apply' | 'direct-edit' | 'key-rotation';

export const DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS = {
  baseUrl: '{{BASE_URL}}',
  apiKey: '{{API_KEY}}',
  model: '{{MODEL}}',
} as const;

export type ConfigFileReplacementTokens = typeof DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS;

export interface ConfigFileReplacementMatchCounts {
  baseUrl: number;
  apiKey: number;
  model: number;
}

export interface ConfigFileDefinition {
  id: string;
  path: string;
  template: string;
  format?: ConfigFileFormat;
}

export interface ConfigFileBuiltinMetadata {
  clientType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild';
  version: number;
  fingerprint: string;
  migrationSourceId?: string;
}

export type SessionRecordFormat = 'json' | 'jsonl';

export interface SessionRecordConnector {
  id: string;
  path: string;
  format: SessionRecordFormat;
  namespace: string;
  recordsPath?: string;
  sessionIdPath: string;
  displayNamePath?: string;
  workspacePath?: string;
  updatedAtPath?: string;
  /** Optional field in each record indicating whether its conversation window is open/current. */
  activePath?: string;
  /** Optional JSON root field indicating whether the owning client window is currently open. */
  windowOpenPath?: string;
  /** Optional JSON root field containing the session ID currently selected in the window. */
  currentSessionIdPath?: string;
  recursive?: boolean;
}

export interface ConfigSessionRecord {
  connectorId: string;
  namespace: string;
  sessionId: string;
  displayName?: string;
  workspace?: string;
  updatedAt?: number;
  /** Explicit open/current state from the source record; undefined means unknown. */
  isOpen?: boolean;
}

export interface ConfigFileProfile {
  id: string;
  name: string;
  agentLogoId?: AgentLogoId;
  /** Route credential identity without managed configuration files. */
  credentialOnly?: boolean;
  files: ConfigFileDefinition[];
  sessionRecordConnectors: SessionRecordConnector[];
  /** v2 migration input. Paths without a schema remain disabled until configured. */
  sessionRecordPaths: string[];
  target: ConfigFileTarget;
  localRouteCredential?: ConfigFileProfileLocalRouteCredential;
  /** Values confirmed by the last successful apply commit. Draft edits must not change this. */
  lastApplied?: ConfigFileAppliedSnapshot;
  isExample?: boolean;
  builtin?: ConfigFileBuiltinMetadata;
  revision?: number;
  createdAt: number;
  updatedAt: number;
  /** v1 migration input. */
  filePaths?: string[];
  /** v1 migration input. */
  template?: string;
}

export interface ConfigFileAppliedSnapshot {
  targetLabel: string;
  baseUrl: string;
  apiKeyName: string;
  model: string;
  appliedAt: number;
}

export interface ConfigFileProfileLocalRouteCredential {
  id: string;
  apiKey: string;
  createdAt: number;
  rotatedAt?: number;
}

export interface ConfigFileSnapshot {
  fileId: string;
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  mtimeMs: number | null;
  mode?: number | null;
  error?: string;
}

export interface ConfigFilePreviewItem extends ConfigFileSnapshot {
  nextContent: string;
  matchCounts: ConfigFileReplacementMatchCounts;
  changed: boolean;
}

export interface ConfigFilePreviewTransaction {
  transactionId: string;
  profileId: string;
  profileRevision?: number;
  profileFingerprint?: string;
  operation?: ConfigFileOperation;
  applyMode?: ConfigFileApplyMode;
  createdAt: number;
  expiresAt: number;
  files: ConfigFilePreviewItem[];
  nextLocalRouteCredential?: ConfigFileProfileLocalRouteCredential;
}

export interface PreviewConfigFileProfileInput {
  profileId: string;
  expectedRevision?: number;
  applyMode?: ConfigFileApplyMode;
  /** Legacy direct-edit payload. New callers use PreviewConfigFileDirectEditInput. */
  edits?: Record<string, string>;
}

export interface PreviewConfigFileDirectEditInput {
  profileId: string;
  expectedRevision?: number;
  edits: Record<string, string>;
  snapshots: Record<
    string,
    Pick<ConfigFileSnapshot, 'path' | 'exists' | 'hash' | 'mtimeMs' | 'mode'>
  >;
}

export interface CommitConfigFileProfileInput {
  transactionId: string;
}

export interface UpsertConfigFileProfileInput {
  profile: ConfigFileProfile;
  expectedRevision?: number;
}

export interface GenerateConfigFileProfileRouteKeyInput {
  profileId: string;
  expectedRevision?: number;
}

export interface PreviewConfigFileProfileRouteKeyRotationInput {
  profileId: string;
  expectedRevision?: number;
}

export interface DeleteConfigFileProfileInput {
  profileId: string;
  expectedRevision?: number;
}

export interface RestoreBuiltinConfigFileProfileInput {
  profileId: string;
  expectedRevision?: number;
}

export interface ConfigFileTargetCatalogApiKey {
  id: string;
  label: string;
  /** 明文 API Key（可能不含 sk- 前缀），用于与令牌管理一致地展示完整 Key。 */
  key?: string;
  group?: string;
  /** 所属分组的倍率（来自 user_groups[group].ratio）。 */
  ratio?: number;
  /** 所属分组的描述（来自 user_groups[group].desc）。 */
  desc?: string;
  scopedModels: string[];
}

export interface ConfigFileTargetCatalogEntry {
  value: string;
  kind: ConfigFileTarget['kind'];
  label: string;
  available: boolean;
  unavailableReason?: string;
  siteId?: string;
  accountId?: string;
  configId?: string;
  targetProtocol?: CliTargetProtocol;
  apiKeys: ConfigFileTargetCatalogApiKey[];
  models: string[];
  allModels: string[];
}

export interface ConfigFileResolvedTargetValues {
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLabel?: string;
  apiKeyName?: string;
}

export interface ResolveConfigFileProfileValuesInput {
  profile: ConfigFileProfile;
}

export interface ConfigSessionRecordDiagnostic {
  connectorId: string;
  path: string;
  status: 'ok' | 'missing' | 'error';
  recordCount: number;
  message?: string;
}

export interface ConfigSessionRecordScanResult {
  records: ConfigSessionRecord[];
  diagnostics: ConfigSessionRecordDiagnostic[];
}

export interface ValidateSessionRecordConnectorInput {
  connector: SessionRecordConnector;
}

/** Legacy direct service input kept for migration tests and non-IPC callers. */
export interface ApplyConfigFileProfileInput {
  profile: ConfigFileProfile;
  values: { baseUrl: string; apiKey: string; model: string };
}
