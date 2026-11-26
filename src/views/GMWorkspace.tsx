import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  BrickWall,
  CloudFog,
  Dices,
  DoorClosed,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Film,
  Grid,
  Hand,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  QrCode,
  Radar,
  Ruler,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  AudioTrack,
  Campaign,
  CampaignMember,
  CampaignNote,
  CampaignTheme,
  CharacterSheet,
  DiceRoll,
  FogStroke,
  GridConfig,
  Handout,
  LiveTableState,
  Scene,
  SceneToken,
  SceneWall,
  SheetBlock,
} from '../types/vtt';
import { applyCampaignTheme, DEFAULT_THEME, getSceneEffects, sanitizeTheme } from '../lib/themes';
import { audioEngine } from '../lib/audioEngine';
import { evaluateDiceFormula, isDiceFormula, type RollMode } from '../lib/diceEngine';
import { resolveMediaUrl } from '../lib/mediaStore';
import { buildAppUrl } from '../lib/router';
import {
  activateScene,
  broadcastLiveState,
  createAudioTrack,
  createCharacterSheet,
  createHandout,
  createNote,
  createScene,
  deleteAudioTrack,
  deleteCharacterSheet,
  deleteHandout,
  deleteNote,
  deleteScene,
  projectHandoutToAll,
  recordDiceRoll,
  sendHandoutToPlayer,
  subscribeCampaignDoc,
  subscribeCampaignMembers,
  subscribeGMAudioTracks,
  subscribeGMHandouts,
  subscribeGMNotes,
  subscribeGMScenes,
  subscribeLiveState,
  subscribeRolls,
  subscribeSheets,
  toLiveSceneSnapshot,
  triggerShakePulse,
  updateAudioTrackDsp,
  updateCampaignFolders,
  updateCampaignTheme,
  updateCharacterSheet,
  updateNote,
  updateSceneFog,
  updateSceneGrid,
  updateSceneMeta,
  updateSceneTokens,
  updateSceneWalls,
} from '../lib/vttService';
import { TabletopCanvas, type CanvasTool } from '../components/TabletopCanvas';
import { SceneEffectsStage } from '../components/SceneEffectsOverlay';
import { DiceRollOverlay, type ActiveDiceAnimation } from '../components/DiceRollOverlay';
import { HandoutOverlay } from '../components/HandoutOverlay';
import { ScenesHandoutsPanel } from '../components/ScenesHandoutsPanel';
import { CharacterSheetPanel } from '../components/CharacterSheetPanel';
import { DiceChatPanel } from '../components/DiceChatPanel';
import { WikiNotesPanel } from '../components/WikiNotesPanel';
import { AudioMixerPanel } from '../components/AudioMixerPanel';
import { ThemePanel } from '../components/ThemePanel';
import { RoomQrModal } from '../components/RoomQrModal';

type DrawerTab = 'scenes' | 'sheets' | 'dice' | 'wiki' | 'audio' | 'theme';

interface GMWorkspaceProps {
  user: User;
  campaignId: string;
  onExit: () => void;
}

export function GMWorkspace({ user, campaignId, onExit }: GMWorkspaceProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [liveState, setLiveState] = useState<LiveTableState | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [sheets, setSheets] = useState<CharacterSheet[]>([]);
  const [notes, setNotes] = useState<CampaignNote[]>([]);
  const [rolls, setRolls] = useState<DiceRoll[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [members, setMembers] = useState<CampaignMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Ergonomic single-drawer & canvas controls
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab>('scenes');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<CanvasTool>('move');
  const [fogBrushRadius, setFogBrushRadius] = useState(0.08);
  const [showGridPopover, setShowGridPopover] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [previewHandout, setPreviewHandout] = useState(false);
  const [toast, setToast] = useState('');
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);

  // Audio playback UI sync
  const [audioIds, setAudioIds] = useState(audioEngine.getActiveTrackIds());
  // Preloaded scene thumbnail cache
  const [sceneThumbs, setSceneThumbs] = useState<Record<string, string>>({});
  const preloadedRef = useRef<Set<string>>(new Set());

  // Optimistic local state for 0ms instant customization, FX, shake, and token edits
  const [localTheme, setLocalTheme] = useState<CampaignTheme | null>(null);
  const [localShakePulseMs, setLocalShakePulseMs] = useState<number>(0);
  const themeSaveTimerRef = useRef<number | null>(null);
  const pendingThemeRef = useRef<CampaignTheme | null>(null);
  const tokenSaveTimerRef = useRef<number | null>(null);
  const pendingTokensRef = useRef<{ scene: Scene; tokens: SceneToken[] } | null>(null);
  const liveStateRef = useRef<LiveTableState | null>(null);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  function notify(msg: string) {
    setToast(msg);
  }

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Subscriptions
  useEffect(() => {
    setLoading(true);
    setLocalTheme(null);
    const unsubs = [
      subscribeCampaignDoc(campaignId, (doc) => {
        setCampaign(doc);
        setLoading(false);
      }),
      subscribeLiveState(campaignId, setLiveState),
      subscribeGMScenes(campaignId, user.uid, setScenes),
      subscribeGMHandouts(campaignId, user.uid, setHandouts),
      subscribeSheets(campaignId, 'gmUid', user.uid, setSheets),
      subscribeGMNotes(campaignId, user.uid, setNotes),
      subscribeRolls(campaignId, 'gmUid', user.uid, setRolls),
      subscribeGMAudioTracks(campaignId, user.uid, setAudioTracks),
      subscribeCampaignMembers(campaignId, user.uid, setMembers),
    ];
    return () => {
      unsubs.forEach((u) => u());
      audioEngine.stopAll();
      // Flush any pending theme/token debounce on unmount
      if (themeSaveTimerRef.current) {
        window.clearTimeout(themeSaveTimerRef.current);
        themeSaveTimerRef.current = null;
        if (pendingThemeRef.current) {
          void updateCampaignTheme(campaignId, pendingThemeRef.current, liveStateRef.current).catch(() => {});
          pendingThemeRef.current = null;
        }
      }
      if (tokenSaveTimerRef.current) {
        window.clearTimeout(tokenSaveTimerRef.current);
        tokenSaveTimerRef.current = null;
        if (pendingTokensRef.current) {
          const { scene, tokens } = pendingTokensRef.current;
          void updateSceneTokens(campaignId, scene, tokens, true, liveStateRef.current).catch(() => {});
          pendingTokensRef.current = null;
        }
      }
    };
  }, [campaignId, user.uid]);

  // Sync incoming Firestore campaign theme only when no local edit is pending
  useEffect(() => {
    if (!campaign?.theme) return;
    if (pendingThemeRef.current) return;
    const clean = sanitizeTheme(campaign.theme);
    setLocalTheme(clean);
  }, [campaign?.theme]);

  const effectiveTheme = useMemo(
    () => localTheme || (campaign?.theme ? sanitizeTheme(campaign.theme) : DEFAULT_THEME),
    [localTheme, campaign?.theme]
  );

  // Apply campaign-specific visual theme & typography immediately
  useEffect(() => {
    applyCampaignTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Preload all scene images in memory for zero-lag switching during tabletop sessions
  useEffect(() => {
    let alive = true;
    Promise.all(
      scenes.map(async (s) => {
        const url = await resolveMediaUrl(s.mediaId, s.imageUrl, campaignId);
        if (url && s.mediaKind !== 'video' && !preloadedRef.current.has(url)) {
          preloadedRef.current.add(url);
          const img = new Image();
          img.src = url;
        }
        return [s.id, url] as const;
      })
    ).then((pairs) => {
      if (!alive) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) {
        if (url) map[id] = url;
      }
      setSceneThumbs(map);
    });
    return () => {
      alive = false;
    };
  }, [scenes, campaignId]);

  const activeScene = useMemo(() => {
    if (scenes.length === 0) return null;
    return scenes.find((s) => s.id === campaign?.activeSceneId) || scenes[0];
  }, [scenes, campaign?.activeSceneId]);

  const activeSceneForCanvas = useMemo(() => {
    if (!activeScene) return null;
    // GM sees ALL tokens (including hiddenFromPlayers)
    return {
      ...toLiveSceneSnapshot(activeScene),
      tokens: activeScene.tokens,
    };
  }, [activeScene]);

  const uploadContext = useMemo(
    () => ({
      campaignId,
      gmUid: campaign?.gmUid || user.uid,
      uploaderUid: user.uid,
    }),
    [campaignId, campaign?.gmUid, user.uid]
  );

  // Keyboard shortcuts for low-friction GM flow: G = Grid, R = Ruler, V = Move, F = Focus Mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'g' && activeScene) {
        e.preventDefault();
        void handleGridUpdate({ ...activeScene.grid, enabled: !activeScene.grid.enabled });
      } else if (key === 'r') {
        e.preventDefault();
        setActiveTool((t) => (t === 'ruler' ? 'move' : 'ruler'));
      } else if (key === 'v') {
        e.preventDefault();
        setActiveTool('move');
      } else if (key === 'f') {
        e.preventDefault();
        setDrawerOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeScene, liveState]);

  async function handleSelectScene(scene: Scene) {
    if (!campaign) return;
    await activateScene(campaign.id, scene, liveState);

    // Automatically crossfade scene-linked user Music and Ambience tracks
    let audioTriggered = false;
    try {
      if (scene.linkedMusicId) {
        const mTrack = audioTracks.find((t) => t.id === scene.linkedMusicId);
        if (mTrack && audioEngine.getActiveTrackIds().musicId !== mTrack.id) {
          await audioEngine.playTrack(mTrack, campaign.id);
          audioTriggered = true;
        }
      }
      if (scene.linkedAmbienceId) {
        const aTrack = audioTracks.find((t) => t.id === scene.linkedAmbienceId);
        if (aTrack && audioEngine.getActiveTrackIds().ambienceId !== aTrack.id) {
          await audioEngine.playTrack(aTrack, campaign.id);
          audioTriggered = true;
        }
      }
    } catch {
      // Ignore autoplay restriction or missing file silently on scene switch
    }
    setAudioIds(audioEngine.getActiveTrackIds());
    notify(
      audioTriggered
        ? `Cena "${scene.name}" ativada com trilha vinculada.`
        : `Cena "${scene.name}" ativada.`
    );
  }

  async function handleGridUpdate(nextGrid: GridConfig) {
    if (!campaign || !activeScene) return;
    setScenes((prev) =>
      prev.map((s) => (s.id === activeScene.id ? { ...s, grid: nextGrid } : s))
    );
    try {
      await updateSceneGrid(campaign.id, activeScene, nextGrid, true, liveState);
    } catch {
      notify('Não foi possível salvar a configuração do grid.');
    }
  }

  async function handleFogToggle() {
    if (!campaign || !activeScene) return;
    const nextEnabled = !activeScene.fogEnabled;
    try {
      await updateSceneFog(campaign.id, activeScene, nextEnabled, activeScene.fogStrokes, true, liveState);
      if (nextEnabled) {
        setActiveTool('fog_reveal');
        notify('Névoa ativada (100% opaca na Tela dos Jogadores).');
      } else {
        if (activeTool === 'fog_reveal' || activeTool === 'fog_hide') {
          setActiveTool('move');
        }
        notify('Névoa desativada nesta cena.');
      }
    } catch {
      notify('Erro ao atualizar a névoa.');
    }
  }

  async function handleFogStrokesChange(strokes: FogStroke[]) {
    if (!campaign || !activeScene) return;
    setScenes((prev) =>
      prev.map((s) => (s.id === activeScene.id ? { ...s, fogStrokes: strokes } : s))
    );
    try {
      await updateSceneFog(campaign.id, activeScene, activeScene.fogEnabled, strokes, true, liveState);
    } catch {
      notify('Erro ao sincronizar traços da névoa.');
    }
  }

  async function handleResetFog(revealAll: boolean) {
    if (!campaign || !activeScene) return;
    const strokes: FogStroke[] = revealAll
      ? [{ id: `fg_all_${Date.now()}`, mode: 'reveal', shape: 'rect', x: 0, y: 0, w: 1, h: 1 }]
      : [];
    try {
      await updateSceneFog(campaign.id, activeScene, true, strokes, true, liveState);
      notify(revealAll ? 'Mapa inteiro revelado.' : 'Névoa fechada por completo.');
    } catch {
      notify('Erro ao atualizar a névoa.');
    }
  }

  async function handleTokensChange(tokens: SceneToken[]) {
    if (!campaign || !activeScene) return;
    const targetScene = activeScene;
    // 1. Immediate optimistic UI update so sliders, color pickers, buffs, hit recoil & drag feel 60fps instant
    setScenes((prev) =>
      prev.map((s) => (s.id === targetScene.id ? { ...s, tokens } : s))
    );
    // 2. Immediate zero-latency Second Screen TV sync via BroadcastChannel
    if (liveStateRef.current) {
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot({ ...targetScene, tokens }),
      });
    }
    // 3. Debounced Firestore persistence (180ms) so continuous slider/color dragging never floods writes
    pendingTokensRef.current = { scene: targetScene, tokens };
    if (tokenSaveTimerRef.current) {
      window.clearTimeout(tokenSaveTimerRef.current);
    }
    const campId = campaign.id;
    tokenSaveTimerRef.current = window.setTimeout(() => {
      tokenSaveTimerRef.current = null;
      const latest = pendingTokensRef.current;
      pendingTokensRef.current = null;
      if (!latest) return;
      void updateSceneTokens(campId, latest.scene, latest.tokens, true, liveStateRef.current).catch(
        () => {
          notify('Erro ao salvar alterações do token na nuvem.');
        }
      );
    }, 180);
  }

  async function handleWallsChange(walls: SceneWall[]) {
    if (!campaign || !activeScene) return;
    const autoVision = walls.length > 0 ? true : Boolean(activeScene.dynamicVision);
    setScenes((prev) =>
      prev.map((s) =>
        s.id === activeScene.id ? { ...s, walls, dynamicVision: autoVision } : s
      )
    );
    try {
      await updateSceneWalls(campaign.id, activeScene, walls, autoVision, true, liveState);
    } catch {
      notify('Erro ao salvar muros e portas.');
    }
  }

  async function handleToggleDynamicVision() {
    if (!campaign || !activeScene) return;
    const next = !activeScene.dynamicVision;
    try {
      await updateSceneWalls(
        campaign.id,
        activeScene,
        activeScene.walls || [],
        next,
        true,
        liveState
      );
      notify(
        next
          ? 'Campo de Visão Dinâmico ativado (respeita muros e portas).'
          : 'Campo de Visão Dinâmico pausado.'
      );
    } catch {
      notify('Erro ao alternar visão dinâmica.');
    }
  }

  async function handleProjectHandout(handout: ActiveHandoutProjection | null) {
    if (!campaign) return;
    await projectHandoutToAll(campaign.id, handout, liveState);
    if (handout) {
      notify(`"${handout.title}" projetado na Tela dos Jogadores.`);
    } else {
      setPreviewHandout(false);
      notify('Projeção recolhida.');
    }
  }

  async function handleDiceOrChat(params: {
    input: string;
    label?: string;
    mode: RollMode;
    explode: boolean;
    visibility: 'public' | 'gm_only';
    blocks?: SheetBlock[];
    rollerName?: string;
  }) {
    if (!campaign) return;
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

    const rollerDisplay = params.rollerName || `${user.displayName || 'Mestre'} (Mestre)`;

    // Trigger dynamic tumbling dice animation immediately on click
    if (evalResult.outcome !== 'chat') {
      setActiveRollAnim({
        id: `anim_${Date.now()}`,
        rollerName: rollerDisplay,
        label: params.label || 'Rolagem de Dados',
        formula: evalResult.formula,
        total: evalResult.total,
        summary:
          params.visibility === 'gm_only'
            ? `${evalResult.summary} (Oculta)`
            : evalResult.summary,
        outcome: evalResult.outcome,
      });
    }

    await recordDiceRoll({
      campaignId: campaign.id,
      gmUid: campaign.gmUid,
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
      currentRecentPublicRolls: liveState?.recentPublicRolls || [],
      liveState,
    });
  }

  function handleThemeChange(theme: CampaignTheme) {
    if (!campaign) return;
    const clean = sanitizeTheme(theme);
    // 1. Apply at 0ms latency locally (UI, CSS vars, fonts, and live FX overlays)
    setLocalTheme(clean);
    applyCampaignTheme(clean);
    // 2. Instant zero-latency sync with Second Screen TV tab on same machine
    if (liveStateRef.current) {
      broadcastLiveState(campaign.id, { ...liveStateRef.current, theme: clean });
    }
    // 3. Debounced Firestore persistence (220ms) so dragging color/FX sliders never snaps back
    pendingThemeRef.current = clean;
    if (themeSaveTimerRef.current) {
      window.clearTimeout(themeSaveTimerRef.current);
    }
    const campId = campaign.id;
    themeSaveTimerRef.current = window.setTimeout(() => {
      themeSaveTimerRef.current = null;
      const toSave = pendingThemeRef.current;
      if (!toSave) return;
      void updateCampaignTheme(campId, toSave, liveStateRef.current)
        .then(() => {
          if (pendingThemeRef.current === toSave) {
            pendingThemeRef.current = null;
          }
        })
        .catch(() => {
          if (pendingThemeRef.current === toSave) {
            pendingThemeRef.current = null;
          }
          notify('Não foi possível salvar o visual na nuvem.');
        });
    }, 220);
  }

  async function handleShakePulse() {
    if (!campaign) return;
    const now = Date.now();
    // Trigger immediately on the GM canvas at 0ms latency
    setLocalShakePulseMs(now);
    try {
      await triggerShakePulse(campaign.id, liveStateRef.current);
    } catch {
      notify('Erro ao sincronizar tremor com a TV.');
    }
  }

  if (loading) {
    return (
      <div className="h-screen vtt-canvas flex items-center justify-center">
        <p className="text-sm font-typewriter vtt-muted">Carregando mesa e pré-carregando cenas...</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="h-screen vtt-canvas flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-bold font-typewriter">Campanha não encontrada</p>
        <button type="button" onClick={onExit} className="px-4 py-2 text-xs font-semibold vtt-accent-btn">
          Voltar às campanhas
        </button>
      </div>
    );
  }

  const secondScreenHref = buildAppUrl(`/screen/${campaign.id}`);
  const sceneEffects = getSceneEffects(effectiveTheme);
  const effectiveShakePulseMs = Math.max(localShakePulseMs, liveState?.shakePulseMs || 0);

  const drawerButtons: Array<{ id: DrawerTab; label: string; icon: typeof Layers }> = [
    { id: 'scenes', label: 'Cenas', icon: Layers },
    { id: 'sheets', label: 'Fichas', icon: FileSpreadsheet },
    { id: 'dice', label: 'Dados', icon: Dices },
    { id: 'wiki', label: 'Wiki', icon: BookOpen },
    { id: 'audio', label: 'Áudio', icon: Volume2 },
    { id: 'theme', label: 'Visual', icon: Palette },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col vtt-canvas">
      {/* Clean 3-Zone Top Bar */}
      <header className="h-14 px-4 border-b vtt-border vtt-surface flex items-center justify-between gap-4 shrink-0 z-30">
        {/* Zone 1: Back + Campaign Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onExit}
            className="p-2 border vtt-border vtt-muted hover:opacity-100 shrink-0"
            title="Voltar às campanhas"
            aria-label="Voltar às campanhas"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-base font-bold font-typewriter truncate">
            {campaign.title}
          </span>
        </div>

        {/* Zone 2: Direct Tabletop Tool Controls */}
        <div className="hidden md:flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTool('move')}
            className={`px-3 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'move' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-canvas vtt-border'
            }`}
            title="Mover tokens (V)"
          >
            <Hand className="w-3.5 h-3.5" />
            Mover
          </button>

          <button
            type="button"
            onClick={() => setActiveTool((t) => (t === 'ruler' ? 'move' : 'ruler'))}
            className={`px-3 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'ruler' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-canvas vtt-border'
            }`}
            title="Régua rápida (R) — some ao soltar o clique"
          >
            <Ruler className="w-3.5 h-3.5" />
            Régua
          </button>

          <button
            type="button"
            onClick={() => void handleFogToggle()}
            className={`px-3 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeScene?.fogEnabled ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-canvas vtt-border'
            }`}
            title="Ligar/desligar Névoa de Guerra"
          >
            <CloudFog className="w-3.5 h-3.5" />
            {activeScene?.fogEnabled ? 'Névoa ativa' : 'Névoa'}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTool((t) =>
                t === 'wall' || t === 'door' || t === 'wall_erase' ? 'move' : 'wall'
              )
            }
            className={`px-3 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Desenhar muros e portas que bloqueiam visão dos jogadores"
          >
            <BrickWall className="w-3.5 h-3.5" />
            Muros
          </button>

          {activeScene && (
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() =>
                  void handleGridUpdate({ ...activeScene.grid, enabled: !activeScene.grid.enabled })
                }
                className={`px-3 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeScene.grid.enabled ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-canvas vtt-border'
                }`}
                title="Ligar/desligar Grid instantaneamente (G)"
              >
                <Grid className="w-3.5 h-3.5" />
                Grid
              </button>
              <button
                type="button"
                onClick={() => setShowGridPopover((v) => !v)}
                className="px-2 py-1.5 text-xs border border-l-0 vtt-border vtt-canvas hover:opacity-80"
                title="Calibrar escala do grid para miniaturas físicas"
                aria-label="Calibrar grid"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              {/* Grid Physical Scale Calibration Popover */}
              {showGridPopover && (
                <div className="absolute top-11 left-0 w-72 vtt-surface border p-4 shadow-xl space-y-3 z-40">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold font-typewriter">Calibração de Grid</p>
                    <button
                      type="button"
                      onClick={() => setShowGridPopover(false)}
                      className="text-[11px] vtt-muted"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="p-2.5 vtt-subtle border vtt-border space-y-1.5">
                    <p className="text-[11px] vtt-muted">
                      Apoie uma miniatura física (25 mm) neste quadrado para calibrar a TV:
                    </p>
                    <div className="flex items-center gap-3">
                      <div
                        className="border-2 border-dashed flex items-center justify-center text-[10px] tabular-nums shrink-0"
                        style={{
                          width: `${Math.min(110, activeScene.grid.cellSizePx)}px`,
                          height: `${Math.min(110, activeScene.grid.cellSizePx)}px`,
                          borderColor: 'var(--accent-primary)',
                        }}
                      >
                        {activeScene.grid.cellSizePx}px
                      </div>
                      <span className="text-[11px] vtt-muted tabular-nums">
                        1 quadrado = {activeScene.grid.unitValue} {activeScene.grid.unitLabel}
                      </span>
                    </div>
                  </div>

                  <label className="block space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Tamanho do quadrado</span>
                      <span className="tabular-nums">{activeScene.grid.cellSizePx}px</span>
                    </div>
                    <input
                      type="range"
                      min={24}
                      max={160}
                      value={activeScene.grid.cellSizePx}
                      onChange={(e) =>
                        void handleGridUpdate({
                          ...activeScene.grid,
                          enabled: true,
                          cellSizePx: Number(e.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </label>

                  <label className="block space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Opacidade das linhas</span>
                      <span className="tabular-nums">{Math.round(activeScene.grid.opacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={activeScene.grid.opacity}
                      onChange={(e) =>
                        void handleGridUpdate({ ...activeScene.grid, opacity: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="space-y-1">
                      <span className="text-[11px] vtt-muted">Escala / quadrado</span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        value={activeScene.grid.unitValue}
                        onChange={(e) =>
                          void handleGridUpdate({
                            ...activeScene.grid,
                            unitValue: Math.max(0.5, Number(e.target.value)),
                          })
                        }
                        className="w-full px-2 py-1 border vtt-border vtt-canvas tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] vtt-muted">Unidade</span>
                      <input
                        type="text"
                        maxLength={8}
                        value={activeScene.grid.unitLabel}
                        onChange={(e) =>
                          void handleGridUpdate({
                            ...activeScene.grid,
                            unitLabel: e.target.value || 'm',
                          })
                        }
                        className="w-full px-2 py-1 border vtt-border vtt-canvas"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick 1-click Impact Shake Button */}
          <button
            type="button"
            onClick={() => void handleShakePulse()}
            className="px-2.5 py-1.5 text-xs border vtt-border vtt-canvas hover:opacity-80 flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Disparar tremor de impacto na mesa e na TV"
          >
            <Activity className="w-3.5 h-3.5 vtt-accent-text" />
            Tremor
          </button>
        </div>

        {/* Zone 3: QR Room + Primary CTA (Second Screen) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="px-3 py-2 text-xs border vtt-border vtt-canvas hover:opacity-80 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            title="QR Code para celulares dos jogadores"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sala {campaign.roomCode}</span>
          </button>

          <a
            href={secondScreenHref}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tela dos Jogadores</span>
            <span className="sm:hidden">TV</span>
          </a>
        </div>
      </header>

      {/* Main Split: Sovereign Stage + Single Right Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left/Center Stage Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {/* Active Fog Sub-toolbar (only visible when Fog is enabled on active scene) */}
          {activeScene?.fogEnabled && (
            <div className="px-4 py-2 border-b vtt-border vtt-subtle flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">Névoa:</span>
                <button
                  type="button"
                  onClick={() => setActiveTool('fog_reveal')}
                  className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                    activeTool === 'fog_reveal' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Revelar
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('fog_hide')}
                  className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                    activeTool === 'fog_hide' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Cobrir
                </button>
                <label className="flex items-center gap-1.5 pl-2">
                  <span className="vtt-muted">Pincel</span>
                  <input
                    type="range"
                    min={0.03}
                    max={0.18}
                    step={0.01}
                    value={fogBrushRadius}
                    onChange={(e) => setFogBrushRadius(Number(e.target.value))}
                    className="w-20"
                  />
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleResetFog(true)}
                  className="px-2.5 py-1 border vtt-border vtt-surface hover:opacity-80 whitespace-nowrap"
                >
                  Revelar tudo
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetFog(false)}
                  className="px-2.5 py-1 border vtt-border vtt-surface hover:opacity-80 flex items-center gap-1 whitespace-nowrap"
                >
                  <Eraser className="w-3 h-3" />
                  Cobrir tudo
                </button>
              </div>
            </div>
          )}

          {/* Contextual Walls & Doors Sub-toolbar (only visible when editing walls — keeps UI calm) */}
          {activeScene &&
            (activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase') && (
              <div className="px-4 py-2 border-b vtt-border vtt-subtle flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">Muros & Portas:</span>
                  <button
                    type="button"
                    onClick={() => setActiveTool('wall')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'wall' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border'
                    }`}
                  >
                    <BrickWall className="w-3.5 h-3.5" />
                    Desenhar Muro
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool('door')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'door' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border'
                    }`}
                  >
                    <DoorClosed className="w-3.5 h-3.5" />
                    Desenhar Porta
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool('wall_erase')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'wall_erase' ? 'vtt-accent-btn border-transparent font-semibold' : 'vtt-surface vtt-border'
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    Apagar
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleToggleDynamicVision()}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeScene.dynamicVision
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border'
                    }`}
                    title="Ativa sombra de linha de visão para tokens com 'Emite Campo de Visão'"
                  >
                    <Radar className="w-3.5 h-3.5" />
                    {activeScene.dynamicVision ? 'Visão Dinâmica: ON' : 'Visão Dinâmica: OFF'}
                  </button>
                  {(activeScene.walls?.length || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleWallsChange([])}
                      className="px-2.5 py-1 border vtt-border vtt-surface hover:opacity-80 whitespace-nowrap"
                    >
                      Limpar muros
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTool('move')}
                    className="px-2.5 py-1 border vtt-border vtt-surface hover:opacity-80 whitespace-nowrap"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            )}

          {/* Active Projected Handout Banner */}
          {liveState?.activeHandout && (
            <div className="px-4 py-2 border-b vtt-border vtt-accent-btn flex items-center justify-between gap-3 text-xs shrink-0">
              <span className="truncate font-semibold">
                Projetando na TV: {liveState.activeHandout.title}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewHandout(true)}
                  className="px-2.5 py-1 bg-black/20 hover:bg-black/30 flex items-center gap-1 whitespace-nowrap"
                >
                  <Maximize2 className="w-3 h-3" />
                  Ver
                </button>
                <button
                  type="button"
                  onClick={() => void handleProjectHandout(null)}
                  className="px-2.5 py-1 bg-black/30 hover:bg-black/45 font-semibold whitespace-nowrap"
                >
                  Recolher
                </button>
              </div>
            </div>
          )}

          {/* Sovereign Tabletop Canvas wrapped with Dynamic Scene Visual FX */}
          <div className="flex-1 min-h-0 relative">
            <SceneEffectsStage
              effects={sceneEffects}
              shakePulseMs={effectiveShakePulseMs}
              className="w-full h-full"
            >
              <TabletopCanvas
                campaignId={campaign.id}
                uploadContext={uploadContext}
                scene={activeSceneForCanvas}
                mode="gm"
                activeTool={activeTool}
                fogBrushRadius={fogBrushRadius}
                onTokensChange={(t) => void handleTokensChange(t)}
                onFogStrokesChange={(s) => void handleFogStrokesChange(s)}
                onWallsChange={(w) => void handleWallsChange(w)}
                onShowTokenPopup={(h) => void handleProjectHandout(h)}
                onNotify={notify}
              />
            </SceneEffectsStage>

            {/* Toast Notification */}
            {toast && (
              <div className="absolute bottom-3 left-3 z-30 px-3.5 py-2 text-xs font-semibold vtt-surface border shadow-md">
                {toast}
              </div>
            )}
          </div>

          {/* Quick-Switch Scene Dock (Preloaded thumbnails for zero-lag switching) */}
          <div className="h-24 border-t vtt-border vtt-surface px-3 py-2 flex items-center gap-2.5 overflow-x-auto shrink-0">
            {scenes.map((scene) => {
              const isActive = activeScene?.id === scene.id;
              const thumb = sceneThumbs[scene.id];
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => void handleSelectScene(scene)}
                  className={`relative h-full w-36 shrink-0 border overflow-hidden text-left transition-transform active:scale-[0.98] ${
                    isActive ? 'ring-2' : 'vtt-border opacity-80 hover:opacity-100'
                  }`}
                  style={
                    isActive
                      ? { borderColor: 'var(--accent-primary)', boxShadow: '0 0 0 1px var(--accent-primary)' }
                      : undefined
                  }
                >
                  {thumb ? (
                    scene.mediaKind === 'video' ? (
                      <video
                        src={thumb}
                        muted
                        playsInline
                        className="w-full h-full object-cover bg-black"
                      />
                    ) : (
                      <img
                        src={thumb}
                        alt={scene.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full vtt-subtle flex items-center justify-center">
                      {scene.mediaKind === 'video' ? (
                        <Film className="w-5 h-5 vtt-muted" />
                      ) : (
                        <ImageIcon className="w-5 h-5 vtt-muted" />
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent text-stone-100">
                    <p className="text-[11px] font-semibold truncate">{scene.name}</p>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setActiveDrawer('scenes');
                setDrawerOpen(true);
              }}
              className="h-full px-4 border border-dashed vtt-border vtt-muted hover:opacity-100 text-xs whitespace-nowrap shrink-0"
            >
              + Nova cena
            </button>
          </div>
        </div>

        {/* Ergonomic Single Active Right Drawer (ADHD-friendly: 1 focused tool at a time) */}
        {drawerOpen && (
          <aside className="w-80 sm:w-96 border-l vtt-border vtt-surface flex flex-col shrink-0 min-h-0">
            {activeDrawer === 'scenes' && (
              <ScenesHandoutsPanel
                uploadContext={uploadContext}
                scenes={scenes}
                activeScene={activeScene}
                handouts={handouts}
                activeHandout={liveState?.activeHandout || null}
                audioTracks={audioTracks}
                members={members}
                sheets={sheets}
                onSelectScene={(s) => void handleSelectScene(s)}
                onCreateScene={async (data) => {
                  const id = await createScene({
                    campaignId: campaign.id,
                    gmUid: user.uid,
                    ...data,
                    order: scenes.length,
                  });
                  const created: Scene = {
                    id,
                    campaignId: campaign.id,
                    gmUid: user.uid,
                    name: data.name,
                    category: data.category,
                    imageUrl: data.imageUrl,
                    mediaId: data.mediaId,
                    mediaKind: data.mediaKind,
                    order: scenes.length,
                    grid: {
                      enabled: data.category === 'tactical',
                      cellSizePx: 58,
                      unitLabel: 'm',
                      unitValue: 1.5,
                      opacity: 0.4,
                      offsetX: 0,
                      offsetY: 0,
                    },
                    fogEnabled: false,
                    fogStrokes: [],
                    walls: [],
                    dynamicVision: false,
                    tokens: [],
                    linkedMusicId: data.linkedMusicId,
                    linkedAmbienceId: data.linkedAmbienceId,
                  };
                  await handleSelectScene(created);
                }}
                onUpdateSceneAudio={async (scene, musicId, ambienceId) => {
                  await updateSceneMeta(campaign.id, scene.id, {
                    name: scene.name,
                    category: scene.category,
                    imageUrl: scene.imageUrl,
                    mediaId: scene.mediaId,
                    order: scene.order,
                    linkedMusicId: musicId,
                    linkedAmbienceId: ambienceId,
                  });
                  notify('Trilha vinculada à cena salva.');
                }}
                onDeleteScene={async (sceneId) => {
                  await deleteScene(campaign.id, sceneId);
                  notify('Cena removida.');
                }}
                onAddTokenToScene={async (token) => {
                  if (!activeScene) return;
                  await handleTokensChange([...activeScene.tokens, token]);
                }}
                onUpdateSceneTokens={async (tokens) => {
                  await handleTokensChange(tokens);
                }}
                onCreateHandout={async (data) => {
                  await createHandout({
                    campaignId: campaign.id,
                    gmUid: user.uid,
                    ...data,
                  });
                }}
                onProjectHandout={handleProjectHandout}
                onSendHandoutToPlayer={async (hid, targetUid) => {
                  await sendHandoutToPlayer(campaign.id, hid, targetUid);
                }}
                onDeleteHandout={async (hid) => {
                  await deleteHandout(campaign.id, hid);
                  if (liveState?.activeHandout?.id === hid) {
                    await handleProjectHandout(null);
                  }
                }}
                onNotify={notify}
              />
            )}

            {activeDrawer === 'sheets' && (
              <CharacterSheetPanel
                uploadContext={uploadContext}
                sheets={sheets}
                onCreateSheet={(payload) =>
                  createCharacterSheet({
                    campaignId: campaign.id,
                    gmUid: campaign.gmUid,
                    ownerUid: user.uid,
                    ownerName: user.displayName || 'Mestre',
                    ...payload,
                  })
                }
                onUpdateSheet={(sheet) =>
                  updateCharacterSheet(campaign.id, sheet.id, {
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
                onDeleteSheet={(sheetId) => deleteCharacterSheet(campaign.id, sheetId)}
                onRollFromSheet={async ({ sheetName, label, formula, blocks }) => {
                  await handleDiceOrChat({
                    input: formula,
                    label,
                    mode: 'normal',
                    explode: false,
                    visibility: 'public',
                    blocks,
                    rollerName: sheetName,
                  });
                }}
                onNotify={notify}
              />
            )}

            {activeDrawer === 'dice' && (
              <DiceChatPanel
                rolls={rolls}
                isGM
                onExecuteInput={(p) => handleDiceOrChat(p)}
              />
            )}

            {activeDrawer === 'wiki' && (
              <WikiNotesPanel
                notes={notes}
                savedFolders={campaign.folders}
                onSaveFolders={(folders) => updateCampaignFolders(campaign.id, folders)}
                onCreateNote={(data) =>
                  createNote({
                    campaignId: campaign.id,
                    gmUid: user.uid,
                    ...data,
                    existingNotes: notes,
                  })
                }
                onUpdateNote={(noteId, updates) => updateNote(campaign.id, noteId, updates, notes)}
                onDeleteNote={(noteId) => deleteNote(campaign.id, noteId, notes)}
                onNotify={notify}
              />
            )}

            {activeDrawer === 'audio' && (
              <AudioMixerPanel
                uploadContext={uploadContext}
                tracks={audioTracks}
                activeMusicId={audioIds.musicId}
                activeAmbienceId={audioIds.ambienceId}
                onSyncAudioUi={() => setAudioIds(audioEngine.getActiveTrackIds())}
                onAddTrack={async (data) => {
                  await createAudioTrack({
                    campaignId: campaign.id,
                    gmUid: user.uid,
                    ...data,
                  });
                }}
                onUpdateTrackDsp={(trackId, dsp) => updateAudioTrackDsp(campaign.id, trackId, dsp)}
                onDeleteTrack={(id) => deleteAudioTrack(campaign.id, id)}
                onNotify={notify}
              />
            )}

            {activeDrawer === 'theme' && (
              <ThemePanel
                theme={effectiveTheme}
                onChangeTheme={(t) => handleThemeChange(t)}
                onTriggerShakePulse={() => void handleShakePulse()}
              />
            )}
          </aside>
        )}

        {/* Slim Ergonomic Vertical Tool Rail */}
        <nav
          aria-label="Painéis do Mestre"
          className="w-16 border-l vtt-border vtt-surface flex flex-col items-center py-2 gap-1 shrink-0"
        >
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="w-12 h-11 flex flex-col items-center justify-center gap-0.5 text-[10px] vtt-muted hover:opacity-100 border-b vtt-border mb-1"
            title="Modo Foco (F) — recolher/abrir painel"
          >
            {drawerOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
            <span>Foco</span>
          </button>

          {drawerButtons.map(({ id, label, icon: Icon }) => {
            const active = drawerOpen && activeDrawer === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (active) {
                    setDrawerOpen(false);
                  } else {
                    setActiveDrawer(id);
                    setDrawerOpen(true);
                  }
                }}
                className={`w-12 h-12 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
                  active ? 'vtt-accent-btn font-semibold' : 'vtt-muted hover:opacity-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="leading-none">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Room QR Code Modal */}
      {showQrModal && (
        <RoomQrModal
          campaign={campaign}
          members={members}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {/* Optional GM Preview of Projected Handout */}
      {previewHandout && liveState?.activeHandout && (
        <HandoutOverlay
          campaignId={campaign.id}
          handout={liveState.activeHandout}
          canDismiss
          dismissLabel="Fechar prévia"
          onDismiss={() => setPreviewHandout(false)}
        />
      )}

      {/* Dynamic Tumbling Dice Roll Animation */}
      <DiceRollOverlay roll={activeRollAnim} onComplete={clearRollAnim} position="bottom-right" />
    </div>
  );
}
