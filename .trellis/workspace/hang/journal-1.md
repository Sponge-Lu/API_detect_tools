# Journal - hang (Part 1)

> AI development session journal
> Started: 2026-04-16

---


## Session 1: 实现配置字段级加密，删除错误的备份加密

**Date**: 2026-06-23
**Task**: 实现配置字段级加密，删除错误的备份加密
**Branch**: `main`

### Summary

实现 AES-256-GCM 字段级加密模块，集成到 UnifiedConfigManager 和 CustomCliConfigService，删除错误的备份级加密实现。加密 sites/accounts 的 token 和 CustomCliConfig 的 apiKey。磁盘上敏感字段始终加密，内存中保持明文。所有配置管理测试通过 (30/30)。

### Main Changes

- 增加 Electron 渲染生命周期诊断与有界恢复。
- 增加 React 根错误边界和可见重载入口。
- 保留所有源码与测试改动在工作区，未纳入本次提交。

### Git Commits

| Hash | Message |
|------|---------|
| `08c0053` | (see git log) |

### Testing

- [OK] 相关测试、Lint、构建及 Electron 运行态检查通过。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 修正 CLI 配置归属 + 规范化测试模型

**Date**: 2026-06-24
**Task**: 修正 CLI 配置归属 + 规范化测试模型
**Branch**: `main`

### Summary

1. 修正 CLI 配置归属错误（PRD 决策 2 从站点级改为账户级）\n2. 更新类型定义（Site 删除 cli_config，AccountCredential 恢复 cli_config）\n3. 修正迁移逻辑和代码引用\n4. 新增：规范化测试模型列表（旧版本遗留多个模型，当前只支持 1 个，自动截断）

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e40a08b` | (see git log) |
| `905c584` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 修复散点矩阵残留已删除通道数据

**Date**: 2026-06-24
**Task**: 修复散点矩阵残留已删除通道数据
**Branch**: `main`

### Summary

删除站点/直连配置后，通道健康散点矩阵仍显示截断的残留 ID。新增 knownSiteIds 集合过滤已不存在的通道点。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2dfac9c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Remove Gemini CLI support

**Date**: 2026-07-08
**Task**: Remove Gemini CLI support
**Branch**: `main`

### Summary

Removed Gemini CLI integration from the supported app surface, updated docs/specs/indexes, preserved generic Google/Gemini GenerateContent protocol support, and archived the Trellis task without committing code.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 可迁移两文件备份与隔离浏览器恢复

**Date**: 2026-07-15
**Task**: 可迁移两文件备份与隔离浏览器恢复
**Branch**: `main`

### Summary

实现 portable-config 仅打包 config.json + custom-cli-configs.json；手动/WebDAV/导出统一该策略；恢复后为 isolated_profile 账户重绑本机 slot 目录；补齐导出导入 IPC；测试通过并完成本地 commit 与任务归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7ccf3f7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## 2026-07-15 — 禁用通道仍被路由请求 debug（不改代码）

### Task

`07-15-07-15-disabled-channel-still-routed`

### Findings

- 「禁用」有 5 种语义；只有 priority 禁用 / site.enabled / path.disabledUntil 会挡路由
- CLI `enabled=false`（托管站 cli_config + 自定义 CLI cliSettings）只影响 probe，不影响 `resolveChannels`
- custom CLI 的 fetched/manual models 会以全部 CLI types 进入 registry
- expandDisplayItemSourceKeys 会按同名 originalModel 跨源回扩

### Spec updates

- `.trellis/spec/guides/cross-layer-thinking-guide.md` Mistake 12
- `.trellis/spec/backend/route-runtime.md` known gap note

### Status

Debug complete; no code change per user request.


## Session 6: 完成直连密钥操作与路由日志思考强度展示

**Date**: 2026-07-16
**Task**: 完成直连密钥操作与路由日志思考强度展示
**Branch**: `main`

### Summary

为直连配置的 API Key 增加显示与复制按钮；路由日志新增本地 CLI 思考强度列并扩大默认窗口宽度，完成验证与任务归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2a7875c` | (see git log) |
| `d93d9f7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## 2026-07-16 — 纠正：优先级表禁用仍被路由

### Clarification

用户明确是重定向模型规则优先级排序表禁用，不是 CLI enabled。

### Corrected causes (priority table only)

1. 禁用 toggle 只改 draft，必须「保存优先级」
2. disabled 绑定单个 displayItem/canonicalModel，不是全局
3. 「路由规则」对话框用旧 item 快照回写可冲掉 disabled（真实代码 bug）
4. 只禁了 Key 时同站其它 Key 仍会请求

### Spec

- cross-layer Mistake 13
- route-runtime priority disable scope + stale overwrite note


## Session 7: OpenCode 默认 Responses 与思考参数配置

**Date**: 2026-07-16
**Task**: OpenCode 默认 Responses 与思考参数配置
**Branch**: `main`

### Summary

OpenCode 第三方供应商配置默认使用 Responses；OpenAI 模型写入 high 思考强度，Anthropic 模型写入 16000 token 思考预算，并统一配置预览、兼容性测试与路由默认协议。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `afa5dd9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 完成 CLI 路由思考强度选择器

**Date**: 2026-07-17
**Task**: 完成 CLI 路由思考强度选择器
**Branch**: `main`

### Summary

新增按 CLI 配置的思考强度覆盖、自定义下拉选项与行内删除操作，并完成请求改写、日志取值和回归测试。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `58d3387` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 合并站点管理检测设置

**Date**: 2026-07-22
**Task**: 合并站点管理检测设置
**Branch**: `main`

### Summary

将检测设置迁移到站点管理页，合并 CLI 探测与站点刷新设置弹窗，统一单列布局并补充回归测试。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ff49756` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 修复应用频繁白屏

**Date**: 2026-07-22
**Task**: 修复应用频繁白屏
**Branch**: `main`

### Summary

完成 Electron 渲染进程有界恢复与 React 根错误边界，相关测试、Lint、构建和运行态检查通过；源码按要求保留在工作区未提交。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
