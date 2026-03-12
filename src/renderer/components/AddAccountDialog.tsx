/**
 * 输入: siteId, siteName, siteUrl, onSuccess, onClose
 * 输出: 添加账户对话框（启动隔离浏览器登录 → 保存凭证）
 * 定位: 展示层 - 多账户添加流程 UI
 */

import { useState, useEffect } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { IOSModal } from './IOSModal';
import { IOSInput } from './IOSInput';
import { toast } from '../store/toastStore';

interface AddAccountDialogProps {
  isOpen: boolean;
  siteId: string;
  siteName: string;
  siteUrl: string;
  onSuccess: () => void;
  onClose: () => void;
}

type FlowStep = 'idle' | 'launching' | 'waiting' | 'saving' | 'done';

export function AddAccountDialog({
  isOpen,
  siteId,
  siteName,
  siteUrl,
  onSuccess,
  onClose,
}: AddAccountDialogProps) {
  const [accountName, setAccountName] = useState('');
  const [step, setStep] = useState<FlowStep>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  // 生成临时 accountId
  const [accountId] = useState(() => crypto.randomUUID());

  // 监听后端状态消息
  useEffect(() => {
    if (!isOpen) return;
    const cleanup = (window.electronAPI as any).onSiteInitStatus?.((status: string) => {
      setStatusMessage(status);
    });
    return () => cleanup?.();
  }, [isOpen]);

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setAccountName('');
      setStep('idle');
      setStatusMessage('');
      setError('');
    }
  }, [isOpen]);

  const handleStart = async () => {
    if (!accountName.trim()) {
      setError('请输入账户名称');
      return;
    }

    setError('');
    setStep('launching');
    setStatusMessage('正在准备隔离浏览器...');

    try {
      // 启动隔离浏览器登录
      setStep('waiting');
      setStatusMessage('浏览器已启动，请在浏览器中登录...');

      const loginResult = await window.electronAPI.browserProfile?.loginIsolated(
        siteId,
        siteUrl,
        accountId
      );

      if (!loginResult?.success || !loginResult.data) {
        throw new Error(loginResult?.error || '登录失败');
      }

      // 保存账户凭证
      setStep('saving');
      setStatusMessage('正在保存账户信息...');

      const { userId, username, accessToken, authSource, profilePath } = loginResult.data;

      const addResult = await window.electronAPI.accounts?.add({
        site_id: siteId,
        account_name: accountName.trim(),
        user_id: String(userId),
        username,
        access_token: accessToken,
        auth_source: authSource,
        browser_profile_path: profilePath,
      });

      if (!addResult?.success) {
        throw new Error(addResult?.error || '保存账户失败');
      }

      setStep('done');
      toast.success(`账户「${accountName.trim()}」添加成功`);

      // 关闭浏览器
      try {
        await window.electronAPI.closeBrowser?.();
      } catch {
        // ignore
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setStep('idle');
      setStatusMessage('');
    }
  };

  const isProcessing = step !== 'idle' && step !== 'done';

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={isProcessing ? () => {} : onClose}
      title={`添加账户 - ${siteName}`}
      titleIcon={<UserPlus className="w-5 h-5" />}
    >
      <div className="p-5 space-y-4">
        <IOSInput
          label="账户名称"
          value={accountName}
          onChange={e => setAccountName(e.target.value)}
          placeholder="例: 小号、备用号"
          disabled={isProcessing}
          error={!!error && step === 'idle'}
          errorMessage={step === 'idle' ? error : undefined}
        />

        {/* 状态提示 */}
        {isProcessing && (
          <div className="flex items-center gap-2 text-sm text-[var(--ios-blue)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* 错误提示（非 idle 阶段） */}
        {error && step === 'idle' && !accountName && null}
        {error && step !== 'idle' && <div className="text-sm text-[var(--ios-red)]">{error}</div>}

        <p className="text-xs text-[var(--text-secondary)]">
          将启动独立浏览器窗口（含主浏览器插件），请用新账号登录站点。
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--ios-separator)] hover:bg-[var(--ios-fill)] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleStart}
            disabled={isProcessing || !accountName.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--ios-blue)] text-white hover:bg-[var(--ios-blue)]/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                处理中...
              </>
            ) : (
              '启动浏览器登录'
            )}
          </button>
        </div>
      </div>
    </IOSModal>
  );
}
