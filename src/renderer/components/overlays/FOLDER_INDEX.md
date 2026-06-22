# 📁 src/renderer/components/overlays/ - Overlay 家族基础件

## 概述

该目录承载弹窗与工作抽屉共用的 overlay 基础件，用于把确认弹窗、编辑窗口和 CLI 侧边工作窗统一到同一套结构语言下。

## 文件结构

| 文件 | 描述 |
|------|------|
| `OverlayFrame.tsx` | 统一标题栏、正文区、底部操作区的 chrome 外壳 |
| `OverlayDrawer.tsx` | 右侧工作抽屉容器，负责 portal、遮罩、焦点管理与滑入动画 |
| `FOLDER_INDEX.md` | 本文件 |

## 设计规则

- 与 `AppModal` 共享 `overlay-title`、`overlay-body`、`overlay-footer` 测试标记
- 共享遮罩逻辑、圆角体系、阴影层级和关闭按钮位置
- 主要用于接入点详情、设置与备份这类独立任务域；CLI 编辑内容在接入点详情面板内嵌，不再单独创建二级抽屉
- 保持高信息密度，不通过增加空白换取“高级感”

## 使用关系

- `AccessPointDetailPanel.tsx` 使用 `OverlayDrawer` 承载托管站点与直连配置详情
- `ManagedCliConfigEditorContent.tsx` / `DirectCliConfigEditorContent.tsx` 嵌入详情面板，不直接依赖 `OverlayDrawer`
- `AppModal` 未直接依赖本目录，但通过共享 chrome 标记保持同一家族契约

## 更新日志

- 2026-03-31: 创建 `OverlayFrame` 与 `OverlayDrawer`，用于 overlay family 重设计
