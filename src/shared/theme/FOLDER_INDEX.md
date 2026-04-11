# 📁 src/shared/theme/ - 主题预设与归一化

## 概述

该目录定义跨主进程与渲染进程共享的主题模式、主题预设以及旧主题值迁移逻辑。

## 文件结构

| 文件 | 描述 |
|------|------|
| `themePresets.ts` | 2 套主题预设、主题模式类型、存储键和模式归一化工具 |
| `FOLDER_INDEX.md` | 本文件 |

## 关键内容

- 主题模式：`light-b`、`dark`
- 兼容旧值：`light`、`system`、`light-a`、`light-c` 等旧存储值会归一化为新的浅色默认主题
- 共享语义：窗口背景色、表面层级、强调色等中性主题 token 由此统一输出

## 使用关系

- `src/renderer/hooks/useTheme.ts` 负责把主题模式应用到 `document.documentElement`
- `src/main/handlers/theme-handlers.ts` 与 `src/main/main.ts` 使用该目录提供的模式和值保持主窗口背景一致
- `src/renderer/components/SettingsPanel.tsx` 使用主题预设渲染用户可选主题列表

## 更新日志

- 2026-04-03: 收敛为 `1 浅色 + 1 暗色` 主题集，移除 `light-a` 与 `light-c`
