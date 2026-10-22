# Agent Icons

Selected product marks vendored from [`@lobehub/icons-static-svg` 1.94.0](https://www.npmjs.com/package/@lobehub/icons-static-svg), maintained in the [Lobe Icons repository](https://github.com/lobehub/lobe-icons) under the MIT license.

Only assets referenced by `AgentLogo.tsx` are included. Product names and marks remain the property of their respective owners.

`continue.png` comes from the [official Continue VS Code extension](https://github.com/continuedev/continue/blob/main/extensions/vscode/media/icon.png).

## 新增图标时的约定

- 命名：`<slug>-color.svg`（有彩色版就用彩色版），单色版才需要 `darkInvert`。
- 来源：优先 `@lobehub/icons-static-svg@1.94.0`，保证与既有图标同一套视觉；  
  取法 `https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/<slug>-color.svg`。
- 落地后必须同时改三处：`AGENT_LOGO_IDS`（`shared/types/config-file-profile.ts`）、  
  `AGENT_LOGOS`、`AGENT_ALIASES`（`renderer/components/AgentLogo.tsx`）；  
  后两者是 `satisfies Record<AgentLogoId, …>`，漏改会直接编译报错。
- 别名（`AGENT_ALIASES`）用于从 `agentId` / 卡片名自动匹配，长度 ≥4 的别名还会参与包含匹配，  
  所以不要放太短太泛的词（例如 `ai`、`cli`）。

## 图标库里没有、但值得补的客户端

下面这些是常见 AI 编程客户端，但 `@lobehub/icons-static-svg@1.94.0` **没有**对应图标（已逐个探测 404），  
需要从各自官方仓库取品牌标或自绘后再落地：

| 客户端               | 建议来源                                                |
| ----------------- | --------------------------------------------------- |
| Augment Code      | 官网 brand kit / 扩展商店图标                               |
| Zed               | <https://github.com/zed-industries/zed> 的 `assets/` |
| Aider             | <https://github.com/Aider-AI/aider> 文档站 favicon     |
| Crush（Charm）      | <https://github.com/charmbracelet/crush>            |
| iFlow CLI         | 官方文档站                                               |
| Droid（Factory）    | 官方文档站                                               |
| Warp              | 官网 brand assets                                     |
| Cody（Sourcegraph） | <https://sourcegraph.com/brand>                     |
| Tabnine           | 官网 brand assets                                     |
| Void              | <https://github.com/voideditor/void>                |

补这些之前先确认两件事：① 商标使用是否允许随应用分发；② 该客户端**是否真的会被代理识别**  
（见 `docs/CLIENT_SESSION_IDENTITY_AUDIT.md`）——图标再全，拿不到会话身份的客户端也不会出现在路由卡片上。
