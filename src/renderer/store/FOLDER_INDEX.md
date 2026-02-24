# 📁 src/renderer/store/ - Zustand 状态管理

## 架构说明

**职责**: 使用 Zustand 管理应用全局状态

**特点**:
- 轻量级状态管理库
- 支持持久化存储
- 类型安全的 selector
- 自动订阅和更新
- 支持中间件

**依赖关系**:
- 被 `components/` 和 `hooks/` 使用
- 依赖 `shared/types/` 中的类型
- 与 IPC 通信配合使用

---

## 📂 文件清单

### 核心 Store 文件

| 文件 | 职责 | 关键状态 |
|------|------|--------|
| **index.ts** | Store 导出入口 | 所有 Store 的统一导出 |
| **configStore.ts** | 配置管理 | 站点列表、分组、设置 |
| **detectionStore.ts** | 检测结果 | 检测状态、结果数据、detectingSites (Set) 并发跟踪 |
| **uiStore.ts** | UI 状态 | 主题、模态框、菜单 |
| **toastStore.ts** | 消息提示 | 消息队列、通知 |

---

## 🏪 Store 详解

### configStore.ts - 配置管理

**职责**: 管理应用配置和站点数据

**状态**:
```typescript
interface ConfigState {
  // 站点数据
  sites: Site[];
  groups: SiteGroup[];
  
  // 应用设置
  settings: AppSettings;
  
  // 操作方法
  setSites: (sites: Site[]) => void;
  addSite: (site: Site) => void;
  updateSite: (siteId: string, updates: Partial<Site>) => void;
  deleteSite: (siteId: string) => void;
  
  setGroups: (groups: SiteGroup[]) => void;
  addGroup: (group: SiteGroup) => void;
  updateGroup: (groupId: string, updates: Partial<SiteGroup>) => void;
  deleteGroup: (groupId: string) => void;
  
  setSettings: (settings: Partial<AppSettings>) => void;
  
  // 加载状态
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  
  // 错误处理
  error: Error | null;
  setError: (error: Error | null) => void;
}
```

**使用示例**:
```typescript
// 在组件中使用
const { sites, addSite, updateSite } = useConfigStore();

// 使用 selector 优化性能
const sites = useConfigStore(state => state.sites);
const addSite = useConfigStore(state => state.addSite);
```

**持久化**:
```typescript
// 配置持久化到 localStorage
const useConfigStore = create<ConfigState>(
  persist(
    (set) => ({
      // 状态定义
    }),
    {
      name: 'config-store',
      storage: localStorage,
    }
  )
);
```

### detectionStore.ts - 检测结果

**职责**: 管理站点检测的状态和结果

**状态**:
```typescript
interface DetectionState {
  // 检测结果
  results: DetectionResult[];
  
  // 检测状态
  isDetecting: boolean;
  progress: number;
  
  // 操作方法
  setResults: (results: DetectionResult[]) => void;
  addResult: (result: DetectionResult) => void;
  updateResult: (siteId: string, updates: Partial<DetectionResult>) => void;
  clearResults: () => void;
  
  setDetecting: (detecting: boolean) => void;
  setProgress: (progress: number) => void;
  
  // 错误处理
  error: Error | null;
  setError: (error: Error | null) => void;
}
```

**使用示例**:
```typescript
const { results, isDetecting, progress } = useDetectionStore();

// 订阅特定状态变化
useDetectionStore.subscribe(
  state => state.isDetecting,
  (isDetecting) => {
    console.log('检测状态变化:', isDetecting);
  }
);
```

### uiStore.ts - UI 状态

**职责**: 管理 UI 相关的状态

**状态**:
```typescript
interface UiState {
  // 主题
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  
  // 模态框
  modals: {
    siteEditor: boolean;
    settings: boolean;
    confirmDialog: boolean;
    [key: string]: boolean;
  };
  openModal: (modalName: string) => void;
  closeModal: (modalName: string) => void;
  
  // 菜单
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  
  // 侧边栏
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  
  // 搜索
  searchText: string;
  setSearchText: (text: string) => void;
  
  // 排序和筛选
  sortBy: 'name' | 'balance' | 'usage';
  setSortBy: (sortBy: string) => void;
  
  filterStatus: 'all' | 'online' | 'offline';
  setFilterStatus: (status: string) => void;
}
```

**使用示例**:
```typescript
const { theme, setTheme, modals, openModal } = useUiStore();

// 切换主题
<button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
  切换主题
</button>

// 打开模态框
<button onClick={() => openModal('siteEditor')}>
  编辑站点
</button>
```

### toastStore.ts - 消息提示

**职责**: 管理 Toast 消息队列

**状态**:
```typescript
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  
  // 操作方法
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}
```

**使用示例**:
```typescript
const { addToast, removeToast } = useToastStore();

// 显示成功消息
const toastId = addToast({
  message: '操作成功',
  type: 'success',
  duration: 3000
});

// 显示错误消息
addToast({
  message: '操作失败',
  type: 'error',
  duration: 5000
});
```

---

## 🔄 Store 通信模式

### 基础使用

```typescript
// 获取状态
const sites = useConfigStore(state => state.sites);

// 调用方法
const { addSite } = useConfigStore();
addSite(newSite);

// 订阅状态变化
useConfigStore.subscribe(
  state => state.sites,
  (sites) => console.log('站点列表更新:', sites)
);
```

### 与 Hook 集成

```typescript
// Hook 中使用 Store
export function useSiteGroups() {
  const { groups, addGroup, deleteGroup } = useConfigStore();
  
  const handleAddGroup = async (name: string) => {
    const newGroup = { id: generateId(), name, sites: [] };
    addGroup(newGroup);
    
    // 同步到主进程
    await window.ipcRenderer.invoke('config:save', {
      config: useConfigStore.getState()
    });
  };
  
  return { groups, handleAddGroup, deleteGroup };
}
```

### 与组件集成

```typescript
// 组件中使用 Store
function SiteList() {
  const sites = useConfigStore(state => state.sites);
  const { updateSite } = useConfigStore();
  
  return (
    <div>
      {sites.map(site => (
        <SiteCard
          key={site.id}
          site={site}
          onUpdate={(updates) => updateSite(site.id, updates)}
        />
      ))}
    </div>
  );
}
```

---

## 🎯 最佳实践

### 1. 使用 Selector 优化性能

```typescript
// ❌ 不好：每次都会重新渲染
const state = useConfigStore();

// ✅ 好：只在 sites 变化时重新渲染
const sites = useConfigStore(state => state.sites);
```

### 2. 分离关注点

```typescript
// ✅ 好：每个 Store 只负责一个方面
useConfigStore();    // 配置管理
useDetectionStore(); // 检测结果
useUiStore();        // UI 状态
useToastStore();     // 消息提示
```

### 3. 异步操作

```typescript
// ✅ 好：在 Hook 中处理异步，然后更新 Store
const handleSave = async (config) => {
  try {
    await window.ipcRenderer.invoke('config:save', { config });
    useConfigStore.setState({ settings: config.settings });
    addToast({ message: '保存成功', type: 'success' });
  } catch (error) {
    addToast({ message: '保存失败', type: 'error' });
  }
};
```

### 4. 避免过度设计

```typescript
// ❌ 不好：Store 中包含太多逻辑
const complexLogic = () => {
  // 复杂的业务逻辑
};

// ✅ 好：业务逻辑在 Hook 中，Store 只管理状态
// Hook 中处理业务逻辑，然后更新 Store
```

---

## 🧪 Store 测试

### 测试示例

```typescript
// src/__tests__/store/configStore.test.ts
import { renderHook, act } from '@testing-library/react';
import { useConfigStore } from '../store/configStore';

describe('configStore', () => {
  beforeEach(() => {
    useConfigStore.setState({
      sites: [],
      groups: [],
      settings: {}
    });
  });

  it('should add a site', () => {
    const { result } = renderHook(() => useConfigStore());
    
    act(() => {
      result.current.addSite({ id: '1', name: 'Test Site' });
    });
    
    expect(result.current.sites).toHaveLength(1);
    expect(result.current.sites[0].name).toBe('Test Site');
  });
});
```

---

## 📈 扩展指南

### 添加新 Store

1. 在 `store/` 中创建新文件
2. 定义状态接口
3. 使用 `create()` 创建 Store
4. 添加 JSDoc 注释
5. 编写单元测试
6. 导出到 `index.ts`

### 模板

```typescript
// src/renderer/store/newStore.ts
import { create } from 'zustand';

interface NewState {
  // 状态
  data: any;
  
  // 方法
  setData: (data: any) => void;
}

export const useNewStore = create<NewState>((set) => ({
  data: null,
  setData: (data) => set({ data }),
}));
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.22
**更新日期**: 2026-02-24
