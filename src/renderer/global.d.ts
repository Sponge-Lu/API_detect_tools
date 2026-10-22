/**
 * 全局类型定义 - electronAPI 扩展
 */

import type {
  DshActionResult,
  DshRollbackResult,
  DshRoutingStatus,
  DshSessionMigrationResult,
  EnableDshSessionRoutingInput,
  EnableDshSessionRoutingResult,
} from '../shared/types/dsh-integration';

interface AnyRouterAPI {
  extractUserHash: (params: { siteId: string; accountId: string }) => Promise<{ hash: string }>;
  extractAllUserHashes: (params: { siteId: string }) => Promise<{
    results: Array<{
      accountId: string;
      accountName: string;
      hash?: string;
      error?: string;
    }>;
  }>;
}

interface DshIntegrationAPI {
  status: () => Promise<DshActionResult<DshRoutingStatus>>;
  enable: (
    input: EnableDshSessionRoutingInput
  ) => Promise<DshActionResult<EnableDshSessionRoutingResult>>;
  rollback: () => Promise<DshActionResult<DshRollbackResult>>;
  migrateSessions: () => Promise<DshActionResult<DshSessionMigrationResult>>;
}

declare global {
  interface Window {
    electronAPI: any & {
      anyrouter: AnyRouterAPI;
      dshIntegration: DshIntegrationAPI;
    };
  }
}

export {};
