import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  BrickWall,
  Brush,
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
  Redo2,
  Ruler,
  SlidersHorizontal,
  Swords,
  Type,
  Undo2,
  Volume2,
} from 'lucide-react';
import type {
  ActiveDuelState,
  ActiveHandoutProjection,
  AudioTrack,
  BrushStyleId,
  Campaign,
  CampaignMember,
  CampaignNote,
  CampaignTheme,
  CharacterSheet,
  DiceRoll,
  DuelActionItem,
  FogStroke,
  GridConfig,
  Handout,
  LiveTableState,
  Scene,
  SceneDuelConfig,
  SceneToken,
  SceneWall,
  SheetBlock,
} from '../types/vtt';
import { applyCampaignTheme, DEFAULT_THEME, getSceneEffects, sanitizeTheme } from '../lib/themes';
import { audioEngine } from '../lib/audioEngine';
import { evaluateDiceFormula, isDiceFormula, type RollMode } from '../lib/diceEngine';
import { resolveMediaUrl } from '../lib/mediaStore';
import {
  findSheetForToken,
  loadSceneDuelConfig,
  saveSceneDuelConfig,
} from '../lib/duelEngine';
import {
  loadVaultAssets,
  removeAssetFromVault,
  saveAssetToVault,
  type VaultAssetItem,
} from '../lib/assetVault';
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
  syncLiveDuelState,
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
import { DuelArena3DOverlay, DuelSetupModal } from '../components/DuelArena3DOverlay';
import { ScenesHandoutsPanel } from '../components/ScenesHandoutsPanel';
import { CharacterSheetPanel } from '../components/CharacterSheetPanel';
import { DiceChatPanel } from '../components/DiceChatPanel';
import { WikiNotesPanel } from '../components/WikiNotesPanel';
import { AudioMixerPanel } from '../components/AudioMixerPanel';
import { ThemePanel } from '../components/ThemePanel';
import { RoomQrModal } from '../components/RoomQrModal';

type DrawerTab = 'scenes' | 'sheets' | 'dice' | 'wiki' | 'audio' | 'theme';

interface SceneHistorySnapshot {
  sceneId: string;
  tokens: SceneToken[];
  walls: SceneWall[];
  fogStrokes: FogStroke[];
  fogEnabled: boolean;
  dynamicVision: boolean;
}

const BRUSH_SWATCHES = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#a855f7',
  '#fdfbf7',
  '#141311',
];

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
  const [brushStyle, setBrushStyle] = useState<BrushStyleId>('pen');
  const [brushColor, setBrushColor] = useState('#ef4444');
  const [brushSize, setBrushSize] = useState(5);
  const [showGridPopover, setShowGridPopover] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [previewHandout, setPreviewHandout] = useState(false);
  const [toast, setToast] = useState('');
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);

  // Asset Vault (Acervo de Fotos & Itens para replicar em 1 clique)
  const [vaultAssets, setVaultAssets] = useState<VaultAssetItem[]>(() =>
    loadVaultAssets(campaignId)
  );

  // 3D Direct Confrontation / Duel Mode state
  const [duelSetupPair, setDuelSetupPair] = useState<{
    tokenA: SceneToken;
    tokenB: SceneToken;
  } | null>(null);
  const [activeDuel, setActiveDuel] = useState<ActiveDuelState | null>(null);
  const [sceneDuelConfig, setSceneDuelConfig] = useState<SceneDuelConfig>({
    bgUrl: '',
    bgMediaId: '',
    bgMediaKind: 'image',
    arenaPreset: 'expedition_ruins',
    musicTrackId: '',
  });
  const preDuelMusicIdRef = useRef<string | null>(null);

  // Undo / Redo History Stacks (Ctrl+Z / Ctrl+Y)
  const [undoStack, setUndoStack] = useState<SceneHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<SceneHistorySnapshot[]>([]);

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
  const lastLiveCloudSyncMsRef = useRef<number>(0);
  const liveStateRef = useRef<LiveTableState | null>(null);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    setVaultAssets(loadVaultAssets(campaignId));
  }, [campaignId]);

  function notify(msg: string) {
    setToast(msg);
  }

  const clearRollAnim = useCallback(() => setActiveRollAnim(null), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3000);
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
      if (themeSaveTimerRef.current) {
        window.clearTimeout(themeSaveTimerRef.current);
        themeSaveTimerRef.current = null;
        if (pendingThemeRef.current) {
          void updateCampaignTheme(
            campaignId,
            pendingThemeRef.current,
            liveStateRef.current
          ).catch(() => {});
          pendingThemeRef.current = null;
        }
      }
      if (tokenSaveTimerRef.current) {
        window.clearTimeout(tokenSaveTimerRef.current);
        tokenSaveTimerRef.current = null;
        if (pendingTokensRef.current) {
          const { scene, tokens } = pendingTokensRef.current;
          void updateSceneTokens(
            campaignId,
            scene,
            tokens,
            true,
            liveStateRef.current
          ).catch(() => {});
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

  useEffect(() => {
    applyCampaignTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Preload all scene images in memory for zero-lag switching
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

  useEffect(() => {
    setSceneDuelConfig(loadSceneDuelConfig(campaignId, activeScene));
  }, [campaignId, activeScene]);

  const activeSceneForCanvas = useMemo(() => {
    if (!activeScene) return null;
    return {
      ...toLiveSceneSnapshot(activeScene, activeDuel, sceneDuelConfig),
      tokens: activeScene.tokens,
    };
  }, [activeScene, activeDuel, sceneDuelConfig]);

  const uploadContext = useMemo(
    () => ({
      campaignId,
      gmUid: campaign?.gmUid || user.uid,
      uploaderUid: user.uid,
    }),
    [campaignId, campaign?.gmUid, user.uid]
  );

  // Record snapshot before mutating active scene so Ctrl+Z / Ctrl+Y works seamlessly
  function recordUndoSnapshot(scene: Scene) {
    const snap: SceneHistorySnapshot = {
      sceneId: scene.id,
      tokens: scene.tokens || [],
      walls: scene.walls || [],
      fogStrokes: scene.fogStrokes || [],
      fogEnabled: Boolean(scene.fogEnabled),
      dynamicVision: Boolean(scene.dynamicVision),
    };
    setUndoStack((prev) => [...prev.slice(-29), snap]);
    setRedoStack([]);
  }

  async function applyHistorySnapshot(snap: SceneHistorySnapshot) {
    if (!campaign) return;
    const target = scenes.find((s) => s.id === snap.sceneId);
    if (!target) return;
    const restored: Scene = {
      ...target,
      tokens: snap.tokens,
      walls: snap.walls,
      fogStrokes: snap.fogStrokes,
      fogEnabled: snap.fogEnabled,
      dynamicVision: snap.dynamicVision,
    };
    setScenes((prev) => prev.map((s) => (s.id === restored.id ? restored : s)));
    const isActive = activeScene?.id === restored.id;
    if (isActive && liveStateRef.current) {
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot(restored),
      });
    }
    try {
      await Promise.all([
        updateSceneTokens(campaign.id, restored, restored.tokens, isActive, liveStateRef.current),
        updateSceneWalls(
          campaign.id,
          restored,
          restored.walls || [],
          Boolean(restored.dynamicVision),
          isActive,
          liveStateRef.current
        ),
        updateSceneFog(
          campaign.id,
          restored,
          restored.fogEnabled,
          restored.fogStrokes,
          isActive,
          liveStateRef.current
        ),
      ]);
    } catch {
      // Ignore transient errors
    }
  }

  function handleUndo() {
    if (!activeScene || undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const currentSnap: SceneHistorySnapshot = {
      sceneId: activeScene.id,
      tokens: activeScene.tokens || [],
      walls: activeScene.walls || [],
      fogStrokes: activeScene.fogStrokes || [],
      fogEnabled: Boolean(activeScene.fogEnabled),
      dynamicVision: Boolean(activeScene.dynamicVision),
    };
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-29), currentSnap]);
    void applyHistorySnapshot(last);
    notify('Desfeito (Ctrl+Z)');
  }

  function handleRedo() {
    if (!activeScene || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const currentSnap: SceneHistorySnapshot = {
      sceneId: activeScene.id,
      tokens: activeScene.tokens || [],
      walls: activeScene.walls || [],
      fogStrokes: activeScene.fogStrokes || [],
      fogEnabled: Boolean(activeScene.fogEnabled),
      dynamicVision: Boolean(activeScene.dynamicVision),
    };
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-29), currentSnap]);
    void applyHistorySnapshot(next);
    notify('Refeito (Ctrl+Y)');
  }

  function handleSaveTokenToVault(token: SceneToken) {
    if (!token.imageUrl && !token.mediaId) return;
    const next = saveAssetToVault(campaignId, {
      name: token.name || 'Item',
      imageUrl: token.imageUrl || '',
      mediaId: token.mediaId || '',
      defaultKind: token.layerKind === 'image' || token.shape === 'rect' ? 'image' : 'token',
      widthPx: token.widthPx || token.sizePx || 120,
      heightPx: token.heightPx || token.sizePx || 120,
    });
    setVaultAssets(next);
  }

  function handleRemoveVaultAsset(assetId: string) {
    const next = removeAssetFromVault(campaignId, assetId);
    setVaultAssets(next);
  }

  // Keyboard shortcuts: Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo), V = Move, B = Brush, T = Text, W = Walls, R = Ruler, G = Grid, F = Focus
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (isMod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (isMod && key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isMod) return;

      if (key === 'g' && activeScene) {
        e.preventDefault();
        void handleGridUpdate({ ...activeScene.grid, enabled: !activeScene.grid.enabled });
      } else if (key === 'r') {
        e.preventDefault();
        setActiveTool((t) => (t === 'ruler' ? 'move' : 'ruler'));
      } else if (key === 'v') {
        e.preventDefault();
        setActiveTool('move');
      } else if (key === 'b') {
        e.preventDefault();
        setActiveTool((t) => (t === 'brush' ? 'move' : 'brush'));
      } else if (key === 't') {
        e.preventDefault();
        setActiveTool((t) => (t === 'text' ? 'move' : 'text'));
      } else if (key === 'w') {
        e.preventDefault();
        setActiveTool((t) => (t === 'wall' ? 'move' : 'wall'));
      } else if (key === 'd') {
        e.preventDefault();
        setActiveTool((t) => (t === 'duel' ? 'move' : 'duel'));
      } else if (key === 'f') {
        e.preventDefault();
        setDrawerOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function handleSelectScene(scene: Scene) {
    if (!campaign) return;
    await activateScene(campaign.id, scene, liveState);

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
      // Ignore autoplay restriction silently
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
    recordUndoSnapshot(activeScene);
    const nextEnabled = !activeScene.fogEnabled;
    try {
      await updateSceneFog(
        campaign.id,
        activeScene,
        nextEnabled,
        activeScene.fogStrokes,
        true,
        liveState
      );
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
    recordUndoSnapshot(activeScene);
    setScenes((prev) =>
      prev.map((s) => (s.id === activeScene.id ? { ...s, fogStrokes: strokes } : s))
    );
    try {
      await updateSceneFog(
        campaign.id,
        activeScene,
        activeScene.fogEnabled,
        strokes,
        true,
        liveState
      );
    } catch {
      notify('Erro ao sincronizar traços da névoa.');
    }
  }

  async function handleResetFog(revealAll: boolean) {
    if (!campaign || !activeScene) return;
    recordUndoSnapshot(activeScene);
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

  // Real-time 60fps stream during drag/resize so Shared TV Screen shows movement live while dragging!
  function handleTokensLiveChange(tokens: SceneToken[]) {
    if (!campaign || !activeScene) return;
    const targetScene = activeScene;
    if (liveStateRef.current) {
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot({ ...targetScene, tokens }),
      });
    }
    const now = Date.now();
    if (now - lastLiveCloudSyncMsRef.current >= 120) {
      lastLiveCloudSyncMsRef.current = now;
      void updateSceneTokens(campaign.id, targetScene, tokens, true, liveStateRef.current).catch(
        () => {}
      );
    }
  }

  async function handleTokensChange(tokens: SceneToken[], skipUndo = false) {
    if (!campaign || !activeScene) return;
    const targetScene = activeScene;
    if (!skipUndo) {
      recordUndoSnapshot(targetScene);
    }
    // 1. Immediate optimistic UI update
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
    // 3. Debounced Firestore persistence (140ms)
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
      void updateSceneTokens(
        campId,
        latest.scene,
        latest.tokens,
        true,
        liveStateRef.current
      ).catch(() => {
        notify('Erro ao salvar alterações da camada na nuvem.');
      });
    }, 140);
  }

  async function handleWallsChange(walls: SceneWall[]) {
    if (!campaign || !activeScene) return;
    recordUndoSnapshot(activeScene);
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
    recordUndoSnapshot(activeScene);
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
    setLocalTheme(clean);
    applyCampaignTheme(clean);
    if (liveStateRef.current) {
      broadcastLiveState(campaign.id, { ...liveStateRef.current, theme: clean });
    }
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
    setLocalShakePulseMs(now);
    try {
      await triggerShakePulse(campaign.id, liveStateRef.current);
    } catch {
      notify('Erro ao sincronizar tremor com a TV.');
    }
  }

  async function handleUpdateSceneDuelConfig(nextConfig: SceneDuelConfig) {
    if (!campaign || !activeScene) return;
    saveSceneDuelConfig(campaign.id, activeScene.id, nextConfig);
    setSceneDuelConfig(nextConfig);
    try {
      await syncLiveDuelState(
        campaign.id,
        activeScene,
        activeDuel,
        liveStateRef.current,
        nextConfig
      );
    } catch {
      // Ignore transient errors
    }
  }

  async function handleStartDuel(duel: ActiveDuelState, savedConfig: SceneDuelConfig) {
    if (!campaign || !activeScene) return;
    saveSceneDuelConfig(campaign.id, activeScene.id, savedConfig);
    setSceneDuelConfig(savedConfig);
    setDuelSetupPair(null);
    setActiveTool('move');
    setActiveDuel(duel);

    // Remember current music track and smoothly crossfade into Duel Music if configured
    preDuelMusicIdRef.current = audioEngine.getActiveTrackIds().musicId;
    const targetMusicId =
      duel.musicTrackId ||
      audioTracks.find((t) => t.layer === 'music' && t.synthPreset === 'duel')?.id ||
      '';
    if (targetMusicId) {
      const mTrack = audioTracks.find((t) => t.id === targetMusicId);
      if (mTrack && audioEngine.getActiveTrackIds().musicId !== mTrack.id) {
        try {
          await audioEngine.playTrack(mTrack, campaign.id);
          setAudioIds(audioEngine.getActiveTrackIds());
        } catch {
          // Ignore autoplay restriction silently
        }
      }
    }

    try {
      await syncLiveDuelState(
        campaign.id,
        activeScene,
        duel,
        liveStateRef.current,
        savedConfig
      );
    } catch {
      notify('Erro ao sincronizar Modo Duelo 3D.');
    }
    notify(`⚔️ Modo Duelo 3D iniciado: ${duel.player.name} vs ${duel.npc.name}`);
  }

  async function handleUpdateDuel(nextDuel: ActiveDuelState) {
    if (!campaign || !activeScene) return;
    const prevMusicId = activeDuel?.musicTrackId;
    setActiveDuel(nextDuel);

    // Sync any music change selected directly inside the 3D arena
    if (nextDuel.musicTrackId && nextDuel.musicTrackId !== prevMusicId) {
      const mTrack = audioTracks.find((t) => t.id === nextDuel.musicTrackId);
      if (mTrack && audioEngine.getActiveTrackIds().musicId !== mTrack.id) {
        try {
          await audioEngine.playTrack(mTrack, campaign.id);
          setAudioIds(audioEngine.getActiveTrackIds());
        } catch {
          // Ignore
        }
      }
    }

    try {
      await syncLiveDuelState(
        campaign.id,
        activeScene,
        nextDuel,
        liveStateRef.current,
        sceneDuelConfig
      );
    } catch {
      // Ignore transient sync error
    }
  }

  async function handleExecuteDuelAction(params: {
    side: 'player' | 'npc';
    action: DuelActionItem;
    rollDamageOnly?: boolean;
  }) {
    if (!campaign || !activeScene || !activeDuel) return;
    const attacker = params.side === 'player' ? activeDuel.player : activeDuel.npc;

    const attackerToken = activeScene.tokens.find((t) => t.id === attacker.tokenId);
    const attackerSheet = attacker.sheetId
      ? sheets.find((s) => s.id === attacker.sheetId) || null
      : attackerToken
      ? findSheetForToken(attackerToken, sheets)
      : null;

    const formulaToRoll =
      params.rollDamageOnly && params.action.damageFormula
        ? params.action.damageFormula
        : params.action.formula;

    const evalResult = evaluateDiceFormula(formulaToRoll, {
      blocks: attackerSheet?.blocks,
      mode: 'normal',
      forceExplode: false,
    });

    const actionDisplay = params.rollDamageOnly
      ? `${params.action.label} (Dano)`
      : params.action.label;

    // Rolling dice ONLY rolls to check/see result — damage animation ONLY happens when attacking with the mouse!
    const nextDuel: ActiveDuelState = {
      ...activeDuel,
      lastActionSummary: `${attacker.name} rolou ${actionDisplay}: ${evalResult.total} (${evalResult.summary})`,
    };

    await handleUpdateDuel(nextDuel);

    await handleDiceOrChat({
      input: formulaToRoll,
      label: `${attacker.name} · ${actionDisplay}`,
      mode: 'normal',
      explode: false,
      visibility: params.side === 'npc' ? 'gm_only' : 'public',
      blocks: attackerSheet?.blocks,
      rollerName: attacker.name,
    });
  }

  async function handleEndDuel() {
    if (!campaign || !activeScene) return;
    setActiveDuel(null);
    try {
      await syncLiveDuelState(
        campaign.id,
        activeScene,
        null,
        liveStateRef.current,
        sceneDuelConfig
      );
    } catch {
      // Ignore
    }

    // Smoothly fade back to pre-duel music or scene linked music
    const restoreId = preDuelMusicIdRef.current || activeScene.linkedMusicId || null;
    try {
      if (restoreId) {
        const prevTrack = audioTracks.find((t) => t.id === restoreId);
        if (prevTrack && audioEngine.getActiveTrackIds().musicId !== prevTrack.id) {
          await audioEngine.playTrack(prevTrack, campaign.id);
        }
      } else if (audioEngine.getActiveTrackIds().musicId) {
        const currentTrack = audioTracks.find(
          (t) => t.id === audioEngine.getActiveTrackIds().musicId
        );
        if (currentTrack?.synthPreset === 'duel') {
          audioEngine.stopLayer('music');
        }
      }
    } catch {
      // Ignore
    }
    setAudioIds(audioEngine.getActiveTrackIds());
    notify('Modo Duelo 3D encerrado.');
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
        <button
          type="button"
          onClick={onExit}
          className="px-4 py-2 text-xs font-semibold vtt-accent-btn"
        >
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
      <header className="h-14 px-4 border-b vtt-border vtt-surface flex items-center justify-between gap-3 shrink-0 z-30">
        {/* Zone 1: Back + Campaign Title + Undo/Redo */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onExit}
            className="p-2 border vtt-border vtt-muted hover:opacity-100 shrink-0"
            title="Voltar às campanhas"
            aria-label="Voltar às campanhas"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm sm:text-base font-bold font-typewriter truncate max-w-[160px] sm:max-w-[220px]">
            {campaign.title}
          </span>
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-1.5 border vtt-border vtt-canvas hover:vtt-subtle disabled:opacity-35"
              title="Desfazer (Ctrl+Z)"
              aria-label="Desfazer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 border vtt-border vtt-canvas hover:vtt-subtle disabled:opacity-35"
              title="Refazer (Ctrl+Y)"
              aria-label="Refazer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Zone 2: Photoshop-Inspired Tabletop Tool Controls */}
        <div className="hidden lg:flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTool('move')}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'move'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Mover e redimensionar camadas/tokens (V)"
          >
            <Hand className="w-3.5 h-3.5" />
            Mover
          </button>

          <button
            type="button"
            onClick={() => setActiveTool((t) => (t === 'brush' ? 'move' : 'brush'))}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'brush'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Desenhar com pincel no cenário (B)"
          >
            <Brush className="w-3.5 h-3.5" />
            Pincel
          </button>

          <button
            type="button"
            onClick={() => setActiveTool((t) => (t === 'text' ? 'move' : 'text'))}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'text'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Colocar texto no cenário (T)"
          >
            <Type className="w-3.5 h-3.5" />
            Texto
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTool((t) =>
                t === 'wall' || t === 'door' || t === 'wall_erase' ? 'move' : 'wall'
              )
            }
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Desenhar muros e portas alinhados ao mapa (W)"
          >
            <BrickWall className="w-3.5 h-3.5" />
            Muros
          </button>

          <button
            type="button"
            onClick={() => void handleFogToggle()}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeScene?.fogEnabled
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Ligar/desligar Névoa de Guerra"
          >
            <CloudFog className="w-3.5 h-3.5" />
            {activeScene?.fogEnabled ? 'Névoa ON' : 'Névoa'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTool((t) => (t === 'ruler' ? 'move' : 'ruler'))}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'ruler'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border'
            }`}
            title="Régua rápida (R)"
          >
            <Ruler className="w-3.5 h-3.5" />
            Régua
          </button>

          {activeScene && (
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() =>
                  void handleGridUpdate({
                    ...activeScene.grid,
                    enabled: !activeScene.grid.enabled,
                  })
                }
                className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeScene.grid.enabled
                    ? 'vtt-accent-btn border-transparent font-semibold'
                    : 'vtt-canvas vtt-border'
                }`}
                title="Ligar/desligar Grid (G)"
              >
                <Grid className="w-3.5 h-3.5" />
                Grid
              </button>
              <button
                type="button"
                onClick={() => setShowGridPopover((v) => !v)}
                className="px-1.5 py-1.5 text-xs border border-l-0 vtt-border vtt-canvas hover:opacity-80"
                title="Calibrar escala do grid"
                aria-label="Calibrar grid"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

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
                      <span className="tabular-nums">
                        {Math.round(activeScene.grid.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={activeScene.grid.opacity}
                      onChange={(e) =>
                        void handleGridUpdate({
                          ...activeScene.grid,
                          opacity: Number(e.target.value),
                        })
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

          <button
            type="button"
            onClick={() => void handleShakePulse()}
            className="px-2.5 py-1.5 text-xs border vtt-border vtt-canvas hover:opacity-80 flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Disparar tremor de impacto na mesa e na TV"
          >
            <Activity className="w-3.5 h-3.5 vtt-accent-text" />
            Tremor
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeDuel) {
                notify('O Modo Duelo 3D já está ativo na mesa.');
                return;
              }
              const characterTokens = (activeScene?.tokens || []).filter(
                (t) => !t.layerKind || t.layerKind === 'token'
              );
              if (characterTokens.length === 2) {
                setDuelSetupPair({
                  tokenA: characterTokens[0],
                  tokenB: characterTokens[1],
                });
                return;
              }
              setActiveTool((t) => (t === 'duel' ? 'move' : 'duel'));
            }}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTool === 'duel' || activeDuel
                ? 'bg-amber-700 text-white border-amber-500 font-semibold'
                : 'vtt-canvas vtt-border hover:border-amber-500/60'
            }`}
            title="Modo Confronto Direto / Duelo 3D (D) — selecione 2 tokens para iniciar combate 3D"
          >
            <Swords className="w-3.5 h-3.5 text-amber-400" />
            Confronto 3D
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
          {/* Contextual Brush & Text Sub-toolbar */}
          {(activeTool === 'brush' || activeTool === 'text') && (
            <div className="px-4 py-2 border-b vtt-border vtt-subtle flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold">
                  {activeTool === 'text' ? 'Texto no Mapa:' : 'Pincel:'}
                </span>

                {activeTool === 'brush' &&
                  (
                    [
                      ['pen', 'Caneta'],
                      ['marker', 'Marcador'],
                      ['chalk', 'Giz'],
                      ['glow', 'Neon'],
                      ['arrow', 'Seta'],
                    ] as Array<[BrushStyleId, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBrushStyle(id)}
                      className={`px-2.5 py-1 border whitespace-nowrap ${
                        brushStyle === id
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-surface vtt-border'
                      }`}
                    >
                      {label}
                    </button>
                  ))}

                {activeTool === 'text' && (
                  <span className="vtt-muted">
                    Clique em qualquer ponto do mapa para inserir um texto editável e redimensionável.
                  </span>
                )}

                <div className="flex items-center gap-1 pl-2">
                  {BRUSH_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBrushColor(c)}
                      className={`w-5 h-5 rounded-full border ${
                        brushColor === c ? 'ring-2 ring-current scale-110' : 'border-black/30'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-6 h-5 border vtt-border bg-transparent cursor-pointer"
                    title="Cor personalizada"
                  />
                </div>

                {activeTool === 'brush' && (
                  <label className="flex items-center gap-1.5 pl-2">
                    <span className="vtt-muted">Espessura</span>
                    <input
                      type="range"
                      min={2}
                      max={24}
                      step={1}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      className="w-20"
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {activeScene?.tokens.some((t) => t.layerKind === 'brush') && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeScene) return;
                      void handleTokensChange(
                        activeScene.tokens.filter((t) => t.layerKind !== 'brush')
                      );
                      notify('Desenhos do cenário removidos.');
                    }}
                    className="px-2.5 py-1 border vtt-border vtt-surface hover:opacity-80 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Eraser className="w-3 h-3" />
                    Limpar desenhos
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

          {/* Active Fog Sub-toolbar */}
          {activeScene?.fogEnabled && (
            <div className="px-4 py-2 border-b vtt-border vtt-subtle flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">Névoa:</span>
                <button
                  type="button"
                  onClick={() => setActiveTool('fog_reveal')}
                  className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                    activeTool === 'fog_reveal'
                      ? 'vtt-accent-btn border-transparent font-semibold'
                      : 'vtt-surface vtt-border'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Revelar
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('fog_hide')}
                  className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                    activeTool === 'fog_hide'
                      ? 'vtt-accent-btn border-transparent font-semibold'
                      : 'vtt-surface vtt-border'
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

          {/* Contextual Walls & Doors Sub-toolbar */}
          {activeScene &&
            (activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase') && (
              <div className="px-4 py-2 border-b vtt-border vtt-subtle flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">Muros & Portas:</span>
                  <button
                    type="button"
                    onClick={() => setActiveTool('wall')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'wall'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border'
                    }`}
                  >
                    <BrickWall className="w-3.5 h-3.5" />
                    Desenhar Muro
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool('door')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'door'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border'
                    }`}
                  >
                    <DoorClosed className="w-3.5 h-3.5" />
                    Desenhar Porta
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool('wall_erase')}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeTool === 'wall_erase'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border'
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
                brushStyle={brushStyle}
                brushColor={brushColor}
                brushSize={brushSize}
                onTokensChange={(t) => void handleTokensChange(t)}
                onTokensLiveChange={handleTokensLiveChange}
                onFogStrokesChange={(s) => void handleFogStrokesChange(s)}
                onWallsChange={(w) => void handleWallsChange(w)}
                onShowTokenPopup={(h) => void handleProjectHandout(h)}
                onSaveToVault={handleSaveTokenToVault}
                onRequestDuelPair={(a, b) => setDuelSetupPair({ tokenA: a, tokenB: b })}
                onToolChange={setActiveTool}
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

          {/* Quick-Switch Scene Dock */}
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
                      ? {
                          borderColor: 'var(--accent-primary)',
                          boxShadow: '0 0 0 1px var(--accent-primary)',
                        }
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

        {/* Ergonomic Single Active Right Drawer */}
        {drawerOpen && (
          <aside className="w-80 sm:w-96 border-l vtt-border vtt-surface flex flex-col shrink-0 min-h-0">
            {activeDrawer === 'scenes' && (
              <ScenesHandoutsPanel
                uploadContext={uploadContext}
                scenes={scenes}
                activeScene={activeScene}
                activeSceneDuelConfig={sceneDuelConfig}
                handouts={handouts}
                activeHandout={liveState?.activeHandout || null}
                audioTracks={audioTracks}
                members={members}
                sheets={sheets}
                vaultAssets={vaultAssets}
                onSelectScene={(s) => void handleSelectScene(s)}
                onUpdateSceneDuelConfig={(cfg) => void handleUpdateSceneDuelConfig(cfg)}
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
                onSaveTokenToVault={(tok) => {
                  handleSaveTokenToVault(tok);
                  notify(`"${tok.name}" salvo no Acervo.`);
                }}
                onRemoveVaultAsset={(id) => {
                  handleRemoveVaultAsset(id);
                  notify('Item removido do Acervo.');
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

      {/* Confrontation Pop-up when 2 Tokens are selected for 3D Duel Mode */}
      {duelSetupPair && activeScene && (
        <DuelSetupModal
          uploadContext={uploadContext}
          scene={activeScene}
          tokenA={duelSetupPair.tokenA}
          tokenB={duelSetupPair.tokenB}
          sheets={sheets}
          audioTracks={audioTracks}
          initialConfig={sceneDuelConfig}
          onStartDuel={(duel, savedConfig) => void handleStartDuel(duel, savedConfig)}
          onCancel={() => setDuelSetupPair(null)}
          onNotify={notify}
        />
      )}

      {/* Fullscreen 3D Turn-Based Confrontation / Duel Arena */}
      <DuelArena3DOverlay
        campaignId={campaign.id}
        uploadContext={uploadContext}
        duel={activeDuel}
        mode="gm"
        onUpdateDuel={(next) => void handleUpdateDuel(next)}
        onExecuteDuelAction={(params) => void handleExecuteDuelAction(params)}
        onEndDuel={() => void handleEndDuel()}
        onSaveSceneDuelBg={(bgUrl, bgMediaId, bgMediaKind) =>
          void handleUpdateSceneDuelConfig({
            ...sceneDuelConfig,
            bgUrl,
            bgMediaId,
            bgMediaKind,
          })
        }
        onNotify={notify}
      />

      {/* Dynamic Tumbling Dice Roll Animation */}
      <DiceRollOverlay roll={activeRollAnim} onComplete={clearRollAnim} position="bottom-right" />
    </div>
  );
}
