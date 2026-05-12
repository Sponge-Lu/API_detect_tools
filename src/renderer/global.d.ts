/**
 * 全局类型定义 - electronAPI 扩展
 */

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

declare global {
  interface Window {
    electronAPI: any & {
      anyrouter: AnyRouterAPI;
    };
  }
}

export {};
