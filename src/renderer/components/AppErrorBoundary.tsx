import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { AppButton } from './AppButton/AppButton';
import Logger from '../utils/logger';

interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Logger.error('[AppErrorBoundary] 渲染异常:', error, errorInfo.componentStack);
  }

  private handleReload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="relative flex h-screen items-center justify-center bg-[var(--app-bg)] px-6">
        <div className="relative z-10 max-w-md text-center">
          <TriangleAlert
            className="mx-auto mb-4 h-14 w-14 text-[var(--danger)]"
            aria-hidden="true"
          />
          <h1 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">页面遇到问题</h1>
          <p className="mb-5 text-sm leading-6 text-[var(--text-secondary)]">
            当前页面无法继续显示，请重新加载后再试。
          </p>
          <AppButton variant="primary" onClick={this.handleReload}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            重新加载
          </AppButton>
        </div>
      </div>
    );
  }
}
