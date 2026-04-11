/**
 * 输入: HeaderProps (保存状态、更新状态)
 * 输出: React 组件 (兼容层，内部复用 GlobalCommandBar)
 * 定位: 展示层 - 历史 Header 导出兼容包装
 */

import { GlobalCommandBar, type GlobalCommandBarProps } from '../AppShell/GlobalCommandBar';

export type HeaderProps = GlobalCommandBarProps;

export function Header(props: HeaderProps) {
  return <GlobalCommandBar {...props} />;
}
