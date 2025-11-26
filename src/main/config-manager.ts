import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { backupManager } from './backup-manager';

export class ConfigManager {
  private configPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'config.json');
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath(): string {
    return this.configPath;
  }

  async loadConfig(): Promise<any> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(data);

      let changed = false;

      // 确保 sites 字段始终为数组
      if (!Array.isArray(config.sites)) {
        config.sites = [];
        changed = true;
      }

      // 兼容旧版本：为缺失的 settings 字段补全默认值
      if (!config.settings) {
        config.settings = {
          timeout: 10,
          concurrent: true,
          show_disabled: false,
          auto_refresh: false,
          refresh_interval: 30,
          browser_path: ''
        };
        changed = true;
      } else {
        // 补全可能新增的 settings 字段
        if (typeof config.settings.timeout !== 'number') {
          config.settings.timeout = 10;
          changed = true;
        }
        if (typeof config.settings.concurrent !== 'boolean') {
          config.settings.concurrent = true;
          changed = true;
        }
        if (typeof config.settings.show_disabled !== 'boolean') {
          config.settings.show_disabled = false;
          changed = true;
        }
        if (typeof config.settings.auto_refresh !== 'boolean') {
          config.settings.auto_refresh = false;
          changed = true;
        }
        if (typeof config.settings.refresh_interval !== 'number') {
          config.settings.refresh_interval = 30;
          changed = true;
        }
        if (typeof config.settings.browser_path !== 'string') {
          config.settings.browser_path = '';
          changed = true;
        }
      }

      // 新增：站点分组配置兼容处理
      if (!Array.isArray(config.siteGroups) || config.siteGroups.length === 0) {
        config.siteGroups = [
          {
            id: 'default',
            name: '默认分组'
          }
        ];
        changed = true;
      } else {
        // 确保存在默认分组（id = "default"）
        const hasDefaultGroup = config.siteGroups.some(
          (g: any) => g && g.id === 'default'
        );
        if (!hasDefaultGroup) {
          config.siteGroups.unshift({
            id: 'default',
            name: '默认分组'
          });
          changed = true;
        }
      }

      // 为每个站点补全 group 字段，默认归入 "default" 分组
      let sitesChanged = false;
      const normalizedSites = (config.sites as any[]).map((site) => {
        if (!site || typeof site !== 'object') return site;
        if (!site.group) {
          sitesChanged = true;
          return { ...site, group: 'default' };
        }
        return site;
      });
      if (sitesChanged) {
        config.sites = normalizedSites;
        changed = true;
      }

      // 如有结构被修正，则回写配置文件，避免重复迁移
      if (changed) {
        await this.saveConfig(config);
      }

      return config;
    } catch (error: any) {
      // 仅当配置文件不存在时才创建默认配置
      // 如果是 JSON 解析错误或其他错误，打印日志但不覆盖原文件
      console.error('❌ [ConfigManager] 加载配置失败:', error?.message || error);

      // 检查是否是文件不存在的错误
      const isFileNotFound = error?.code === 'ENOENT';

      if (isFileNotFound) {
        console.log('📝 [ConfigManager] 配置文件不存在，创建默认配置...');
        const defaultConfig = {
          sites: [{
            name: '示例站点',
            url: 'https://api.example.com',
            api_key: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
            system_token: '',
            user_id: '',
            enabled: false,
            has_checkin: false,
            group: 'default'
          }],
          settings: {
            timeout: 10,
            concurrent: true,
            show_disabled: false,
            auto_refresh: false,
            refresh_interval: 30,
            browser_path: ''
          },
          siteGroups: [
            {
              id: 'default',
              name: '默认分组'
            }
          ]
        };
        await this.saveConfig(defaultConfig);
        return defaultConfig;
      } else {
        // 其他错误（如 JSON 解析失败）：返回空配置但不覆盖文件，避免数据丢失
        console.error('⚠️ [ConfigManager] 配置文件可能已损坏，返回空配置（不覆盖原文件）');
        return {
          sites: [],
          settings: {
            timeout: 10,
            concurrent: true,
            show_disabled: false,
            auto_refresh: false,
            refresh_interval: 30,
            browser_path: ''
          },
          siteGroups: [
            {
              id: 'default',
              name: '默认分组'
            }
          ]
        };
      }
    }
  }

  async saveConfig(config: any): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    // 保存后自动备份
    try {
      await backupManager.backupFile(this.configPath);
    } catch (error) {
      console.error('⚠️ [ConfigManager] 自动备份失败:', error);
      // 备份失败不影响保存操作
    }
  }
}