import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  BookOpen,
  Compass,
  Dices,
  FileSpreadsheet,
  Hourglass,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  Moon,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  CharacterSheet,
  DiceRoll,
  Handout,
  InterludeIconId,
  LivePublicWiki,
  LiveTableState,
  SheetBlock,
} from '../types/vtt';
import { applyCampaignTheme, getSceneEffects } from '../lib/themes';
import { evaluateDiceFormula, isDiceFormula, type RollMode } from '../lib/diceEngine';
import { resolveMediaUrl } from '../lib/mediaStore';
import {
  createCharacterSheet,
  deleteCharacterSheet,
  joinCampaignByRoomCode,
  recordDiceRoll,
  subscribeLiveState,
  subscribeLiveWiki,
  subscribePlayerPrivateHandouts,
  subscribeRolls,
  subscribeSheets,
  updateCharacterSheet,
} from '../lib/vttService';
import { useSyncedLiveAudio } from '../hooks/useSyncedLiveAudio';
import { CharacterSheetPanel } from '../components/CharacterSheetPanel';
import { DiceChatPanel } from '../components/DiceChatPanel';
import { CampaignChatPanel } from '../components/CampaignChatPanel';
import { TabletopCanvas } from '../components/TabletopCanvas';
import { SceneEffectsStage } from '../components/SceneEffectsOverlay';
import { HandoutOverlay } from '../components/HandoutOverlay';
import { DiceRollOverlay, type ActiveDiceAnimation } from '../components/DiceRollOverlay';
import { DuelArena3DOverlay } from '../components/DuelArena3DOverlay';

type MobileTab = 'sheet' | 'dice' | 'chat' | 'clues' | 'scene';

function renderInterludeIcon(icon: InterludeIconId | undefined) {
  switch (icon) {
    case 'none':
      return null;
    case 'hourglass':
      return <Hourglass className="w-7 h-7 vtt-accent-text mx-auto animate-pulse" />;
    case 'compass':
      return <Compass className="w-7 h-7 vtt-accent-text mx-auto" />;
    case 'book':
      return <BookOpen className="w-7 h-7 vtt-accent-text mx-auto" />;
    case 'moon':
      return <Moon className="w-7 h-7 vtt-accent-text mx-auto" />;
    case 'swords':
      return <Swords className="w-7 h-7 vtt-accent-text mx-auto" />;
    default:
      return <Sparkles className="w-7 h-7 vtt-accent-text mx-auto animate-pulse" />;
  }
}

interface PlayerMobileViewProps {
  user: User;
  roomCode?: string;
  campaignId?: string;
  onExit: () => void;
}

export function PlayerMobileView({
  user,
  roomCode,
  campaignId: initialCampaignId,
  onExit,
}: PlayerMobileViewProps) {
  const [campaignId, setCampaignId] = useState(initialCampaignId || '');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(Boolean(roomCode && !initialCampaignId));

  const [liveState, setLiveState] = useState<LiveTableState | null>(null);
  const [liveWiki, setLiveWiki] = useState<LivePublicWiki | null>(null);
  const [sheets, setSheets] = useState<CharacterSheet[]>([]);
  const [ownRolls, setOwnRolls] = useState<DiceRoll[]>([]);
  const [privateHandouts, setPrivateHandouts] = useState<Handout[]>([]);

  const [tab, setTab] = useState<MobileTab>('sheet');
  const [openedPrivateHandout, setOpenedPrivateHandout] = useState<ActiveHandoutProjection | null>(null);
  const [toast, setToast] = useState('');
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);
  const [interludeBgUrl, setInterludeBgUrl] = useState('');

  const syncedAudio = useSyncedLiveAudio(campaignId, liveState?.liveAudio);

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    let alive = true;
    const cfg = liveState?.interludeConfig;
    if (!campaignId || (!cfg?.mediaId && !cfg?.imageUrl)) {
      setInterludeBgUrl('');
      return;
    }
    void resolveMediaUrl(cfg.mediaId, cfg.imageUrl, campaignId).then((url) => {
      if (alive) setInterludeBgUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [campaignId, liveState?.interludeConfig?.mediaId, liveState?.interludeConfig?.imageUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Auto-join when arriving via /join/:roomCode QR link
  useEffect(() => {
    if (!roomCode || campaignId) return;
    let alive = true;
    setJoining(true);
    setJoinError('');
    void joinCampaignByRoomCode({
      roomCode,
      uid: user.uid,
      displayName: user.displayName || 'Jogador',
    })
      .then((info) => {
        if (!alive) return;
        setCampaignId(info.campaignId);
        setJoining(false);
      })
      .catch((err) => {
        if (!alive) return;
        setJoinError(err instanceof Error ? err.message : 'Não foi possível entrar na sala.');
        setJoining(false);
      });
    return () => {
      alive = false;
    };
  }, [roomCode, campaignId, user.uid, user.displayName]);

  // Live subscriptions once joined
  useEffect(() => {
    if (!campaignId) return;
    const unsubs = [
      subscribeLiveState(campaignId, setLiveState),
      subscribeLiveWiki(campaignId, setLiveWiki),
      subscribeSheets(campaignId, 'ownerUid', user.uid, setSheets),
      subscribeRolls(campaignId, 'rollerUid', user.uid, setOwnRolls),
      subscribePlayerPrivateHandouts(campaignId, user.uid, setPrivateHandouts),
    ];
    return () => unsubs.forEach((u) => u());
  }, [campaignId, user.uid]);

  useEffect(() => {
    if (liveState?.theme) {
      applyCampaignTheme(liveState.theme);
    }
  }, [liveState?.theme]);

  const playerViewMode = liveState?.activeScene?.playerViewMode || 'scene';
  const rawDuel = liveState?.activeScene?.activeDuel || null;
  const activeDuel =
    rawDuel && liveState?.activeScene && rawDuel.sceneId === liveState.activeScene.id
      ? rawDuel
      : null;
  const activeDuelKey = activeDuel ? `${liveState?.activeScene?.id || ''}:${activeDuel.id}` : '';

  // Automatically focus the section chosen by the GM when the GM changes playerViewMode, or switch to 'scene' when entering/returning to a 3D Duel
  useEffect(() => {
    if (activeDuelKey) {
      setTab('scene');
      return;
    }
    if (!liveState?.activeScene?.playerViewMode) return;
    const mode = liveState.activeScene.playerViewMode;
    if (mode === 'scene' || mode === 'standby') {
      setTab('scene');
    } else if (mode === 'clues') {
      setTab('clues');
    } else if (mode === 'dice') {
      setTab('dice');
    }
  }, [liveState?.activeScene?.playerViewMode, activeDuelKey]);

  const uploadContext = useMemo(
    () => ({
      campaignId,
      gmUid: liveState?.gmUid || '',
      uploaderUid: user.uid,
    }),
    [campaignId, liveState?.gmUid, user.uid]
  );

  // Combine public room rolls + player's own hidden-to-GM rolls seamlessly
  const mergedRolls = (() => {
    const map = new Map<string, DiceRoll | LiveTableState['recentPublicRolls'][number]>();
    for (const r of liveState?.recentPublicRolls || []) {
      map.set(r.id, r);
    }
    for (const r of ownRolls) {
      map.set(r.id, r);
    }
    return Array.from(map.values());
  })();

  async function handleRoll(params: {
    input: string;
    label?: string;
    mode: RollMode;
    explode: boolean;
    visibility: 'public' | 'gm_only';
    blocks?: SheetBlock[];
    rollerName?: string;
  }) {
    if (!liveState || !campaignId) return;
    const isFormula = isDiceFormula(params.input) || Boolean(params.blocks);
    const evalResult = isFormula
      ? evaluateDiceFormula(params.input, {
          blocks: params.blocks,
          mode: params.mode,
          forceExplode: params.explode,
        })
      : {
          formula: 'chat',
          resolvedFormula: '',
          total: 0,
          summary: params.input,
          breakdown: '',
          outcome: 'chat' as const,
        };

    const rollerDisplay = params.rollerName || sheets[0]?.name || user.displayName || 'Jogador';

    if (evalResult.outcome !== 'chat') {
      setActiveRollAnim({
        id: `anim_${Date.now()}`,
        rollerName: rollerDisplay,
        label: params.label || 'Rolagem de Dados',
        formula: evalResult.formula,
        total: evalResult.total,
        summary:
          params.visibility === 'gm_only'
            ? `${evalResult.summary} (Só Mestre)`
            : evalResult.summary,
        outcome: evalResult.outcome,
      });
    }

    await recordDiceRoll({
      campaignId,
      gmUid: liveState.gmUid,
      rollerUid: user.uid,
      rollerName: rollerDisplay,
      label: params.label || '',
      formula: evalResult.formula,
      resolvedFormula: evalResult.resolvedFormula,
      total: evalResult.total,
      summary: evalResult.summary,
      breakdown: evalResult.breakdown,
      outcome: evalResult.outcome,
      visibility: params.visibility,
      currentRecentPublicRolls: liveState.recentPublicRolls || [],
    });
  }

  if (joining) {
    return (
      <div className="min-h-screen vtt-canvas flex items-center justify-center p-6 text-center">
        <p className="text-sm font-typewriter">Entrando na sala {roomCode}...</p>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="min-h-screen vtt-canvas flex items-center justify-center p-6">
        <div className="max-w-sm w-full vtt-surface border p-6 space-y-4 text-center">
          <h1 className="text-lg font-bold font-typewriter">Não foi possível entrar</h1>
          <p className="text-xs vtt-muted">{joinError}</p>
          <button
            type="button"
            onClick={onExit}
            className="w-full py-2.5 text-xs font-semibold vtt-accent-btn"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  const sceneEffects = getSceneEffects(liveState?.theme);

  return (
    <div className="h-[100dvh] w-full flex flex-col vtt-canvas overflow-hidden">
      {/* Compact Top App Bar */}
      <header className="h-12 px-3 border-b vtt-border vtt-surface flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={onExit}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center vtt-muted"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-bold font-typewriter truncate flex-1 text-center">
          {liveState?.campaignTitle || 'Mesa Digital'}
        </h1>
        <div className="flex items-center gap-1.5 shrink-0">
          {(syncedAudio.hasActiveAudio || syncedAudio.localMuted) && (
            <button
              type="button"
              onClick={syncedAudio.toggleLocalMute}
              className={`min-h-[36px] min-w-[36px] px-2 flex items-center justify-center border vtt-border transition-colors ${
                syncedAudio.localMuted ? 'vtt-subtle text-red-400' : 'vtt-subtle vtt-accent-text'
              }`}
              aria-label={syncedAudio.localMuted ? 'Ativar áudio da mesa' : 'Silenciar áudio da mesa'}
              title={
                syncedAudio.localMuted
                  ? 'Áudio mutado no seu dispositivo (toque para ouvir)'
                  : `Ouvindo: ${syncedAudio.activeTrackLabel || 'Trilha da mesa'} (toque para silenciar)`
              }
            >
              {syncedAudio.localMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
          )}
          <span className="text-[11px] vtt-muted whitespace-nowrap">
            {privateHandouts.length > 0 ? `${privateHandouts.length} pista(s)` : 'Jogador'}
          </span>
        </div>
      </header>

      {/* One-Tap Autoplay Unlock Banner when GM starts music/ambience on mobile/browser */}
      {syncedAudio.blockedByAutoplay && syncedAudio.hasActiveAudio && !syncedAudio.localMuted && (
        <button
          type="button"
          onClick={() => void syncedAudio.unlockAudio()}
          className="w-full px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-2 shrink-0 border-b vtt-border"
        >
          <Volume2 className="w-4 h-4 shrink-0" />
          <span className="truncate">
            Toque para ativar o áudio da mesa
            {syncedAudio.activeTrackLabel ? ` · ${syncedAudio.activeTrackLabel}` : ''}
          </span>
        </button>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 overflow-hidden relative max-w-4xl w-full mx-auto">
        {tab === 'sheet' && (
          <CharacterSheetPanel
            uploadContext={uploadContext}
            sheets={sheets}
            onCreateSheet={async (payload) => {
              if (!liveState || !campaignId) return '';
              return createCharacterSheet({
                campaignId,
                gmUid: liveState.gmUid,
                ownerUid: user.uid,
                ownerName: user.displayName || 'Jogador',
                ...payload,
              });
            }}
            onUpdateSheet={(sheet) =>
              updateCharacterSheet(campaignId, sheet.id, {
                name: sheet.name,
                subtitle: sheet.subtitle,
                templateId: sheet.templateId,
                mode: sheet.mode,
                avatarUrl: sheet.avatarUrl || '',
                avatarMediaId: sheet.avatarMediaId || '',
                pdfUrl: sheet.pdfUrl,
                pdfMediaId: sheet.pdfMediaId,
                pdfFileName: sheet.pdfFileName,
                blocks: sheet.blocks,
              })
            }
            onDeleteSheet={(id) => deleteCharacterSheet(campaignId, id)}
            onRollFromSheet={async ({ sheetName, label, formula, blocks }) => {
              await handleRoll({
                input: formula,
                label,
                mode: 'normal',
                explode: false,
                visibility: 'public',
                blocks,
                rollerName: sheetName,
              });
            }}
            onNotify={setToast}
          />
        )}

        {tab === 'dice' && (
          <DiceChatPanel
            rolls={mergedRolls}
            isGM={false}
            onExecuteInput={(p) => handleRoll(p)}
          />
        )}

        {tab === 'chat' && liveState && campaignId && (
          <CampaignChatPanel
            campaignId={campaignId}
            gmUid={liveState.gmUid}
            gmName="Mestre"
            currentUid={user.uid}
            currentName={sheets[0]?.name || user.displayName || 'Jogador'}
            isGM={false}
            uploadContext={uploadContext}
            sheets={sheets}
            onAddItemToSheet={async (sheetId, itemBlock) => {
              const target = sheets.find((s) => s.id === sheetId);
              if (!target) return;
              await updateCharacterSheet(campaignId, target.id, {
                name: target.name,
                subtitle: target.subtitle,
                templateId: target.templateId,
                mode: target.mode,
                avatarUrl: target.avatarUrl || '',
                avatarMediaId: target.avatarMediaId || '',
                pdfUrl: target.pdfUrl,
                pdfMediaId: target.pdfMediaId,
                pdfFileName: target.pdfFileName,
                blocks: [...target.blocks, itemBlock],
              });
            }}
            onNotify={setToast}
          />
        )}

        {tab === 'clues' && (
          <div className="h-full overflow-y-auto p-4 space-y-6">
            {/* Private Individual Handouts sent ONLY to this player */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between border-b vtt-border pb-2">
                <h2 className="text-sm font-bold font-typewriter flex items-center gap-2">
                  <Mail className="w-4 h-4 vtt-accent-text" />
                  Bilhetes Individuais (Só para você)
                </h2>
                <span className="text-xs vtt-muted tabular-nums">{privateHandouts.length}</span>
              </div>

              {privateHandouts.length === 0 ? (
                <p className="text-xs vtt-muted py-2">
                  Quando o mestre enviar uma pista ou bilhete secreto só para você, ele aparecerá aqui.
                </p>
              ) : (
                <div className="space-y-2">
                  {privateHandouts.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() =>
                        setOpenedPrivateHandout({
                          id: h.id,
                          title: h.title,
                          kind: h.kind,
                          imageUrl: h.imageUrl,
                          mediaId: h.mediaId,
                          body: h.body,
                        })
                      }
                      className="w-full min-h-[56px] p-3.5 text-left vtt-surface border vtt-border flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold font-typewriter truncate">{h.title}</p>
                        {h.body && <p className="text-[11px] vtt-muted truncate mt-0.5">{h.body}</p>}
                      </div>
                      <span className="text-xs font-semibold vtt-accent-text whitespace-nowrap shrink-0">
                        Abrir
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Public Campaign Wiki Notes */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between border-b vtt-border pb-2">
                <h2 className="text-sm font-bold font-typewriter">Anotações Públicas da Campanha</h2>
                <span className="text-xs vtt-muted tabular-nums">
                  {liveWiki?.notes?.length || 0}
                </span>
              </div>

              {!liveWiki?.notes?.length ? (
                <p className="text-xs vtt-muted py-2">
                  Nenhuma anotação pública liberada pelo mestre ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {liveWiki.notes.map((n) => (
                    <article key={n.id} className="vtt-surface border vtt-border p-4 space-y-1.5">
                      <p className="text-[11px] vtt-muted">{n.folder}</p>
                      <h3 className="text-sm font-bold font-typewriter">{n.title}</h3>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{n.content}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'scene' && (
          <div className="h-full w-full relative">
            <SceneEffectsStage
              effects={sceneEffects}
              shakePulseMs={liveState?.shakePulseMs}
              className="w-full h-full"
            >
              <TabletopCanvas
                campaignId={campaignId}
                scene={liveState?.activeScene || null}
                mode="player"
                activeDuel={activeDuel}
              />
              {!activeDuel && playerViewMode === 'standby' && (
                <div className="absolute inset-0 z-30 vtt-canvas flex flex-col items-center justify-center p-6 text-center overflow-hidden">
                  {interludeBgUrl && (
                    <>
                      <img
                        src={interludeBgUrl}
                        alt={liveState?.interludeConfig?.title || liveState?.campaignTitle || 'Interlúdio'}
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
                    </>
                  )}
                  <div className="relative z-10 max-w-sm w-full space-y-3 p-6 border vtt-border vtt-surface/90 backdrop-blur-md shadow-xl">
                    {renderInterludeIcon(liveState?.interludeConfig?.icon)}
                    <h2 className="text-xl font-bold font-typewriter">
                      {liveState?.interludeConfig?.title?.trim() ||
                        liveState?.campaignTitle ||
                        'Mesa Digital'}
                    </h2>
                    <p className="text-xs vtt-muted leading-relaxed whitespace-pre-wrap">
                      {liveState?.interludeConfig?.subtitle?.trim() ||
                        'O mestre está preparando o próximo cenário nos bastidores. Você pode consultar sua Ficha, Dados, Chat ou Pistas abaixo.'}
                    </p>
                  </div>
                </div>
              )}

              {/* 3D Confrontation / Duel Arena for Player inside SceneEffectsStage so CRT & FX apply + exit zoom animates! */}
              <DuelArena3DOverlay
                campaignId={campaignId}
                duel={activeDuel}
                mode="player"
                onExecuteDuelAction={({ side, action, rollDamageOnly }) => {
                  if (side !== 'player') return;
                  const formulaToRoll =
                    rollDamageOnly && action.damageFormula ? action.damageFormula : action.formula;
                  const activePlayerName =
                    activeDuel?.player.name ||
                    sheets[0]?.name ||
                    user.displayName ||
                    'Jogador';
                  void handleRoll({
                    input: formulaToRoll,
                    label: rollDamageOnly ? `${action.label} (Dano)` : action.label,
                    mode: 'normal',
                    explode: false,
                    visibility: 'public',
                    blocks: sheets[0]?.blocks,
                    rollerName: activePlayerName,
                  });
                }}
              />
            </SceneEffectsStage>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-4 py-2 text-xs font-semibold vtt-surface border shadow-lg whitespace-nowrap">
            {toast}
          </div>
        )}
      </main>

      {/* Thumb-Zone Bottom Navigation Bar */}
      <nav
        aria-label="Navegação do jogador"
        className="h-14 border-t vtt-border vtt-surface grid grid-cols-5 items-center shrink-0"
      >
        {(
          [
            ['sheet', 'Ficha', FileSpreadsheet],
            ['dice', 'Dados', Dices],
            ['chat', 'Chat', MessageSquare],
            ['clues', 'Pistas', BookOpen],
            ['scene', 'Cena', ImageIcon],
          ] as const
        ).map(([id, label, Icon]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-[48px] h-full flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                active ? 'vtt-accent-text font-bold' : 'vtt-muted'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Global Pop-up Handout triggered by GM ("Mostrar para todos") */}
      <HandoutOverlay
        campaignId={campaignId}
        handout={liveState?.activeHandout || null}
        canDismiss={false}
      />

      {/* Individual Private Handout opened by Player */}
      {!liveState?.activeHandout && openedPrivateHandout && (
        <HandoutOverlay
          campaignId={campaignId}
          handout={openedPrivateHandout}
          canDismiss
          dismissLabel="Fechar bilhete"
          onDismiss={() => setOpenedPrivateHandout(null)}
        />
      )}

      {/* Dynamic Rolling Dice Animation on Mobile */}
      <DiceRollOverlay roll={activeRollAnim} onComplete={clearRollAnim} position="center" />
    </div>
  );
}
