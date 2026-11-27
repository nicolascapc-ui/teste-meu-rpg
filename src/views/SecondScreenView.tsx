import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Compass,
  Dices,
  Hourglass,
  Moon,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { InterludeIconId, LivePublicWiki, LiveTableState } from '../types/vtt';
import { applyCampaignTheme, getSceneEffects } from '../lib/themes';
import { resolveMediaUrl } from '../lib/mediaStore';
import {
  openTableChannel,
  saveInvestigationJournalEntry,
  subscribeLiveState,
  subscribeLiveWiki,
} from '../lib/vttService';
import { useSyncedLiveAudio } from '../hooks/useSyncedLiveAudio';
import { TabletopCanvas } from '../components/TabletopCanvas';
import { SceneEffectsStage } from '../components/SceneEffectsOverlay';
import { HandoutOverlay } from '../components/HandoutOverlay';
import { DiceRollOverlay, type ActiveDiceAnimation } from '../components/DiceRollOverlay';
import { DuelArena3DOverlay } from '../components/DuelArena3DOverlay';
import { InvestigationSceneOverlay } from '../components/InvestigationSceneOverlay';

function renderInterludeIcon(icon: InterludeIconId | undefined) {
  switch (icon) {
    case 'none':
      return null;
    case 'hourglass':
      return <Hourglass className="w-8 h-8 vtt-accent-text mx-auto animate-pulse" />;
    case 'compass':
      return <Compass className="w-8 h-8 vtt-accent-text mx-auto" />;
    case 'book':
      return <BookOpen className="w-8 h-8 vtt-accent-text mx-auto" />;
    case 'moon':
      return <Moon className="w-8 h-8 vtt-accent-text mx-auto" />;
    case 'swords':
      return <Swords className="w-8 h-8 vtt-accent-text mx-auto" />;
    default:
      return <Sparkles className="w-8 h-8 vtt-accent-text mx-auto animate-pulse" />;
  }
}

interface SecondScreenViewProps {
  campaignId: string;
}

export function SecondScreenView({ campaignId }: SecondScreenViewProps) {
  const [liveState, setLiveState] = useState<LiveTableState | null>(null);
  const [liveWiki, setLiveWiki] = useState<LivePublicWiki | null>(null);
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);
  const [interludeBgUrl, setInterludeBgUrl] = useState('');
  const lastRollIdRef = useRef<string>('');

  const syncedAudio = useSyncedLiveAudio(campaignId, liveState?.liveAudio);

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    let alive = true;
    const cfg = liveState?.interludeConfig;
    if (!cfg?.mediaId && !cfg?.imageUrl) {
      setInterludeBgUrl('');
      return;
    }
    void resolveMediaUrl(cfg.mediaId, cfg.imageUrl, campaignId).then((url) => {
      if (alive) setInterludeBgUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [liveState?.interludeConfig?.mediaId, liveState?.interludeConfig?.imageUrl, campaignId]);

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
  const rawDuel = liveState.activeScene?.activeDuel || null;
  const activeDuel =
    rawDuel && liveState.activeScene && rawDuel.sceneId === liveState.activeScene.id
      ? rawDuel
      : null;
  const rawInv = liveState.activeScene?.activeInvestigation || null;
  const activeInvestigation =
    rawInv &&
    rawInv.isLiveToPlayers &&
    liveState.activeScene &&
    rawInv.sceneId === liveState.activeScene.id
      ? rawInv
      : null;

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

        {/* GM-Controlled Forced Section Overlay on Visualization Screen (when no duel or investigation is active) */}
        {!activeDuel && !activeInvestigation && playerViewMode === 'clues' && (
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

        {!activeDuel && !activeInvestigation && playerViewMode === 'dice' && (
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

        {!activeDuel && !activeInvestigation && playerViewMode === 'standby' && (
          <div className="absolute inset-0 z-30 vtt-canvas flex flex-col items-center justify-center p-8 text-center overflow-hidden">
            {interludeBgUrl && (
              <>
                <img
                  src={interludeBgUrl}
                  alt={liveState.interludeConfig?.title || liveState.campaignTitle}
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
              </>
            )}
            <div className="relative z-10 max-w-xl w-full space-y-4 p-8 sm:p-10 border vtt-border vtt-surface/90 backdrop-blur-md shadow-2xl">
              {renderInterludeIcon(liveState.interludeConfig?.icon)}
              <h1 className="text-3xl sm:text-4xl font-bold font-typewriter leading-tight">
                {liveState.interludeConfig?.title?.trim() || liveState.campaignTitle}
              </h1>
              <p className="text-sm vtt-muted leading-relaxed whitespace-pre-wrap">
                {liveState.interludeConfig?.subtitle?.trim() ||
                  'Aguarde um instante enquanto o mestre prepara o próximo capítulo...'}
              </p>
            </div>
          </div>
        )}

        {/* 3D Turn-Based Confrontation / Duel Mode Stage (inside SceneEffectsStage so CRT & FX apply!) */}
        <DuelArena3DOverlay
          campaignId={campaignId}
          duel={activeDuel}
          mode="screen"
        />

        {/* Point & Click Investigation Scene Stage */}
        {activeInvestigation && !activeDuel && (
          <InvestigationSceneOverlay
            campaignId={campaignId}
            mode="screen"
            investigation={activeInvestigation}
            journalEntries={liveState.investigationJournal || []}
            currentUserName="Tela da Mesa"
            onNoteClue={async (hotspot) => {
              await saveInvestigationJournalEntry(
                campaignId,
                {
                  id: `jrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                  investigationId: activeInvestigation.id,
                  investigationTitle: activeInvestigation.title || 'Investigação',
                  hotspotId: hotspot.id,
                  title: hotspot.title || 'Pista',
                  description: hotspot.description || '',
                  zoomImageUrl: hotspot.zoomImageUrl || '',
                  zoomMediaId: hotspot.zoomMediaId || '',
                  difficulty: hotspot.difficulty || 1,
                  notedByUid: 'screen',
                  notedByName: 'Mesa (TV)',
                  notedAtMs: Date.now(),
                },
                liveState
              );
            }}
          />
        )}
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

      {/* Synchronized Table Audio: Autoplay Unlock Prompt & Discreet Local Mute Toggle */}
      {syncedAudio.hasActiveAudio && (
        <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5">
          {syncedAudio.blockedByAutoplay && !syncedAudio.localMuted ? (
            <button
              type="button"
              onClick={() => void syncedAudio.unlockAudio()}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold vtt-accent-btn shadow-2xl border border-white/20 animate-pulse"
              title="Clique para liberar o áudio sincronizado da mesa nesta tela"
            >
              <Volume2 className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-[220px]">
                Ativar Áudio{syncedAudio.activeTrackLabel ? ` · ${syncedAudio.activeTrackLabel}` : ''}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={syncedAudio.toggleLocalMute}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border backdrop-blur-md transition-opacity ${
                syncedAudio.localMuted
                  ? 'bg-black/75 border-white/20 text-stone-300 opacity-85 hover:opacity-100'
                  : 'bg-black/55 border-white/15 text-stone-100 opacity-35 hover:opacity-100'
              }`}
              title={
                syncedAudio.localMuted
                  ? 'Som mutado apenas nesta tela (clique para ativar)'
                  : `Tocando: ${syncedAudio.activeTrackLabel || 'Trilha da Mesa'} (clique para mutar esta tela)`
              }
            >
              {syncedAudio.localMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400 shrink-0" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className="hidden sm:inline truncate max-w-[140px]">
                {syncedAudio.localMuted ? 'Som mutado' : syncedAudio.activeTrackLabel || 'Áudio ativo'}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

