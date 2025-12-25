# CLI 兼容性测试调研报告

## 调研日期
2024-12-23 (更新: 2024-12-24)

## 问题描述
CLI兼容性测试结果不准确：
- 有的站点支持某个CLI但测试结果显示不支持
- 有的站点不支持某个CLI但测试结果显示支持

## 已实现的改进 (2024-12-24)

### Codex 双 API 测试
- 同时测试 Chat Completions API (`/v1/chat/completions`) 和 Responses API (`/v1/responses`)
- 测试结果保存详细信息 `codexDetail: { chat: boolean, responses: boolean }`
- 鼠标悬停 Codex 图标显示详细测试结果：`Codex: 支持 [chat: ✓, responses: ✗]`

### 自动选择 wire_api
- 根据测试结果自动选择最佳 `wire_api` 配置
- 优先级：`responses` > `chat`（responses 功能更强）
- 生成的配置文件包含测试结果注释

### 测试后自动更新配置
- 测试完成后自动更新已编辑的 Codex 配置文件中的 `wire_api`
- 更新配置文件中的 `wire_api` 值和测试结果注释
- 显示 toast 提示用户配置已自动更新（如 `Codex: 已自动设置 wire_api = "responses"`）

### 数据持久化
- `codexDetail` 保存到 `config.json` 的 `cli_compatibility` 字段
- 应用重启后保留测试结果

## 各CLI工具的API要求

### 1. Claude Code (Claude CLI)
**官方仓库**: https://github.com/anthropics/claude-code

**API端点**: `/v1/messages`

**认证方式**: 
- `x-api-key` header (中转站常用)
- 或 `ANTHROPIC_API_KEY` 环境变量

**请求格式**:
```json
{
  "model": "claude-xxx",
  "max_tokens": 1,
  "messages": [{"role": "user", "content": "hi"}],
  "tools": [{
    "name": "test_tool",
    "description": "A test tool",
    "input_schema": {
      "type": "object",
      "properties": {"test": {"type": "string"}},
      "required": []
    }
  }]
}
```

**必需Header**:
- `Content-Type: application/json`
- `x-api-key: <api_key>`
- `anthropic-version: 2023-06-01`

**关键特征**:
- 使用 `input_schema` 格式定义工具参数
- 需要 `anthropic-version` header

---

### 2. Codex (OpenAI Codex CLI)
**官方仓库**: https://github.com/openai/codex

**API端点**: `/v1/chat/completions` 或 `/v1/responses`

**认证方式**: 
- `Authorization: Bearer <api_key>`

**配置文件**: `~/.codex/config.toml`

**关键配置项**:
```toml
model_provider = "provider_name"
model = "gpt-xxx"

[model_providers.provider_name]
name = "provider_name"
base_url = "https://api.example.com/v1"
wire_api = "responses"  # 或 "chat"
requires_openai_auth = true
```

**请求格式** (Chat Completions API):
```json
{
  "model": "gpt-xxx",
  "max_tokens": 1,
  "messages": [{"role": "user", "content": "hi"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "test_tool",
      "description": "A test tool",
      "parameters": {
        "type": "object",
        "properties": {"test": {"type": "string"}},
        "required": []
      }
    }
  }]
}
```

**关键特征**:
- 支持两种 wire_api: `chat` (Chat Completions) 和 `responses` (Responses API)
- 工具使用 `function.parameters` 格式
- 需要 `Authorization: Bearer` 认证

---

### 3. Gemini CLI
**官方仓库**: https://github.com/google-gemini/gemini-cli

**API端点**: `/v1beta/models/{model}:generateContent`

**认证方式**: 
- URL参数: `?key=<api_key>`

**配置文件**: 
- `~/.gemini/settings.json`
- `~/.gemini/.env`

**请求格式**:
```json
{
  "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
  "tools": [{
    "functionDeclarations": [{
      "name": "test_tool",
      "description": "A test tool",
      "parameters": {
        "type": "object",
        "properties": {"test": {"type": "string"}},
        "required": []
      }
    }]
  }],
  "generationConfig": {
    "maxOutputTokens": 1
  }
}
```

**关键特征**:
- 使用 `functionDeclarations` 格式
- API Key 通过 URL 参数传递
- 端点格式包含模型名称

---

## 当前代码分析

### 问题1: 模型选择逻辑
当前代码使用 `selectLowestModel` 函数选择版本号最低的模型进行测试：

```typescript
const claudeModel = selectLowestModel(models, 'claude-');
const gptModel = selectLowestModel(models, 'gpt-');
const geminiModel = selectLowestModel(models, 'gemini-');
```

**潜在问题**:
1. 如果站点没有对应前缀的模型，会返回 `null`，导致测试被跳过
2. 某些站点可能使用非标准模型名称（如 `gpt4o` 而非 `gpt-4o`）
3. 版本号解析可能不准确

### 问题2: API端点构建
**Claude Code**:
```typescript
const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
```
- 正确

**Codex**:
```typescript
const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
```
- 问题：Codex 支持两种 wire_api (`chat` 和 `responses`)，当前只测试 `chat`

**Gemini CLI**:
```typescript
const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;
```
- 问题：某些中转站可能不支持 `/v1beta` 路径，或使用不同的端点格式

### 问题3: 响应判断逻辑
当前代码只检查 HTTP 状态码：
```typescript
return response.status >= 200 && response.status < 300;
```

**潜在问题**:
1. 某些站点可能返回 200 但响应体包含错误信息
2. 某些站点可能返回 400 但实际支持该API（只是请求参数有问题）
3. 没有检查响应体是否符合预期格式

### 问题4: 工具格式差异
不同CLI对工具定义的格式要求不同：
- Claude Code: `input_schema`
- Codex: `function.parameters`
- Gemini CLI: `functionDeclarations`

如果中转站对工具格式有严格验证，可能导致测试失败。

---

## 发现的具体问题

### 问题1: 模型名称匹配过于严格
当前代码只匹配以 `claude-`、`gpt-`、`gemini-` 开头的模型：
```typescript
const claudeModel = selectLowestModel(models, 'claude-');
const gptModel = selectLowestModel(models, 'gpt-');
const geminiModel = selectLowestModel(models, 'gemini-');
```

**实际情况**:
- 某些站点使用 `claude3` 而非 `claude-3`
- 某些站点使用 `gpt4o` 而非 `gpt-4o`
- 某些站点使用 `gemini1.5` 而非 `gemini-1.5`

### 问题2: Codex 只测试 Chat Completions API
当前代码只测试 `/v1/chat/completions` 端点：
```typescript
const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
```

**实际情况**:
- Codex 支持两种 wire_api: `chat` 和 `responses`
- 某些站点可能只支持 Responses API (`/v1/responses`)
- 应该同时测试两种API

### 问题3: Gemini CLI 端点格式不兼容
当前代码使用 Google 官方格式：
```typescript
const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;
```

**实际情况**:
- 大多数中转站使用 OpenAI 兼容格式
- 中转站通常不支持 `/v1beta/models/{model}:generateContent` 格式
- 应该使用 OpenAI 兼容的 `/v1/chat/completions` 格式

### 问题4: 响应验证不够严格
当前代码只检查 HTTP 状态码：
```typescript
return response.status >= 200 && response.status < 300;
```

**实际情况**:
- 某些站点返回 200 但响应体包含错误
- 某些站点返回 400 但实际支持该API（参数问题）
- 应该检查响应体内容

### 问题5: 缺少对中转站特殊格式的支持
中转站通常：
- 使用统一的 OpenAI 兼容格式
- 不区分 Claude/GPT/Gemini 的原生API格式
- 使用 Bearer Token 认证

---

## 建议修复方案

### 1. 改进模型选择逻辑
- 支持更灵活的模型名称匹配
- 添加模型别名映射
- 允许用户手动指定测试模型

### 2. 改进API端点检测
- 对于 Codex，同时测试 `chat` 和 `responses` 两种 wire_api
- 对于 Gemini CLI，支持多种端点格式

### 3. 改进响应验证
- 检查响应体是否包含预期字段
- 区分"不支持"和"请求错误"
- 添加更详细的错误信息

### 4. 添加重试机制
- 对于网络错误进行重试
- 对于超时错误增加超时时间

### 5. 改进工具格式
- 确保工具定义符合各CLI的要求
- 添加最小化的工具定义以减少验证失败

---

## 具体代码修改建议

### cli-compat-service.ts

#### 1. 改进模型匹配逻辑
```typescript
// 支持更多模型名称格式
function findModelByType(models: string[], type: 'claude' | 'gpt' | 'gemini'): string | null {
  const patterns: Record<string, RegExp[]> = {
    claude: [/^claude[-_]?/i, /^anthropic[-_]?/i],
    gpt: [/^gpt[-_]?/i, /^openai[-_]?/i, /^chatgpt[-_]?/i, /^o[134][-_]?/i],
    gemini: [/^gemini[-_]?/i, /^google[-_]?/i],
  };
  
  const regexList = patterns[type];
  for (const regex of regexList) {
    const match = models.find(m => regex.test(m));
    if (match) return match;
  }
  return null;
}
```

#### 2. 改进响应验证
```typescript
// 检查响应体是否表示成功
function isSuccessResponse(status: number, data: any): boolean {
  // 2xx 状态码
  if (status >= 200 && status < 300) {
    // 检查响应体是否包含错误
    if (data?.error) {
      return false;
    }
    return true;
  }
  
  // 某些 4xx 错误可能表示API存在但参数有问题
  if (status === 400) {
    // 检查是否是参数错误而非不支持
    const errorType = data?.error?.type || data?.error?.code;
    if (errorType === 'invalid_request_error' || errorType === 'invalid_api_key') {
      // API存在，只是参数问题
      return true;
    }
  }
  
  return false;
}
```

#### 3. 添加 Codex Responses API 测试
```typescript
// 构建 Codex Responses API 测试请求
function buildCodexResponsesRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/responses`;
  
  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      input: 'hi',
      // Responses API 格式
    },
  };
}

// 测试 Codex 时同时测试两种 API
async testCodex(url: string, apiKey: string, model: string): Promise<boolean> {
  // 先测试 Chat Completions API
  const chatResult = await this.testCodexChat(url, apiKey, model);
  if (chatResult) return true;
  
  // 再测试 Responses API
  const responsesResult = await this.testCodexResponses(url, apiKey, model);
  return responsesResult;
}
```

#### 4. 改进 Gemini CLI 测试（支持中转站）
```typescript
// 对于中转站，使用 OpenAI 兼容格式测试 Gemini
function buildGeminiCliRequestForProxy(baseUrl: string, apiKey: string, model: string): RequestFormat {
  // 中转站通常使用 OpenAI 兼容格式
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  
  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    },
  };
}

// 测试 Gemini CLI 时同时测试两种格式
async testGeminiCli(url: string, apiKey: string, model: string): Promise<boolean> {
  // 先测试 Google 原生格式
  const nativeResult = await this.testGeminiNative(url, apiKey, model);
  if (nativeResult) return true;
  
  // 再测试 OpenAI 兼容格式（中转站）
  const proxyResult = await this.testGeminiProxy(url, apiKey, model);
  return proxyResult;
}
```

---

## 核心问题总结

1. **模型匹配**: 需要支持更灵活的模型名称格式
2. **API格式**: 需要同时支持原生格式和中转站格式
3. **响应验证**: 需要更智能地判断API是否支持
4. **Codex双API**: 需要同时测试 Chat 和 Responses API
5. **Gemini中转站**: 需要支持 OpenAI 兼容格式
