/**
 * 检测状态管理
 * 管理站点检测结果和相关数据
 *
 * 注意：检测操作由 useSiteDetection hook 负责，Store 只负责存储状态
 */

import { create } from 'zustand';
import type { DetectionResult } from '../App';

interface DetectionState {
  // 检测结果
  results: DetectionResult[];

  // 检测状态
  detecting: boolean;
  detectingSite: string | null;

  // 扩展数据
  apiKeys: Record<string, any[]>;
  userGroups: Record<string, Record<string, { desc: string; ratio: number }>>;
  modelPricing: Record<string, any>;

  // Actions
  setResults: (results: DetectionResult[]) => void;
  updateResult: (name: string, result: Partial<DetectionResult>) => void;
  setDetecting: (detecting: boolean) => void;
  setDetectingSite: (site: string | null) => void;

  // 扩展数据 Actions
  setApiKeys: (siteName: string, keys: any[]) => void;
  setUserGroups: (
    siteName: string,
    groups: Record<string, { desc: string; ratio: number }>
  ) => void;
  setModelPricing: (siteName: string, pricing: any) => void;
}

export const useDetectionStore = create<DetectionState>()((set, get) => ({
  // 初始状态
  results: [],
  detecting: false,
  detectingSite: null,
  apiKeys: {},
  userGroups: {},
  modelPricing: {},

  // 基础 setters
  setResults: results => set({ results }),

  updateResult: (name, partialResult) => {
    const { results } = get();
    set({
      results: results.map(r => (r.name === name ? { ...r, ...partialResult } : r)),
    });
  },

  setDetecting: detecting => set({ detecting }),
  setDetectingSite: site => set({ detectingSite: site }),

  // 扩展数据 setters
  setApiKeys: (siteName, keys) => {
    const { apiKeys } = get();
    set({ apiKeys: { ...apiKeys, [siteName]: keys } });
  },

  setUserGroups: (siteName, groups) => {
    const { userGroups } = get();
    set({ userGroups: { ...userGroups, [siteName]: groups } });
  },

  setModelPricing: (siteName, pricing) => {
    const { modelPricing } = get();
    set({ modelPricing: { ...modelPricing, [siteName]: pricing } });
  },
}));
