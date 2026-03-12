/**
 * 输入: EditCliConfigDialogProps (open, onClose, onSaveComplete)
 * 输出: React 组件 (CLI 配置文件编辑对话框)
 * 定位: 展示层 - 读取并直接编辑本地 CLI 配置文件
 */

import { useState, useEffect, useCallback } from 'react';
import { FileEdit, Loader2, Save } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import type { CliType } from '../../../shared/types/config-detection';
import { toast } from '../../store/toastStore';

import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

interface EditCliConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSaveComplete?: () => void;
}

interface ConfigFileInfo {
  key: string;
  relativePath: string;
  absolutePath: string;
  content: string | null;
  exists: boolean;
}

interface CliTab {
  key: CliType;
  name: string;
  icon: string;
}

const CLI_TABS: CliTab[] = [
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon },
  { key: 'codex', name: 'Codex', icon: CodexIcon },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon },
];

export function EditCliConfigDialog({ open, onClose, onSaveComplete }: EditCliConfigDialogProps) {
  const [activeCli, setActiveCli] = useState<CliType>('claudeCode');
  const [files, setFiles] = useState<ConfigFileInfo[]>([]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [editedContents, setEditedContents] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadFiles = useCallback(async (cliType: CliType) => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.configDetection.readCliConfigFiles(cliType);
      if (result.success) {
        setFiles(result.files);
        setActiveFileIdx(0);
        // 初始化编辑内容
        const map = new Map<string, string>();
        for (const f of result.files) {
          map.set(f.absolutePath, f.content ?? '');
        }
        setEditedContents(map);
      } else {
        toast.error('读取配置文件失败');
        setFiles([]);
      }
    } catch {
      toast.error('读取配置文件失败');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadFiles(activeCli);
  }, [open, activeCli, loadFiles]);

  const currentFile = files[activeFileIdx];
  const currentContent = currentFile ? (editedContents.get(currentFile.absolutePath) ?? '') : '';

  const hasChanges = files.some(f => {
    const edited = editedContents.get(f.absolutePath);
    const original = f.content ?? '';
    return edited !== undefined && edited !== original;
  });

  const handleContentChange = (value: string) => {
    if (!currentFile) return;
    setEditedContents(prev => new Map(prev).set(currentFile.absolutePath, value));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      let saved = 0;
      for (const f of files) {
        const edited = editedContents.get(f.absolutePath);
        const original = f.content ?? '';
        if (edited !== undefined && edited !== original) {
          const res = await window.electronAPI.configDetection.saveCliConfigFile(
            f.absolutePath,
            edited
          );
          if (!res.success) {
            toast.error(`保存 ${f.relativePath} 失败: ${res.error}`);
            return;
          }
          saved++;
        }
      }
      if (saved > 0) {
        toast.success(`已保存 ${saved} 个配置文件`);
      }
      onClose();
      onSaveComplete?.();
    } catch {
      toast.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isSaving) return;
    onClose();
  };

  return (
    <IOSModal
      isOpen={open}
      onClose={handleClose}
      title="编辑 CLI 配置"
      titleIcon={<FileEdit className="w-5 h-5" />}
      size="lg"
      showCloseButton={!isSaving}
    >
      <div className="space-y-3">
        {/* CLI 选择标签 */}
        <div className="flex gap-1 p-1 bg-[var(--ios-bg-tertiary)] rounded-[var(--radius-md)]">
          {CLI_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveCli(tab.key);
                setActiveFileIdx(0);
              }}
              className={`flex items-center gap-1.5 flex-1 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
                activeCli === tab.key
                  ? 'bg-[var(--ios-bg-secondary)] text-[var(--ios-text-primary)] shadow-sm'
                  : 'text-[var(--ios-text-secondary)] hover:text-[var(--ios-text-primary)]'
              }`}
            >
              <img src={tab.icon} alt="" className="w-3.5 h-3.5" />
              {tab.name}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ios-text-secondary)]" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--ios-text-secondary)]">
            无配置文件
          </div>
        ) : (
          <>
            {/* 文件标签 */}
            {files.length > 1 && (
              <div className="flex gap-1 border-b border-[var(--ios-separator)]">
                {files.map((f, idx) => (
                  <button
                    key={f.key}
                    onClick={() => setActiveFileIdx(idx)}
                    className={`px-3 py-1.5 text-xs font-mono transition-colors border-b-2 -mb-px ${
                      idx === activeFileIdx
                        ? 'border-[var(--ios-blue)] text-[var(--ios-blue)]'
                        : 'border-transparent text-[var(--ios-text-secondary)] hover:text-[var(--ios-text-primary)]'
                    }`}
                  >
                    {f.relativePath.split('/').pop()}
                    {!f.exists && (
                      <span className="ml-1 text-[var(--ios-text-tertiary)]">(新)</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* 文件路径 */}
            {currentFile && (
              <div className="text-[10px] font-mono text-[var(--ios-text-tertiary)] px-1">
                {currentFile.relativePath}
              </div>
            )}

            {/* 编辑区 */}
            <textarea
              value={currentContent}
              onChange={e => handleContentChange(e.target.value)}
              spellCheck={false}
              className="w-full h-64 p-3 font-mono text-xs leading-relaxed bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] resize-y text-[var(--ios-text-primary)] focus:outline-none focus:border-[var(--ios-blue)] focus:ring-1 focus:ring-[var(--ios-blue)]"
              placeholder={currentFile?.exists ? '' : '文件不存在，输入内容后保存将自动创建'}
            />
          </>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-[var(--ios-text-secondary)] bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] hover:bg-[var(--ios-bg-secondary)] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--ios-blue)] rounded-[var(--radius-md)] hover:bg-[var(--ios-blue)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存
              </>
            )}
          </button>
        </div>
      </div>
    </IOSModal>
  );
}
