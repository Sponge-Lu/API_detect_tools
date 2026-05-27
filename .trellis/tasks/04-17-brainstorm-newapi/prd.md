# 检查 newapi 站点添加回归与其他站点类型兼容性

## Goal

定位“添加 `newapi` 类型新站点时，浏览器已登录但终端提示未获取到 `access token`”的回归原因，比较当前版本与 `v2.1.24` 的站点添加链路差异，并评估其他站点类型在相同登录添加流程下是否存在同类问题。

## What I already know

* 用户报告：`newapi` 类型新站点添加失败，浏览器中已完成登录，但终端提示未获取到 `access token`。
* 用户报告：同一版本下添加 `sub2api` 类型站点是正常的。
* 当前仓库存在可比对的 `v2.1.24` tag：`f25eaa8c85ccdcb8ac0efc16320ccc829327eb78`。
* 当前支持的站点类型共有 8 种：`oneapi`、`newapi`、`veloera`、`onehub`、`donehub`、`voapi`、`superapi`、`sub2api`。
* 当前版本引入了 `src/main/site-type-registry.ts`，其中只有 `sub2api` 使用 `accessTokenMode: 'local-storage-only'`，其余 7 种都使用 `accessTokenMode: 'create-if-missing'`。
* 当前站点添加入口仍通过 `src/main/handlers/token-handlers.ts` -> `tokenService.initializeSiteAccount()` 完成。
* 当前版本新增了独立登录浏览器 `loginBrowserState`，并在登录态链路中使用 `chromeManager.createAccessTokenForLogin()` 创建 token。
* `v2.1.24` 的 `initializeSiteAccount()` 在 access token 缺失时会调用 `createAccessToken()`；该实现会在请求 `/api/user/token` 前检查当前页面域名，不一致时先导航回目标站点。
* 当前 `chromeManager.createAccessTokenForLogin()` 直接在登录浏览器当前页面执行 `fetch(${baseUrl}/api/user/token)`，没有像旧实现那样先保证页面位于目标站点域名。
* 当前 `chrome-manager.ts` 对 `sub2api` 做了额外识别与 localStorage 提取：`auth_user`、`auth_token`、`__APP_CONFIG__`、`siteTypeHint='sub2api'`。
* 新日志显示另一个独立问题：站点输入为 `http://muyuan.do/`，但页面内已能读到登录态；此时 API 验证阶段仍然请求 `http://muyuan.do/api/user/*` 并全部 `Failed to fetch`，说明 canonical URL 推断发生得太晚，没有覆盖“验证登录态”的 API 回退分支。
* 最新运行日志显示主链路已经恢复：`http://muyuan.do` 会在 API 验证前被修正为 `https://muyuan.do`，随后成功读取用户信息并创建 access token。
* 但日志里仍存在两类可优化点：
* 重复 API 请求：第一次 API 验证已经成功后，因 `accessToken` 仍为空，后续“API补全”又重复请求了一轮 `/api/user/self` 与 `/api/status`。
* 日志语义不准确：例如 `当前页面URL: :`、`数据来源: localStorage`、`session已过期` 这些文案不能准确反映当前真实状态。
* 已有测试覆盖了：
* `src/__tests__/token-service.test.ts`：`sub2api` 初始化、`site_type` 驱动分支、`local-storage-only` 行为。
* `src/__tests__/browser-login-flow.test.ts`：`newapi` 登录模式下 access token 缺失时应调用 `createAccessTokenForLogin()`。
* 现有测试没有覆盖“登录完成后当前页面不在目标域名，导致登录浏览器内创建 token 失败”的真实浏览器回归场景。

## Assumptions (temporary)

* `newapi` 回归很可能不是 localStorage 读取失败本身，而是“读取不到 token 后进入创建 token 分支，但登录浏览器上下文不在目标站点域名，导致 `/api/user/token` 创建失败”。
* 该问题理论上不仅影响 `newapi`，还可能影响所有 `accessTokenMode: 'create-if-missing'` 的站点类型。
* `sub2api` 不受影响，是因为其流程依赖 localStorage 中现成的 `auth_token`，不走 `createAccessTokenForLogin()`。
* 对 `newapi` / `oneapi` / `veloera` / `onehub` / `donehub` / `voapi` / `superapi` 来说，只要真实登录页从 `http` 升级到 `https`，API 验证阶段也会出现同类失败，除非 canonical URL 在第一次 API 请求前就被修正。

## Open Questions

* 无

## Requirements (evolving)

* 对比当前版本与 `v2.1.24` 的新站点添加链路，确认 `newapi` 回归点。
* 审计 8 种站点类型在“浏览器登录 -> 初始化站点 -> 获取/创建 access token”流程下的分支差异。
* 明确哪些站点类型确定正常、哪些站点类型存在同类风险、哪些需要运行时验证。
* 若进入实现阶段，修复应优先复用旧版已验证过的“先回到目标域名再创建 token”语义。
* 若进入实现阶段，补充回归测试，至少覆盖 `newapi` 与另一种 `create-if-missing` 站点类型。
* 在主链路恢复后，进一步减少重复 API 校验，并让日志表达与真实数据来源/错误类别一致。

## Technical Approach

* 共享修复点放在 `src/main/chrome-manager.ts` 的 `createAccessTokenForLogin()`，而不是在每个站点类型或调用方重复兜底。
* 创建 token 前先在登录浏览器中选择最合适的目标站点页；如果当前页不在目标域名，则先导航回站点，再调用 `/api/user/token`。
* canonical URL 推断需要前移到 `getUserDataFromApi()`，确保“验证登录态”的 `/api/user/self`、`/api/user/dashboard`、`/api/user` 也基于页面真实 origin 发起请求。
* 回归测试放在 `src/__tests__/browser-login-flow.test.ts`，覆盖：
* 登录浏览器存在目标站点页时优先复用。
* 登录浏览器当前页不在目标域名时先导航回站点。
* `page.url()` 不可用、但页面内 `location.href` 已经是 `https://...` 时，API 验证阶段应自动使用 `https://...`。
* 后续优化建议：
* 若第一次 API 验证已成功拿到 `userId` 且没有新增字段需求，则跳过第二轮“API补全”。
* `waitAndReadLocalStorage()` 的当前页面日志应优先使用 `resolveCurrentPageUrl()`，避免输出 `:` 这类无效值。
* `TokenService` 的“数据来源”日志应区分 `localStorage`、`API回退`、`混合来源`。

## Decision (ADR-lite)

**Context**: 用户选择“审计并直接修复共享问题”，目标是不仅解释 `newapi` 回归，还要让所有 `create-if-missing` 站点类型一起受益。
**Decision**: 在共享登录浏览器补 token 链路修复目标站点页选择与域名回跳，而不是按站点类型分别打补丁。
**Consequences**: `newapi`、`veloera`、`onehub`、`donehub`、`voapi`、`superapi`、`oneapi` 共用同一修复；`sub2api` 仍维持 `local-storage-only` 语义，不受此改动影响。

## Acceptance Criteria (evolving)

* [ ] 给出 `newapi` 回归的代码级证据，并能解释为何 `sub2api` 未受影响。
* [ ] 给出 8 种站点类型的添加链路风险矩阵。
* [ ] 若实施修复，`create-if-missing` 类型在登录浏览器上下文中能稳定创建 access token。
* [ ] 若实施修复，新增或更新测试以覆盖本次回归路径。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 与站点添加无关的路由、主题、工作台重构改动
* 对仓库中当前已存在的其他未提交改动做整理或回退
* 对所有真实第三方站点做在线人工逐站验证（若无现成测试环境）

## Technical Notes

* 关键文件：
* `src/main/token-service.ts`
* `src/main/chrome-manager.ts`
* `src/main/site-type-registry.ts`
* `src/main/site-type-detector.ts`
* `src/main/handlers/token-handlers.ts`
* `src/main/handlers/browser-profile-handlers.ts`
* `src/__tests__/token-service.test.ts`
* `src/__tests__/browser-login-flow.test.ts`
* `src/__tests__/site-editor.test.tsx`
* 关键差异：
* `v2.1.24` 没有当前这套 `site-type-registry` / `site-type-detector` / `loginBrowserState` 分流。
* 当前版本把“缺少 token 时是否允许自动创建”交给 `site_type` 配置控制。
* 当前版本为登录流程新增 `createAccessTokenForLogin()`，但其实现没有继承旧版 `createAccessToken()` 的“确保页面位于目标域名”步骤。
* 当前工作树是 dirty，需要避免误改无关文件。
