/**
 * AnyRouter 相关 IPC handlers
 * 输入: IPC 调用参数（站点ID、账户ID）
 * 输出: 提取的 user hash、批量提取结果
 * 定位: IPC 层 - 处理前端的 AnyRouter hash 提取请求
 */

import { ipcMain } from 'electron';
import { extractUserHash } from '../anyrouter-hash-extractor';
import { unifiedConfigManager } from '../unified-config-manager';
import Logger from '../utils/logger';

const log = Logger.scope('AnyRouterHandlers');

export function registerAnyRouterHandlers() {
  /**
   * 自动提取单个账户的 user hash
   */
  ipcMain.handle(
    'anyrouter:extractUserHash',
    async (
      event,
      args: {
        siteId: string;
        accountId: string;
      }
    ) => {
      log.info('[ExtractHash] Starting extraction for account:', args.accountId);

      const config = unifiedConfigManager.exportConfigSync();
      if (!config) {
        throw new Error('Config not loaded');
      }

      const site = config.sites.find(s => s.id === args.siteId);
      const account = config.accounts.find(a => a.id === args.accountId);

      if (!site) {
        throw new Error(`Site not found: ${args.siteId}`);
      }

      if (!account) {
        throw new Error(`Account not found: ${args.accountId}`);
      }

      try {
        // 提取 hash
        const hash = await extractUserHash(site.url, account.access_token, 'claude-opus-4-6');

        // 保存到当前账户配置
        await unifiedConfigManager.updateAccount(args.accountId, {
          anyRouterConfig: {
            userHash: hash,
          },
        });

        log.info(
          '[ExtractHash] Successfully extracted and saved hash for account:',
          args.accountId
        );

        // 自动填充到同站点的其他账户（只要是同一个站点，就共享 hash）
        const sameTypeAccounts = config.accounts.filter(
          a => a.site_id === args.siteId && a.id !== args.accountId
        );

        let autoFilledCount = 0;

        if (sameTypeAccounts.length > 0) {
          log.info(
            '[ExtractHash] Auto-filling hash to other accounts in same site:',
            sameTypeAccounts.length
          );

          for (const otherAccount of sameTypeAccounts) {
            try {
              await unifiedConfigManager.updateAccount(otherAccount.id, {
                anyRouterConfig: {
                  userHash: hash,
                },
              });
              autoFilledCount++;
              log.info('[ExtractHash] Auto-filled hash for account:', otherAccount.account_name);
            } catch (error: any) {
              log.warn(
                '[ExtractHash] Failed to auto-fill hash for account:',
                otherAccount.account_name,
                error
              );
            }
          }
        }

        return {
          hash,
          autoFilledCount, // 返回自动填充的账户数量
        };
      } catch (error: any) {
        log.error('[ExtractHash] Failed to extract hash:', error);
        throw new Error(`Failed to extract hash: ${error.message}`);
      }
    }
  );

  /**
   * 批量提取站点所有账户的 user hash
   */
  ipcMain.handle(
    'anyrouter:extractAllUserHashes',
    async (
      event,
      args: {
        siteId: string;
      }
    ) => {
      log.info('[ExtractHash] Starting batch extraction for site:', args.siteId);

      const config = unifiedConfigManager.exportConfigSync();
      if (!config) {
        throw new Error('Config not loaded');
      }

      const site = config.sites.find(s => s.id === args.siteId);
      if (!site) {
        throw new Error(`Site not found: ${args.siteId}`);
      }

      const accounts = config.accounts.filter(a => a.site_id === args.siteId);
      const results: Array<{
        accountId: string;
        accountName: string;
        hash?: string;
        error?: string;
      }> = [];

      for (const account of accounts) {
        try {
          log.info('[ExtractHash] Extracting hash for account:', account.account_name);

          const hash = await extractUserHash(site.url, account.access_token, 'claude-opus-4-6');

          await unifiedConfigManager.updateAccount(account.id, {
            anyRouterConfig: { userHash: hash },
          });

          results.push({
            accountId: account.id,
            accountName: account.account_name,
            hash,
          });

          log.info('[ExtractHash] Successfully extracted hash for account:', account.account_name);
        } catch (error: any) {
          log.error(
            '[ExtractHash] Failed to extract hash for account:',
            account.account_name,
            error
          );

          results.push({
            accountId: account.id,
            accountName: account.account_name,
            error: error.message,
          });
        }
      }

      log.info('[ExtractHash] Batch extraction completed:', {
        total: accounts.length,
        success: results.filter(r => r.hash).length,
        failed: results.filter(r => r.error).length,
      });

      return { results };
    }
  );
}
