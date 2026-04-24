import type { SortField } from '../store/uiStore';

export function normalizeSiteSortField(
  field: SortField | string | null | undefined
): SortField | null {
  switch (field) {
    case 'name':
    case 'balance':
    case 'todayUsage':
    case 'totalTokens':
    case 'modelCount':
    case 'ldcRatio':
      return field;
    case 'promptTokens':
    case 'completionTokens':
      return 'totalTokens';
    case 'lastUpdate':
    case 'requests':
    case 'rpm':
    case 'tpm':
    default:
      return null;
  }
}
