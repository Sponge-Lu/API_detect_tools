# API 端点响应测试报告

> 生成时间: 2025-12-15T05:44:43.748Z
> 测试站点数: 31

---

## 随时跑路公益

- **URL**: https://runanytime.hxi.me/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_enabled": false,
    "chats": [],
    "check_in_enabled": true,
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_online_topup": false,
    "enable_task": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "idcflare_client_id": "",
    "idcflare_minimum_trust_level": 0,
    "idcflare_oauth": false,
    "linuxdo_client_id": "AHjK9O3FfbCXKpF6VXGBC60K21yJ2fYk",
    "linuxdo_minimum_trust_level": 2,
    "linuxdo_oauth": true,
    "log_chat_content_enabled": false,
    "logo": "",
    "min_topup": 1,
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "price": 7.3,
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://runanytime.hxi.me",
    "setup": true,
    "start_time": 1764660064,
    "system_name": "随时跑路公益",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": true,
    "turnstile_site_key": "0x4AAAAAAB6SBVfEcffIv4RW",
    "version": "v0.5.12",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": [
    {
      "model_name": "claude-sonnet-4-20250514-thinking",
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "2api",
        "default",
        "service"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "2api",
        "default",
        "service"
      ]
    },
    {
      "model_name": "chat-only/claude-sonnet-4-20250514",
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "chat-only"
      ]
    },
    {
      "model_name": "gemini-2.0-flash-thinking-exp",
      "quota_type": 0,
      "model_ratio": 0.05,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "service"
      ]
    },
    {
      "model_name": "gemini-2.5-flash",
      "quota_type": 0,
      "model_ratio": 0.15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8.333333333333334,
      "enable_groups": [
        "service"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101",
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "2api",
        "default",
        "service"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101-thinking",
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "2api",
        "default",
        "service"
      ]
    },
    {
      "model_name": "chat-only/gemini-2.5-pro",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "chat-only"
      ]
    },
    {
      "model_name": "chat-only/gpt-5-thinking",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "chat-only"
      ]
    },
    {
      "model_name": "gpt-5-codex",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "service"
      ]
    },
    {
      "model_name": "gpt-5.1-codex",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "service"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001",
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "2a
```

> ⚠️ 响应已截断（原始长度: 4335 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 2025121513351466384700495GGGNg6)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 409,
    "username": "linuxdo_409",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "b61icjibwts96j39FaZNsXhVJ4ZODh0=",
    "quota": 88902487,
    "used_quota": 194928057,
    "request_count": 947,
    "group": "default",
    "aff_code": "aOJq",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "subscription_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "idc_flare_id": "",
    "setting": "",
    "last_check_in_time": "2025-12-15T03:38:26.871Z"
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "JgGXYH18wXVy5ClhJfOX2Hy7FDMIiQ==",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "2api": {
      "desc": "2api",
      "ratio": 1
    },
    "chat-only": {
      "desc": "chat-only",
      "ratio": 0.5
    },
    "default": {
      "desc": "default",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## ThatAPI

- **URL**: https://gyapi.zxiaoruan.cn/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":false,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":true},\"docs\":false,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":false,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":false,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "GeminiCli逆向渠道上线",
        "extra": "模型可用度",
        "id": 4,
        "publishDate": "2025-11-30T04:06:13.023Z",
        "type": "success"
      },
      {
        "content": "【腾讯文档】公益站额度申请表-如有隐私需求请选择匿名\nhttps://docs.qq.com/form/page/DTHdCQXpZeHNiZFhG",
        "extra": "额度申请",
        "id": 3,
        "publishDate": "2025-11-17T05:27:47.909Z",
        "type": "default"
      },
      {
        "content": "Gemini不可用，其他可用",
        "extra": "模型可用度",
        "id": 2,
        "publishDate": "2025-11-15T11:14:48.011Z",
        "type": "default"
      }
    ],
    "announcements_enabled": true,
    "api_info_enabled": false,
    "chats": [],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "week",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "",
    "email_verification": false,
    "enable_batch_update": true,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [
      {
        "answer": "https://linux.do/t/topic/1294593?u=zhongruan",
        "id": 3,
        "question": "额度不够怎么办"
      },
      {
        "answer": "https://cdk.linux.do/receive/8dcb732d-c5bc-4dbc-b888-71389a01bc45",
        "id": 4,
        "question": "额度补给"
      }
    ],
    "faq_enabled": true,
    "footer_html": "<br >",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "doAqU5TVU6L7sXudST9MQ102aaJObESS",
    "linuxdo_minimum_trust_level": 2,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "https://gyapi.zxiaoruan.cn",
    "passkey_rp_id": "gyapi.zxiaoruan.cn",
    "passkey_user_verification": "preferred",
    "price": 7.3,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://gyapi.zxiaoruan.cn",
    "setup": true,
    "start_time": 1765598143,
    "stripe_unit_price": 8,
    "system_name": "ThatAPI",
    "telegram_b
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "claude-opus-4-1-20250805",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "CC编码专用分组",
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai",
        "anthropic"
      ]
    },
    {
      "model_name": "claude-opus-4-20250514",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "CC编码专用分组",
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai",
        "anthropic"
      ]
    },
    {
      "model_name": "claude-sonnet-4-20250514",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "CC编码专用分组",
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai",
        "anthropic"
      ]
    },
    {
      "model_name": "gpt-5.1-codex",
      "vendor_id": 5,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 7,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "Codex逆向",
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.2",
      "vendor_id": 5,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 10,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "Codex逆向",
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "glm-4.5-air",
      "vendor_id": 2,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "glm-4.6",
      "vendor_id": 2,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "通用模型"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "通用模���",
        "CC编码专用分组",
        "default"
      ],
      "supported_endpoint_types": [
        "openai",
        "anthropic"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      
```

> ⚠️ 响应已截断（原始长度: 4944 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215133532831721261hG4N8WPs)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "njw0",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 808,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 229050000,
    "request_count": 123,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 70950000,
    "username": "linuxdo_808",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "rQQ+FgpkkkkEBbRcTieYcJ7WPNBn",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "CC编码专用分组": {
      "desc": "转GLM",
      "ratio": 0.01
    },
    "Codex逆向": {
      "desc": "Codex逆向",
      "ratio": 0.5
    },
    "Gemini": {
      "desc": "Gemini",
      "ratio": 0.5
    },
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "翻译": {
      "desc": "翻译",
      "ratio": 0
    },
    "通用模型": {
      "desc": "通用模型",
      "ratio": 0.85
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 薄荷 API

- **URL**: https://x666.me
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "",
    "SidebarModulesAdmin": "",
    "announcements_enabled": false,
    "api_info_enabled": false,
    "chats": [
      {
        "CHECK": "https://check.crond.dev/?settings={\"key\":\"{key}\",\"url\":\"{address}\",\"models\":[\"gemini-2.5-pro-exp-03-25\"],\"timeout\":10,\"concurrency\":2,\"closeAnnouncement\":true,\"closeChat\":true}"
      },
      {
        "ChatGPT Next Web 官方示例": "https://app.nextchat.dev/#/?settings={\"key\":\"{key}\",\"url\":\"{address}\"}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": true,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq_enabled": false,
    "footer_html": "本站API适用于测试和体验目的，请自觉遵守您当地法律法规，切勿用于非法用途，本站不承担任何法律责任。",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "4OtAotK6cp4047lgPD4kPXNhWRbRdTw3",
    "linuxdo_minimum_trust_level": 0,
    "linuxdo_oauth": true,
    "logo": "https://i.111666.best/image/UQ3YrIrF59JZfaEFGJabrr.png",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "https://x666.me",
    "passkey_rp_id": "x666.me",
    "passkey_user_verification": "preferred",
    "price": 7.3,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://x666.me",
    "setup": true,
    "start_time": 1764243492,
    "stripe_unit_price": 8,
    "system_name": "薄荷 API",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "uptime_kuma_enabled": false,
    "usd_exchange_rate": 7.3,
    "user_agreement_enabled": false,
    "version": "v0.9.25",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [],
  "data": [
    {
      "model_name": "gemini-2.5-flash",
      "description": "Gemini 2.5 Flash 是由 google-vertex 提供的人工智能模型。",
      "icon": "Gemini.Color",
      "tags": "推理,工具,文件,多模态,音频,1M",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.001,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "level1",
        "level2",
        "level3"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-pro-1m",
      "icon": "Gemini.Color",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.002,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "level3"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "gpt-4o-mini",
      "description": "GPT-4o mini 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "工具,文件,多模态,128K",
      "vendor_id": 4,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.0001,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "Fovt",
        "level1",
        "level2",
        "level3"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-flash-latest",
      "description": "Gemini Flash Latest 是由 google-vertex 提供的人工智能模型。",
      "icon": "Gemini.Color",
      "tags": "推理,工具,文件,多模态,音频,1M",
      "vendor_id": 1,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.001,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "level1",
        "level2",
        "level3"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "gpt-4.1-mini",
      "description": "GPT-4.1 mini 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "工具,文件,多模态,1M",
      "vendor_id": 4,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.0001,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "Fovt",
        "level1",
        "level2",
        "level3"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-4.1-nano",
      "description": "GPT-4.1 nano 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "工具,文件,多模态,1M",
      "vendor_id": 4,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.0001,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "level2",
        "level3",
        "Fovt",
        "level1"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-5-thinking",
      "vendor_id": 5,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.002,
  
```

> ⚠️ 响应已截断（原始长度: 3371 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 202512151335504055660473SnxnDA3)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "yi9q",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "level3",
    "id": 5300,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 14267000,
    "request_count": 288,
    "role": 1,
    "setting": "",
    "sidebar_modules": "",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 258000,
    "username": "linuxdo_5300",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "xwgrzogmp55bEtNzkET4kzFkEQ84KA==",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "Fovt": {
      "desc": "OAI分组",
      "ratio": 1
    },
    "level1": {
      "desc": "默认分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## B4U公益站

- **URL**: https://b4u.qzz.io/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 403 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "announcements_enabled": false,
    "api_info_enabled": false,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_online_topup": false,
    "enable_stripe_topup": false,
    "enable_task": true,
    "faq_enabled": false,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "Cf3PtT3ecj4kzJrMvOGM48FrHFKYXusb",
    "linuxdo_oauth": true,
    "logo": "",
    "min_topup": 1,
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "pay_methods": [
      {
        "color": "rgba(var(--semi-blue-5), 1)",
        "name": "支付宝",
        "type": "alipay"
      },
      {
        "color": "rgba(var(--semi-green-5), 1)",
        "name": "微信",
        "type": "wxpay"
      }
    ],
    "price": 7.3,
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://b4u.qzz.io",
    "setup": true,
    "start_time": 1765625200,
    "stripe_min_topup": 1,
    "stripe_unit_price": 8,
    "system_name": "B4U公益站",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "https://cdk.linux.do/explore",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "uptime_kuma_enabled": false,
    "usd_exchange_rate": 7.3,
    "version": "b8b896b-b8b896b",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "claude-4.5-sonnet-think",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "vip",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-4-sonnet",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "vip",
        "svip",
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-4-sonnet-think",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "vip",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-4.5-sonnet",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "vip",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    }
  ],
  "group_ratio": {
    "default": 1
  },
  "success": true,
  "supported_endpoint": {
    "openai": {
      "path": "/v1/chat/completions",
      "method": "POST"
    }
  },
  "usable_group": {
    "": "用户分组",
    "default": "默认分组"
  },
  "vendors": []
}
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 2300,
    "username": "linuxdo_2300",
    "password": "",
    "original_password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "gMY6WAcZPXVUZVCg6NzxuGNU9S+ITc2n",
    "quota": 631500000,
    "used_quota": 128500000,
    "request_count": 257,
    "group": "default",
    "aff_code": "QURq",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "setting": "",
    "stripe_customer": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "6yCMR7sHWj0bZ3DaRDr05Dx/3UH4",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## ZenscaleAi

- **URL**: https://gy.zenscaleai.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_enabled": false,
    "chats": [
      {
        "ChatGPT Next Web 官方示例": "https://app.nextchat.dev/#/?settings={\"key\":\"{key}\",\"url\":\"{address}\"}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "check_in_enabled": true,
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_online_topup": false,
    "enable_task": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "idcflare_client_id": "",
    "idcflare_minimum_trust_level": 0,
    "idcflare_oauth": false,
    "linuxdo_client_id": "IYCZj7pCNFwJcNYvg9KxMogkWWuXLw7h",
    "linuxdo_minimum_trust_level": 2,
    "linuxdo_oauth": true,
    "log_chat_content_enabled": false,
    "logo": "",
    "min_topup": 1,
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "price": 7.3,
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "http://localhost:3000",
    "setup": true,
    "start_time": 1762317214,
    "system_name": "ZenscaleAi",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "version": "v0.5.12",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": [
    {
      "model_name": "假流式/gemini-2.5-pro-preview-06-05-maxthinking",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-flash",
      "quota_type": 0,
      "model_ratio": 0.15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8.333333333333,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-flash-maxthinking",
      "quota_type": 0,
      "model_ratio": 0.15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8.333333333333,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-pro-preview-06-05",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-pro-preview-06-05-maxthinking",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "假流式/gemini-2.5-pro-preview-06-05-search",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "流式抗截断/gemini-2.5-pro-preview-06-05-search",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-pro",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "假流式/gemini-2.5-pro-preview-06-05",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "流式抗截断/gemini-2.5-pro-preview-06-05-maxthinking",
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-flash-search",
      "quota_type": 0,
      "model_ratio": 0.15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8.333333333333,
      "enable_groups": [
        "default",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-pro-search",
      "quota_type": 0,
      
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215133634484528633xzcVqNmE)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 778,
    "username": "linuxdo_778",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "e6s63IDuphuj7JSLKaicVFd5cMnP",
    "quota": 118835997,
    "used_quota": 16731543,
    "request_count": 31,
    "group": "default",
    "aff_code": "WpD2",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "subscription_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "idc_flare_id": "",
    "setting": "{\"show_ip_in_logs\": true}",
    "last_check_in_time": "2025-12-12T08:57:56.525Z"
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "oYFc84jSD1DaVF3NPKVDdWN6ICqN1cU=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 0.5
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Cone

- **URL**: https://zone.veloera.org/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 403 | ❌ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 403 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 403 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 403 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 403 | ❌ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 403 | ❌ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 403 | ❌ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 403 | ❌ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 403 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 403 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 403 | ❌ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 403 | ❌ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 403 | ❌ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 403 | ❌ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 403 | ❌ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 403 | ❌ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/models`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215133653442763207zDCqDQsL)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/group`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

---

## 2233

- **URL**: https://sdwfger.edu.kg/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 521 | ❌ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 521 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 521 | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 521 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 521 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 521 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 521 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 521 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 521 | ❌ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 521 | ❌ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 521 | ❌ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 521 | ❌ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 521 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 521 | ❌ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 521 | ❌ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 521 | ❌ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 521 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 521 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 521 | ❌ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 521 | ❌ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 521 | ❌ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 521 | ❌ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 521 | ❌ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 521 | ❌ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 521

```json
error code: 521
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 521

```json
error code: 521
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 521

```json
error code: 521
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 521

```json
error code: 521
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 521

```json
error code: 521
```

---

## Elysiver

- **URL**: https://elysiver.h-e.top
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 403 | ❌ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 403 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 403 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 403 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 403 | ❌ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 403 | ❌ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 403 | ❌ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 403 | ❌ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 403 | ❌ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 403 | ❌ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 403 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 403 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 403 | ❌ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 403 | ❌ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 403 | ❌ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 403 | ❌ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 403 | ❌ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 403 | ❌ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/models`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/user`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/group`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**错误**: Cloudflare/HTML 响应

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**错误**: Cloudflare/HTML 响应

---

## 3344 API

- **URL**: https://api.243344.xyz/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":true},\"docs\":false,\"about\":true}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":true},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "Qwen逆向生图需要使用非流",
        "extra": "",
        "id": 6,
        "publishDate": "2025-11-08T13:51:35.959Z",
        "type": "default"
      },
      {
        "content": "上线translate实验性分组，翻译专用，高速率",
        "extra": "",
        "id": 5,
        "publishDate": "2025-11-08T10:32:12.245Z",
        "type": "default"
      },
      {
        "content": "CursorWeb渠道掺水，所有的模型都是 claude 3.5，自行询问知识库截止日期",
        "extra": "",
        "id": 4,
        "publishDate": "2025-10-10T03:28:16.269Z",
        "type": "default"
      }
    ],
    "announcements_enabled": true,
    "api_info": [
      {
        "color": "green",
        "description": "注册不可用",
        "id": 1,
        "route": "未优选域名",
        "url": "https://api.243344.xyz"
      }
    ],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "☪",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.ai",
    "email_verification": true,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "yccjy1q0juvmgguSHqziFTu3nENoaIhf",
    "linuxdo_minimum_trust_level": 3,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
 
```

> ⚠️ 响应已截断（原始长度: 3119 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "Navy/skyfall-36b-v2",
      "tags": "池,180K",
      "vendor_id": 55,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 50,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "vip",
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Navy/flux",
      "tags": "池,180K",
      "vendor_id": 55,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 50,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "vip",
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "GeminiCLI/gemini-2.5-pro-preview-05-06-nothinking",
      "tags": "池,2Api,满血",
      "vendor_id": 32,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 15,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "vip",
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "hubiao/Pro/BAAI/bge-m3",
      "tags": "公益",
      "vendor_id": 22,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Gitee/Qwen2.5-VL-32B-Instruct",
      "tags": "池,???",
      "vendor_id": 65,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 7,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "WslzGmzs",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "hubiao/baidu/ERNIE-4.5-300B-A47B",
      "tags": "公益",
      "vendor_id": 22,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "bohe/gpt-4.1-mini",
      "tags": "公益",
      "vendor_id": 24,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen/qwen3-vl-32b-image-edit",
      "tags": "池,2Api",
      "vendor_id": 10,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 2,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "vip",
        "WslzGmzs"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "美团/LongCat-Flash-Chat",
      "tags": "池,满血",
      "vendor_id": 33,

```

> ⚠️ 响应已截断（原始长度: 367965 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 202512151338014071951356BsXrG5c)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "jtaj",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 872,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 50000000,
    "request_count": 239,
    "role": 1,
    "setting": "",
    "sidebar_modules": "",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_872",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "FJ5fMpMVr7ivSG4inQGbbLiNO4e0jyHu",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "translate": {
      "desc": "翻译分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 且用且珍惜

- **URL**: https://api.codeqaq.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "",
    "SidebarModulesAdmin": "",
    "announcements": [],
    "announcements_enabled": true,
    "api_info": [],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": true,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "Ov23liPrekYGBGDEmdcL",
    "github_oauth": true,
    "linuxdo_client_id": "IZCQPN4OlGnlFETEUNsIMegkUQVue6Di",
    "linuxdo_minimum_trust_level": 1,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "https://api.codeqaq.com",
    "passkey_rp_id": "api.codeqaq.com",
    "passkey_user_verification": "preferred",
    "price": 7.3,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://api.codeqaq.com",
    "setup": true,
    "start_time": 1764225939,
    "stripe_unit_price": 8,
    "system_name": "且用且珍惜",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "uptime_kuma_enabled": true,
    "usd_exchange_rate": 7.3,
    "user_agreement_enabled": false,
    "version": "v0.9.22-patch.1",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gpt-5-2025-08-07",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "CRS特供",
        "default",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai",
        "openai-response"
      ]
    },
    {
      "model_name": "gpt-5.1",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "CRS特供",
        "default",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai",
        "openai-response"
      ]
    },
    {
      "model_name": "gpt-5.1-Codex",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "CRS特供",
        "default",
        "svip"
      ],
      "supported_endpoint_types": [
        "openai",
        "openai-response"
      ]
    },
    {
      "model_name": "gpt-4o",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "svip",
        "ThatAPI",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "qwen3-235b",
      "vendor_id": 7,
      "quota_type": 0,
      "model_ratio": 37.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "ThatAPI",
        "翻译",
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "qwen3-235b-a22b-instruct",
      "vendor_id": 7,
      "quota_type": 0,
      "model_ratio": 37.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "ThatAPI",
        "翻译"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "qwen3-235b-a22b-thinking-2507",
      "vendor_id": 7,
      "quota_type": 0,
      "model_ratio": 37.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "ThatAPI",
        "翻译"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "qwen3-max",
      "description": "Qwen3-Max 是由 iflowcn 提供的人工智能模型。",
      "tags": "工具,256K",
      "vendor_id": 10,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "ThatAPI",
        "翻译"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-codex",
      "vendor_id": 1,
   
```

> ⚠️ 响应已截断（原始长度: 7249 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215133817191521714gpPFwZeQ)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "heHX",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "display_name": "linuxdo_1618",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 1618,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 150000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_1618",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "xP+SumiIl5cyKiCj6mLoZW4juWYn+w==",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "CRS特供": {
      "desc": "CRS特供",
      "ratio": 2
    },
    "ThatAPI": {
      "desc": "ZRuan",
      "ratio": 0.3
    },
    "default": {
      "desc": "默认分组",
      "ratio": 0.8
    },
    "megallm": {
      "desc": "megallm",
      "ratio": 0.8
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 0.7
    },
    "翻译": {
      "desc": "翻译组",
      "ratio": 0.2
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 黑与白公益站

- **URL**: https://ai.hybgzs.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 404 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 404 | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 200 | ✅ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 200 | ✅ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 404 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "ClaudeAPIEnabled": true,
    "EnableSafe": false,
    "GeminiAPIEnabled": true,
    "PaymentMinAmount": 1,
    "PaymentUSDRate": 7.3,
    "RechargeDiscount": "",
    "SafeKeyWords": [
      "fuck",
      "shit",
      "bitch",
      "pussy",
      "cunt",
      "dick",
      "asshole",
      "bastard",
      "slut",
      "whore",
      "nigger",
      "nigga",
      "nazi",
      "gay",
      "lesbian",
      "transgender",
      "queer",
      "homosexual",
      "incest",
      "rape",
      "rapist",
      "raped",
      "raping",
      "raped",
      "raping",
      "rapist",
      "rape",
      "sex",
      "sexual",
      "sexually",
      "sexualize",
      "sexualized",
      "sexualizes",
      "sexualizing",
      "sexually",
      "sex",
      "porn",
      "pornography",
      "prostitute",
      "prostitution",
      "masturbate",
      "masturbation",
      "pedophile",
      "pedophilia",
      "hentai",
      "explicit",
      "obscene",
      "obscenity",
      "erotic",
      "erotica",
      "fetish",
      "NSFW",
      "nude",
      "nudity",
      "harassment",
      "abuse",
      "violent",
      "violence",
      "suicide",
      "racist",
      "racism",
      "discrimination",
      "hate",
      "terrorism",
      "terrorist",
      "drugs",
      "cocaine",
      "heroin",
      "methamphetamine"
    ],
    "SafeToolName": "Keyword",
    "UptimeDomain": "",
    "UptimeEnabled": false,
    "UptimePageName": "",
    "UserInvoiceMonth": false,
    "builtin_chat_enabled": false,
    "chat_link": "",
    "chat_links": "",
    "display_in_currency": true,
    "email_verification": true,
    "footer_html": "© 2016-2025 黑与白工作室 & 猫巷个人工作室. All rights reserved.  ",
    "github_client_id": "",
    "github_oauth": false,
    "invite_code_register": true,
    "language": "zh_CN",
    "lark_client_id": "",
    "lark_login": false,
    "linuxDo_client_id": "NZH9bc1ulhomlhyV11qAZhiFt1ZiZHxs",
    "linuxDo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_auth": false,
    "quota_per_unit": 500000,
    "server_address": "https://ai.hybgzs.com",
    "start_time": 1765032106,
    "system_name": "黑与白公益站",
    "telegram_bot": "",
    "top_up_link": "https://cdk.hybgzs.com",
    "turnstile_check": true,
    "turnstile_site_key": "0x4AAAAAABt8XJSAiLV_VMSd",
    "version": "v1.8.37",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "code": "",
    "message": "Invalid URL (GET /api/models)",
    "type": "invalid_request_error"
  }
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "code": "",
    "message": "Invalid URL (GET /api/pricing)",
    "type": "invalid_request_error"
  }
}
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "data": [
    {
      "model": "babbage-002",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.2,
      "output": 0.2,
      "locked": false
    },
    {
      "model": "chatgpt-4o-latest",
      "type": "tokens",
      "channel_type": 1,
      "input": 2.5,
      "output": 7.5,
      "locked": false
    },
    {
      "model": "codex-mini-latest",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.75,
      "output": 3,
      "locked": false,
      "extra_ratios": {
        "cached_tokens": 0.25
      }
    },
    {
      "model": "computer-use-preview",
      "type": "tokens",
      "channel_type": 1,
      "input": 1.5,
      "output": 6,
      "locked": false
    },
    {
      "model": "computer-use-preview-2025-03-11",
      "type": "tokens",
      "channel_type": 1,
      "input": 1.5,
      "output": 6,
      "locked": false
    },
    {
      "model": "dall-e-2",
      "type": "tokens",
      "channel_type": 1,
      "input": 8,
      "output": 8,
      "locked": false
    },
    {
      "model": "dall-e-3",
      "type": "tokens",
      "channel_type": 1,
      "input": 20,
      "output": 20,
      "locked": false
    },
    {
      "model": "davinci-002",
      "type": "tokens",
      "channel_type": 1,
      "input": 1,
      "output": 1,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.25,
      "output": 0.75,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-0125",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.25,
      "output": 0.75,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-0301",
      "type": "tokens",
      "channel_type": 1,
      "input": 0,
      "output": 0,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-0613",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.5,
      "output": 1,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-1106",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.5,
      "output": 1,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-16k",
      "type": "tokens",
      "channel_type": 1,
      "input": 1.5,
      "output": 2,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-16k-0613",
      "type": "tokens",
      "channel_type": 1,
      "input": 1.5,
      "output": 2,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-instruct",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.75,
      "output": 1,
      "locked": false
    },
    {
      "model": "gpt-3.5-turbo-instruct-0914",
      "type": "tokens",
      "channel_type": 1,
      "input": 0.75,
      "output": 1,
      "locked": false
    },
    {
      "model": "gpt-4",
      "type": "tokens",
      "channel_type": 1,
      "input": 15,
      "output": 30,
      "locked": false
    },
    {
      "model": "gpt-4-0125-preview",
      "type": 
```

> ⚠️ 响应已截断（原始长度: 193964 字符）

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "BAAI/bge-large-en-v1.5": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "BAAI/bge-large-en-v1.5",
        "type": "tokens",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "BAAI/bge-large-zh-v1.5": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "BAAI/bge-large-zh-v1.5",
        "type": "tokens",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "BAAI/bge-m3": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "BAAI/bge-m3",
        "type": "tokens",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "BAAI/bge-reranker-v2-m3": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "BAAI/bge-reranker-v2-m3",
        "type": "tokens",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "ByteDance-Seed/Seed-OSS-36B-Instruct": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "ByteDance-Seed/Seed-OSS-36B-Instruct",
        "type": "tokens",
        "channel_type": 45,
        "input": 0.2857,
        "output": 0.2857,
        "locked": false
      }
    },
    "FunAudioLLM/CosyVoice2-0.5B": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "FunAudioLLM/CosyVoice2-0.5B",
        "type": "tokens",
        "channel_type": 45,
        "input": 3.5714,
        "output": 3.5714,
        "locked": false
      }
    },
    "FunAudioLLM/SenseVoiceSmall": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "FunAudioLLM/SenseVoiceSmall",
        "type": "times",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "IndexTeam/IndexTTS-2": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "IndexTeam/IndexTTS-2",
        "type": "tokens",
        "channel_type": 45,
        "input": 3.5714,
        "output": 3.5714,
        "locked": false
      }
    },
    "Kwai-Kolors/Kolors": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "Kwai-Kolors/Kolors",
        "type": "tokens",
        "channel_type": 45,
        "input": 0,
        "output": 0,
        "locked": false
      }
    },
    "MiniMaxAI/MiniMax-M1-80k": {
      "groups": [
        "default"
      ],
      "owned_by": "Siliconflow",
      "price": {
        "model": "MiniMaxAI/MiniMax-M1-80k",
        "type": "tokens",
     
```

> ⚠️ 响应已截断（原始长度: 27756 字符）

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "id": 2,
      "symbol": "default",
      "name": "默认分组",
      "ratio": 1,
      "api_rate": 15,
      "public": true,
      "promotion": false,
      "min": 0,
      "max": 0,
      "enable": true
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "data": {
    "1": {
      "id": 1,
      "name": "OpenAI",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/openai.svg"
    },
    "11": {
      "id": 11,
      "name": "Google PaLM",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/gemini-color.svg"
    },
    "14": {
      "id": 14,
      "name": "Anthropic",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/claude-color.svg"
    },
    "15": {
      "id": 15,
      "name": "Baidu",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/wenxin-color.svg"
    },
    "16": {
      "id": 16,
      "name": "Zhipu",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/zhipu-color.svg"
    },
    "17": {
      "id": 17,
      "name": "Qwen",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/qwen-color.svg"
    },
    "18": {
      "id": 18,
      "name": "Spark",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/spark-color.svg"
    },
    "19": {
      "id": 19,
      "name": "360",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/ai360-color.svg"
    },
    "20": {
      "id": 20,
      "name": "OpenRouter",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/openrouter.svg"
    },
    "23": {
      "id": 23,
      "name": "Tencent",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/hunyuan-color.svg"
    },
    "25": {
      "id": 25,
      "name": "Google Gemini",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/gemini-color.svg"
    },
    "26": {
      "id": 26,
      "name": "Baichuan",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/baichuan-color.svg"
    },
    "27": {
      "id": 27,
      "name": "MiniMax",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/minimax-color.svg"
    },
    "28": {
      "id": 28,
      "name": "Deepseek",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/deepseek-color.svg"
    },
    "29": {
      "id": 29,
      "name": "Moonshot",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/moonshot.svg"
    },
    "30": {
      "id": 30,
      "name": "Mistral",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/mistral-color.svg"
    },
    "31": {
      "id": 31,
      "name": "Groq",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/groq.svg"
    },
    "33": {
      "id": 33,
      "name": "Yi",
      "icon": "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files
```

> ⚠️ 响应已截断（原始长度: 4731 字符）

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215133832715355459ccVdVYE0)",
    "type": "one_hub_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 3013,
    "username": "linuxdo_3013",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "avatar_url": "",
    "oidc_id": "",
    "github_id": "",
    "github_id_new": 0,
    "wechat_id": "",
    "telegram_id": 0,
    "lark_id": "",
    "linuxdo_id": 139654,
    "linuxdo_username": "Lu_Hang",
    "linuxdo_trust_level": 3,
    "verification_code": "",
    "invite_code": "",
    "used_invite_code": "kl0IJ46Q",
    "access_token": "17632c4b79fd49b7aa08e2da6cd27506",
    "quota": 70500000,
    "used_quota": 0,
    "request_count": 0,
    "group": "default",
    "aff_code": "5Z1V",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "last_login_time": 1765509546,
    "last_login_ip": "23.184.88.83",
    "created_time": 1761633696
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "dfcc0a48d14144d6a299fa6f1ca715c6",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "code": "",
    "message": "Invalid URL (GET /api/user/self/groups)",
    "type": "invalid_request_error"
  }
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "code": "",
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error"
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 红石API

- **URL**: https://hongshi1024-l-api.hf.space/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_enabled": false,
    "chats": [
      {
        "ChatGPT Next Web 官方示例": "https://app.nextchat.dev/#/?settings={\"key\":\"{key}\",\"url\":\"{address}\"}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "check_in_enabled": false,
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.ai/api/openai-chat/",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_online_topup": false,
    "enable_task": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "3hctclAfSfG0dVSHz4TdbAWOgERnYC7D",
    "linuxdo_minimum_trust_level": 0,
    "linuxdo_oauth": true,
    "logo": "data:image/webp;base64,UklGRsIAAABXRUJQVlA4TLUAAAAvn8AnED+gppEU6F5a/EulwobSAEgYGomK6wez/z+mmbZt3G7jD3jP/AcAXizD83oazuwFWEWyGikWsICFWHgWsIAF/NdQe/5lj4ro/wSMP7Cx8YEQTBaDj4Fg0diIzsUvWDQWk0bRueQFa6+xKAZF50IXTBqbpGhMisVJ50JXTDbGYlIbg+JC5xSLxmJSLDbt5ELXOsViUgxq46RznLyetb5xsmknfeO47Hq21Q8dt17PvhABAA==",
    "min_topup": 1,
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "price": 7.3,
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://hongshi1024-l-api.hf.space",
    "setup": true,
    "start_time": 1765463000,
    "system_name": "红石API",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "version": "v0.4.5",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": [
    {
      "model_name": "Qwen3-Next-80B-A3B-Instruct",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-vl-32b",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-vl-32b-thinking",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "Meta-Llama-3-3-70B-Instruct",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-max-2025-10-30-image",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-vl-plus-image-edit",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "gpt-4-turbo",
      "quota_type": 0,
      "model_ratio": 5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 3,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "gpt-3.5-turbo",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 3,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "Qwen3-235B-A22B-Instruct-2507-FP8",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.02,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-max-2025-10-30",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-vl-32b-video",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "qwen3-vl-plus-image",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.03,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ]
    },
    {
      "model_name": "gpt-4o-mini",
      "quota_type": 0,
      "model_ratio": 0.075,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_gr
```

> ⚠️ 响应已截断（原始长度: 5575 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215133852590312693LR6V2G4W)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 1857,
    "username": "linuxdo_1857",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "5Ed67JDL8l/dkxBUoHAPBMOl2yXHTRU=",
    "quota": 4999975000,
    "used_quota": 25000,
    "request_count": 5,
    "group": "default",
    "aff_code": "tsuP",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "setting": "",
    "last_check_in_time": null
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "VBmhmHUUaHOQXbXIPZ7998xYybQEa2g=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Privnode

- **URL**: https://privnode.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":false,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "我们即将更新 Privnode 《服务协议》与《隐私政策》。\n这些版本将于 2025 年 12 月 15 日 0:00 UTC 开始启用。\n\n它们分别位于 https://legal.privnode.com/view?path=terms 和 https://legal.privnode.com/view?path=privacy-policy\n\n若您不同意更新后的《服务协议》或《隐私政策》，您将需要停止使用 Privnode 服务。",
        "extra": "",
        "id": 25,
        "publishDate": "2025-12-12T07:52:13.695Z",
        "type": "default"
      },
      {
        "content": "我们正在推出分级制度。查看详情：https://public-assets.veloera.org/privnode/tier-desc\n\n请放心，分级虽然确实会对更高级用户承诺更高服务水平和可用性，但并不会在此方面与低等级用户做出明显区分。并且此策略主要目的是为了更高使用量的客户提供优惠的价格而不是做出可用性方面区别。",
        "extra": "",
        "id": 24,
        "publishDate": "2025-12-06T11:54:56.375Z",
        "type": "default"
      },
      {
        "content": "网站上的支付现已享有统一的27%折扣优惠，让您轻松省钱。Stripe支付方式需使用优惠码TWELVEDOUBLED，才能享受此优惠。\n\n感谢您一直以来对Privnode的信任与支持。我们致力于为您提供优质的产品和服务，期待在『双十二』期间为您带来更多便利和实惠。\n\n此致，\n\nPrivnode.com",
        "extra": "",
        "id": 23,
        "publishDate": "2025-12-05T12:29:27.224Z",
        "type": "default"
      },
      {
        "content": "自 2025 年 12 月 6 日起，Claude Code 服务及其相关分组的消耗倍率将从当前的 0.35 调整为 0.5。\n\n我们采取此调整是为了更好地支持服务的��定运行和持续优化，确保为用户提供一致且高质量的体验。请您在使用服务和规划资源时，充分考虑这一变动。\n\n感谢您一直以来对 Privnode 的信任与支持！",
        "extra": "",
        "id": 22,
        "publishDate": "2025-12-05T12:29:18.003Z",
        "type": "default"
      },
      {
        "content": "自 2025 年 12 月 7 日起，Privnode 将推出 Tier 分级制度，该制度将根据用户的实付金额进行用户分组调整，旨在为用户提供更优质的服务体验。\n\n具体的定价策略和服务水平协议（SLA）将于 2025 年 12 月 6 日发布，敬请期待。",
        "extra": "",
        "id": 21,
        "publishDate": "2025-12-05T12:28:49.182Z",
        "type": "default"
      },
      {
        "content": "pro.privnode.com 已被弃用。请使用 privnode.com 替代。",
        "extra": "",
        "id": 20,
        "publishDate": "2025-11-29T05:51:08.457Z",
        "type": "default"
      },
      {
        "content": "预配置吞吐量计划现已发布。\n\n这是什么？：预配置吞吐量允许您根据业务需求预先购买并锁定特定容量，从而确保关键工作负载在任何时候都能获得稳定、可预测且低延迟的响应表现。\n\n如何购买？：该计划正在封闭测试中，请向 support@privnode.com 发送邮件以联系销售人员。",
        "extra": "",
        "id": 19,
        "publishDate": "2025-11-27T11:04:52.920Z",
        "type": "default"
      },
      {
        "content": "「Claude NSFW」分组上线，可酒馆",
        "extra": "",
        "id": 18,
        "publishDate": "2025-11-23T03:50:04.313Z",
        "type": "success"
      },
      {
        "content": "「Grok」分组已支持 Grok 4.1",
        "extra": "",
        "id": 17,
        "publishDate": "2025-11-23T03:49:50.098Z",
   
```

> ⚠️ 响应已截断（原始长度: 9022 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gpt-5-high",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "Azure"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-medium",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "Azure",
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "o3",
      "description": "o3 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "Azure L1"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-20250514",
      "description": "Claude Sonnet 4 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "Claude NSFW",
        "Claude 特价",
        "cus_10353",
        "default",
        "internal.claude-official",
        "reverse-1",
        "CC后备",
        "subscription",
        "Claude Code"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gemini-3-pro-image-preview-2k",
      "vendor_id": 3,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.3,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "Nano Banana"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "description": "Claude Sonnet 4.5 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "internal.claude-special",
        "Tier 6",
        "AWS Bedrock",
        "Claude 1h缓存",
        "Claude NSFW",
        "Claude 特价",
        "cus_10353",
        "internal.claude-official",
        "reverse-1",
        "subscription",
        "CC后备",
        "Claude 1M",
        "Claude Code",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "o1",
      "description": "o1 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags":
```

> ⚠️ 响应已截断（原始长度: 34477 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215133907981551278YlVPOss8)",
    "type": "privnode_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "cKAQ",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "Tier 0",
    "id": 1431,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 4881543,
    "request_count": 62,
    "role": 1,
    "setting": "{\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 118457,
    "username": "linuxdo_1431",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "39YteA9wLSE42uautAcNTHIu9N/R7Q==",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "AWS Bedrock": {
      "desc": "AWS 稳定分组",
      "ratio": 4.2
    },
    "Azure": {
      "desc": "Azure 稳定分组",
      "ratio": 0.4
    },
    "Azure L1": {
      "desc": "Azure 支持 GPT 5",
      "ratio": 0.7
    },
    "Claude 1M": {
      "desc": "Claude 一百万上下文分组",
      "ratio": 0.7
    },
    "Claude Code": {
      "desc": "CC专用分组【纯 Max 号池】",
      "ratio": 0.5
    },
    "Claude NSFW": {
      "desc": "逆向分组，可酒馆，无审查",
      "ratio": 0.7
    },
    "Claude 特价": {
      "desc": "特价逆向分组【在 CC 外使用选】",
      "ratio": 0.35
    },
    "Claude 逆向Q": {
      "desc": "Amazon Q 逆向分组，按次计费",
      "ratio": 1
    },
    "Codex": {
      "desc": "Codex 专用分组【Codex 内使用选我】",
      "ratio": 0.2
    },
    "GLM": {
      "desc": "GLM 4.6",
      "ratio": 0.1
    },
    "Gemini CLI": {
      "desc": "Gemini CLI 专用",
      "ratio": 0.5
    },
    "Grok": {
      "desc": "Grok 官逆，可NSFW，无审",
      "ratio": 0.45
    },
    "Nano Banana": {
      "desc": "🍌 绘图分组",
      "ratio": 1
    },
    "Vertex": {
      "desc": "GCP 分组，可用 Gemini",
      "ratio": 0.5
    },
    "default": {
      "desc": "默认分组，混合渠道【不建议】",
      "ratio": 1
    },
    "free": {
      "desc": "免费模型，无稳定性保障",
      "ratio": 0
    },
    "internal.claude-special": {
      "desc": "【限时开放】特价 CC 分钟，支持 1M 上下文和 1h 缓存",
      "ratio": 0.3
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## DEV88

- **URL**: https://api.dev88.tech/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "",
    "SidebarModulesAdmin": "",
    "announcements": [
      {
        "content": "禁止高併發使用非翻譯模型 再來就準備封帳號了",
        "extra": "",
        "id": 21,
        "publishDate": "2025-11-25T10:38:45.082Z",
        "type": "warning"
      },
      {
        "content": "claude-opus-4-5",
        "extra": "",
        "id": 20,
        "publishDate": "2025-11-25T09:20:23.237Z",
        "type": "success"
      },
      {
        "content": "W渠道 claude模型下線",
        "extra": "",
        "id": 19,
        "publishDate": "2025-11-16T11:15:50.895Z",
        "type": "error"
      },
      {
        "content": "神秘渠道 10rpm 用不了就是服務器ip rate limit",
        "extra": "",
        "id": 18,
        "publishDate": "2025-11-15T14:57:01.771Z",
        "type": "warning"
      },
      {
        "content": "上線神秘渠道 需要使用新的令牌分組",
        "extra": "",
        "id": 17,
        "publishDate": "2025-11-15T02:27:30.980Z",
        "type": "success"
      },
      {
        "content": "W渠道加入註冊機自動替換帳號",
        "extra": "文字生圖只能夠在這個使用 https://nano-banana.dev88.me/",
        "id": 16,
        "publishDate": "2025-11-12T00:12:04.152Z",
        "type": "default"
      },
      {
        "content": "上線新渠道 可酒館",
        "extra": "生圖模型只有文字生圖",
        "id": 15,
        "publishDate": "2025-11-11T01:14:46.473Z",
        "type": "success"
      },
      {
        "content": "競技場這次真的是徹底死了",
        "extra": "",
        "id": 14,
        "publishDate": "2025-11-07T13:08:01.390Z",
        "type": "error"
      },
      {
        "content": "添加翻譯分組 上線一批翻譯用垃圾模型",
        "extra": "",
        "id": 13,
        "publishDate": "2025-11-07T13:07:23.271Z",
        "type": "success"
      },
      {
        "content": "成功再一次復活Lm渠道 累死我了 但是速度比以往更慢",
        "extra": "",
        "id": 12,
        "publishDate": "2025-11-06T14:20:26.316Z",
        "type": "success"
      },
      {
        "content": "深切懷念lm\n壽終正寢",
        "extra": "",
        "id": 11,
        "publishDate": "2025-11-05T03:25:16.297Z",
        "type": "warning"
      },
      {
        "content": "更新了一版解決claude-sonnet-4-5 too many request錯誤",
        "extra": "",
        "id": 10,
        "publishDate": "2025-11-04T17:52:20.060Z",
        "type": "success"
      },
      {
        "content": "Lm 復活了",
        "extra": "",
        "id": 9,
        "publishDate": "2025-11-04T04:37:55.589Z",
        "type": "success"
      },
      {
        "content": "Lm down",
        "extra": "",
        "id": 8,
        "publishDate": "2025-11-04T04:28:26.730Z",
        "type": "warning"
      },
      {
        "content": "+minimax-m2 (反代Lmarena)",
        "extra": "",
        "id": 7,
        "publishDate": "2025-11-03T21:42:23.955Z",
        "type": "success"
      },
      {
        "content": "+gemini-2.5-pro-grounding (反代Lmarena) (可搜尋)",
        "extra": "",
        "id": 6,
        "publishDate": "2025-11-02T20:04:17.458Z",
        "type": "success"
      },
      {
        "content": "claude 4.5再降一半倍率",
    
```

> ⚠️ 响应已截断（原始长度: 4902 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "free-chat"
  ],
  "data": [
    {
      "model_name": "gemini-2.5-pro",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 6,
      "enable_groups": [
        "private-cli",
        "private-chat"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gemini-3-pro-preview",
      "vendor_id": 2,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.1,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "private-cli",
        "private-chat"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.2",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 37.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "private-chat",
        "private-cli"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-pro-cli",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 4,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1.4,
      "enable_groups": [
        "private-cli",
        "private-chat"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "Bito-Model-36-GPT",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 0.01,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 0.01,
      "enable_groups": [
        "translate"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Bito-Model-38-GPT",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 0.01,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 0.01,
      "enable_groups": [
        "translate"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-nano [渠道id:33][輸出3k上限]",
      "vendor_id": 5,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.04,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "private-chat",
        "free-chat",
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-flash",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 0.9,
      "enable_groups": [
        "private-cli",
        "private-chat"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-flash-lite",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by":
```

> ⚠️ 响应已截断（原始长度: 5506 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 202512151339303828160455EXl1CTi)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "x4jE",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 1593,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 105000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_1593",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "L49ypoRyKyRvz5vLpiGyfVlG9CtcsjON",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "free-chat": {
      "desc": "chat",
      "ratio": 0.2
    },
    "free-cli": {
      "desc": "cli coding",
      "ratio": 0.2
    },
    "free-image": {
      "desc": "image gen",
      "ratio": 1
    },
    "translate": {
      "desc": "translate",
      "ratio": 1
    },
    "很快死的神秘渠道": {
      "desc": "很快死的神秘渠道",
      "ratio": 0.2
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 我爱996公益

- **URL**: https://529961.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":true},\"docs\":false,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":false,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "补号有点补不过来，等我沉淀一些号",
        "extra": "",
        "id": 2,
        "publishDate": "2025-12-11T06:51:47.000Z",
        "type": "default"
      },
      {
        "content": "实时播报可用渠道<br>\nClaude：✅<br>\nCodex：❌ <br>\nGemini：❌ <br>",
        "extra": "",
        "id": 1,
        "publishDate": "2025-11-10T08:22:15.009Z",
        "type": "default"
      }
    ],
    "announcements_enabled": true,
    "api_info": [],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [
      {
        "answer": "好像跑路了，只有香港25倍计费能用<br>\n26年9月11日过期<br>\nhttps://sub2.smallstrawberry.com/api/v1/client/subscribe?token=17799e0de659ce33df18a0fdd8a36b69",
        "id": 1,
        "question": "站长闲置一元机场订阅 每月500G"
      }
    ],
    "faq_enabled": true,
    "footer_html": "<script async src=\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2547600095635872\"      crossorigin=\"anonymous\"></script>",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "RrOU91zrLgiwxbA4nh8oSxyDkSZdioFi",
    "linuxdo_minimum_trust_level": 1,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": f
```

> ⚠️ 响应已截断（原始长度: 3215 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [],
  "group_ratio": {
    "default": 1,
    "vip": 1
  },
  "success": true,
  "supported_endpoint": {},
  "usable_group": {
    "default": "默认分组",
    "vip": "vip分组"
  },
  "vendors": [
    {
      "id": 3,
      "name": "OpenAI",
      "icon": "OpenAI"
    },
    {
      "id": 4,
      "name": "Vertex",
      "icon": "VertexAI.Color"
    },
    {
      "id": 5,
      "name": "OpenCode Zen",
      "icon": "OpenCode"
    },
    {
      "id": 6,
      "name": "阿里巴巴",
      "icon": "Qwen.Color"
    },
    {
      "id": 1,
      "name": "Anthropic",
      "icon": "Claude.Color"
    },
    {
      "id": 2,
      "name": "Google",
      "icon": "Gemini.Color"
    },
    {
      "id": 7,
      "name": "DeepSeek",
      "icon": "DeepSeek.Color"
    },
    {
      "id": 8,
      "name": "Meta",
      "icon": "Ollama"
    },
    {
      "id": 9,
      "name": "Mistral",
      "icon": "Mistral.Color"
    },
    {
      "id": 10,
      "name": "Moonshot",
      "icon": "Moonshot"
    }
  ]
}
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215133947573347063hrtxWyWh)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "IzYn",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 1229,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 35000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_1229",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "+Cw28NpQrN1Csa5+2PbftDVUBTrOlbo=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## IKunCode

- **URL**: https://api.ikuncode.cc/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":true}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":true,\"task\":true},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "近期网站有被DDoS的风险，因此做了一些加固措施。有问题请及时进群反馈。感谢您的理解与支持！",
        "extra": "",
        "id": 16,
        "publishDate": "2025-12-13T10:54:36.090Z",
        "type": "warning"
      },
      {
        "content": "azure cc渠道上线5分钟缓存分组：az-cc-5m。",
        "extra": "",
        "id": 15,
        "publishDate": "2025-12-13T04:45:04.857Z",
        "type": "success"
      },
      {
        "content": "绘图用户请优先选择gemini-3-pro-image-preview模型（default分组），更加稳定，而非nano-banana（这个优势是自带图床url，但不稳定）。",
        "extra": "",
        "id": 14,
        "publishDate": "2025-12-10T03:52:18.046Z",
        "type": "warning"
      },
      {
        "content": "上线azure渠道claude，目前0.7倍率。1小时缓存，支持1M上下文。",
        "extra": "",
        "id": 13,
        "publishDate": "2025-12-09T03:43:29.310Z",
        "type": "success"
      },
      {
        "content": "droid渠道被官方风控，正在尝试处理。",
        "extra": "很抱歉，暂无法修复。",
        "id": 12,
        "publishDate": "2025-12-08T01:29:12.713Z",
        "type": "error"
      },
      {
        "content": "上线droid-cc（0.3，支持cc和1m上下文，通过/model sonnet[1m]切换）和droid-gemini（0.5，支持gemini cli、roo code、kilo等，支持gemini3和2.5 pro）分组渠道，欢迎测试体验。有问题请随时反馈。",
        "extra": "",
        "id": 11,
        "publishDate": "2025-12-05T03:41:16.642Z",
        "type": "ongoing"
      },
      {
        "content": "因gemini-2.5-flash及gemini-2.5-pro之前错误地设置了一个较低的模型倍率（非分组倍率），现已修正。请您及时关注价格变化。感谢！",
        "extra": "",
        "id": 10,
        "publishDate": "2025-12-04T01:52:47.716Z",
        "type": "warning"
      },
      {
        "content": "本站已开���邮箱绑定",
        "extra": "",
        "id": 9,
        "publishDate": "2025-11-30T03:46:50.979Z",
        "type": "success"
      },
      {
        "content": "nano-banana-2系列模型已上架！\n按次收费：1k、2k 版本为 ¥0.25/次，4k 版本为 ¥0.45/次（由于 cf  100s超时原因，可能会无法出图，若有异常扣费，请及时进群反馈，一定会退款。）",
        "extra": "",
        "id": 8,
        "publishDate": "2025-11-29T13:20:15.957Z",
        "type": "success"
      },
      {
        "content": "已上线claude-opus-4-5-20251101 ，现已取消忙时倍率！",
        "extra": "",
        "id": 7,
        "publishDate": "2025-11-25T04:39:16.869Z",
        "type": "success"
      },
      {
        "content": "因OpenAI官方风控，codex系列暂不可用，抱歉。我们正在尝试积极处理。",
        "extra": "已修复",
        "id": 6,
        "publishDate": "2025-11-22T03:48:31.848Z",
        "type": "error"
      },
      {
        "content": "本站已支持gpt-5.1-codex-max。\n请直接修改配置文件的model或者用codex -m gpt-5.1-codex-
```

> ⚠️ 响应已截断（原始长度: 5497 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "claude-3-5-haiku-20241022",
      "description": "Claude Haiku 3.5 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.4,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "az-cc",
        "az特殊",
        "C0-练习生",
        "C1-青铜背带裤",
        "C3-黄金背带裤",
        "cc7",
        "cc分发",
        "cc固定0.6",
        "C2-白银背带裤",
        "cc5",
        "cc6",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5",
      "description": "Claude Sonnet 4.5 是由 opencode 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,1M",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "az-cc",
        "C2-白银背带裤",
        "cc5",
        "cc7",
        "cc固定0.6",
        "az特殊",
        "C0-练习生",
        "C1-青铜背带裤",
        "C3-黄金背带裤",
        "cc6",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-codex",
      "description": "GPT-5 Codex 是由 opencode 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "推理,工具,文件,多模态,400K",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex测试"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-minimal",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex测试"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex",
      "description": "GPT-5.1 Codex 是由 opencode 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags": "推理,工具,文件,多模态,400K",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex测试"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex-max",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex测试"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex-mini",
      "description": "GPT-5.1 Codex mini 是由 openai 提供的人工智能模型。",
      "icon": "OpenAI.Color",
      "tags":
```

> ⚠️ 响应已截断（原始长度: 8511 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134000977656525SpmtktiH)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "BBdX",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 2103,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 1459017,
    "request_count": 201,
    "role": 1,
    "setting": "",
    "sidebar_modules": "",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 1040983,
    "username": "linuxdo_2103",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "9jRjNZCb3KnPxG0BnTGokpFgscdC5ks=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "C0-练习生": {
      "desc": "claude体验码用户选这个！25解锁C1，500解锁C2，1000解锁C3（联系群主）",
      "ratio": 1.1
    },
    "az-cc": {
      "desc": "azure渠道cc，1小时缓存（适合经常中断5分钟以上的任务），支持1M上下文",
      "ratio": 0.7
    },
    "az-cc-5m": {
      "desc": "azure渠道cc，5分钟缓存（适合连续任务），支持1M上下文",
      "ratio": 0.7
    },
    "codex测试": {
      "desc": "codex专用，用codex必须选这个",
      "ratio": 0.2
    },
    "default": {
      "desc": "默认分组，支持gemini-3-pro-image-preview",
      "ratio": 1
    },
    "gemini": {
      "desc": "注意无法使用Gemini CLI",
      "ratio": 0.7
    },
    "nano-banana-2": {
      "desc": "自带图床渠道，4k不稳定，请在 cherrystudio使用 gemini 格式。异常扣费请联系群主退钱",
      "ratio": 1
    },
    "test": {
      "desc": "测试分组，不要选，否则会高额扣费",
      "ratio": 10
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Nyxar API

- **URL**: https://api.nyxar.org/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":false,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":true,\"task\":true},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [],
    "announcements_enabled": true,
    "api_info": [],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅���读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "day",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "J3FchPMGNbhC1xsPPIybn2XSbb7rOcOa",
    "linuxdo_minimum_trust_level": 3,
    "linuxdo_oauth": true,
    "logo": "https://cdn.0idc.net/img/NYXAR-White.png",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "https://api.nyxar.org",
    "passkey_rp_id": "api.nyxar.org",
    "passkey_user_verification": "preferred",
    "price": 7.3,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://api.nyxar.org",
    "setup": true,
    "start_time": 1765104379,
    "stripe_unit_price": 8,
    "system_name": "Nyxar API",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "uptime_ku
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gpt-4.1-mini",
      "vendor_id": 42,
      "quota_type": 0,
      "model_ratio": 0.2,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "v0-1.5-lg",
      "quota_type": 0,
      "model_ratio": 10,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-oss-120b",
      "vendor_id": 42,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5",
      "vendor_id": 42,
      "quota_type": 0,
      "model_ratio": 5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-mini",
      "vendor_id": 42,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001",
      "vendor_id": 44,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "deepseek-r1",
      "vendor_id": 41,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "v0-1.0-md",
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "v0-1.5-md",
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-3-5-sonnet-20241022",
      "vendor_id": 44,
      "quota_type": 0,
      "model_ratio": 5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
   
```

> ⚠️ 响应已截断（原始长度: 4383 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134013569112986rt6Ea1s8)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "nfCj",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 2157,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 200000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_2157",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "r/4oAqOkygZSxQY8pJvaEMevAgW61Xk=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## PrismAI

- **URL**: https://ai.prism.uno/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "",
    "SidebarModulesAdmin": "",
    "announcements": [
      {
        "content": "下线 claude-opus-4-20250514",
        "extra": "",
        "id": 6,
        "publishDate": "2025-11-24T13:20:12.201Z",
        "type": "default"
      },
      {
        "content": "上线 gpt-5.1",
        "extra": "",
        "id": 5,
        "publishDate": "2025-11-24T05:16:49.670Z",
        "type": "default"
      },
      {
        "content": "claude-sonnet-4-5-20250929 现在支持流式响应",
        "extra": "",
        "id": 4,
        "publishDate": "2025-11-10T10:30:27.673Z",
        "type": "default"
      },
      {
        "content": "上线 claude-sonnet-4-5-20250929，但目前仅支持非流",
        "extra": "",
        "id": 3,
        "publishDate": "2025-10-11T03:01:02.513Z",
        "type": "default"
      },
      {
        "content": "上线 gemini-2.5-pro-search 模型，支持联网搜索",
        "extra": "",
        "id": 2,
        "publishDate": "2025-09-24T14:29:57.493Z",
        "type": "default"
      },
      {
        "content": "本站上线 Gemini 2.5 Pro 模型，稳定不截断，支持长上下文，且不设置每小时 Token 数量限制！\n\n要使用 Gemini 模型，请创建一个 “gemini” 分组的令牌。（使用 default 分组的令牌仍会受到每小时 500K tokens 限制）",
        "extra": "",
        "id": 1,
        "publishDate": "2025-09-07T08:22:33.723Z",
        "type": "default"
      }
    ],
    "announcements_enabled": true,
    "api_info": [],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "WObZYFlyjt1qsacZcxxOlNEjAG0TG8We",
    "linuxdo_minimum_trust_level": 2,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gpt-4",
      "icon": "OpenAI",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 2,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-3-5-haiku-20241022",
      "icon": "Claude.Color",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.4,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-3-5-sonnet-20241022",
      "icon": "Claude.Color",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-4.1",
      "icon": "OpenAI",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-4o",
      "icon": "OpenAI",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-4o-mini",
      "icon": "OpenAI",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.075,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5",
      "icon": "OpenAI",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "icon": "Claude.Color",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
   
```

> ⚠️ 响应已截断（原始长度: 5777 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134033398650554LoXFLEkv)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "0yS4",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Lu_Hang",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 1577,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 497702064,
    "request_count": 23,
    "role": 1,
    "setting": "",
    "sidebar_modules": "",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 2297936,
    "username": "linuxdo_1577",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "O5JN00PkzbasrM6Y6CTCs7xDBS1I3Qk=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组 | RPM=5 | 每小时 Token 限制 500K",
      "ratio": 1
    },
    "gemini": {
      "desc": "Gemini 专用分组 | RPM=5 | 无每小时 Token 限制",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Mu.Li API Relive

- **URL**: https://demo.awa1.fun/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":true}",
    "SidebarModulesAdmin": "",
    "announcements": [
      {
        "content": "添加 GLM-4.6V / GLM-4.6V-Flash",
        "extra": "",
        "id": 16,
        "publishDate": "2025-12-08T13:22:39.670Z",
        "type": "success"
      },
      {
        "content": "添加 DeepSeek-V3.2 ( 正式版 )",
        "extra": "",
        "id": 15,
        "publishDate": "2025-12-05T15:51:27.683Z",
        "type": "success"
      },
      {
        "content": "GLM 当前由官方 Coding Plan 负载  \n已加入 GLM-4.5 / GLM-4.5-Air / GLM-4.6（默认分组支持 Thinking）  \n支持 Anthropic 调用（专用分组）",
        "extra": "",
        "id": 14,
        "publishDate": "2025-12-05T07:39:50.895Z",
        "type": "ongoing"
      },
      {
        "content": "添加 Qwen3-VL-OCR 最新快照版本（25.11.20）",
        "extra": "",
        "id": 13,
        "publishDate": "2025-11-25T11:17:52.570Z",
        "type": "success"
      },
      {
        "content": "添加 Meta 的 LLaMa-4 系列模型",
        "extra": "",
        "id": 12,
        "publishDate": "2025-11-21T19:55:25.000Z",
        "type": "success"
      },
      {
        "content": "添加 Qwen3-Max",
        "extra": "",
        "id": 11,
        "publishDate": "2025-11-19T06:08:06.425Z",
        "type": "success"
      },
      {
        "content": "添加 Kimi-K2-Thinking",
        "extra": "",
        "id": 10,
        "publishDate": "2025-11-17T14:20:41.232Z",
        "type": "success"
      },
      {
        "content": "移��� “国内接口”（不再可用，已被 sni 阻断）",
        "extra": "",
        "id": 9,
        "publishDate": "2025-11-10T17:14:03.840Z",
        "type": "warning"
      },
      {
        "content": "添加一系列工具模型（~~同步上线聚合分组~~）：  \n重排模型：  \nQwen/Qwen3-Rerank-8B  \n向量模型：  \nQwen/Qwen2.5-VL-Embedding，Qwen/Tongyi-Embedding-Vision-Flash，Qwen/Tongyi-Embedding-Vision-Plus  \n其他：  \nGLM-4.5V，GLM-Z1-Flash，Kimi-K2，DeepSeek-V3",
        "extra": "",
        "id": 8,
        "publishDate": "2025-11-04T09:13:16.513Z",
        "type": "success"
      },
      {
        "content": "~~因 GLM Coding Plan 资源包的过期以及决定停止续费，从今日起将停止付费层级 GLM 的不限量免费提供，如您有代码需求，依然可以使用其他渠道下的模型，或者选择更换其他公益站~~",
        "extra": "",
        "id": 7,
        "publishDate": "2025-11-04T07:20:18.805Z",
        "type": "ongoing"
      },
      {
        "content": "~~添加 MiniMax-M2~~",
        "extra": "",
        "id": 6,
        "publishDate": "2025-10-30T02:57:58.817Z",
        "type": "error"
      },
      {
        "content": "魔搭 Qwen3-Coder-235B-A22B 已恢复可用，模型重新上线  \n具体可用多久未知",
        "extra": "",
        "id": 5,
        "publishDate": "2025-10-21T09:25:06.139Z",
        "type": "success"
      },
      {
        "content": "部分地区 “国内接口” 出现 Reset（ 连接重置 ）问题，系未备案被运营商屏蔽，如遇见请使用 “默认接口”  \n此问题无解，请不要反馈",
        "extra": "",
        "id": 4,
        "publishDate": "2025-10-21T09:21:47.865Z",
        "type": "error"
      },
      {
        "content": "如需在 “沉浸式翻译” 内��用需选择 `Transl
```

> ⚠️ 响应已截断（原始长度: 6351 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [],
  "data": [
    {
      "model_name": "ZhipuAI/GLM-4.6V",
      "description": "智谱最新视觉推理模型，视觉理解精度达同规模SOTA，原生支持工具调用，能自动完成任务，支持 128K 超长上下文，并可灵活开关思考。",
      "icon": "Zhipu",
      "tags": "开源模型,视觉,混合推理架构",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 3,
      "enable_groups": [
        "default",
        "lv.2",
        "lv.3",
        "anthropic-completion"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "moonshot-ai/Kimi-K2-Instruct",
      "description": "Kimi-K2是月之暗面提供的国内首个开源万亿参数MoE模型，激活参数达 320 亿，具有卓越的编码和工具调用能力（此为旧版本，非 0905 版本）",
      "icon": "Kimi",
      "tags": "开源模型,Coding",
      "vendor_id": 4,
      "quota_type": 0,
      "model_ratio": 2,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "lv.2",
        "lv.3"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen/Qwen3-235B-A22B-Thinking-2507",
      "description": "基于Qwen3的思考模式开源模型，相较上一版本（通义千问3-235B-A22B）逻辑能力、通用能力、知识增强及创作能力均有大幅提升，适用于高难度强推理场景",
      "icon": "Qwen",
      "tags": "开源模型,Qwen3,推理模型",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 10,
      "enable_groups": [
        "lv.2",
        "lv.3",
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen/Qwen3-VL-235B-A22B-Instruct",
      "description": "Qwen3系列视觉理解模型，多模态思考能力显著增强，模型在STEM与数学推理方面进行了重点优化；视觉感知与识别能力全面提升、OCR能力迎来重大升级。",
      "icon": "Qwen",
      "tags": "开源模型,Qwen3,视觉",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "lv.2",
        "lv.3"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "deepseek-ai/DeepSeek-V3.2",
      "description": "DeepSeek-V3.2 为 DeepSeek-V3.2-Exp 的正式版本，详见：https://api-docs.deepseek.com/zh-cn/news/news251201",
      "icon": "DeepSeek",
      "tags": "开源模型,混合推理架构",
      "vendor_id": 42,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1.5,
      "enable_groups": [
        "default",
        "lv.2",
        "lv.3"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen/Qwen3-Embedding-4B",
      "description": "通义实验室基于Qwen3训练的多语言文本统一向量模型，相较V3版本在文本检索、聚类、分类性能大幅提升；在MTEB多语言、中英、Code检索等评测任务上效果提升15%~40%���支持64~2048维用户自定义向量维度。",
      "icon": "Qwen",
      "tags": "向量模型,Qwen3",
      "vendor_id": 4,
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "co
```

> ⚠️ 响应已截断（原始长度: 16235 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134055133154461j3nu42q9)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "vTL1",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 158,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 7505000,
    "request_count": 0,
    "role": 1,
    "setting": "",
    "sidebar_modules": "",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_158",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "sr1e22zqrxeiy3Y9aFapHB4y2qGd",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "anthropic-completion": {
      "desc": "该分组模型支持 Anthropic 端点调用",
      "ratio": 0.01
    },
    "free": {
      "desc": "该分组仅能调用“免费”模型，每 5 分钟可调用 40 次（等效 RPM 8） ",
      "ratio": 1
    },
    "translate": {
      "desc": "翻译专用，高并发，RPM 80",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## anyrouter.top

- **URL**: https://anyrouter.top/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | EPROTO | ❌ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | ERROR | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | EPROTO | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | EPROTO | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | EPROTO | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | EPROTO | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | EPROTO | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | EPROTO | ❌ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | EPROTO | ❌ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | EPROTO | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | EPROTO | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | EPROTO | ❌ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | EPROTO | ❌ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | EPROTO | ❌ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | EPROTO | ❌ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | EPROTO | ❌ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | EPROTO | ❌ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/models`

**来源**: 文档✅ | 代码❌

**错误**: 请求超时

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/prices`

**来源**: 文档✅ | 代码❌

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/v1/models`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/user`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/group`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/token/`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**错误**: write EPROTO 1C0A0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:c:\ws\deps\openssl\openssl\ssl\record\rec_layer_s3.c:1605:SSL alert number 40


---

## runAnytimeAPI

- **URL**: https://veloera.wenwen12345.top/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_enabled": false,
    "chats": [
      {
        "ChatGPT Next Web 官方示例": "https://app.nextchat.dev/#/?settings={\"key\":\"{key}\",\"url\":\"{address}\"}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "check_in_enabled": true,
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_online_topup": false,
    "enable_task": true,
    "footer_html": "Power by wenwen12345, LLC.<del>（随时跑路.jpg）</del>",
    "github_client_id": "",
    "github_oauth": false,
    "idcflare_client_id": "",
    "idcflare_minimum_trust_level": 0,
    "idcflare_oauth": false,
    "linuxdo_client_id": "GVrv1WAdS90N9Oiax2l3yxVDvErCSWLj",
    "linuxdo_minimum_trust_level": 1,
    "linuxdo_oauth": true,
    "log_chat_content_enabled": false,
    "logo": "",
    "min_topup": 1,
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "price": 7.3,
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://veloera.wenwen12345.top",
    "setup": true,
    "start_time": 1764926077,
    "system_name": "runAnytimeAPI",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "version": "v999.0.1-1-g70beb292",
    "wechat_login": false,
    "wechat_qrcode": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": [
    {
      "model_name": "mercury-coder",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "fast"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-pro",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "gpt-oss-120b",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "fast",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "kimi-k2",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "deepseek-v3.1",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "gemma2-9b-it",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "fast",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "glm-4.5-flash",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "fast",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "gpt-5",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "qwen3-32b",
      "quota_type": 0,
      "model_ratio": 0.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default",
        "fast",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "qwen3-coder-480b",
      "quota_type": 0,
      "model_ratio": 0.25,
      "m
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215134145636155227RTXIFHFl)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 1602,
    "username": "linuxdo_1602",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "+qub1eJ49pKpYMdQpHAsPe4hr6Ulqw==",
    "quota": 27973005,
    "used_quota": 69163,
    "request_count": 7,
    "group": "default",
    "aff_code": "dHi5",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "subscription_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "idc_flare_id": "",
    "setting": "",
    "last_check_in_time": "2025-12-12T08:58:03.033Z"
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "TsMWlNh4hvLwP6MFWiFisJqeE/oe",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "fast": {
      "desc": "快速高并发分组",
      "ratio": 0.1
    },
    "test": {
      "desc": "测试分组",
      "ratio": 0
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Huan API

- **URL**: https://ai.huan666.de/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_enabled": true,
    "chats": [
      {
        "ChatGPT Next Web 官方示例": "https://app.nextchat.dev/#/?settings={\"key\":\"{key}\",\"url\":\"{address}\"}"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "check_in_enabled": true,
    "data_export_default_time": "hour",
    "default_collapse_sidebar": true,
    "demo_site_enabled": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_online_topup": false,
    "enable_task": true,
    "footer_html": "<!-- Huan API Footer Component - 智能深浅色模式适配 --> <footer class=\"huan-api-footer\" id=\"huanFooter\">     <!-- 背景动效 -->     <div class=\"huan-shimmer-bg\"></div>          <!-- 页脚内容 -->     <div class=\"huan-footer-content\">         <span class=\"huan-logo\"          onmouseover=\"this.style.transform='perspective(500px) rotateY(15deg) scale(1.05)'\"         onmouseout=\"this.style.transform='perspective(500px) rotateY(0deg) scale(1)'\">Huan API</span> by          <a href=\"https://linux.do/u/huan/summary\" target=\"_blank\" class=\"huan-link huan-link-author\">@焕昭君</a>，由          <a href=\"https://www.anthropic.com/news/claude-4\" target=\"_blank\" class=\"huan-link huan-link-ai\">Claude 4.0 Sonnet</a> 强力支持，基于         <a href=\"https://github.com/Veloera/Veloera\" target=\"_blank\" class=\"huan-link huan-link-tech\">Veloera</a>，<a href=\"https://github.com/QuantumNous/new-api\" target=\"_blank\" class=\"huan-link huan-link-tech2\">New API</a>，<a href=\"https://github.com/songquanpeng/one-api\" target=\"_blank\" class=\"huan-link huan-link-tech3\">One API</a>     </div> </footer>  <style> /* 深浅色模式变量 */ .huan-api-footer {     /* 默认浅色模式 */     --huan-bg-light: rgba(255, 255, 255, 0.95);     --huan-bg-dark: rgba(15, 23, 42, 0.95);     --huan-border-light: rgba(0, 0, 0, 0.08);     --huan-border-dark: rgba(148, 163, 184, 0.1);     --huan-text-light: rgba(51, 65, 85, 0.9);     --huan-text-dark: rgba(226, 232, 240, 0.9);     --huan-shimmer-light: rgba(59, 130, 246, 0.02);     --huan-shimmer-dark: rgba(59, 130, 246, 0.03);      /* 基础样式 */     font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;     position: relative;     overflow: hidden;     padding: 1rem 0;     text-align: center;     transition: all 0.3s ease;     backdrop-filter: blur(10px);     box-shadow: 0 -1px 10px rgba(0, 0, 0, 0.05); 
```

> ⚠️ 响应已截断（原始长度: 14654 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": [
    {
      "model_name": "GLM-4.5-Air",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "grok-4.1",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "grok-imagine-0.9",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.02,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "gemini-2.5-flash-lite",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "Kimi-K2",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "deepseek-v3.1",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "deepseek-v3.2-exp",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "doubao-1-5-lite-32k-250115",
      "quota_type": 0,
      "model_ratio": 0.05,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 2,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "GLM-4.5",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.05,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "GLM-4.5V",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.02,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "GLM-4.6",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.05,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default",
        "svip",
        "vip"
      ]
    },
    {
      "model_name": "grok-4-fast",
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.01,
      "owner_by": "",
      "completion_ratio"
```

> ⚠️ 响应已截断（原始长度: 3755 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "message": "无效的令牌 (request id: 20251215133931204866936mXWqDbKm)",
    "type": "veloera_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 6110,
    "username": "linuxdo_6110",
    "password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "verification_code": "",
    "access_token": "tKjUPP7g5I2n+GxhIfSvm1CB7alHUVmh",
    "quota": 39740304,
    "used_quota": 0,
    "request_count": 0,
    "group": "default",
    "aff_code": "mf4K",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "DeletedAt": null,
    "linux_do_id": "139654",
    "setting": "",
    "last_check_in_time": "2025-12-12T08:55:33.21Z"
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "6oQLNnz+aCbx5XKcwK5cMylX/Mxr",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "default": {
      "desc": "默认分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## KFC API

- **URL**: https://kfc-api.sxxe.net/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":false,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [],
    "announcements_enabled": true,
    "api_info": [
      {
        "color": "blue",
        "description": "备用站点",
        "id": 1,
        "route": "备用",
        "url": "https://kfc-api.kyx03.de"
      }
    ],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "week",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://docs.newapi.pro",
    "email_verification": false,
    "enable_batch_update": true,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "、",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "UZgHjwXCE3HTrsNMjjEi0d8wpcj7d4Of",
    "linuxdo_minimum_trust_level": 0,
    "linuxdo_oauth": true,
    "logo": "https://imgembed.0890412.xyz/2025/11/photo_2025-11-18_16-44-14.jpg",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "http://localhost:3000",
    "passkey_rp_id": "localhost:3000",
    "passkey_user_verification": "preferred",
    "price": 7.3,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "http://localhost:3000",
    "setup": true,
    "start_time": 1765651743,
    
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gpt-5.1-codex-max-high",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5-codex-mini-medium",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen3-VL-235B-A22B-Instruct",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.2-low",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-oss-20b",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 2,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex-mini",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen3-VL-30B-A3B-Thinking",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "Qwen3-Next-80B-A3B-Instruct",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "DeepSeek-V3.2-Exp",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 1,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "qwen-3-32b",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model
```

> ⚠️ 响应已截断（原始长度: 17545 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134226972713588oHvjL8Wu)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "28zl",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 462,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 49997889,
    "request_count": 455,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 2111,
    "username": "linuxdo_462",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "9+lucxworTo8SAedzu86FswLOPCm",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "Droid2api-Claude-code": {
      "desc": "Droid2api 逆向",
      "ratio": 1
    },
    "Gemini3": {
      "desc": "Gemini-3-pro专用分组",
      "ratio": 2.5
    },
    "codex": {
      "desc": "CodeX专用分组",
      "ratio": 1
    },
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "modelscope-Claude Code": {
      "desc": "cc分组",
      "ratio": 1
    },
    "沉浸式": {
      "desc": "沉浸式翻译",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 一叶知秋API

- **URL**: https://88996.cloud/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 404 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "InviteRegisterEnabled": false,
    "InvoiceMinAmount": 1,
    "QuotaForInvitee": 0,
    "QuotaForInviter": 0,
    "RechargeDiscount": {},
    "RechargeType": "input",
    "TopUpBanner": "",
    "aff_limit": 30,
    "aff_rate": 5,
    "chats": [
      {
        "logo": "https://raw.githubusercontent.com/Dooy/chatgpt-web-midjourney-proxy/33ca008832510af2c5bc4d07082dd7055c324c84/public/favicon.svg",
        "name": "Chat-MJ",
        "url": "https://chat.innk.cc/#/?settings={%22key%22:%22{key}%22,%22url%22:%22{host}%22}"
      },
      {
        "logo": "https://raw.githubusercontent.com/ChatGPTNextWeb/NextChat/553b8c9f284bff6ec059b4d69f3f91c10105fbc0/app/icons/logo.svg",
        "name": "Chat-Basic",
        "url": "https://app.nextchat.dev/#/?settings={%22key%22:%22{key}%22,%22url%22:%22{host}%22}"
      }
    ],
    "chats_verify_enabled": false,
    "checkin_max_quota": 150000,
    "checkin_min_quota": 50000,
    "company_verify_enabled": false,
    "currency_symbol": "USD",
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "day",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "email_verification": true,
    "enable_aff": true,
    "enable_aff_verify": false,
    "enable_batch_update": true,
    "enable_checkin": true,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_task": false,
    "footer_html": "<a id=\"uptime\" class=\"gradient-text\"></a ><br> 🕊<a class=\"gradient-text\"> 一叶知秋，智能随行 - 让API调用回归简单本质</a >",
    "github_client_id": "Iv23liD6CQxe36ewHMVX",
    "github_oauth": true,
    "google_client_id": "",
    "google_oauth": false,
    "header_nav": [
      {
        "content": "/",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "主页",
        "path": "/"
      },
      {
        "content": "/panel",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "工作台",
        "path": "/panel"
      },
      {
        "content": "/chat",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "聊天/绘画",
        "path": "/chat"
      },
      {
        "content": "/pricing",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "模型列表",
        "path": "/pricing"
      },
      {
        "content": "https://apiai.apifox.cn/",
        "displayType": "embed",
        "enabled": true,
        "isDefault": false,
        "name": "API文档",
        "path": "/apiai.apifox.cn"
      },
      {
        "content": "https://www.kdocs.cn/l/ckcRZgGZbVb4\r\n",
        "displayType": "new_window",
        "enabled": true,
        "isDefault": false,
        "name": "API使用教程",
        "path": "/www.kdocs.cn"
      }
    ],
    "is_agen
```

> ⚠️ 响应已截断（原始长度: 3787 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "group_info": {
      " claude-逆向-0.35": {
        "Description": "",
        "DisplayName": " claude-逆向-0.35",
        "GroupRatio": 0.35
      },
      "Azure": {
        "Description": "",
        "DisplayName": "Azure自营号池不卡{0.6元/刀}",
        "GroupRatio": 0.6
      },
      "Azure1": {
        "Description": "",
        "DisplayName": " Azure1高并发-无审{0.4元/刀}",
        "GroupRatio": 0.4
      },
      "DeepSeek1": {
        "Description": "",
        "DisplayName": "自营 Deepseek1 高并发 {0.4元}",
        "GroupRatio": 0.4
      },
      "GEmini-s": {
        "Description": "",
        "DisplayName": "GEmini*0.3",
        "GroupRatio": 0.3
      },
      "Gmini1": {
        "Description": "",
        "DisplayName": "Gmini1*0.5",
        "GroupRatio": 0.5
      },
      "Kimi1": {
        "Description": "",
        "DisplayName": "Kimi1-0.45",
        "GroupRatio": 0.45
      },
      "T3-Vertex": {
        "Description": "",
        "DisplayName": "T3-Vertex*0.8",
        "GroupRatio": 0.8
      },
      "banana-画图用": {
        "Description": "",
        "DisplayName": "banana-画图用",
        "GroupRatio": 0.8
      },
      "claude 2.5": {
        "Description": "",
        "DisplayName": "claude-稳定- 2.5X",
        "GroupRatio": 2.5
      },
      "default": {
        "Description": "",
        "DisplayName": "default（可用站点大部分模型）",
        "GroupRatio": 1
      },
      "grok-0.45": {
        "Description": "",
        "DisplayName": "grok-0.45",
        "GroupRatio": 0.45
      },
      "按次（claude/gemini/gpa）": {
        "Description": "按次",
        "DisplayName": "按次",
        "GroupRatio": 1
      },
      "纯vertex--ai": {
        "Description": "",
        "DisplayName": "纯vertex--ai-0.45",
        "GroupRatio": 0.5
      },
      "纯纯的CC": {
        "Description": "",
        "DisplayName": "纯纯的CC*1",
        "GroupRatio": 1
      }
    },
    "model_info": [
      {
        "model_name": "claude-3-5-haiku-20241022",
        "description": "Claude Haiku 3.5 是由 anthropic 提供的人工智能模型。",
        "icon": "Claude.Color",
        "tags": "工具,文件,多模态,200K",
        "vendor_id": 10,
        "price_info": {
          " claude-逆向-0.35": {
            "default": {
              "quota_type": 1,
              "model_price": 0,
              "model_ratio": 0.5,
              "model_completion_ratio": 5,
              "model_create_cache_ratio": 1.25,
              "model_cache_ratio": 0.1,
              "model_audio_ratio": 1,
              "model_audio_completion_ratio": 0,
              "priceInfo": null,
              "multiplicativeFactors": null
            }
          },
          "CC测试0.2": {
            "default": {
              "quota_type": 1,
              "model_price": 0,
              "model_ratio": 0.5,
              "model_completion_ratio": 5,
              "model_create_cache_ratio": 1.25,
              "model_cache_ratio": 0.1,
              "model_audio_ratio": 1,
              "model_audio_completion_ratio": 0,
             
```

> ⚠️ 响应已截断（原始长度: 218041 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "Invalid Token (request id: 20251215134241894523166lhOAKLcA)",
    "type": "rix_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 4973,
    "username": "linuxdo_4973",
    "password": "",
    "original_password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "discord_id": "",
    "oidc_id": "",
    "google_id": "",
    "linuxdo_id": "139654",
    "wechat_id": "",
    "verification_code": "",
    "access_token": "6Lo6XyvDadESidRBIKaILB4875n1mQ==",
    "quota": 5000000,
    "bonus_quota": 250000,
    "used_quota": 0,
    "topup_amount": 0,
    "invoice_amount": 0,
    "request_count": 0,
    "topup_count": 0,
    "aff_code": "20Bp",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "stripe_customer": "",
    "created_at": 1765160414,
    "DeletedAt": null,
    "last_login_at": 1765160577,
    "level": "Tier 3",
    "group_ratio": "{}",
    "model_ratio": "{}",
    "rate_limits": "{}",
    "agent_user_id": 1,
    "use_group": "",
    "disabled_channels": "",
    "model_limits_enabled": false,
    "topup_enabled": true,
    "model_limits": "",
    "avatar": "Upstream.svg",
    "PushSettings": {
      "user_id": 4973,
      "subscription_options": "quota_push",
      "notice_type": "email"
    },
    "VerifyInfo": {
      "type": "",
      "status": "",
      "created_at": "0001-01-01T00:00:00Z",
      "updated_at": "0001-01-01T00:00:00Z"
    },
    "session_version": 1765160577325367800
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "YmShqIEMcs3RlnfMiC0fD9R4oKz4",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user/self/groups)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## WONG

- **URL**: https://newapi.netlib.re/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 301 | ❌ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 301 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 301 | ❌ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 301 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 301 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 301 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 301 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 301 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 301 | ❌ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 301 | ❌ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 301 | ❌ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 301 | ❌ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 301 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 301 | ❌ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 301 | ❌ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 301 | ❌ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 301 | ❌ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 301 | ❌ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 301 | ❌ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 301 | ❌ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 301 | ❌ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 301 | ❌ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

#### `/api/models`

**来源**: 文档✅ | 代码❌

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

#### `/api/prices`

**来源**: 文档✅ | 代码❌

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

#### `/v1/models`

**来源**: 文档❌ | 代码✅

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

#### `/api/user`

**来源**: 文档❌ | 代码✅

#### `/api/group`

**来源**: 文档❌ | 代码✅

#### `/api/token/`

**来源**: 文档✅ | 代码✅

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

---

## Undy API

- **URL**: https://vip.undyingapi.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [],
    "announcements_enabled": true,
    "api_info": [],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://undyingapi.apifox.cn",
    "email_verification": false,
    "enable_batch_update": true,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "© 2025 Undy API",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "AftbmQ6O0LtaaCSvD1icrh57hnWWJt9p",
    "linuxdo_minimum_trust_level": 0,
    "linuxdo_oauth": true,
    "logo": "https://theai.do/img/u.png",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "New API",
    "passkey_login": false,
    "passkey_origins": "https://vip.undyingapi.com",
    "passkey_rp_id": "vip.undyingapi.com",
    "passkey_user_verification": "preferred",
    "price": 0.35,
    "privacy_policy_enabled": false,
    "quota_display_type": "USD",
    "quota_per_unit": 500000,
    "self_use_mode_enabled": false,
    "server_address": "https://vip.undyingapi.com",
    "setup": true,
    "start_time": 1765559278,
    "stripe_unit_price": 8,
    "system_name": "Undy API",
    "telegram_bot_name": "",
    "telegram_oauth": false,
    "top_up_link": "",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "uptime_kuma_enabled": true,
    "usd_exchange_rate": 7.3,
    "user_agreement_en
```

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gemini-3-pro-preview",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 6,
      "enable_groups": [
        "vertex-ai",
        "ai-studio",
        "default"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "azure-claude"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-1-20250805-thinking",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "azure-claude"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "o3-mini-2025-01-31-high",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.55,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "gpt-4"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-flash",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.15,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8.33,
      "enable_groups": [
        "ai-studio",
        "default",
        "gemini-cli逆向",
        "gemini-cli逆向散户",
        "vertex-ai"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "codex",
        "gpt-5"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gpt-4.1-nano-2025-04-14",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.05,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 2,
      "enable_groups": [
        "gpt-4"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "o3-mini-2025-01-31-low",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.55,
      "model_price": 0,
      "owner_by": "",
      "comp
```

> ⚠️ 响应已截断（原始长度: 13987 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134305848656054QMeFiTIW)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "uRcw",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 10222,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 10000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_10222",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "F4GJkbj8wj/DW6IGOJJgXPdnFs53+Cc=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "ai-studio": {
      "desc": "ai-studio分组",
      "ratio": 2
    },
    "azure-claude": {
      "desc": "azure-claude分组",
      "ratio": 1.5
    },
    "codex": {
      "desc": "codex分组",
      "ratio": 1
    },
    "default": {
      "desc": "默认分组",
      "ratio": 2
    },
    "gemini-cli逆向": {
      "desc": "gemini-cli逆向分组",
      "ratio": 1
    },
    "gemini-cli逆向散户": {
      "desc": "gemini-cli逆向散户分组",
      "ratio": 1
    },
    "gpt-4": {
      "desc": "gpt-4分组",
      "ratio": 1
    },
    "gpt-5": {
      "desc": "gpt-5分组",
      "ratio": 2
    },
    "nano banana绘图": {
      "desc": "nano banana绘图",
      "ratio": 1
    },
    "vertex-ai": {
      "desc": "vertex-ai分组",
      "ratio": 2
    },
    "vip": {
      "desc": "vip分组",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## DuckCoding

- **URL**: https://duckcoding.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":true},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":true},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "2025-12-15\n\nGemini CLI专用分组 倍率灵活调整：\n\ndefault用户分组 Gemini CLI专用分组模型 由1.3恢复至1.5，北京时间2025-12-15 12:00生效\n\nTier1用户分组 Gemini CLI专用分组模型 由1.3恢复至1.4，北京时间2025-12-15 12:00生效\n\nTier2、Tier3、Business用户分组不变，详情可查看：https://doc.duckcoding.com",
        "extra": "",
        "id": 411,
        "publishDate": "2025-12-15T03:31:57.334Z",
        "type": "warning"
      },
      {
        "content": "2025-12-15\n\nCodeX专用分组、CodeX专用（Droid）分组 倍率灵活调整：\n\ndefault用户分组 CodeX专用分组、CodeX专用（Droid）分组模型 由0.6恢复至0.8，北京时间2025-12-15 12:00生效\n\nTier1用户分组 CodeX专用分组、CodeX专用（Droid）分组模型 由0.6恢复至0.7，北京时间2025-12-15 12:00生效\n\nTier2、Tier3、Business用户分组不变，详情可查看：https://doc.duckcoding.com",
        "extra": "",
        "id": 410,
        "publishDate": "2025-12-15T03:31:49.939Z",
        "type": "warning"
      },
      {
        "content": "2025-12-15\n\nClaude Code专用分组 倍率灵活调整：\n\ndefault用户分组 Claude Code专用分组模型 由1.3恢复至1.5，北京时间2025-12-15 12:00生效\n\nTier1用户分组 Claude Code专用分组模型 由1.3恢复至1.4，北京时间2025-12-15 12:00生效\n\nTier2、Tier3、Business用户分组不变，详情可查看：https://doc.duckcoding.com",
        "extra": "",
        "id": 409,
        "publishDate": "2025-12-15T03:31:42.860Z",
        "type": "warning"
      },
      {
        "content": "2025-12-13\n\nClaude Code专用-Azure特价，恢复倍率到0.4\n\n福利还是不会少，单独开一个公益站，免费提供Claude Code专用-Azure\n\n注册送200额度，邀请和被邀请送50，为防止注册机，只允许L站1级用户注册\n\n为防止大家意外浪费钱，Claude Code专用-Azure分组，23:20准时关闭至23:30，并调整倍率\n\n以上，感谢大家支持\n\n公益站：https://free.duckcoding.com",
        "extra": "",
        "id": 408,
        "publishDate": "2025-12-13T15:19:25.701Z",
        "type": "warning"
      },
      {
        "content": "2025-12-10\n\n今日12点至12月14日24点（本周日24点），充值比例0.85:1，即0.85元到账1额度\n\n暂时取消倍率灵活调整，全时段闲时倍率，持续至12月15日12点（下周一12点），后续正常按照闲时、忙时灵活调整倍率\n\n北京时间2025-12-10 12:00生效",
        "extra": "",
        "id": 407,
        "publishDate": "2025-12-10T02:48:07.324Z",
        "type": "ongoing"
      },
      {
        "content": "2025-12-09\n\nGemini CLI专用分组 倍率灵活调整：\n\ndefault用户分组 Gemini CLI专用分组模型 由1.5下降至1.3，北京时间2025-12-09 21:30生效\n\nTier1用户分组 Gemini CLI专用分组模型 由1.4下降至1.3，北京时间2025-12-09 21:30生效\n\nTier2、Tier3、Business用户分组不变，详情可查看：https://doc.duckcoding.com",
        "extra": "",
        "id": 406,
        "publishDate": "2025-12-09T13:28:12.428Z",
        "type": "success"
      },
      {
        "content": "2025-12-09\n\nCodeX专用分组、CodeX专用（Droid）分组 倍率灵活调整：\n\ndefault用户分组 CodeX专用分组、CodeX专用（Droid）分组模型 由0.8下降至0.6，北京时间2025-12-09 21:30生效\n\nT
```

> ⚠️ 响应已截断（原始长度: 18672 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "Claude Code专用",
    "Claude Code专用-特价",
    "Claude Code专用-超特价",
    "Claude Code专用-官key",
    "Claude Code专用-Azure",
    "Claude Code专用-Azure特价",
    "Claude Code专用-2api",
    "Claude Code专用-特价2api",
    "CodeX专用",
    "CodeX专用（Droid）",
    "Gemini CLI专用",
    "Gemini CLI专用-Antigravity",
    "default"
  ],
  "data": [
    {
      "model_name": "gemini-2.5-flash-lite",
      "icon": "Gemini.Color",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 0.05,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default",
        "Gemini CLI专用",
        "Gemini CLI专用-Antigravity"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "o4-mini",
      "icon": "OpenAI.Color",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.55,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-3-pro-high",
      "icon": "Gemini.Color",
      "vendor_id": 3,
      "quota_type": 0,
      "model_ratio": 1,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 6,
      "enable_groups": [
        "default",
        "Gemini CLI专用",
        "Gemini CLI专用-Antigravity"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "grok-3-deepsearch",
      "vendor_id": 6,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "sora_video2-portrait-pro-25s",
      "icon": "OpenAI.Color",
      "vendor_id": 2,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 2.5,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai-video"
      ]
    },
    {
      "model_name": "gpt-5-codex",
      "icon": "OpenAI.Color",
      "vendor_id": 2,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
        "CodeX专用（Droid）",
        "CodeX专用"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "gemini-2.5-flash-storybook",
      "icon": "Gemini.Color",
      "vendor_id": 3,
      "quota_type": 1,
      "model_ratio": 0,
      "model_price": 0.5,
      "owner_by": "",
      "completion_ratio": 0,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001-thinking",
      "vendor_id": 1
```

> ⚠️ 响应已截断（原始长度: 30536 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134322894937145QO7Z1D4P)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "kOxC",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 22196,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 500000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_22196",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "4CoWkSY18azIGCLPGKb14ShYx1S68A==",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "Claude Code专用": {
      "desc": "自建Max200刀订阅号池，满血，只可用于Claude Code，稳定",
      "ratio": 1.5
    },
    "Claude Code专用-2api": {
      "desc": "逆向三方平台，无场景限制，可工具调用，不稳定",
      "ratio": 0.6
    },
    "Claude Code专用-Azure": {
      "desc": "Claude Azure，Sonnet模型1M上下文，满血，1小时缓存生效时间，只可用于Claude Code，稳定",
      "ratio": 0.7
    },
    "Claude Code专用-Azure特价": {
      "desc": "Claude Azure，Sonnet模型1M上下文，满血，1小时缓存生效时间，只可用于Claude Code，特价不稳定",
      "ratio": 0.4
    },
    "Claude Code专用-官key": {
      "desc": "Claude官方API key，Sonnet模型1M上下文，满血，只可用于Claude Code，稳定",
      "ratio": 7.3
    },
    "Claude Code专用-特价": {
      "desc": "自建Max200刀订阅号池，满血，只可用于Claude Code，特价不稳定",
      "ratio": 0.95
    },
    "Claude Code专用-特价2api": {
      "desc": "逆向三方平台，无场景限制，可工具调用，特价不稳定",
      "ratio": 0.3
    },
    "Claude Code专用-超特价": {
      "desc": "自建Max200刀订阅号池，满血，只可用于Claude Code，超特价不稳定",
      "ratio": 0.5
    },
    "CodeX专用": {
      "desc": "自建Team订阅号池，满血，无场景限制",
      "ratio": 0.8
    },
    "CodeX专用（Droid）": {
      "desc": "自建Team订阅号池，满血，无场景限制，适配Droid CLI",
      "ratio": 0.8
    },
    "Gemini CLI专用": {
      "desc": "自建号池，满血，只可用于Gemini CLI",
      "ratio": 1.5
    },
    "Gemini CLI专用-Antigravity": {
      "desc": "逆向Antigravity，满血，无场景限制",
      "ratio": 0.8
    },
    "default": {
      "desc": "可用于一般对话场景，无工具调用",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Fengye API

- **URL**: https://fengyeai.chat/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":false,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":true},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "gemini-3-pro-preview回归！另外佬友们如果可以提供https://letta.com这���的key可以让gemini-3更稳定，后续会适配v1beta的路径。如果有佬友需要捐赠可以在站内私聊我我会给给予相应兑换码作为报酬",
        "extra": "",
        "id": 13,
        "publishDate": "2025-12-14T10:05:02.150Z",
        "type": "default"
      },
      {
        "content": "因不可抗因素，gpt系列暂时会不稳定，等后续政策或稳定后才能维持。现在的情况是能用但价格上涨，佬友们抱歉暂时先用其它模型顶顶吧",
        "extra": "",
        "id": 12,
        "publishDate": "2025-12-14T05:23:54.241Z",
        "type": "default"
      },
      {
        "content": "cc-temp补货",
        "extra": "",
        "id": 11,
        "publishDate": "2025-12-12T14:00:19.168Z",
        "type": "default"
      },
      {
        "content": "上新gpt-5.2",
        "extra": "",
        "id": 10,
        "publishDate": "2025-12-12T04:25:44.654Z",
        "type": "default"
      },
      {
        "content": "新增站内佬友不定时公益cc分组",
        "extra": "",
        "id": 9,
        "publishDate": "2025-12-06T10:01:31.788Z",
        "type": "default"
      },
      {
        "content": "gemini恢复",
        "extra": "",
        "id": 8,
        "publishDate": "2025-11-27T14:26:43.704Z",
        "type": "success"
      },
      {
        "content": "恢复服务，站点目前支持 ?key=sk-xxx、http://sk-xxx@host/ 或 Basic Auth 携带 key 这三种key请求方式，如有bug请反馈",
        "extra": "",
        "id": 7,
        "publishDate": "2025-11-24T09:18:06.412Z",
        "type": "success"
      },
      {
        "content": "续gemini-3-pro-preview，上新一些模型，codex建议使用gpt-5-codex，比较稳定",
        "extra": "",
        "id": 6,
        "publishDate": "2025-11-22T07:08:12.301Z",
        "type": "ongoing"
      },
      {
        "content": "上新gemini-3-pro-preview，佬友们蹬慢些，量不多",
        "extra": "",
        "id": 5,
        "publishDate": "2025-11-20T03:52:00.722Z",
        "type": "success"
      },
      {
        "content": "上新gpt5.1",
        "extra": "",
        "id": 4,
        "publishDate": "2025-11-13T09:05:37.212Z",
        "type": "success"
      },
      {
        "content": "如果有需要添加的模型可以在回复中提及，我会尝试添加。截至11.30",
        "extra": "",
        "id": 3,
        "publishDate": "2025-11-10T15:13:59.345Z",
        "type": "ongoing"
      },
      {
        "content": "其它模型先别蹬了，优先gpt-5和codex",
        "extra": "",
        "id": 2,
        "publishDate": "2025-11-10T09:22:24.250Z",
        "type": "success"
      },
      {
        "content": "复活！",
        "extra": "",
        "id": 1,
        "publishDate": "2025-11-09T12:14:37
```

> ⚠️ 响应已截断（原始长度: 4499 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "gemini-2.5-flash",
      "description": "gemini-2.5-flash 是由 sap-ai-core 提供的人工智能模型。",
      "tags": "推理,工具,文件,多模态,音频,1M",
      "vendor_id": 15,
      "quota_type": 0,
      "model_ratio": 0.0375,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "gemini",
        "openai"
      ]
    },
    {
      "model_name": "deepseek-v3.2",
      "description": "DeepSeek V3.2 是由 venice 提供的人工智能模型。",
      "tags": "工具,开源权重,128K",
      "vendor_id": 14,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 4,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101",
      "description": "Claude Opus 4.5 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "claudecode",
        "cc-temp",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "grok-4.1-thinking",
      "vendor_id": 10,
      "quota_type": 0,
      "model_ratio": 1.25,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 6,
      "enable_groups": [
        "default"
      ],
      "supported_endpoint_types": [
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "cc-temp",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-haiku-4-5-20251001",
      "description": "Anthropic: Claude 4.5 Haiku (20251001) 是由 helicone 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "cc-deepseek",
        "cc-glm",
        "cc-qwen",
        "claudecode",
        "cc-temp",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "gpt-5.1-codex",
      "description": "GPT-5.1 Codex 是由 opencode 提供的人工智能模型。",
      "icon": "OpenCode",
      "tags": "推理,工具,文件,多模态,400K",
      "vendor_id": 5,
      "quota_type": 0,
      "model_ratio": 0.625,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 8,
      "enable_groups": [
 
```

> ⚠️ 响应已截断（原始长度: 7547 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134344160775243yVqyPiXN)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "3la6",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 778,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 50000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_778",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "Beq3EfjKwAcDunzkgj3mNKwXLKFsLJwU",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "cc-deepseek": {
      "desc": "cc-deepseek",
      "ratio": 0.2
    },
    "cc-glm": {
      "desc": "cc-glm",
      "ratio": 0.2
    },
    "cc-qwen": {
      "desc": "cc-qwen",
      "ratio": 0.2
    },
    "cc-temp": {
      "desc": "cc 临时，根据公告不定时开放",
      "ratio": 0.2
    },
    "claudecode": {
      "desc": "claudecode cli",
      "ratio": 10000
    },
    "codex": {
      "desc": "codex cli",
      "ratio": 0.8
    },
    "default": {
      "desc": "默认分组",
      "ratio": 1
    },
    "kimi": {
      "desc": "kimi可使用cc",
      "ratio": 0.2
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## OpenClaudeCode

- **URL**: https://www.openclaudecode.cn/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":false,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":false,\"chat\":false},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "双十二免费活动日：https://linux.do/t/topic/1299515",
        "extra": "",
        "id": 3,
        "publishDate": "2025-12-11T14:43:55.489Z",
        "type": "ongoing"
      },
      {
        "content": "七天限时充值折扣活动已开启，活动于12.12日结束。",
        "extra": "",
        "id": 2,
        "publishDate": "2025-12-05T07:55:55.252Z",
        "type": "default"
      },
      {
        "content": "QQ群：929856936\nTelegram：https://telegram.me/open_claude",
        "extra": "",
        "id": 1,
        "publishDate": "2025-12-02T06:04:57.730Z",
        "type": "success"
      }
    ],
    "announcements_enabled": true,
    "api_info": [
      {
        "color": "blue",
        "description": "直连路线，安全可靠。",
        "id": 1,
        "route": "主站线路",
        "url": "https://www.openclaudecode.cn"
      },
      {
        "color": "blue",
        "description": "国内优化路线，不要挂梯子。",
        "id": 2,
        "route": "DMIT优化线路",
        "url": "https://api-slb.openclaudecode.cn"
      }
    ],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://ai.feishu.cn/drive/folder/UQgzfSmeSlDA8Nd43UOc0WOCnRd",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "Iv23liJcKwWYTwQpChD5",
    "github_oauth": false,
    "linuxdo
```

> ⚠️ 响应已截断（原始长度: 3336 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default"
  ],
  "data": [
    {
      "model_name": "claude-sonnet-4-5-20250929-thinking",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "default",
        "enterprise",
        "free_all",
        "free_vip",
        "special",
        "admin",
        "claude"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-3-5-haiku-20241022",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.4,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "special",
        "admin",
        "claude",
        "default",
        "enterprise",
        "free_all",
        "free_vip"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-1-20250805",
      "description": "Claude Opus 4.1 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "enterprise",
        "free_all",
        "free_vip",
        "special",
        "admin",
        "claude",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-20250514",
      "description": "Claude Opus 4 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 7.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "enterprise",
        "free_all",
        "free_vip",
        "special",
        "admin",
        "claude",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101",
      "description": "Claude Opus 4.5 是由 anthropic 提供的人工智能模型。",
      "icon": "Claude.Color",
      "tags": "推理,工具,文件,多模态,200K",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "admin",
        "claude",
        "default",
        "enterprise",
        "free_all",
        "free_vip",
        "special"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-20250514",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "claude",
        "default",
      
```

> ⚠️ 响应已截断（原始长度: 3796 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134406747879264xE6swPAc)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "7nzJ",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 5208,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": -5,
    "request_count": 5,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 5,
    "username": "linuxdo_5208",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "9ilCyWB/y9Yzn8g3hSoy7c4H4aMu",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "claude": {
      "current_spending": 0,
      "desc": "稳定分组",
      "eligible": true,
      "filter_type": "",
      "ratio": 0.55,
      "reason": "",
      "required_spending": 0
    },
    "default": {
      "current_spending": 0,
      "desc": "默认分组",
      "eligible": true,
      "filter_type": "",
      "ratio": 1,
      "reason": "",
      "required_spending": 0
    },
    "free_vip": {
      "current_spending": 0,
      "desc": "特惠分组",
      "eligible": true,
      "filter_type": "",
      "ratio": 0.2,
      "reason": "",
      "required_spending": 0
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## 无言AI

- **URL**: https://aiai.li/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 404 | ❌ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 301 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "InviteRegisterEnabled": false,
    "InvoiceMinAmount": 1,
    "QuotaForInvitee": 0,
    "QuotaForInviter": 15000000,
    "RechargeDiscount": {
      "Tier1": 1
    },
    "RechargeType": "input,select",
    "TopUpBanner": "",
    "aff_limit": 3,
    "aff_rate": 10,
    "chats": [
      {
        "logo": "https://raw.githubusercontent.com/Dooy/chatgpt-web-midjourney-proxy/33ca008832510af2c5bc4d07082dd7055c324c84/public/favicon.svg",
        "name": "Chat-MJ",
        "url": "https://chat.innk.cc/#/?settings={%22key%22:%22{key}%22,%22url%22:%22{host}%22}"
      },
      {
        "logo": "https://raw.githubusercontent.com/ChatGPTNextWeb/NextChat/553b8c9f284bff6ec059b4d69f3f91c10105fbc0/app/icons/logo.svg",
        "name": "Chat-Basic",
        "url": "https://app.nextchat.dev/#/?settings={%22key%22:%22{key}%22,%22url%22:%22{host}%22}"
      }
    ],
    "chats_verify_enabled": false,
    "checkin_max_quota": 10000000,
    "checkin_min_quota": 10000000,
    "company_verify_enabled": false,
    "currency_symbol": "USD",
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "email_verification": true,
    "enable_aff": false,
    "enable_aff_verify": false,
    "enable_batch_update": true,
    "enable_checkin": true,
    "enable_data_export": true,
    "enable_drawing": true,
    "enable_task": true,
    "footer_html": "",
    "github_client_id": "Iv23liNzt6YLXB6SLpa2",
    "github_oauth": false,
    "google_client_id": "",
    "google_oauth": false,
    "header_nav": [
      {
        "content": "/",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "主页",
        "path": "/"
      },
      {
        "content": "/panel",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "工作台",
        "path": "/panel"
      },
      {
        "content": "/chat",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "聊天/绘画",
        "path": "/chat"
      },
      {
        "content": "/pricing",
        "displayType": "internal_route",
        "enabled": true,
        "isDefault": true,
        "name": "模型列表",
        "path": "/pricing"
      }
    ],
    "is_agent": "false",
    "linuxdo_client_id": "MChJyr0fTHdOv1l4TdnCuQd9dgsUz8KB",
    "linuxdo_minimum_trust_level": 0,
    "linuxdo_oauth": true,
    "logo": "",
    "mj_notify_enabled": true,
    "new_user_level": "Tier 1",
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "",
    "passkey_login": false,
    "passkey_origins": "http://localhost:3000",
    "passkey_rp_id":
```

> ⚠️ 响应已截断（原始长度: 3092 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "group_info": {
      "default": {
        "Description": "基础用户分组",
        "DisplayName": "default",
        "GroupRatio": 1
      }
    },
    "model_info": [
      {
        "model_name": "claude-haiku-4-5-20251001",
        "description": "Anthropic: Claude 4.5 Haiku (20251001) 是由 helicone 提供的人工智能模型。",
        "tags": "工具,多模态,200K",
        "vendor_id": 2,
        "price_info": {
          "default": {
            "default": {
              "quota_type": 1,
              "model_price": 0,
              "model_ratio": 0.5,
              "model_completion_ratio": 5,
              "model_create_cache_ratio": 1.25,
              "model_cache_ratio": 1,
              "model_audio_ratio": 1,
              "model_audio_completion_ratio": 0,
              "priceInfo": null,
              "multiplicativeFactors": null
            }
          }
        },
        "owner_by": "",
        "enable_groups": [
          "default"
        ],
        "supported_endpoint_types": [],
        "publish_time": 0
      },
      {
        "model_name": "claude-opus-4-5-20251101",
        "description": "Claude Opus 4.5 是由 anthropic 提供的人工智能模型。",
        "icon": "Claude.Color",
        "tags": "推理,工具,文件,多模态,200K",
        "vendor_id": 2,
        "price_info": {
          "default": {
            "default": {
              "quota_type": 1,
              "model_price": 0,
              "model_ratio": 2.5,
              "model_completion_ratio": 5,
              "model_create_cache_ratio": 1.25,
              "model_cache_ratio": 1,
              "model_audio_ratio": 1,
              "model_audio_completion_ratio": 0,
              "priceInfo": null,
              "multiplicativeFactors": null
            }
          }
        },
        "owner_by": "",
        "enable_groups": [
          "default"
        ],
        "supported_endpoint_types": [],
        "publish_time": 0
      },
      {
        "model_name": "claude-opus-4-5-20251101-thinking",
        "description": "Claude Opus 4.5 是由 anthropic 提供的人工智能模型。",
        "icon": "Claude.Color",
        "tags": "推理,工具,文件,多模态,200K",
        "vendor_id": 2,
        "price_info": {
          "default": {
            "default": {
              "quota_type": 1,
              "model_price": 0,
              "model_ratio": 2.5,
              "model_completion_ratio": 5,
              "model_create_cache_ratio": 1.25,
              "model_cache_ratio": 1,
              "model_audio_ratio": 1,
              "model_audio_completion_ratio": 0,
              "priceInfo": null,
              "multiplicativeFactors": null
            }
          }
        },
        "owner_by": "",
        "enable_groups": [
          "default"
        ],
        "supported_endpoint_types": [],
        "publish_time": 0
      },
      {
        "model_name": "claude-sonnet-4-20250514",
        "description": "Claude Sonnet 4 是由 anthropic 提供的人工智能模型。",
        "icon": "Claude.Color",
        "tags": "推理,工具,文件,多模态,200K",
        "vendor
```

> ⚠️ 响应已截断（原始长度: 4034 字符）

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "Invalid Token (request id: 20251215134422687405263W0UimShN)",
    "type": "rix_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "id": 1209,
    "username": "linuxdo_1209",
    "password": "",
    "original_password": "",
    "display_name": "Sponge",
    "role": 1,
    "status": 1,
    "email": "",
    "github_id": "",
    "discord_id": "",
    "oidc_id": "",
    "google_id": "",
    "linuxdo_id": "139654",
    "wechat_id": "",
    "verification_code": "",
    "access_token": "1BR3HAALpuVl8M8UXl6WYirLMIa6rA==",
    "quota": 25000000,
    "bonus_quota": 10000000,
    "used_quota": 0,
    "topup_amount": 50,
    "invoice_amount": 0,
    "request_count": 0,
    "topup_count": 1,
    "aff_code": "bT31",
    "aff_count": 0,
    "aff_quota": 0,
    "aff_history_quota": 0,
    "inviter_id": 0,
    "stripe_customer": "",
    "created_at": 1765530330,
    "DeletedAt": null,
    "last_login_at": 1765530381,
    "level": "Tier 1",
    "group_ratio": "{}",
    "model_ratio": "{}",
    "rate_limits": "{}",
    "agent_user_id": 1,
    "use_group": "",
    "disabled_channels": "",
    "model_limits_enabled": false,
    "topup_enabled": true,
    "model_limits": "",
    "avatar": "Upstream.svg",
    "PushSettings": {
      "user_id": 1209,
      "subscription_options": "quota_push",
      "notice_type": "email"
    },
    "VerifyInfo": {
      "type": "",
      "status": "",
      "created_at": "0001-01-01T00:00:00Z",
      "updated_at": "0001-01-01T00:00:00Z"
    },
    "session_version": 1765530381326783000
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "qIqa/UEoHW5fhbwgZVkXe0yh0u/Y",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user/self/groups)",
    "type": "invalid_request_error",
    "code": ""
  }
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/user/">Moved Permanently</a>.


```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

## Free DuckCoding

- **URL**: https://free.duckcoding.com/
- **认证状态**: ✅ 已配置

### 端点测试结果

| 端点 | 说明 | 文档 | 代码 | 状态 | 结果 |
|:-----|:-----|:----:|:----:|:----:|:----:|
| `/api/status` | 系统状态 | ✅ | ✅ | 200 | ✅ |
| `/api/models` | 模型列表(仪表盘) | ✅ | ❌ | 401 | ❌ |
| `/api/pricing` | 定价信息 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/prices` | 定价列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/api/available_model` | 可用模型 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/user_group_map` | 用户组倍率 (one-hub/done-hub) | ✅ | ✅ | 404 | ❌ |
| `/api/ownedby` | 模型厂商列表 (one-hub/done-hub) | ✅ | ❌ | 404 | ❌ |
| `/v1/models` | OpenAI 兼容模型列表 | ❌ | ✅ | 401 | ❌ |
| `/api/user/self` | 获取当前用户信息 | ✅ | ✅ | 200 | ✅ |
| `/api/user/token` | 生成访问令牌 | ✅ | ✅ | 200 | ✅ |
| `/api/user/models` | 获取用户可用模型 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/available_models` | 获取用户可用模型 (one-api) | ✅ | ✅ | 200 | ✅ |
| `/api/user/self/groups` | 获取用户分组 (new-api/Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user/groups` | 获取用户组列表 (new-api/Veloera) | ❌ | ✅ | 200 | ✅ |
| `/api/user/dashboard` | 用户仪表盘 (one-hub/done-hub) | ✅ | ✅ | 200 | ✅ |
| `/api/user/check_in_status` | 签到状态 (Veloera) | ✅ | ✅ | 200 | ✅ |
| `/api/user` | 用户信息 (简化站点回退) | ❌ | ✅ | 404 | ❌ |
| `/api/group` | 用户分组 (one-api 回退) | ❌ | ✅ | 301 | ❌ |
| `/api/token/` | 获取令牌列表 | ✅ | ✅ | 200 | ✅ |
| `/api/token/?p=0&size=10` | 获取令牌列表 (分页p=0) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?p=1&size=10` | 获取令牌列表 (分页p=1) | ❌ | ✅ | 200 | ✅ |
| `/api/token/?page=1&size=10` | 获取令牌列表 (分页page=1) | ❌ | ✅ | 200 | ✅ |
| `/api/log/self?p=0&size=10` | 获取用户日志 | ✅ | ✅ | 200 | ✅ |
| `/api/log/self/stat` | 用户日志统计 | ✅ | ❌ | 200 | ✅ |

### 详细响应

#### `/api/status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "HeaderNavModules": "{\"home\":true,\"console\":true,\"pricing\":{\"enabled\":true,\"requireAuth\":false},\"docs\":true,\"about\":false}",
    "SidebarModulesAdmin": "{\"chat\":{\"enabled\":true,\"playground\":true,\"chat\":true},\"console\":{\"enabled\":true,\"detail\":true,\"token\":true,\"log\":true,\"midjourney\":false,\"task\":false},\"personal\":{\"enabled\":true,\"topup\":true,\"personal\":true},\"admin\":{\"enabled\":true,\"channel\":true,\"models\":true,\"redemption\":true,\"user\":true,\"setting\":true}}",
    "announcements": [
      {
        "content": "2025-12-14\n\n免费提供Claude Code专用-Azure\n\n注册送200额度，邀请和被邀请送50，为防止注册机，只允许L站1级用户注册\n\n默认1H缓存生效时间，/model sonnet[1m]，开启1M上下文\n\n感谢大家支持\n\n追求稳定可考虑主站站：https://duckcoding.com",
        "extra": "",
        "id": 1,
        "publishDate": "2025-12-13T17:28:25.158Z",
        "type": "success"
      }
    ],
    "announcements_enabled": true,
    "api_info": [
      {
        "color": "green",
        "description": "全球加速渠道",
        "id": 1,
        "route": "全球加速渠道",
        "url": "https://free.duckcoding.com"
      }
    ],
    "api_info_enabled": true,
    "chats": [
      {
        "Cherry Studio": "cherrystudio://providers/api-keys?v=1&data={cherryConfig}"
      },
      {
        "流畅阅读": "fluentread"
      },
      {
        "Lobe Chat 官方示例": "https://chat-preview.lobehub.com/?settings={\"keyVaults\":{\"openai\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\"}}}"
      },
      {
        "AI as Workspace": "https://aiaw.app/set-provider?provider={\"type\":\"openai\",\"settings\":{\"apiKey\":\"{key}\",\"baseURL\":\"{address}/v1\",\"compatibility\":\"strict\"}}"
      },
      {
        "AMA 问天": "ama://set-api-key?server={address}&key={key}"
      },
      {
        "OpenCat": "opencat://team/join?domain={address}&token={key}"
      }
    ],
    "custom_currency_exchange_rate": 1,
    "custom_currency_symbol": "¤",
    "data_export_default_time": "hour",
    "default_collapse_sidebar": false,
    "default_use_auto_group": true,
    "demo_site_enabled": false,
    "discord_client_id": "",
    "discord_oauth": false,
    "display_in_currency": true,
    "docs_link": "https://doc.duckcoding.com",
    "email_verification": false,
    "enable_batch_update": false,
    "enable_data_export": true,
    "enable_drawing": false,
    "enable_task": true,
    "faq": [],
    "faq_enabled": true,
    "footer_html": "",
    "github_client_id": "",
    "github_oauth": false,
    "linuxdo_client_id": "XNJfOdoSeXkcx80mDydoheJ0nZS4tjIf",
    "linuxdo_minimum_trust_level": 1,
    "linuxdo_oauth": true,
    "logo": "https://s3.bmp.ovh/imgs/2025/02/26/8e28432e3ca1fefd.gif",
    "mj_notify_enabled": false,
    "oidc_authorization_endpoint": "",
    "oidc_client_id": "",
    "oidc_enabled": false,
    "passkey_allow_insecure": false,
    "passkey_attachment": "",
    "passkey_display_name": "Free DuckCoding",
    "passkey_login": true,
    "passkey_origins": "https://free.duckcoding.com",
   
```

> ⚠️ 响应已截断（原始长度: 3078 字符）

#### `/api/models`

**来源**: 文档✅ | 代码❌

**状态码**: 401

```json
{
  "message": "无权进行此操作，未登录且未提供 access token",
  "success": false
}
```

#### `/api/pricing`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "auto_groups": [
    "default",
    "Claude Code专用-Azure"
  ],
  "data": [
    {
      "model_name": "claude-haiku-4-5-20251001",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 0.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "Claude Code专用-Azure",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-opus-4-5-20251101",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 2.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "Claude Code专用-Azure",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    },
    {
      "model_name": "claude-sonnet-4-5-20250929",
      "vendor_id": 1,
      "quota_type": 0,
      "model_ratio": 1.5,
      "model_price": 0,
      "owner_by": "",
      "completion_ratio": 5,
      "enable_groups": [
        "Claude Code专用-Azure",
        "default"
      ],
      "supported_endpoint_types": [
        "anthropic",
        "openai"
      ]
    }
  ],
  "group_ratio": {
    "Claude Code专用-Azure": 1,
    "default": 1
  },
  "success": true,
  "supported_endpoint": {
    "anthropic": {
      "path": "/v1/messages",
      "method": "POST"
    },
    "openai": {
      "path": "/v1/chat/completions",
      "method": "POST"
    }
  },
  "usable_group": {
    "Claude Code专用-Azure": "Claude Code专用-Azure分组",
    "default": "default"
  },
  "vendors": [
    {
      "id": 1,
      "name": "Anthropic",
      "icon": "Claude.Color"
    }
  ]
}
```

#### `/api/prices`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/prices)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/available_model`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/available_model)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/user_group_map`

**来源**: 文档✅ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user_group_map)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/ownedby`

**来源**: 文档✅ | 代码❌

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/ownedby)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/v1/models`

**来源**: 文档❌ | 代码✅

**状态码**: 401

```json
{
  "error": {
    "code": "",
    "message": "无效的令牌 (request id: 20251215134435745704199Lyf2rLCF)",
    "type": "new_api_error"
  }
}
```

#### `/api/user/self`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "aff_code": "aBeb",
    "aff_count": 0,
    "aff_history_quota": 0,
    "aff_quota": 0,
    "discord_id": "",
    "display_name": "Sponge",
    "email": "",
    "github_id": "",
    "group": "default",
    "id": 3490,
    "inviter_id": 0,
    "linux_do_id": "139654",
    "oidc_id": "",
    "permissions": {
      "sidebar_modules": {
        "admin": false
      },
      "sidebar_settings": true
    },
    "quota": 100000000,
    "request_count": 0,
    "role": 1,
    "setting": "{\"gotify_priority\":0,\"sidebar_modules\":\"{\\\"chat\\\":{\\\"chat\\\":true,\\\"enabled\\\":true,\\\"playground\\\":true},\\\"console\\\":{\\\"detail\\\":true,\\\"enabled\\\":true,\\\"log\\\":true,\\\"midjourney\\\":true,\\\"task\\\":true,\\\"token\\\":true},\\\"personal\\\":{\\\"enabled\\\":true,\\\"personal\\\":true,\\\"topup\\\":true}}\"}",
    "sidebar_modules": "{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}",
    "status": 1,
    "stripe_customer": "",
    "telegram_id": "",
    "used_quota": 0,
    "username": "linuxdo_3490",
    "wechat_id": ""
  },
  "message": "",
  "success": true
}
```

#### `/api/user/token`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "data": "S8fi/YeuN+C9e9qM2kreYe2NRJevz3I=",
  "message": "",
  "success": true
}
```

#### `/api/user/models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/available_models`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/self/groups`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/groups`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "data": {
    "Claude Code专用-Azure": {
      "desc": "Claude Code专用-Azure分组",
      "ratio": 1
    },
    "default": {
      "desc": "default",
      "ratio": 1
    }
  },
  "message": "",
  "success": true
}
```

#### `/api/user/dashboard`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user/check_in_status`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/user`

**来源**: 文档❌ | 代码✅

**状态码**: 404

```json
{
  "error": {
    "message": "Invalid URL (GET /api/user)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### `/api/group`

**来源**: 文档❌ | 代码✅

**状态码**: 301

```json
<a href="/api/group/">Moved Permanently</a>.


```

#### `/api/token/`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=0&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?p=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/token/?page=1&size=10`

**来源**: 文档❌ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self?p=0&size=10`

**来源**: 文档✅ | 代码✅

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

#### `/api/log/self/stat`

**来源**: 文档✅ | 代码❌

**状态码**: 200

```json
{
  "message": "无权进行此操作，access token 无效",
  "success": false
}
```

---

