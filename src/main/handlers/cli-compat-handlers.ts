/**
 * CLI 兼容性测试相关 IPC 处理器
 */

import { ipcMain } from 'electron';
import { cliCompatService, CliCompatibilityResult } from '../cli-compat-service';
import { unifiedConfigManager } from '../unified-config-manager';
import Logger from '../utils/logger';

const log = Logger.scope('CliCompatHandlers');

interface CliTestConfig {
  cliType: 'claudeCode' | 'codex' | 'geminiCli' | 'chat';
  apiKey: string;
  model: string;
}

interface TestWithConfigParams {
  siteUrl: string;
  configs: CliTestConfig[];
}

/**
 * 注册 CLI 兼容性测试相关的 IPC 处理器
 */
export function registerCliCompatHandlers() {
  // 使用配置测试 CLI 兼容性
  ipcMain.handle('cli-compat:test-with-config', async (_, params: TestWithConfigParams) => {
    try {
      log.info(`Testing CLI compatibility for site: ${params.siteUrl}`);

      const results: Partial<CliCompatibilityResult> = {
        claudeCode: null,
        codex: null,
        geminiCli: null,
        chat: null,
      };

      // 并发测试所有配置的 CLI
      await Promise.all(
        params.configs.map(async config => {
          try {
            let success = false;

            switch (config.cliType) {
              case 'claudeCode':
                success = await cliCompatService.testClaudeCode(
                  params.siteUrl,
                  config.apiKey,
                  config.model
                );
                results.claudeCode = success;
                break;
              case 'codex':
                success = await cliCompatService.testCodex(
                  params.siteUrl,
                  config.apiKey,
                  config.model
                );
                results.codex = success;
                break;
              case 'geminiCli':
                success = await cliCompatService.testGeminiCli(
                  params.siteUrl,
                  config.apiKey,
                  config.model
                );
                results.geminiCli = success;
                break;
              case 'chat':
                success = await cliCompatService.testChat(
                  params.siteUrl,
                  config.apiKey,
                  config.model
                );
                results.chat = success;
                break;
            }

            log.info(`CLI test ${config.cliType}: ${success ? 'passed' : 'failed'}`);
          } catch (error: any) {
            log.warn(`CLI test ${config.cliType} error: ${error.message}`);
            results[config.cliType] = false;
          }
        })
      );

      return { success: true, data: results };
    } catch (error: any) {
      log.error(`CLI compatibility test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 保存 CLI 兼容性结果到缓存
  ipcMain.handle(
    'cli-compat:save-result',
    async (_, siteUrl: string, result: CliCompatibilityResult) => {
      try {
        log.info(`Saving CLI compatibility result for site: ${siteUrl}`);

        const site = unifiedConfigManager.getSiteByUrl(siteUrl);
        if (!site) {
          log.warn(`Site not found for URL: ${siteUrl}`);
          return { success: false, error: 'Site not found' };
        }

        // 更新站点的 cached_data，添加 cli_compatibility
        const currentCachedData = site.cached_data || {
          models: [],
          last_refresh: Date.now(),
        };

        await unifiedConfigManager.updateSite(site.id, {
          cached_data: {
            ...currentCachedData,
            cli_compatibility: {
              claudeCode: result.claudeCode,
              codex: result.codex,
              geminiCli: result.geminiCli,
              chat: result.chat,
              testedAt: result.testedAt,
              error: result.error,
            },
          },
        });

        log.info(`CLI compatibility result saved for ${siteUrl}`);
        return { success: true };
      } catch (error: any) {
        log.error(`Failed to save CLI compatibility result: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  );

  // 保存 CLI 配置到站点配置（不是 cached_data，这样备份时不会丢失）
  ipcMain.handle('cli-compat:save-config', async (_, siteUrl: string, cliConfig: any) => {
    try {
      log.info(`Saving CLI config for site: ${siteUrl}`);

      const site = unifiedConfigManager.getSiteByUrl(siteUrl);
      if (!site) {
        log.warn(`Site not found for URL: ${siteUrl}`);
        return { success: false, error: 'Site not found' };
      }

      // 直接更新站点的 cli_config 字段（不是 cached_data）
      await unifiedConfigManager.updateSite(site.id, {
        cli_config: cliConfig,
      });

      log.info(`CLI config saved for ${siteUrl}`);
      return { success: true };
    } catch (error: any) {
      log.error(`Failed to save CLI config: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  log.info('CLI compatibility handlers registered');
}
