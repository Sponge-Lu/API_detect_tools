# 修复导航栏 Grok 显示未配置

## Goal

修复从托管站点 CLI 编辑器将 Grok Build 配置写入本机后，侧边导航栏仍显示“未配置”的状态不同步问题。

## What I already know

- 侧边栏通过 `CliConfigStatusPanel` 展示本地 CLI 检测结果。
- Grok Build 状态由主进程解析 `~/.grok/config.toml`（或 `GROK_HOME/config.toml`）后生成。
- 站点列表的 `ApplyConfigPopover` 在配置写入成功后会清除检测缓存并重新检测。
- `ManagedCliConfigEditorContent` 的“应用到本机”流程只写入配置并提示成功，没有刷新检测缓存，因此侧边栏继续显示写入前的“未配置”。

## Confirmed Scope

- 用户确认修复托管站点 CLI 编辑器“应用到本机”后的状态同步。
- 修复适用于该编辑器中的全部 CLI，避免 Claude Code、Codex、OpenCode 出现同类状态滞后。

## Requirements

- 本地 CLI 配置写入成功后，清除主进程配置检测缓存。
- 清除渲染进程旧检测结果，并基于当前站点列表重新执行检测。
- 写入失败时不刷新检测状态。
- 不改变 Grok Build 配置生成格式、应用模式或其他 CLI 功能。

## Acceptance Criteria

- [ ] 从托管站点编辑器应用 Grok Build 配置成功后，侧边栏无需手动刷新即可显示实际配置来源。
- [ ] 刷新前先清除主进程缓存，避免命中五分钟旧结果。
- [ ] 检测刷新失败不影响配置写入成功结果，并记录错误。
- [ ] 相关测试覆盖成功写入后的缓存清理与重新检测。
- [ ] 相关测试、lint 与 TypeScript 构建检查通过。

## Definition of Done

- 测试已新增或更新。
- lint、类型检查或构建检查通过。
- 未修改无关功能或用户现有改动。

## Out of Scope

- 修改 Grok Build TOML 格式或支持新的配置路径。
- 修改 CLI 配置检测分类规则。
- 自动提交代码。

## Technical Approach

在 `ManagedCliConfigEditorContent` 的本地配置写入成功分支复用现有检测状态能力：清除后端缓存、清空前端检测结果，并用当前应用配置中的站点列表触发重新检测。通过组件测试验证 Grok Build 应用后的调用顺序和参数。

## Decision (ADR-lite)

**Context**: 同一仓库已有 `ApplyConfigPopover` 的写入后刷新模式，但托管站点编辑器遗漏了该步骤。

**Decision**: 修复写入工作流的状态同步，不在导航栏中根据编辑器配置推测本机状态。

**Consequences**: 导航栏继续以真实本地文件检测结果为准；应用成功后会增加一次轻量本地检测。

## Technical Notes

- `src/renderer/components/Sidebar/VerticalSidebar.tsx`
- `src/renderer/components/CliConfigStatus/CliConfigStatusPanel.tsx`
- `src/renderer/components/dialogs/ManagedCliConfigEditorContent.tsx`
- `src/renderer/components/dialogs/ApplyConfigPopover.tsx`
- `src/renderer/store/detectionStore.ts`
- `src/main/config-detection-service.ts`
