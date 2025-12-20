# CLI 兼容性测试 - API 格式调研报告

## 概述

本文档记录了 Claude Code、Codex、Gemini CLI 等 CLI 工具的 API 兼容性测试请求格式调研结果。

**核心发现**：普通的 Chat 请求无法区分站点是否支持 CLI 工具，因为 CLI 工具使用了更多高级特性（如 Tool Use / Function Calling）。因此需要发送带 Tool Use 的请求来验证 CLI 兼容性。

---

## 1. Claude Code

### API 格式
- **端点**: `/v1/messages` (Anthropic Messages API)
- **认证**: `x-api-key` 头（非 `Authorization: Bearer`）

### 配置方式
- 环境变量: `ANTHROPIC_BASE_URL`
- 或通过 `apiKeyHelper` 配置

### CLI 兼容性测试请求（带 Tool Use）

```http
POST /v1/messages
Headers:
  x-api-key: <API_KEY>
  anthropic-version: 2023-06-01
  Content-Type: application/json
```

```json
{
  "model": "claude-3-haiku-20240307",
  "max_tokens": 1,
  "messages": [
    { "role": "user", "content": "hi" }
  ],
  "tools": [
    {
      "name": "test_tool",
      "description": "Test tool for compatibility check",
      "input_schema": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

### 关键特性
- 使用 `x-api-key` 头而非 `Authorization: Bearer`
- 需要 `anthropic-version` 头
- Tool 定义使用 `input_schema` 字段（非 `parameters`）

### 推荐测试模型
- `claude-3-haiku-20240307`（最便宜）

---

## 2. Codex (OpenAI)

### API 格式
- **端点**: `/v1/chat/completions` (OpenAI Chat Completions API)
- **认证**: `Authorization: Bearer <API_KEY>`

### 配置方式
- `~/.codex/config.toml` 中的 `base_url`
- 支持 `wire_api = "chat"` 或 `wire_api = "responses"`
- 支持多种 provider: openai, openrouter, azure, gemini, ollama, mistral, deepseek, xai, groq, arceeai 等

### CLI 兼容性测试请求（带 Tool Use）

```http
POST /v1/chat/completions
Headers:
  Authorization: Bearer <API_KEY>
  Content-Type: application/json
```

```json
{
  "model": "gpt-4o-mini",
  "max_tokens": 1,
  "messages": [
    { "role": "user", "content": "hi" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "test_tool",
        "description": "Test tool for compatibility check",
        "parameters": {
          "type": "object",
          "properties": {}
        }
      }
    }
  ],
  "stream": true
}
```

### 关键特性
- 使用标准 `Authorization: Bearer` 头
- Tool 定义嵌套在 `function` 字段内
- 使用 `parameters` 而非 `input_schema`
- Codex 默认使用流式响应（`stream: true`）

### 推荐测试模型
- `gpt-4o-mini`

---

## 3. Gemini CLI

### API 格式
- **端点**: `/v1beta/models/{model}:generateContent` (Gemini API)
- **认证**: URL 参数 `?key=<API_KEY>` 或 `x-goog-api-key` 头

### 配置方式
- 环境变量: `GEMINI_API_KEY`
- `CODE_ASSIST_ENDPOINT` 用于自定义端点
- `GEMINI_API_KEY_AUTH_MECHANISM` 可设置为 `bearer` 或 `x-goog-api-key`

### CLI 兼容性测试请求（带 Tool Use）

```http
POST /v1beta/models/gemini-2.0-flash:generateContent?key=<API_KEY>
Headers:
  Content-Type: application/json
```

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "hi" }]
    }
  ],
  "tools": [
    {
      "functionDeclarations": [
        {
          "name": "test_tool",
          "description": "Test tool for compatibility check",
          "parameters": {
            "type": "object",
            "properties": {}
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 1
  }
}
```

### 关键特性
- API Key 通过 URL 参数传递（或 `x-goog-api-key` 头）
- 消息格式使用 `contents` + `parts`（非 `messages` + `content`）
- Tool 定义使用 `functionDeclarations` 数组
- 使用 `generationConfig.maxOutputTokens` 而非 `max_tokens`

### 推荐测试模型
- `gemini-2.0-flash`

---

## 4. 其他（OpenAI 兼容）

### API 格式
- **端点**: `/v1/chat/completions` (OpenAI Chat Completions API)
- **认证**: `Authorization: Bearer <API_KEY>`

### 基础兼容性测试请求（无 Tool Use）

```http
POST /v1/chat/completions
Headers:
  Authorization: Bearer <API_KEY>
  Content-Type: application/json
```

```json
{
  "model": "gpt-4o-mini",
  "max_tokens": 1,
  "messages": [
    { "role": "user", "content": "hi" }
  ]
}
```

### 说明
此测试仅验证基础的 OpenAI 兼容性，适用于 Roo Code、Cherry Studio 等第三方应用。

---

## API 格式对比

| 特性 | Claude Code | Codex | Gemini CLI | 其他 |
|------|-------------|-------|------------|------|
| **端点** | `/v1/messages` | `/v1/chat/completions` | `/v1beta/models/{model}:generateContent` | `/v1/chat/completions` |
| **认证头** | `x-api-key` | `Authorization: Bearer` | URL 参数或 `x-goog-api-key` | `Authorization: Bearer` |
| **消息字段** | `messages` | `messages` | `contents` | `messages` |
| **Tool 字段** | `tools[].input_schema` | `tools[].function.parameters` | `tools[].functionDeclarations[].parameters` | `tools[].function.parameters` |
| **Token 限制** | `max_tokens` | `max_tokens` | `generationConfig.maxOutputTokens` | `max_tokens` |
| **流式响应** | 可选 | 默认开启 | 可选 | 可选 |

---

## 测试模型汇总

| CLI 类型 | 推荐测试模型 | 备注 |
|---------|-------------|------|
| Claude Code | `claude-3-haiku-20240307` | 最便宜的 Claude 模型 |
| Codex | `gpt-4o-mini` | 性价比最高 |
| Gemini CLI | `gemini-2.0-flash` | 快速且便宜 |
| 其他 | `gpt-4o-mini` | 通用测试 |

---

## 需求确认（已确定）

| 问题 | 决定 |
|------|------|
| **测试触发方式** | 手动，支持单个站点测试（需先配置 CLI 设置） |
| **测试模型选择方式** | 用户在 CLI 配置对话框中手动选择 API Key 和模型 |
| **结果展示方式** | 在更新时间后面加一列，使用官方 logo 显示（Claude Code/Codex/Gemini CLI），支持 Chat 则使用对话图标 |
| **额度消耗提醒** | 不提醒 |
| **是否测试流式响应** | 不需要 |
| **Gemini CLI 格式** | 使用原生格式（更可靠） |

---

## 参考资料

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Codex CLI Documentation](https://developers.openai.com/codex)
- [Gemini CLI Documentation](https://github.com/google-gemini/gemini-cli)
