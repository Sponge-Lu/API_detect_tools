# shared/config

跨主进程与渲染进程复用的纯配置构建器，不读取运行时状态或文件系统。

| 文件 | 职责 | 关键导出 |
|------|------|----------|
| `builtin-client-configs.ts` | 四个内置客户端的完整配置文件唯一来源 | `buildBuiltinRouteConfigFiles()`, `buildClaudeCodeConfigFiles()`, `buildCodexConfigFiles()` |
