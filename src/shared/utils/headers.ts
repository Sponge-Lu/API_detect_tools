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
 */
export function getAllUserIdHeaders(userId: string | number): Record<string, string> {
  const id = String(userId);
  return {
    'New-API-User': id,
    'Veloera-User': id,
    'User-id': id,
    'voapi-user': id,
    'X-User-Id': id,
  };
}
