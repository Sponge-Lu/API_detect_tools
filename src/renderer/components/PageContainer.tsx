/**
 * 输入: children, className
 * 输出: React 组件 (统一页面容器)
 * 定位: 展示层 - 全 App 页面级 padding/滚动容器
 *
 * 页面级留白基准：水平 20px、垂直 16px。新增页面请直接复用本组件，
 * 不要再在页面根节点手写 p-1.5 / p-3 / p-2.5 等散点值。
 */

export interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className = '' }: PageContainerProps) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto px-5 py-4 ${className}`.trim()}>{children}</div>
  );
}
