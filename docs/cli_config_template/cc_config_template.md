## Claude code 配置模板 ##

## setting.json (路径：~/.claude/setting.json)
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://anyrouter.top",   # URL需要去对应的站点确认
    "ANTHROPIC_AUTH_TOKEN": "sk-xxxxxxxxxxxxxxxx",   # 中转站使用这个，默认使用
    #"ANTHROPIC_API_KEY": "sk-xxxxxxxxxxxxxxxxxx",   # 标准 Anthropic 形式接口使用这个
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_MODEL": "claude-opus-4-5-20251101",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "true",
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "HTTP_PROXY": "http://127.0.0.1:7890"
  },
  "includeCoAuthoredBy": false
}

## config.json (路径：~/.claude/config.json)
## 该文件仅配置一次即可，primaryApiKey填写任意字符即可
{
  "primaryApiKey": "any"
}