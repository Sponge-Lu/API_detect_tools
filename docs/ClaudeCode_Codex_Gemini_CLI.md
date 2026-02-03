# Claude Code, Codex, & Gemini CLI 调研报告

> **状态**: 已整合
> **背景**: 关于主要 AI CLI 工具的 API 兼容性、配置优先级和兼容性测试的调研。

## 1. 概述与对比

本文档整合了关于 **Claude Code**、**Codex (OpenAI)** 和 **Gemini CLI** 的 API 行为、配置优先级以及兼容性测试要求的调研结果。

### API 格式对比

| 特性 | Claude Code | Codex (OpenAI) | Gemini CLI |
|---------|-------------|----------------|------------|
| **端点 (Endpoint)** | `/v1/messages` | `/v1/chat/completions` 或 `/v1/responses` | `/v1beta/models/{model}:generateContent` |
| **认证头 (Auth Header)** | `x-api-key` | `Authorization: Bearer` | URL `?key=` 或 `x-goog-api-key` |
| **消息字段** | `messages` | `messages` | `contents` |
| **工具字段** | `tools[].input_schema` | `tools[].function.parameters` | `tools[].functionDeclarations` |
| **Token 限制** | `max_tokens` | `max_tokens` | `generationConfig.maxOutputTokens` |
| **流式 (Stream)** | 可选 | 默认 `true` | 可选 |

---

## 2. CLI 详细规范

### 2.1 Claude Code

**官方仓库**: [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code)

#### API 规范
*   **端点**: `/v1/messages`
*   **Header**:
    *   `x-api-key: <API_KEY>` (注意: 不是 Bearer)
    *   `anthropic-version: 2023-06-01`
    *   `Content-Type: application/json`
*   **工具定义**: 使用 `input_schema` (JSON Schema)。

#### 配置优先级 (从高到低)
1.  **企业托管配置**: `managed-settings.json` (系统级)
2.  **CLI 参数**: 运行时覆盖。
3.  **环境变量**:
    *   `ANTHROPIC_BASE_URL` (**中转/代理的关键配置**)
    *   `ANTHROPIC_API_KEY`
4.  **本地项目配置**: `.claude/settings.local.json`
5.  **共享项目配置**: `.claude/settings.json`
6.  **用户配置**: `~/.claude/settings.json`

#### 兼容性测试载荷 (Tool Use)
为了验证 CLI 兼容性（区别于普通 Chat API），发送带 tools 的请求：

```http
POST /v1/messages
Headers:
  x-api-key: <API_KEY>
  anthropic-version: 2023-06-01
```

```json
{
  "model": "claude-3-haiku-20240307",
  "max_tokens": 1,
  "messages": [{ "role": "user", "content": "hi" }],
  "tools": [{
    "name": "test_tool",
    "description": "Compatibility check",
    "input_schema": { "type": "object", "properties": {} }
  }]
}
```

---

### 2.2 Codex (OpenAI)

**官方仓库**: [github.com/openai/codex](https://github.com/openai/codex)

#### API 规范
*   **端点**:
    *   Chat API: `/v1/chat/completions`
    *   Responses API: `/v1/responses` (高级特性)
*   **Header**: `Authorization: Bearer <API_KEY>`
*   **工具定义**: 使用 `function.parameters` (OpenAI 格式)。

#### 配置优先级 (从高到低)
1.  **CLI 参数**: 如 `--model`, `--config`
2.  **Profile 配置**: `config.toml` 中的 `[profiles.<name>]`
3.  **根配置**: `~/.codex/config.toml`
    *   关键设置: `base_url`, `wire_api` (`chat` 或 `responses`)
4.  **默认值**: 内置值。

#### 兼容性测试载荷
**注意**: Codex 通常默认为 `stream: true`。

```http
POST /v1/chat/completions
Headers: Authorization: Bearer <API_KEY>
```

```json
{
  "model": "gpt-4o-mini",
  "max_tokens": 1,
  "stream": true,
  "messages": [{ "role": "user", "content": "hi" }],
  "tools": [{
    "type": "function",
    "function": {
      "name": "test_tool",
      "description": "Compatibility check",
      "parameters": { "type": "object", "properties": {} }
    }
  }]
}
```

#### 实现说明: 双 API 支持
Codex 支持两种 `wire_api` 模式。稳健的实现应该测试两者：
1.  **Chat**: 标准 `/v1/chat/completions`。
2.  **Responses**: `/v1/responses` (高保真 completions)。
    *   *建议*: 同时测试。如果 `responses` 可用，优先使用它，因为它支持更丰富的 Codex 特性。

---

### 2.3 Gemini CLI

**官方仓库**: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)

#### API 规范
*   **原生端点**: `/v1beta/models/{model}:generateContent`
*   **认证**: URL 参数 `?key=<API_KEY>` 或 Header `x-goog-api-key`。
*   **消息格式**: `contents` -> `parts` -> `text`。

#### 配置优先级 (从高到低)
1.  **CLI 参数**
2.  **环境变量**: `GEMINI_API_KEY`, `GOOGLE_API_KEY`
3.  **系统设置**: `/etc/gemini-cli/system-defaults.json` (**覆盖项目配置!**)
4.  **项目设置**: `.gemini/settings.json`
5.  **用户设置**: `~/.gemini/settings.json`

#### 认证模式
`security.auth.selectedType` 字段决定行为：
1.  `google-login` (OAuth): 使用官方 Google API。大多数情况下会**忽略** `base_url` 覆盖。
2.  `gemini-api-key`: 使用 Key/BaseURL。
3.  `vertex-ai`: 使用 Google Cloud。

#### 兼容性测试载荷 (原生)

```http
POST /v1beta/models/gemini-2.0-flash:generateContent?key=<API_KEY>
```

```json
{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "hi" }]
  }],
  "tools": [{
    "functionDeclarations": [{
      "name": "test_tool",
      "description": "Compatibility check",
      "parameters": { "type": "object", "properties": {} }
    }]
  }],
  "generationConfig": { "maxOutputTokens": 1 }
}
```

#### 实现说明: 代理兼容性
许多提供 Gemini 模型的 OpenAI 兼容代理/中转站**不支持**原生的 Google `/v1beta/...` 格式。它们通常期望标准的 OpenAI `/v1/chat/completions` 格式。
*   **稳健策略**: 先测试原生格式。如果失败，回退到使用 Gemini 模型名称测试 OpenAI 兼容格式。

---

## 3. 实现陷阱与解决方案

### P1. 模型选择逻辑
**问题**: 类似 `models.find(m => m.startsWith('claude-'))` 的逻辑太脆弱。
**现实**: 中转站使用别名 (如 `claude3-opus`, `gpt4o`, `gemini-pro`)。
**方案**: 使用灵活的正则匹配。
*   Claude: `/^claude[-_]?/i`, `/^anthropic[-_]?/i`
*   GPT: `/^gpt[-_]?/i`, `/^o[134][-_]?/i`
*   Gemini: `/^gemini[-_]?/i`, `/^google[-_]?/i`

### P2. "假" 200 OK 响应
**问题**: 即使上游失败或 API 路径无效（返回 HTML 错误页或 JSON 错误对象），某些代理仍对所有请求返回 `200 OK`。
**方案**: 严格的 Body 验证。
*   检查 `Response.ok`。
*   检查 body **不**包含 `error` 字段。
*   JSON 解析错误视为失败。

### P3. 配置 vs. OAuth
**问题**: 当用户通过 OAuth 登录（例如 Gemini 的 `google-login` 或 Codex 的 ChatGPT 登录）时，CLI 通常会**忽略**配置文件中的本地 `base_url` 设置，转而使用官方端点。
**方案**:
*   检测 "登录状态"（OAuth token 是否存在）。
*   如果已登录 + `forced_login_method` 不是 `api`: 假定使用**官方 API** (订阅制)。
*   仅在纯粹使用 API Key 认证时检查 `base_url` / 代理兼容性。

---

## 4. 需求总结 (项目特定)

| 需求 | 决定 |
|-------------|----------|
| **触发方式** | 单个站点手动测试（需先配置 CLI）。 |
| **模型选择** | 允许用户在配置对话框中手动选择。 |
| **展示** | 在通过列后追加官方 Logo。 |
| **流式测试 (Stream)** | 否（除非 Codex 默认强制开启）。 |
| **Gemini 格式** | 优先测试原生 (`/v1beta`)。建议保留回退逻辑。 |
