import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Flame,
  HeartPulse,
  LayoutTemplate,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import type { DuelExtraSettings, DuelLayoutStyle } from '../types/vtt';

interface DuelExtraSettingsDrawerProps {
  open: boolean;
  settings: DuelExtraSettings;
  onChange: (next: DuelExtraSettings) => void;
  onClose: () => void;
}

const RESOURCE_LABEL_PRESETS = ['MP', 'PE', 'Sanidade', 'Energia', 'Estamina', 'Foco'];

const LAYOUT_STYLES: Array<{
  id: DuelLayoutStyle;
  title: string;
  subtitle: string;
  previewBadge: string;
}> = [
  {
    id: 'minimal',
    title: 'Minimalista',
    subtitle: 'Layout limpo e direto ao ponto, seguindo o padrão clássico da mesa.',
    previewBadge: 'Padrão',
  },
  {
    id: 'medieval',
    title: 'Medieval · Pergaminho',
    subtitle: 'Ícones em placas de papel, tipografia serifada elegante e contraste inspirado em Elder Scrolls.',
    previewBadge: 'Fantasia',
  },
  {
    id: 'stylized',
    title: 'Estilizado · Ação Pop',
    subtitle: 'Painéis diagonais de alto contraste, sombras gráficas e energia inspirada em Persona e Jet Set Radio.',
    previewBadge: 'Ação',
  },
];

export function DuelExtraSettingsDrawer({
  open,
  settings,
  onChange,
  onClose,
}: DuelExtraSettingsDrawerProps) {
  const [secThemeOpen, setSecThemeOpen] = useState(true);
  const [secComboMouseOpen, setSecComboMouseOpen] = useState(true);
  const [secSystemOpen, setSecSystemOpen] = useState(true);

  if (!open) return null;

  const update = (patch: Partial<DuelExtraSettings>) => {
    onChange({
      ...settings,
      ...patch,
    });
  };

  return (
    <aside
      data-gm-ui="true"
      className="absolute top-12 right-3 bottom-3 z-50 w-[min(360px,92vw)] bg-stone-950/96 border border-stone-700/90 text-stone-100 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between gap-2 bg-stone-900/80">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
          <div className="min-w-0">
            <h3 className="text-xs font-bold font-typewriter tracking-wide truncate">
              Configurações Extras do Duelo
            </h3>
            <p className="text-[10px] text-stone-400 truncate">
              Visual, combos e módulos de sistema sincronizados
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-stone-400 hover:text-white hover:bg-stone-800 transition-colors shrink-0"
          aria-label="Fechar configurações extras"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-stone-800 text-xs">
        {/* SECTION 1: DUEL LAYOUT THEME (3 STYLES MATCHED TO CAMPAIGN THEME) */}
        <div>
          <button
            type="button"
            onClick={() => setSecThemeOpen((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-stone-900/70 text-left transition-colors"
          >
            <span className="flex items-center gap-2 font-bold font-typewriter text-stone-100">
              <LayoutTemplate className="w-3.5 h-3.5 text-amber-400" />
              1. Tema e Layout do Duelo
            </span>
            {secThemeOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
            )}
          </button>

          {secThemeOpen && (
            <div className="px-4 pb-3.5 pt-1 space-y-2">
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Transforma a disposição visual e tipografia da arena mantendo harmonia com as cores da campanha.
              </p>

              <div className="space-y-2">
                {LAYOUT_STYLES.map((opt) => {
                  const active = settings.layoutStyle === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => update({ layoutStyle: opt.id })}
                      className={`w-full text-left p-2.5 border transition-all space-y-1 ${
                        active
                          ? 'bg-stone-900 border-amber-400 shadow-md'
                          : 'bg-stone-950/80 border-stone-800 hover:border-stone-600'
                      }`}
                      style={
                        active
                          ? { borderColor: 'var(--accent-primary)' }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-bold ${
                            opt.id === 'medieval'
                              ? 'font-duel-medieval-display text-sm tracking-wide'
                              : opt.id === 'stylized'
                                ? 'font-duel-stylized-display italic uppercase tracking-tight'
                                : 'font-typewriter'
                          }`}
                        >
                          {opt.title}
                        </span>
                        <span
                          className={`text-[10px] font-medium ${
                            active ? 'text-amber-300' : 'text-stone-500'
                          }`}
                        >
                          {active ? 'Ativo' : opt.previewBadge}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 leading-snug">
                        {opt.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* SECTION 2: HACK-AND-SLASH COMBOS & MOUSE ATTACK DAMAGE */}
        <div>
          <button
            type="button"
            onClick={() => setSecComboMouseOpen((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-stone-900/70 text-left transition-colors"
          >
            <span className="flex items-center gap-2 font-bold font-typewriter text-stone-100">
              <Flame className="w-3.5 h-3.5 text-orange-400" />
              2. Combos e Dano do Mouse
            </span>
            {secComboMouseOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
            )}
          </button>

          {secComboMouseOpen && (
            <div className="px-4 pb-3.5 pt-1 space-y-3">
              {/* Hack-and-slash fiery combo toggle */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2.5 border border-stone-800 bg-stone-900/60 hover:border-stone-700">
                <input
                  type="checkbox"
                  checked={settings.comboEnabled}
                  onChange={(e) => update({ comboEnabled: e.target.checked })}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold text-stone-100">
                    Indicador de Combos em Chamas
                  </span>
                  <span className="block text-[11px] text-stone-400 leading-snug">
                    Múltiplos ataques com o mouse multiplicam o combo em frente ao alvo, acendem chamas e sincronizam com os jogadores (reseta após 4s).
                  </span>
                </span>
              </label>

              {/* Editable mouse-click HP damage */}
              <div className="p-2.5 border border-stone-800 bg-stone-900/60 space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.mouseAttackDamageEnabled}
                    onChange={(e) =>
                      update({ mouseAttackDamageEnabled: e.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="flex items-center gap-1.5 font-semibold text-stone-100">
                      <Swords className="w-3 h-3 text-red-400" />
                      Tirar vida ao atacar com o mouse
                    </span>
                    <span className="block text-[11px] text-stone-400 leading-snug">
                      Cada corte ou clique de ataque sobre o token desconta automaticamente o valor definido abaixo.
                    </span>
                  </span>
                </label>

                <div
                  className={`flex items-center justify-between gap-2 pt-2 border-t border-stone-800 ${
                    settings.mouseAttackDamageEnabled ? '' : 'opacity-45 pointer-events-none'
                  }`}
                >
                  <span className="text-[11px] text-stone-300 font-medium">
                    Dano por acerto (PV):
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          mouseAttackDamage: Math.max(1, settings.mouseAttackDamage - 1),
                        })
                      }
                      className="w-7 h-7 bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold text-stone-100"
                      aria-label="Diminuir dano por ataque"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={settings.mouseAttackDamage}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1)));
                        update({ mouseAttackDamage: val });
                      }}
                      className="w-14 h-7 px-1.5 text-center bg-stone-950 border border-stone-700 text-red-300 font-bold tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          mouseAttackDamage: Math.min(999, settings.mouseAttackDamage + 1),
                        })
                      }
                      className="w-7 h-7 bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold text-stone-100"
                      aria-label="Aumentar dano por ataque"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3: OPTIONAL RPG SYSTEM MODULES */}
        <div>
          <button
            type="button"
            onClick={() => setSecSystemOpen((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-stone-900/70 text-left transition-colors"
          >
            <span className="flex items-center gap-2 font-bold font-typewriter text-stone-100">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              3. Módulos Extras de Sistema
            </span>
            {secSystemOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
            )}
          </button>

          {secSystemOpen && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              {/* Secondary resource bar (MP / Sanidade / Energia / PE) */}
              <div className="p-2.5 border border-stone-800 bg-stone-900/60 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showSecondaryResource}
                    onChange={(e) =>
                      update({ showSecondaryResource: e.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="flex items-center gap-1.5 font-semibold text-stone-100">
                      <HeartPulse className="w-3 h-3 text-sky-400" />
                      Barra de Recurso Secundário
                    </span>
                    <span className="block text-[11px] text-stone-400 leading-snug">
                      Exibe uma segunda barra editável nos combatentes para Mana, Sanidade, PE ou Energia.
                    </span>
                  </span>
                </label>

                {settings.showSecondaryResource && (
                  <div className="pt-2 border-t border-stone-800 space-y-1.5">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-stone-400">Nome do recurso:</span>
                      <input
                        type="text"
                        maxLength={16}
                        value={settings.secondaryResourceLabel}
                        onChange={(e) =>
                          update({ secondaryResourceLabel: e.target.value })
                        }
                        placeholder="MP, PE, Sanidade..."
                        className="w-32 px-2 py-1 bg-stone-950 border border-stone-700 text-stone-100 text-[11px]"
                      />
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {RESOURCE_LABEL_PRESETS.map((presetLabel) => (
                        <button
                          key={presetLabel}
                          type="button"
                          onClick={() =>
                            update({ secondaryResourceLabel: presetLabel })
                          }
                          className={`px-2 py-0.5 text-[10px] border transition-colors ${
                            settings.secondaryResourceLabel === presetLabel
                              ? 'bg-sky-900/80 border-sky-500 text-sky-100 font-semibold'
                              : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          {presetLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Status & condition tags */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2.5 border border-stone-800 bg-stone-900/60 hover:border-stone-700">
                <input
                  type="checkbox"
                  checked={settings.showStatusTags}
                  onChange={(e) => update({ showStatusTags: e.target.checked })}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="flex items-center gap-1.5 font-semibold text-stone-100">
                    <ShieldAlert className="w-3 h-3 text-amber-400" />
                    Tags de Condições e Status
                  </span>
                  <span className="block text-[11px] text-stone-400 leading-snug">
                    Adicione rapidamente estados como Queimando, Atordoado, Sangrando, Protegido ou rótulos livres em cada combatente.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
