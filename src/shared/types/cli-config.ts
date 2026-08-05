/**
 * 输入: 无
 * 输出: CLI 配置与能力相关类型定义 (CliConfig, CliConfigItem, BuiltinCliType, ProbeCliType 等)
 * 定位: 类型层 - CLI 配置与内建/可执行探测能力边界，供多个组件共享使用
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/** 编辑后的配置文件 */
export interface EditedConfigFile {
  path: string;
  content: string;
}

export const CLI_TARGET_PROTOCOLS = [
  'native',
  'anthropic-messages',
  'openai-chat-completions',
  'openai-responses',
] as const;

export type CliTargetProtocol = (typeof CLI_TARGET_PROTOCOLS)[number];

export const DEFAULT_CLI_TARGET_PROTOCOL: CliTargetProtocol = 'native';

export const BUILTIN_CLI_TYPES = ['claudeCode', 'codex', 'openCode', 'grokBuild'] as const;

export type BuiltinCliType = (typeof BUILTIN_CLI_TYPES)[number];

/** 当前具备真实模型探测执行器的 CLI。 */
export const PROBE_CLI_TYPES = ['claudeCode', 'codex'] as const satisfies readonly BuiltinCliType[];

export type ProbeCliType = (typeof PROBE_CLI_TYPES)[number];

export function isProbeCliType(value: unknown): value is ProbeCliType {
  return typeof value === 'string' && PROBE_CLI_TYPES.includes(value as ProbeCliType);
}

export const BUILTIN_CLI_LABELS: Record<BuiltinCliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  openCode: 'OpenCode',
  grokBuild: 'Grok Build',
};

export type CliTargetProtocolCliType = BuiltinCliType;

export function getCliTargetEndpoint(
  cliType: CliTargetProtocolCliType,
  targetProtocol: CliTargetProtocol,
  _model?: string | null
): string {
  const normalized = normalizeCliTargetProtocol(targetProtocol);
  if (normalized === 'native') {
    if (cliType === 'claudeCode') {
      return '/v1/messages';
    }
    if (cliType === 'codex') {
      return '/v1/responses';
    }
    if (cliType === 'openCode') {
      return '/v1/responses';
    }
    if (cliType === 'grokBuild') {
      return '/v1/responses';
    }
  }
  if (normalized === 'anthropic-messages') {
    return '/v1/messages';
  }
  if (normalized === 'openai-responses') {
    return '/v1/responses';
  }
  return '/v1/chat/completions';
}

export function isCliTargetProtocolNativeEquivalent(
  cliType: CliTargetProtocolCliType,
  targetProtocol: CliTargetProtocol
): boolean {
  const normalized = normalizeCliTargetProtocol(targetProtocol);
  if (normalized === 'native') {
    return true;
  }
  if (cliType === 'claudeCode') {
    return normalized === 'anthropic-messages';
  }
  if (cliType === 'codex') {
    return normalized === 'openai-responses';
  }
  if (cliType === 'openCode') {
    return normalized === 'openai-responses';
  }
  return false;
}

/** 单个 CLI 配置项 */
export interface CliConfigItem {
  apiKeyId: number | null;
  model: string | null; // CLI 使用模型
  enabled?: boolean; // 是否启用，可选以兼容旧数据
  editedFiles?: EditedConfigFile[] | null; // 用户编辑后的配置文件内容
  applyMode?: 'merge' | 'overwrite'; // 应用配置模式：合并或覆盖，默认合并
  targetProtocol?: CliTargetProtocol; // 上游目标协议
}

/** CLI 配置 */
export interface CliConfig {
  claudeCode?: CliConfigItem | null;
  codex?: CliConfigItem | null;
  openCode?: CliConfigItem | null;
  grokBuild?: CliConfigItem | null;
}

/** 默认 CLI 配置 - 所有 CLI 默认启用 */
export const DEFAULT_CLI_CONFIG: Required<{
  [K in keyof CliConfig]: Required<Omit<CliConfigItem, 'editedFiles'>> & { editedFiles: null };
}> = {
  claudeCode: {
    apiKeyId: null,
    model: null,
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
    targetProtocol: DEFAULT_CLI_TARGET_PROTOCOL,
  },
  codex: {
    apiKeyId: null,
    model: null,
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
    targetProtocol: DEFAULT_CLI_TARGET_PROTOCOL,
  },
  openCode: {
    apiKeyId: null,
    model: null,
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
    targetProtocol: DEFAULT_CLI_TARGET_PROTOCOL,
  },
  grokBuild: {
    apiKeyId: null,
    model: null,
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
    targetProtocol: DEFAULT_CLI_TARGET_PROTOCOL,
  },
};

export function normalizeCliTargetProtocol(value: unknown): CliTargetProtocol {
  return typeof value === 'string' && CLI_TARGET_PROTOCOLS.includes(value as CliTargetProtocol)
    ? (value as CliTargetProtocol)
    : DEFAULT_CLI_TARGET_PROTOCOL;
}

/**
 * 迁移 Codex TOML 中已弃用的 collab 特性标志
 */
export function normalizeCodexFeatureFlagsToml(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFeaturesSection = false;
  let sawFeaturesSection = false;
  let sawMultiAgent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      if (inFeaturesSection && !sawMultiAgent) {
        result.push('multi_agent = true');
      }
      inFeaturesSection = sectionMatch[1] === 'features';
      if (inFeaturesSection) {
        sawFeaturesSection = true;
        sawMultiAgent = false;
      }
      result.push(line);
      continue;
    }

    if (inFeaturesSection) {
      const collabMatch = line.match(/^(\s*)collab(\s*=.*)$/);
      if (collabMatch) {
        result.push(`${collabMatch[1]}multi_agent${collabMatch[2]}`);
        sawMultiAgent = true;
        continue;
      }

      if (/^\s*multi_agent\s*=/.test(line)) {
        sawMultiAgent = true;
      }
    }

    result.push(line);
  }

  if (inFeaturesSection && !sawMultiAgent) {
    result.push('multi_agent = true');
  }

  if (!sawFeaturesSection) {
    const trimmedResult = result.join('\n').trimEnd();
    return `${trimmedResult}\n\n[features]\nmulti_agent = true`;
  }

  return result.join('\n');
}

/** API Key 信息 */
export interface ApiKeyInfo {
  id?: number;
  token_id?: number;
  name?: string;
  key?: string;
  token?: string;
  group?: string;
  models?: string;
  status?: number;
}

/** 用户分组信息 */
export interface UserGroupInfo {
  desc: string;
  ratio: number;
}
