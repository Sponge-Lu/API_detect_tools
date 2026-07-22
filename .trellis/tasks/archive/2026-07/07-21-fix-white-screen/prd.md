# 修复应用频繁白屏

## Goal

定位并修复 Electron 应用频繁出现白屏的问题，优先消除可证明的根因，并为无法完全避免的渲染异常提供可恢复路径。

## What I already know

* 用户反馈应用经常白屏，发生频率已影响正常使用。
* 项目由 Electron 主进程和 React 渲染进程组成。
* 当前仓库存在与本任务无关的未提交改动，修复必须与其隔离。
* 主窗口未监听页面加载失败、preload 失败、渲染进程退出或无响应事件，持久化日志无法诊断这些故障。
* React 根入口没有错误边界，所有业务页面即使不可见也会同时挂载在同一个 `Suspense` 下；任一页面异常都可能卸载整个应用根节点。

## Assumptions (temporary)

* 白屏可能发生在首次加载、页面导航、窗口恢复或渲染进程异常后的任一阶段。
* 应优先修复根因；恢复机制不能掩盖持续崩溃或形成无限重载。

## Requirements

* 修复必须针对已有证据确定的白屏触发链路。
* 不影响现有窗口生命周期、导航和业务功能。
* 对可恢复故障提供有界恢复，避免无限重载。
* Electron 主进程持久化记录页面加载、preload、无响应和渲染进程退出原因。
* React 根节点发生未捕获异常时展示可理解、可手动恢复的错误界面。

## Acceptance Criteria

* [x] 已识别并记录白屏根因或明确的高风险缺口。
* [x] 对应修复具有自动化测试覆盖。
* [x] 主文档加载失败或渲染进程意外退出时最多自动恢复一次，不形成重载循环。
* [x] React 未捕获异常不会留下纯白窗口，并允许用户手动重新加载。
* [x] 子框架加载失败和预期导航取消不会触发整页恢复。
* [x] 应用构建、类型检查、Lint 和相关测试通过。
* [x] 修复不覆盖或回退用户现有未提交改动。

## Definition of Done

* Tests added or updated where appropriate.
* Lint, type-check, and relevant tests pass.
* Documentation or specs updated only if behavior or conventions change.
* Recovery behavior is bounded and rollback risk is considered.

## Out of Scope

* 与白屏无关的 UI 重构或功能调整。
* 自动提交代码或清理用户现有改动。
* 没有故障证据支撑的 GPU、硬件加速或 Chromium 启动参数调整。

## Technical Approach

* 将 Electron 页面加载与恢复逻辑提取为可测试模块，由主窗口在创建后绑定。
* 监听主框架加载失败、preload 失败、渲染进程退出和无响应事件，并将详情写入持久化日志。
* 仅对意外主框架加载失败或渲染进程异常执行一次自动恢复；成功完成加载后重置恢复预算。
* 对无响应事件采用延迟确认，窗口在期限内恢复则取消操作，否则终止失效渲染进程后重载。
* 在 React 根节点增加错误边界，展示明确错误状态和手动重新加载操作。

## Decision (ADR-lite)

**Context**: 当前主进程没有渲染生命周期诊断或恢复，React 根节点也没有异常隔离，单层修复无法覆盖常见白屏类型。

**Decision**: 采用用户确认的分层方案，同时增加 Electron 有界自动恢复和 React 可见错误兜底。

**Consequences**: 可自动恢复一次瞬时故障并保留诊断信息；持续性故障不会无限重载，而会停留在可操作的错误状态。修复增加少量窗口生命周期代码和针对性测试。

## Technical Notes

* 研究记录：[`research/electron-renderer-recovery.md`](research/electron-renderer-recovery.md)。
* 官方参考：[`webContents`](https://electronjs.org/docs/latest/api/web-contents)。
* 推荐方案：主进程生命周期监控与一次性自动恢复 + React 根错误边界与手动重载。
* 不采用无证据的 GPU 禁用开关；当前日志没有 GPU 进程异常记录。
