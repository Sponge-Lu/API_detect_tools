export type ThemeMode = 'light-b' | 'dark' | 'modern' | 'modern-dark';
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
    appBackground: '#eaedf0',
    panelBackground: '#ffffff',
    panelRaised: '#ffffff',
    accentColor: '#4a5866',
    softAccent: 'rgba(74, 88, 102, 0.1)',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: '统一石墨暗色',
    appBackground: '#121417',
    panelBackground: '#1b1e22',
    panelRaised: '#282c32',
    accentColor: '#8ea1ad',
    softAccent: 'rgba(142, 161, 173, 0.16)',
  },
  {
    id: 'modern',
    label: 'Modern',
    description: '铂金白 · 简洁浅色',
    appBackground: '#FAFAFA',
    panelBackground: '#FFFFFF',
    panelRaised: '#FFFFFF',
    accentColor: '#6B7280',
    softAccent: 'rgba(107, 114, 128, 0.12)',
  },
  {
    id: 'modern-dark',
    label: 'Modern Dark',
    description: '铂金白 · 简洁深色',
    appBackground: '#0A0A0A',
    panelBackground: '#161616',
    panelRaised: '#262626',
    accentColor: '#E5E7EB',
    softAccent: 'rgba(229, 231, 235, 0.14)',
  },
];

const VALID_THEME_MODES = new Set<ThemeMode>(['light-b', 'dark', 'modern', 'modern-dark']);

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
