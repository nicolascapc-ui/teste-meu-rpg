import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  BrickWall,
  Brush,
  ChevronDown,
  ChevronRight,
  CloudFog,
  Compass,
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
  Hourglass,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize2,
  MessageSquare,
  Monitor,
  Moon,
  Music,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  QrCode,
  Radar,
  Redo2,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Type,
  Undo2,
  Unlock,
  Upload,
  Volume2,
  X,
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
  InterludeConfig,
  InterludeIconId,
  LiveTableState,
  PlayerViewSectionMode,
  Scene,
  SceneDuelConfig,
  SceneToken,
  SceneWall,
  SheetBlock,
} from '../types/vtt';
import { applyCampaignTheme, DEFAULT_THEME, getSceneEffects, sanitizeTheme } from '../lib/themes';
import { audioEngine } from '../lib/audioEngine';
import { evaluateDiceFormula, isDiceFormula, type RollMode } from '../lib/diceEngine';
import { resolveMediaUrl, uploadMediaFile } from '../lib/mediaStore';
import { detectTacticalMapWalls } from '../lib/tacticalWallDetector';
import {
  findSheetForToken,
  loadCampaignDuelsByScene,
  loadSceneDuelConfig,
  saveCampaignDuelsByScene,
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
  syncInterludeConfig,
  syncLiveAudioState,
  syncLiveDuelState,
  syncPlayerViewMode,
  toLiveSceneSnapshot,
  triggerShakePulse,
  updateAudioTrackDsp,
  updateCampaignFolders,
  updateCampaignSceneFolders,
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
import { FloatingAudioPlayer } from '../components/FloatingAudioPlayer';
import { CampaignChatPanel } from '../components/CampaignChatPanel';

type DrawerTab = 'scenes' | 'sheets' | 'dice' | 'chat' | 'wiki' | 'audio' | 'theme';

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

  // Ergonomic single-drawer (resizable left edge) & canvas controls
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab>('scenes');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('folio_gm_drawer_width_v1'));
      if (Number.isFinite(saved) && saved >= 320 && saved <= 760) return saved;
    } catch {
      // Ignore storage error
    }
    return 384;
  });
  const [isResizingDrawer, setIsResizingDrawer] = useState(false);

  const [activeTool, setActiveTool] = useState<CanvasTool>('move');
  const [fogBrushRadius, setFogBrushRadius] = useState(0.08);
  const [brushStyle, setBrushStyle] = useState<BrushStyleId>('pen');
  const [brushColor, setBrushColor] = useState('#ef4444');
  const [brushSize, setBrushSize] = useState(5);
  const [showGridPopover, setShowGridPopover] = useState(false);
  const [showPlayerViewPopover, setShowPlayerViewPopover] = useState(false);
  const [showInterludeEditor, setShowInterludeEditor] = useState(false);
  const [uploadingInterludeImg, setUploadingInterludeImg] = useState(false);
  const [showAudioPopup, setShowAudioPopup] = useState(false);
  const lastAutoPopupTrackKeyRef = useRef<string>('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [previewHandout, setPreviewHandout] = useState(false);
  const [detectingWalls, setDetectingWalls] = useState(false);
  const [toast, setToast] = useState('');
  const [activeRollAnim, setActiveRollAnim] = useState<ActiveDiceAnimation | null>(null);

  // Backstage Mode ("Modo Bastidores"): allows GM to freeze/pin what players see while editing other scenes freely
  const [isPlayerScenePinned, setIsPlayerScenePinned] = useState(false);
  const [gmPreviewSceneId, setGmPreviewSceneId] = useState<string | null>(null);

  // Asset Vault (Acervo de Fotos & Itens para replicar em 1 clique)
  const [vaultAssets, setVaultAssets] = useState<VaultAssetItem[]>(() =>
    loadVaultAssets(campaignId)
  );

  // 3D Direct Confrontation / Duel Mode state (strictly scoped per sceneId)
  const [duelSetupPair, setDuelSetupPair] = useState<{
    tokenA: SceneToken;
    tokenB: SceneToken;
  } | null>(null);
  const [duelsByScene, setDuelsByScene] = useState<Record<string, ActiveDuelState>>(() =>
    loadCampaignDuelsByScene(campaignId)
  );
  const duelsBySceneRef = useRef<Record<string, ActiveDuelState>>(duelsByScene);
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
  const pendingTokensRef = useRef<{
    scene: Scene;
    tokens: SceneToken[];
    syncToPlayers: boolean;
  } | null>(null);
  const lastLiveCloudSyncMsRef = useRef<number>(0);
  const liveStateRef = useRef<LiveTableState | null>(null);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    duelsBySceneRef.current = duelsByScene;
  }, [duelsByScene]);

  useEffect(() => {
    setVaultAssets(loadVaultAssets(campaignId));
    const loadedDuels = loadCampaignDuelsByScene(campaignId);
    duelsBySceneRef.current = loadedDuels;
    setDuelsByScene(loadedDuels);
  }, [campaignId]);

  // Hydrate an active duel from liveState if GM reopened on another browser/device without local cache
  useEffect(() => {
    const liveScene = liveState?.activeScene;
    const liveDuel = liveScene?.activeDuel;
    if (!liveScene || !liveDuel || liveDuel.sceneId !== liveScene.id) return;
    setDuelsByScene((prev) => {
      if (prev[liveScene.id]?.id === liveDuel.id) return prev;
      const next = { ...prev, [liveScene.id]: liveDuel };
      duelsBySceneRef.current = next;
      saveCampaignDuelsByScene(campaignId, next);
      return next;
    });
  }, [campaignId, liveState?.activeScene?.id, liveState?.activeScene?.activeDuel?.id]);

  function updateDuelsByScene(
    updater: (prev: Record<string, ActiveDuelState>) => Record<string, ActiveDuelState>
  ) {
    setDuelsByScene((prev) => {
      const next = updater(prev);
      duelsBySceneRef.current = next;
      saveCampaignDuelsByScene(campaignId, next);
      return next;
    });
  }

  const lastAudioFullKeyRef = useRef<string>('');
  const lastAudioStructKeyRef = useRef<string>('');
  const audioSyncTimerRef = useRef<number | null>(null);

  // Keep audio UI reactive, auto-show corner FloatingAudioPlayer, and sync GM audio in real-time to Players & Second Screen TV
  useEffect(() => {
    const unsub = audioEngine.subscribe(() => {
      const ids = audioEngine.getActiveTrackIds();
      setAudioIds(ids);
      const trackKey = `${ids.musicId || ''}|${ids.ambienceId || ''}`;
      if ((ids.musicId || ids.ambienceId) && trackKey !== lastAutoPopupTrackKeyRef.current) {
        lastAutoPopupTrackKeyRef.current = trackKey;
        setShowAudioPopup(true);
      } else if (!ids.musicId && !ids.ambienceId) {
        lastAutoPopupTrackKeyRef.current = '';
      }

      // Broadcast & sync live audio snapshot to players and shared TV screen
      const snap = audioEngine.getLiveAudioSnapshot();
      const structKey = JSON.stringify({
        m: snap.music
          ? [snap.music.trackId, snap.music.paused, snap.music.startedAtMs, snap.music.dsp]
          : null,
        a: snap.ambience
          ? [snap.ambience.trackId, snap.ambience.paused, snap.ambience.startedAtMs, snap.ambience.dsp]
          : null,
        s: snap.sfxPulse?.id || null,
        muted: snap.volumes.muted,
      });
      const fullKey = `${structKey}|${snap.volumes.master.toFixed(2)}|${snap.volumes.music.toFixed(2)}|${snap.volumes.ambience.toFixed(2)}|${snap.volumes.sfx.toFixed(2)}`;

      if (fullKey === lastAudioFullKeyRef.current) return;
      lastAudioFullKeyRef.current = fullKey;

      const latestLive = liveStateRef.current;
      if (latestLive) {
        const nextLive = {
          ...latestLive,
          liveAudio: snap,
        };
        liveStateRef.current = nextLive;
        broadcastLiveState(campaignId, nextLive);
      }

      const structChanged = structKey !== lastAudioStructKeyRef.current;
      lastAudioStructKeyRef.current = structKey;

      if (audioSyncTimerRef.current) {
        window.clearTimeout(audioSyncTimerRef.current);
        audioSyncTimerRef.current = null;
      }

      if (structChanged) {
        void syncLiveAudioState(campaignId, snap, latestLive).catch(() => {});
      } else {
        audioSyncTimerRef.current = window.setTimeout(() => {
          audioSyncTimerRef.current = null;
          void syncLiveAudioState(campaignId, audioEngine.getLiveAudioSnapshot(), liveStateRef.current).catch(
            () => {}
          );
        }, 220);
      }
    });
    return () => {
      unsub();
      if (audioSyncTimerRef.current) {
        window.clearTimeout(audioSyncTimerRef.current);
        audioSyncTimerRef.current = null;
      }
    };
  }, [campaignId]);

  function handleStartResizeDrawer(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawerWidth;
    setIsResizingDrawer(true);

    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const clamped = Math.max(320, Math.min(760, Math.round(startW + delta)));
      setDrawerWidth(clamped);
    };
    const onUp = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const finalW = Math.max(320, Math.min(760, Math.round(startW + delta)));
      setDrawerWidth(finalW);
      setIsResizingDrawer(false);
      try {
        localStorage.setItem('folio_gm_drawer_width_v1', String(finalW));
      } catch {
        // Ignore
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

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
      const activeOnExit = audioEngine.getActiveTrackIds();
      if (activeOnExit.musicId || activeOnExit.ambienceId) {
        void syncLiveAudioState(campaignId, null, liveStateRef.current).catch(() => {});
      }
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
          const { scene, tokens, syncToPlayers } = pendingTokensRef.current;
          void updateSceneTokens(
            campaignId,
            scene,
            tokens,
            syncToPlayers,
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

  // The scene currently edited by the GM (can differ from campaign.activeSceneId when Modo Bastidores is ON)
  const activeScene = useMemo(() => {
    if (scenes.length === 0) return null;
    if (isPlayerScenePinned && gmPreviewSceneId) {
      return (
        scenes.find((s) => s.id === gmPreviewSceneId) ||
        scenes.find((s) => s.id === campaign?.activeSceneId) ||
        scenes[0]
      );
    }
    return scenes.find((s) => s.id === campaign?.activeSceneId) || scenes[0];
  }, [scenes, campaign?.activeSceneId, isPlayerScenePinned, gmPreviewSceneId]);

  // Whether edits on `activeScene` should broadcast live to players right now
  const shouldSyncCurrentSceneToPlayers = useMemo(() => {
    if (!activeScene || !campaign) return false;
    if (isPlayerScenePinned) return false;
    return activeScene.id === campaign.activeSceneId;
  }, [activeScene, campaign, isPlayerScenePinned]);

  useEffect(() => {
    setSceneDuelConfig(loadSceneDuelConfig(campaignId, activeScene));
  }, [campaignId, activeScene]);

  // Duel bound strictly to the scene currently visible on the GM canvas
  // (Automatically hides during Backstage Mode when inspecting any other scene!)
  const visibleGmDuel = useMemo(() => {
    if (!activeScene) return null;
    const found = duelsByScene[activeScene.id];
    return found && found.sceneId === activeScene.id ? found : null;
  }, [activeScene, duelsByScene]);

  // Active duel running in a different scene (for the quick "Voltar ao Duelo" CTA)
  const otherActiveDuel = useMemo(() => {
    const currentId = activeScene?.id || null;
    if (campaign?.activeSceneId && campaign.activeSceneId !== currentId) {
      const liveDuel = duelsByScene[campaign.activeSceneId];
      if (liveDuel && liveDuel.sceneId === campaign.activeSceneId) {
        return liveDuel;
      }
    }
    for (const duel of Object.values(duelsByScene)) {
      if (
        duel &&
        duel.sceneId &&
        duel.sceneId !== currentId &&
        scenes.some((s) => s.id === duel.sceneId)
      ) {
        return duel;
      }
    }
    return null;
  }, [activeScene?.id, campaign?.activeSceneId, duelsByScene, scenes]);

  const otherActiveDuelScene = useMemo(
    () => (otherActiveDuel ? scenes.find((s) => s.id === otherActiveDuel.sceneId) || null : null),
    [otherActiveDuel, scenes]
  );

  const activeSceneForCanvas = useMemo(() => {
    if (!activeScene) return null;
    const currentViewMode = liveState?.activeScene?.playerViewMode || 'scene';
    return {
      ...toLiveSceneSnapshot(activeScene, visibleGmDuel, sceneDuelConfig, currentViewMode),
      tokens: activeScene.tokens,
    };
  }, [activeScene, visibleGmDuel, sceneDuelConfig, liveState?.activeScene?.playerViewMode]);

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
    const isLive = !isPlayerScenePinned && campaign.activeSceneId === restored.id;
    if (isLive && liveStateRef.current) {
      const restoredDuel = duelsBySceneRef.current[restored.id] || null;
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot(
          restored,
          restoredDuel,
          loadSceneDuelConfig(campaign.id, restored),
          liveStateRef.current.activeScene?.playerViewMode
        ),
      });
    }
    try {
      await Promise.all([
        updateSceneTokens(campaign.id, restored, restored.tokens, isLive, liveStateRef.current),
        updateSceneWalls(
          campaign.id,
          restored,
          restored.walls || [],
          Boolean(restored.dynamicVision),
          isLive,
          liveStateRef.current
        ),
        updateSceneFog(
          campaign.id,
          restored,
          restored.fogEnabled,
          restored.fogStrokes,
          isLive,
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

  function handleSaveTokenToVault(token: SceneToken, folder?: string) {
    if (!token.imageUrl && !token.mediaId) return;
    const next = saveAssetToVault(campaignId, {
      name: token.name || 'Item',
      imageUrl: token.imageUrl || '',
      mediaId: token.mediaId || '',
      combatSpriteUrl: token.combatSpriteUrl || '',
      combatSpriteMediaId: token.combatSpriteMediaId || '',
      defaultKind: token.layerKind === 'image' || token.shape === 'rect' ? 'image' : 'token',
      widthPx: token.widthPx || token.sizePx || 120,
      heightPx: token.heightPx || token.sizePx || 120,
      folder,
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

      if (key === 'escape') {
        if (showGridPopover) setShowGridPopover(false);
        if (showPlayerViewPopover) setShowPlayerViewPopover(false);
        return;
      }

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

  async function handleSelectScene(scene: Scene, forceProjectToPlayers = false) {
    if (!campaign) return;
    setGmPreviewSceneId(scene.id);

    const savedDuelForScene = duelsBySceneRef.current[scene.id] || null;
    const duelConfigForScene = loadSceneDuelConfig(campaign.id, scene);

    // If Backstage Mode (Modo Bastidores) is ON and we are not forcing projection, only switch the GM's canvas!
    if (isPlayerScenePinned && !forceProjectToPlayers) {
      notify(
        savedDuelForScene
          ? `Visualizando "${scene.name}" nos bastidores (duelo em andamento nesta cena).`
          : `Editando "${scene.name}" nos bastidores (Tela dos Players continua fixada).`
      );
      return;
    }

    await activateScene(
      campaign.id,
      scene,
      liveStateRef.current,
      savedDuelForScene,
      duelConfigForScene
    );

    let audioTriggered = false;
    if (audioEngine.isAutoPlayEnabled()) {
      try {
        const preferredMusicId = savedDuelForScene?.musicTrackId || scene.linkedMusicId || '';
        if (preferredMusicId) {
          const mTrack = audioTracks.find((t) => t.id === preferredMusicId);
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
    }
    setAudioIds(audioEngine.getActiveTrackIds());
    notify(
      savedDuelForScene
        ? `Cena "${scene.name}" projetada com o Duelo 3D restaurado.`
        : audioTriggered
        ? `Cena "${scene.name}" projetada nos Players com trilha vinculada.`
        : `Cena "${scene.name}" projetada nos Players.`
    );
  }

  function handleReturnToDuel(targetDuel: ActiveDuelState) {
    const targetScene = scenes.find((s) => s.id === targetDuel.sceneId);
    if (!targetScene) return;
    if (isPlayerScenePinned) {
      setGmPreviewSceneId(targetScene.id);
      notify(`Retornando ao duelo em "${targetScene.name}".`);
      return;
    }
    void handleSelectScene(targetScene);
  }

  async function handleUpdateInterludeConfig(patch: Partial<InterludeConfig>) {
    if (!campaign) return;
    const current: InterludeConfig = liveStateRef.current?.interludeConfig || {
      title: campaign.title,
      subtitle: 'Aguarde um instante enquanto o mestre prepara o próximo capítulo...',
      icon: 'sparkles',
      imageUrl: '',
      mediaId: '',
    };
    const next: InterludeConfig = {
      ...current,
      ...patch,
    };
    try {
      await syncInterludeConfig(campaign.id, next, liveStateRef.current);
    } catch {
      notify('Erro ao salvar personalização da tela de interlúdio.');
    }
  }

  async function handleChangePlayerViewMode(mode: PlayerViewSectionMode) {
    if (!campaign) return;
    try {
      await syncPlayerViewMode(campaign.id, mode, liveStateRef.current);
      const labelMap: Record<PlayerViewSectionMode, string> = {
        scene: 'Cena / Mapa',
        clues: 'Quadro de Pistas & Wiki Pública',
        dice: 'Central de Dados & Rolagens',
        standby: 'Tela de Interlúdio / Preparação',
      };
      notify(`Visão dos Players alterada para: ${labelMap[mode]}`);
    } catch {
      notify('Erro ao sincronizar seção visualizada pelos players.');
    }
  }

  async function handleGridUpdate(nextGrid: GridConfig) {
    if (!campaign || !activeScene) return;
    setScenes((prev) =>
      prev.map((s) => (s.id === activeScene.id ? { ...s, grid: nextGrid } : s))
    );
    try {
      await updateSceneGrid(
        campaign.id,
        activeScene,
        nextGrid,
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
      );
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
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
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
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
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
      await updateSceneFog(
        campaign.id,
        activeScene,
        true,
        strokes,
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
      );
      notify(revealAll ? 'Mapa inteiro revelado.' : 'Névoa fechada por completo.');
    } catch {
      notify('Erro ao atualizar a névoa.');
    }
  }

  // Real-time 60fps stream during drag/resize so Shared TV Screen shows movement live while dragging!
  function handleTokensLiveChange(tokens: SceneToken[]) {
    if (!campaign || !activeScene) return;
    const targetScene = activeScene;
    const syncLive = shouldSyncCurrentSceneToPlayers;
    if (syncLive && liveStateRef.current) {
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot(
          { ...targetScene, tokens },
          duelsBySceneRef.current[targetScene.id] || null,
          sceneDuelConfig,
          liveStateRef.current.activeScene?.playerViewMode
        ),
      });
    }
    const now = Date.now();
    if (now - lastLiveCloudSyncMsRef.current >= 120) {
      lastLiveCloudSyncMsRef.current = now;
      void updateSceneTokens(
        campaign.id,
        targetScene,
        tokens,
        syncLive,
        liveStateRef.current
      ).catch(() => {});
    }
  }

  async function handleTokensChange(tokens: SceneToken[], skipUndo = false) {
    if (!campaign || !activeScene) return;
    const targetScene = activeScene;
    const syncLive = shouldSyncCurrentSceneToPlayers;
    if (!skipUndo) {
      recordUndoSnapshot(targetScene);
    }
    // 1. Immediate optimistic UI update
    setScenes((prev) =>
      prev.map((s) => (s.id === targetScene.id ? { ...s, tokens } : s))
    );
    // 2. Immediate zero-latency Second Screen TV sync via BroadcastChannel (when not in Backstage Mode)
    if (syncLive && liveStateRef.current) {
      broadcastLiveState(campaign.id, {
        ...liveStateRef.current,
        activeScene: toLiveSceneSnapshot(
          { ...targetScene, tokens },
          duelsBySceneRef.current[targetScene.id] || null,
          sceneDuelConfig,
          liveStateRef.current.activeScene?.playerViewMode
        ),
      });
    }
    // 3. Debounced Firestore persistence (140ms)
    pendingTokensRef.current = { scene: targetScene, tokens, syncToPlayers: syncLive };
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
        latest.syncToPlayers,
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
      await updateSceneWalls(
        campaign.id,
        activeScene,
        walls,
        autoVision,
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
      );
    } catch {
      notify('Erro ao salvar muros e portas.');
    }
  }

  async function handleAutoDetectTacticalWalls() {
    if (!campaign || !activeScene) return;
    if (activeScene.category !== 'tactical') {
      notify(
        'O Auto-Muros experimental funciona apenas em cenas da categoria "Mapa Tático".'
      );
      return;
    }
    if (activeScene.mediaKind === 'video') {
      notify('O Auto-Muros requer uma imagem de mapa tático (não suporta vídeo).');
      return;
    }
    if (!activeScene.mediaId && !activeScene.imageUrl) {
      notify('Adicione uma imagem de mapa tático nesta cena antes de detectar muros.');
      return;
    }
    setDetectingWalls(true);
    try {
      const resolvedUrl = await resolveMediaUrl(
        activeScene.mediaId,
        activeScene.imageUrl,
        campaign.id
      );
      const result = await detectTacticalMapWalls(resolvedUrl);
      if (!result.isTacticalMap || result.walls.length === 0) {
        notify(
          result.reason ||
            'Não foi possível identificar paredes de mapa tático nesta imagem.'
        );
        return;
      }
      await handleWallsChange(result.walls);
      const doorsCount = result.walls.filter((w) => w.kind === 'door').length;
      const wallsCount = result.walls.length - doorsCount;
      notify(
        `Base automática gerada: ${wallsCount} muro(s)${doorsCount > 0 ? ` e ${doorsCount} porta(s)` : ''}. Use Ctrl+Z para desfazer ou ajuste livremente.`
      );
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message
          : 'Erro ao analisar os muros do mapa tático.'
      );
    } finally {
      setDetectingWalls(false);
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
        shouldSyncCurrentSceneToPlayers,
        liveStateRef.current
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
    if (activeScene.id === campaign.activeSceneId) {
      try {
        await syncLiveDuelState(
          campaign.id,
          activeScene,
          duelsBySceneRef.current[activeScene.id] || null,
          liveStateRef.current,
          nextConfig
        );
      } catch {
        // Ignore transient errors
      }
    }
  }

  async function handleStartDuel(duel: ActiveDuelState, savedConfig: SceneDuelConfig) {
    if (!campaign || !activeScene) return;
    const scopedDuel: ActiveDuelState = { ...duel, sceneId: activeScene.id };
    saveSceneDuelConfig(campaign.id, activeScene.id, savedConfig);
    setSceneDuelConfig(savedConfig);
    setDuelSetupPair(null);
    setActiveTool('move');
    updateDuelsByScene((prev) => ({
      ...prev,
      [activeScene.id]: scopedDuel,
    }));

    // Remember current music track and smoothly crossfade into Duel Music ONLY if scene/combat auto-play is ON
    preDuelMusicIdRef.current = audioEngine.getActiveTrackIds().musicId;
    if (audioEngine.isAutoPlayEnabled()) {
      const targetMusicId =
        scopedDuel.musicTrackId ||
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
    }

    if (activeScene.id === campaign.activeSceneId) {
      try {
        await syncLiveDuelState(
          campaign.id,
          activeScene,
          scopedDuel,
          liveStateRef.current,
          savedConfig
        );
      } catch {
        notify('Erro ao sincronizar Modo Duelo 3D.');
      }
      notify(`⚔️ Modo Duelo 3D iniciado: ${scopedDuel.player.name} vs ${scopedDuel.npc.name}`);
    } else {
      notify(
        `⚔️ Duelo preparado nos bastidores em "${activeScene.name}" (será exibido ao projetar esta cena).`
      );
    }
  }

  async function handleUpdateDuel(nextDuel: ActiveDuelState) {
    if (!campaign) return;
    const targetScene =
      scenes.find((s) => s.id === nextDuel.sceneId) || activeScene;
    if (!targetScene) return;
    const scopedDuel: ActiveDuelState = { ...nextDuel, sceneId: targetScene.id };
    const prevMusicId = duelsBySceneRef.current[targetScene.id]?.musicTrackId;
    updateDuelsByScene((prev) => ({
      ...prev,
      [targetScene.id]: scopedDuel,
    }));

    // Sync any music change selected directly inside the 3D arena
    if (scopedDuel.musicTrackId && scopedDuel.musicTrackId !== prevMusicId) {
      const mTrack = audioTracks.find((t) => t.id === scopedDuel.musicTrackId);
      if (mTrack && audioEngine.getActiveTrackIds().musicId !== mTrack.id) {
        try {
          await audioEngine.playTrack(mTrack, campaign.id);
          setAudioIds(audioEngine.getActiveTrackIds());
        } catch {
          // Ignore
        }
      }
    }

    if (targetScene.id === campaign.activeSceneId) {
      try {
        await syncLiveDuelState(
          campaign.id,
          targetScene,
          scopedDuel,
          liveStateRef.current,
          loadSceneDuelConfig(campaign.id, targetScene)
        );
      } catch {
        // Ignore transient sync error
      }
    }
  }

  async function handleExecuteDuelAction(params: {
    side: 'player' | 'npc';
    action: DuelActionItem;
    rollDamageOnly?: boolean;
  }) {
    if (!campaign || !activeScene || !visibleGmDuel) return;
    const attacker = params.side === 'player' ? visibleGmDuel.player : visibleGmDuel.npc;

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
      ...visibleGmDuel,
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
    const targetScene = activeScene;
    updateDuelsByScene((prev) => {
      if (!prev[targetScene.id]) return prev;
      const next = { ...prev };
      delete next[targetScene.id];
      return next;
    });

    if (targetScene.id === campaign.activeSceneId) {
      try {
        await syncLiveDuelState(
          campaign.id,
          targetScene,
          null,
          liveStateRef.current,
          sceneDuelConfig
        );
      } catch {
        // Ignore
      }
    }

    // Smoothly fade back to pre-duel music or stop duel music ONLY when auto-play is ON
    if (audioEngine.isAutoPlayEnabled()) {
      const restoreId = preDuelMusicIdRef.current || targetScene.linkedMusicId || null;
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
    }
    setAudioIds(audioEngine.getActiveTrackIds());
    notify(`Modo Duelo 3D encerrado em "${targetScene.name}".`);
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
  const currentPlayerViewMode: PlayerViewSectionMode =
    liveState?.activeScene?.playerViewMode || 'scene';
  const liveProjectedSceneName =
    liveState?.activeScene?.name ||
    scenes.find((s) => s.id === campaign.activeSceneId)?.name ||
    activeScene?.name ||
    'Cena';

  const drawerButtons: Array<{ id: DrawerTab; label: string; icon: typeof Layers }> = [
    { id: 'scenes', label: 'Cenas', icon: Layers },
    { id: 'sheets', label: 'Fichas', icon: FileSpreadsheet },
    { id: 'dice', label: 'Dados', icon: Dices },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'wiki', label: 'Wiki', icon: BookOpen },
    { id: 'audio', label: 'Áudio', icon: Volume2 },
    { id: 'theme', label: 'Visual', icon: Palette },
  ];

  const interludeConfig: InterludeConfig = liveState?.interludeConfig || {
    title: campaign.title,
    subtitle: 'Aguarde um instante enquanto o mestre prepara o próximo capítulo...',
    icon: 'sparkles',
    imageUrl: '',
    mediaId: '',
  };
  const isAnyAudioPlaying = Boolean(audioIds.musicId || audioIds.ambienceId);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col vtt-canvas">
      {/* Minimalist 3-Zone Top Bar with Progressive Disclosure */}
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
          <span className="text-sm sm:text-base font-bold font-typewriter truncate max-w-[140px] sm:max-w-[200px]">
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

        {/* Zone 2: Grouped Tabletop Tools (Creation Tools + Tactical Utilities + 3D Duel) */}
        <div className="hidden lg:flex items-center gap-2">
          {/* Group A: Map Editing & Creation */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTool('move')}
              className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTool === 'move'
                  ? 'vtt-accent-btn border-transparent font-semibold'
                  : 'vtt-canvas vtt-border'
              }`}
              title="Mover, selecionar múltiplos em caixa e redimensionar (V)"
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
          </div>

          <span className="h-5 w-px vtt-border bg-current opacity-20" />

          {/* Group B: Tactical Utilities & 3D Confrontation */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTool((t) => (t === 'ruler' ? 'move' : 'ruler'))}
              className={`px-2 py-1.5 text-xs border flex items-center gap-1 whitespace-nowrap shrink-0 ${
                activeTool === 'ruler'
                  ? 'vtt-accent-btn border-transparent font-semibold'
                  : 'vtt-canvas vtt-border'
              }`}
              title="Régua de distância (R)"
            >
              <Ruler className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Régua</span>
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
                  className={`px-2 py-1.5 text-xs border flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    activeScene.grid.enabled
                      ? 'vtt-accent-btn border-transparent font-semibold'
                      : 'vtt-canvas vtt-border'
                  }`}
                  title="Ligar/desligar Grid (G)"
                >
                  <Grid className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">Grid</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowGridPopover((v) => !v);
                    setShowPlayerViewPopover(false);
                  }}
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
              className="px-2 py-1.5 text-xs border vtt-border vtt-canvas hover:opacity-80 flex items-center gap-1 whitespace-nowrap shrink-0"
              title="Disparar tremor de impacto na mesa e na TV"
            >
              <Activity className="w-3.5 h-3.5 vtt-accent-text" />
              <span className="hidden xl:inline">Tremor</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (visibleGmDuel) {
                  notify('O Modo Duelo 3D já está ativo nesta cena.');
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
                activeTool === 'duel' || visibleGmDuel
                  ? 'bg-amber-700 text-white border-amber-500 font-semibold'
                  : 'vtt-canvas vtt-border hover:border-amber-500/60'
              }`}
              title="Modo Confronto Direto / Duelo 3D (D) — ou selecione 2 tokens com a caixa e clique com botão direito"
            >
              <Swords className="w-3.5 h-3.5 text-amber-400" />
              Duelo 3D
            </button>
          </div>
        </div>

        {/* Zone 3: Quick Return-to-Duel + Music Popup Icon + Player View / Backstage Control + QR Room + Primary CTA */}
        <div className="flex items-center gap-2 shrink-0">
          {otherActiveDuel && otherActiveDuelScene && (
            <button
              type="button"
              onClick={() => handleReturnToDuel(otherActiveDuel)}
              className="px-2.5 py-2 text-xs font-semibold bg-amber-700 hover:bg-amber-600 text-white border border-amber-400/70 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              title={`Voltar ao Duelo 3D em andamento na cena "${otherActiveDuelScene.name}" (${otherActiveDuel.player.name} vs ${otherActiveDuel.npc.name})`}
            >
              <Swords className="w-3.5 h-3.5 text-amber-200 animate-pulse" />
              <span>Voltar ao Duelo</span>
              <span className="hidden 2xl:inline text-[10px] opacity-85 max-w-[96px] truncate">
                · {otherActiveDuelScene.name}
              </span>
            </button>
          )}
          {/* Top Bar Music Icon -> Opens Floating Corner Audio Player */}
          <button
            type="button"
            onClick={() => setShowAudioPopup((v) => !v)}
            className={`relative p-2 text-xs border flex items-center justify-center shrink-0 transition-colors ${
              showAudioPopup || isAnyAudioPlaying
                ? 'vtt-accent-btn border-transparent'
                : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
            }`}
            title="Player rápido de música, ambiente, efeitos em tempo real e padrão master"
            aria-label="Player de Música"
          >
            <Music className="w-3.5 h-3.5" />
            {isAnyAudioPlaying && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-stone-950 animate-pulse" />
            )}
          </button>

          {/* "Visão dos Players" (Section Pinning, Backstage Improv & Custom Interlude Control) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowPlayerViewPopover((v) => !v);
                setShowGridPopover(false);
              }}
              className={`px-2.5 py-2 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                isPlayerScenePinned || currentPlayerViewMode !== 'scene'
                  ? 'bg-amber-700/90 text-white border-amber-500 font-semibold'
                  : 'vtt-canvas vtt-border hover:opacity-90'
              }`}
              title="Controlar o que os Players veem na TV/Celular e ativar Modo Bastidores para editar cenas futuras sem interromper o jogo"
            >
              {isPlayerScenePinned ? (
                <Lock className="w-3.5 h-3.5 text-amber-300" />
              ) : (
                <Monitor className="w-3.5 h-3.5 vtt-accent-text" />
              )}
              <span className="hidden sm:inline">
                {isPlayerScenePinned
                  ? 'Bastidores ON'
                  : currentPlayerViewMode === 'clues'
                  ? 'Players: Pistas'
                  : currentPlayerViewMode === 'dice'
                  ? 'Players: Dados'
                  : currentPlayerViewMode === 'standby'
                  ? 'Players: Interlúdio'
                  : 'Visão dos Players'}
              </span>
            </button>

            {showPlayerViewPopover && (
              <div className="absolute top-11 right-0 w-80 sm:w-96 max-h-[82vh] overflow-y-auto vtt-surface border vtt-border p-4 shadow-2xl space-y-4 z-50">
                <div className="flex items-center justify-between border-b vtt-border pb-2.5">
                  <div>
                    <p className="text-xs font-bold font-typewriter">
                      Controle da Visão dos Players
                    </p>
                    <p className="text-[11px] vtt-muted">
                      No ar agora: <strong className="font-semibold">{liveProjectedSceneName}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPlayerViewPopover(false)}
                    className="text-[11px] vtt-muted hover:opacity-100"
                  >
                    Fechar
                  </button>
                </div>

                {/* 1. Backstage Mode (Congelar / Fixar Cena nos Players) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      Modo Bastidores (Improviso)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !isPlayerScenePinned;
                        setIsPlayerScenePinned(next);
                        if (next && activeScene) {
                          setGmPreviewSceneId(activeScene.id);
                          notify(
                            `Modo Bastidores ativado: os players continuam vendo "${liveProjectedSceneName}" enquanto você edita livremente.`
                          );
                        } else if (!next && activeScene) {
                          void handleSelectScene(activeScene, true);
                        }
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold border flex items-center gap-1 ${
                        isPlayerScenePinned
                          ? 'bg-amber-700 text-white border-amber-500'
                          : 'vtt-canvas vtt-border vtt-muted'
                      }`}
                    >
                      {isPlayerScenePinned ? (
                        <>
                          <Lock className="w-3 h-3" />
                          Fixado
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3" />
                          Ao Vivo
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] vtt-muted leading-relaxed">
                    Quando <strong>Fixado</strong>, você pode trocar de cena ou preparar futuros mapas, tokens e muros sem alterar a tela dos jogadores.
                  </p>
                  {isPlayerScenePinned && activeScene && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleSelectScene(activeScene, true);
                      }}
                      className="w-full py-2 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-1.5"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      Projetar "{activeScene.name}" nos Players Agora
                    </button>
                  )}
                </div>

                {/* 2. Section Displayed to Players (playerViewMode) */}
                <div className="space-y-2 border-t vtt-border pt-3">
                  <p className="text-xs font-semibold">
                    Seção Exibida na Tela dos Players
                  </p>
                  <p className="text-[11px] vtt-muted">
                    Escolha o que a TV e os celulares exibem em destaque:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ['scene', 'Cena / Mapa', ImageIcon],
                        ['clues', 'Quadro de Pistas', BookOpen],
                        ['dice', 'Rolagens & Dados', Dices],
                        ['standby', 'Tela de Interlúdio', Sparkles],
                      ] as const
                    ).map(([modeId, label, Icon]) => {
                      const active = currentPlayerViewMode === modeId;
                      return (
                        <button
                          key={modeId}
                          type="button"
                          onClick={() => void handleChangePlayerViewMode(modeId)}
                          className={`p-2 text-xs border flex items-center gap-1.5 text-left transition-colors ${
                            active
                              ? 'vtt-accent-btn border-transparent font-semibold'
                              : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Collapsible Custom Interlude Screen Editor */}
                <div className="border-t vtt-border pt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowInterludeEditor((v) => !v)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      {showInterludeEditor ? (
                        <ChevronDown className="w-3.5 h-3.5 vtt-accent-text" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 vtt-accent-text" />
                      )}
                      Personalizar Tela de Interlúdio
                    </span>
                    <span className="text-[10px] vtt-muted">Texto, Ícone & Foto</span>
                  </button>

                  {showInterludeEditor && (
                    <div className="space-y-2.5 pt-1">
                      <label className="block space-y-1">
                        <span className="text-[10px] vtt-muted font-semibold">Título principal</span>
                        <input
                          type="text"
                          maxLength={120}
                          value={interludeConfig.title}
                          onChange={(e) =>
                            void handleUpdateInterludeConfig({ title: e.target.value })
                          }
                          placeholder={campaign.title}
                          className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[10px] vtt-muted font-semibold">
                          Mensagem / Subtítulo
                        </span>
                        <textarea
                          rows={2}
                          maxLength={300}
                          value={interludeConfig.subtitle}
                          onChange={(e) =>
                            void handleUpdateInterludeConfig({ subtitle: e.target.value })
                          }
                          placeholder="Ex: Pausa para o café · Voltamos em 10 minutos..."
                          className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas resize-none"
                        />
                      </label>

                      <div className="space-y-1">
                        <span className="text-[10px] vtt-muted font-semibold block">Ícone</span>
                        <div className="grid grid-cols-7 gap-1">
                          {(
                            [
                              ['sparkles', Sparkles, 'Brilho'],
                              ['hourglass', Hourglass, 'Ampulheta'],
                              ['compass', Compass, 'Bússola'],
                              ['book', BookOpen, 'Livro'],
                              ['moon', Moon, 'Lua'],
                              ['swords', Swords, 'Espadas'],
                              ['none', X, 'Sem ícone'],
                            ] as Array<[InterludeIconId, typeof Sparkles, string]>
                          ).map(([iconId, IconComp, title]) => (
                            <button
                              key={iconId}
                              type="button"
                              onClick={() => void handleUpdateInterludeConfig({ icon: iconId })}
                              className={`p-1.5 border flex items-center justify-center ${
                                (interludeConfig.icon || 'sparkles') === iconId
                                  ? 'vtt-accent-btn border-transparent'
                                  : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                              }`}
                              title={title}
                            >
                              <IconComp className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] vtt-muted font-semibold">
                            Foto de fundo (opcional)
                          </span>
                          <div className="flex items-center gap-1">
                            <label className="px-2 py-1 text-[10px] font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1">
                              <Upload className="w-3 h-3" />
                              <span>{uploadingInterludeImg ? 'Enviando...' : 'Foto'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingInterludeImg}
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  e.target.value = '';
                                  if (!f) return;
                                  setUploadingInterludeImg(true);
                                  try {
                                    const res = await uploadMediaFile(f, {
                                      ...uploadContext,
                                      optimizeFor: 'scene',
                                    });
                                    await handleUpdateInterludeConfig({
                                      imageUrl: res.url,
                                      mediaId: res.mediaId,
                                    });
                                    notify('Foto da tela de interlúdio atualizada.');
                                  } catch {
                                    notify('Erro ao enviar foto de interlúdio.');
                                  } finally {
                                    setUploadingInterludeImg(false);
                                  }
                                }}
                              />
                            </label>
                            {(interludeConfig.imageUrl || interludeConfig.mediaId) && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateInterludeConfig({ imageUrl: '', mediaId: '' })
                                }
                                className="px-1.5 py-1 text-[10px] border vtt-border vtt-canvas vtt-muted hover:text-red-500"
                                title="Remover foto"
                              >
                                Limpar
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={
                            interludeConfig.imageUrl.startsWith('idb://')
                              ? ''
                              : interludeConfig.imageUrl
                          }
                          onChange={(e) =>
                            void handleUpdateInterludeConfig({
                              imageUrl: e.target.value,
                              mediaId: '',
                            })
                          }
                          placeholder="Ou cole o link https:// de uma imagem..."
                          className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

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
          {/* Active Backstage / Forced Section Status Banner for GM */}
          {(isPlayerScenePinned || currentPlayerViewMode !== 'scene') && (
            <div className="px-4 py-1.5 border-b border-amber-500/40 bg-amber-950/60 text-amber-100 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span className="truncate">
                  {isPlayerScenePinned
                    ? `Modo Bastidores: Players veem "${liveProjectedSceneName}" · Você está editando "${activeScene?.name || ''}"`
                    : `Seção fixada nos Players: ${
                        currentPlayerViewMode === 'clues'
                          ? 'Quadro de Pistas & Wiki Pública'
                          : currentPlayerViewMode === 'dice'
                          ? 'Central de Dados & Rolagens'
                          : 'Tela de Interlúdio / Preparação'
                      }`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isPlayerScenePinned && activeScene && (
                  <button
                    type="button"
                    onClick={() => void handleSelectScene(activeScene, true)}
                    className="px-2.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[11px]"
                  >
                    Projetar esta cena
                  </button>
                )}
                {isPlayerScenePinned && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlayerScenePinned(false);
                      if (activeScene) void handleSelectScene(activeScene, true);
                    }}
                    className="px-2 py-0.5 border border-amber-400/50 hover:bg-amber-900/50 text-[11px]"
                  >
                    Sair dos Bastidores
                  </button>
                )}
                {currentPlayerViewMode !== 'scene' && (
                  <button
                    type="button"
                    onClick={() => void handleChangePlayerViewMode('scene')}
                    className="px-2 py-0.5 border border-amber-400/50 hover:bg-amber-900/50 text-[11px]"
                  >
                    Voltar Players ao Mapa
                  </button>
                )}
              </div>
            </div>
          )}

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
                    disabled={detectingWalls || activeScene.category !== 'tactical'}
                    onClick={() => void handleAutoDetectTacticalWalls()}
                    className={`px-2.5 py-1 border flex items-center gap-1 whitespace-nowrap ${
                      activeScene.category === 'tactical'
                        ? 'vtt-surface vtt-border hover:vtt-accent-btn disabled:opacity-50'
                        : 'vtt-surface vtt-border opacity-45 cursor-not-allowed'
                    }`}
                    title={
                      activeScene.category === 'tactical'
                        ? 'Experimental: analisa a imagem do mapa tático e cria uma base simples de muros e portas automaticamente'
                        : 'Disponível apenas em cenas da categoria Mapa Tático'
                    }
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${detectingWalls ? 'animate-spin' : 'vtt-accent-text'}`} />
                    {detectingWalls ? 'Analisando mapa...' : 'Auto-Muros (Exp.)'}
                  </button>
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

          {/* Sovereign Tabletop Canvas & 3D Duel Arena wrapped with Dynamic Scene Visual FX */}
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
                activeDuel={visibleGmDuel}
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

              {/* Fullscreen 3D Turn-Based Confrontation / Duel Arena (inside SceneEffectsStage so CRT & FX apply!) */}
              <DuelArena3DOverlay
                campaignId={campaign.id}
                uploadContext={uploadContext}
                duel={visibleGmDuel}
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
              const isEditing = activeScene?.id === scene.id;
              const isLiveOnPlayers = campaign.activeSceneId === scene.id;
              const thumb = sceneThumbs[scene.id];
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => void handleSelectScene(scene)}
                  className={`relative h-full w-36 shrink-0 border overflow-hidden text-left transition-transform active:scale-[0.98] ${
                    isEditing ? 'ring-2' : 'vtt-border opacity-80 hover:opacity-100'
                  }`}
                  style={
                    isEditing
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

                  {/* Top status badges for Live, Backstage & Active Scene Duel */}
                  {isLiveOnPlayers && (
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-700/90 text-white">
                      No Ar
                    </span>
                  )}
                  {isPlayerScenePinned && isEditing && !isLiveOnPlayers && (
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-600/95 text-white">
                      Bastidores
                    </span>
                  )}
                  {Boolean(duelsByScene[scene.id]) && (
                    <span
                      className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-700/95 text-white flex items-center gap-0.5 shadow-sm"
                      title="Duelo 3D ativo nesta cena"
                    >
                      <Swords className="w-2.5 h-2.5" />
                      Duelo
                    </span>
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

        {/* Resizable Single Active Right Drawer (Drag Left Edge to Expand/Shrink) */}
        {drawerOpen && (
          <aside
            style={{ width: `${drawerWidth}px` }}
            className="relative max-w-[78vw] border-l vtt-border vtt-surface flex flex-col shrink-0 min-h-0"
          >
            {/* Left-edge drag resize handle */}
            <div
              onPointerDown={handleStartResizeDrawer}
              className={`absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize z-30 transition-colors ${
                isResizingDrawer ? 'bg-amber-500/70' : 'hover:bg-amber-500/40'
              }`}
              title="Arraste para expandir ou reduzir a largura do painel"
            />
            {activeDrawer === 'scenes' && (
              <ScenesHandoutsPanel
                uploadContext={uploadContext}
                scenes={scenes}
                savedSceneFolders={campaign.sceneFolders}
                activeScene={activeScene}
                activeSceneDuelConfig={sceneDuelConfig}
                handouts={handouts}
                activeHandout={liveState?.activeHandout || null}
                audioTracks={audioTracks}
                members={members}
                sheets={sheets}
                vaultAssets={vaultAssets}
                onSelectScene={(s) => void handleSelectScene(s)}
                onSaveSceneFolders={(folders) => updateCampaignSceneFolders(campaign.id, folders)}
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
                    folder: data.folder || '',
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
                onUpdateSceneMeta={async (scene, updates) => {
                  await updateSceneMeta(campaign.id, scene.id, {
                    name: updates.name,
                    folder: updates.folder,
                    category: updates.category,
                    imageUrl: updates.imageUrl,
                    mediaId: updates.mediaId,
                    mediaKind: updates.mediaKind,
                    order: scene.order,
                    linkedMusicId: updates.linkedMusicId,
                    linkedAmbienceId: updates.linkedAmbienceId,
                  });
                  // If editing the currently live scene (and not in Backstage), immediately reflect changes on TV without losing any active duel
                  if (!isPlayerScenePinned && campaign.activeSceneId === scene.id) {
                    const updatedScene: Scene = { ...scene, ...updates };
                    await activateScene(
                      campaign.id,
                      updatedScene,
                      liveStateRef.current,
                      duelsBySceneRef.current[updatedScene.id] || null,
                      loadSceneDuelConfig(campaign.id, updatedScene)
                    );
                  }
                }}
                onUpdateSceneAudio={async (scene, musicId, ambienceId) => {
                  await updateSceneMeta(campaign.id, scene.id, {
                    name: scene.name,
                    folder: scene.folder || '',
                    category: scene.category,
                    imageUrl: scene.imageUrl,
                    mediaId: scene.mediaId,
                    mediaKind: scene.mediaKind,
                    order: scene.order,
                    linkedMusicId: musicId,
                    linkedAmbienceId: ambienceId,
                  });
                  notify('Trilha vinculada à cena salva.');
                }}
                onDeleteScene={async (sceneId) => {
                  updateDuelsByScene((prev) => {
                    if (!prev[sceneId]) return prev;
                    const next = { ...prev };
                    delete next[sceneId];
                    return next;
                  });
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
                onSaveTokenToVault={(tok, folder) => {
                  handleSaveTokenToVault(tok, folder);
                  notify(`"${tok.name}" salvo na pasta "${folder || 'Tokens'}" do Acervo.`);
                }}
                onRemoveVaultAsset={(id) => {
                  handleRemoveVaultAsset(id);
                  notify('Item removido do Acervo.');
                }}
                onSyncVaultAssets={(next) => {
                  setVaultAssets(next);
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
                canDragToCanvas
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

            {activeDrawer === 'chat' && (
              <CampaignChatPanel
                campaignId={campaign.id}
                gmUid={campaign.gmUid}
                gmName={user.displayName || 'Mestre'}
                currentUid={user.uid}
                currentName={user.displayName || 'Mestre'}
                isGM
                uploadContext={uploadContext}
                members={members}
                sheets={sheets}
                scenes={scenes}
                activeScene={activeScene}
                onAddItemToSheet={async (sheetId, itemBlock) => {
                  const target = sheets.find((s) => s.id === sheetId);
                  if (!target) return;
                  await updateCharacterSheet(campaign.id, target.id, {
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
                onSelectSceneById={(sceneId) => {
                  const found = scenes.find((s) => s.id === sceneId);
                  if (found) void handleSelectScene(found);
                }}
                onNotify={notify}
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
          onUpdateTokenSprite={(tokenId, url, mediaId) => {
            const updatedTokens = activeScene.tokens.map((t) =>
              t.id === tokenId
                ? { ...t, combatSpriteUrl: url, combatSpriteMediaId: mediaId }
                : t
            );
            void handleTokensChange(updatedTokens, true);
            setDuelSetupPair((prev) => {
              if (!prev) return prev;
              return {
                tokenA:
                  prev.tokenA.id === tokenId
                    ? { ...prev.tokenA, combatSpriteUrl: url, combatSpriteMediaId: mediaId }
                    : prev.tokenA,
                tokenB:
                  prev.tokenB.id === tokenId
                    ? { ...prev.tokenB, combatSpriteUrl: url, combatSpriteMediaId: mediaId }
                    : prev.tokenB,
              };
            });
          }}
          onStartDuel={(duel, savedConfig) => void handleStartDuel(duel, savedConfig)}
          onCancel={() => setDuelSetupPair(null)}
          onNotify={notify}
        />
      )}

      {/* Floating Corner Audio Player Pop-up */}
      <FloatingAudioPlayer
        open={showAudioPopup}
        tracks={audioTracks}
        onClose={() => setShowAudioPopup(false)}
        onSyncAudioUi={() => setAudioIds(audioEngine.getActiveTrackIds())}
        onNotify={notify}
      />

      {/* Dynamic Tumbling Dice Roll Animation */}
      <DiceRollOverlay roll={activeRollAnim} onComplete={clearRollAnim} position="bottom-right" />
    </div>
  );
}

