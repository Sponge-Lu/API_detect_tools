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
      return field;
    case 'promptTokens':
    case 'completionTokens':
      return 'totalTokens';
    case 'lastUpdate':
    case 'requests':
    case 'rpm':
    case 'tpm':
    case 'ldcRatio':
    default:
      return null;
  }
}
