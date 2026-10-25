export {
  type RoutePathSuspensionLabel,
  type PriorityModelEntry,
  type PriorityRowStatus,
  formatRoutePathDisabledReasonLabel,
  formatRemainingDuration,
  buildPriorityModelEntries,
  derivePriorityRowStatus,
  type PrioritySessionDot,
  buildSessionChannelKey,
  buildPrioritySessionDots,
  buildDisplayItemViews,
  buildRecommendedCliModelOptions,
  shouldRefreshRegistrySourceDetails,
} from './model-redirection-view';
import {
  formatBalanceDisplay,
  formatPriorityApiKeyDetails,
  buildPriorityModelEntries,
  derivePriorityRowStatus,
  groupSuspensionLabelsByModel,
  buildSessionChannelKey,
  getActiveRoutePathSuspensionLabels,
  isPrioritySiteDisabled,
  isPriorityApiKeyDisabled,
  getEnabledPriorityApiKeys,
  canSortPrioritySite,
  getEffectivePriorityDisplayValue,
  getRegistrySourcePool,
  isRouteRuntimeRuleDraftDirty,
} from './model-redirection-view';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';

import { AppButton } from '../../AppButton/AppButton';
import { AppModal } from '../../AppModal/AppModal';
import { ModelDiscoveryDialog } from './ModelDiscoveryDialog';
import { getRouteModelKey } from '../../../../shared/utils/routeModelGrouping';
import { CreateApiKeyDialog } from '../../CreateApiKeyDialog/CreateApiKeyDialog';
import { DEFAULT_ROUTE_RUNTIME_CONFIG } from '../../../../shared/types/route-proxy';

import {
  PRIORITY_DETAIL_GRID_CLASS,
  PriorityModelList,
  PRIORITY_API_KEY_CHIP_CLASS,
  PrioritySessionDots,
  PriorityRowStatusBadge,
  ModelRedirectionTabProps,
} from './ModelRedirectionParts';
import { useModelRedirectionController } from './useModelRedirectionController';
export function ModelRedirectionTab({
  isActive = true,
  className = '',
  setPageHeaderActions,
}: ModelRedirectionTabProps = {}) {
  const {
    displayItems,
    pageHeaderActions,
    selectedDisplayItem,
    setSelectedDisplayItemId,
    openEditEditor,
    setDeleteConfirm,
    selectedPriorityHitResetParams,
    selectedPriorityHitPath,
    handleResetPriorityHitPath,
    saving,
    isResettingSelectedRoutePaths,
    handleResetRoutePaths,
    selectedActiveSuspensionCount,
    openRouteRules,
    moveSelectedPrioritySite,
    selectedPrioritySiteIndex,
    sortableDetailSiteGroups,
    isPriorityDirty,
    handleSaveDetails,
    siteOnlySourceNotices,
    sortedDetailSiteGroups,
    sessionDots,
    selectedSessionInstanceId,
    setSelectedSessionInstanceId,
    priorityDetailRows,
    foldedPrioritySitesExpanded,
    toggleFoldedPrioritySites,
    foldedPrioritySiteSummary,
    foldedDetailSiteGroups,
    priorityDraft,
    selectedPrioritySiteId,
    expandedMissingKeySiteIds,
    setSelectedPrioritySiteId,
    togglePrioritySiteDisabled,
    config,
    priorityHitApiKeyKey,
    movePriorityApiKey,
    now,
    selectedMinSuccessRate,
    togglePriorityApiKeyDisabled,
    toggleMissingKeyHints,
    openCreateApiKeyDialog,
    creatingApiKey,
    discoveryOpen,
    registry,
    setDiscoveryOpen,
    enableDiscoveredModel,
    editorContext,
    closeEditor,
    handleSave,
    redirectNameInputId,
    draft,
    setDraft,
    setErrors,
    errors,
    searchInputId,
    candidateQuery,
    setCandidateQuery,
    stopNestedScrollPropagation,
    toggleOriginalModel,
    filteredCandidates,
    routeRuleState,
    closeRouteRules,
    handleResetRouteRuleDraft,
    handleSaveRouteRules,
    routeRuleDraft,
    setRouteRuleDraft,
    setRouteRuleErrors,
    routeRuleErrors,
    createApiKeyState,
    newApiKeyForm,
    setNewApiKeyForm,
    handleCreateApiKeySubmit,
    closeCreateApiKeyDialog,
    deleteConfirm,
    confirmDelete,
  } = useModelRedirectionController({ isActive, className, setPageHeaderActions });
  if (!config) {
    return null;
  }
  return (
    <>
      <div
        data-testid="redirect-workspace"
        className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-muted)] bg-[var(--surface-1)] ${className}`.trim()}
      >
        <div
          data-testid="redirect-two-pane-layout"
          className="grid h-full min-h-0 grid-cols-[minmax(210px,245px)_minmax(0,1fr)]"
        >
          <div
            data-testid="redirect-list-pane"
            className="flex min-h-0 flex-col border-r border-[var(--line-muted)]"
          >
            <div
              data-testid="redirect-list-toolbar"
              className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[var(--line-muted)] px-2.5"
            >
              <div className="flex min-w-0 items-baseline gap-1.5">
                <div className="text-xs font-semibold text-[var(--text-primary)]">重定向模型</div>
                <div className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                  {displayItems.length} 项
                </div>
              </div>
              {/* 页面嵌入时动作按钮经 setPageHeaderActions 上报页面头部；独立渲染时回退到工具栏 */}
              {setPageHeaderActions ? null : (
                <div className="ml-auto flex items-center gap-1.5">{pageHeaderActions}</div>
              )}
            </div>

            {displayItems.length > 0 ? (
              <div
                data-testid="redirect-card-list"
                className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {displayItems.map(displayItem => {
                  const isSelected = selectedDisplayItem?.item.id === displayItem.item.id;

                  return (
                    <button
                      key={displayItem.item.id}
                      type="button"
                      data-testid="redirect-list-row"
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => setSelectedDisplayItemId(displayItem.item.id)}
                      className={`block w-full border-b border-[var(--line-muted)] border-l-2 px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-l-[var(--accent)] bg-[var(--accent-soft-strong)] shadow-[inset_4px_0_0_var(--accent)]'
                          : 'border-l-transparent hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
                        <code className="min-w-0 truncate font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                          {displayItem.displayName}
                        </code>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`编辑 ${displayItem.displayName}`}
                          title="编辑模型重定向"
                          data-testid="redirect-edit-button"
                          className="ml-auto shrink-0 rounded px-1 py-0.5 text-[11px] font-medium leading-none text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                          onClick={event => {
                            event.stopPropagation();
                            openEditEditor(displayItem.item, displayItem.entry);
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              openEditEditor(displayItem.item, displayItem.entry);
                            }
                          }}
                        >
                          编辑
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`删除 ${displayItem.displayName}`}
                          title="删除重定向模型"
                          data-testid="redirect-delete-icon"
                          className="shrink-0 rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--danger)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                          onClick={event => {
                            event.stopPropagation();
                            setDeleteConfirm({
                              displayItemId: displayItem.item.id,
                              displayName: displayItem.displayName,
                            });
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              setDeleteConfirm({
                                displayItemId: displayItem.item.id,
                                displayName: displayItem.displayName,
                              });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
                <div className="text-sm font-medium text-[var(--text-primary)]">暂无模型重定向</div>
                <p className="max-w-sm text-xs text-[var(--text-secondary)]">
                  先同步来源拉取当前站点模型；其他重定向请手动新增。
                </p>
              </div>
            )}
          </div>

          <div
            data-testid="redirect-detail-pane"
            className="flex min-h-0 flex-col overflow-hidden bg-[var(--surface-1)]"
          >
            {selectedDisplayItem ? (
              <div className="flex h-full min-h-0 flex-col">
                <div
                  data-testid="redirect-detail-actions"
                  className="flex h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--line-muted)] px-2.5"
                >
                  <div className="mr-1 shrink-0 text-xs font-semibold text-[var(--text-primary)]">
                    优先级排序
                  </div>
                  <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                    {selectedPriorityHitResetParams ? (
                      <AppButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                        onClick={() => {
                          if (!selectedPriorityHitPath) {
                            return;
                          }

                          void handleResetPriorityHitPath(
                            selectedDisplayItem.item,
                            selectedDisplayItem.displayName,
                            selectedPriorityHitPath
                          );
                        }}
                        disabled={saving || isResettingSelectedRoutePaths}
                        aria-label={`重置 ${selectedDisplayItem.displayName} 当前优先命中路径`}
                        title="重置当前优先命中路径"
                      >
                        {isResettingSelectedRoutePaths ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        <span>重置命中</span>
                      </AppButton>
                    ) : null}
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() =>
                        void handleResetRoutePaths(
                          selectedDisplayItem.item,
                          selectedDisplayItem.displayName
                        )
                      }
                      disabled={
                        saving ||
                        isResettingSelectedRoutePaths ||
                        selectedActiveSuspensionCount === 0
                      }
                      aria-label={`恢复 ${selectedDisplayItem.displayName} 路由路径`}
                      title={
                        selectedActiveSuspensionCount > 0
                          ? `恢复 ${selectedActiveSuspensionCount} 条暂停路径`
                          : '没有暂停路径'
                      }
                    >
                      {isResettingSelectedRoutePaths ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      <span>恢复</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() =>
                        openRouteRules(selectedDisplayItem.item, selectedDisplayItem.displayName)
                      }
                      disabled={saving || isResettingSelectedRoutePaths}
                    >
                      <SlidersHorizontal className="h-3 w-3" />
                      <span>规则</span>
                    </AppButton>
                    <span className="mx-0.5 h-4 w-px bg-[var(--line-soft)]" />
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() => moveSelectedPrioritySite('first')}
                      disabled={selectedPrioritySiteIndex <= 0}
                    >
                      <ChevronsUp className="h-3 w-3" />
                      <span>置顶</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() => moveSelectedPrioritySite('up')}
                      disabled={selectedPrioritySiteIndex <= 0}
                    >
                      <ChevronUp className="h-3 w-3" />
                      <span>上移</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() => moveSelectedPrioritySite('down')}
                      disabled={
                        selectedPrioritySiteIndex < 0 ||
                        selectedPrioritySiteIndex >= sortableDetailSiteGroups.length - 1
                      }
                    >
                      <ChevronDown className="h-3 w-3" />
                      <span>下移</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      onClick={() => moveSelectedPrioritySite('last')}
                      disabled={
                        selectedPrioritySiteIndex < 0 ||
                        selectedPrioritySiteIndex >= sortableDetailSiteGroups.length - 1
                      }
                    >
                      <ChevronsDown className="h-3 w-3" />
                      <span>置底</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant={isPriorityDirty ? 'danger' : 'primary'}
                      className="!h-6 !min-h-6 !px-1.5 text-[11px]"
                      data-testid="priority-save-button"
                      data-priority-dirty={isPriorityDirty ? 'true' : 'false'}
                      onClick={handleSaveDetails}
                      loading={saving}
                    >
                      保存
                    </AppButton>
                  </div>
                </div>

                <div
                  data-testid="redirect-detail-priority"
                  className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2.5 py-2"
                >
                  {siteOnlySourceNotices.length > 0 ? (
                    <div
                      data-testid="priority-detail-site-only-warning"
                      className="mb-2 flex gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning-soft)_20%,transparent)] px-2.5 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
                      <div className="min-w-0 space-y-1">
                        <div className="font-semibold text-[var(--warning)]">
                          部分站点需要重新添加后才能参与本地路由
                        </div>
                        <div>
                          这些来源只有站点级模型缓存，没有可用账户或 API
                          Key。请重新添加或刷新站点账户后，再同步模型重定向。
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {siteOnlySourceNotices.map(notice => (
                            <span
                              key={notice.key}
                              className="max-w-full truncate rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--warning)_20%,transparent)] bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                            >
                              {notice.siteName}（{notice.originalModels.join('、')}）
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {sortedDetailSiteGroups.length > 0 ? (
                    <div className="overflow-hidden" data-testid="priority-detail-compact-list">
                      {sessionDots.length > 0 ? (
                        <div
                          className="flex flex-wrap items-center gap-2 border-b border-[var(--line-muted)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                          data-testid="priority-session-legend"
                        >
                          <button
                            type="button"
                            className={`rounded-full border px-1.5 py-0.5 font-semibold transition-colors ${
                              selectedSessionInstanceId === null
                                ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                : 'border-[var(--line-soft)] bg-[var(--surface-1)]'
                            }`}
                            aria-pressed={selectedSessionInstanceId === null}
                            onClick={() => setSelectedSessionInstanceId(null)}
                            data-testid="priority-session-filter-all"
                          >
                            全部
                          </button>
                          {sessionDots.map(dot => (
                            <button
                              key={dot.instanceId}
                              type="button"
                              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors ${
                                selectedSessionInstanceId === dot.instanceId
                                  ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                  : 'border-[var(--line-soft)] bg-[var(--surface-1)]'
                              }`}
                              aria-pressed={selectedSessionInstanceId === dot.instanceId}
                              onClick={() =>
                                setSelectedSessionInstanceId(current =>
                                  current === dot.instanceId ? null : dot.instanceId
                                )
                              }
                              data-testid="priority-session-filter-item"
                              data-session-instance={dot.instanceId}
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: dot.color }}
                              />
                              <span className="max-w-24 truncate">{dot.displayName}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div
                        className={`grid ${PRIORITY_DETAIL_GRID_CLASS} gap-2 border-y border-[var(--line-muted)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]`}
                      >
                        <span>来源</span>
                        <span className="text-right">优先级</span>
                        <span aria-hidden="true" />
                      </div>
                      <div>
                        {priorityDetailRows.map(row => {
                          if (row.kind === 'folded-sites') {
                            return (
                              <section
                                key="folded-sites-divider"
                                className="border-t border-[var(--line-muted)] bg-[var(--surface-2)] text-xs text-[var(--text-secondary)]"
                                data-testid="priority-detail-folded-sites"
                              >
                                <button
                                  type="button"
                                  className={`grid w-full ${PRIORITY_DETAIL_GRID_CLASS} items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--surface-1)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]`}
                                  aria-expanded={foldedPrioritySitesExpanded}
                                  aria-label={`${foldedPrioritySitesExpanded ? '收起' : '展开'}折叠站点`}
                                  onClick={toggleFoldedPrioritySites}
                                  data-testid="priority-detail-folded-sites-toggle"
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="h-5 w-px shrink-0 bg-[var(--line-soft)]" />
                                    <span className="shrink-0 rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                                      折叠站点
                                    </span>
                                    <span className="min-w-0 truncate">
                                      {foldedPrioritySiteSummary ||
                                        `${foldedDetailSiteGroups.length} 个站点不可参与优先级`}
                                    </span>
                                  </div>
                                  <span className="flex items-center justify-end gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
                                    <ChevronDown
                                      className={`h-3.5 w-3.5 transition-transform ${
                                        foldedPrioritySitesExpanded ? '' : '-rotate-90'
                                      }`}
                                      aria-hidden="true"
                                    />
                                    {foldedPrioritySitesExpanded ? '收起' : '展开'}
                                  </span>
                                  <span aria-hidden="true" />
                                </button>
                              </section>
                            );
                          }

                          const { siteGroup } = row;
                          const siteDisabled = isPrioritySiteDisabled(siteGroup, priorityDraft);
                          const siteSortable = canSortPrioritySite(siteGroup, priorityDraft);
                          const enabledApiKeys = siteDisabled
                            ? []
                            : getEnabledPriorityApiKeys(siteGroup, priorityDraft);
                          const disabledApiKeys = siteDisabled
                            ? siteGroup.apiKeys
                            : siteGroup.apiKeys.filter(apiKey =>
                                isPriorityApiKeyDisabled(apiKey, priorityDraft)
                              );
                          const foldedRowCount =
                            siteGroup.missingGroupHints.length + disabledApiKeys.length;
                          const sitePriority = siteSortable
                            ? getEffectivePriorityDisplayValue(
                                siteGroup.siteId,
                                priorityDraft.sitePriorities,
                                sortableDetailSiteGroups.map(group => group.siteId)
                              )
                            : null;
                          const isSelected =
                            siteSortable && selectedPrioritySiteId === siteGroup.siteId;
                          const missingHintsExpanded = Boolean(
                            expandedMissingKeySiteIds[siteGroup.siteId]
                          );
                          const foldedSummary = [
                            disabledApiKeys.length > 0
                              ? siteDisabled
                                ? `${disabledApiKeys.length} 个 API key 随站点禁用`
                                : `${disabledApiKeys.length} 个 API key 已禁用`
                              : null,
                            siteGroup.missingGroupHints.length > 0
                              ? `${siteGroup.missingGroupHints.length} 个用户组未创建可用 API key`
                              : null,
                          ]
                            .filter(Boolean)
                            .join('，');

                          return (
                            <section
                              key={siteGroup.key}
                              className="border-t border-[var(--line-muted)] first:border-t-0"
                              data-testid="priority-detail-site-group"
                            >
                              <div
                                className={`grid ${PRIORITY_DETAIL_GRID_CLASS} items-center gap-2 border-l-4 px-2.5 py-1.5 transition-colors ${
                                  isSelected
                                    ? 'border-l-[var(--accent)] bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]'
                                    : siteSortable
                                      ? 'cursor-pointer border-l-[var(--accent)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] hover:bg-[var(--surface-2)]'
                                      : 'cursor-default border-l-[var(--warning)] bg-[color-mix(in_srgb,var(--warning-soft)_15%,transparent)]'
                                }`}
                                data-priority-disabled={siteDisabled ? 'true' : undefined}
                                data-priority-folded={!siteSortable ? 'true' : undefined}
                                onClick={() => {
                                  if (siteSortable) {
                                    setSelectedPrioritySiteId(siteGroup.siteId);
                                  }
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="radio"
                                    name="priority-site-selection"
                                    className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                                    style={{ accentColor: 'var(--accent)' }}
                                    aria-label={`选择 ${siteGroup.siteName}`}
                                    checked={isSelected}
                                    disabled={!siteSortable}
                                    onClick={event => event.stopPropagation()}
                                    onChange={() => {
                                      if (siteSortable) {
                                        setSelectedPrioritySiteId(siteGroup.siteId);
                                      }
                                    }}
                                  />
                                  <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                                    {siteGroup.sourceType === 'customCli' ? '直连' : '站点'}
                                  </span>
                                  <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] font-semibold leading-5 text-[var(--text-primary)]">
                                    <span
                                      className="min-w-0 max-w-full whitespace-normal break-words"
                                      title={siteGroup.siteName}
                                    >
                                      {siteGroup.siteName}
                                    </span>
                                    {formatBalanceDisplay(siteGroup.siteBalance) ? (
                                      <span className="shrink-0">
                                        （{formatBalanceDisplay(siteGroup.siteBalance)}）
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                                <div className="flex items-center justify-end">
                                  <span
                                    className="min-w-7 rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-center text-xs font-semibold text-[var(--text-primary)]"
                                    data-testid="priority-detail-site-priority"
                                    aria-label={
                                      sitePriority === null
                                        ? `${siteGroup.siteName} 无优先级`
                                        : `${siteGroup.siteName} 优先级 ${sitePriority}`
                                    }
                                  >
                                    {sitePriority ?? '--'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className={`inline-flex h-6 min-w-10 items-center justify-center justify-self-end rounded-[var(--radius-md)] border px-2 text-[11px] font-semibold leading-none transition-colors ${
                                    siteDisabled
                                      ? 'border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] text-[var(--success)] hover:border-[var(--success)]'
                                      : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)]'
                                  }`}
                                  aria-label={`${siteGroup.siteName} ${siteDisabled ? '启用' : '禁用'}`}
                                  title={siteDisabled ? '启用站点' : '禁用站点'}
                                  onClick={event => {
                                    event.stopPropagation();
                                    togglePrioritySiteDisabled(siteGroup.siteId);
                                  }}
                                  data-testid="priority-detail-site-disable-toggle"
                                >
                                  {siteDisabled ? '启用' : '禁用'}
                                </button>
                              </div>

                              {enabledApiKeys.map((apiKey, apiKeyIndex) => {
                                const apiKeySuspensions = getActiveRoutePathSuspensionLabels({
                                  states: config.routePathStates,
                                  item: selectedDisplayItem.item,
                                  siteId: siteGroup.siteId,
                                  accountId: apiKey.accountId,
                                  apiKeyId: apiKey.apiKeyId,
                                  originalModels: apiKey.supportedOriginalModels,
                                  now,
                                });
                                const apiKeySuspensionLabels =
                                  groupSuspensionLabelsByModel(apiKeySuspensions);
                                const modelEntries = buildPriorityModelEntries(
                                  apiKey.supportedOriginalModels,
                                  apiKey.modelPriceLabels,
                                  apiKeySuspensionLabels
                                );
                                const isPriorityHit = priorityHitApiKeyKey === apiKey.key;
                                const rowSessionDots = sessionDots.filter(
                                  dot =>
                                    dot.channelKey ===
                                    buildSessionChannelKey({
                                      siteId: siteGroup.siteId,
                                      accountId: apiKey.accountId,
                                      apiKeyId: apiKey.apiKeyId,
                                    })
                                );
                                const rowStatus = derivePriorityRowStatus(
                                  modelEntries,
                                  apiKeySuspensions
                                );
                                const suspensionTitle = apiKeySuspensions
                                  .map(suspension => suspension.title)
                                  .join(' / ');

                                return (
                                  <div
                                    key={apiKey.key}
                                    className="border-t border-l-4 border-t-[var(--line-muted)] border-l-transparent bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors"
                                    data-testid="priority-detail-api-key-row"
                                    data-priority-hit={isPriorityHit ? 'true' : undefined}
                                    data-priority-status={rowStatus?.kind}
                                    aria-current={isPriorityHit ? 'true' : undefined}
                                  >
                                    <div
                                      className={`grid ${PRIORITY_DETAIL_GRID_CLASS} items-start gap-2`}
                                    >
                                      <div className="min-w-0">
                                        <div className="flex min-w-0 items-start gap-1">
                                          <span className="h-5 w-px shrink-0 bg-[var(--line-soft)]" />
                                          <div className="flex shrink-0 flex-col items-center gap-px">
                                            <button
                                              type="button"
                                              className="rounded-[var(--radius-sm)] p-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                              aria-label={`${apiKey.apiKeyName} 上移`}
                                              title="上移"
                                              disabled={apiKeyIndex === 0}
                                              onClick={() =>
                                                movePriorityApiKey(
                                                  siteGroup.siteId,
                                                  apiKey.key,
                                                  'up'
                                                )
                                              }
                                            >
                                              <ChevronUp className="h-2.5 w-2.5" />
                                            </button>
                                            <button
                                              type="button"
                                              className="rounded-[var(--radius-sm)] p-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                              aria-label={`${apiKey.apiKeyName} 下移`}
                                              title="下移"
                                              disabled={apiKeyIndex === enabledApiKeys.length - 1}
                                              onClick={() =>
                                                movePriorityApiKey(
                                                  siteGroup.siteId,
                                                  apiKey.key,
                                                  'down'
                                                )
                                              }
                                            >
                                              <ChevronDown className="h-2.5 w-2.5" />
                                            </button>
                                          </div>
                                          <span
                                            className={`shrink-0 rounded border px-1 py-px text-[11px] font-semibold leading-3 ${PRIORITY_API_KEY_CHIP_CLASS[rowStatus?.kind ?? 'idle']}`}
                                            data-priority-chip={rowStatus?.kind ?? 'idle'}
                                          >
                                            API Key
                                          </span>
                                          <div className="flex min-w-0 flex-1 flex-col">
                                            <span
                                              className="min-w-0 truncate"
                                              title={formatPriorityApiKeyDetails(apiKey)}
                                            >
                                              {formatPriorityApiKeyDetails(apiKey)}
                                            </span>
                                            <span
                                              className="mt-0.5 min-w-0 text-[11px] leading-4 text-[var(--text-tertiary)]"
                                              data-testid="priority-detail-api-key-models"
                                              title={suspensionTitle || undefined}
                                            >
                                              <PriorityModelList entries={modelEntries} />
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex min-w-0 items-center justify-end gap-1">
                                        <PrioritySessionDots
                                          dots={rowSessionDots}
                                          selectedInstanceId={selectedSessionInstanceId}
                                        />
                                        <PriorityRowStatusBadge
                                          status={rowStatus}
                                          now={now}
                                          title={suspensionTitle}
                                          minSuccessRate={selectedMinSuccessRate}
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        className="inline-flex h-5 min-w-8 items-center justify-center justify-self-end rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-1.5 text-[11px] font-semibold leading-none text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                                        aria-label={`${apiKey.apiKeyName} 禁用`}
                                        title="禁用 API key"
                                        onClick={() =>
                                          togglePriorityApiKeyDisabled(siteGroup.siteId, apiKey.key)
                                        }
                                        data-testid="priority-detail-api-key-disable-toggle"
                                      >
                                        禁用
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                              {foldedRowCount > 0 ? (
                                <div className="border-t border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning-soft)_20%,transparent)] text-xs text-[var(--text-secondary)]">
                                  <button
                                    type="button"
                                    className={`grid w-full ${PRIORITY_DETAIL_GRID_CLASS} items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--warning-soft)_35%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]`}
                                    aria-expanded={missingHintsExpanded}
                                    aria-controls={`priority-folded-hints-${siteGroup.siteId}`}
                                    aria-label={`${siteGroup.siteName} ${
                                      missingHintsExpanded ? '收起' : '展开'
                                    }折叠项`}
                                    onClick={() => toggleMissingKeyHints(siteGroup.siteId)}
                                    data-testid="priority-detail-missing-key-toggle"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="h-5 w-px shrink-0 bg-[color-mix(in_srgb,var(--warning)_35%,transparent)]" />
                                      <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                                        折叠
                                      </span>
                                      <span className="min-w-0 truncate">
                                        {foldedSummary || `${foldedRowCount} 项不可参与优先级`}
                                      </span>
                                    </div>
                                    <span className="flex items-center justify-end gap-1 text-[11px] font-medium text-[var(--warning)]">
                                      <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                          missingHintsExpanded ? '' : '-rotate-90'
                                        }`}
                                        aria-hidden="true"
                                      />
                                      {missingHintsExpanded ? '收起' : '展开'}
                                    </span>
                                    <span aria-hidden="true" />
                                  </button>
                                  {missingHintsExpanded ? (
                                    <div id={`priority-folded-hints-${siteGroup.siteId}`}>
                                      {disabledApiKeys.map(apiKey => {
                                        const modelEntries = buildPriorityModelEntries(
                                          apiKey.supportedOriginalModels,
                                          apiKey.modelPriceLabels
                                        );

                                        return (
                                          <div
                                            key={`${siteGroup.key}:disabled:${apiKey.key}`}
                                            className="border-t border-[color-mix(in_srgb,var(--warning)_15%,transparent)] px-2.5 py-1"
                                            data-testid="priority-detail-disabled-api-key-row"
                                          >
                                            <div
                                              className={`grid ${PRIORITY_DETAIL_GRID_CLASS} items-start gap-2`}
                                            >
                                              <div className="flex min-w-0 items-start gap-2">
                                                <span className="h-5 w-px shrink-0 bg-[color-mix(in_srgb,var(--warning)_35%,transparent)]" />
                                                <span className="shrink-0 rounded border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)] px-1 py-px text-[11px] font-semibold leading-3 text-[var(--warning)]">
                                                  API Key
                                                </span>
                                                <div className="flex min-w-0 flex-1 flex-col">
                                                  <span
                                                    className="min-w-0 truncate"
                                                    title={formatPriorityApiKeyDetails(apiKey)}
                                                  >
                                                    {formatPriorityApiKeyDetails(apiKey)}
                                                  </span>
                                                  <span
                                                    className="mt-0.5 min-w-0 text-[11px] leading-4 text-[var(--text-tertiary)]"
                                                    data-testid="priority-detail-api-key-models"
                                                  >
                                                    <PriorityModelList entries={modelEntries} />
                                                  </span>
                                                </div>
                                              </div>
                                              <span className="shrink-0 justify-self-end whitespace-nowrap rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                                                {siteDisabled ? '随站点禁用' : '已禁用'}
                                              </span>
                                              <button
                                                type="button"
                                                className="inline-flex h-5 min-w-8 items-center justify-center justify-self-end rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] px-1.5 text-[11px] font-semibold leading-none text-[var(--success)] transition-colors hover:border-[var(--success)] disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={`${apiKey.apiKeyName} 启用`}
                                                title={siteDisabled ? '先启用站点' : '启用 API key'}
                                                disabled={siteDisabled}
                                                onClick={() =>
                                                  togglePriorityApiKeyDisabled(
                                                    siteGroup.siteId,
                                                    apiKey.key
                                                  )
                                                }
                                                data-testid="priority-detail-api-key-enable-toggle"
                                              >
                                                启用
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      {siteGroup.missingGroupHints.map(hint => (
                                        <div
                                          key={`${siteGroup.key}:${hint.key}`}
                                          className={`grid ${PRIORITY_DETAIL_GRID_CLASS} items-center gap-2 border-t border-[color-mix(in_srgb,var(--warning)_15%,transparent)] px-2.5 py-1`}
                                          data-testid="priority-detail-missing-key-row"
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className="h-5 w-px shrink-0 bg-[color-mix(in_srgb,var(--warning)_35%,transparent)]" />
                                            <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                                              缺少 Key
                                            </span>
                                            <span className="min-w-0 truncate">
                                              {hint.accountName || hint.accountId} / {hint.group}（
                                              {hint.originalModels.join('、')}）未创建可用 API key
                                            </span>
                                          </div>
                                          <AppButton
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            className="!h-6 !min-h-6 w-14 shrink-0 justify-self-end px-0"
                                            onClick={() =>
                                              void openCreateApiKeyDialog(siteGroup, hint)
                                            }
                                            disabled={creatingApiKey}
                                          >
                                            创建
                                          </AppButton>
                                          <span aria-hidden="true" />
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div
                                      id={`priority-folded-hints-${siteGroup.siteId}`}
                                      hidden
                                    ></div>
                                  )}
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-4 text-sm text-[var(--text-secondary)]">
                      当前重定向还没有可配置优先级的可用站点、账户或 API key。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-full items-center justify-center px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
                请选择左侧重定向模型。
              </div>
            )}
          </div>
        </div>
      </div>

      {discoveryOpen && (
        <ModelDiscoveryDialog
          sources={registry ? getRegistrySourcePool(registry) : []}
          displayItems={displayItems.map(view => view.item)}
          onClose={() => setDiscoveryOpen(false)}
          onEnable={enableDiscoveredModel}
        />
      )}

      <AppModal
        isOpen={editorContext !== null}
        onClose={closeEditor}
        title={editorContext?.mode === 'edit' ? '编辑模型重定向' : '新增模型重定向'}
        size="xl"
        className="!h-[72vh] !max-h-[72vh] !max-w-4xl"
        contentClassName="!flex !min-h-0 !max-h-none !flex-1 !overflow-hidden !px-0 !py-0"
        footer={
          <div className="flex justify-end gap-2">
            <AppButton type="button" variant="secondary" onClick={closeEditor} disabled={saving}>
              取消
            </AppButton>
            <AppButton type="button" onClick={handleSave} loading={saving}>
              {editorContext?.mode === 'edit' ? '保存修改' : '新增重定向'}
            </AppButton>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 basis-0 flex-col gap-3 px-5 py-3">
          <div
            data-testid="redirect-editor-input-row"
            className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start"
          >
            <label
              htmlFor={redirectNameInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              重定向名称
            </label>
            <div className="min-w-0 space-y-1">
              <input
                id={redirectNameInputId}
                type="text"
                value={draft.canonicalName}
                onChange={event => {
                  setDraft(current => ({ ...current, canonicalName: event.target.value }));
                  setErrors(current => ({ ...current, canonicalName: undefined }));
                }}
                placeholder="例如：claude-sonnet-4-6"
                className={`w-full rounded-[var(--radius-md)] border bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:ring-2 ${
                  errors.canonicalName
                    ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger-soft)]'
                    : 'border-[var(--line-soft)] focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]'
                }`}
                autoFocus
              />
              {errors.canonicalName ? (
                <div className="text-xs text-[var(--danger)]">{errors.canonicalName}</div>
              ) : null}
            </div>

            <label
              htmlFor={searchInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              原始名称
            </label>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                id={searchInputId}
                type="text"
                value={candidateQuery}
                onChange={event => setCandidateQuery(event.target.value)}
                placeholder="搜索模型..."
                aria-label="搜索原始名称"
                className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-1.5 pl-9 pr-10 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
              {candidateQuery ? (
                <button
                  type="button"
                  onClick={() => setCandidateQuery('')}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={!!draft.autoCollect}
                disabled={!draft.autoCollect && draft.selectedOriginalModels.length === 0}
                onChange={event => {
                  const enabled = event.target.checked;
                  setDraft(current => ({
                    ...current,
                    autoCollect: enabled
                      ? {
                          modelKeys: Array.from(
                            new Set(current.selectedOriginalModels.map(getRouteModelKey))
                          ),
                          excludedModels: [],
                        }
                      : undefined,
                  }));
                }}
                className="accent-[var(--accent)]"
              />
              自动收录同类原始模型
            </label>
            <p>
              根据已选型号持续补齐来源，保留版本、日期和功能后缀的区别；取消勾选的模型不会重新加入。
            </p>
            {draft.autoCollect && (
              <p className="break-all">
                收录范围：{draft.autoCollect.modelKeys.join('、')} · 已排除{' '}
                {draft.autoCollect.excludedModels.length} 个
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 basis-0 flex-col gap-1.5">
            <div className="flex min-h-0 flex-1 basis-0 flex-col gap-2 md:flex-row">
              <section className="flex min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] md:min-h-0 md:w-[38%] md:min-w-[18rem]">
                <div
                  data-testid="selected-original-models-header"
                  className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      已选原始模型
                    </div>
                    <span className="rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                      已选 {draft.selectedOriginalModels.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(current => ({
                        ...current,
                        selectedOriginalModels: [],
                        autoCollect: current.autoCollect
                          ? {
                              ...current.autoCollect,
                              excludedModels: Array.from(
                                new Set([
                                  ...current.autoCollect.excludedModels,
                                  ...current.selectedOriginalModels,
                                ])
                              ),
                            }
                          : undefined,
                      }));
                      setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
                    }}
                    className="text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={draft.selectedOriginalModels.length === 0}
                  >
                    清空已选
                  </button>
                </div>
                <div
                  data-testid="selected-original-models-list"
                  className="min-h-[9rem] max-h-56 overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-gutter:stable] md:min-h-0 md:max-h-none md:flex-1 md:basis-0"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  {draft.selectedOriginalModels.length > 0 ? (
                    <div className="flex flex-wrap content-start gap-1.5">
                      {draft.selectedOriginalModels.map(originalModel => (
                        <span
                          key={originalModel}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent-soft)_70%,transparent)] px-2 py-0.5"
                        >
                          <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                            {originalModel}
                          </code>
                          <button
                            type="button"
                            onClick={() => toggleOriginalModel(originalModel)}
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--danger)]"
                            aria-label={`取消选择 ${originalModel}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                      还没有选择原始模型
                    </div>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
                <div
                  data-testid="original-model-candidate-header"
                  className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">原始模型</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {filteredCandidates.length} 个候选
                  </div>
                </div>
                <div
                  data-testid="original-model-candidate-list"
                  className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain p-2.5"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  <div className="space-y-1.5">
                    {filteredCandidates.length > 0 ? (
                      filteredCandidates.map(candidate => {
                        const checked = draft.selectedOriginalModels.includes(
                          candidate.originalModel
                        );

                        return (
                          <label
                            key={candidate.originalModel}
                            className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 transition-colors ${
                              checked
                                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent-soft)_60%,transparent)]'
                                : 'border-[var(--line-soft)] bg-[var(--surface-2)] hover:border-[var(--icon-muted)]'
                            }`}
                          >
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--text-on-accent)]'
                                  : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-transparent'
                              }`}
                            >
                              <Check className="h-3 w-3" />
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleOriginalModel(candidate.originalModel)}
                            />

                            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                              <code className="min-w-0 flex-1 font-mono text-[12px] text-[var(--text-primary)]">
                                {candidate.originalModel}
                              </code>
                              <div className="shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
                                {candidate.siteCount} 站点 / {candidate.sourceCount} 来源
                              </div>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
                        无匹配结果
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {errors.selectedOriginalModels ? (
              <div className="text-xs text-[var(--danger)]">{errors.selectedOriginalModels}</div>
            ) : null}
          </div>
        </div>
      </AppModal>

      <AppModal
        isOpen={routeRuleState !== null}
        onClose={closeRouteRules}
        title={routeRuleState ? `${routeRuleState.displayName} 路由规则` : '路由规则'}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <AppButton
              type="button"
              variant="tertiary"
              onClick={handleResetRouteRuleDraft}
              data-testid="route-rule-reset-button"
            >
              恢复默认值
            </AppButton>
            <div className="flex items-center gap-2">
              <AppButton type="button" variant="secondary" onClick={closeRouteRules}>
                取消
              </AppButton>
              <AppButton
                type="button"
                onClick={handleSaveRouteRules}
                loading={saving}
                variant={
                  routeRuleState &&
                  isRouteRuntimeRuleDraftDirty(routeRuleDraft, routeRuleState.item.runtimeConfig)
                    ? 'danger'
                    : 'primary'
                }
                data-testid="route-rule-save-button"
                data-dirty={
                  routeRuleState &&
                  isRouteRuntimeRuleDraftDirty(routeRuleDraft, routeRuleState.item.runtimeConfig)
                    ? 'true'
                    : 'false'
                }
              >
                保存路由规则
              </AppButton>
            </div>
          </div>
        }
      >
        <div className="space-y-3 px-1 py-1.5">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              每条路由路径尝试次数
            </span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={routeRuleDraft.maxAttemptsPerRoutePath}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  maxAttemptsPerRoutePath: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  maxAttemptsPerRoutePath: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.maxAttemptsPerRoutePath)}
              aria-label="每条路由路径尝试次数"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.maxAttemptsPerRoutePath ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.maxAttemptsPerRoutePath}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              禁用路由时间（分钟）
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={routeRuleDraft.disableDurationMinutes}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  disableDurationMinutes: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  disableDurationMinutes: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.disableDurationMinutes)}
              aria-label="禁用路由时间（分钟）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.disableDurationMinutes ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.disableDurationMinutes}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              成功率计算时间（分钟）
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={routeRuleDraft.successRateWindowMinutes}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  successRateWindowMinutes: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  successRateWindowMinutes: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.successRateWindowMinutes)}
              aria-label="成功率计算时间（分钟）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.successRateWindowMinutes ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.successRateWindowMinutes}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              最低成功率（%）
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={routeRuleDraft.minSuccessRatePercent}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  minSuccessRatePercent: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  minSuccessRatePercent: undefined,
                }));
              }}
              placeholder={String(Math.round(DEFAULT_ROUTE_RUNTIME_CONFIG.minSuccessRate * 100))}
              aria-label="最低成功率（%）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.minSuccessRatePercent ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.minSuccessRatePercent}
              </span>
            ) : null}
          </label>
        </div>
      </AppModal>

      {createApiKeyState ? (
        <CreateApiKeyDialog
          site={createApiKeyState.site}
          form={newApiKeyForm}
          groups={createApiKeyState.groups}
          creating={creatingApiKey}
          onFormChange={partial =>
            setNewApiKeyForm(current => ({
              ...current,
              ...partial,
            }))
          }
          onSubmit={() => void handleCreateApiKeySubmit()}
          onClose={closeCreateApiKeyDialog}
        />
      ) : null}

      <AppModal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="删除重定向模型"
        titleIcon={<AlertTriangle className="h-5 w-5" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirm(null)}
              disabled={saving}
            >
              取消
            </AppButton>
            <AppButton
              type="button"
              variant="danger"
              onClick={confirmDelete}
              loading={saving}
              data-testid="confirm-delete-redirect"
            >
              删除
            </AppButton>
          </div>
        }
      >
        <p className="text-sm text-[var(--text-primary)]">
          确定要删除重定向模型
          <code className="mx-1 font-mono font-semibold">{deleteConfirm?.displayName}</code>
          吗？删除后其优先级与规则配置将一并移除，此操作无法撤销。
        </p>
      </AppModal>
    </>
  );
}
