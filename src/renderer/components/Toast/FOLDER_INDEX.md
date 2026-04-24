# 📁 src/renderer/components/Toast/ - 消息提示组件

## 架构说明

**职责**: 提供消息提示 (Toast) 组件

**特点**:
- 多种消息类型 (成功、错误、警告、信息)
- 自动关闭
- 最多显示 3 条
- 单条消息限制为 2 行摘要
- 动画效果

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `store/toastStore` 管理可见消息队列与事件历史
- 依赖 Tailwind CSS 样式

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **Toast.tsx** | 单个消息提示 + 容器 | `Toast`, `ToastContainer`, `ToastItem`, `ToastType` |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
