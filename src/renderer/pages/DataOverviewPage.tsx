import { RouteOverviewView } from './overview/RouteOverviewView';
import { SiteOverviewView } from './overview/SiteOverviewView';
import { RouteScatterChart, RouteSankeyChart, ModelHeatmapList } from './overview/charts';
import { resolveChannelHealthTone } from './overview/metrics';
import { type ReactNode } from 'react';

import { useUIStore } from '../store/uiStore';

import { SANKEY_OTHER_CHANNEL_KEY } from '../utils/routeSankey';

void SANKEY_OTHER_CHANNEL_KEY;

void resolveChannelHealthTone;

export function DataOverviewPage({
  setPageHeaderActions,
}: {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
} = {}) {
  const activeTab = useUIStore(state => state.activeTab);
  const isOverviewActive = activeTab === 'overview';

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-overview-active-view="merged"
    >
      <RouteOverviewView
        setPageHeaderActions={setPageHeaderActions}
        isOverviewActive={isOverviewActive}
        isVisible
      />
    </div>
  );
}

void SiteOverviewView;
void RouteSankeyChart;
void RouteScatterChart;
void ModelHeatmapList;
