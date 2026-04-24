/**
 * 设置独立页面
 * 薄包装层，调用 SettingsPanel asPage 模式
 */

import { SettingsPanel } from '../components/SettingsPanel';
import { useConfigStore } from '../store/configStore';
import { useUIStore } from '../store/uiStore';
import { useUpdate } from '../hooks/useUpdate';
import type { Config } from '../App';
import Logger from '../utils/logger';
import { toast } from '../store/toastStore';
import { sessionEventLog } from '../services/sessionEventLog';

export function SettingsPage() {
  const { config } = useConfigStore();
  const { setActiveTab } = useUIStore();
  const { updateInfo } = useUpdate();

  if (!config) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-secondary)]">
        配置加载中...
      </div>
    );
  }

  const saveConfig = async (newConfig: Config) => {
    try {
      useConfigStore.getState().setSaving(true);
      await window.electronAPI.saveConfig(newConfig);
      useConfigStore.getState().setConfig(newConfig);
      sessionEventLog.success('settings', '应用设置已保存');
    } catch (error) {
      Logger.error('保存配置失败:', error);
      toast.error('保存配置失败: ' + error);
      sessionEventLog.error('settings', '应用设置保存失败');
    } finally {
      useConfigStore.getState().setSaving(false);
    }
  };

  return (
    <SettingsPanel
      asPage
      settings={config.settings}
      config={config}
      onSave={async settings => {
        await saveConfig({ ...config, settings });
        toast.success('设置已保存');
      }}
      onCancel={() => setActiveTab('sites')}
      onImport={async newConfig => {
        await saveConfig(newConfig);
        toast.success('配置已导入');
        sessionEventLog.success('settings', '应用配置已导入');
        setActiveTab('sites');
      }}
      initialUpdateInfo={updateInfo}
    />
  );
}
