/**
 * 添加接入点对话框
 * 统一入口：托管站点（智能添加 + 手动添加）/ 直连配置
 *
 * 功能：
 * - 提供托管站点和直连配置两种添加方式
 * - 检测站点 URL 是否已存在
 * - 已存在站点时提示用户选择「添加账号」或「取消」
 * - 确认后自动执行添加账号（无需用户再次操作）
 */

import { AppModal } from '../AppModal/AppModal';
import { AppCard } from '../AppCard';
import { AppButton } from '../AppButton/AppButton';
import { Zap, Edit3, Plus } from 'lucide-react';

interface AddAccessPointDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSmartAdd: () => void;
  onManualAdd: () => void;
  onAddDirectConfig: () => void;
}

export function AddAccessPointDialog({
  isOpen,
  onClose,
  onSmartAdd,
  onManualAdd,
  onAddDirectConfig,
}: AddAccessPointDialogProps) {
  return (
    <AppModal isOpen={isOpen} onClose={onClose} title="添加接入点" size="xl">
      <div className="p-6">
        <div className="grid grid-cols-2 gap-6">
          {/* 左卡：托管站点 */}
          <AppCard className="p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">托管站点</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                通过 One API / New API 等中转站点接入
              </p>
            </div>

            <div className="space-y-3">
              <AppButton
                variant="primary"
                onClick={() => {
                  onClose();
                  onSmartAdd();
                }}
                className="w-full justify-start"
              >
                <Zap className="w-4 h-4" />
                智能添加
              </AppButton>

              <AppButton
                variant="secondary"
                onClick={() => {
                  onClose();
                  onManualAdd();
                }}
                className="w-full justify-start"
              >
                <Edit3 className="w-4 h-4" />
                手动添加
              </AppButton>
            </div>

            <div className="pt-2 border-t border-[var(--line-soft)]">
              <p className="text-xs text-[var(--text-tertiary)]">
                智能添加：自动登录并获取站点信息
                <br />
                手动添加：手动填写站点配置
              </p>
            </div>
          </AppCard>

          {/* 右卡：直连配置 */}
          <AppCard className="p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">直连配置</h3>
              <p className="text-sm text-[var(--text-secondary)]">直接配置 API 端点，无需中转站</p>
            </div>

            <div className="space-y-3">
              <AppButton
                variant="primary"
                onClick={() => {
                  onClose();
                  onAddDirectConfig();
                }}
                className="w-full justify-start"
              >
                <Plus className="w-4 h-4" />
                新建直连配置
              </AppButton>
            </div>

            <div className="pt-2 border-t border-[var(--line-soft)]">
              <p className="text-xs text-[var(--text-tertiary)]">
                适用于 Claude Code、Codex、Gemini CLI 等工具的直连 API 配置
              </p>
            </div>
          </AppCard>
        </div>
      </div>
    </AppModal>
  );
}
