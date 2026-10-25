import {
  BUILTIN_CLI_TYPES,
  CLI_TARGET_PROTOCOLS,
  normalizeCliTargetProtocol,
  type CliTargetProtocol,
} from '../../shared/types/cli-config';
import type { RouteCliType } from '../../shared/types/route-proxy';
export function normalizeCliConfigTargetProtocols(
  cliConfig?: Partial<
    Record<RouteCliType, { targetProtocol?: CliTargetProtocol | null } | null>
  > | null
): void {
  if (!cliConfig) {
    return;
  }

  for (const cliType of BUILTIN_CLI_TYPES) {
    const item = cliConfig[cliType];
    if (!item) {
      continue;
    }
    if (
      typeof item.targetProtocol === 'string' &&
      CLI_TARGET_PROTOCOLS.includes(item.targetProtocol as CliTargetProtocol)
    ) {
      item.targetProtocol = normalizeCliTargetProtocol(item.targetProtocol);
    } else {
      delete item.targetProtocol;
    }
  }
}

export function migrateLegacyRouteTargetProtocol(
  owner: {
    routeTargetProtocol?: CliTargetProtocol;
    routeTargetProtocolNeedsConfirmation?: boolean;
  },
  cliConfig?: Partial<
    Record<RouteCliType, { targetProtocol?: CliTargetProtocol | null } | null>
  > | null
): void {
  if (
    typeof owner.routeTargetProtocol === 'string' &&
    CLI_TARGET_PROTOCOLS.includes(owner.routeTargetProtocol)
  ) {
    owner.routeTargetProtocol = normalizeCliTargetProtocol(owner.routeTargetProtocol);
    return;
  }
  const legacyValues = new Set<CliTargetProtocol>();
  for (const cliType of BUILTIN_CLI_TYPES) {
    const value = cliConfig?.[cliType]?.targetProtocol;
    if (typeof value === 'string' && CLI_TARGET_PROTOCOLS.includes(value)) {
      legacyValues.add(normalizeCliTargetProtocol(value));
    }
  }
  if (legacyValues.size === 1) {
    owner.routeTargetProtocol = Array.from(legacyValues)[0];
    owner.routeTargetProtocolNeedsConfirmation = false;
  } else if (legacyValues.size > 1) {
    owner.routeTargetProtocol = 'native';
    owner.routeTargetProtocolNeedsConfirmation = true;
  } else {
    owner.routeTargetProtocol = 'native';
    owner.routeTargetProtocolNeedsConfirmation = false;
  }
}
