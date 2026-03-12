/**
 * 输入: siteId, onAccountSwitch, onAddAccount
 * 输出: 账户选择器下拉菜单（切换 / 添加 / 删除）
 * 定位: 展示层 - SiteCard 内嵌的多账户管理组件
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Plus, User, Trash2, AlertCircle, Loader2 } from 'lucide-react';

interface AccountInfo {
  id: string;
  account_name: string;
  user_id: string;
  username?: string;
  status: string;
  auth_source: string;
}

interface AccountSelectorProps {
  siteId: string;
  onAccountSwitch?: () => void;
  onAddAccount?: () => void;
}

export function AccountSelector({ siteId, onAccountSwitch, onAddAccount }: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!siteId) return;
    try {
      const [listRes, activeRes] = await Promise.all([
        window.electronAPI.accounts?.list(siteId),
        window.electronAPI.accounts?.getActive(siteId),
      ]);
      if (listRes?.success && listRes.data) {
        setAccounts(listRes.data);
      }
      if (activeRes?.success && activeRes.data) {
        setActiveAccount(activeRes.data);
      }
    } catch {
      // ignore
    }
  }, [siteId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 下拉菜单每次展开时刷新列表
  useEffect(() => {
    if (isOpen) {
      loadAccounts();
    }
  }, [isOpen, loadAccounts]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // 定时刷新：添加账号后父组件可能已经更新了 config，这里周期性同步
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      if (!isOpen) loadAccounts();
    }, 5000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [isOpen, loadAccounts]);

  if (accounts.length === 0) return null;
  if (accounts.length <= 1 && !onAddAccount) return null;

  if (accounts.length <= 1 && onAddAccount) {
    return (
      <button
        onClick={e => {
          e.stopPropagation();
          onAddAccount();
        }}
        className="flex items-center text-[11px] text-[var(--ios-blue)] hover:text-[var(--ios-blue)]/80 transition-colors ml-1.5"
        title="添加账户"
      >
        <Plus className="w-3 h-3" />
      </button>
    );
  }

  const handleSwitch = async (accountId: string) => {
    if (switching || accountId === activeAccount?.id) {
      setIsOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await window.electronAPI.accounts?.setActive(siteId, accountId);
      await loadAccounts();
      onAccountSwitch?.();
    } finally {
      setSwitching(false);
      setIsOpen(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    if (deletingId) return;

    const account = accounts.find(a => a.id === accountId);
    const isActive = accountId === activeAccount?.id;
    const confirmMsg = isActive
      ? `确定删除当前活跃账户「${account?.account_name}」吗？删除后将自动切换到其他账户。`
      : `确定删除账户「${account?.account_name}」吗？`;

    if (!window.confirm(confirmMsg)) return;

    setDeletingId(accountId);
    try {
      await window.electronAPI.accounts?.delete(accountId);
      await loadAccounts();
      if (isActive) {
        onAccountSwitch?.();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const accountCount = accounts.length;

  return (
    <div ref={dropdownRef} className="relative inline-flex">
      <button
        onClick={e => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center gap-0.5 text-[11px] text-[var(--ios-blue)] hover:text-[var(--ios-blue)]/80 transition-colors ml-1.5"
        title={`${accountCount} 个账户，点击管理`}
      >
        <User className="w-3 h-3" />
        <span className="max-w-[60px] truncate">{activeAccount?.account_name || '默认'}</span>
        <span className="text-[9px] opacity-60">({accountCount})</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-h-[280px] overflow-y-auto bg-[var(--ios-card-bg)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] shadow-lg">
          {/* 标题栏 */}
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--ios-separator)]">
            账户列表 ({accountCount})
          </div>

          {/* 账户列表 */}
          {accounts.map(account => {
            const isActive = account.id === activeAccount?.id;
            const isDeleting = deletingId === account.id;
            return (
              <div
                key={account.id}
                className={`group flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--ios-blue)]/5 text-[var(--ios-blue)]'
                    : 'text-[var(--text-primary)] hover:bg-[var(--ios-fill)]'
                }`}
              >
                {/* 账户按钮 - 占满左侧 */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleSwitch(account.id);
                  }}
                  disabled={switching || isDeleting}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left disabled:opacity-50"
                >
                  {isActive && (
                    <span className="text-[var(--ios-green)] text-[10px] flex-shrink-0">✓</span>
                  )}
                  <span className={`truncate ${isActive ? 'font-medium' : ''}`}>
                    {account.account_name}
                  </span>
                  {account.status === 'expired' && (
                    <AlertCircle className="w-3 h-3 text-[var(--ios-red)] flex-shrink-0" />
                  )}
                  {account.auth_source === 'isolated_profile' && (
                    <span className="text-[9px] text-[var(--text-tertiary)] flex-shrink-0">
                      隔离
                    </span>
                  )}
                </button>

                {/* 删除按钮 - 右侧，hover 时显示 */}
                {accounts.length > 1 && (
                  <button
                    onClick={e => handleDelete(e, account.id)}
                    disabled={isDeleting}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--ios-red)]/10 transition-all flex-shrink-0"
                    title={`删除账户「${account.account_name}」`}
                  >
                    {isDeleting ? (
                      <Loader2 className="w-3 h-3 animate-spin text-[var(--ios-red)]" />
                    ) : (
                      <Trash2 className="w-3 h-3 text-[var(--ios-red)]" />
                    )}
                  </button>
                )}
              </div>
            );
          })}

          {/* 添加账户 */}
          {onAddAccount && (
            <>
              <div className="border-t border-[var(--ios-separator)]" />
              <button
                onClick={e => {
                  e.stopPropagation();
                  setIsOpen(false);
                  onAddAccount();
                }}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-1.5 text-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/10 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>添加账户</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
