/**
 * 判断时间戳是否与参考时间（默认当前时刻）属于同一个本地日历日。
 *
 * 本地时区语义：判定使用运行环境的本地时区（与被替换掉的 `toDateString()` 行为一致），
 * 不做 UTC 折算，也不读站点服务器的时区。
 *
 * 跨时区迁移说明：用户带着缓存跨时区使用时，"今天"以当地日历日为准 ——
 * 在 A 时区刷新/签到产生的 last_refresh，到了 B 时区可能不再被视作"今天"，
 * 据此派生的"今日已签"本地启发式随之失效并重新走真实检测。这是有意行为，
 * 与站点服务器返回的 can_check_in 无关。
 *
 * @param timestamp 待判定的时间戳（epoch 毫秒）；undefined/非有限值一律视为"不是今天"
 * @param reference 参考时间戳（epoch 毫秒），缺省取当前时刻
 */
export function isSameLocalDay(timestamp?: number | null, reference: number = Date.now()): boolean {
  if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp)) {
    return false;
  }
  if (!Number.isFinite(reference)) {
    return false;
  }
  const a = new Date(timestamp);
  const b = new Date(reference);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
