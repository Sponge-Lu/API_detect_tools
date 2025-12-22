## Gemini CLI 配置模板 ##

## settings.json (路径：~/.gemini/settings.json)
```json
{
  "general": {
    "previewFeatures": true
  },
  "ide": {
    "hasSeenNudge": true
  },
  "maxRetries": 3,
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  },
  "timeout": 30000
}
```

## .env (路径：~/.gemini/.env)
```dotenv
GEMINI_API_KEY=sk-xxxxxxxxxxxxxxxxx
GEMINI_MODEL=gemini-3-pro-high
GOOGLE_GEMINI_BASE_URL=https://x666.me
```
---

## 参考资料

- [Gemini CLI 官方文档](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI 认证配置](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md)
