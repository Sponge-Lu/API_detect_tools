/**
 * 输入: 两个 URL 字符串
 * 输出: 布尔值，表示是否为同一 API 端点
 * 定位: 工具层 - URL 匹配逻辑，用于检测站点是否已存在
 *
 * 匹配规则：协议 + 域名 + 端口 + 路径前缀
 */

/**
 * 判断两个 URL 是否指向同一 API 端点
 *
 * 匹配规则：
 * - 协议必须相同（http vs https）
 * - 域名必须相同
 * - 端口必须相同（默认端口也需匹配：http:80, https:443）
 * - 路径前缀匹配（忽略尾部斜杠）
 *
 * 示例：
 * - `http://example.com` 与 `https://example.com` → 不匹配（协议不同）
 * - `http://example.com:80` 与 `http://example.com` → 匹配（HTTP 默认端口）
 * - `http://example.com/v1` 与 `http://example.com/v1/` → 匹配（尾斜杠归一化）
 * - `http://example.com/api` 与 `http://example.com/api/v1` → 匹配（路径前缀）
 * - `http://example.com/v1` 与 `http://example.com/v2` → 不匹配（路径不同）
 */
export function isSameApiEndpoint(url1: string, url2: string): boolean {
  try {
    const parsed1 = new URL(url1);
    const parsed2 = new URL(url2);

    // 1. 协议必须相同
    if (parsed1.protocol !== parsed2.protocol) {
      return false;
    }

    // 2. 域名必须相同
    if (parsed1.hostname !== parsed2.hostname) {
      return false;
    }

    // 3. 端口必须相同（处理默认端口）
    const port1 = parsed1.port || (parsed1.protocol === 'https:' ? '443' : '80');
    const port2 = parsed2.port || (parsed2.protocol === 'https:' ? '443' : '80');
    if (port1 !== port2) {
      return false;
    }

    // 4. 路径前缀匹配（归一化尾斜杠）
    const path1 = parsed1.pathname.replace(/\/$/, '');
    const path2 = parsed2.pathname.replace(/\/$/, '');

    // 检查路径前缀：url2 的路径以 url1 的路径开头
    return path2.startsWith(path1) || path1.startsWith(path2);
  } catch {
    // URL 解析失败，视为不匹配
    return false;
  }
}
