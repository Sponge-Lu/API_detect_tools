import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

export class ConfigManager {
  private configPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'config.json');
  }

  async loadConfig(): Promise<any> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // 返回默认配置
      const defaultConfig = {
        sites: [{
          name: '示例站点',
          url: 'https://api.example.com',
          api_key: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
          system_token: '',
          user_id: '',
          enabled: false,
          has_checkin: false
        }],
        settings: {
          timeout: 10,
          concurrent: true,
          show_disabled: false,
          auto_refresh: false,
          refresh_interval: 30
        }
      };
      await this.saveConfig(defaultConfig);
      return defaultConfig;
    }
  }

  async saveConfig(config: any): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}