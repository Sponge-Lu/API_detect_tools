# 📁 src/main/browser-runtime/ - 内置浏览器运行时

## 架构说明

**职责**: 解析随安装包分发的内置 Chromium（Chrome for Testing 产物），为浏览器降级链提供第一条主路径。

**特点**:
- 不依赖 Electron API（纯 Node `fs`/`path`），可单测
- 只做"内置浏览器是否存在且可用"的解析，不负责降级链本身（降级链在 `chrome-manager.getChromePath()`）
- 目录约定与 `package.json` 的 electron-builder `extraResources`（`${os}-${arch}` 宏）一致

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **bundled-resolver.ts** | 解析打包内置浏览器可执行文件路径：`<resources>/chromium/<os>-<arch>/`（os 为 electron-builder `buildConfigurationKey`：win/mac/linux，arch 为 `process.arch`）；要求平台目录内含对应可执行文件且带非空 `VERSION` 标记（由 `npm run fetch:chromium` 落地），缺失视为安装不完整。查找顺序：打包资源目录 → 仓库内 `resources/chromium`（开发态）；全部缺失返回 `null`，由调用方继续走本机浏览器降级链 | `resolveBundledBrowserPath()` |

---

## 🔄 配套设施

- `scripts/fetch-chromium.mjs`（`npm run fetch:chromium`）：从 Chrome for Testing 官方索引下载当前平台/架构的 Stable chrome 到 `resources/chromium/<os>-<arch>/`，拍平解包产物并写入 `VERSION` 标记。
- 背景与设计决策见 `docs/BROWSER_RUNTIME_REFACTOR_PLAN.md`（P1 内置 Chromium 运行时）。
