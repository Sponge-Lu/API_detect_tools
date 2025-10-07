// {{ AURA-X: Add - Tauri Rust后端主程序. Source: context7-mcp on 'Tauri' }}
// {{ Confirmed via 寸止: 将Python API检测逻辑移植到Rust }}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Duration;
use tauri::Manager;

// {{ AURA-X: Modify - 添加has_checkin字段，由用户自定义是否有签到. Confirmed via 寸止 }}
// 配置结构
#[derive(Debug, Serialize, Deserialize, Clone)]
struct SiteConfig {
    name: String,
    url: String,
    api_key: String,
    #[serde(default)]
    system_token: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    has_checkin: bool,  // 用户自定义该站点是否支持签到
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
struct Settings {
    #[serde(default = "default_timeout")]
    timeout: u64,
    #[serde(default = "default_true")]
    concurrent: bool,
    #[serde(default)]
    show_disabled: bool,
    #[serde(default)]
    auto_refresh: bool,
    #[serde(default = "default_refresh_interval")]
    refresh_interval: u64, // 分钟
}

fn default_timeout() -> u64 {
    10
}

fn default_refresh_interval() -> u64 {
    30
}

#[derive(Debug, Serialize, Deserialize)]
struct Config {
    sites: Vec<SiteConfig>,
    #[serde(default)]
    settings: Settings,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            timeout: 10,
            concurrent: true,
            show_disabled: false,
            auto_refresh: false,
            refresh_interval: 30,
        }
    }
}

// {{ AURA-X: Add - 添加API类型枚举用于内部识别. Confirmed via 寸止 }}
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
enum ApiType {
    NewApi,      // New API (原ChatGPT-Next-Web-Pro)
    VeloeraApi,  // Veloera API
    OneApi,      // One API (songquanpeng/one-api)
    Unknown,     // 未知类型
}

// 检测结果结构
#[derive(Debug, Serialize, Deserialize, Clone)]
struct DetectionResult {
    name: String,
    url: String,
    status: String,
    models: Vec<String>,
    balance: Option<f64>,
    error: Option<String>,
    has_checkin: bool,
}

// {{ AURA-X: Delete - 删除签到结果结构体. Confirmed via 寸止 }}

// Tauri命令：加载配置
#[tauri::command]
async fn load_config(app: tauri::AppHandle) -> Result<Config, String> {
    // 使用应用程序数据目录
    let app_dir = app.path().app_data_dir()
        .map_err(|e| format!("无法获取应用目录: {}", e))?;
    
    // 确保目录存在
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("无法创建应用目录: {}", e))?;
    
    let config_path = app_dir.join("config.json");
    
    // 如果config.json不存在，创建默认配置
    if !config_path.exists() {
        let default_config = Config {
            sites: vec![
                SiteConfig {
                    name: "示例站点".to_string(),
                    url: "https://api.example.com".to_string(),
                    api_key: "sk-xxxxxxxxxxxxxxxxxxxxxxxx".to_string(),
                    system_token: Some("".to_string()),
                    user_id: Some("".to_string()),
                    enabled: false,
                    has_checkin: false,
                }
            ],
            settings: Settings::default(),
        };
        
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("序列化默认配置失败: {}", e))?;
        
        fs::write(&config_path, json)
            .map_err(|e| format!("无法创建config.json: {}", e))?;
    }
    
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("无法读取配置文件: {} - 路径: {:?}", e, config_path))?;
    
    let config: Config = serde_json::from_str(&content)
        .map_err(|e| format!("配置文件JSON格式错误: {}", e))?;
    
    Ok(config)
}

// Tauri命令：保存配置
#[tauri::command]
async fn save_config(config: Config, app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_data_dir()
        .map_err(|e| format!("无法获取应用目录: {}", e))?;
    
    let config_path = app_dir.join("config.json");
    
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    
    fs::write(&config_path, json)
        .map_err(|e| format!("保存配置文件失败: {}", e))?;
    
    Ok(())
}

// Tauri命令：检测单个站点
#[tauri::command]
async fn detect_site(site: SiteConfig, timeout: u64) -> Result<DetectionResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .danger_accept_invalid_certs(true)  // 接受自签名证书
        .build()
        .map_err(|e| e.to_string())?;
    
    // 检测模型列表
    let models_url = format!("{}/v1/models", site.url.trim_end_matches('/'));
    let mut headers = reqwest::header::HeaderMap::new();
    
    // 注意：查询模型列表始终使用API Key，不是System Token
    // System Token仅用于管理操作（如查询余额）
    let auth_token = site.api_key.trim();
    
    headers.insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {}", auth_token)
            .parse()
            .map_err(|e| format!("Invalid auth token: {}", e))?,
    );
    
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    
    // 添加标准浏览器请求头
    headers.insert(
        reqwest::header::USER_AGENT,
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".parse().unwrap(),
    );
    
    headers.insert(
        reqwest::header::ACCEPT,
        "application/json, text/plain, */*".parse().unwrap(),
    );
    
    // 如果提供了user_id，添加相关请求头
    if let Some(ref user_id) = site.user_id {
        if !user_id.is_empty() {
            let user_id_trimmed = user_id.trim();
            if let Ok(header_value) = user_id_trimmed.parse() {
                headers.insert("new-api-user", header_value);
            }
            if let Ok(header_value) = user_id_trimmed.parse() {
                headers.insert("Veloera-User", header_value);
            }
        }
    }
    
    // {{ AURA-X: Modify - 获取模型列表，增加重试逻辑提高稳定性. Confirmed via 寸止 }}
    let models = match detect_models_with_retry(&client, &models_url, &headers, 3).await {
        Ok(models) => models,
        Err(error_msg) => {
            return Ok(DetectionResult {
                name: site.name,
                url: site.url,
                status: "失败".to_string(),
                models: vec![],
                balance: None,
                error: Some(error_msg),
                has_checkin: false,
            });
        }
    };
    
    // {{ AURA-X: Modify - 改进余额检测策略：先尝试system token，失败后使用API key，增强安全性. Confirmed via 寸止 }}
    let balance = if let Some(ref system_token) = site.system_token {
        if let Some(ref user_id) = site.user_id {
            if !system_token.is_empty() && !user_id.is_empty() {
                // 先尝试使用system token查询余额
                let system_token_balance = detect_balance_with_system_token(&client, &site, system_token.trim(), user_id.trim()).await;
                
                // 如果system token失败，尝试使用API key
                if system_token_balance.is_none() {
                    detect_balance(&client, &site, &headers).await
                } else {
                    system_token_balance
                }
            } else {
                // 使用api key查询余额
                detect_balance(&client, &site, &headers).await
            }
        } else {
            // 使用api key查询余额
            detect_balance(&client, &site, &headers).await
        }
    } else {
        // 使用api key查询余额
        detect_balance(&client, &site, &headers).await
    };
    
    // {{ AURA-X: Modify - 直接从配置读取has_checkin，不再自动检测. Confirmed via 寸止 }}
    Ok(DetectionResult {
        name: site.name,
        url: site.url,
        status: "成功".to_string(),
        models,
        balance,
        error: None,
        has_checkin: site.has_checkin,  // 直接从配置读取
    })
}

// {{ AURA-X: Add - 带重试机制的模型列表获取函数. Confirmed via 寸止 }}
/// 获取模型列表，支持重试以处理临时网络问题和速率限制
async fn detect_models_with_retry(
    client: &reqwest::Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
    max_retries: u32,
) -> Result<Vec<String>, String> {
    for attempt in 0..max_retries {
        match client.get(url).headers(headers.clone()).send().await {
            Ok(response) => {
                let status = response.status();
                
                if status.is_success() {
                    // 成功获取响应
                    if let Ok(data) = response.json::<serde_json::Value>().await {
                        if let Some(models_array) = data["data"].as_array() {
                            let models: Vec<String> = models_array
                                .iter()
                                .filter_map(|m| m["id"].as_str().map(String::from))
                                .collect();
                            
                            if !models.is_empty() {
                                return Ok(models);
                            }
                        }
                    }
                    // 如果响应成功但没有模型数据，返回空列表
                    return Ok(vec![]);
                } else if status.as_u16() == 429 {
                    // 速率限制，等待后重试
                    if attempt < max_retries - 1 {
                        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                        continue;
                    }
                    return Err("请求速率限制(429)，请稍后再试".to_string());
                } else if status.as_u16() == 401 {
                    // 认证失败，不重试
                    let error_body = response.text().await.unwrap_or_default();
                    return Err(format!(
                        "认证失败(401) - 请检查API Key是否正确。详情: {}",
                        if error_body.len() > 100 { &error_body[..100] } else { &error_body }
                    ));
                } else {
                    // 其他HTTP错误
                    let error_body = response.text().await.unwrap_or_default();
                    return Err(format!("HTTP {} - {}", status, error_body));
                }
            }
            Err(e) => {
                // 网络错误，如果还有重试机会则重试
                if attempt < max_retries - 1 {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                    continue;
                }
                
                // 最后一次重试也失败，返回错误
                let error_msg = if e.is_timeout() {
                    "请求超时，请检查网络连接或增加超时时间".to_string()
                } else if e.is_connect() {
                    "无法连接到服务器，请检查URL是否正确".to_string()
                } else {
                    format!("请求失败: {}", e)
                };
                return Err(error_msg);
            }
        }
    }
    
    Err("达到最大重试次数".to_string())
}

// {{ AURA-X: Add - 统一的余额提取函数，处理多种API响应格式. Confirmed via 寸止 }}
/// 从API响应中提取余额信息，支持One API、New API和Veloera API的多种格式
fn extract_balance(data: &serde_json::Value) -> Option<f64> {
    // 检查是否为无限配额 - 使用 -1.0 作为特殊标记（前端会识别并显示为"无限"）
    if data["data"]["unlimited_quota"].as_bool() == Some(true) {
        return Some(-1.0);
    }
    
    // New API 格式：data.total_available
    if let Some(available) = data["data"]["total_available"].as_i64() {
        return Some(available as f64 / 500000.0);
    }
    if let Some(available) = data["data"]["total_available"].as_f64() {
        return Some(if available > 1000.0 { available / 500000.0 } else { available });
    }
    
    // One API 格式：data.user_info.quota
    if let Some(quota) = data["data"]["user_info"]["quota"].as_i64() {
        return Some(quota as f64 / 500000.0);
    }
    if let Some(quota) = data["data"]["user_info"]["quota"].as_f64() {
        return Some(quota / 500000.0);
    }
    
    // New API / Veloera 格式：data.quota
    if let Some(quota) = data["data"]["quota"].as_f64() {
        return Some(if quota > 1000.0 { quota / 500000.0 } else { quota });
    }
    if let Some(quota) = data["data"]["quota"].as_i64() {
        let quota_f64 = quota as f64;
        return Some(if quota_f64 > 1000.0 { quota_f64 / 500000.0 } else { quota_f64 });
    }
    
    // 直接的 balance 字段
    if let Some(balance) = data["data"]["balance"].as_f64() {
        return Some(balance);
    }
    if let Some(balance) = data["data"]["balance"].as_i64() {
        return Some(balance as f64);
    }
    
    // remain_quota 字段
    if let Some(remain) = data["data"]["remain_quota"].as_i64() {
        return Some(remain as f64 / 500000.0);
    }
    if let Some(remain) = data["data"]["remain_quota"].as_f64() {
        return Some(if remain > 1000.0 { remain / 500000.0 } else { remain });
    }
    
    // total_balance 字段
    if let Some(balance) = data["data"]["total_balance"].as_f64() {
        return Some(balance);
    }
    if let Some(balance) = data["data"]["total_balance"].as_i64() {
        return Some(balance as f64);
    }
    
    None
}

// {{ AURA-X: Modify - 改进API类型识别：移除URL判断，改为基于响应特征. Confirmed via 寸止 }}
#[allow(dead_code)]
async fn detect_api_type(
    client: &reqwest::Client,
    site: &SiteConfig,
    headers: &reqwest::header::HeaderMap,
) -> ApiType {
    // 尝试访问特征端点来判断API类型
    // 1. 尝试Veloera API特征端点
    let veloera_test_url = format!("{}/api/user/checkin", site.url.trim_end_matches('/'));
    if let Ok(response) = client.get(&veloera_test_url).headers(headers.clone()).send().await {
        // 405表示端点存在但方法不对（GET vs POST），说明可能是VeloeraAPI
        if response.status().as_u16() == 405 {
            return ApiType::VeloeraApi;
        }
    }
    
    // 2. 尝试通过用户信息端点判断
    let user_info_url = format!("{}/api/user/self", site.url.trim_end_matches('/'));
    if let Ok(response) = client.get(&user_info_url).headers(headers.clone()).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                // 检查响应结构特征
                if data["data"].is_object() {
                    // 检查是否包含Veloera特有的字段
                    if data["data"]["checkin_count"].is_number() 
                        || data["data"]["checkin_days"].is_number()
                        || data["data"]["invite_count"].is_number() {
                        return ApiType::VeloeraApi;
                    }
                    
                    // {{ AURA-X: Add - 检测OneAPI特征：标准响应格式和用户信息结构. Source: context7-mcp on 'OneAPI' }}
                    // 检查OneAPI特征：标准响应格式 {"message": "...", "success": true, "data": {...}}
                    if data["message"].is_string() && data["success"].is_boolean() {
                        // 检查用户信息结构特征
                        if data["data"]["user_info"].is_object() || data["data"]["id"].is_number() {
                            return ApiType::OneApi;
                        }
                    }
                }
            }
        }
    }
    
    // 3. 默认假设是NewAPI（因为它是最常见的）
    ApiType::NewApi
}

// {{ AURA-X: Modify - 简化System Token余额检测，使用统一的extract_balance函数. Confirmed via 寸止 }}
async fn detect_balance_with_system_token(
    client: &reqwest::Client,
    site: &SiteConfig,
    system_token: &str,
    user_id: &str,
) -> Option<f64> {
    let url = format!("{}/api/user/self", site.url.trim_end_matches('/'));
    let mut headers = reqwest::header::HeaderMap::new();
    
    // 使用system token认证
    if let Ok(auth) = format!("Bearer {}", system_token).parse() {
        headers.insert(reqwest::header::AUTHORIZATION, auth);
    }
    
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    
    headers.insert(
        reqwest::header::ACCEPT,
        "application/json".parse().unwrap(),
    );
    
    // 添加user_id请求头（兼容多种格式）
    if let Ok(user_header) = user_id.parse::<reqwest::header::HeaderValue>() {
        headers.insert("new-api-user", user_header.clone());
        headers.insert("Veloera-User", user_header);
    }
    
    // 先尝试 GET 请求
    if let Ok(response) = client.get(&url).headers(headers.clone()).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                if let Some(balance) = extract_balance(&data) {
                    return Some(balance);
                }
            }
        }
    }
    
    // 如果 GET 失败，尝试 POST（某些 API 要求 POST 方法）
    if let Ok(response) = client.post(&url).headers(headers).json(&serde_json::json!({})).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                if let Some(balance) = extract_balance(&data) {
                    return Some(balance);
                }
            }
        }
    }
    
    None
}

// {{ AURA-X: Modify - 简化API Key余额检测，使用统一的extract_balance函数和优先级端点. Confirmed via 寸止 }}
async fn detect_balance(
    client: &reqwest::Client,
    site: &SiteConfig,
    headers: &reqwest::header::HeaderMap,
) -> Option<f64> {
    // 按优先级顺序尝试端点
    let endpoints = vec![
        "/api/user/self",
        "/api/user/dashboard",
        "/api/usage/token",
        "/api/user/info",
    ];
    
    for endpoint in endpoints {
        let url = format!("{}{}", site.url.trim_end_matches('/'), endpoint);
        
        if let Ok(response) = client.get(&url).headers(headers.clone()).send().await {
            if response.status().is_success() {
                if let Ok(data) = response.json::<serde_json::Value>().await {
                    if let Some(balance) = extract_balance(&data) {
                        return Some(balance);
                    }
                }
            }
        }
    }
    
    None
}

// {{ AURA-X: Delete - 删除自动签到检测和执行功能，改为用户手动跳转. Confirmed via 寸止 }}

// Tauri命令：检测所有站点
#[tauri::command]
async fn detect_all_sites(config: Config) -> Result<Vec<DetectionResult>, String> {
    let timeout = config.settings.timeout;
    let mut results = Vec::new();
    
    // 过滤启用的站点
    let enabled_sites: Vec<_> = config
        .sites
        .into_iter()
        .filter(|s| s.enabled || config.settings.show_disabled)
        .collect();
    
    // {{ AURA-X: Modify - 增强错误处理，防止panic导致程序崩溃. Confirmed via 寸止 }}
    // 并发检测
    if config.settings.concurrent {
        let mut tasks = Vec::new();
        for site in enabled_sites {
            let timeout = timeout;
            let site_name = site.name.clone();
            tasks.push(tokio::spawn(async move {
                let result = detect_site(site, timeout).await;
                (site_name, result)
            }));
        }
        
        for task in tasks {
            match task.await {
                Ok((_site_name, Ok(result))) => {
                    results.push(result);
                }
                Ok((_site_name, Err(_e))) => {
                    // 静默忽略错误
                }
                Err(_e) => {
                    // 静默忽略panic
                }
            }
        }
    } else {
        // 串行检测
        for site in enabled_sites {
            if let Ok(result) = detect_site(site, timeout).await {
                results.push(result);
            }
        }
    }
    
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            detect_site,
            detect_all_sites,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}

