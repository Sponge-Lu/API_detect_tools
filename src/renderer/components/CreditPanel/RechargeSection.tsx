/**
 * 输入: 站点列表 (支持 LDC 支付的站点), 可用余额, 充值方法
 * 输出: React 组件 (LDC 充值区域 UI)
 * 定位: 展示层 - 提供 LDC 充值功能，包括金额输入、站点选择、所需积分计算
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreditPanel/FOLDER_INDEX.md
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useMemo } from 'react';
import { Wallet, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { toast } from '../../store/toastStore';
import type { RechargeResponse } from '../../../shared/types/credit';

/**
 * 支持 LDC 支付的站点信息
 */
export interface LdcSiteInfo {
  /** 站点名称 */
  name: string;
  /** 站点 URL */
  url: string;
  /** LDC 兑换比例 (如 "10.00" 表示 10 LDC = 1 站点余额) */
  exchangeRate: string;
  /** 站点认证 token */
  token?: string;
  /** 用户 ID（用于 User-ID headers） */
  userId?: string;
  /** 支付方式类型，如 "epay" */
  paymentType?: string;
}

export interface RechargeSectionProps {
  /** 支持 LDC 支付的站点列表 */
  ldcSites: LdcSiteInfo[];
  /** 当前可用 LDC 余额 */
  availableBalance: number;
  /** 是否正在充值 */
  isRecharging: boolean;
  /** 发起充值方法 */
  onRecharge: (
    siteUrl: string,
    amount: number,
    token: string,
    userId?: string,
    paymentType?: string
  ) => Promise<RechargeResponse>;
}

/**
 * LDC 充值区域组件
 * 提供充值金额输入、站点选择、所需积分计算等功能
 *
 * Requirements: 18.1-18.15
 */
export function RechargeSection({
  ldcSites,
  availableBalance,
  isRecharging,
  onRecharge,
}: RechargeSectionProps) {
  // 充值金额
  const [amount, setAmount] = useState<string>('');
  // 选中的站点 URL
  const [selectedSiteUrl, setSelectedSiteUrl] = useState<string>('');

  // 获取选中的站点信息
  const selectedSite = useMemo(() => {
    return ldcSites.find(site => site.url === selectedSiteUrl);
  }, [ldcSites, selectedSiteUrl]);

  // 计算所需 LDC 积分 (Property 28: Required Credits Calculation)
  const requiredCredits = useMemo(() => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0 || !selectedSite) {
      return 0;
    }
    const rate = parseFloat(selectedSite.exchangeRate) || 0;
    return amountNum * rate;
  }, [amount, selectedSite]);

  // 检查余额是否充足 (Property 30: Insufficient Balance Warning)
  const isBalanceInsufficient = requiredCredits > 0 && requiredCredits > availableBalance;

  // 检查充值按钮是否应该禁用 (Property 29: Recharge Button Disabled State)
  const isRechargeDisabled = useMemo(() => {
    const amountNum = parseFloat(amount);
    return isRecharging || !selectedSiteUrl || isNaN(amountNum) || amountNum <= 0;
  }, [isRecharging, selectedSiteUrl, amount]);

  /**
   * 处理充值
   */
  const handleRecharge = async () => {
    if (!selectedSite) {
      toast.error('请选择站点');
      return;
    }

    if (!selectedSite.token) {
      toast.error('站点认证 token 不可用，请重新登录站点');
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('请输入有效的充值金额');
      return;
    }

    try {
      // 提示用户浏览器窗口即将打开
      toast.info('正在打开浏览器，如需登录请在浏览器中完成...');

      const result = await onRecharge(
        selectedSite.url,
        amountNum,
        selectedSite.token,
        selectedSite.userId,
        selectedSite.paymentType
      );
      if (result.success) {
        toast.success('已打开支付页面，请在浏览器中完成支付');
        // 清空输入
        setAmount('');
      } else if (result.needLogin) {
        // 需要用户登录
        toast.warning(result.loginMessage || '请在弹出的浏览器窗口中登录站点');
      } else {
        toast.error(result.error || '充值失败');
      }
    } catch (err: any) {
      toast.error(err?.message || '充值失败');
    }
  };

  // 如果没有支持 LDC 支付的站点，显示提示
  if (ldcSites.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-light-text-secondary dark:text-dark-text-secondary">
          <Wallet className="w-4 h-4" />
          <span>LDC 充值 - 暂无支持 LDC 支付的站点</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm">
      {/* 一行布局：标题 | 站点选择 | 金额输入 | 充值按钮 */}
      <div className="flex items-center gap-3">
        {/* 标题 */}
        <div className="flex items-center gap-1.5 text-sm font-medium text-light-text dark:text-dark-text flex-shrink-0">
          <Wallet className="w-4 h-4 text-primary-500" />
          <span>LDC 充值</span>
        </div>

        {/* 站点选择 */}
        <select
          value={selectedSiteUrl}
          onChange={e => setSelectedSiteUrl(e.target.value)}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none text-light-text dark:text-dark-text"
        >
          <option value="">选择站点</option>
          {ldcSites.map(site => (
            <option key={site.url} value={site.url}>
              {site.name} ({site.exchangeRate}:1)
            </option>
          ))}
        </select>

        {/* 金额输入 */}
        <input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="金额"
          className="w-20 px-2.5 py-1.5 text-sm bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none text-light-text dark:text-dark-text"
        />

        {/* 所需积分显示 */}
        {requiredCredits > 0 && (
          <span
            className={`text-sm flex-shrink-0 ${isBalanceInsufficient ? 'text-red-500' : 'text-primary-600 dark:text-primary-400'}`}
          >
            需 {requiredCredits.toFixed(2)} LDC
          </span>
        )}

        {/* 充值按钮 */}
        <button
          onClick={handleRecharge}
          disabled={isRechargeDisabled}
          className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:disabled:bg-primary-700 text-white rounded-lg transition-all flex items-center gap-1.5 text-sm font-medium disabled:cursor-not-allowed flex-shrink-0"
        >
          {isRecharging ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <ExternalLink className="w-3 h-3" />
          )}
          充值
        </button>
      </div>

      {/* 余额不足警告 */}
      {isBalanceInsufficient && (
        <div className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400 mt-2">
          <AlertTriangle className="w-3 h-3" />
          <span>余额不足 (可用: {availableBalance.toFixed(2)} LDC)</span>
        </div>
      )}
    </div>
  );
}
