/**
 * 输入: 无 (纯类型定义)
 * 输出: TypeScript 类型和接口 (SiteCardProps, SiteCardHeaderProps, SiteCardActionsProps)
 * 定位: 类型定义层 - 定义 SiteCard 组件相关的 Props 类型
 *
 * 并发刷新: isDetecting (boolean) 替代 detectingSite (string|null)，
 * 支持多站点同时刷新时各自独立的加载状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { SiteConfig } from '../../../main/types/token';
import type { DetectionResult } from '../../App';
import type { CliCompatibilityResult } from '../../store/detectionStore';
import type { CliConfig } from '../../../shared/types/cli-config';

export interface SiteCardProps {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  siteAccount?: any;
  columnWidths: number[];
  accessPointType?: 'managed' | 'custom-cli';
  draggable?: boolean;

  // 多账户: 卡片所属账户信息
  accountId?: string;
  accountName?: string;
  /** 复合 key（site.name::accountId），用于 expandedSites / detectingSites 等 */
  cardKey?: string;

  // 扩展数据
  modelPricing: any;

  // 状态
  isDetecting: boolean;
  checkingIn: string | null;
  dragOverIndex: number | null;
  refreshMessage: { site: string; message: string; type: 'success' | 'info' } | null;

  // CLI 兼容性状态
  cliCompatibility?: CliCompatibilityResult;
  cliConfig?: CliConfig | null;
  isCliTesting?: boolean;

  // 回调函数
  onDetect: (site: SiteConfig, accountId?: string) => void;
  onCheckIn: (site: SiteConfig, accountId?: string) => void;
  onOpenSite: (site: SiteConfig, accountId?: string) => void;
  onOpenExtraLink: (link: string) => void;
  onOpenCliConfig?: () => void;
  onTestCliCompat?: () => void;
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;

  // 拖拽回调
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}

export interface SiteCardHeaderProps {
  site: SiteConfig;
  siteResult?: DetectionResult;
  lastSyncDisplay: string | null;
  errorCode: string | null;
  timeoutSeconds: number | null;
  columnWidths: number[];
  todayTotalTokens: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayRequests: number;
  rpm: number;
  tpm: number;
  modelCount: number;
  accessPointType?: 'managed' | 'custom-cli';
  accountId?: string;
  /** 账户名（多账户时显示在站点名下方） */
  accountName?: string;
  onOpenSite: (site: SiteConfig, accountId?: string) => void;
  // CLI 兼容性相关
  cliCompatibility?: CliCompatibilityResult;
  cliConfig?: CliConfig | null;
  isCliTesting?: boolean;
  onOpenCliConfig?: () => void;
  onTestCliCompat?: () => void;
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface SiteCardActionsProps {
  site: SiteConfig;
  cardKey: string;
  accessPointType?: 'managed' | 'custom-cli';
  accountId?: string;
  siteResult?: DetectionResult;
  isDetecting: boolean;
  checkingIn: string | null;
  /** 签到统计数据 (New API 类型站点) */
  checkinStats?: {
    todayQuota?: number;
    checkinCount?: number;
    totalCheckins?: number;
    siteType?: 'veloera' | 'newapi';
  };

  onDetect: (site: SiteConfig) => void;
  onCheckIn: (site: SiteConfig, accountId?: string) => void;
  onOpenExtraLink: (link: string) => void;
}
