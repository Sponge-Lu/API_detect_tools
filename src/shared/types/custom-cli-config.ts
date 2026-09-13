/**
 * 输入: 无
 * 输出: 自定义 CLI 配置相关类型定义 (CustomCliConfig, CustomCliSettings)
 * 定位: 类型层 - 自定义 CLI 配置相关类型定义，供多个组件共享使用
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  BUILTIN_CLI_TYPES,
  normalizeCliTargetProtocol,
  type BuiltinCliType,
  type CliTargetProtocol,
  type CliUpstreamProtocol,
  normalizeCliUpstreamProtocolsWithDefault,
} from './cli-config';
import type { ModelPricingData, RouteAuthScheme } from './site';
import { normalizeCircledGroupLabel } from '../utils/groupLabel';

export const CUSTOM_CLI_GROUP_MULTIPLIER_DEFAULT = 1;
export const CUSTOM_CLI_GROUP_MULTIPLIER_MIN = 0.001;

export function normalizeCustomCliGroupMultiplier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CUSTOM_CLI_GROUP_MULTIPLIER_DEFAULT;
  }
  return Math.max(CUSTOM_CLI_GROUP_MULTIPLIER_MIN, value);
}

/** A direct configuration API key with its own group scope and model snapshot. */
export interface CustomCliApiKey {
  id: string;
  name: string;
  key: string;
  group: string;
  groupMultiplier: number;
  models: string[];
  lastModelFetch?: number;
}

/** 单个 CLI 的自定义配置 */
export interface CustomCliSettings {
  enabled: boolean;
  model: string | null;
  /** 上游目标协议 */
  targetProtocol?: CliTargetProtocol;
  /** 用户编辑后的配置文件内容（null 表示未编辑，使用自动生成的配置） */
  editedFiles?: { path: string; content: string }[] | null;
}

/** 自定义 CLI 配置 */
export interface CustomCliConfig {
  /** 唯一标识 */
  id: string;
  /** 配置名称 */
  name: string;
  /** Base URL (如 https://api.example.com) */
  baseUrl: string;
  /** 模型列表 URL；仅用于拉取模型，留空时回退到 baseUrl。 */
  modelUrl?: string;
  /** API Key */
  apiKey: string;
  /** Multi-key form. `apiKey` remains as a compatibility projection for older consumers. */
  apiKeys?: CustomCliApiKey[];
  /** 真实路由请求使用的上游协议；测试请求始终按被测端点原生发送 */
  routeTargetProtocol?: CliTargetProtocol;
  routeTargetProtocolNeedsConfirmation?: boolean;
  routeAuthScheme?: RouteAuthScheme;
  /** Concrete protocols accepted natively; missing legacy values normalize to all protocols. */
  supportedProtocols?: CliUpstreamProtocol[];
  /** 加油站链接 */
  gasStationUrl?: string;
  /** 直连配置分组倍率，用于估算实际费用 */
  groupMultiplier?: number;
  /** 拉取到的可用模型列表 */
  models: string[];
  /** 用户手动输入的模型列表，用于拉取端点不可用或模型未出现在端点响应中的配置 */
  manualModels?: string[];
  /** 按当前直连配置隔离的模型价格，key 为模型名 */
  modelPricing?: ModelPricingData;
  /** 最后拉取模型时间戳 */
  lastModelFetch?: number;
  /** 用户备注 */
  notes?: string;
  /** 各 CLI 工具的配置 */
  cliSettings: Record<BuiltinCliType, CustomCliSettings>;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 自定义 CLI 配置的默认设置 */
export const DEFAULT_CUSTOM_CLI_SETTINGS: CustomCliSettings = {
  enabled: true,
  model: null,
};

export function normalizeCustomCliSettings(setting?: CustomCliSettings | null): CustomCliSettings {
  const {
    testModels: _legacyTestModels,
    testState: _legacyTestState,
    ...current
  } = (setting || {}) as CustomCliSettings & { testModels?: unknown; testState?: unknown };
  return {
    ...DEFAULT_CUSTOM_CLI_SETTINGS,
    ...current,
    targetProtocol: setting?.targetProtocol
      ? normalizeCliTargetProtocol(setting.targetProtocol)
      : undefined,
  };
}

/** 创建新自定义配置的默认值 */
export function createDefaultCustomCliConfig(partial?: Partial<CustomCliConfig>): CustomCliConfig {
  const now = Date.now();
  const normalizedSupportedProtocols = normalizeCliUpstreamProtocolsWithDefault(
    partial?.supportedProtocols
  );
  const cliSettings = Object.fromEntries(
    BUILTIN_CLI_TYPES.map(cliType => [
      cliType,
      normalizeCustomCliSettings(partial?.cliSettings?.[cliType]),
    ])
  ) as Record<BuiltinCliType, CustomCliSettings>;
  const legacyApiKey = partial?.apiKey ?? '';
  const apiKeys = normalizeCustomCliApiKeys(partial?.apiKeys, {
    legacyApiKey,
    legacyName: partial?.name,
    legacyGroupMultiplier: partial?.groupMultiplier,
  });
  return {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: '',
    models: [],
    manualModels: [],
    modelPricing: { data: {} },
    lastModelFetch: undefined,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
    routeTargetProtocol: normalizeCliTargetProtocol(partial?.routeTargetProtocol),
    routeTargetProtocolNeedsConfirmation: partial?.routeTargetProtocolNeedsConfirmation ?? false,
    supportedProtocols: normalizedSupportedProtocols,
    cliSettings,
    groupMultiplier: normalizeCustomCliGroupMultiplier(partial?.groupMultiplier),
    apiKeys,
    apiKey: partial?.apiKey ?? apiKeys[0]?.key ?? '',
  };
}

export function normalizeCustomCliApiKeys(
  value: unknown,
  legacy: { legacyApiKey?: unknown; legacyName?: unknown; legacyGroupMultiplier?: unknown } = {}
): CustomCliApiKey[] {
  const items = Array.isArray(value) ? value : [];
  const normalized = items
    .filter(item => item && typeof item === 'object')
    .map((item, index) => {
      const source = item as Partial<CustomCliApiKey>;
      const key = typeof source.key === 'string' ? source.key : '';
      return {
        id: typeof source.id === 'string' && source.id ? source.id : `key_${index}`,
        name: typeof source.name === 'string' ? source.name : '',
        key,
        group: normalizeCircledGroupLabel(source.group),
        groupMultiplier: normalizeCustomCliGroupMultiplier(source.groupMultiplier),
        models: Array.isArray(source.models)
          ? source.models.filter((model): model is string => typeof model === 'string')
          : [],
        lastModelFetch:
          typeof source.lastModelFetch === 'number' ? source.lastModelFetch : undefined,
      };
    });

  const legacyKey = typeof legacy.legacyApiKey === 'string' ? legacy.legacyApiKey : '';
  if (normalized.length === 0 && legacyKey) {
    normalized.push({
      id: 'key_legacy',
      name: typeof legacy.legacyName === 'string' ? legacy.legacyName : '',
      key: legacyKey,
      group: '',
      groupMultiplier: normalizeCustomCliGroupMultiplier(legacy.legacyGroupMultiplier),
      models: [],
      lastModelFetch: undefined,
    });
  }
  return normalized;
}

export function getCustomCliModelGroups(
  apiKeys: readonly CustomCliApiKey[],
  model: string
): string[] {
  const groups = apiKeys
    .filter(apiKey => apiKey.models.includes(model))
    .map(apiKey => normalizeCircledGroupLabel(apiKey.group))
    .filter(Boolean);
  return Array.from(new Set(groups));
}
