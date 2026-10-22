# 📁 src/renderer/components/Toast/ - 消息提示组件

## 架构说明

**职责**: 消息提示 (Toast) 的展示层。

**特点**:
- 四种类型：成功、错误、警告、信息
- 自动关闭；最多同时显示 3 条；单条摘要限制 2 行
- 队列与当前会话事件历史由 `store/toastStore` 管理

**依赖关系**:
- 被 `App.tsx` 挂载
- 依赖 `store/toastStore`
- 依赖 Tailwind 样式与主题 token

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **Toast.tsx** | 单条提示 + 容器 | `Toast`, `ToastContainer`, `ToastItem`, `ToastType` |
| **index.ts** | 桶文件 | re-export `Toast` / `ToastType` |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
