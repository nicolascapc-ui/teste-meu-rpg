import { useState } from 'react';
import {
  Activity,
  Palette,
  RotateCcw,
  Sliders,
  Sparkles,
  Type,
  Zap,
} from 'lucide-react';
import type {
  CampaignFontId,
  CampaignTheme,
  ColorFilterPreset,
  SceneEffects,
} from '../types/vtt';
import {
  CAMPAIGN_FONTS,
  DEFAULT_SCENE_EFFECTS,
  getSceneEffects,
  SCENE_FX_PRESETS,
  THEME_PRESETS,
} from '../lib/themes';

interface ThemePanelProps {
  theme: CampaignTheme;
  onChangeTheme: (theme: CampaignTheme) => void;
  onTriggerShakePulse?: () => void;
}

const COLOR_FILTERS: Array<{ id: ColorFilterPreset; label: string }> = [
  { id: 'none', label: 'Original' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'noir', label: 'Noir (P&B)' },
  { id: 'cold', label: 'Frio / Noturno' },
  { id: 'warm', label: 'Quente / Tocha' },
  { id: 'high_contrast', label: 'Alto Contraste' },
];

export function ThemePanel({
  theme,
  onChangeTheme,
  onTriggerShakePulse,
}: ThemePanelProps) {
  const [tab, setTab] = useState<'look' | 'presets' | 'manual'>('look');
  const effects = getSceneEffects(theme);

  function updateField<K extends keyof CampaignTheme>(key: K, val: CampaignTheme[K]) {
    onChangeTheme({
      ...theme,
      preset: key === 'fontFamily' || key === 'effects' ? theme.preset : 'custom',
      [key]: val,
    });
  }

  function updateFont(fontFamily: CampaignFontId) {
    onChangeTheme({
      ...theme,
      fontFamily,
    });
  }

  function applyPalettePreset(presetTheme: CampaignTheme) {
    // Keep current scene FX when swapping color palette
    onChangeTheme({
      ...presetTheme,
      effects,
    });
  }

  function updateEffects(patch: Partial<SceneEffects>, presetName = 'custom') {
    onChangeTheme({
      ...theme,
      effects: {
        ...effects,
        ...patch,
        preset: presetName,
      },
    });
  }

  const activeFxCount = [
    effects.crt > 0,
    effects.noise > 0,
    effects.glitch > 0,
    effects.bloodDanger > 0,
    effects.shake > 0,
    effects.vignette > 0,
    effects.colorFilter !== 'none',
    effects.saturation !== 100,
    effects.contrast !== 100,
  ].filter(Boolean).length;

  return (
    <div className="h-full flex flex-col">
      {/* 3-Tab Intuitive Customization Studio */}
      <div className="p-3 border-b vtt-border flex items-center gap-1 vtt-subtle">
        {(
          [
            ['look', 'Cores & Fonte', Palette],
            ['presets', 'FX Presets', Sparkles],
            ['manual', 'FX Manual', Sliders],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 py-2 px-1.5 text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
              tab === id ? 'vtt-accent-btn' : 'vtt-muted hover:opacity-100'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* TAB 1: COLORS & FONTS */}
        {tab === 'look' && (
          <>
            {/* Font Picker with Live Typographic Preview */}
            <section className="space-y-2.5">
              <div className="flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 vtt-accent-text" />
                <p className="text-xs font-semibold">Tipografia da Campanha</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {CAMPAIGN_FONTS.map((font) => {
                  const active = (theme.fontFamily || 'typewriter') === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => updateFont(font.id)}
                      className={`p-3 border text-left transition-colors ${
                        active ? 'vtt-subtle border-current ring-1' : 'vtt-canvas vtt-border hover:vtt-subtle'
                      }`}
                    >
                      <p
                        className="text-sm font-bold leading-snug"
                        style={{ fontFamily: font.display }}
                      >
                        {font.name}
                      </p>
                      <p
                        className="text-[11px] vtt-muted mt-0.5"
                        style={{ fontFamily: font.body }}
                      >
                        {font.hint}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Color Palettes */}
            <section className="space-y-2.5 border-t vtt-border pt-4">
              <p className="text-xs font-semibold">Paletas de Cores</p>
              <div className="grid grid-cols-1 gap-2">
                {THEME_PRESETS.map((preset) => {
                  const active = theme.preset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPalettePreset(preset.theme)}
                      className={`p-3 border text-left transition-all ${
                        active ? 'ring-2' : ''
                      }`}
                      style={{
                        backgroundColor: preset.theme.bgSurface,
                        color: preset.theme.textPrimary,
                        borderColor: active ? preset.theme.accentColor : preset.theme.borderColor,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold font-typewriter">{preset.name}</span>
                        <div className="flex items-center gap-1">
                          <span
                            className="w-4 h-4 border"
                            style={{
                              backgroundColor: preset.theme.bgCanvas,
                              borderColor: preset.theme.borderColor,
                            }}
                          />
                          <span
                            className="w-4 h-4 border"
                            style={{
                              backgroundColor: preset.theme.textPrimary,
                              borderColor: preset.theme.borderColor,
                            }}
                          />
                          <span
                            className="w-4 h-4 border"
                            style={{
                              backgroundColor: preset.theme.accentColor,
                              borderColor: preset.theme.borderColor,
                            }}
                          />
                        </div>
                      </div>
                      <p className="text-[11px] mt-1 opacity-75">{preset.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Manual Color Pickers (Progressive Disclosure) */}
            <details className="group border-t vtt-border pt-4">
              <summary className="list-none cursor-pointer flex items-center justify-between text-xs font-semibold select-none">
                <span>Ajuste fino de cores (7 variáveis)</span>
                <span className="text-[11px] vtt-muted group-open:rotate-180 transition-transform">
                  ▾
                </span>
              </summary>

              <div className="space-y-3 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] vtt-muted">Contraste base da interface</span>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={theme.isDark}
                      onChange={(e) => updateField('isDark', e.target.checked)}
                    />
                    <span>Modo escuro</span>
                  </label>
                </div>

                <div className="space-y-1.5">
                  {(
                    [
                      ['bgCanvas', 'Fundo principal'],
                      ['bgSurface', 'Painéis e cartões'],
                      ['bgSubtle', 'Fundo secundário'],
                      ['textPrimary', 'Texto principal'],
                      ['textMuted', 'Texto secundário'],
                      ['borderColor', 'Linhas e bordas'],
                      ['accentColor', 'Cor de acento (botões)'],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center justify-between gap-3 text-xs border vtt-border px-2.5 py-1.5 vtt-canvas"
                    >
                      <span>{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] vtt-muted uppercase tabular-nums">
                          {theme[field]}
                        </span>
                        <input
                          type="color"
                          value={theme[field]}
                          onChange={(e) => updateField(field, e.target.value)}
                          className="w-6 h-6 border-0 bg-transparent cursor-pointer"
                        />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </>
        )}

        {/* TAB 2: SCENE FX PRESETS + 1-CLICK IMPACT */}
        {tab === 'presets' && (
          <>
            <div className="space-y-1.5 border-b vtt-border pb-3">
              <p className="text-xs font-bold font-typewriter">Efeitos Visuais da Cena & Duelo 3D</p>
              <p className="text-[11px] vtt-muted leading-relaxed">
                Atmosferas (CRT, Ruído, Glitch, Vinheta e Filtros) aplicadas ao mapa e também à Arena de Duelo 3D.
              </p>
            </div>

            {onTriggerShakePulse && (
              <button
                type="button"
                onClick={onTriggerShakePulse}
                className="w-full py-3 px-4 text-xs font-bold vtt-accent-btn flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Zap className="w-4 h-4" />
                Disparar Tremor de Impacto Agora (TV + Mesa)
              </button>
            )}

            <div className="grid grid-cols-1 gap-2.5">
              {SCENE_FX_PRESETS.map((preset) => {
                const isActive = effects.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => updateEffects(preset.effects, preset.id)}
                    className={`p-3.5 border text-left transition-colors ${
                      isActive
                        ? 'vtt-subtle border-current ring-1'
                        : 'vtt-canvas vtt-border hover:vtt-subtle'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold font-typewriter">{preset.name}</span>
                      {isActive && (
                        <span className="text-[11px] font-semibold vtt-accent-text">Ativo</span>
                      )}
                    </div>
                    <p className="text-[11px] vtt-muted mt-1 leading-relaxed">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setTab('manual')}
              className="w-full py-2.5 text-xs font-semibold border vtt-border vtt-surface flex items-center justify-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              Ajustar intensidades manualmente ({activeFxCount} ativos)
            </button>
          </>
        )}

        {/* TAB 3: MANUAL SCENE FX SLIDERS */}
        {tab === 'manual' && (
          <>
            <div className="flex items-center justify-between gap-2 border-b vtt-border pb-3">
              <div>
                <p className="text-xs font-bold font-typewriter">Controle Manual de FX</p>
                <p className="text-[11px] vtt-muted">Combine qualquer efeito em loop</p>
              </div>
              <button
                type="button"
                onClick={() => updateEffects(DEFAULT_SCENE_EFFECTS, 'clean')}
                className="px-2.5 py-1.5 text-xs border vtt-border vtt-surface flex items-center gap-1 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                Limpar FX
              </button>
            </div>

            {onTriggerShakePulse && (
              <button
                type="button"
                onClick={onTriggerShakePulse}
                className="w-full py-2.5 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-1.5"
              >
                <Activity className="w-3.5 h-3.5" />
                Pulso de Tremor (Explosão / Golpe)
              </button>
            )}

            {/* Color Filter Selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold">Filtro de Cor da Cena</p>
              <div className="grid grid-cols-2 gap-1.5">
                {COLOR_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => updateEffects({ colorFilter: f.id })}
                    className={`py-2 px-2 text-xs border text-center ${
                      effects.colorFilter === f.id
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-canvas vtt-border vtt-muted'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders for all looping overlays & camera FX */}
            <div className="space-y-3.5 border-t vtt-border pt-4">
              {(
                [
                  ['crt', 'Tela CRT (Linhas de varredura)', 0, 100, '%'],
                  ['noise', 'Ruído / Granulação (Loop)', 0, 100, '%'],
                  ['glitch', 'Glitch / Interferência (Loop)', 0, 100, '%'],
                  ['bloodDanger', 'Sangue / Alerta de Perigo (Pulsante)', 0, 100, '%'],
                  ['shake', 'Tremor de Câmera (Contínuo)', 0, 100, '%'],
                  ['vignette', 'Vinheta Escura nas Bordas', 0, 100, '%'],
                  ['saturation', 'Saturação de Cor', 0, 200, '%'],
                  ['contrast', 'Contraste da Cena', 50, 180, '%'],
                ] as const
              ).map(([key, label, min, max, unit]) => (
                <label key={key} className="block space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{label}</span>
                    <span className="text-[11px] vtt-muted tabular-nums">
                      {effects[key]}
                      {unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={2}
                    value={effects[key]}
                    onChange={(e) => updateEffects({ [key]: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
