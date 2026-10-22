# 📁 src/main/types/ - 主进程类型转发

## 架构说明

**职责**: 主进程侧的类型入口。当前**只有 `token.ts` 一个文件**，且只是把 `src/shared/types/site.ts` 里的站点/账户/检测/令牌相关类型重新导出，供主进程内部按短路径引用。

**特点**:
- 不定义新类型，只做 re-export（单一真源仍在 `shared/types/`）
- 主进程内部的 `import ... from './types/token'` 只是路径收敛，不构成独立类型层
- 真正需要跨进程共享的新类型应放在 `src/shared/types/`，不要加到这里

**依赖关系**:
- 依赖 `src/shared/types/site.ts`
- 被 `main/` 下的 `token-service.ts`、`api-service.ts` 等服务使用
- 不被 `renderer/` 使用

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **token.ts** | 重新导出共享站点/账户/检测/令牌类型 | `UnifiedConfig`, `UnifiedSite`, `SiteAccount`, `DetectionResult`, `ApiKeyInfo`, `CachedDisplayData`, `RefreshAccountResult`, `SiteStats` 等 21 个类型 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
