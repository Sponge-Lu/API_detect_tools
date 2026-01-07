/**
 * 输入: userId (用户 ID)
 * 输出: HTTP 请求头对象 (包含多个 User-ID 变体)
 * 定位: 工具层 - 生成兼容各种 API 站点的 HTTP 请求头
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 获取所有可能的User-ID请求头（兼容各种API站点）
 *
 * 注意：
 * - HTTP header 名称按规范大小写不敏感，但部分站点实现可能错误地按大小写区分。
 * - 在 Node/Electron/Fetch 中，同名不同大小写的 header 往往会被折叠/覆盖，导致发出去的实际 header 不可控。
 * 因此这里不要同时发送同名不同大小写的重复项，避免“覆盖后刚好变成站点不认的大小写”导致 401。
 */
export function getAllUserIdHeaders(userId: string | number): Record<string, string> {
  const id = String(userId);
  return {
    'New-API-User': id,
    'Veloera-User': id,
    // 历史兼容：部分站点使用该大小写（v2.1.9 行为）
    'User-id': id,
    // 其他已知兼容项
    'voapi-user': id,
    'X-User-Id': id,
  };
}
