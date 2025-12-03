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
