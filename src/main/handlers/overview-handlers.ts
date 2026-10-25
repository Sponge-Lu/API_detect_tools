import { handleStorageIpc } from '../storage/ipc-handler';

import * as overview from '../overview-service';

const ok = <T>(data?: T) => ({ success: true, data });
const err = (message: string) => ({ success: false, error: message });

export function registerOverviewHandlers() {
  handleStorageIpc('overview:get-site-daily-snapshots', async (_, params) => {
    try {
      return ok(overview.getSiteDailySnapshots(params));
    } catch (error: unknown) {
      return err(error instanceof Error ? error.message : '加载站点每日快照失败');
    }
  });
}
