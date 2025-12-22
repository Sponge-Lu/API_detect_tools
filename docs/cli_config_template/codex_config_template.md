## Codex 配置模板 ##

## config.toml (路径：~/.codex/config.toml)
model_provider = "IkunCoding"               //去提供商获取正确名字
model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.IkunCoding]                //去提供商获取正确名字
name = "ikun"                               //去提供商获取正确名字
base_url = "https://api.ikuncode.cc/v1"
wire_api = "responses"
requires_openai_auth = true

[features]
web_search_request = true

## auth.json (路径：~/.codex/auth.json)
{
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxx"
}