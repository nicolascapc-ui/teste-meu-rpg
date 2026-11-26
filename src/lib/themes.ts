import type { CampaignFontId, CampaignTheme, SceneEffects } from '../types/vtt';

export interface FontOption {
  id: CampaignFontId;
  name: string;
  hint: string;
  display: string;
  body: string;
}

export const CAMPAIGN_FONTS: FontOption[] = [
  {
    id: 'typewriter',
    name: 'Máquina de Escrever',
    hint: 'Clássico dossiê · Courier Prime + IBM Plex Mono',
    display: "'Courier Prime', 'Courier New', monospace",
    body: "'IBM Plex Mono', ui-monospace, monospace",
  },
  {
    id: 'noir_press',
    name: 'Arquivo Antigo',
    hint: 'Datilografia gasta · Special Elite + IBM Plex Mono',
    display: "'Special Elite', 'Courier Prime', monospace",
    body: "'IBM Plex Mono', ui-monospace, monospace",
  },
  {
    id: 'editorial',
    name: 'Editorial / Fantasia',
    hint: 'Literário clássico · Cormorant Garamond + Lora',
    display: "'Cormorant Garamond', Georgia, serif",
    body: "'Lora', Georgia, serif",
  },
  {
    id: 'modern',
    name: 'Minimalista Moderno',
    hint: 'Leitura limpa · Plus Jakarta Sans + DM Sans',
    display: "'Plus Jakarta Sans', system-ui, sans-serif",
    body: "'DM Sans', system-ui, sans-serif",
  },
  {
    id: 'terminal',
    name: 'Terminal Sci-Fi',
    hint: 'Técnico futurista · Share Tech Mono + IBM Plex Mono',
    display: "'Share Tech Mono', monospace",
    body: "'IBM Plex Mono', ui-monospace, monospace",
  },
];

export const DEFAULT_SCENE_EFFECTS: SceneEffects = {
  preset: 'clean',
  crt: 0,
  noise: 0,
  glitch: 0,
  bloodDanger: 0,
  shake: 0,
  vignette: 0,
  colorFilter: 'none',
  saturation: 100,
  contrast: 100,
};

export interface SceneFxPreset {
  id: string;
  name: string;
  description: string;
  effects: SceneEffects;
}

export const SCENE_FX_PRESETS: SceneFxPreset[] = [
  {
    id: 'clean',
    name: 'Limpo',
    description: 'Imagem original sem filtros ou overlays.',
    effects: DEFAULT_SCENE_EFFECTS,
  },
  {
    id: 'crt_monitor',
    name: 'Monitor CRT',
    description: 'Linhas de varredura, vinheta de tubo e contraste retrô.',
    effects: {
      preset: 'crt_monitor',
      crt: 75,
      noise: 18,
      glitch: 0,
      bloodDanger: 0,
      shake: 0,
      vignette: 45,
      colorFilter: 'cold',
      saturation: 92,
      contrast: 114,
    },
  },
  {
    id: 'vhs_glitch',
    name: 'Fita VHS / Glitch',
    description: 'Ruído contínuo + interferências cromáticas em loop.',
    effects: {
      preset: 'vhs_glitch',
      crt: 45,
      noise: 42,
      glitch: 72,
      bloodDanger: 0,
      shake: 12,
      vignette: 35,
      colorFilter: 'none',
      saturation: 88,
      contrast: 118,
    },
  },
  {
    id: 'blood_danger',
    name: 'Perigo / Sangue',
    description: 'Bordas carmesim pulsantes e contraste tenso de combate.',
    effects: {
      preset: 'blood_danger',
      crt: 0,
      noise: 20,
      glitch: 0,
      bloodDanger: 80,
      shake: 18,
      vignette: 38,
      colorFilter: 'high_contrast',
      saturation: 85,
      contrast: 118,
    },
  },
  {
    id: 'quake_impact',
    name: 'Terremoto / Impacto',
    description: 'Tremor constante de câmera com granulação atmosférica.',
    effects: {
      preset: 'quake_impact',
      crt: 0,
      noise: 28,
      glitch: 0,
      bloodDanger: 20,
      shake: 72,
      vignette: 30,
      colorFilter: 'warm',
      saturation: 95,
      contrast: 110,
    },
  },
  {
    id: 'noir_film',
    name: 'Noir / Película',
    description: 'Preto e branco cinematográfico com grão de filme.',
    effects: {
      preset: 'noir_film',
      crt: 0,
      noise: 34,
      glitch: 0,
      bloodDanger: 0,
      shake: 0,
      vignette: 55,
      colorFilter: 'noir',
      saturation: 15,
      contrast: 125,
    },
  },
];

export interface ThemePresetDefinition {
  id: string;
  name: string;
  description: string;
  theme: CampaignTheme;
}

export const DEFAULT_THEME: CampaignTheme = {
  preset: 'papel_tinta',
  isDark: false,
  bgCanvas: '#f6f3eb',
  bgSurface: '#fdfbf7',
  bgSubtle: '#ece7db',
  textPrimary: '#1b1917',
  textMuted: '#5e584f',
  borderColor: '#d6cfc0',
  accentColor: '#8f2d2d',
  fontFamily: 'typewriter',
  effects: DEFAULT_SCENE_EFFECTS,
};

export const THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'papel_tinta',
    name: 'Papel e Tinta',
    description: 'Creme editorial de alto contraste com selo carmim.',
    theme: DEFAULT_THEME,
  },
  {
    id: 'dossie_noturno',
    name: 'Dossiê Noturno',
    description: 'Grafite escuro confortável para sessões longas.',
    theme: {
      preset: 'dossie_noturno',
      isDark: true,
      bgCanvas: '#141413',
      bgSurface: '#1c1b19',
      bgSubtle: '#262522',
      textPrimary: '#ece8df',
      textMuted: '#a0998d',
      borderColor: '#36332e',
      accentColor: '#d99b26',
      fontFamily: 'typewriter',
      effects: DEFAULT_SCENE_EFFECTS,
    },
  },
  {
    id: 'caderno_sepia',
    name: 'Caderno Sépia',
    description: 'Pergaminho vintage com tinta escura e verde arquivo.',
    theme: {
      preset: 'caderno_sepia',
      isDark: false,
      bgCanvas: '#efe6d5',
      bgSurface: '#f7f0e2',
      bgSubtle: '#e4d7be',
      textPrimary: '#2a2017',
      textMuted: '#695847',
      borderColor: '#ccbba0',
      accentColor: '#2f5d46',
      fontFamily: 'editorial',
      effects: DEFAULT_SCENE_EFFECTS,
    },
  },
  {
    id: 'cripta_carmim',
    name: 'Cripta Carmim',
    description: 'Terror gótico escuro com realces sangue-seco.',
    theme: {
      preset: 'cripta_carmim',
      isDark: true,
      bgCanvas: '#110e10',
      bgSurface: '#1b1518',
      bgSubtle: '#271e22',
      textPrimary: '#ede4e6',
      textMuted: '#a18c92',
      borderColor: '#3c2b31',
      accentColor: '#c23645',
      fontFamily: 'noir_press',
      effects: DEFAULT_SCENE_EFFECTS,
    },
  },
  {
    id: 'fosforo_terminal',
    name: 'Fósforo Verde',
    description: 'Monitor retrô escuro com fósforo esmeralda.',
    theme: {
      preset: 'fosforo_terminal',
      isDark: true,
      bgCanvas: '#09100c',
      bgSurface: '#0f1a14',
      bgSubtle: '#16261d',
      textPrimary: '#dcfce7',
      textMuted: '#78a88b',
      borderColor: '#244030',
      accentColor: '#2ea86a',
      fontFamily: 'terminal',
      effects: DEFAULT_SCENE_EFFECTS,
    },
  },
  {
    id: 'terminal_mono',
    name: 'Terminal Monocromático',
    description: 'Preto absoluto com contraste branco puro.',
    theme: {
      preset: 'terminal_mono',
      isDark: true,
      bgCanvas: '#0c0c0c',
      bgSurface: '#151515',
      bgSubtle: '#202020',
      textPrimary: '#f4f4f4',
      textMuted: '#999999',
      borderColor: '#303030',
      accentColor: '#e5e5e5',
      fontFamily: 'terminal',
      effects: DEFAULT_SCENE_EFFECTS,
    },
  },
];

export function getContrastColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.58 ? '#141413' : '#fdfbf7';
}

export function getSceneEffects(theme?: CampaignTheme | null): SceneEffects {
  const raw = theme?.effects;
  const validFilter =
    raw?.colorFilter &&
    ['none', 'sepia', 'noir', 'cold', 'warm', 'high_contrast'].includes(raw.colorFilter)
      ? raw.colorFilter
      : 'none';
  const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  };

  return {
    preset:
      typeof raw?.preset === 'string' && raw.preset.trim()
        ? raw.preset.trim().slice(0, 40)
        : DEFAULT_SCENE_EFFECTS.preset,
    crt: clampNum(raw?.crt, 0, 100, 0),
    noise: clampNum(raw?.noise, 0, 100, 0),
    glitch: clampNum(raw?.glitch, 0, 100, 0),
    bloodDanger: clampNum(raw?.bloodDanger, 0, 100, 0),
    shake: clampNum(raw?.shake, 0, 100, 0),
    vignette: clampNum(raw?.vignette, 0, 100, 0),
    colorFilter: validFilter,
    saturation: clampNum(raw?.saturation, 0, 200, 100),
    contrast: clampNum(raw?.contrast, 50, 180, 100),
  };
}

export function sanitizeTheme(theme?: Partial<CampaignTheme> | null): CampaignTheme {
  const safeColor = (val: unknown, fallback: string) =>
    typeof val === 'string' && val.trim().length >= 4 && val.trim().length <= 32
      ? val.trim()
      : fallback;

  const validFont =
    theme?.fontFamily && CAMPAIGN_FONTS.some((f) => f.id === theme.fontFamily)
      ? theme.fontFamily
      : 'typewriter';

  return {
    preset:
      typeof theme?.preset === 'string' && theme.preset.trim()
        ? theme.preset.trim().slice(0, 40)
        : DEFAULT_THEME.preset,
    isDark: Boolean(theme?.isDark),
    bgCanvas: safeColor(theme?.bgCanvas, DEFAULT_THEME.bgCanvas),
    bgSurface: safeColor(theme?.bgSurface, DEFAULT_THEME.bgSurface),
    bgSubtle: safeColor(theme?.bgSubtle, DEFAULT_THEME.bgSubtle),
    textPrimary: safeColor(theme?.textPrimary, DEFAULT_THEME.textPrimary),
    textMuted: safeColor(theme?.textMuted, DEFAULT_THEME.textMuted),
    borderColor: safeColor(theme?.borderColor, DEFAULT_THEME.borderColor),
    accentColor: safeColor(theme?.accentColor, DEFAULT_THEME.accentColor),
    fontFamily: validFont,
    effects: getSceneEffects(theme as CampaignTheme),
  };
}

export function applyCampaignTheme(rawTheme: CampaignTheme) {
  const theme = sanitizeTheme(rawTheme);
  const root = document.documentElement;
  root.style.setProperty('--bg-canvas', theme.bgCanvas);
  root.style.setProperty('--bg-surface', theme.bgSurface);
  root.style.setProperty('--bg-subtle', theme.bgSubtle);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-muted', theme.textMuted);
  root.style.setProperty('--border-hairline', theme.borderColor);
  root.style.setProperty('--accent-primary', theme.accentColor);
  root.style.setProperty('--accent-contrast', getContrastColor(theme.accentColor));

  const fontDef =
    CAMPAIGN_FONTS.find((f) => f.id === (theme.fontFamily || 'typewriter')) || CAMPAIGN_FONTS[0];
  root.style.setProperty('--font-display', fontDef.display);
  root.style.setProperty('--font-body', fontDef.body);

  if (theme.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
