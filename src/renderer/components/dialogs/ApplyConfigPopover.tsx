/**
 * 应用配置弹出菜单组件
 * 允许用户选择目标 CLI 并将配置写入对应路径
 */

import { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import type { CliConfig, ApiKeyInfo } from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
} from '../../services/cli-config-generator';
import { toast } from '../../store/toastStore';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface ApplyConfigPopoverProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  cliConfig: CliConfig | null;
  siteUrl: string;
  siteName: string;
  apiKeys: ApiKeyInfo[];
  onClose: () => void;
}

type SupportedCliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliOption {
  key: SupportedCliType;
  name: string;
  icon: string;
}

const CLI_OPTIONS: CliOption[] = [
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon },
  { key: 'codex', name: 'Codex', icon: CodexIcon },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon },
];

/** 获取 API Key 的实际 key 值 */
function getApiKeyValue(apiKey: ApiKeyInfo): string {
  return apiKey.key || apiKey.token || '';
}

/** 获取 API Key 的 ID */
function getApiKeyId(apiKey: ApiKeyInfo): number {
  return apiKey.id ?? apiKey.token_id ?? 0;
}

/**
 * 过滤出有效配置的 CLI 列表
 * 有效配置：apiKeyId 和 model 都不为 null
 */
export function filterValidCliConfigs(
  cliConfig: CliConfig | null,
  supportedTypes: SupportedCliType[] = ['claudeCode', 'codex', 'geminiCli']
): SupportedCliType[] {
  if (!cliConfig) return [];

  return supportedTypes.filter(cliType => {
    const config = cliConfig[cliType];
    return config && config.apiKeyId !== null && config.model !== null;
  });
}

/**
 * 应用配置弹出菜单
 */
export function ApplyConfigPopover({
  isOpen,
  anchorEl,
  cliConfig,
  siteUrl,
  siteName,
  apiKeys,
  onClose,
}: ApplyConfigPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [applyingCli, setApplyingCli] = useState<SupportedCliType | null>(null);

  // 计算弹出菜单位置
  useEffect(() => {
    if (isOpen && anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
  }, [isOpen, anchorEl]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorEl &&
        !anchorEl.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, anchorEl, onClose]);

  // 获取有效配置的 CLI 列表
  const validCliTypes = filterValidCliConfigs(cliConfig);

  // 处理应用配置
  const handleApply = async (cliType: SupportedCliType) => {
    if (!cliConfig || applyingCli) return;

    const config = cliConfig[cliType];
    if (!config || config.apiKeyId === null || config.model === null) return;

    // 查找对应的 API Key
    const apiKey = apiKeys.find(k => getApiKeyId(k) === config.apiKeyId);
    if (!apiKey) {
      toast.error('未找到对应的 API Key');
      return;
    }

    setApplyingCli(cliType);

    try {
      let filesToWrite: { path: string; content: string }[];

      // 优先使用编辑后的配置
      if (config.editedFiles && config.editedFiles.length > 0) {
        filesToWrite = config.editedFiles;
      } else {
        // 否则重新生成配置
        const params = {
          siteUrl,
          siteName,
          apiKey: getApiKeyValue(apiKey),
          model: config.model,
        };

        let generatedConfig;
        if (cliType === 'claudeCode') {
          generatedConfig = generateClaudeCodeConfig(params);
        } else if (cliType === 'codex') {
          generatedConfig = generateCodexConfig(params);
        } else {
          generatedConfig = generateGeminiCliConfig(params);
        }
        filesToWrite = generatedConfig.files.map(f => ({
          path: f.path,
          content: f.content,
        }));
      }

      // 调用 IPC 写入配置文件
      const result = await (window.electronAPI as any).cliCompat.writeConfig({
        cliType,
        files: filesToWrite,
        applyMode: config.applyMode || 'merge',
      });

      if (result.success) {
        const pathsStr = result.writtenPaths.join(', ');
        toast.success(`配置已写入: ${pathsStr}`);

        // Claude Code 配置应用后提醒用户重启 IDE
        if (cliType === 'claudeCode') {
          setTimeout(() => {
            toast.info('使用 Claude Code for VS Code 需重启 IDE 编辑器');
          }, 1500);
        }

        onClose();
      } else {
        toast.error(`写入失败: ${result.error || '未知错误'}`);
      }
    } catch (error: any) {
      toast.error(`应用配置失败: ${error.message || '未知错误'}`);
    } finally {
      setApplyingCli(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      {validCliTypes.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>没有可应用的配置</span>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            选择要应用的 CLI 配置
          </div>
          {CLI_OPTIONS.filter(opt => validCliTypes.includes(opt.key)).map(option => {
            const isApplying = applyingCli === option.key;
            return (
              <button
                key={option.key}
                onClick={() => handleApply(option.key)}
                disabled={applyingCli !== null}
                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <img src={option.icon} alt={option.name} className="w-5 h-5" />
                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 text-left">
                  {option.name}
                </span>
                {isApplying ? (
                  <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100" />
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
