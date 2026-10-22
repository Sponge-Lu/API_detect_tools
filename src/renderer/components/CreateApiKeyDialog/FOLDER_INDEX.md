# 📁 src/renderer/components/CreateApiKeyDialog/ - API Key 创建对话框

## 架构说明

**职责**: 新建 API Key（New API 令牌）的对话框。

**特点**:
- 表单字段：名称、配额、过期时间、分组等
- 提交前做必填与数值校验，失败在对话框内提示
- 提交中禁用按钮并显示加载态，成功后关闭并回调刷新列表

**依赖关系**:
- 被站点卡片 / API Key 管理入口调用
- 依赖 `hooks/useTokenManagement` 与主进程 `token:*` IPC

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **CreateApiKeyDialog.tsx** | 对话框本体与表单 | `CreateApiKeyDialog`, `NewApiTokenForm` |
| **index.ts** | 桶文件 | re-export `CreateApiKeyDialog` 与表单类型 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
