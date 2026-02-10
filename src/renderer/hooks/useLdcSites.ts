import { useMemo } from 'react';
import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import type { LdcSiteInfo } from '../components/CreditPanel';

/**
 * 计算支持 LDC 支付的站点列表 (用于充值功能)
 * 从 App.tsx 提取的独立 hook
 */
export function useLdcSites(): LdcSiteInfo[] {
  const config = useConfigStore(s => s.config);
  const results = useDetectionStore(s => s.results);

  return useMemo((): LdcSiteInfo[] => {
    if (!config?.sites || !results) return [];

    const sites: LdcSiteInfo[] = [];

    config.sites.forEach(site => {
      const siteResult = results.find(r => r.name === site.name);

      // 只返回支持 LDC 支付的站点
      if (siteResult?.ldcPaymentSupported && siteResult?.ldcExchangeRate) {
        sites.push({
          name: site.name,
          url: site.url,
          exchangeRate: siteResult.ldcExchangeRate,
          // 直接从站点配置获取 system_token（即 access_token）
          token: (site as any).system_token,
          // 添加 userId 用于 User-ID headers
          userId: site.user_id,
          // 添加支付方式类型
          paymentType: siteResult.ldcPaymentType,
        });
      }
    });

    return sites;
  }, [config?.sites, results]);
}
