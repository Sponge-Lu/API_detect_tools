import type { SortField } from '../store/uiStore';

export function normalizeSiteSortField(field: SortField): SortField | null {
  switch (field) {
    case 'name':
    case 'balance':
    case 'todayUsage':
    case 'totalTokens':
    case 'modelCount':
    case 'lastUpdate':
      return field;
    case 'promptTokens':
    case 'completionTokens':
      return 'totalTokens';
    case 'requests':
    case 'rpm':
    case 'tpm':
    case 'ldcRatio':
    default:
      return null;
  }
}
