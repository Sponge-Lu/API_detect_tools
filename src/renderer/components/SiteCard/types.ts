/**
 * SiteCard 组件类型定义
 */

import type { SiteConfig } from '../../../main/types/token';
import type { DetectionResult } from '../../App';

export interface SiteCardProps {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  siteAccount?: any;
  isExpanded: boolean;
  columnWidths: number[];

  // 扩展数据
  apiKeys: any[];
  userGroups: Record<string, { desc: string; ratio: number }>;
  modelPricing: any;

  // 状态
  detectingSite: string | null;
  checkingIn: string | null;
  dragOverIndex: number | null;
  refreshMessage: { site: string; message: string; type: 'success' | 'info' } | null;

  // 详情面板状态
  selectedGroup: string | null;
  modelSearch: string;
  showTokens: Record<string, boolean>;
  selectedModels: Set<string>;
  deletingTokenKey: string | null;

  // 回调函数
  onExpand: (name: string) => void;
  onDetect: (site: SiteConfig) => void;
  onToggle: (index: number) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCheckIn: (site: SiteConfig) => void;
  onOpenCheckinPage: (site: SiteConfig) => void;
  onOpenExtraLink: (link: string) => void;
  onCopyToClipboard: (text: string, label: string) => void;

  // 拖拽回调
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;

  // 详情面板回调
  onToggleGroupFilter: (siteName: string, groupName: string | null) => void;
  onModelSearchChange: (siteName: string, search: string) => void;
  onToggleTokenVisibility: (key: string) => void;
  onToggleModelSelection: (model: string) => void;
  onCopySelectedModels: () => void;
  onOpenCreateTokenDialog: (site: SiteConfig) => void;
  onDeleteToken: (site: SiteConfig, token: any, index: number) => void;
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
  onOpenCheckinPage: (site: SiteConfig) => void;
}

export interface SiteCardActionsProps {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  isExpanded: boolean;
  detectingSite: string | null;
  checkingIn: string | null;

  onExpand: (name: string) => void;
  onDetect: (site: SiteConfig) => void;
  onToggle: (index: number) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCheckIn: (site: SiteConfig) => void;
  onOpenExtraLink: (link: string) => void;
  onCopyToClipboard: (text: string, label: string) => void;
}
