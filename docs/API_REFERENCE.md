# API 接口参考文档

> 本文档整理了 One API 系列项目（one-api、new-api、Veloera、one-hub、done-hub、VoAPI、Super-API）的完整接口信息。
>
> **最后更新时间**：2026-02-24
> **版本**：v2.1.22

---

## 1. 项目概述

| 项目 | 基础框架 | 特点 |
| :--- | :--- | :--- |
| **one-api** | 原版 | 基础功能，最稳定 |
| **new-api** | one-api 二开 | 支持系统初始化、2FA、Passkey、Stripe支付 |
| **Veloera** | new-api 二开 | 签到功能、消息系统、模型映射 |
| **one-hub** | one-api 二开 | 用户组管理、渠道标签、数据分析 |
| **done-hub** | one-hub 二开 | 邀请码系统、发票系统、WebAuthn |
| **VoAPI** | 独立开发 | 规则引擎、多货币、日志分表 |
| **Super-API** | new-api 二开 | 闭源，UI重构、签到、礼品码 |

---

## 2. 认证系统

### 2.1 认证方式

1. **Cookie 认证 (Session)** - 适用于 Web 管理界面
2. **Token 认证 (Bearer Token)** - 请求头：`Authorization: Bearer <token>`

---

## 3. 公共信息接口 (`/api`)

| 接口 | 方法 | 说明 | 支持项目 |
| :--- | :---: | :--- | :--- |
| `/api/status` | GET | 系统状态 | 全部 |
| `/api/models` | GET | 模型列表(仪表盘) | 全部 |
| `/api/pricing` | GET | 定价信息 | new-api, Veloera |
| `/api/prices` | GET | 定价列表 | one-hub, done-hub |
| `/api/available_model` | GET | 可用模型(含价格) | one-hub, done-hub |
| `/api/user_group_map` | GET | 用户组倍率 | one-hub, done-hub |

---

## 4. 用户接口 (`/api/user`)

### 4.1 个人信息 (需用户认证)

| 接口 | 方法 | 说明 | 支持项目 |
| :--- | :---: | :--- | :--- |
| `/api/user/self` | GET | 获取当前用户信息 | 全部 |
| `/api/user/self` | PUT | 更新当前用户信息 | 全部 |
| `/api/user/self` | DELETE | 删除当前用户 | one-api, new-api, Veloera |
| `/api/user/token` | GET | 生成访问令牌 | 全部 |
| `/api/user/aff` | GET | 获取邀请码 | 全部 |
| `/api/user/models` | GET | 获取用户可用模型 | new-api, Veloera |
| `/api/user/available_models` | GET | 获取用户可用模型 | one-api |
| `/api/user/self/groups` | GET | 获取用户分组 | new-api, Veloera |
| `/api/user/groups` | GET | 获取用户组列表 | new-api, Veloera |

### 4.2 充值相关 (需用户认证)

| 接口 | 方法 | 说明 | 支持项目 |
| :--- | :---: | :--- | :--- |
| `/api/user/topup` | POST | 兑换码充值 | 全部 |
| `/api/user/topup/self` | GET | 充值记录 | new-api |
| `/api/user/topup/info` | GET | 充值信息（含支付方式列表） | new-api |
| `/api/user/amount` | POST | 获取 LDC 兑换比例 | new-api (支持 LDC 支付的站点)，需要站点会话时自动回退浏览器模式 |
| `/api/user/pay` | POST | 发起 LDC 充值请求 | new-api (支持 LDC 支付的站点) |

### 4.3 仪表盘 (需用户认证)

| 接口 | 方法 | 说明 | 支持项目 |
| :--- | :---: | :--- | :--- |
| `/api/user/dashboard` | GET | 用户仪表盘 | one-api, one-hub, done-hub |
| `/api/user/dashboard/rate` | GET | 实时速率 | one-hub, done-hub |


### 4.4 特色功能 (需用户认证)

| 接口 | 方法 | 说明 | 支持项目 |
| :--- | :---: | :--- | :--- |
| `/api/user/check_in_status` | GET | 签到状态 | Veloera |
| `/api/user/check_in` | POST | 每日签到 | Veloera |

---

## 5. 令牌管理接口 (`/api/token`)

所有接口需用户认证。

| 接口 | 方法 | 说明 |
| :--- | :---: | :--- |
| `/api/token/` | GET | 获取令牌列表 |
| `/api/token/search` | GET | 搜索令牌 |
| `/api/token/:id` | GET | 获取指定令牌 |
| `/api/token/` | POST | 创建令牌 |
| `/api/token/` | PUT | 更新令牌 |
| `/api/token/:id` | DELETE | 删除令牌 |
| `/api/token/batch` | POST | 批量删除 (new-api) |
| `/api/token/playground` | GET | 获取Playground令牌 (one-hub, done-hub) |

---

## 6. 日志接口 (`/api/log`)

| 接口 | 方法 | 权限 | 说明 |
| :--- | :---: | :--- | :--- |
| `/api/log/self` | GET | 用户 | 获取当前用户日志 |
| `/api/log/self/search` | GET | 用户 | 搜索用户日志 |
| `/api/log/self/stat` | GET | 用户 | 用户日志统计 |
| `/api/log/self/export` | GET | 用户 | 导出用户日志 (done-hub) |
| `/api/log/token` | GET | 用户 | 按令牌查询日志 (new-api, Veloera) |

---

## 7. 详细响应结构

### 7.1 标准响应格式

所有管理 API 接口返回统一的 JSON 格式：

**成功响应：**
```json
{
  "success": true,
  "message": "",
  "data": { ... }
}
```

**错误响应：**
```json
{
  "success": false,
  "message": "错误信息"
}
```

### 7.1.1 各项目响应结构差异总览

| 特性 | one-api | new-api | Veloera | one-hub | done-hub |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **登录响应含 group 字段** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **登录响应含 avatar_url 字段** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **2FA 登录流程** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **用户信息含 permissions 字段** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **用户信息含 sidebar_modules 字段** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **用户信息含 stripe_customer 字段** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **分页响应格式** | 数组 | 对象 | 对象 | 对象 | 对象 |
| **实时速率接口** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **消息系统接口** | ❌ | ❌ | ✅ | ❌ | ❌ |

### 7.1.2 分页响应格式差异

**one-api 分页响应（数组格式）：**
```json
{
  "success": true,
  "message": "",
  "data": [
    { "id": 1, ... },
    { "id": 2, ... }
  ]
}
```

**new-api/Veloera/one-hub/done-hub 分页响应（对象格式）：**
```json
{
  "success": true,
  "message": "",
  "data": {
    "items": [
      { "id": 1, ... },
      { "id": 2, ... }
    ],
    "total": 100,
    "page": 1,
    "page_size": 10
  }
}
```

---

### 7.2 公共信息接口响应

#### `/api/status` - 系统状态
```json
{
  "success": true,
  "message": "",
  "data": {
    "version": "v0.0.1",
    "start_time": 1699999999,
    "email_verification": true,
    "github_oauth": true,
    "github_client_id": "xxx",
    "linuxdo_oauth": false,
    "telegram_oauth": false,
    "system_name": "One API",
    "logo": "/logo.png",
    "footer_html": "",
    "wechat_qrcode": "",
    "wechat_login": false,
    "server_address": "https://api.example.com",
    "turnstile_check": false,
    "turnstile_site_key": "",
    "top_up_link": "",
    "quota_per_unit": 500000,
    "display_in_currency": false,
    "enable_batch_update": false,
    "enable_drawing": true,
    "enable_task": true,
    "oidc_enabled": false,
    "passkey_login": false,
    "setup": true
  }
}
```

#### `/api/models` - 模型列表(仪表盘)
```json
{
  "success": true,
  "message": "",
  "data": ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "claude-3-opus"]
}
```

#### `/api/pricing` - 定价信息 (new-api/Veloera)
```json
{
  "success": true,
  "data": [
    {
      "model_name": "gpt-4",
      "quota_type": 0,
      "model_ratio": 15,
      "model_price": 0.03,
      "completion_ratio": 1.5,
      "enable_groups": ["default", "vip"]
    }
  ],
  "group_ratio": { "default": 1, "vip": 0.8 },
  "usable_group": { "default": "默认", "vip": "VIP" },
  "vendors": [
    { "id": 1, "name": "OpenAI", "icon": "openai" }
  ],
  "supported_endpoint": {
    "chat_completions": true,
    "completions": true,
    "embeddings": true
  },
  "auto_groups": ["auto"]
}
```

#### `/api/prices` - 定价列表 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": [
    {
      "model": "gpt-4",
      "type": "tokens",
      "channel_type": 1,
      "input": 30,
      "output": 60
    }
  ]
}
```

#### `/api/available_model` - 可用模型 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": {
    "gpt-4": {
      "groups": ["default", "vip"],
      "owned_by": "openai",
      "price": {
        "type": "tokens",
        "input": 30,
        "output": 60,
        "channel_type": 1
      }
    },
    "gpt-3.5-turbo": {
      "groups": ["default"],
      "owned_by": "openai",
      "price": {
        "type": "tokens",
        "input": 0.5,
        "output": 1.5,
        "channel_type": 1
      }
    }
  }
}
```

#### `/api/ownedby` - 模型厂商列表 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": [
    { "id": 1, "name": "OpenAI" },
    { "id": 14, "name": "Anthropic" },
    { "id": 25, "name": "Google Gemini" }
  ]
}
```

#### `/api/user_group_map` - 用户组倍率 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": {
    "default": 1.0,
    "vip": 0.8,
    "svip": 0.6
  }
}
```

---

### 7.3 用户接口响应

#### `/api/user/self` - 获取当前用户信息

**one-api 用户信息：**
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "user",
    "display_name": "显示名称",
    "email": "user@example.com",
    "role": 1,
    "status": 1,
    "quota": 1000000,
    "used_quota": 500,
    "request_count": 100,
    "group": "default",
    "aff_code": "XXXX",
    "inviter_id": 0,
    "github_id": "",
    "wechat_id": "",
    "lark_id": "",
    "oidc_id": ""
  }
}
```

**new-api 用户信息（含 permissions、sidebar_modules、stripe_customer）：**
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "user",
    "display_name": "显示名称",
    "email": "user@example.com",
    "role": 1,
    "status": 1,
    "quota": 1000000,
    "used_quota": 500,
    "request_count": 100,
    "group": "default",
    "aff_code": "XXXX",
    "aff_count": 5,
    "aff_quota": 10000,
    "aff_history_quota": 50000,
    "inviter_id": 0,
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "linux_do_id": "",
    "setting": "{}",
    "stripe_customer": "",
    "sidebar_modules": "{}",
    "permissions": {
      "sidebar_settings": true,
      "sidebar_modules": {}
    }
  }
}
```

**Veloera 用户信息（含 group、setting，无 permissions）：**
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "user",
    "display_name": "显示名称",
    "email": "user@example.com",
    "role": 1,
    "status": 1,
    "quota": 1000000,
    "used_quota": 500,
    "request_count": 100,
    "group": "default",
    "aff_code": "XXXX",
    "aff_count": 5,
    "aff_quota": 10000,
    "aff_history_quota": 50000,
    "inviter_id": 0,
    "github_id": "",
    "oidc_id": "",
    "wechat_id": "",
    "telegram_id": "",
    "linux_do_id": "",
    "setting": "{}"
  }
}
```

**one-hub/done-hub 用户信息（含 avatar_url、last_login_time）：**
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "user",
    "display_name": "显示名称",
    "avatar_url": "https://example.com/avatar.png",
    "email": "user@example.com",
    "role": 1,
    "status": 1,
    "quota": 1000000,
    "used_quota": 500,
    "request_count": 100,
    "group": "default",
    "aff_code": "XXXX",
    "aff_count": 5,
    "aff_quota": 10000,
    "aff_history_quota": 50000,
    "inviter_id": 0,
    "oidc_id": "",
    "github_id": "",
    "wechat_id": "",
    "telegram_id": 0,
    "lark_id": "",
    "last_login_time": 1699999999
  }
}
```

#### `/api/user/token` - 生成访问令牌
```json
{
  "success": true,
  "message": "",
  "data": "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
}
```

#### `/api/user/aff` - 获取邀请码
```json
{
  "success": true,
  "message": "",
  "data": "ABCD"
}
```

#### `/api/user/models` - 获取用户可用模型 (new-api/Veloera)
```json
{
  "success": true,
  "message": "",
  "data": ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "claude-3-opus"]
}
```

#### `/api/user/dashboard` - 用户仪表盘 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": [
    {
      "date": "2024-01-01",
      "model": "gpt-4",
      "request_count": 100,
      "quota": 50000,
      "prompt_tokens": 10000,
      "completion_tokens": 5000
    }
  ]
}
```

#### `/api/user/dashboard/rate` - 实时速率 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": {
    "rpm": 10,
    "maxRPM": 60,
    "usageRpmRate": 16.67,
    "tpm": 0,
    "maxTPM": 0,
    "usageTpmRate": 0
  }
}
```

#### `/api/user/check_in_status` - 签到状态 (Veloera)
```json
{
  "success": true,
  "message": "",
  "data": {
    "checked_in": false,
    "last_check_in": "2024-01-01",
    "continuous_days": 5,
    "reward": 1000
  }
}
```

#### `/api/user/check_in` - 每日签到 (Veloera)
```json
{
  "success": true,
  "message": "签到成功",
  "data": {
    "reward": 1000,
    "continuous_days": 6
  }
}
```

#### `/api/user/topup` - 兑换码充值
```json
{
  "success": true,
  "message": "",
  "data": 100000
}
```

---

### 7.4 令牌接口响应

#### `/api/token/` - 获取令牌列表
```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 5,
    "items": [
      {
        "id": 1,
        "user_id": 1,
        "name": "默认令牌",
        "key": "sk-xxxx...xxxx",
        "status": 1,
        "created_time": 1699999999,
        "accessed_time": 1699999999,
        "expired_time": -1,
        "remain_quota": 1000000,
        "unlimited_quota": false,
        "used_quota": 500,
        "model_limits_enabled": false,
        "model_limits": "",
        "allow_ips": "",
        "group": "default"
      }
    ]
  }
}
```

#### `/api/token/:id` - 获取指定令牌
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "user_id": 1,
    "name": "默认令牌",
    "key": "sk-xxxxxxxxxxxxxxxxxxxx",
    "status": 1,
    "created_time": 1699999999,
    "accessed_time": 1699999999,
    "expired_time": -1,
    "remain_quota": 1000000,
    "unlimited_quota": false,
    "used_quota": 500,
    "model_limits_enabled": false,
    "model_limits": "",
    "allow_ips": "",
    "group": "default"
  }
}
```

#### `/api/token/search` - 搜索令牌
```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 5,
    "items": [
      {
        "id": 1,
        "user_id": 1,
        "name": "默认令牌",
        "key": "sk-xxxx...xxxx",
        "status": 1,
        "created_time": 1699999999,
        "accessed_time": 1699999999,
        "expired_time": -1,
        "remain_quota": 1000000,
        "unlimited_quota": false,
        "used_quota": 500
      }
    ]
  }
}
```

#### `/api/token/playground` - 获取Playground令牌 (one-hub/done-hub)
```json
{
  "success": true,
  "message": "",
  "data": "sk-playground-xxxxxxxxxxxx"
}
```

---

### 7.5 日志接口响应

#### `/api/log/self` - 获取当前用户日志
```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 100,
    "items": [
      {
        "id": 1,
        "user_id": 1,
        "username": "user",
        "token_id": 1,
        "token_name": "默认令牌",
        "model_name": "gpt-4",
        "created_at": 1699999999,
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "quota": 1500,
        "channel_id": 1,
        "channel_name": "OpenAI官方",
        "type": 2,
        "content": ""
      }
    ]
  }
}
```

#### `/api/log/self/search` - 搜索用户日志
```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 50,
    "items": [
      {
        "id": 1,
        "user_id": 1,
        "username": "user",
        "token_id": 1,
        "token_name": "默认令牌",
        "model_name": "gpt-4",
        "created_at": 1699999999,
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "quota": 1500,
        "channel_id": 1,
        "channel_name": "OpenAI官方",
        "type": 2,
        "content": ""
      }
    ]
  }
}
```

#### `/api/log/self/stat` - 用户日志统计
```json
{
  "success": true,
  "message": "",
  "data": {
    "quota": 1000000,
    "token": 50000,
    "request_count": 1000
  }
}
```

#### `/api/log/self/export` - 导出用户日志 (done-hub)
返回 CSV 格式文件下载。

#### `/api/log/token` - 按令牌查询日志 (new-api, Veloera)
```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 30,
    "items": [
      {
        "id": 1,
        "user_id": 1,
        "username": "user",
        "token_id": 1,
        "token_name": "默认令牌",
        "model_name": "gpt-4",
        "created_at": 1699999999,
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "quota": 1500,
        "channel_id": 1,
        "channel_name": "OpenAI官方",
        "type": 2,
        "content": ""
      }
    ]
  }
}
```

---

## 8. 站点功能对比

| 功能特性 | one-api | new-api | Veloera | one-hub | done-hub | VoAPI |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **基础接口** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **系统初始化** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **2FA认证** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Passkey** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **WebAuthn** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **签到功能** | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **消息系统** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **模型映射** | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **用户组管理** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| **渠道标签** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **邀请码系统** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **发票系统** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **数据分析** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Midjourney** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Suno音乐** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Claude原生** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Gemini原生** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **RecraftAI** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Kling视频** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **LinuxDO登录** | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Stripe支付** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **规则引擎** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **多货币** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **日志分表** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 9. 关键接口差异总结

### 9.1 用户模型查询

| 项目 | 接口 |
| :--- | :--- |
| one-api | `/api/user/available_models` |
| new-api, Veloera | `/api/user/models` |
| one-hub, done-hub | `/api/available_model` (公开) |

**端点探测优先级**（代码实现）:
1. `/api/user/models` - New API, Veloera
2. `/api/user/available_models` - One API
3. `/api/available_model` - Done Hub, One Hub

### 9.2 定价信息

| 项目 | 接口 | 特点 |
| :--- | :--- | :--- |
| new-api, Veloera | `/api/pricing` | 基础价格 + 分组倍率 |
| one-hub, done-hub | `/api/available_model` | 最终价格(已计算倍率) |
| one-hub, done-hub | `/api/prices` | 管理员定价列表 |

**端点探测优先级**（代码实现）:
1. `/api/pricing` - New API, Veloera
2. `/api/available_model` - Done Hub, One Hub

### 9.3 用户分组信息

| 项目 | 接口 |
| :--- | :--- |
| new-api, Veloera | `/api/user/self/groups`, `/api/user/groups` |
| one-hub, done-hub | `/api/user_group_map` |

**端点探测优先级**（代码实现）:
1. `/api/user/self/groups` - New API, Veloera, Super-API
2. `/api/user/groups` - New API, Veloera (公开端点)
3. `/api/user_group_map` - One Hub, Done Hub
4. `/api/group` - One API (回退)

---

## 10. 响应字段差异详细对比

### 10.1 用户对象字段差异（对应 `/api/user/self` 接口）

| 字段 | one-api | new-api | Veloera | one-hub | done-hub | 说明 |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `id` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户ID |
| `username` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户名 |
| `display_name` | ✅ | ✅ | ✅ | ✅ | ✅ | 显示名称 |
| `email` | ✅ | ✅ | ✅ | ✅ | ✅ | 邮箱 |
| `role` | ✅ | ✅ | ✅ | ✅ | ✅ | 角色 |
| `status` | ✅ | ✅ | ✅ | ✅ | ✅ | 状态 |
| `quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 额度 |
| `used_quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 已用额度 |
| `request_count` | ✅ | ✅ | ✅ | ✅ | ✅ | 请求次数 |
| `group` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户组 |
| `avatar_url` | ❌ | ❌ | ❌ | ✅ | ✅ | 头像URL |
| `last_login_time` | ❌ | ❌ | ❌ | ✅ | ✅ | 最后登录时间 |
| `oidc_id` | ✅ | ✅ | ✅ | ✅ | ✅ | OIDC ID |
| `telegram_id` | ❌ | ✅ | ✅ | ✅ | ✅ | Telegram ID |
| `linux_do_id` | ❌ | ✅ | ✅ | ❌ | ✅ | LinuxDO ID |
| `lark_id` | ✅ | ❌ | ❌ | ✅ | ✅ | 飞书ID |
| `stripe_customer` | ❌ | ✅ | ❌ | ❌ | ❌ | Stripe客户ID |
| `setting` | ❌ | ✅ | ✅ | ❌ | ❌ | 用户设置JSON |
| `sidebar_modules` | ❌ | ✅ | ❌ | ❌ | ❌ | 侧边栏模块配置 |
| `permissions` | ❌ | ✅ | ❌ | ❌ | ❌ | 权限配置 |

### 10.2 令牌对象字段差异（对应 `/api/token/` 系列接口）

| 字段 | one-api | new-api | Veloera | one-hub | done-hub | 说明 |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `id` | ✅ | ✅ | ✅ | ✅ | ✅ | 令牌ID |
| `user_id` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户ID |
| `name` | ✅ | ✅ | ✅ | ✅ | ✅ | 令牌名称 |
| `key` | ✅ | ✅ | ✅ | ✅ | ✅ | 令牌密钥 |
| `status` | ✅ | ✅ | ✅ | ✅ | ✅ | 状态 |
| `created_time` | ✅ | ✅ | ✅ | ✅ | ✅ | 创建时间 |
| `accessed_time` | ✅ | ✅ | ✅ | ✅ | ✅ | 访问时间 |
| `expired_time` | ✅ | ✅ | ✅ | ✅ | ✅ | 过期时间 |
| `remain_quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 剩余额度 |
| `unlimited_quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 无限额度 |
| `used_quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 已用额度 |
| `model_limits_enabled` | ❌ | ✅ | ✅ | ❌ | ❌ | 模型限制启用 |
| `model_limits` | ❌ | ✅ | ✅ | ❌ | ❌ | 模型限制 |
| `setting` | ❌ | ❌ | ❌ | ✅ | ✅ | 令牌设置JSON |
| `models` | ✅ | ❌ | ❌ | ❌ | ❌ | 允许的模型 (one-api专用) |
| `group` | ❌ | ✅ | ✅ | ✅ | ✅ | 用户组 |
| `subnet/allow_ips` | ✅ | ✅ | ✅ | ❌ | ❌ | IP限制 (one-api用subnet, new-api/Veloera用allow_ips) |

### 10.3 日志对象字段差异（对应 `/api/log/self` 系列接口）

| 字段 | one-api | new-api | Veloera | one-hub | done-hub | 说明 |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `id` | ✅ | ✅ | ✅ | ✅ | ✅ | 日志ID |
| `user_id` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户ID |
| `username` | ✅ | ✅ | ✅ | ✅ | ✅ | 用户名 |
| `token_id` | ❌ | ✅ | ✅ | ❌ | ❌ | 令牌ID |
| `token_name` | ✅ | ✅ | ✅ | ✅ | ✅ | 令牌名称 |
| `model_name` | ✅ | ✅ | ✅ | ✅ | ✅ | 模型名称 |
| `created_at` | ✅ | ✅ | ✅ | ✅ | ✅ | 创建时间 |
| `prompt_tokens` | ✅ | ✅ | ✅ | ✅ | ✅ | 提示词Token |
| `completion_tokens` | ✅ | ✅ | ✅ | ✅ | ✅ | 补全Token |
| `quota` | ✅ | ✅ | ✅ | ✅ | ✅ | 消耗额度 |
| `channel_id` | ✅ | ✅ | ✅ | ✅ | ✅ | 渠道ID |
| `channel_name` | ❌ | ✅ | ✅ | ✅ | ✅ | 渠道名称 |
| `type` | ✅ | ✅ | ✅ | ✅ | ✅ | 日志类型 |
| `content` | ✅ | ✅ | ✅ | ✅ | ✅ | 内容 |
| `request_id` | ✅ | ❌ | ❌ | ❌ | ❌ | 请求ID |
| `is_stream` | ✅ | ✅ | ✅ | ✅ | ✅ | 是否流式 |
| `group` | ❌ | ✅ | ✅ | ❌ | ❌ | 用户组 |
| `ip/source_ip` | ❌ | ✅ | ✅ | ✅ | ✅ | 请求IP |

---

**声明：** 本文档由 API Hub Management Tools 项目组维护，基于各项目源代码分析整理。如有疏漏，欢迎反馈。
