/**
 * 输入: ApplyConfigPopoverProps (CLI 配置、API Keys、兼容性数据), configStore (应用配置), detectionStore (CLI 配置检测)
 * 输出: React 组件 (应用配置弹出菜单 UI)
 * 定位: 展示层 - 应用配置弹出菜单，允许用户选择目标 CLI 并写入配置，应用后自动刷新 CLI 配置检测状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CliConfig, ApiKeyInfo } from '../../../shared/types/cli-config';
import type { CliCompatibilityData } from '../../../shared/types/site';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
} from '../../services/cli-config-generator';
import { toast } from '../../store/toastStore';
import { useDetectionStore } from '../../store/detectionStore';
import { useConfigStore } from '../../store/configStore';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface ApplyConfigPopoverProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  cliConfig: CliConfig | null;
  cliCompatibility?: CliCompatibilityData | null; // CLI 兼容性测试结果
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
  cliCompatibility,
  siteUrl,
  siteName,
  apiKeys,
  onClose,
}: ApplyConfigPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [applyingCli, setApplyingCli] = useState<SupportedCliType | null>(null);
  const [isPositioned, setIsPositioned] = useState(false);

  // 获取 CLI 配置检测相关方法 (Requirements 6.2)
  const { clearCliConfigDetection, detectCliConfig } = useDetectionStore();
  const { config: appConfig } = useConfigStore();

  // 计算弹出菜单位置（自动检测空间，向上或向下展开）
  useEffect(() => {
    if (isOpen && anchorEl) {
      // 先设置初始位置（向下展开）
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left,
      });
      setIsPositioned(false);

      // 等待下一帧，获取实际弹框高度后调整位置
      requestAnimationFrame(() => {
        if (popoverRef.current) {
          const popoverRect = popoverRef.current.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const spaceBelow = viewportHeight - rect.bottom;
          const spaceAbove = rect.top;

          // 如果下方空间不足且上方空间更大，则向上展开
          if (spaceBelow < popoverRect.height + 16 && spaceAbove > spaceBelow) {
            setPosition({
              top: rect.top - popoverRect.height - 8,
              left: rect.left,
            });
          }
          setIsPositioned(true);
        }
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
  const handleApply = async (cliType: SupportedCliType, applyMode: 'merge' | 'overwrite') => {
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
          // 传递 codexDetail 用于生成测试结果注释
          generatedConfig = generateCodexConfig({
            ...params,
            codexDetail: cliCompatibility?.codexDetail,
          });
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
        applyMode,
      });

      if (result.success) {
        const pathsStr = result.writtenPaths.join(', ');
        toast.success(`配置已写入: ${pathsStr}`);

        // 配置应用后自动刷新 CLI 配置检测 (Requirements 6.2)
        // 先清除后端缓存，再清除前端状态并重新检测
        try {
          await window.electronAPI.configDetection.clearCache();
        } catch (error) {
          console.error('清除 CLI 配置缓存失败:', error);
        }
        clearCliConfigDetection();

        // 从 configStore 获取站点列表（而不是检测结果）
        const siteInfos = (appConfig?.sites || [])
          .filter((s: { url?: string }) => s.url)
          .map((s: { name: string; url?: string }) => ({
            id: s.name,
            name: s.name,
            url: s.url!,
          }));
        // 即使没有站点也执行检测，以更新 CLI 配置状态
        detectCliConfig(siteInfos).catch(error => {
          console.error('CLI 配置检测刷新失败:', error);
        });

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
      className={`fixed z-50 min-w-[180px] rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-1 shadow-[var(--shadow-xl)] transition-opacity duration-100 ${
        isPositioned ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ top: position.top, left: position.left }}
    >
      {validCliTypes.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--text-secondary)]">
          <AlertCircle className="h-4 w-4" />
          <span>没有可应用的配置</span>
        </div>
      ) : (
        <>
          <div className="border-b border-[var(--line-soft)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            选择要应用的 CLI 以及写入方式
          </div>
          {CLI_OPTIONS.filter(opt => validCliTypes.includes(opt.key)).map(option => {
            const isApplying = applyingCli === option.key;
            return (
              <div
                key={option.key}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
              >
                <img src={option.icon} alt={option.name} className="w-5 h-5" />
                <span className="flex-1 text-left text-sm text-[var(--text-primary)]">
                  {option.name}
                </span>
                {isApplying ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
                ) : (
                  <div className="flex items-center overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)]">
                    <button
                      type="button"
                      onClick={() => handleApply(option.key, 'merge')}
                      disabled={applyingCli !== null}
                      className="px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      合并
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApply(option.key, 'overwrite')}
                      disabled={applyingCli !== null}
                      className="border-l border-[var(--line-soft)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      覆盖
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
