import { useState, useEffect } from 'react';

/**
 * 返回当前日期字符串，跨天时自动更新。
 * 用作 useMemo 依赖项，使日期敏感的计算在跨天时失效重算。
 */
export function useDateString(): string {
  const [dateStr, setDateStr] = useState(() => new Date().toDateString());

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date().toDateString();
      setDateStr(prev => (prev !== now ? now : prev));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return dateStr;
}
