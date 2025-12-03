/**
 * 骨架屏组件
 * 用于数据加载时显示占位内容
 */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`} />;
}

/**
 * 站点卡片骨架屏
 */
export function SiteCardSkeleton() {
  return (
    <div className="bg-white/80 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
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
