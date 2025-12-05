# API 接口参考文档

> 本文档整理了 One API 系列项目（one-api、new-api、Veloera、one-hub、done-hub、VoAPI、Super-API）及相关管理插件（one-api-hub、all-api-hub）的完整接口信息。
>
> **最后更新时间**：2025-12-02
> **版本**：v2.1.0

---

## 1. 认证系统

### 1.1 认证方式

所有 API 项目支持两种主要认证方式：

1.  **Cookie 认证 (Session)**
    - 适用于 Web 管理界面。
    - 通过登录接口获取 Session Cookie。
    - Cookie 自动存储在浏览器中。

2.  **Token 认证 (Bearer Token)**
    - 适用于 API 调用。
    - 在用户面板生成 Access Token。
    - 请求头格式：`Authorization: Bearer <token>`

### 1.2 权限级别

系统定义了三个权限级别：

1.  **普通用户 (Common User)**
    - 权限值：1
    - 可管理自己的令牌、查看日志和额度、充值。

2.  **管理员 (Admin User)**
    - 权限值：10
    - 拥有普通用户权限，可管理所有用户、渠道和令牌，查看所有日志。

3.  **超级管理员 (Root User)**
    - 权限值：100
    - 拥有管理员权限，可修改系统设置、管理管理员权限。

### 1.3 Token 格式

-   **标准格式**：`sk-<随机字符串>`
-   **渠道绑定格式**：`sk-<token>-<channel_id>` （管理员专用）

---

## 2. 系统初始化接口

### 2.1 初始化状态检查
-   **接口**：`GET /api/setup`
-   **说明**：检查系统是否已完成初始化（仅 new-api 支持）。
-   **响应**：
    ```json
    {
      "success": true,
      "data": { "initialized": false, "username": "", "password": "" }
    }
    ```

### 2.2 系统初始化
-   **接口**：`POST /api/setup`
-   **说明**：首次安装时初始化系统，创建 root 用户（仅 new-api 支持）。
-   **请求**：`{ "username": "root", "password": "your_password" }`

---

## 3. 公共信息接口

### 3.1 获取系统状态
-   **接口**：`GET /api/status`
-   **说明**：获取系统基本信息和配置状态。
-   **权限**：公开。

### 3.2 获取公告信息
-   **接口**：`GET /api/notice`
-   **权限**：公开。

### 3.3 获取关于信息
-   **接口**：`GET /api/about`
-   **权限**：公开。

### 3.4 获取模型列表 (仪表盘)
-   **接口**：`GET /api/models`
-   **说明**：获取所有渠道类型支持的模型列表。
-   **权限**：普通用户。

### 3.5 获取用户组列表
-   **接口**：`GET /api/group`
-   **说明**：获取所有用户组名称。
-   **权限**：管理员。

### 3.6 获取定价信息
-   **接口**：`GET /api/pricing` (New API) 或 `GET /api/available_model` (Done Hub/One Hub)
-   **说明**：获取模型定价信息。
-   **权限**：公开或用户。

**New API 响应结构**:
```json
{
  "success": true,
  "data": [
    {
      "model_name": "gpt-4",
      "quota_type": 0,           // 0=按量, 1=按次
      "model_ratio": 15,         // 基础倍率
      "model_price": 0.03,       // 按次价格
      "completion_ratio": 1.5,   // 输出/输入比
      "enable_groups": ["default", "vip"]
    }
  ],
  "group_ratio": { "default": 1, "vip": 0.8 }
}
```

**Done Hub 响应结构**:
```json
{
  "success": true,
  "data": {
    "gpt-4": {
      "groups": ["vip"],
      "price": {
        "type": "tokens",      // "tokens"=按量, "times"=按次
        "input": 30,           // 已包含分组倍率
        "output": 30
      }
    }
  }
}
```

---

## 4. 令牌管理接口

### 4.1 获取令牌列表
-   **接口**：`GET /api/token`
-   **参数**：`p` (页码), `order` (排序)
-   **权限**：普通用户。

### 4.2 创建令牌
-   **接口**：`POST /api/token`
-   **权限**：普通用户。
-   **请求体**：
    ```json
    {
      "name": "新令牌",
      "expired_time": -1,
      "remain_quota": 1000000,
      "unlimited_quota": false,
      "models": "gpt-3.5-turbo,gpt-4",
      "subnet": ""
    }
    ```

### 4.3 更新令牌
-   **接口**：`PUT /api/token`
-   **参数**：`status_only` (仅更新状态)
-   **权限**：普通用户。

### 4.4 删除令牌
-   **接口**：`DELETE /api/token/:id`
-   **权限**：普通用户。

### 4.5 获取令牌状态 (OpenAI 兼容)
-   **接口**：`GET /v1/dashboard/billing/credit_grants`
-   **权限**：Token 认证。

---

## 5. 日志查询接口

### 5.1 获取所有日志
-   **接口**：`GET /api/log`
-   **权限**：管理员。

### 5.2 获取当前用户日志
-   **接口**：`GET /api/log/self`
-   **权限**：普通用户。

### 5.3 获取日志统计
-   **接口**：`GET /api/log/self/stat`
-   **说明**：获取当前用户的日志统计信息（消费额度、Token 数）。
-   **权限**：普通用户。

---

## 6. 充值与支付接口

### 6.1 获取充值记录
-   **接口**：`GET /api/user/topup/self`
-   **权限**：普通用户。

### 6.2 兑换码充值
-   **接口**：`POST /api/user/topup`
-   **请求**：`{ "key": "兑换码" }`

### 6.3 在线支付
-   **接口**：`POST /api/user/pay` (New API/Veloera)
-   **接口**：`POST /api/user/stripe/pay` (New API Stripe)

---

## 7. 个人信息接口

### 7.1 获取当前用户信息
-   **接口**：`GET /api/user/self`
-   **权限**：普通用户。
-   **响应**：
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "username": "user",
        "quota": 1000000,
        "used_quota": 500,
        "role": 1,
        "group": "default"
      }
    }
    ```

### 7.2 生成个人访问令牌
-   **接口**：`GET /api/user/token`
-   **说明**：生成一个永久有效的 Access Token。

### 7.3 获取用户分组
-   **接口**：`GET /api/user/self/groups` (New API/Veloera)
-   **响应**：包含分组名称和倍率信息。

---

## 8. OpenAI 兼容接口

所有项目均提供完全兼容 OpenAI API 格式的接口，通常位于 `/v1` 路径下。

-   **聊天补全**：`POST /v1/chat/completions`
-   **文本补全**：`POST /v1/completions`
-   **图像生成**：`POST /v1/images/generations`
-   **嵌入向量**：`POST /v1/embeddings`
-   **语音转文本**：`POST /v1/audio/transcriptions`
-   **文本转语音**：`POST /v1/audio/speech`

---

## 9. 站点架构差异对比

| 功能特性 | one-api | new-api | one-hub | done-hub | Veloera |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **基础接口** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **系统初始化** | ❌ | ✅ | ❌ | ❌ | ✅ |
| **在线充值** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **令牌分组** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Midjourney** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **签到功能** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **LinuxDO登录** | ❌ | ✅ | ❌ | ✅ | ✅ |
| **数据分析** | ❌ | ✅ | ✅ | ✅ | ✅ |

### 关键差异总结

1.  **用户模型查询**：
    -   one-api: `/api/user/available_models`
    -   new-api/Veloera: `/api/user/models`
    -   one-hub/done-hub: 使用渠道模型逻辑

2.  **定价信息**：
    -   New API: `/api/pricing` (基础价格 + 倍率)
    -   Done Hub: `/api/available_model` (最终价格)

3.  **用户组管理**：
    -   one-api/new-api: 仅 `/api/group`
    -   one-hub/done-hub: 完整的 `/api/user_group` CRUD

---

---

## 10. 内部 IPC 接口 (Electron)

### 10.1 WebDAV 云端备份接口

以下接口通过 Electron IPC 通信，供渲染进程调用：

| 通道名称 | 说明 | 参数 | 返回值 |
| :--- | :--- | :--- | :--- |
| `webdav:test-connection` | 测试 WebDAV 连接 | `config: WebDAVConfig` | `{ success, error? }` |
| `webdav:save-config` | 保存 WebDAV 配置 | `config: WebDAVConfig` | `{ success, error? }` |
| `webdav:get-config` | 获取 WebDAV 配置 | - | `{ success, data?: WebDAVConfig }` |
| `webdav:upload-backup` | 上传备份到云端 | - | `{ success, data?: filename }` |
| `webdav:list-backups` | 列出云端备份 | - | `{ success, data?: WebDAVBackupInfo[] }` |
| `webdav:delete-backup` | 删除云端备份 | `filename: string` | `{ success, error? }` |
| `webdav:restore-backup` | 从云端恢复备份 | `filename: string` | `{ success, error? }` |

**WebDAVConfig 结构**:
```typescript
interface WebDAVConfig {
  enabled: boolean;      // 是否启用
  serverUrl: string;     // 服务器地址
  username: string;      // 用户名
  password: string;      // 密码
  remotePath: string;    // 远程备份路径
  maxBackups: number;    // 最大备份数量
}
```

**WebDAVBackupInfo 结构**:
```typescript
interface WebDAVBackupInfo {
  filename: string;      // 文件名
  path: string;          // 完整路径
  lastModified: Date;    // 最后修改时间
  size: number;          // 文件大小 (字节)
}
```

---

### 10.2 软件更新接口

以下接口通过 Electron IPC 通信，供渲染进程调用：

| 通道名称 | 说明 | 参数 | 返回值 |
| :--- | :--- | :--- | :--- |
| `update:check` | 检查软件更新 | - | `UpdateCheckResult` |
| `update:get-current-version` | 获取当前版本 | - | `string` |
| `update:open-download` | 打开下载链接 | `url: string` | - |
| `update:get-settings` | 获取更新设置 | - | `UpdateSettings` |
| `update:save-settings` | 保存更新设置 | `settings: UpdateSettings` | - |

**UpdateCheckResult 结构**:
```typescript
interface UpdateCheckResult {
  hasUpdate: boolean;              // 是否有正式版更新
  hasPreReleaseUpdate: boolean;    // 是否有预发布版更新
  currentVersion: string;          // 当前版本
  latestVersion: string;           // 最新正式版本
  latestPreReleaseVersion?: string; // 最新预发布版本
  releaseInfo?: ReleaseInfo;       // 正式版详情
  preReleaseInfo?: ReleaseInfo;    // 预发布版详情
}
```

**ReleaseInfo 结构**:
```typescript
interface ReleaseInfo {
  version: string;       // 版本号
  releaseDate: string;   // 发布日期
  releaseNotes: string;  // 更新说明
  downloadUrl: string;   // 下载链接
  htmlUrl: string;       // GitHub Release 页面
  isPreRelease: boolean; // 是否为预发布版本
}
```

**UpdateSettings 结构**:
```typescript
interface UpdateSettings {
  autoCheckEnabled: boolean;   // 是否启用自动检查
  includePreRelease: boolean;  // 是否包含预发布版本
  lastCheckTime?: string;      // 上次检查时间
}
```

---

**声明：** 本文档由 API Hub Management Tools 项目组维护，旨在为开发者提供准确、全面的 API 参考。如有疏漏，欢迎反馈。