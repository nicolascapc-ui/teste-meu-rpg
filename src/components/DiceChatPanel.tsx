import { useState } from 'react';
import { Dices, Eye, EyeOff, Send, Sparkles } from 'lucide-react';
import type { DiceRoll, PublicRollSummary } from '../types/vtt';
import type { RollMode } from '../lib/diceEngine';

interface DiceChatPanelProps {
  rolls: Array<DiceRoll | PublicRollSummary>;
  isGM: boolean;
  onExecuteInput: (params: {
    input: string;
    label?: string;
    mode: RollMode;
    explode: boolean;
    visibility: 'public' | 'gm_only';
  }) => Promise<void>;
}

const QUICK_DICE = [
  { label: 'd4', formula: '1d4' },
  { label: 'd6', formula: '1d6' },
  { label: 'd8', formula: '1d8' },
  { label: 'd10', formula: '1d10' },
  { label: 'd12', formula: '1d12' },
  { label: 'd20', formula: '1d20' },
  { label: 'd100', formula: '1d100' },
  { label: '5d10>=6', formula: '5d10>=6' },
];

export function DiceChatPanel({ rolls, isGM, onExecuteInput }: DiceChatPanelProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<RollMode>('normal');
  const [explode, setExplode] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'gm_only'>('public');
  const [rollingKey, setRollingKey] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    await onExecuteInput({ input: text, mode, explode, visibility });
  }

  async function handleQuickRoll(formula: string, label: string) {
    setRollingKey(label);
    window.setTimeout(() => setRollingKey(null), 500);
    await onExecuteInput({ input: formula, label, mode, explode, visibility });
  }

  function getOutcomeLabel(outcome: string): { text: string; toneClass: string } | null {
    switch (outcome) {
      case 'crit':
        return { text: 'CRÍTICO', toneClass: 'text-emerald-700 dark:text-emerald-400 font-bold' };
      case 'fumble':
        return { text: 'DESASTRE', toneClass: 'text-red-700 dark:text-red-400 font-bold' };
      case 'success':
        return { text: 'SUCESSO', toneClass: 'text-emerald-700 dark:text-emerald-400 font-semibold' };
      case 'failure':
        return { text: 'FALHA', toneClass: 'text-red-700 dark:text-red-400 font-semibold' };
      default:
        return null;
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Roll Modifiers & Quick Dice */}
      <div className="p-3 border-b vtt-border space-y-2.5 vtt-subtle">
        <div className="grid grid-cols-4 gap-1.5">
          {QUICK_DICE.map((d) => {
            const isRolling = rollingKey === `Rolagem ${d.label}`;
            return (
              <button
                key={d.label}
                type="button"
                onClick={() => void handleQuickRoll(d.formula, `Rolagem ${d.label}`)}
                className={`py-2 px-1 text-xs font-semibold border vtt-border vtt-surface hover:opacity-85 active:scale-95 transition-transform tabular-nums whitespace-nowrap truncate ${
                  isRolling ? 'vtt-accent-btn border-transparent' : ''
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>

        {/* Mode, Explode, and Visibility controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <div className="flex items-center border vtt-border vtt-surface">
            {(
              [
                ['normal', 'Normal'],
                ['advantage', 'Vant.'],
                ['disadvantage', 'Desv.'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-1.5 whitespace-nowrap ${
                  mode === m ? 'vtt-accent-btn font-semibold' : 'vtt-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setExplode((v) => !v)}
            className={`px-2.5 py-1.5 border flex items-center gap-1 whitespace-nowrap ${
              explode ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border vtt-muted'
            }`}
            title="Ativar dados explosivos (!)"
          >
            <Sparkles className="w-3 h-3" />
            Explosivo
          </button>

          <button
            type="button"
            onClick={() => setVisibility((v) => (v === 'public' ? 'gm_only' : 'public'))}
            className={`px-2.5 py-1.5 border flex items-center gap-1 whitespace-nowrap ${
              visibility === 'gm_only'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-surface vtt-border vtt-muted'
            }`}
            title="Alternar entre rolagem aberta ou oculta (só o mestre vê)"
          >
            {visibility === 'gm_only' ? (
              <>
                <EyeOff className="w-3 h-3" />
                {isGM ? 'Oculta (Só Mestre)' : 'Oculta p/ Mestre'}
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                Aberta
              </>
            )}
          </button>
        </div>
      </div>

      {/* Clean Chronological Feed */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {rolls.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Dices className="w-7 h-7 mx-auto vtt-muted" />
            <p className="text-xs font-semibold">Rolador Universal</p>
            <p className="text-[11px] vtt-muted leading-relaxed">
              Funciona com qualquer sistema: clique nos dados acima, role direto da ficha ou digite{' '}
              <code>1d20+4</code>, <code>1d100&lt;=65</code>, <code>3d20kh1+5</code>,{' '}
              <code>4d6!</code> ou <code>6d10&gt;=6</code>.
            </p>
          </div>
        ) : (
          rolls.map((item) => {
            const isHidden = 'visibility' in item && item.visibility === 'gm_only';
            const badge = getOutcomeLabel(item.outcome);
            return (
              <article
                key={item.id}
                className={`p-3 border vtt-border space-y-1 ${
                  isHidden ? 'vtt-subtle border-dashed' : 'vtt-canvas'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] vtt-muted">
                  <span className="font-semibold text-[var(--text-primary)] truncate">
                    {item.rollerName}
                    {item.label ? ` · ${item.label}` : ''}
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-mono">
                    {isHidden ? 'Oculta (Mestre)' : item.outcome === 'chat' ? 'Chat' : item.formula}
                  </span>
                </div>

                {item.outcome === 'chat' ? (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{item.summary}</p>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-2 pt-0.5">
                      <span className="text-lg font-bold font-typewriter tabular-nums">
                        {item.total}
                      </span>
                      <span className={`text-xs ${badge ? badge.toneClass : 'vtt-muted'}`}>
                        {badge ? `${badge.text} · ` : ''}
                        {item.summary}
                      </span>
                    </div>
                    {item.breakdown && (
                      <p className="text-[11px] vtt-muted tabular-nums break-words">
                        {item.breakdown}
                      </p>
                    )}
                  </>
                )}
              </article>
            );
          })
        )}
      </div>

      {/* Formula / Chat Input Bar */}
      <form onSubmit={handleSubmit} className="p-3 border-t vtt-border flex items-center gap-2 vtt-surface">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={120}
          placeholder="Ex: 1d20+3, 1d100<=60, 6d10>=6 ou mensagem..."
          className="flex-1 px-3 py-2 text-xs border vtt-border vtt-canvas min-w-0"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-3.5 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          Rolar
        </button>
      </form>
    </div>
  );
}
