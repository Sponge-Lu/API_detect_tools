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
# wire_api 固定使用 "responses" (Responses API，chat 模式已废弃)
wire_api = "responses"
requires_openai_auth = true

# web_search 选项："cached", "live", "disabled"
web_search = "cached"

## auth.json (路径：~/.codex/auth.json)
{
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxx"
}