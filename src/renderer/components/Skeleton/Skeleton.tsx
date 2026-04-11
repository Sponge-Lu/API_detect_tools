/**
 * 输入: SkeletonProps (className 样式类)
 * 输出: React 组件 (骨架屏 UI)
 * 定位: 展示层 - 骨架屏组件，用于数据加载时显示占位内容
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Skeleton/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-[var(--surface-3)]/80 ${className}`} />;
}

/**
 * 站点卡片骨架屏
 */
export function SiteCardSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--surface-1)]/80 p-4">
      <div className="flex items-center gap-4">
        {/* 站点名称 */}
        <Skeleton className="h-5 w-32" />
        {/* 状态 */}
        <Skeleton className="h-5 w-16" />
        {/* 余额 */}
        <Skeleton className="h-5 w-20" />
        {/* 今日消费 */}
        <Skeleton className="h-5 w-16" />
        {/* Token 统计 */}
        <Skeleton className="h-5 w-24" />
        {/* 模型数 */}
        <Skeleton className="h-5 w-12" />
        {/* 更新时间 */}
        <Skeleton className="h-5 w-28" />
        {/* 操作按钮 */}
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * 站点列表骨架屏
 */
export function SiteListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SiteCardSkeleton key={i} />
      ))}
    </div>
  );
}
