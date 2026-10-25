# 📁 src/renderer/hooks/ - 自定义 React Hooks
## 架构说明
**职责**: 提供业务逻辑和状态管理的自定义 Hooks
**特点**:
- 封装 IPC 通信逻辑
- 处理异步操作和加载状态
- 集成 Zustand Store
- 类型安全的接口
- 支持错误处理和重试
**依赖关系**:
- 依赖 `store/` 管理全局状态
- 调用 IPC 与主进程通信
- 被 `components/` 使用
- 依赖 `utils/` 工具函数
---
## 📂 文件清单
### 核心 Hooks
| 文件 | 职责 | 返回值 |
|------|------|--------|
| **index.ts** | Hooks 导出入口 | 所有 Hooks 的统一导出 |
| **useSiteGroups.ts** | 站点分组管理 | `{ groups, addGroup, deleteGroup, ... }` |
| **useAutoRefresh.ts** | 自动刷新逻辑 | `{ isRefreshing, startRefresh, stopRefresh, ... }` |
| **useSiteDetection.ts** | 站点检测；刷新失败写入站点结果，由名称旁的异常图标展示详情 | `{ results, isDetecting, detect, ... }` |
| **useTokenManagement.ts** | Token 管理，支持站点 API Key 列表刷新、单个 API Key 状态刷新、创建与删除 | `{ refreshSiteApiKeys, handleRefreshToken, handleCreateTokenSubmit, handleDeleteToken }` |
| **useCheckIn.ts** | 签到逻辑，基于已保存站点/账户配置生成批量签到目标，跳过 `unavailable` 分组，按站点类型打开手动签到页 | `{ canSignIn, isSigningIn, signIn, ... }` |
| **useDataLoader.ts** | 数据加载，支持站点状态持久化、签到能力缓存回填与账户级 CLI 配置按 card key 回填 | `{ data, isLoading, error, reload, ... }` |
| **useSiteDrag.ts** | 站点拖拽排序 | `{ draggedSite, onDragStart, onDrop, ... }` |
| **useTheme.ts** | 主题管理（四套预设：Light / Dark / Modern / Modern Dark） | `{ theme, setTheme, ... }` |
| **useUpdate.ts** | 应用更新检查与下载 | `{ hasUpdate, isChecking, checkUpdate, ... }` |
| **useConfigDetection.ts** | CLI 配置检测 | `{ detection, isLoading, refresh, detect }` |
| **useDateString.ts** | 返回当前本地日期字符串，用于「今日已签/今日已刷新」跨零点判断 | `string` |
---
## 🎣 Hooks 详解
### useSiteGroups
**职责**: 管理站点分组
**返回值**:
```typescript
interface UseSiteGroupsReturn {
  groups: SiteGroup[];
  activeGroupId: string;
  setActiveGroup: (groupId: string) => void;
  addGroup: (name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  updateGroup: (groupId: string, name: string) => Promise<void>;
  reorderGroups: (groupIds: string[]) => Promise<void>;
}
```
**使用示例**:
```typescript
const { groups, activeGroupId, addGroup, deleteGroup } = useSiteGroups();

return (
  <div>
    {groups.map(group => (
      <button key={group.id} onClick={() => setActiveGroup(group.id)}>
        {group.name}
      </button>
    ))}
    <button onClick={() => addGroup('New Group')}>Add Group</button>
  </div>
);
```
### useAutoRefresh
**职责**: 自动刷新站点数据（按站点独立配置的间隔定时触发检测，支持账户级结果刷新）
**返回值**: 无（副作用 Hook，内部管理定时器）
**特点**:
- 按站点独立配置：每个站点可单独开启/关闭及设置间隔
- 默认刷新间隔 30 分钟，最小 15 分钟
- 配置入口统一在 SitesPage 的 AutoRefreshDialog 对话框
- 多账户站点按账户逐个刷新，避免只更新站点级缓存
### useSiteDetection
**职责**: 检测站点状态
**返回值**:
```typescript
interface UseSiteDetectionReturn {
  results: DetectionResult[];
  detecting: boolean;
  detectingSites: Set<string>;
  detectSingle: (site: SiteConfig, quickRefresh?: boolean, config?: Config) => Promise<DetectionResult | undefined>;
  detectAllSites: (config: Config) => Promise<DetectionResult[]>;
}
```
**特点**:
- 批量检测与单站点刷新
- `detectingSites` (Set) 独立跟踪每个站点的刷新状态
- `refreshMessage` 清除前校验站点名匹配，避免并发定时器竞态
- 结果通过 `upsertResult` 安全更新，避免并发覆盖
### useTokenManagement
**职责**: 管理 Token
**返回值**:
```typescript
interface UseTokenManagementReturn {
  tokens: TokenInfo[];
  getToken: (siteId: string) => Promise<string>;
  saveToken: (siteId: string, token: string) => Promise<void>;
  deleteToken: (siteId: string) => Promise<void>;
  refreshToken: (siteId: string) => Promise<string>;
  listTokens: () => Promise<TokenInfo[]>;
}
```
**特点**:
- Token 获取和保存
- Token 刷新
- Token 删除
- Token 列表
### useCheckIn
**职责**: 处理签到逻辑（支持多账户）
**返回值**:
```typescript
interface UseCheckInReturn {
  handleCheckIn: (site: SiteConfig, accountId?: string) => Promise<void>;
  handleCheckInAll: () => Promise<{ success: number; failed: number; skipped: number }>;
  openCheckinPage: (site: SiteConfig, siteType?: 'veloera' | 'newapi') => Promise<void>;
}
```
**特点**:
- 单站点签到：传入 accountId 实现账户级签到
- 批量签到：遍历所有 DetectionResult（含 accountId），逐账户签到
- 批量签到会跳过禁用站点与 `unavailable` 内建分组，保持与批量检测一致
- 签到结果按 (name, accountId) 精确匹配更新前端状态
- 签到失败时根据站点类型打开对应的手动签到页面（Veloera: /console, New API: /console/personal）
- 手动签到完成后调用 `browserProfile.persistCheckinCompletion()` 写入站点/账户缓存
- 签到成功后更新 lastRefresh 时间戳，确保图标状态正确显示并能跨刷新保持
### useDataLoader
**职责**: 通用数据加载，支持站点检测状态持久化与签到能力状态回填
**返回值**:
```typescript
interface UseDataLoaderReturn<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  setData: (data: T) => void;
}
```
**使用示例**:
```typescript
const { data: sites, isLoading, error, reload } = useDataLoader(
  () => window.ipcRenderer.invoke('api:getSites')
);
```
**特点**:
- 从 cached_data 读取站点检测状态（status/error）
- 向后兼容：无 status 字段时默认为 '成功'
- 支持启动时自动检测 CLI 配置
- 将账户级 `cli_config` 加载到 `siteName::accountId`，仅在无账户 legacy 站点时使用裸 `siteName`
### useSiteDrag
**职责**: 处理站点拖拽排序
**返回值**:
```typescript
interface UseSiteDragReturn {
  draggedSite: Site | null;
  onDragStart: (site: Site) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (targetSite: Site) => Promise<void>;
  onDragEnd: () => void;
}
```
**特点**:
- 拖拽开始/结束
- 拖拽悬停
- 放置处理
- 排序保存
### useTheme
**职责**: 管理应用主题（四套预设）
**返回值**:
```typescript
// theme: 'light-b' | 'dark' | 'modern' | 'modern-dark'（旧值加载时归一化）
const { theme, setTheme, ... } = useTheme();
```
**特点**:
- 主题切换与持久化（`theme:load` / `theme:save`）
- 旧主题值自动归一化到当前四套预设
- 通过 CSS 变量驱动 `App*` 原语，不依赖 Tailwind `dark:` 前缀
### useUpdate
**职责**: 检查应用更新、下载与安装
**返回值**:
```typescript
interface UseUpdateReturn {
  currentVersion: string;
  updateInfo: UpdateCheckResult | null;
  isChecking: boolean;
  error: string | null;
  settings: UpdateSettings;
  downloadProgress: DownloadProgress | null;
  downloadPhase: DownloadPhase;
  downloadedFilePath: string | null;
  downloadError: string | null;
  checkForUpdates: () => Promise<void>;
  checkForUpdatesInBackground: () => Promise<void>;
  openDownloadUrl: () => Promise<void>;
  updateSettings: (settings: Partial<UpdateSettings>) => Promise<void>;
  startDownload: (url: string) => Promise<void>;
  // install / cancel 等见源码
}
```
**特点**:
- 前台检查与后台静默检查两条路径
- 下载进度来自 `update:download-progress` 推送
- 更新源与代理等设置持久化在 `update-settings.json`
---
## 🔄 Hook 通信模式

### IPC 通信

渲染进程不直接使用 `ipcRenderer`，统一通过 preload 暴露的 `window.electronAPI`：

```typescript
// Hook 中调用 IPC
const result = await window.electronAPI.token.validate(account);
if (!result.ok) throw new Error(result.error);
```

### Store 集成

```typescript
// Hook 中使用 Store
const { config, saveConfig } = useConfigStore();

const addSite = async (site: UnifiedSite) => {
  await window.electronAPI.sites.add(site);
  await saveConfig();
};
```

### 错误处理

主进程把异常收敛成结构化结果（`{ ok: false, error }` 或 `{ success: false, error }`），Hook 负责转成 UI 状态：

```typescript
const [error, setError] = useState<Error | null>(null);

const detect = async () => {
  try {
    setError(null);
    return await window.electronAPI.detectSingle(site, false, config);
  } catch (err) {
    setError(err as Error);
    throw err;
  }
};
```
---
## 🧪 Hook 测试
### 测试示例

```typescript
// src/__tests__/hooks/useSiteGroups.test.ts
import { renderHook, act } from '@testing-library/react';
import { useSiteGroups } from '../hooks/useSiteGroups';

describe('useSiteGroups', () => {
  it('should add a group', async () => {
    const { result } = renderHook(() => useSiteGroups());
    
    await act(async () => {
      await result.current.addGroup('New Group');
    });
    
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].name).toBe('New Group');
  });
});
```
---
## 🎯 最佳实践
### 1. 类型安全
- 完整的返回值类型定义
- 参数类型检查
- 避免使用 `any`
### 2. 错误处理
- try-catch 捕获错误
- 返回错误状态
- 提供错误信息
### 3. 性能优化
- 使用 `useCallback` 避免重新创建函数
- 使用 `useMemo` 缓存计算结果
- 避免不必要的重新渲染
### 4. 清理资源
- 使用 `useEffect` 清理定时器
- 取消未完成的请求
- 释放事件监听器
---
## 📈 扩展指南
### 添加新 Hook

1. 在 `hooks/` 中创建新文件
2. 定义返回值接口
3. 实现 Hook 逻辑
4. 添加 JSDoc 注释
5. 编写单元测试
6. 导出到 `index.ts`
### 模板

```typescript
// src/renderer/hooks/useNewFeature.ts
import { useState, useCallback } from 'react';

interface UseNewFeatureReturn {
  // 返回值类型
}

export function useNewFeature(): UseNewFeatureReturn {
  const [state, setState] = useState(null);
  
  const method = useCallback(async () => {
    // 实现逻辑
  }, []);
  
  return { state, method };
}
```
---
## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/FOLDER_INDEX.md 和 PROJECT_INDEX.md
---
**版本**: 3.1.3
**更新日期**: 2026-10-22

## 架构与数据管理重构（2026-10-24）

- [useApplicationData.ts](useApplicationData.ts): 应用数据加载、恢复事件和旧响应屏蔽
- [useSiteDetection.ts](useSiteDetection.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [useManagedAutoRefresh.ts](useManagedAutoRefresh.ts): CLI 管理态自动刷新策略与提交后发布
