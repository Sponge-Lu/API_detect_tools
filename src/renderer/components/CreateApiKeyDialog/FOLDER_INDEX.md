# 📁 src/renderer/components/CreateApiKeyDialog/ - API Key 创建对话框

## 架构说明

**职责**: 提供 API Key 创建和管理对话框

**特点**:
- 表单验证
- 错误提示
- 加载状态
- 成功反馈

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `hooks/useTokenManagement` 管理 Token
- 依赖 `store/` 管理状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **CreateApiKeyDialog.tsx** | API Key 创建对话框 | `CreateApiKeyDialog` 组件 |
| **ApiKeyForm.tsx** | API Key 表单 | `ApiKeyForm` 组件 |
| **ApiKeyList.tsx** | API Key 列表 | `ApiKeyList` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
