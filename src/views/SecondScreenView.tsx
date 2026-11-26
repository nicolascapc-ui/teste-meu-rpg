import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveTableState } from '../types/vtt';
import { applyCampaignTheme, getSceneEffects } from '../lib/themes';
import { openTableChannel, subscribeLiveState } from '../lib/vttService';
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
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);
  const lastRollIdRef = useRef<string>('');

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    const unsub = subscribeLiveState(campaignId, (state) => {
      if (state) setLiveState(state);
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
      unsub();
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

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-stone-950">
      {/* 100% clean player stage — synced Visual FX, zero GM toolbars, 100% opaque Fog of War */}
      <SceneEffectsStage
        effects={effects}
        shakePulseMs={liveState.shakePulseMs}
        className="w-full h-full"
      >
        <TabletopCanvas
          campaignId={campaignId}
          scene={liveState.activeScene}
          mode="screen"
        />
      </SceneEffectsStage>

      {/* 3D Turn-Based Confrontation / Duel Mode Stage */}
      <DuelArena3DOverlay
        campaignId={campaignId}
        duel={liveState.activeScene?.activeDuel || null}
        mode="screen"
      />

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
