/**
 * 输入: RouteInstance 集合
 * 输出: 每个实例在同一客户端(agentId)内的稳定父/子序号
 * 定位: 工具层 - 父会话使用主编号，异模型子代理使用持久化副编号
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { RouteInstance } from '../../shared/types/route-proxy';

export interface RouteSessionOrdinal {
  primary: number;
  secondary?: number;
}

export type RouteSessionOrdinalMap = Record<string, RouteSessionOrdinal>;

/**
 * 按 agentId 分组、以 createdAt 升序编号。采用"只追加"语义：
 * 已关闭的会话保留其序号，新会话取更大的号，因此既有卡片的编号永远不会漂移。
 */
export function buildRouteSessionOrdinals(
  instances: Record<string, RouteInstance> | RouteInstance[] | undefined
): RouteSessionOrdinalMap {
  if (!instances) {
    return {};
  }

  const list = Array.isArray(instances) ? instances : Object.values(instances);
  const byId = new Map(list.map(instance => [instance.id, instance]));
  const childParents = new Map<string, RouteInstance>();
  const byAgent = new Map<string, RouteInstance[]>();

  for (const instance of list) {
    const agentId = instance.routeKey?.agentId;
    if (!agentId) {
      continue;
    }
    const parent = instance.parentInstanceId ? byId.get(instance.parentInstanceId) : undefined;
    const hasValidParent =
      parent &&
      parent.id !== instance.id &&
      !parent.parentInstanceId &&
      parent.profileId === instance.profileId &&
      parent.routeKey?.agentId === agentId &&
      Number.isSafeInteger(instance.childOrdinal) &&
      (instance.childOrdinal || 0) > 0;
    if (hasValidParent) {
      childParents.set(instance.id, parent);
      continue;
    }
    byAgent.set(agentId, [...(byAgent.get(agentId) || []), instance]);
  }

  const ordinals: RouteSessionOrdinalMap = {};
  for (const group of byAgent.values()) {
    group
      .slice()
      .sort(
        (left, right) =>
          (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.id.localeCompare(right.id)
      )
      .forEach((instance, index) => {
        ordinals[instance.id] = { primary: index + 1 };
      });
  }

  for (const instance of list) {
    const parent = childParents.get(instance.id);
    const parentOrdinal = parent ? ordinals[parent.id] : undefined;
    if (!parentOrdinal || !instance.childOrdinal) continue;
    ordinals[instance.id] = {
      primary: parentOrdinal.primary,
      secondary: instance.childOrdinal,
    };
  }

  return ordinals;
}

export function formatRouteSessionOrdinal(ordinal: RouteSessionOrdinal): string {
  return `#${ordinal.primary}${ordinal.secondary ? `.${ordinal.secondary}` : ''}`;
}

/** 客户端 + 编号，例如 `Codex #2.1`；无编号时仅显示客户端名称。 */
export function formatRouteSessionLabel(
  displayName: string,
  ordinal: RouteSessionOrdinal | undefined
): string {
  return ordinal === undefined
    ? displayName
    : `${displayName} ${formatRouteSessionOrdinal(ordinal)}`;
}
