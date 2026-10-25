import { useMemo, useState } from 'react';
import type {
  RouteModelDisplayItem,
  RouteModelSourceRef,
} from '../../../../shared/types/route-proxy';
import {
  buildRouteModelCandidates,
  getRouteModelKey,
  type RouteModelCandidate,
} from '../../../../shared/utils/routeModelGrouping';
import { AppButton } from '../../AppButton/AppButton';
import { AppModal } from '../../AppModal/AppModal';

interface ModelDiscoveryDialogProps {
  sources: RouteModelSourceRef[];
  displayItems: RouteModelDisplayItem[];
  onClose: () => void;
  onEnable: (candidate: RouteModelCandidate) => Promise<boolean>;
}

export function ModelDiscoveryDialog({
  sources,
  displayItems,
  onClose,
  onEnable,
}: ModelDiscoveryDialogProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const candidates = useMemo(() => buildRouteModelCandidates(sources), [sources]);
  const enabledKeys = new Set([
    ...savedKeys,
    ...displayItems.flatMap(item => [
      getRouteModelKey(item.canonicalName),
      ...(item.autoCollect?.modelKeys || []),
    ]),
  ]);
  const pending = candidates.filter(
    candidate => selected.includes(candidate.modelKey) && !enabledKeys.has(candidate.modelKey)
  );
  const search = query.trim().toLowerCase();
  const visible = candidates.filter(candidate =>
    [candidate.canonicalName, ...candidate.originalModels].some(model =>
      model.toLowerCase().includes(search)
    )
  );

  const enableSelected = async () => {
    setSaving(true);
    try {
      for (const candidate of pending) {
        if (!(await onEnable(candidate))) return;
        setSavedKeys(current => [...current, candidate.modelKey]);
        setSelected(current => current.filter(key => key !== candidate.modelKey));
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      isOpen
      onClose={() => {
        if (!saving) onClose();
      }}
      title="选择重定向模型"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <AppButton variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </AppButton>
          <AppButton onClick={enableSelected} disabled={pending.length === 0} loading={saving}>
            启用所选（{pending.length}）
          </AppButton>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">
          已按原始名称自动归组。只启用你需要的重定向，启用后持续收录同型号、同版本的模型来源。
        </p>
        <input
          type="search"
          aria-label="搜索重定向候选"
          placeholder="搜索重定向或原始模型"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm"
        />
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {visible.map(candidate => {
            const enabled = enabledKeys.has(candidate.modelKey);
            return (
              <label
                key={candidate.modelKey}
                className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] p-3"
              >
                <input
                  type="checkbox"
                  aria-label={`启用 ${candidate.canonicalName}`}
                  checked={enabled || selected.includes(candidate.modelKey)}
                  disabled={enabled || saving}
                  onChange={event => {
                    const checked = event.target.checked;
                    setSelected(current =>
                      checked
                        ? [...current, candidate.modelKey]
                        : current.filter(key => key !== candidate.modelKey)
                    );
                  }}
                  className="mt-1 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="break-all font-medium">{candidate.canonicalName}</span>
                    <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                      {enabled
                        ? '已添加'
                        : `${candidate.originalModels.length} 个原始模型 · ${candidate.siteCount} 个站点`}
                    </span>
                  </div>
                  <div className="mt-1 break-all text-xs text-[var(--text-secondary)]">
                    {candidate.originalModels.join('、')}
                  </div>
                </div>
              </label>
            );
          })}
          {visible.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              {candidates.length ? '没有匹配的模型' : '暂无模型来源，请先同步来源'}
            </p>
          )}
        </div>
      </div>
    </AppModal>
  );
}
