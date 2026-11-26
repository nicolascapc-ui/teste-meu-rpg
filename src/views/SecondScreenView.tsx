import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Dices, Sparkles } from 'lucide-react';
import type { LivePublicWiki, LiveTableState } from '../types/vtt';
import { applyCampaignTheme, getSceneEffects } from '../lib/themes';
import { openTableChannel, subscribeLiveState, subscribeLiveWiki } from '../lib/vttService';
import { TabletopCanvas } from '../components/TabletopCanvas';
import { SceneEffectsStage } from '../components/SceneEffectsOverlay';
import { HandoutOverlay } from '../components/HandoutOverlay';
import { DiceRollOverlay, type ActiveDiceAnimation } from '../components/DiceRollOverlay';
import { DuelArena3DOverlay } from '../components/DuelArena3DOverlay';

interface SecondScreenViewProps {
  campaignId: string;
}

export function SecondScreenView({ campaignId }: SecondScreenViewProps) {
  const [liveState, setLiveState] = useState<LiveTableState | null>(null);
  const [liveWiki, setLiveWiki] = useState<LivePublicWiki | null>(null);
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);
  const lastRollIdRef = useRef<string>('');

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    const unsubState = subscribeLiveState(campaignId, (state) => {
      if (state) setLiveState(state);
    });
    const unsubWiki = subscribeLiveWiki(campaignId, (wiki) => {
      setLiveWiki(wiki);
    });

    // Local zero-latency sync with GM window on the same laptop/PC
    const ch = openTableChannel(campaignId);
    if (ch) {
      ch.onmessage = (ev) => {
        if (ev.data?.type === 'LIVE_STATE' && ev.data?.payload) {
          setLiveState(ev.data.payload as LiveTableState);
        }
      };
    }

    return () => {
      unsubState();
      unsubWiki();
      ch?.close();
    };
  }, [campaignId]);

  useEffect(() => {
    if (liveState?.theme) {
      applyCampaignTheme(liveState.theme);
    }
  }, [liveState?.theme]);

  // Display animated tumbling dice on the Second Screen TV whenever any player or GM rolls openly
  useEffect(() => {
    const top = liveState?.recentPublicRolls?.[0];
    if (!top || top.outcome === 'chat') return;
    if (!lastRollIdRef.current) {
      lastRollIdRef.current = top.id;
      return;
    }
    if (top.id !== lastRollIdRef.current) {
      lastRollIdRef.current = top.id;
      setActiveRollAnim({
        id: top.id,
        rollerName: top.rollerName,
        label: top.label || 'Rolagem na Mesa',
        formula: top.formula,
        total: top.total,
        summary: top.summary,
        outcome: top.outcome,
      });
    }
  }, [liveState?.recentPublicRolls]);

  if (!liveState) {
    return (
      <div className="h-screen w-screen bg-stone-950 text-stone-200 flex items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <p className="text-lg font-typewriter">Tela dos Jogadores · Folio</p>
          <p className="text-xs text-stone-400">Conectando à mesa do mestre...</p>
        </div>
      </div>
    );
  }

  const effects = getSceneEffects(liveState.theme);
  const playerViewMode = liveState.activeScene?.playerViewMode || 'scene';
  const activeDuel = liveState.activeScene?.activeDuel || null;

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-stone-950">
      {/* 100% clean player stage — synced Visual FX applied over BOTH Tabletop and 3D Duel Arena */}
      <SceneEffectsStage
        effects={effects}
        shakePulseMs={liveState.shakePulseMs}
        className="w-full h-full"
      >
        <TabletopCanvas
          campaignId={campaignId}
          scene={liveState.activeScene}
          mode="screen"
          activeDuel={activeDuel}
        />

        {/* GM-Controlled Forced Section Overlay on Visualization Screen (when no duel is active) */}
        {!activeDuel && playerViewMode === 'clues' && (
          <div className="absolute inset-0 z-30 vtt-canvas/95 backdrop-blur-md p-8 sm:p-12 overflow-y-auto flex flex-col">
            <div className="max-w-5xl w-full mx-auto space-y-6">
              <div className="flex items-center justify-between border-b vtt-border pb-4">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-6 h-6 vtt-accent-text" />
                  <div>
                    <p className="text-[11px] uppercase tracking-widest vtt-muted">
                      {liveState.campaignTitle}
                    </p>
                    <h1 className="text-2xl font-bold font-typewriter">
                      Quadro de Pistas & Anotações Públicas
                    </h1>
                  </div>
                </div>
                <span className="text-xs vtt-muted tabular-nums">
                  {liveWiki?.notes?.length || 0} registro(s)
                </span>
              </div>

              {!liveWiki?.notes?.length ? (
                <div className="vtt-surface border vtt-border p-10 text-center space-y-2">
                  <p className="text-base font-bold font-typewriter">
                    Nenhuma anotação pública liberada ainda
                  </p>
                  <p className="text-xs vtt-muted">
                    Assim que o mestre revelar pistas ou documentos públicos na Wiki, eles aparecerão aqui.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {liveWiki.notes.map((n) => (
                    <article
                      key={n.id}
                      className="vtt-surface border vtt-border p-5 space-y-2 shadow-lg"
                    >
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 border vtt-border vtt-subtle">
                        {n.folder}
                      </span>
                      <h2 className="text-base font-bold font-typewriter pt-1">{n.title}</h2>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap opacity-90">
                        {n.content}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!activeDuel && playerViewMode === 'dice' && (
          <div className="absolute inset-0 z-30 vtt-canvas/95 backdrop-blur-md p-8 sm:p-12 overflow-y-auto flex flex-col">
            <div className="max-w-4xl w-full mx-auto space-y-6">
              <div className="flex items-center justify-between border-b vtt-border pb-4">
                <div className="flex items-center gap-3">
                  <Dices className="w-6 h-6 vtt-accent-text" />
                  <div>
                    <p className="text-[11px] uppercase tracking-widest vtt-muted">
                      {liveState.campaignTitle}
                    </p>
                    <h1 className="text-2xl font-bold font-typewriter">
                      Histórico de Rolagens da Mesa
                    </h1>
                  </div>
                </div>
              </div>

              {!liveState.recentPublicRolls?.length ? (
                <div className="vtt-surface border vtt-border p-10 text-center">
                  <p className="text-sm vtt-muted">Nenhuma rolagem pública registrada ainda.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {liveState.recentPublicRolls.map((r) => (
                    <div
                      key={r.id}
                      className="vtt-surface border vtt-border p-4 flex items-center justify-between gap-4 shadow-md"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-bold vtt-accent-text truncate">
                          {r.rollerName}
                        </p>
                        <p className="text-sm font-bold font-typewriter truncate">
                          {r.label || r.formula}
                        </p>
                        <p className="text-xs vtt-muted truncate">{r.summary}</p>
                      </div>
                      {r.outcome !== 'chat' && (
                        <div className="px-4 py-2 border vtt-border vtt-canvas text-2xl font-bold font-typewriter tabular-nums shrink-0">
                          {r.total}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!activeDuel && playerViewMode === 'standby' && (
          <div className="absolute inset-0 z-30 vtt-canvas flex flex-col items-center justify-center p-8 text-center">
            <div className="max-w-lg space-y-4 p-8 border vtt-border vtt-surface shadow-2xl">
              <Sparkles className="w-7 h-7 vtt-accent-text mx-auto animate-pulse" />
              <p className="text-[11px] uppercase tracking-widest vtt-muted">
                Cena em Preparação
              </p>
              <h1 className="text-3xl font-bold font-typewriter">
                {liveState.campaignTitle}
              </h1>
              {liveState.activeScene?.name && (
                <p className="text-xs vtt-muted">
                  Aguarde um instante enquanto o mestre prepara o próximo capítulo...
                </p>
              )}
            </div>
          </div>
        )}

        {/* 3D Turn-Based Confrontation / Duel Mode Stage (inside SceneEffectsStage so CRT & FX apply!) */}
        <DuelArena3DOverlay
          campaignId={campaignId}
          duel={activeDuel}
          mode="screen"
        />
      </SceneEffectsStage>

      {/* Fullscreen Handout Pop-up controlled by GM */}
      <HandoutOverlay
        campaignId={campaignId}
        handout={liveState.activeHandout}
        canDismiss={false}
      />

      {/* Dynamic Tumbling Dice Animation for Public Rolls */}
      <DiceRollOverlay
        roll={activeRollAnim}
        onComplete={clearRollAnim}
        position="bottom-right"
      />
    </div>
  );
}

