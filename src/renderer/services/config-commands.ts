import type { Config } from '../../shared/types/renderer-config';
import { currentDataEpoch } from './data-generation';

export async function saveAppConfig(config: Config): Promise<void> {
  const epoch = currentDataEpoch();
  const saved = await window.electronAPI.saveConfig(config);
  if (epoch !== currentDataEpoch()) throw new Error('应用数据已恢复，请重新加载后保存');
  if (saved) Object.assign(config, saved);
}
