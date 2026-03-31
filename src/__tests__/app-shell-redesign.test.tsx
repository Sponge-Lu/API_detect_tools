import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerticalSidebar } from '../renderer/components/Sidebar/VerticalSidebar';

describe('app shell redesign', () => {
  it('renders flattened top-level sidebar destinations without a route parent entry', () => {
    render(<VerticalSidebar activeTab="sites" onTabChange={vi.fn()} saving={false} />);

    expect(screen.getByRole('button', { name: '站点管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自定义CLI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型重定向' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI 可用性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '代理统计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由' })).not.toBeInTheDocument();
  });
});
