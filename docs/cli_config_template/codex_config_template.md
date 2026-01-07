## Codex 配置模板 ##

## config.toml (路径：~/.codex/config.toml)
model_provider = "IkunCoding"
model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.IkunCoding]
name = "ikun"
base_url = "https://api.ikuncode.cc/v1"
# wire_api 选项：
# - "responses": 使用 Responses API (推荐，功能更强，支持 Agent 能力)
# - "chat": 使用 Chat Completions API (兼容性更好，大多数中转站支持)
# 
# 如何选择：
# - 如果测试结果显示 responses=✓，优先使用 "responses"
# - 如果只有 chat=✓，使用 "chat"
# - 如果都不支持，建议先使用 "chat" 尝试
wire_api = "responses"
requires_openai_auth = true

[features]
web_search_request = true

## auth.json (路径：~/.codex/auth.json)
{
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxx"
}