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
| **useSiteDetection.ts** | 站点检测 | `{ results, isDetecting, detect, ... }` |
| **useTokenManagement.ts** | Token 管理 | `{ tokens, getToken, saveToken, deleteToken, ... }` |
| **useCheckIn.ts** | 签到逻辑 | `{ canSignIn, isSigningIn, signIn, ... }` |
| **useCliCompatTest.ts** | CLI 兼容性测试 | `{ results, isTesting, test, ... }` |
| **useDataLoader.ts** | 数据加载 | `{ data, isLoading, error, reload, ... }` |
| **useSiteDrag.ts** | 站点拖拽排序 | `{ draggedSite, onDragStart, onDrop, ... }` |
| **useTheme.ts** | 主题管理 | `{ theme, setTheme, isDark, ... }` |
| **useUpdate.ts** | 应用更新检查 | `{ hasUpdate, isChecking, checkUpdate, ... }` |
| **useConfigDetection.ts** | CLI 配置检测 | `{ detection, isLoading, refresh, detect }` |

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

**职责**: 自动刷新站点数据

**返回值**:
```typescript
interface UseAutoRefreshReturn {
  isRefreshing: boolean;
  refreshInterval: number;
  setRefreshInterval: (interval: number) => void;
  startRefresh: () => void;
  stopRefresh: () => void;
  manualRefresh: () => Promise<void>;
}
```

**特点**:
- 定时刷新
- 手动刷新
- 刷新间隔可配置
- 自动停止和启动

### useSiteDetection

**职责**: 检测站点状态

**返回值**:
```typescript
interface UseSiteDetectionReturn {
  results: DetectionResult[];
  isDetecting: boolean;
  progress: number;
  detect: (siteIds?: string[]) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}
```

**特点**:
- 批量检测
- 进度显示
- 支持取消
- 结果缓存

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

**职责**: 处理签到逻辑

**返回值**:
```typescript
interface UseCheckInReturn {
  canSignIn: (siteId: string) => boolean;
  isSigningIn: boolean;
  lastSignIn: Record<string, Date>;
  signIn: (siteId: string) => Promise<SignInResult>;
  signInAll: () => Promise<SignInResult[]>;
}
```

**特点**:
- 检测签到状态
- 单个签到
- 批量签到
- 签到历史记录

### useCliCompatTest

**职责**: 测试 CLI 兼容性

**返回值**:
```typescript
interface UseCliCompatTestReturn {
  results: CliCompatibility[];
  isTesting: boolean;
  test: (siteId: string) => Promise<CliCompatibility[]>;
  testAll: () => Promise<CliCompatibility[]>;
  generateConfig: (siteId: string, tool: string) => Promise<string>;
}
```

**特点**:
- 单个站点测试
- 批量测试
- 配置生成
- 结果缓存

### useDataLoader

**职责**: 通用数据加载

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

**职责**: 管理应用主题

**返回值**:
```typescript
interface UseThemeReturn {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  isDark: boolean;
  systemIsDark: boolean;
}
```

**特点**:
- 主题切换
- 系统主题检测
- 主题持久化
- 实时更新

### useUpdate

**职责**: 检查应用更新

**返回值**:
```typescript
interface UseUpdateReturn {
  hasUpdate: boolean;
  isChecking: boolean;
  latestVersion: string;
  checkUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
}
```

**特点**:
- 更新检查
- 版本比较
- 下载更新
- 更新提示

---

## 🔄 Hook 通信模式

### IPC 通信

```typescript
// Hook 中调用 IPC
const getToken = async (siteId: string) => {
  const result = await window.ipcRenderer.invoke('token:get', { site: siteId });
  if (result.success) {
    return result.data;
  } else {
    throw new Error(result.error);
  }
};
```

### Store 集成

```typescript
// Hook 中使用 Store
const { sites, setSites } = useConfigStore();

const addSite = async (site: Site) => {
  await window.ipcRenderer.invoke('config:addSite', { site });
  setSites([...sites, site]);
};
```

### 错误处理

```typescript
// Hook 中的错误处理
const [error, setError] = useState<Error | null>(null);

const detect = async () => {
  try {
    setError(null);
    const results = await window.ipcRenderer.invoke('api:detect');
    return results;
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

**版本**: 2.1.9  
**更新日期**: 2025-12-26
