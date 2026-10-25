import { computeLineDiff, diffSummary } from './config-profile-view';
import { useMemo } from 'react';

import type { ConfigFilePreviewTransaction } from '../../../shared/types/config-file-profile';

import { AppButton } from '../AppButton/AppButton';

export function ApplyPreviewPanel(props: {
  preview: ConfigFilePreviewTransaction;
  onBack: () => void;
}) {
  const totalAdded = props.preview.files.reduce(
    (sum, file) => sum + diffSummary(computeLineDiff(file.content, file.nextContent)).added,
    0
  );
  const totalRemoved = props.preview.files.reduce(
    (sum, file) => sum + diffSummary(computeLineDiff(file.content, file.nextContent)).removed,
    0
  );
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line-muted)] pb-3">
        <div>
          <h3 className="text-sm font-semibold">确认写入内容</h3>
          <p className="mt-1 text-xs font-medium text-[var(--accent-strong)]">
            写入模式：
            {props.preview.operation === 'backup-restore'
              ? '恢复备份'
              : props.preview.applyMode === 'overwrite'
                ? '覆盖'
                : '合并'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            共 {props.preview.files.length} 个文件
            {totalAdded + totalRemoved > 0
              ? ` · 新增 ${totalAdded} 行 · 删除 ${totalRemoved} 行`
              : '，内容无变化'}
            ，确认后将写入本地配置。
          </p>
        </div>
        <AppButton variant="tertiary" size="sm" onClick={props.onBack}>
          返回编辑
        </AppButton>
      </div>
      {props.preview.files.map(file => (
        <section
          key={file.fileId}
          className="space-y-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] p-4"
        >
          <div className="truncate font-mono text-xs" title={file.path}>
            {file.path}
          </div>
          {props.preview.operation === 'backup-restore' ? (
            <p className="text-sm text-[var(--text-secondary)]">将恢复所选备份的完整内容。</p>
          ) : (
            <DiffView oldText={file.content} newText={file.nextContent} />
          )}
        </section>
      ))}
    </div>
  );
}

export function DiffView(props: { oldText: string; newText: string }) {
  const lines = useMemo(
    () => computeLineDiff(props.oldText, props.newText),
    [props.oldText, props.newText]
  );
  const summary = useMemo(() => diffSummary(lines), [lines]);
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3 border-b border-[var(--line-muted)] px-3 py-1.5 text-xs">
        <span className="font-medium text-[var(--success)]">+{summary.added}</span>
        <span className="font-medium text-[var(--danger)]">-{summary.removed}</span>
        <span className="ml-auto text-[var(--text-tertiary)]">{lines.length} 行</span>
      </div>
      <div className="max-h-72 overflow-auto p-2 font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div
            key={index}
            data-diff-kind={line.kind}
            className={
              line.kind === 'add'
                ? 'rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[var(--success)]'
                : line.kind === 'del'
                  ? 'rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'text-[var(--text-secondary)]'
            }
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
            {line.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}
