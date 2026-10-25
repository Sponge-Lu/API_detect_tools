import { makeCardKey } from './sites/site-projections';
import Logger from '../utils/logger';

import { Server, Plus, Trash2, Pencil } from 'lucide-react';
import { SiteEditor } from '../components/SiteEditor';
import { AddAccountDialog } from '../components/AddAccountDialog';
import { SiteCard } from '../components/SiteCard';
import { SiteListHeader } from '../components/SiteListHeader';
import {
  SiteGroupDialog,
  BackupSelectDialog,
  ApplyConfigPopover,
  AddAccessPointDialog,
  AccessPointDetailPanel,
  OperationRecordDialog,
  SiteSettingsDialog,
} from '../components/dialogs';

import { CreateApiKeyDialog } from '../components/CreateApiKeyDialog';
import { AppButton } from '../components/AppButton/AppButton';
import { AppSearchInput } from '../components/AppInput';
import { DataTableBody, DataTableEmpty } from '../components/DataTable/DataTable';

import { getGroupTextColor } from '../utils/groupStyle';

import { type SiteConfig } from '../../shared/types/site';

import { UNKNOWN_SITE_TYPE_FILTER } from '../components/SiteListHeader/SiteListHeader';

import { toast } from '../store/toastStore';

import { AddedAccountInfo, SitesPageProps } from './sites/SitesPageParts';
import { useSitesController } from './sites/useSitesController';
export function SitesPage({ setPageHeaderActions }: SitesPageProps) {
  const {
    hasAccessPoints,
    siteGroups,
    effectiveActiveSiteGroupFilter,
    config,
    defaultGroupId,
    customCliConfigs,
    dragOverGroupIndex,
    draggedGroupIndex,
    handleGroupDragStart,
    handleGroupDragEnd,
    dragOverGroupId,
    handleGroupDragOver,
    setDragOverGroupId,
    handleGroupDragLeave,
    handleGroupDrop,
    handleDropOnGroup,
    toggleSiteGroupFilter,
    openEditGroupDialog,
    deleteSiteGroup,
    openCreateGroupDialog,
    globalModelSearch,
    handleGlobalModelSearchChange,
    setShowAddAccessPointDialog,
    handleOpenBackupDialog,
    visibleColumnWidths,
    setColumnWidth,
    effectiveSortField,
    sortOrder,
    toggleSort,
    resetSort,
    activeSiteTypeFilter,
    siteTypeFilterOptions,
    setActiveSiteTypeFilter,
    flattenedCards,
    siteHasMatchingModels,
    handleRowClick,
    modelPricing,
    fetchingModels,
    detectingSites,
    checkingIn,
    dragOverIndex,
    refreshMessage,
    getCliConfig,
    handleRefreshDirectConfig,
    detectSingle,
    handleCheckIn,
    handleOpenSite,
    openExtraLink,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setCliApplySite,
    setCliApplyCardKey,
    setCliApplyAnchorEl,
    showOperationRecords,
    setShowOperationRecords,
    showSiteEditor,
    siteBeingEdited,
    resolvedEditingAccount,
    siteEditorInitialMode,
    editingSite,
    storeUpdateSite,
    setConfig,
    loadAllAccounts,
    createSiteWithDefaultAccount,
    setShowSiteEditor,
    setEditingAccount,
    processingAuthErrorSite,
    authErrorSites,
    setAuthErrorSites,
    setProcessingAuthErrorSite,
    setShowAuthErrorDialog,
    showCreateGroupDialog,
    newGroupName,
    setNewGroupName,
    confirmCreateSiteGroup,
    closeCreateGroupDialog,
    showEditGroupDialog,
    editingGroup,
    editGroupName,
    setEditGroupName,
    confirmEditSiteGroup,
    closeEditGroupDialog,
    creatingTokenSite,
    tokenDialogVersion,
    newTokenForm,
    userGroups,
    tokenOperationContext,
    creatingTokenCardKey,
    creatingToken,
    setNewTokenForm,
    handleCreateTokenSubmit,
    closeCreateTokenDialogWithContext,
    cliApplySite,
    cliApplyAnchorEl,
    cliApplyCardKey,
    apiKeys,
    showBackupDialog,
    backupList,
    loadingBackups,
    setShowBackupDialog,
    showDialog,
    showAlert,
    addAccountSite,
    setAddAccountSite,
    showSiteSettings,
    savingSiteSettings,
    setShowSiteSettings,
    handleSaveSiteSettings,
    showAddAccessPointDialog,
    setEditingSite,
    setSiteEditorInitialMode,
    handleAddDirectConfig,
    selectedItem,
    panelOpen,
    handleClosePanel,
    results,
    accountsBySite,
    handleSavePanelSiteMeta,
    handleSavePanelAccount,
    handleLoadPanelBrowserProfiles,
    handleBindPanelBrowserProfile,
    handleRefreshPanelAccountInfo,
    deleteAccount,
    toggleGroupFilter,
    setModelSearchStore,
    copyToClipboard,
    handleOpenCreateTokenDialog,
    getCardContext,
    handleRefreshToken,
    handleDeleteToken,
    handleDeleteDirectConfig,
    handleUpdateAnyRouterUserHash,
    handleDirectConfigSaved,
  } = useSitesController({ setPageHeaderActions });
  if (!config) return null;
  return (
    <>
      <div className="flex-1 overflow-y-hidden overflow-x-visible flex">
        <div className="flex-1 flex flex-col">
          {/* 站点分组控制栏 */}
          {hasAccessPoints && (
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-4 pb-1 pt-2 text-[13px] text-[var(--text-secondary)]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--text-primary)]">站点分组</span>
                {siteGroups.map((group, groupIndex) => {
                  const groupId = group.id;
                  const isActive = effectiveActiveSiteGroupFilter === groupId;
                  const groupSitesCount =
                    config.sites.filter(s => (s.group || defaultGroupId) === groupId).length +
                    (groupId === defaultGroupId ? customCliConfigs.length : 0);
                  const colorClass = getGroupTextColor(group.name);
                  const isDefaultGroup = groupId === defaultGroupId;
                  const isDragOverForSort =
                    dragOverGroupIndex === groupIndex && draggedGroupIndex !== null;
                  return (
                    <div
                      key={groupId}
                      draggable
                      onDragStart={e => handleGroupDragStart(e, groupIndex)}
                      onDragEnd={handleGroupDragEnd}
                      className={`group/tag inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[13px] transition-colors cursor-grab active:cursor-grabbing ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--text-on-accent)]'
                          : isDragOverForSort
                            ? 'scale-105 border-[var(--accent)] bg-[var(--accent-soft)]'
                            : dragOverGroupId === groupId
                              ? 'border-[color-mix(in_srgb,var(--accent)_36%,var(--line-soft))] bg-[var(--surface-2)]'
                              : 'border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--line-soft))]'
                      }`}
                      onDragOver={e => {
                        e.preventDefault();
                        if (draggedGroupIndex !== null) {
                          handleGroupDragOver(e, groupIndex);
                        } else {
                          setDragOverGroupId(groupId);
                        }
                      }}
                      onDragLeave={e => {
                        e.preventDefault();
                        if (draggedGroupIndex !== null) {
                          handleGroupDragLeave(e);
                        } else {
                          if (dragOverGroupId === groupId) {
                            setDragOverGroupId(null);
                          }
                        }
                      }}
                      onDrop={e => {
                        if (draggedGroupIndex !== null) {
                          handleGroupDrop(e, groupIndex);
                        } else {
                          handleDropOnGroup(e, groupId);
                        }
                      }}
                      onClick={() => toggleSiteGroupFilter(groupId)}
                      title={
                        isActive
                          ? `当前显示「${group.name}」分组的站点\n拖动站点卡片到此可移动分组\n拖动分组标签可调整顺序`
                          : `点击只显示「${group.name}」分组的站点\n拖动站点卡片到此可移动分组\n拖动分组标签可调整顺序`
                      }
                    >
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          toggleSiteGroupFilter(groupId);
                        }}
                        aria-pressed={isActive}
                        aria-label={`${isActive ? '当前筛选：' : '筛选分组：'}${group.name}，${groupSitesCount} 个站点`}
                        title={
                          isActive
                            ? `当前显示「${group.name}」分组的站点`
                            : `点击只显示「${group.name}」分组的站点`
                        }
                        className={`flex items-center gap-1 rounded-full focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1 ${isActive ? 'text-[var(--text-on-accent)]' : colorClass}`}
                      >
                        <span className="font-semibold">{group.name}</span>
                      </button>
                      <span
                        className={`text-xs ${isActive ? 'text-[var(--text-on-accent)] opacity-80' : 'text-[var(--text-tertiary)]'}`}
                      >
                        {groupSitesCount} 个
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openEditGroupDialog(group);
                        }}
                        aria-label={`编辑分组 ${group.name}`}
                        className={`hidden rounded-[var(--radius-sm)] p-0.5 transition-colors group-hover/tag:block group-focus-within/tag:block focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${isActive ? 'text-[var(--text-on-accent)] opacity-80 hover:bg-[color-mix(in_srgb,var(--text-on-accent)_20%,transparent)] hover:opacity-100' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'}`}
                        title="编辑分组名称"
                      >
                        <Pencil className="w-3 h-3" aria-hidden="true" />
                      </button>
                      {!isDefaultGroup && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            deleteSiteGroup(groupId);
                          }}
                          aria-label={`删除分组 ${group.name}`}
                          className={`hidden rounded-[var(--radius-sm)] p-0.5 transition-colors group-hover/tag:block group-focus-within/tag:block focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${isActive ? 'text-[var(--text-on-accent)] opacity-80 hover:bg-[color-mix(in_srgb,var(--text-on-accent)_20%,transparent)] hover:opacity-100' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--danger)]'}`}
                          title="删除分组"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <AppButton
                  variant="tertiary"
                  size="sm"
                  onClick={openCreateGroupDialog}
                  title="新建分组"
                >
                  <Plus className="w-3 h-3" />
                  新建分组
                </AppButton>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AppSearchInput
                  size="sm"
                  containerClassName="w-64"
                  value={globalModelSearch}
                  onChange={e => handleGlobalModelSearchChange(e.target.value)}
                  onClear={() => handleGlobalModelSearchChange('')}
                  placeholder="搜索可用模型（全局）"
                  aria-label="搜索可用模型（全局）"
                />
              </div>
            </div>
          )}

          {/* 站点列表区域 */}
          <div className="relative z-0 flex-1 overflow-x-visible overflow-y-auto px-4 pb-4">
            {!hasAccessPoints ? (
              <DataTableEmpty
                icon={<Server className="w-16 h-16 opacity-30" strokeWidth={1.5} />}
                title="还没有添加任何接入点"
                description='点击"添加站点"按钮开始添加托管站点或直连配置'
                action={
                  <>
                    <div className="flex items-center justify-center gap-2">
                      <AppButton
                        variant="primary"
                        onClick={() => setShowAddAccessPointDialog(true)}
                      >
                        <Plus className="w-4 h-4" strokeWidth={2.5} />
                        添加站点
                      </AppButton>
                      <AppButton variant="secondary" onClick={handleOpenBackupDialog}>
                        从备份恢复站点
                      </AppButton>
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                      从备份目录选择配置文件进行恢复
                    </p>
                  </>
                }
              />
            ) : (
              <>
                <SiteListHeader
                  columnWidths={visibleColumnWidths}
                  onColumnWidthChange={setColumnWidth}
                  sortField={effectiveSortField}
                  sortOrder={sortOrder}
                  onToggleSort={toggleSort}
                  onResetSort={resetSort}
                  activeSiteTypeFilter={activeSiteTypeFilter}
                  siteTypeFilterOptions={siteTypeFilterOptions}
                  onSiteTypeFilterChange={setActiveSiteTypeFilter}
                />

                <DataTableBody>
                  {flattenedCards.map(cardItem => {
                    const { site, index, siteResult, account, cardKey: ck } = cardItem;
                    const groupId = site.group || defaultGroupId;
                    if (groupId !== effectiveActiveSiteGroupFilter) {
                      return null;
                    }

                    const siteTypeValue = site.site_type ?? UNKNOWN_SITE_TYPE_FILTER;
                    if (activeSiteTypeFilter !== null && siteTypeValue !== activeSiteTypeFilter) {
                      return null;
                    }

                    if (cardItem.type === 'custom-cli') {
                      if (globalModelSearch) {
                        const searchTerm = globalModelSearch.toLowerCase();
                        const directModels = [
                          ...(cardItem.config.models || []),
                          ...(cardItem.config.manualModels || []),
                        ];
                        if (!directModels.some(model => model.toLowerCase().includes(searchTerm))) {
                          return null;
                        }
                      }
                    } else if (!siteHasMatchingModels(site, siteResult, ck)) {
                      return null;
                    }

                    return (
                      <div
                        key={ck}
                        onClick={() => handleRowClick(cardItem)}
                        className="cursor-pointer"
                      >
                        <SiteCard
                          key={ck}
                          site={site}
                          index={index}
                          siteResult={siteResult}
                          siteAccount={null}
                          columnWidths={visibleColumnWidths}
                          accessPointType={cardItem.type}
                          draggable={cardItem.type === 'managed'}
                          accountId={account?.id}
                          accountName={account?.account_name}
                          cardKey={ck}
                          modelPricing={
                            cardItem.type === 'custom-cli'
                              ? null
                              : modelPricing[ck] || modelPricing[site.name]
                          }
                          isDetecting={
                            cardItem.type === 'custom-cli'
                              ? Boolean(fetchingModels[cardItem.config.id])
                              : detectingSites.has(ck)
                          }
                          checkingIn={checkingIn}
                          dragOverIndex={dragOverIndex}
                          refreshMessage={refreshMessage}
                          cliConfig={cardItem.type === 'custom-cli' ? null : getCliConfig(ck)}
                          onDetect={(s, accountId) =>
                            cardItem.type === 'custom-cli'
                              ? void handleRefreshDirectConfig(cardItem.config.id)
                              : detectSingle(s, true, undefined, accountId || account?.id)
                          }
                          onCheckIn={(s, aid) => {
                            if (cardItem.type === 'managed') {
                              handleCheckIn(s, aid || account?.id);
                            }
                          }}
                          onOpenSite={handleOpenSite}
                          onOpenExtraLink={openExtraLink}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onApply={event => {
                            setCliApplySite(site);
                            setCliApplyCardKey(ck);
                            setCliApplyAnchorEl(event?.currentTarget ?? null);
                          }}
                        />
                      </div>
                    );
                  })}
                </DataTableBody>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 站点相关弹窗 ===== */}

      <OperationRecordDialog
        open={showOperationRecords}
        onClose={() => setShowOperationRecords(false)}
      />

      {showSiteEditor && (
        <SiteEditor
          key={`${siteBeingEdited?.id || 'new-site'}:${resolvedEditingAccount?.id || 'site'}:${siteEditorInitialMode}`}
          site={siteBeingEdited}
          editingAccount={resolvedEditingAccount}
          initialMode={siteEditorInitialMode}
          onSave={async (site, auth) => {
            const isEditing = editingSite !== null;
            try {
              if (isEditing && editingSite !== null && config) {
                const currentSite = config.sites[editingSite];

                await storeUpdateSite(editingSite, {
                  ...site,
                  system_token: resolvedEditingAccount
                    ? currentSite.system_token
                    : site.system_token,
                  user_id: resolvedEditingAccount ? currentSite.user_id : site.user_id,
                  api_key: resolvedEditingAccount ? currentSite.api_key : site.api_key,
                });

                if (resolvedEditingAccount) {
                  const updateResult = await window.electronAPI.accounts?.update(
                    resolvedEditingAccount.id,
                    {
                      account_name:
                        auth.accountName?.trim() ||
                        resolvedEditingAccount.account_name ||
                        '默认账户',
                      access_token: auth.systemToken,
                      api_key: site.api_key,
                      user_id: auth.userId,
                      // AnyRouter 配置
                      ...(auth.anyRouterConfig ? { anyRouterConfig: auth.anyRouterConfig } : {}),
                    }
                  );

                  if (!updateResult?.success) {
                    throw new Error(updateResult?.error || '更新账户凭证失败');
                  }
                }

                const refreshedConfig = await window.electronAPI.loadConfig();
                setConfig(refreshedConfig);
                await loadAllAccounts(refreshedConfig?.sites);
              } else {
                await createSiteWithDefaultAccount(site, auth);
              }
            } catch (error: any) {
              Logger.error('保存站点失败:', error);
              toast.error(`保存站点失败: ${error?.message || '未知错误'}`);
              return;
            }

            setShowSiteEditor(false);
            setEditingAccount(null);

            if (processingAuthErrorSite) {
              const processedAccountId = resolvedEditingAccount?.id;
              const remaining = authErrorSites.filter(item => {
                if (item.name !== processingAuthErrorSite) return true;
                if (!processedAccountId) return false;
                return item.accountId !== processedAccountId;
              });
              setAuthErrorSites(remaining);
              setProcessingAuthErrorSite(null);
              if (remaining.length > 0) {
                setTimeout(() => {
                  setShowAuthErrorDialog(true);
                }, 300);
              }
            }

            if (isEditing) {
              setTimeout(async () => {
                try {
                  await detectSingle(site, false, undefined, resolvedEditingAccount?.id);
                } catch (error: any) {
                  Logger.error('站点数据刷新失败:', error.message);
                } finally {
                  try {
                    await window.electronAPI.closeLoginBrowser?.();
                  } catch (err) {
                    Logger.warn('关闭登录浏览器失败:', err);
                  }
                }
              }, 500);
            }
          }}
          onCancel={() => {
            setShowSiteEditor(false);
            setEditingAccount(null);
            if (processingAuthErrorSite && authErrorSites.length > 0) {
              setProcessingAuthErrorSite(null);
              setTimeout(() => {
                setShowAuthErrorDialog(true);
              }, 300);
            }
          }}
          groups={siteGroups}
          defaultGroupId={defaultGroupId}
          onConfigChanged={async () => {
            // 重新加载配置，以便其他账户也能看到更新的 hash
            const refreshedConfig = await window.electronAPI.loadConfig();
            setConfig(refreshedConfig);
            await loadAllAccounts(refreshedConfig?.sites);
          }}
        />
      )}

      {/* 创建站点分组弹窗 */}
      <SiteGroupDialog
        mode="create"
        isOpen={showCreateGroupDialog}
        groupName={newGroupName}
        onGroupNameChange={setNewGroupName}
        onConfirm={confirmCreateSiteGroup}
        onClose={closeCreateGroupDialog}
      />

      {/* 编辑站点分组弹窗 */}
      <SiteGroupDialog
        mode="edit"
        isOpen={showEditGroupDialog && !!editingGroup}
        groupName={editGroupName}
        editingGroup={editingGroup}
        onGroupNameChange={setEditGroupName}
        onConfirm={confirmEditSiteGroup}
        onClose={closeEditGroupDialog}
      />

      {/* 创建 API Key 弹窗 */}
      {creatingTokenSite && (
        <CreateApiKeyDialog
          key={tokenDialogVersion}
          site={creatingTokenSite}
          form={newTokenForm}
          groups={
            userGroups[
              tokenOperationContext?.cardKey || creatingTokenCardKey || creatingTokenSite.name
            ] ||
            userGroups[creatingTokenSite.name] ||
            {}
          }
          creating={creatingToken}
          onFormChange={partial => setNewTokenForm(prev => ({ ...prev, ...partial }))}
          onSubmit={handleCreateTokenSubmit}
          onClose={closeCreateTokenDialogWithContext}
        />
      )}

      {/* CLI 应用配置弹出菜单由 ApplyConfigPopover 单独承载 */}

      <ApplyConfigPopover
        isOpen={Boolean(cliApplySite && cliApplyAnchorEl)}
        anchorEl={cliApplyAnchorEl}
        cliConfig={
          cliApplySite ? (getCliConfig(cliApplyCardKey ?? cliApplySite.name) ?? null) : null
        }
        siteUrl={cliApplySite?.url ?? ''}
        siteName={cliApplySite?.name ?? ''}
        apiKeys={
          cliApplySite
            ? apiKeys[cliApplyCardKey ?? cliApplySite.name] || apiKeys[cliApplySite.name] || []
            : []
        }
        onClose={() => {
          setCliApplySite(null);
          setCliApplyCardKey(null);
          setCliApplyAnchorEl(null);
        }}
      />

      {/* 备份选择对话框 */}
      <BackupSelectDialog
        isOpen={showBackupDialog}
        backups={backupList}
        loading={loadingBackups}
        onSelect={async backup => {
          setShowBackupDialog(false);
          const confirmed = await showDialog({
            type: 'confirm',
            title: '确认恢复',
            message: `确定要从备份「${backup.filename}」恢复配置吗？\n\n配置包会恢复配置与默认运行态；旧版配置备份只恢复 config.json。恢复前会自动备份当前配置。`,
            confirmText: '恢复',
          });
          if (!confirmed) return;
          try {
            const result = await (window.electronAPI as any).backup?.restoreConfig?.(
              backup.filename
            );
            if (result?.success) {
              showAlert('配置已恢复，正在重新加载...', 'success', '恢复成功');
              // Reload config
              const cfg = await window.electronAPI.loadConfig();
              setConfig(cfg);
            } else {
              showAlert('恢复失败：' + (result?.error || '未知错误'), 'error');
            }
          } catch (error: any) {
            showAlert('恢复失败：' + error.message, 'error');
          }
        }}
        onClose={() => setShowBackupDialog(false)}
      />

      {/* 添加账户对话框 */}
      {addAccountSite?.id && (
        <AddAccountDialog
          isOpen={!!addAccountSite}
          siteId={addAccountSite.id}
          siteName={addAccountSite.name}
          siteUrl={addAccountSite.url}
          onSuccess={async (addedAccount?: AddedAccountInfo) => {
            const cfg = await window.electronAPI.loadConfig();
            setConfig(cfg);
            await loadAllAccounts(cfg?.sites);
            if (cfg) {
              const refreshedSite = cfg.sites.find(s => s.url === addAccountSite.url);
              if (refreshedSite?.id) {
                const addedAccountId = addedAccount?.id;
                if (addedAccountId) {
                  detectSingle(refreshedSite, false, undefined, addedAccountId);
                  return;
                }

                // 回退：旧数据路径仍按最新账户触发一次刷新
                const listRes = await window.electronAPI.accounts?.list(refreshedSite.id);
                const accounts = listRes?.success ? listRes.data : undefined;
                if (accounts && accounts.length > 0) {
                  const newAccount = accounts[accounts.length - 1];
                  detectSingle(refreshedSite, false, undefined, newAccount.id);
                  return;
                }

                detectSingle(refreshedSite);
              }
            }
          }}
          onClose={() => setAddAccountSite(null)}
        />
      )}

      <SiteSettingsDialog
        isOpen={showSiteSettings}
        siteRefreshSettings={config.settings}
        saving={savingSiteSettings}
        onClose={() => {
          if (!savingSiteSettings) {
            setShowSiteSettings(false);
          }
        }}
        onSave={handleSaveSiteSettings}
      />

      {/* 添加接入点弹窗 */}
      <AddAccessPointDialog
        isOpen={showAddAccessPointDialog}
        onClose={() => setShowAddAccessPointDialog(false)}
        onSmartAdd={() => {
          setEditingSite(null);
          setEditingAccount(null);
          setSiteEditorInitialMode('auto');
          setShowSiteEditor(true);
        }}
        onManualAdd={() => {
          setEditingSite(null);
          setEditingAccount(null);
          setSiteEditorInitialMode('manual');
          setShowSiteEditor(true);
        }}
        onAddDirectConfig={handleAddDirectConfig}
      />

      {/* 侧滑面板 */}
      {selectedItem && (
        <AccessPointDetailPanel
          open={panelOpen}
          onClose={handleClosePanel}
          data={selectedItem}
          groups={siteGroups}
          siteResult={results.find(
            r =>
              selectedItem.type === 'managed' &&
              selectedItem.account !== null &&
              r.name === selectedItem.site.name &&
              r.accountId === selectedItem.account.id
          )}
          allAccounts={
            selectedItem.type === 'managed' && selectedItem.site.id
              ? accountsBySite[selectedItem.site.id] || []
              : []
          }
          apiKeys={
            selectedItem.type === 'managed' && selectedItem.account
              ? apiKeys[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                apiKeys[selectedItem.site.name] ||
                []
              : []
          }
          userGroups={
            selectedItem.type === 'managed' && selectedItem.account
              ? userGroups[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                userGroups[selectedItem.site.name] ||
                {}
              : {}
          }
          modelPricing={
            selectedItem.type === 'managed' && selectedItem.account
              ? modelPricing[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                modelPricing[selectedItem.site.name]
              : null
          }
          showDialog={showDialog}
          onAddAccount={() => {
            if (selectedItem.type === 'managed') {
              setAddAccountSite(selectedItem.site);
            }
          }}
          onSaveSiteMeta={handleSavePanelSiteMeta}
          onSaveAccount={handleSavePanelAccount}
          onLoadBrowserProfileOptions={handleLoadPanelBrowserProfiles}
          onBindBrowserProfile={handleBindPanelBrowserProfile}
          onRefreshAccountInfo={handleRefreshPanelAccountInfo}
          onDeleteAccount={async (accountId: string) => {
            if (selectedItem.type !== 'managed') return;
            const account = selectedItem.site.id
              ? accountsBySite[selectedItem.site.id]?.find(a => a.id === accountId)
              : null;
            if (account) {
              const deleted = await deleteAccount(selectedItem.site, account);
              if (deleted && selectedItem.account?.id === accountId) {
                handleClosePanel();
              }
            }
          }}
          onToggleGroupFilter={toggleGroupFilter}
          onModelSearchChange={(siteName, search) => setModelSearchStore(siteName, search)}
          onCopyToClipboard={copyToClipboard}
          onOpenCreateTokenDialog={(site: SiteConfig) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleOpenCreateTokenDialog(site, getCardContext(cardKey, selectedItem.account));
          }}
          onRefreshToken={(site: SiteConfig, token: any, index: number) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleRefreshToken(site, token, index, getCardContext(cardKey, selectedItem.account));
          }}
          onDeleteToken={(site: SiteConfig, token: any, index: number) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleDeleteToken(site, token, index, getCardContext(cardKey, selectedItem.account));
          }}
          onDeleteDirectConfig={handleDeleteDirectConfig}
          onUpdateAnyRouterUserHash={handleUpdateAnyRouterUserHash}
          onConfigChanged={async () => {
            if (selectedItem.type === 'managed') {
              const refreshedConfig = await window.electronAPI.loadConfig();
              setConfig(refreshedConfig);
              await loadAllAccounts(refreshedConfig?.sites);
            } else {
              await handleDirectConfigSaved(selectedItem.config.id);
            }
          }}
        />
      )}
    </>
  );
}
