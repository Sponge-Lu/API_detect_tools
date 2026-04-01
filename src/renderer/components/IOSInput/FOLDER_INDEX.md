# IOSInput 兼容目录

## 概述

该目录同时承载当前公共输入原语与 legacy 兼容导出：
- `AppInput` / `AppSearchInput` 是对外推荐名称
- `IOSInput` / `IOSSearchInput` 继续作为兼容别名保留

## 文件列表

| 文件 | 用途 | 主要导出 |
|------|------|----------|
| `IOSInput.tsx` | 输入原语实现 | `AppInput`, `IOSInput`, `IOSInputProps` |
| `IOSSearchInput.tsx` | 搜索输入原语实现 | `AppSearchInput`, `IOSSearchInput`, `IOSSearchInputProps` |
| `index.ts` | 兼容与公共导出入口 | 所有组件和类型 |

## 原语契约

### AppInput / IOSInput
- 使用统一主题 token 的输入表面、边框和焦点状态
- 支持多种输入类型（text, password, url, number, email）
- 支持密码显示/隐藏切换
- 支持左右图标、帮助文本和错误信息
- 保持原有 `onChange` 与验证逻辑

### AppSearchInput / IOSSearchInput
- 使用统一主题 token 的搜索输入样式
- 支持清除按钮
- 保持原有搜索输入行为

## 使用建议

- 新代码优先使用 `AppInput` / `AppSearchInput`
- 兼容层继续保留 `IOSInput` / `IOSSearchInput`

## 版本历史

- 2025-01-08: 创建输入原语与兼容导出
