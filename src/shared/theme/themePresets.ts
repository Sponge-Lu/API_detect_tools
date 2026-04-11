export type ThemeMode = 'light-b' | 'dark';
export type LegacyThemeMode = 'light' | 'dark' | 'system';
export type AnyThemeMode = ThemeMode | LegacyThemeMode | string | null | undefined;

export const THEME_STORAGE_KEY = 'app-theme-mode';
export const DEFAULT_LIGHT_THEME: ThemeMode = 'light-b';

export interface ThemePresetDefinition {
  id: ThemeMode;
  label: string;
  description: string;
  appBackground: string;
  panelBackground: string;
  panelRaised: string;
  accentColor: string;
  softAccent: string;
}

export const THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'light-b',
    label: 'Light',
    description: '冷灰矿物',
    appBackground: '#eef2f5',
    panelBackground: '#f7f9fb',
    panelRaised: '#ffffff',
    accentColor: '#5c6b78',
    softAccent: 'rgba(92, 107, 120, 0.12)',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: '统一石墨暗色',
    appBackground: '#17181b',
    panelBackground: '#1d1f23',
    panelRaised: '#252830',
    accentColor: '#8ea1ad',
    softAccent: 'rgba(142, 161, 173, 0.18)',
  },
];

const VALID_THEME_MODES = new Set<ThemeMode>(['light-b', 'dark']);

export function normalizeThemeMode(value: AnyThemeMode): ThemeMode {
  if (typeof value !== 'string') {
    return DEFAULT_LIGHT_THEME;
  }

  if (VALID_THEME_MODES.has(value as ThemeMode)) {
    return value as ThemeMode;
  }

  return DEFAULT_LIGHT_THEME;
}

export function getThemePreset(mode: AnyThemeMode): ThemePresetDefinition {
  const normalizedMode = normalizeThemeMode(mode);
  return THEME_PRESETS.find(preset => preset.id === normalizedMode) ?? THEME_PRESETS[0];
}

export function getWindowBackgroundColor(theme: ThemeMode): string {
  const preset = THEME_PRESETS.find(item => item.id === theme) ?? THEME_PRESETS[0];
  return preset.appBackground;
}
