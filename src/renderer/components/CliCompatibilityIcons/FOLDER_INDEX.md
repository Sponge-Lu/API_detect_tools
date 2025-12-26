# 📁 src/renderer/components/CliCompatibilityIcons/ - CLI 兼容性图标

## 架构说明

**职责**: 提供 CLI 工具兼容性图标显示组件

**特点**:
- 工具图标显示（Claude Code、Codex、Gemini CLI）
- 支持状态指示（支持/不支持/待测试/未配置）
- 详细测试结果 tooltip（Codex 双 API、Gemini CLI 双端点）
- 响应式布局

**依赖关系**:
- 被 `SiteCard` 和其他组件使用
- 依赖 `store/detectionStore` 获取兼容性数据
- 依赖 `shared/types/cli-config` 获取类型定义

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **CliCompatibilityIcons.tsx** | 兼容性图标组件 | `CliCompatibilityIcons` 组件, `getCodexDetailText`, `getGeminiDetailText` |

---

## 🎯 关键功能

### 详细测试结果显示

- **Codex**: 显示 Chat Completions API 和 Responses API 的测试结果
- **Gemini CLI**: 显示 Native 原生格式和 Proxy 兼容格式的测试结果
- 鼠标悬停时显示详细状态和使用建议

---

## 🔄 自引用

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2025-12-26
