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
  detectingSite: string | null; // 保留用于向后兼容（显示单个刷新中的站点）
  detectingSites: Set<string>; // 新增：支持多站点并发刷新

  // 扩展数据
  apiKeys: Record<string, any[]>;
  userGroups: Record<string, Record<string, { desc: string; ratio: number }>>;
  modelPricing: Record<string, any>;

  // Actions
  setResults: (results: DetectionResult[]) => void;
  updateResult: (name: string, result: Partial<DetectionResult>) => void;
  upsertResult: (result: DetectionResult) => void; // 新增：安全地更新或插入单个结果
  setDetecting: (detecting: boolean) => void;
  setDetectingSite: (site: string | null) => void;
  addDetectingSite: (site: string) => void;
  removeDetectingSite: (site: string) => void;
  isDetectingSite: (site: string) => boolean;

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
  detectingSites: new Set<string>(),
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

  // 安全地更新或插入单个结果（支持并发刷新）
  upsertResult: result => {
    const { results } = get();
    const existingIndex = results.findIndex(r => r.name === result.name);
    if (existingIndex >= 0) {
      // 更新现有结果
      const newResults = [...results];
      newResults[existingIndex] = result;
      set({ results: newResults });
    } else {
      // 插入新结果
      set({ results: [...results, result] });
    }
  },

  setDetecting: detecting => set({ detecting }),
  setDetectingSite: site => set({ detectingSite: site }),

  // 新增：多站点并发刷新支持
  addDetectingSite: site => {
    const { detectingSites } = get();
    const newSet = new Set(detectingSites);
    newSet.add(site);
    set({ detectingSites: newSet, detectingSite: site });
  },

  removeDetectingSite: site => {
    const { detectingSites } = get();
    const newSet = new Set(detectingSites);
    newSet.delete(site);
    // 如果还有其他站点在刷新，设置为其中一个；否则设为 null
    const remaining = Array.from(newSet);
    set({
      detectingSites: newSet,
      detectingSite: remaining.length > 0 ? remaining[0] : null,
    });
  },

  isDetectingSite: site => {
    const { detectingSites } = get();
    return detectingSites.has(site);
  },

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
