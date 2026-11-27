import { Flame } from 'lucide-react';
import type { DuelLayoutStyle } from '../types/vtt';

interface DuelComboPopProps {
  comboCount: number;
  hitKey: string;
  layoutStyle: DuelLayoutStyle;
  damageApplied?: number;
  showDamageNumber: boolean;
  side: 'player' | 'npc';
}

function getComboRank(count: number): {
  label: string;
  medievalLabel: string;
  heatLevel: 0 | 1 | 2 | 3;
} {
  if (count >= 10) {
    return { label: 'IMPARÁVEL!!', medievalLabel: 'FÚRIA ARDENTE', heatLevel: 3 };
  }
  if (count >= 7) {
    return { label: 'BRUTAL!', medievalLabel: 'CHAMAS VIVAS', heatLevel: 2 };
  }
  if (count >= 4) {
    return { label: 'EM CHAMAS!', medievalLabel: 'GOLPE CONTÍNUO', heatLevel: 1 };
  }
  return { label: 'COMBO', medievalLabel: 'SEQUÊNCIA', heatLevel: 0 };
}

export function DuelComboPop({
  comboCount,
  hitKey,
  layoutStyle,
  damageApplied,
  showDamageNumber,
  side,
}: DuelComboPopProps) {
  if (comboCount < 2) return null;

  const { label, medievalLabel, heatLevel } = getComboRank(comboCount);
  const scaleBoost = Math.min(1.32, 1 + Math.max(0, comboCount - 2) * 0.045);
  const positionClass =
    side === 'npc'
      ? '-left-14 top-4'
      : '-right-14 top-4';

  // Animated rising SVG flames behind the combo counter when heatLevel >= 1 (4+ hits)
  const renderFlames = (styleMode: DuelLayoutStyle) => {
    if (heatLevel === 0) return null;

    const primaryFlame =
      heatLevel >= 3 ? '#fef08a' : heatLevel === 2 ? '#fb923c' : '#f97316';
    const outerFlame =
      heatLevel >= 3 ? '#dc2626' : heatLevel === 2 ? '#ea580c' : '#b91c1c';

    return (
      <div
        className={`absolute inset-x-0 -top-10 -bottom-3 pointer-events-none flex items-end justify-center ${
          heatLevel >= 3 ? 'duel-flame-overdrive' : 'duel-flame-flicker'
        }`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 160 130"
          className="w-40 h-32 overflow-visible"
          style={{
            filter:
              styleMode === 'stylized'
                ? 'drop-shadow(3px 3px 0 #09090b)'
                : `drop-shadow(0 0 ${heatLevel >= 3 ? 22 : 12}px rgba(249, 115, 22, 0.85))`,
          }}
        >
          {/* Outer roaring fire tongues */}
          <path
            d="M80 6 C92 34, 126 30, 120 66 C138 56, 146 78, 132 104 C118 122, 42 122, 28 104 C14 78, 22 56, 40 66 C34 30, 68 34, 80 6 Z"
            fill={outerFlame}
            opacity={styleMode === 'minimal' ? 0.52 : 0.88}
            stroke={styleMode === 'stylized' ? '#09090b' : 'none'}
            strokeWidth={styleMode === 'stylized' ? 4 : 0}
          />
          {/* Inner hot core */}
          <path
            d="M80 28 C90 48, 110 52, 106 78 C116 74, 118 92, 108 106 C96 116, 64 116, 52 106 C42 92, 44 74, 54 78 C50 52, 70 48, 80 28 Z"
            fill={primaryFlame}
            opacity={styleMode === 'minimal' ? 0.65 : 0.94}
          />
        </svg>

        {/* Rising ember sparks */}
        {heatLevel >= 2 && (
          <>
            <span
              className="duel-ember-rise absolute left-4 bottom-8 w-2 h-2 rounded-full bg-amber-300"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="duel-ember-rise absolute right-5 bottom-10 w-1.5 h-1.5 rounded-full bg-orange-400"
              style={{ animationDelay: '240ms' }}
            />
            <span
              className="duel-ember-rise absolute left-1/2 bottom-12 w-2 h-2 rounded-full bg-yellow-200"
              style={{ animationDelay: '460ms' }}
            />
          </>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // STYLE 3: ESTILIZADO (Persona / Sunset Overdrive / Jet Set Radio)
  // ---------------------------------------------------------------------------
  if (layoutStyle === 'stylized') {
    return (
      <div
        key={hitKey}
        className={`absolute ${positionClass} z-40 pointer-events-none select-none`}
        style={{ transform: `scale(${scaleBoost})` }}
      >
        <div className="duel-combo-pop relative flex flex-col items-center">
          {renderFlames('stylized')}

          {/* Jagged halftone graphic starburst card */}
          <div
            className="relative px-4 py-2 border-[3px] border-stone-950 duel-stylized-halftone"
            style={{
              backgroundColor:
                heatLevel >= 2 ? '#f97316' : 'var(--accent-primary)',
              color: heatLevel >= 2 ? '#09090b' : 'var(--accent-contrast)',
              transform: 'skewX(-14deg) rotate(-5deg)',
              boxShadow: '6px 6px 0 #09090b, -3px -3px 0 #fafaf9',
            }}
          >
            <div
              className="flex items-baseline gap-1.5 font-duel-stylized-display"
              style={{ transform: 'skewX(8deg)' }}
            >
              <span
                className="text-5xl font-black italic tracking-tighter leading-none tabular-nums"
                style={{
                  textShadow: '3px 3px 0 #09090b',
                  color: '#ffffff',
                  WebkitTextStroke: '2px #09090b',
                }}
              >
                {comboCount}
              </span>
              <span
                className="text-lg font-black italic uppercase tracking-tight leading-none"
                style={{
                  color: '#fef08a',
                  textShadow: '2px 2px 0 #09090b',
                }}
              >
                HIT!
              </span>
            </div>
          </div>

          {/* Graphic rank banner underneath */}
          <div
            className="relative -mt-1.5 px-3 py-0.5 bg-stone-950 text-white border-2 border-white flex items-center gap-1 font-duel-stylized-display text-[11px] font-black italic uppercase tracking-wider"
            style={{
              transform: 'skewX(-12deg) rotate(-2deg)',
              boxShadow: '3px 3px 0 var(--accent-primary)',
            }}
          >
            {heatLevel >= 1 && <Flame className="w-3.5 h-3.5 text-orange-400 fill-orange-500" />}
            <span>{label}</span>
            {showDamageNumber && damageApplied && damageApplied > 0 && (
              <span className="ml-1 text-red-400 tabular-nums">-{damageApplied} PV</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // STYLE 2: MEDIEVAL (Elder Scrolls Parchment Seal & Heraldic Torchlight)
  // ---------------------------------------------------------------------------
  if (layoutStyle === 'medieval') {
    return (
      <div
        key={hitKey}
        className={`absolute ${positionClass} z-40 pointer-events-none select-none`}
        style={{ transform: `scale(${scaleBoost})` }}
      >
        <div className="duel-combo-pop relative flex flex-col items-center">
          {renderFlames('medieval')}

          {/* Crafted parchment paper plaque with filigree corners */}
          <div
            className="relative duel-medieval-parchment-card px-4 py-2 min-w-[116px] text-center"
            style={{
              borderColor: heatLevel >= 2 ? '#c2410c' : 'var(--accent-primary)',
              boxShadow:
                heatLevel >= 1
                  ? '0 0 22px rgba(234, 88, 12, 0.72), 0 8px 20px rgba(0,0,0,0.75)'
                  : '0 8px 20px rgba(0,0,0,0.75)',
            }}
          >
            {/* Ornamental corner ticks */}
            <span className="absolute top-1 left-1 w-2 h-2 border-t border-l border-amber-900/70" />
            <span className="absolute top-1 right-1 w-2 h-2 border-t border-r border-amber-900/70" />
            <span className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-amber-900/70" />
            <span className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-amber-900/70" />

            <div className="flex items-baseline justify-center gap-1 font-duel-medieval-display">
              <span
                className="text-4xl font-bold leading-none tabular-nums"
                style={{
                  color: heatLevel >= 2 ? '#9a3412' : '#231912',
                }}
              >
                {comboCount}×
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-amber-950/85">
                Golpes
              </span>
            </div>

            <div className="mt-1 pt-0.5 border-t border-amber-900/35 flex items-center justify-center gap-1 text-[10px] font-duel-medieval-body font-semibold tracking-wider uppercase text-amber-950">
              {heatLevel >= 1 && <Flame className="w-3 h-3 text-orange-700 fill-orange-500" />}
              <span>{medievalLabel}</span>
            </div>

            {showDamageNumber && damageApplied && damageApplied > 0 && (
              <div className="text-[10px] font-bold text-red-900 tabular-nums mt-0.5">
                -{damageApplied} PV
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // STYLE 1: MINIMALISTA (Clean Editorial Counter + Controlled Flame Halo)
  // ---------------------------------------------------------------------------
  return (
    <div
      key={hitKey}
      className={`absolute ${positionClass} z-40 pointer-events-none select-none`}
      style={{ transform: `scale(${scaleBoost})` }}
    >
      <div className="duel-combo-pop relative flex flex-col items-center">
        {renderFlames('minimal')}

        <div
          className="relative px-3.5 py-2 bg-stone-950/92 border text-center min-w-[104px] shadow-2xl"
          style={{
            borderColor:
              heatLevel >= 2
                ? '#f97316'
                : heatLevel === 1
                  ? '#fb923c'
                  : 'var(--accent-primary)',
            boxShadow:
              heatLevel >= 1
                ? '0 0 24px rgba(249, 115, 22, 0.5), 0 12px 24px rgba(0,0,0,0.85)'
                : '0 12px 24px rgba(0,0,0,0.85)',
          }}
        >
          <div className="flex items-baseline justify-center gap-1 font-typewriter">
            <span
              className="text-3xl font-bold leading-none tabular-nums"
              style={{
                color: heatLevel >= 2 ? '#fdba74' : '#fafaf9',
              }}
            >
              {comboCount}×
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-stone-400">
              Combo
            </span>
          </div>

          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-medium tracking-wider uppercase text-amber-300">
            {heatLevel >= 1 && <Flame className="w-3 h-3 text-orange-400 fill-orange-500" />}
            <span>{heatLevel >= 1 ? label : 'Sequência'}</span>
            {showDamageNumber && damageApplied && damageApplied > 0 && (
              <span className="text-red-400 tabular-nums ml-1">· -{damageApplied} PV</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
