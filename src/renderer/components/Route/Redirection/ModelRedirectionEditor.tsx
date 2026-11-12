import { Check, Search, X } from 'lucide-react';
import { AppModal } from '../../AppModal/AppModal';
import { AppButton } from '../../AppButton/AppButton';
import { getRouteModelKey } from '../../../../shared/utils/routeModelGrouping';
import type { useModelRedirectionController } from './useModelRedirectionController';

type EditorProps = Pick<
  ReturnType<typeof useModelRedirectionController>,
  | 'editorContext'
  | 'closeEditor'
  | 'saving'
  | 'handleSave'
  | 'redirectNameInputId'
  | 'draft'
  | 'setDraft'
  | 'setErrors'
  | 'errors'
  | 'searchInputId'
  | 'candidateQuery'
  | 'setCandidateQuery'
  | 'stopNestedScrollPropagation'
  | 'toggleOriginalModel'
  | 'filteredCandidates'
>;

export function ModelRedirectionEditor({
  editorContext,
  closeEditor,
  saving,
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
}: EditorProps) {
  return (
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
                  <div className="text-sm font-medium text-[var(--text-primary)]">已选原始模型</div>
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
  );
}
