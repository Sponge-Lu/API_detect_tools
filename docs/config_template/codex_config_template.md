## Codex 配置模板 ##

## config.toml
model_provider = "IkunCoding"               //去提供商获取
model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.IkunCoding]                //去提供商获取
name = "ikun"                               //去提供商获取
base_url = "https://api.ikuncode.cc/v1"
wire_api = "responses"
requires_openai_auth = true
env_key = "OPENAI_API_KEY"

[features]
web_search_request = true                   //可以不用

## auth.json
{
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxx"
}