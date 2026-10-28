export type VisualizationMode =
  | 'bars'
  | 'circular'
  | 'radial-wave'
  | 'dual-spectrum'
  | 'particles'
  | 'spectrum-nebula';

export type ColorThemeId =
  | 'obsidian-gold'
  | 'arctic-cyan'
  | 'crimson-pulse'
  | 'emerald-matrix'
  | 'ultraviolet'
  | 'monochrome';

export type TrackFormat = 'MP3' | 'WAV' | 'FLAC' | 'SYNTH' | 'MIC';

export interface EqBands {
  low: number; // 60 Hz (-12 to +12 dB)
  lowMid: number; // 250 Hz (-12 to +12 dB)
  mid: number; // 1 kHz (-12 to +12 dB)
  highMid: number; // 4 kHz (-12 to +12 dB)
  high: number; // 12 kHz (-12 to +12 dB)
}

export const DEFAULT_EQ_BANDS: EqBands = {
  low: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  high: 0,
};

export const EQ_BAND_DEFINITIONS: {
  key: keyof EqBands;
  label: string;
  freqLabel: string;
  frequency: number;
  type: BiquadFilterType;
}[] = [
  { key: 'low', label: 'Low', freqLabel: '60 Гц', frequency: 60, type: 'lowshelf' },
  { key: 'lowMid', label: 'Low-Mid', freqLabel: '250 Гц', frequency: 250, type: 'peaking' },
  { key: 'mid', label: 'Mid', freqLabel: '1 кГц', frequency: 1000, type: 'peaking' },
  { key: 'highMid', label: 'High-Mid', freqLabel: '4 кГц', frequency: 4000, type: 'peaking' },
  { key: 'high', label: 'High', freqLabel: '12 кГц', frequency: 12000, type: 'highshelf' },
];

export interface VisualizerSettings {
  mode: VisualizationMode;
  colorTheme: ColorThemeId;
  sensitivity: number; // 0.2 to 4.0
  smoothing: number; // 0.1 to 0.95
  barCount: number; // 32 to 256
  mirrorMode: boolean;
  showPeaks: boolean;
  glowIntensity: number; // 0 to 100
  rotationSpeed: number; // 0 to 10
  bassBoost: number; // 0 to 24 dB
  eqBands?: EqBands;
}

export interface WorkspaceLayoutConfig {
  showLeftPanel: boolean;
  showRightPanel: boolean;
  showTimeline: boolean;
  showMeters: boolean;
  autoHideControls: boolean;
  darkTheme: boolean;
  swapSidebars: boolean;
}

export interface VisualizerPreset extends VisualizerSettings {
  id: string;
  ownerId?: string;
  name: string;
  isFactory?: boolean;
  syncedToCloud?: boolean;
  updatedAt?: string;
}

export interface ProjectDraft extends VisualizerSettings {
  id: string;
  ownerId?: string;
  projectName: string;
  trackName: string;
  trackFormat: TrackFormat;
  notes: string;
  showLeftPanel: boolean;
  showRightPanel: boolean;
  showTimeline: boolean;
  showMeters: boolean;
  autoHideControls: boolean;
  darkTheme: boolean;
  updatedAt: string;
}

export interface ColorThemeDefinition {
  id: ColorThemeId;
  name: string;
  primary: string;
  secondary: string;
  tertiary: string;
  peak: string;
  bgDark: string;
  bgLight: string;
}

export const COLOR_THEMES: Record<ColorThemeId, ColorThemeDefinition> = {
  'obsidian-gold': {
    id: 'obsidian-gold',
    name: 'Янтарный студийный',
    primary: '#F59E0B',
    secondary: '#EA580C',
    tertiary: '#FDE68A',
    peak: '#FFFBEB',
    bgDark: '#090D16',
    bgLight: '#F8FAFC',
  },
  'arctic-cyan': {
    id: 'arctic-cyan',
    name: 'Арктический спектр',
    primary: '#06B6D4',
    secondary: '#3B82F6',
    tertiary: '#67E8F9',
    peak: '#ECFEFF',
    bgDark: '#080E1A',
    bgLight: '#F8FAFC',
  },
  'crimson-pulse': {
    id: 'crimson-pulse',
    name: 'Рубиновый импульс',
    primary: '#F43F5E',
    secondary: '#E11D48',
    tertiary: '#FDA4AF',
    peak: '#FFF1F2',
    bgDark: '#0F0911',
    bgLight: '#F8FAFC',
  },
  'emerald-matrix': {
    id: 'emerald-matrix',
    name: 'Изумрудный осциллограф',
    primary: '#10B981',
    secondary: '#059669',
    tertiary: '#6EE7B7',
    peak: '#ECFDF5',
    bgDark: '#07120F',
    bgLight: '#F8FAFC',
  },
  'ultraviolet': {
    id: 'ultraviolet',
    name: 'Кобальт и индиго',
    primary: '#6366F1',
    secondary: '#8B5CF6',
    tertiary: '#C4B5FD',
    peak: '#EEF2FF',
    bgDark: '#0A0B18',
    bgLight: '#F8FAFC',
  },
  'monochrome': {
    id: 'monochrome',
    name: 'Академический монохром',
    primary: '#E2E8F0',
    secondary: '#94A3B8',
    tertiary: '#64748B',
    peak: '#F8FAFC',
    bgDark: '#090A0F',
    bgLight: '#F1F5F9',
  },
};

export const VISUALIZATION_MODES: {
  id: VisualizationMode;
  label: string;
  shortDesc: string;
  hotkey: string;
}[] = [
  {
    id: 'bars',
    label: 'Спектральные полосы',
    shortDesc: 'Линейный анализатор частот с фиксацией пиков',
    hotkey: '1',
  },
  {
    id: 'circular',
    label: 'Круговая орбита',
    shortDesc: 'Радиальное кольцо 360° с гармоническим ядром',
    hotkey: '2',
  },
  {
    id: 'radial-wave',
    label: 'Фазовая волна',
    shortDesc: 'Концентрические осциллограммы и волновой контур',
    hotkey: '3',
  },
  {
    id: 'dual-spectrum',
    label: 'Зеркальный горизонт',
    shortDesc: 'Двухканальный симметричный студийный спектр',
    hotkey: '4',
  },
  {
    id: 'particles',
    label: 'Акустическое поле',
    shortDesc: 'Орбитальная решетка узлов с гармоническим ядром',
    hotkey: '5',
  },
  {
    id: 'spectrum-nebula',
    label: 'Спектральный поток частиц',
    shortDesc: 'Система частиц: цвет, вектор и яркость от частот БПФ',
    hotkey: '6',
  },
];

export const FACTORY_PRESETS: VisualizerPreset[] = [
  {
    id: 'factory_mastering_bars',
    name: 'Студийный мастеринг (Полосы)',
    mode: 'bars',
    colorTheme: 'obsidian-gold',
    sensitivity: 1.35,
    smoothing: 0.78,
    barCount: 96,
    mirrorMode: false,
    showPeaks: true,
    glowIntensity: 35,
    rotationSpeed: 1.5,
    bassBoost: 4,
    isFactory: true,
  },
  {
    id: 'factory_orbital_cyan',
    name: 'Орбитальный резонанс 360°',
    mode: 'circular',
    colorTheme: 'arctic-cyan',
    sensitivity: 1.6,
    smoothing: 0.82,
    barCount: 128,
    mirrorMode: true,
    showPeaks: true,
    glowIntensity: 55,
    rotationSpeed: 2.5,
    bassBoost: 8,
    isFactory: true,
  },
  {
    id: 'factory_analog_scope',
    name: 'Изумрудный фазометр',
    mode: 'radial-wave',
    colorTheme: 'emerald-matrix',
    sensitivity: 1.4,
    smoothing: 0.72,
    barCount: 128,
    mirrorMode: false,
    showPeaks: false,
    glowIntensity: 45,
    rotationSpeed: 1.2,
    bassBoost: 2,
    isFactory: true,
  },
  {
    id: 'factory_horizon_crimson',
    name: 'Симметричный бас-горизонт',
    mode: 'dual-spectrum',
    colorTheme: 'crimson-pulse',
    sensitivity: 1.75,
    smoothing: 0.8,
    barCount: 80,
    mirrorMode: true,
    showPeaks: true,
    glowIntensity: 50,
    rotationSpeed: 0,
    bassBoost: 12,
    isFactory: true,
  },
  {
    id: 'factory_kinetic_field',
    name: 'Кинетическое поле частиц',
    mode: 'particles',
    colorTheme: 'ultraviolet',
    sensitivity: 1.85,
    smoothing: 0.85,
    barCount: 112,
    mirrorMode: true,
    showPeaks: true,
    glowIntensity: 65,
    rotationSpeed: 3.2,
    bassBoost: 10,
    isFactory: true,
  },
  {
    id: 'factory_spectrum_nebula',
    name: 'Спектральная туманность БПФ',
    mode: 'spectrum-nebula',
    colorTheme: 'arctic-cyan',
    sensitivity: 1.7,
    smoothing: 0.76,
    barCount: 128,
    mirrorMode: true,
    showPeaks: true,
    glowIntensity: 70,
    rotationSpeed: 2.8,
    bassBoost: 9,
    isFactory: true,
  },
];

export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'item_' + Date.now();
}

export function clampNumber(val: number, min: number, max: number): number {
  if (Number.isNaN(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function sanitizeEqBands(eq?: Partial<EqBands>): EqBands {
  if (!eq) return { ...DEFAULT_EQ_BANDS };
  return {
    low: Number(clampNumber(Number(eq.low ?? 0), -12, 12).toFixed(1)),
    lowMid: Number(clampNumber(Number(eq.lowMid ?? 0), -12, 12).toFixed(1)),
    mid: Number(clampNumber(Number(eq.mid ?? 0), -12, 12).toFixed(1)),
    highMid: Number(clampNumber(Number(eq.highMid ?? 0), -12, 12).toFixed(1)),
    high: Number(clampNumber(Number(eq.high ?? 0), -12, 12).toFixed(1)),
  };
}

export function sanitizeSettings(s: VisualizerSettings): VisualizerSettings {
  return {
    mode: VISUALIZATION_MODES.some((m) => m.id === s.mode) ? s.mode : 'bars',
    colorTheme: s.colorTheme in COLOR_THEMES ? s.colorTheme : 'obsidian-gold',
    sensitivity: Number(clampNumber(s.sensitivity, 0.2, 4.0).toFixed(2)),
    smoothing: Number(clampNumber(s.smoothing, 0.1, 0.95).toFixed(2)),
    barCount: Math.round(clampNumber(s.barCount, 32, 256)),
    mirrorMode: Boolean(s.mirrorMode),
    showPeaks: Boolean(s.showPeaks),
    glowIntensity: Math.round(clampNumber(s.glowIntensity, 0, 100)),
    rotationSpeed: Number(clampNumber(s.rotationSpeed, 0, 10).toFixed(1)),
    bassBoost: Math.round(clampNumber(s.bassBoost, 0, 24)),
    eqBands: sanitizeEqBands(s.eqBands),
  };
}

export function sanitizeFirestoreSettings(
  s: VisualizerSettings
): Omit<VisualizerSettings, 'eqBands'> {
  const clean = sanitizeSettings(s);
  const { eqBands: _eq, ...firestoreFields } = clean;
  return firestoreFields;
}
