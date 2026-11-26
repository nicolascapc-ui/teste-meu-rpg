import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { RollOutcome } from '../types/vtt';

export interface ActiveDiceAnimation {
  id: string;
  rollerName: string;
  label: string;
  formula: string;
  total: number;
  summary: string;
  outcome: RollOutcome;
}

interface DiceRollOverlayProps {
  roll: ActiveDiceAnimation | null;
  onComplete: () => void;
  position?: 'center' | 'bottom-right';
}

function detectDieSides(formula: string): number {
  const m = formula.match(/d(\d+)/i);
  if (!m) return 20;
  const s = Number(m[1]);
  return s >= 2 && s <= 1000 ? s : 20;
}

export function DiceRollOverlay({
  roll,
  onComplete,
  position = 'bottom-right',
}: DiceRollOverlayProps) {
  const [phase, setPhase] = useState<'rolling' | 'settled'>('rolling');
  const [displayNum, setDisplayNum] = useState<number>(1);

  useEffect(() => {
    if (!roll) return;
    setPhase('rolling');

    const sides = detectDieSides(roll.formula);
    const interval = window.setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * sides) + 1);
    }, 52);

    const settleTimer = window.setTimeout(() => {
      window.clearInterval(interval);
      setDisplayNum(roll.total);
      setPhase('settled');
    }, 560);

    const dismissTimer = window.setTimeout(() => {
      onComplete();
    }, 2800);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(settleTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [roll, onComplete]);

  const outcomeTone =
    roll?.outcome === 'crit'
      ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/60'
      : roll?.outcome === 'fumble'
      ? 'text-red-600 dark:text-red-400 border-red-500/60'
      : roll?.outcome === 'success'
      ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40'
      : 'vtt-accent-text vtt-border';

  const containerPos =
    position === 'center'
      ? 'fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4'
      : 'fixed bottom-6 right-6 z-50 pointer-events-none';

  return (
    <AnimatePresence>
      {roll && (
        <div className={containerPos}>
          <motion.button
            type="button"
            onClick={onComplete}
            initial={{ opacity: 0, scale: 0.72, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 10 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            className={`pointer-events-auto vtt-surface border shadow-2xl rounded-xl px-5 py-4 flex items-center gap-4 text-left max-w-sm ${
              phase === 'settled' ? outcomeTone : 'vtt-border'
            }`}
            title="Clique para fechar"
          >
            {/* Tumbling Polyhedron SVG */}
            <motion.div
              key={`${roll.id}-${phase}`}
              animate={
                phase === 'rolling'
                  ? {
                      rotate: [0, 125, 260, 390, 540],
                      scale: [0.92, 1.12, 0.95, 1.08, 1],
                      y: [0, -6, 2, -4, 0],
                    }
                  : {
                      rotate: 0,
                      scale: [1.18, 1],
                      y: 0,
                    }
              }
              transition={
                phase === 'rolling'
                  ? { duration: 0.56, ease: 'easeInOut' }
                  : { type: 'spring', stiffness: 420, damping: 20 }
              }
              className="relative w-16 h-16 shrink-0 flex items-center justify-center"
            >
              <svg
                viewBox="0 0 100 100"
                className="w-full h-full drop-shadow-sm"
                aria-hidden="true"
              >
                <polygon
                  points="50,4 94,28 94,72 50,96 6,72 6,28"
                  fill="var(--bg-subtle)"
                  stroke={
                    phase === 'settled' && roll.outcome === 'crit'
                      ? '#10b981'
                      : phase === 'settled' && roll.outcome === 'fumble'
                      ? '#ef4444'
                      : 'var(--accent-primary)'
                  }
                  strokeWidth="3.5"
                />
                <polygon
                  points="50,16 82,34 82,66 50,84 18,66 18,34"
                  fill="none"
                  stroke="var(--border-hairline)"
                  strokeWidth="1.5"
                />
                <line x1="50" y1="4" x2="50" y2="16" stroke="var(--border-hairline)" strokeWidth="1.5" />
                <line x1="94" y1="28" x2="82" y2="34" stroke="var(--border-hairline)" strokeWidth="1.5" />
                <line x1="94" y1="72" x2="82" y2="66" stroke="var(--border-hairline)" strokeWidth="1.5" />
                <line x1="50" y1="96" x2="50" y2="84" stroke="var(--border-hairline)" strokeWidth="1.5" />
                <line x1="6" y1="72" x2="18" y2="66" stroke="var(--border-hairline)" strokeWidth="1.5" />
                <line x1="6" y1="28" x2="18" y2="34" stroke="var(--border-hairline)" strokeWidth="1.5" />
              </svg>

              <span
                className={`absolute inset-0 flex items-center justify-center font-typewriter font-bold tabular-nums ${
                  String(displayNum).length >= 3 ? 'text-lg' : 'text-2xl'
                } ${
                  phase === 'settled' && roll.outcome === 'crit'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : phase === 'settled' && roll.outcome === 'fumble'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {displayNum}
              </span>
            </motion.div>

            {/* Result Details */}
            <div className="min-w-0">
              <div className="text-[11px] vtt-muted truncate">
                {roll.rollerName} · <span className="font-mono">{roll.formula}</span>
              </div>
              <div className="font-typewriter font-bold text-sm text-[var(--text-primary)] truncate mt-0.5">
                {roll.label || 'Rolagem de Dados'}
              </div>
              <div className="text-xs font-semibold mt-1 tabular-nums">
                {phase === 'rolling' ? (
                  <span className="vtt-muted">Rolando dados...</span>
                ) : (
                  <span
                    className={
                      roll.outcome === 'crit'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : roll.outcome === 'fumble'
                        ? 'text-red-600 dark:text-red-400'
                        : roll.outcome === 'success'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-[var(--text-primary)]'
                    }
                  >
                    {roll.summary}
                  </span>
                )}
              </div>
            </div>
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  );
}
