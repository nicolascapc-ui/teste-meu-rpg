import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  BookOpen,
  Dices,
  FileSpreadsheet,
  Image as ImageIcon,
  Mail,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  CharacterSheet,
  DiceRoll,
  Handout,
  LivePublicWiki,
  LiveTableState,
  SheetBlock,
} from '../types/vtt';
import { applyCampaignTheme, getSceneEffects } from '../lib/themes';
import { evaluateDiceFormula, isDiceFormula, type RollMode } from '../lib/diceEngine';
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
import { CharacterSheetPanel } from '../components/CharacterSheetPanel';
import { DiceChatPanel } from '../components/DiceChatPanel';
import { TabletopCanvas } from '../components/TabletopCanvas';
import { SceneEffectsStage } from '../components/SceneEffectsOverlay';
import { HandoutOverlay } from '../components/HandoutOverlay';
import { DiceRollOverlay, type ActiveDiceAnimation } from '../components/DiceRollOverlay';

type MobileTab = 'sheet' | 'dice' | 'clues' | 'scene';

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

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

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
      <header className="h-12 px-3 border-b vtt-border vtt-surface flex items-center justify-between gap-3 shrink-0">
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
        <span className="text-[11px] vtt-muted whitespace-nowrap shrink-0">
          {privateHandouts.length > 0 ? `${privateHandouts.length} pista(s)` : 'Jogador'}
        </span>
      </header>

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
          <div className="h-full w-full">
            <SceneEffectsStage
              effects={sceneEffects}
              shakePulseMs={liveState?.shakePulseMs}
              className="w-full h-full"
            >
              <TabletopCanvas
                campaignId={campaignId}
                scene={liveState?.activeScene || null}
                mode="player"
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
        className="h-14 border-t vtt-border vtt-surface grid grid-cols-4 items-center shrink-0"
      >
        {(
          [
            ['sheet', 'Ficha', FileSpreadsheet],
            ['dice', 'Dados', Dices],
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
