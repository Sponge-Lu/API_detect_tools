/**
 * 输入: children, className
 * 输出: React 组件 (统一页面容器)
 * 定位: 展示层 - 全 App 页面级 padding/滚动容器，收敛 px-4/5/6、py-3/4 散点
 */

export interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className = '' }: PageContainerProps) {
  return <div className={`flex-1 overflow-y-auto px-6 py-4 ${className}`.trim()}>{children}</div>;
}
