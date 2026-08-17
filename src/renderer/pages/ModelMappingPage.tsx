import type { ReactNode } from 'react';
import { ModelRedirectionTab } from '../components/Route/Redirection/ModelRedirectionTab';
import { useUIStore } from '../store/uiStore';

interface ModelMappingPageProps {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
}

export function ModelMappingPage({ setPageHeaderActions }: ModelMappingPageProps) {
  const isActive = useUIStore(state => state.activeTab === 'model-mapping');

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 py-3">
      <ModelRedirectionTab
        isActive={isActive}
        className="h-full min-h-0 min-w-0"
        setPageHeaderActions={setPageHeaderActions}
      />
    </div>
  );
}
