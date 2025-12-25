# CLI 配置优先级调研报告

## 概述

本文档记录了 Claude Code、Codex、Gemini CLI 三个 CLI 工具的配置优先级调研结果。了解配置优先级对于正确显示当前生效的配置来源至关重要。

**核心问题**：当用户登录账号（如 Google 登录）时，站点配置可能会失效，但当前检测逻辑没有正确反映这一优先级关系。

---

## 1. Claude Code 配置优先级

### 官方文档来源
- [Claude Code Settings](https://docs.claude.com/en/docs/claude-code/settings)

### 配置优先级（从高到低）

1. **Enterprise 托管设置** (最高优先级)
   - 位置: `managed-settings.json` (系统级目录)
   - 无法被其他设置覆盖

2. **命令行参数**
   - 临时会话覆盖

3. **环境变量**
   - `ANTHROPIC_API_KEY` - API Key
   - `ANTHROPIC_AUTH_TOKEN` - 自定义 Authorization 头
   - `ANTHROPIC_BASE_URL` - 自定义 Base URL（**关键配置**）
   - `ANTHROPIC_MODEL` - 模型名称

4. **本地项目设置**
   - 位置: `.claude/settings.local.json`
   - 仅影响当前用户在此项目

5. **共享项目设置**
   - 位置: `.claude/settings.json`
   - 影响所有协作者

6. **用户设置** (最低优先级)
   - 位置: `~/.claude/settings.json`
   - 影响所有项目

### 认证方式优先级

Claude Code 支持多种认证方式：

1. **Claude.ai 账号登录** (OAuth)
   - 使用 Claude Max 订阅
   - 登录后凭证缓存在 `~/.claude.json`

2. **API Key 认证**
   - 通过 `ANTHROPIC_API_KEY` 环境变量
   - 或通过 `settings.json` 中的 `apiKeyHelper`

3. **自定义端点**
   - 通过 `ANTHROPIC_BASE_URL` 环境变量
   - 或通过 `settings.json` 中的 `env.ANTHROPIC_BASE_URL`

### 关键发现

- **当用户通过 OAuth 登录 Claude.ai 账号时**，会使用官方 API，此时 `settings.json` 中的 `ANTHROPIC_BASE_URL` 配置**仍然生效**
- 环境变量优先级高于 `settings.json` 中的配置
- `apiKeyHelper` 可以动态生成认证信息

### 配置文件结构

```json
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://example.com",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_API_KEY": "sk-xxx"
  }
}
```

---

## 2. Codex (OpenAI) 配置优先级

### 官方文档来源
- [Configuring Codex](https://developers.openai.com/codex/local-config)

### 配置优先级（从高到低）

1. **命令行参数** (最高优先级)
   - 如 `--model`, `--config model_provider="xxx"`
   - 覆盖所有其他配置

2. **Profile 配置**
   - 在 `config.toml` 中定义的 `[profiles.<name>]`
   - 通过 `--profile <name>` 或 `profile = "xxx"` 激活

3. **config.toml 根级配置**
   - 位置: `~/.codex/config.toml`

4. **内置默认值** (最低优先级)
   - CLI 内置的默认配置

### 认证方式

1. **ChatGPT 账号登录** (OAuth)
   - 使用 OpenAI 账号登录
   - 凭证缓存在本地

2. **API Key 认证**
   - 通过 `~/.codex/auth.json` 中的 `OPENAI_API_KEY`
   - 或通过环境变量 `OPENAI_API_KEY`
   - 或通过 `model_providers.<id>.env_key` 指定的环境变量

### 关键发现

- **当用户通过 ChatGPT 登录时**，会使用官方 API，此时 `config.toml` 中的 `base_url` 配置**可能被忽略**
- `model_provider` 决定使用哪个 provider 的配置
- 每个 provider 可以有独立的 `base_url` 和认证配置
- `forced_login_method` 可以限制登录方式为 `chatgpt` 或 `api`

### 配置文件结构

```toml
# ~/.codex/config.toml
model = "gpt-5"
model_provider = "custom"

[model_providers.custom]
name = "Custom Provider"
base_url = "https://example.com/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"
```

```json
// ~/.codex/auth.json
{
  "OPENAI_API_KEY": "sk-xxx"
}
```

### 登录状态检测

- 需要检查是否存在 ChatGPT OAuth 凭证
- 如果存在 OAuth 凭证，可能会覆盖 API Key 配置

---

## 3. Gemini CLI 配置优先级

### 官方文档来源
- [Gemini CLI Configuration](https://geminicli.com/docs/get-started/configuration/)
- [Gemini CLI Authentication](https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html)

### 配置优先级（从高到低）

1. **命令行参数** (最高优先级)
   - 启动 CLI 时传递的参数

2. **环境变量**
   - 系统级或会话级变量
   - 可从 `.env` 文件加载

3. **系统设置文件** (System settings)
   - 位置: 
     - Linux: `/etc/gemini-cli/system-defaults.json`
     - Windows: `C:\ProgramData\gemini-cli\system-defaults.json`
     - macOS: `/Library/Application Support/GeminiCli/system-defaults.json`
   - **覆盖所有其他设置文件**

4. **项目设置文件**
   - 位置: `.gemini/settings.json` (项目目录)

5. **用户设置文件**
   - 位置: `~/.gemini/settings.json`

6. **系统默认文件** (System defaults)
   - 位置: 同系统设置文件
   - **可被其他设置文件覆盖**

7. **内置默认值** (最低优先级)
   - 应用程序内置的默认配置

### 认证方式优先级

Gemini CLI 支持三种认证方式，**认证方式的选择会影响配置的生效**：

1. **Google 账号登录** (推荐)
   - 通过 OAuth 登录 Google 账号
   - **如果是 Google AI Pro/Ultra 订阅用户，必须使用此方式**
   - 凭证缓存在本地
   - 配置: `settings.json` 中 `security.auth.selectedType = "google-login"`

2. **Gemini API Key**
   - 通过 `GEMINI_API_KEY` 环境变量
   - 或通过 `.gemini/.env` 文件
   - 配置: `settings.json` 中 `security.auth.selectedType = "gemini-api-key"`

3. **Vertex AI**
   - 使用 Google Cloud 的 Vertex AI 平台
   - 需要设置 `GOOGLE_CLOUD_PROJECT` 和 `GOOGLE_CLOUD_LOCATION`
   - 配置: `settings.json` 中 `security.auth.selectedType = "vertex-ai"`

### 关键发现

- **当用户选择 Google 登录时**，会使用官方 API，此时 `.env` 中的 `GOOGLE_GEMINI_BASE_URL` 配置**可能被忽略**
- `security.auth.selectedType` 决定使用哪种认证方式
- 环境变量 `GEMINI_API_KEY` 和 `GOOGLE_API_KEY` 都可以设置 API Key，但 `GOOGLE_API_KEY` 优先级更高
- `.env` 文件加载顺序：当前目录 → 父目录（直到项目根目录或 home 目录）→ `~/.gemini/.env` → `~/.env`

### 配置文件结构

```json
// ~/.gemini/settings.json
{
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"  // 或 "google-login" 或 "vertex-ai"
    }
  }
}
```

```dotenv
# ~/.gemini/.env
GEMINI_API_KEY=xxx
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_GEMINI_BASE_URL=https://example.com
```

---

## 4. 配置优先级对比总结

| 特性 | Claude Code | Codex | Gemini CLI |
|------|-------------|-------|------------|
| **最高优先级** | Enterprise 托管设置 | 命令行参数 | 命令行参数 |
| **环境变量优先级** | 高于 settings.json | 取决于 env_key 配置 | 高于 settings.json |
| **账号登录影响** | 不影响 base_url | 可能覆盖 base_url | 可能覆盖 base_url |
| **配置文件位置** | `~/.claude/settings.json` | `~/.codex/config.toml` | `~/.gemini/settings.json` |
| **认证类型字段** | 无明确字段 | `forced_login_method` | `security.auth.selectedType` |

---

## 5. 当前实现问题分析

### 问题描述

当前的 `config-detection-service.ts` 实现存在以下问题：

1. **未考虑认证方式优先级**
   - Gemini CLI: 当 `selectedType = "google-login"` 时，应显示为 "subscription" 而非检测 base_url
   - Codex: 未检测是否使用 ChatGPT OAuth 登录

2. **未正确处理环境变量优先级**
   - 当前只读取配置文件，未检测系统环境变量
   - 环境变量可能覆盖配置文件中的设置

3. **未检测登录状态**
   - 未检测 OAuth 凭证是否存在
   - 无法判断用户是否已登录官方账号

### 建议修复方案

1. **Gemini CLI**
   - 首先检查 `security.auth.selectedType`
   - 如果是 `google-login`，直接返回 `subscription` 类型
   - 只有当是 `gemini-api-key` 时，才检测 base_url

2. **Codex**
   - 检测是否存在 ChatGPT OAuth 凭证
   - 如果存在且未配置 `forced_login_method = "api"`，可能使用官方 API

3. **Claude Code**
   - 检测 OAuth 凭证状态
   - 环境变量优先于 settings.json

---

## 6. 参考资料

- [Claude Code Settings Documentation](https://docs.claude.com/en/docs/claude-code/settings)
- [Configuring Codex](https://developers.openai.com/codex/local-config)
- [Gemini CLI Configuration](https://geminicli.com/docs/get-started/configuration/)
- [Gemini CLI Authentication](https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html)
