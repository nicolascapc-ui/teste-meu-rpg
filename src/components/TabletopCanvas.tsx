import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Crosshair,
  DoorClosed,
  DoorOpen,
  Eye,
  EyeOff,
  Heart,
  HeartPulse,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Moon,
  MousePointerClick,
  RotateCcw,
  Route,
  Search,
  Skull,
  SlidersHorizontal,
  Swords,
  Trash2,
  Unlock,
  Upload,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ActiveDuelState,
  ActiveHandoutProjection,
  BrushPoint,
  BrushStyleId,
  FogStroke,
  LiveSceneSnapshot,
  PlayerMapMarker,
  SceneToken,
  SceneWall,
  TokenVitalStatus,
} from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { detectSceneMediaKind } from '../lib/mediaOptimizer';
import { computeVisibilityPolygon, distancePointToSegment } from '../lib/visionEngine';
import { TokenEditorPanel } from './TokenEditorPanel';

export type CanvasTool =
  | 'move'
  | 'duel'
  | 'brush'
  | 'text'
  | 'ruler'
  | 'fog_reveal'
  | 'fog_hide'
  | 'wall'
  | 'door'
  | 'wall_erase';

type ResizeHandleDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

interface TabletopCanvasProps {
  campaignId?: string;
  uploadContext?: CampaignUploadContext;
  scene: LiveSceneSnapshot | null;
  activeDuel?: ActiveDuelState | null;
  mode: 'gm' | 'screen' | 'player';
  activeTool?: CanvasTool;
  fogBrushRadius?: number; // normalized 0.03 .. 0.18
  brushStyle?: BrushStyleId;
  brushColor?: string;
  brushSize?: number; // 2 .. 28 in 1200px reference units
  onTokensChange?: (tokens: SceneToken[]) => void;
  onTokensLiveChange?: (tokens: SceneToken[]) => void;
  onFogStrokesChange?: (strokes: FogStroke[]) => void;
  onWallsChange?: (walls: SceneWall[]) => void;
  onShowTokenPopup?: (handout: ActiveHandoutProjection) => void;
  onRequestDuelPair?: (tokenA: SceneToken, tokenB: SceneToken) => void;
  onOpenInvestigationToken?: (token: SceneToken) => void;
  onSaveToVault?: (token: SceneToken) => void;
  onToolChange?: (tool: CanvasTool) => void;
  onNotify?: (msg: string) => void;
  playerMarkers?: PlayerMapMarker[];
  currentUserUid?: string;
  currentUserName?: string;
  onPublishPlayerMarker?: (marker: PlayerMapMarker) => void;
  onRemovePlayerMarker?: (markerId: string) => void;
  onClearPlayerMarkers?: (scope: 'mine' | 'all') => void;
}

interface RulerState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface WallDraft {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'wall' | 'door';
}

interface BrushDraft {
  style: BrushStyleId;
  color: string;
  size: number;
  points: BrushPoint[];
}

interface ResizeInteractionState {
  tokenId: string;
  handle: ResizeHandleDir;
  startNx: number;
  startNy: number;
  startW: number;
  startH: number;
  isRect: boolean;
}

interface ContextMenuState {
  tokenId: string;
  x: number;
  y: number;
  isGroupMenu?: boolean;
}

interface MarqueeSelectionRect {
  startNx: number;
  startNy: number;
  endNx: number;
  endNy: number;
}

interface GroupDragState {
  anchorTokenId: string;
  startNx: number;
  startNy: number;
  initialPositions: Record<string, { x: number; y: number }>;
}

const REFERENCE_MAP_WIDTH = 1200;
const PLAYER_MARKER_TTL_MS = 22000;
const PLAYER_MARKER_FADE_MS = 3500;
const PLAYER_MARKER_PALETTE = [
  '#38bdf8', // sky
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f472b6', // pink
  '#a78bfa', // violet
  '#fb923c', // orange
];

function getPlayerMarkerColor(uid: string): string {
  if (!uid) return PLAYER_MARKER_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return PLAYER_MARKER_PALETTE[hash % PLAYER_MARKER_PALETTE.length];
}

function computePolylineUnits(
  points: Array<{ x: number; y: number }>,
  mapW: number,
  mapH: number,
  cellSizePx: number,
  unitValue: number
): number {
  if (points.length < 2) return 0;
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    totalPx += Math.hypot(
      (points[i].x - points[i - 1].x) * mapW,
      (points[i].y - points[i - 1].y) * mapH
    );
  }
  const cell = Math.max(12, cellSizePx || 56);
  return (totalPx / cell) * (unitValue || 1.5);
}

function getTokenShadowStyle(token: SceneToken, isHit: boolean): string | undefined {
  if (isHit) {
    return '0 0 22px 6px rgba(220, 38, 38, 0.92), 0 8px 18px rgba(0,0,0,0.6)';
  }
  const col = token.outlineColor || token.color || '#8f2d2d';
  const outlineGlow = token.outlineStyle === 'glow' ? `0 0 14px 3px ${col}` : '';
  let shadowPart = '';
  switch (token.shadow || 'soft') {
    case 'none':
      shadowPart = '';
      break;
    case 'dramatic':
      shadowPart = '0 10px 22px rgba(0, 0, 0, 0.78), 0 3px 6px rgba(0,0,0,0.5)';
      break;
    case 'colored':
      shadowPart = `0 6px 18px ${col}aa`;
      break;
    case 'soft':
    default:
      shadowPart = '0 4px 10px rgba(0, 0, 0, 0.45)';
      break;
  }
  return [outlineGlow, shadowPart].filter(Boolean).join(', ') || undefined;
}

function getTokenBorderStyle(token: SceneToken, isSelected: boolean): React.CSSProperties {
  const color = isSelected ? 'var(--accent-primary)' : token.outlineColor || token.color;
  const style = token.outlineStyle || (token.layerKind === 'image' ? 'none' : 'solid');
  if (style === 'none' && !isSelected) {
    return { borderWidth: 0 };
  }
  if (style === 'dashed') {
    return { borderWidth: 2, borderStyle: 'dashed', borderColor: color };
  }
  if (style === 'double') {
    return { borderWidth: 4, borderStyle: 'double', borderColor: color };
  }
  return { borderWidth: 2, borderStyle: 'solid', borderColor: color };
}

function pointsToSvgPath(points: BrushPoint[], width: number, height: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    const x = p.x * width;
    const y = p.y * height;
    return `M ${x} ${y} L ${x + 0.5} ${y + 0.5}`;
  }
  let d = `M ${(points[0].x * width).toFixed(1)} ${(points[0].y * height).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${(points[i].x * width).toFixed(1)} ${(points[i].y * height).toFixed(1)}`;
  }
  return d;
}

export function TabletopCanvas({
  campaignId,
  uploadContext,
  scene,
  activeDuel: activeDuelProp,
  mode,
  activeTool = 'move',
  fogBrushRadius = 0.08,
  brushStyle = 'pen',
  brushColor = '#ef4444',
  brushSize = 5,
  onTokensChange,
  onTokensLiveChange,
  onFogStrokesChange,
  onWallsChange,
  onShowTokenPopup,
  onRequestDuelPair,
  onOpenInvestigationToken,
  onSaveToVault,
  onToolChange,
  onNotify,
  playerMarkers = [],
  currentUserUid = '',
  currentUserName = 'Jogador',
  onPublishPlayerMarker,
  onRemovePlayerMarker,
  onClearPlayerMarkers,
}: TabletopCanvasProps) {
  const outerStageRef = useRef<HTMLDivElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStartClientRef = useRef<{ tokenId: string; x: number; y: number } | null>(null);

  const [bgUrl, setBgUrl] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const [outerSize, setOuterSize] = useState({ width: 1200, height: 675 });
  // Intrinsic aspect ratio of the background image/video so walls/tokens lock 1:1 across GM & TV screens
  const [mediaAspect, setMediaAspect] = useState<number>(16 / 9);

  // Local optimistic state for smooth dragging, resizing, brush drawing, fog painting & wall drawing
  const [localTokens, setLocalTokens] = useState<SceneToken[]>(scene?.tokens || []);
  const [localFog, setLocalFog] = useState<FogStroke[]>(scene?.fogStrokes || []);
  const [localWalls, setLocalWalls] = useState<SceneWall[]>(scene?.walls || []);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeSelectionRect | null>(null);
  const [groupDragState, setGroupDragState] = useState<GroupDragState | null>(null);
  const [duelCandidateId, setDuelCandidateId] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [aimingVisionTokenId, setAimingVisionTokenId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [resizingState, setResizingState] = useState<ResizeInteractionState | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [dragHoverCoords, setDragHoverCoords] = useState<{ nx: number; ny: number } | null>(null);

  // Interactive Map Zoom & Pan (transforms the entire unified map stage so tokens/walls/grid/fog NEVER shift!)
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);

  // Player Point & Click temporary indication state (strictly visual — players NEVER mutate scene tokens!)
  const [playerTool, setPlayerTool] = useState<'point' | 'path'>('point');
  const [playerSelectedTokenId, setPlayerSelectedTokenId] = useState<string | null>(null);
  const [playerPathDraft, setPlayerPathDraft] = useState<{
    points: Array<{ x: number; y: number }>;
    tokenId?: string;
    tokenName?: string;
    isFreehand: boolean;
  } | null>(null);
  const [localOptimisticMarkers, setLocalOptimisticMarkers] = useState<PlayerMapMarker[]>([]);
  const [markerNowMs, setMarkerNowMs] = useState(() => Date.now());

  // Reset zoom, pan & player local selection cleanly when switching to a different scene
  useEffect(() => {
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
    setPlayerSelectedTokenId(null);
    setPlayerPathDraft(null);
  }, [scene?.id]);

  // Merge synced player markers with instant optimistic local markers and prune expired ones
  const mergedSceneMarkers = useMemo(() => {
    if (!scene?.id) return [];
    const byId = new Map<string, PlayerMapMarker>();
    for (const m of playerMarkers) {
      if (m && m.sceneId === scene.id) byId.set(m.id, m);
    }
    for (const m of localOptimisticMarkers) {
      if (m && m.sceneId === scene.id && !byId.has(m.id)) {
        byId.set(m.id, m);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [playerMarkers, localOptimisticMarkers, scene?.id]);

  // Clear local optimistic marker once it appears in synced Firestore state (or expires)
  useEffect(() => {
    if (localOptimisticMarkers.length === 0) return;
    const syncedIds = new Set(playerMarkers.map((m) => m.id));
    const now = Date.now();
    setLocalOptimisticMarkers((prev) => {
      const next = prev.filter((m) => !syncedIds.has(m.id) && m.expiresAtMs > now);
      return next.length === prev.length ? prev : next;
    });
  }, [playerMarkers, localOptimisticMarkers.length]);

  // Lightweight 400ms ticker ONLY while active temporary markers exist so fade-out & auto-expiry are smooth
  useEffect(() => {
    const now = Date.now();
    const hasAlive = mergedSceneMarkers.some((m) => m.expiresAtMs > now);
    if (!hasAlive) return;
    setMarkerNowMs(now);
    const id = window.setInterval(() => {
      setMarkerNowMs(Date.now());
    }, 400);
    return () => window.clearInterval(id);
  }, [mergedSceneMarkers]);

  const activePlayerMarkers = useMemo(
    () => mergedSceneMarkers.filter((m) => m.expiresAtMs > markerNowMs),
    [mergedSceneMarkers, markerNowMs]
  );

  const myActiveMarkersCount = useMemo(
    () =>
      currentUserUid
        ? activePlayerMarkers.filter((m) => m.authorUid === currentUserUid).length
        : 0,
    [activePlayerMarkers, currentUserUid]
  );

  const playerSelectedToken = useMemo(
    () =>
      mode === 'player' && playerSelectedTokenId
        ? localTokens.find((t) => t.id === playerSelectedTokenId && !t.hiddenFromPlayers) || null
        : null,
    [mode, playerSelectedTokenId, localTokens]
  );

  function emitPlayerMarker(params: {
    kind: PlayerMapMarker['kind'];
    x: number;
    y: number;
    points?: Array<{ x: number; y: number }>;
    tokenId?: string;
    tokenName?: string;
    label?: string;
  }) {
    if (!scene || !currentUserUid || !onPublishPlayerMarker) return;
    const now = Date.now();
    const marker: PlayerMapMarker = {
      id: `pmk_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sceneId: scene.id,
      kind: params.kind,
      authorUid: currentUserUid,
      authorName: currentUserName || 'Jogador',
      color: getPlayerMarkerColor(currentUserUid),
      label: params.label,
      x: Number(Math.max(0, Math.min(1, params.x)).toFixed(4)),
      y: Number(Math.max(0, Math.min(1, params.y)).toFixed(4)),
      points: params.points,
      tokenId: params.tokenId,
      tokenName: params.tokenName,
      createdAtMs: now,
      expiresAtMs: now + PLAYER_MARKER_TTL_MS,
    };
    setMarkerNowMs(now);
    setLocalOptimisticMarkers((prev) => {
      const others = prev.filter((m) => m.authorUid !== marker.authorUid && m.expiresAtMs > now);
      const mine = prev.filter((m) => m.authorUid === marker.authorUid && m.expiresAtMs > now).slice(-2);
      return [...others, ...mine, marker];
    });
    onPublishPlayerMarker(marker);
  }

  function handleDismissMarker(markerId: string) {
    setLocalOptimisticMarkers((prev) => prev.filter((m) => m.id !== markerId));
    onRemovePlayerMarker?.(markerId);
  }

  function handleClearMarkers(scope: 'mine' | 'all') {
    if (scope === 'all') {
      setLocalOptimisticMarkers([]);
    } else if (currentUserUid) {
      setLocalOptimisticMarkers((prev) => prev.filter((m) => m.authorUid !== currentUserUid));
    }
    onClearPlayerMarkers?.(scope);
  }

  // Seamless camera zoom origin for transitioning into/out of 3D Duel Mode
  const effectiveDuel = activeDuelProp !== undefined ? activeDuelProp : scene?.activeDuel || null;
  const [duelZoomOrigin, setDuelZoomOrigin] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  useEffect(() => {
    if (!effectiveDuel) return;
    const pTok = localTokens.find((t) => t.id === effectiveDuel.player.tokenId);
    const nTok = localTokens.find((t) => t.id === effectiveDuel.npc.tokenId);
    if (pTok && nTok) {
      setDuelZoomOrigin({
        x: Math.max(0.15, Math.min(0.85, (pTok.x + nTok.x) / 2)),
        y: Math.max(0.15, Math.min(0.85, (pTok.y + nTok.y) / 2)),
      });
    } else if (pTok) {
      setDuelZoomOrigin({ x: pTok.x, y: pTok.y });
    } else if (nTok) {
      setDuelZoomOrigin({ x: nTok.x, y: nTok.y });
    }
  }, [effectiveDuel, localTokens]);

  // Hit-flash ticker so hit recoil auto-clears cleanly after ~600ms
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ephemeral Quick Ruler
  const [ruler, setRuler] = useState<RulerState | null>(null);
  // Wall / Door drawing preview
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  // Freehand Brush drawing preview
  const [brushDraft, setBrushDraft] = useState<BrushDraft | null>(null);

  // Fog painting state
  const isPaintingFogRef = useRef(false);
  const lastFogPointRef = useRef<{ x: number; y: number } | null>(null);
  const fogDraftRef = useRef<FogStroke[]>([]);
  const lastHoverCoordsRef = useRef<{ nx: number; ny: number }>({ nx: 0.5, ny: 0.5 });

  // Token image URL cache
  const [tokenImgUrls, setTokenImgUrls] = useState<Record<string, string>>({});

  // Pre-established fixed logical stage dimensions (1200 x referenceHeight).
  // The internal coordinate space NEVER changes when the user zooms the web page with Ctrl + + / - / Wheel!
  const mapBoxSize = useMemo(() => {
    const aspect = Number.isFinite(mediaAspect) && mediaAspect > 0.1 ? mediaAspect : 16 / 9;
    return {
      width: REFERENCE_MAP_WIDTH,
      height: Math.max(240, Math.round(REFERENCE_MAP_WIDTH / aspect)),
    };
  }, [mediaAspect]);

  // Uniform fit scale to display the fixed pre-established stage inside the container
  const stageDisplayScale = useMemo(() => {
    const availW = Math.max(1, outerSize.width);
    const availH = Math.max(1, outerSize.height);
    const scaleX = availW / mapBoxSize.width;
    const scaleY = availH / mapBoxSize.height;
    return Math.max(0.1, Math.min(scaleX, scaleY));
  }, [outerSize.width, outerSize.height, mapBoxSize.width, mapBoxSize.height]);

  // Internal scale factor is permanently locked to 1.0 (pre-established reference space)
  const mapScale = 1;

  useEffect(() => {
    if (!draggingTokenId && !groupDragState && !resizingState && !aimingVisionTokenId) {
      setLocalTokens(scene?.tokens || []);
    }
  }, [scene?.tokens, draggingTokenId, groupDragState, resizingState, aimingVisionTokenId]);

  useEffect(() => {
    if (!isPaintingFogRef.current) {
      setLocalFog(scene?.fogStrokes || []);
      fogDraftRef.current = scene?.fogStrokes || [];
    }
  }, [scene?.fogStrokes]);

  useEffect(() => {
    setLocalWalls(scene?.walls || []);
  }, [scene?.walls]);

  // Refresh hit animations cleanly when any token has a fresh hitAtMs
  useEffect(() => {
    const latestHit = localTokens.reduce((max, t) => Math.max(max, t.hitAtMs || 0), 0);
    if (!latestHit) return;
    const elapsed = Date.now() - latestHit;
    if (elapsed < 750) {
      setNowMs(Date.now());
      const timer = window.setTimeout(() => setNowMs(Date.now()), Math.max(120, 750 - elapsed));
      return () => window.clearTimeout(timer);
    }
  }, [localTokens]);

  useEffect(() => {
    let active = true;
    setMediaError(false);
    if (!scene) {
      setBgUrl('');
      setMediaAspect(16 / 9);
      return;
    }
    void resolveMediaUrl(scene.mediaId, scene.imageUrl, campaignId).then((url) => {
      if (active) setBgUrl(url);
    });
    return () => {
      active = false;
    };
  }, [scene?.id, scene?.mediaId, scene?.imageUrl, campaignId]);

  useEffect(() => {
    let active = true;
    const tokens = localTokens;
    Promise.all(
      tokens.map(async (t) => {
        if (!t.mediaId && !t.imageUrl) return [t.id, ''] as const;
        const url = await resolveMediaUrl(t.mediaId, t.imageUrl, campaignId);
        return [t.id, url] as const;
      })
    ).then((entries) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const [id, url] of entries) {
        if (url) next[id] = url;
      }
      setTokenImgUrls(next);
    });
    return () => {
      active = false;
    };
  }, [localTokens, campaignId]);

  useEffect(() => {
    const el = outerStageRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setOuterSize({ width, height });
        }
      }
    });
    obs.observe(el);

    // Ctrl+Wheel zooms the unified map stage smoothly (never browser page zoom) so token/wall positioning stays 100% locked
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        setMapZoom((z) => {
          const next = Math.max(0.6, Math.min(3.5, Number((z + delta).toFixed(2))));
          if (next <= 1) setMapPan({ x: 0, y: 0 });
          return next;
        });
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      obs.disconnect();
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Support Ctrl+V (paste image directly onto tabletop!) and Delete/Backspace for selected layers
  useEffect(() => {
    if (mode !== 'gm') return;

    async function handleWindowPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!scene || !uploadContext) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await handleQuickInsertImageFile(
              file,
              lastHoverCoordsRef.current.nx,
              lastHoverCoordsRef.current.ny
            );
            return;
          }
        }
      }
    }

    function handleWindowKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (editingTextId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTokenIds.length > 1) {
          e.preventDefault();
          handleDeleteSelectedTokens(selectedTokenIds);
        } else if (selectedTokenId) {
          e.preventDefault();
          handleDeleteToken(selectedTokenId);
        }
      } else if (e.key === 'Escape') {
        setSelectedTokenIds([]);
        setSelectedTokenId(null);
        setContextMenu(null);
      }
    }

    window.addEventListener('paste', handleWindowPaste);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  });

  async function handleQuickInsertImageFile(file: File, nx = 0.5, ny = 0.5) {
    if (!scene || !uploadContext) return;
    onNotify?.('Adicionando imagem ao cenário e salvando no Acervo...');
    try {
      // Read natural aspect ratio so pasted/dropped image keeps its proportions
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const tmpUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
          URL.revokeObjectURL(tmpUrl);
          const baseW = 140;
          const baseH = Math.max(36, Math.min(420, Math.round(baseW / Math.max(0.25, ratio))));
          resolve({ w: baseW, h: baseH });
        };
        img.onerror = () => {
          URL.revokeObjectURL(tmpUrl);
          resolve({ w: 120, h: 120 });
        };
        img.src = tmpUrl;
      });

      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'handout',
      });

      const cleanName =
        file.name.replace(/\.[^.]+$/, '').slice(0, 48) ||
        `Imagem ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      const newLayer: SceneToken = {
        id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        layerKind: 'image',
        tokenCategory: 'item',
        shape: 'rect',
        x: Number(Math.max(0.05, Math.min(0.95, nx)).toFixed(4)),
        y: Number(Math.max(0.05, Math.min(0.95, ny)).toFixed(4)),
        sizePx: Math.max(dims.w, dims.h),
        widthPx: dims.w,
        heightPx: dims.h,
        color: '#8f2d2d',
        outlineStyle: 'none',
        outlineColor: '#8f2d2d',
        shadow: 'soft',
        imageUrl: res.url,
        mediaId: res.mediaId,
        hiddenFromPlayers: false,
      };

      const next = [...localTokens, newLayer];
      setLocalTokens(next);
      setSelectedTokenId(newLayer.id);
      setSelectedTokenIds([newLayer.id]);
      onToolChange?.('move');
      onTokensChange?.(next);
      onSaveToVault?.(newLayer);
      onNotify?.(`"${cleanName}" adicionado ao mapa e salvo no Acervo!`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao colar/arrastar imagem.');
    }
  }

  // Determine whether Fog / Dynamic Line-of-Sight Canvas should be rendered
  const visionTokens = localTokens.filter(
    (t) =>
      t.layerKind !== 'brush' &&
      t.layerKind !== 'text' &&
      t.visionEnabled &&
      (mode === 'gm' || !t.hiddenFromPlayers)
  );
  const dynamicVisionActive = Boolean(scene?.dynamicVision) && visionTokens.length > 0;
  const shouldRenderFogLayer = Boolean(scene?.fogEnabled) || dynamicVisionActive;

  // Render Fog of War + Dynamic 2D Raycast Line-of-Sight Canvas inside the exact mapBoxSize
  useEffect(() => {
    const canvas = fogCanvasRef.current;
    if (!canvas || !shouldRenderFogLayer) return;

    const w = Math.max(1, Math.round(mapBoxSize.width));
    const h = Math.max(1, Math.round(mapBoxSize.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // GM sees translucent fog so GM never loses awareness; TV & Players see 100% opaque darkness
    ctx.fillStyle = mode === 'gm' ? 'rgba(14, 13, 12, 0.52)' : 'rgba(8, 8, 8, 1)';
    ctx.fillRect(0, 0, w, h);

    // 1. Manual fog reveal/hide strokes (when manual fog is enabled)
    if (scene?.fogEnabled) {
      for (const stroke of localFog) {
        const cx = stroke.x * w;
        const cy = stroke.y * h;
        if (stroke.mode === 'reveal') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = mode === 'gm' ? 'rgba(14, 13, 12, 0.52)' : 'rgba(8, 8, 8, 1)';
        }

        if (stroke.shape === 'rect') {
          const rw = (stroke.w || 0.1) * w;
          const rh = (stroke.h || 0.1) * h;
          ctx.fillRect(cx, cy, rw, rh);
        } else {
          const radius = (stroke.r || 0.08) * w;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 2. Dynamic 2D Raycast Line-of-Sight polygons for vision-emitting tokens (respects walls & closed doors!)
    if (dynamicVisionActive) {
      const baseSpan = Math.max(w, h);
      ctx.globalCompositeOperation = 'destination-out';

      for (const tok of visionTokens) {
        const ox = tok.x * w;
        const oy = tok.y * h;
        const radiusPx = Math.max(48, (tok.visionRadius || 0.34) * baseSpan);
        const isCone = tok.visionMode === 'cone';
        const coneConfig = isCone
          ? {
              facingDeg: tok.visionFacing ?? 0,
              spreadDeg: tok.visionAngle ?? 90,
            }
          : undefined;
        const poly = computeVisibilityPolygon(ox, oy, radiusPx, localWalls, w, h, coneConfig);
        if (poly.length < 3) continue;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();

        // Soft edge falloff near max vision radius while keeping wall shadows razor sharp
        const grad = ctx.createRadialGradient(ox, oy, radiusPx * 0.68, ox, oy, radiusPx);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0.05)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Keep the token's own immediate body visible at the base of a directional cone
        if (isCone) {
          const selfPx = Math.max(24, ((tok.widthPx || tok.sizePx || 52) / 1200) * w * 0.68);
          const selfGrad = ctx.createRadialGradient(ox, oy, selfPx * 0.45, ox, oy, selfPx);
          selfGrad.addColorStop(0, 'rgba(0,0,0,1)');
          selfGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(ox, oy, selfPx, 0, Math.PI * 2);
          ctx.fillStyle = selfGrad;
          ctx.fill();
        }
        ctx.restore();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [
    shouldRenderFogLayer,
    scene?.fogEnabled,
    dynamicVisionActive,
    localFog,
    localWalls,
    localTokens,
    mapBoxSize,
    mode,
  ]);

  function getRelativeCoords(clientX: number, clientY: number): {
    px: number;
    py: number;
    nx: number;
    ny: number;
  } {
    const rect = mapBoxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { px: 0, py: 0, nx: 0, ny: 0 };
    }
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const px = nx * mapBoxSize.width;
    const py = ny * mapBoxSize.height;
    return { px, py, nx, ny };
  }

  // Gently snap new wall endpoints to nearby existing wall corners for crisp room closures
  function snapPointToExistingWall(nx: number, ny: number): { nx: number; ny: number } {
    const threshold = 0.015;
    for (const w of localWalls) {
      if (Math.hypot(nx - w.x1, ny - w.y1) < threshold) return { nx: w.x1, ny: w.y1 };
      if (Math.hypot(nx - w.x2, ny - w.y2) < threshold) return { nx: w.x2, ny: w.y2 };
    }
    return { nx, ny };
  }

  function findWallNearPoint(px: number, py: number, maxDistPx = 12): SceneWall | null {
    const w = mapBoxSize.width;
    const h = mapBoxSize.height;
    let best: SceneWall | null = null;
    let bestDist = maxDistPx;
    for (const wall of localWalls) {
      const d = distancePointToSegment(
        px,
        py,
        wall.x1 * w,
        wall.y1 * h,
        wall.x2 * w,
        wall.y2 * h
      );
      if (d <= bestDist) {
        bestDist = d;
        best = wall;
      }
    }
    return best;
  }

  function findBrushStrokeNearPoint(px: number, py: number, maxDistPx = 14): SceneToken | null {
    const w = mapBoxSize.width;
    const h = mapBoxSize.height;
    for (let i = localTokens.length - 1; i >= 0; i--) {
      const tok = localTokens[i];
      if (tok.layerKind !== 'brush' || !tok.points || tok.points.length === 0) continue;
      for (let j = 0; j < tok.points.length - 1; j++) {
        const p1 = tok.points[j];
        const p2 = tok.points[j + 1];
        const d = distancePointToSegment(px, py, p1.x * w, p1.y * h, p2.x * w, p2.y * h);
        if (d <= maxDistPx) return tok;
      }
    }
    return null;
  }

  function toggleDoor(wallId: string) {
    const next = localWalls.map((w) =>
      w.id === wallId && w.kind === 'door' ? { ...w, isOpen: !w.isOpen } : w
    );
    setLocalWalls(next);
    onWallsChange?.(next);
  }

  function removeWall(wallId: string) {
    const next = localWalls.filter((w) => w.id !== wallId);
    setLocalWalls(next);
    onWallsChange?.(next);
  }

  function getTokensInsideMarquee(rect: MarqueeSelectionRect): string[] {
    const minX = Math.min(rect.startNx, rect.endNx);
    const maxX = Math.max(rect.startNx, rect.endNx);
    const minY = Math.min(rect.startNy, rect.endNy);
    const maxY = Math.max(rect.startNy, rect.endNy);
    return localTokens
      .filter(
        (t) =>
          t.layerKind !== 'brush' &&
          t.x >= minX &&
          t.x <= maxX &&
          t.y >= minY &&
          t.y <= maxY
      )
      .map((t) => t.id);
  }

  function handleStagePointerDown(e: React.PointerEvent) {
    if (!scene) return;
    setContextMenu(null);

    // Middle-click or Alt+Left-click pans the zoomed map smoothly without altering any token or wall coordinates!
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: mapPan.x,
        startY: mapPan.y,
      };
      return;
    }

    if (e.button !== 0) return;

    const { px, py, nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    lastHoverCoordsRef.current = { nx, ny };

    // Quick Ruler
    if (mode === 'gm' && (activeTool === 'ruler' || e.shiftKey)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setRuler({ startX: px, startY: py, endX: px, endY: py });
      return;
    }

    // Text Tool: Click anywhere on the map to create a text layer at that point
    if (mode === 'gm' && activeTool === 'text') {
      const newTextLayer: SceneToken = {
        id: `txt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        name: 'Texto no Mapa',
        layerKind: 'text',
        shape: 'rect',
        text: 'Novo Texto',
        fontSize: 26,
        textBg: true,
        x: Number(nx.toFixed(4)),
        y: Number(ny.toFixed(4)),
        sizePx: 180,
        widthPx: 200,
        heightPx: 54,
        color: brushColor || '#fdfbf7',
        outlineColor: brushColor || '#fdfbf7',
        outlineStyle: 'none',
        hiddenFromPlayers: false,
      };
      const next = [...localTokens, newTextLayer];
      setLocalTokens(next);
      setSelectedTokenId(newTextLayer.id);
      setSelectedTokenIds([newTextLayer.id]);
      setEditingTextId(newTextLayer.id);
      onTokensChange?.(next);
      onToolChange?.('move');
      return;
    }

    // Brush Tool: Draw freehand or directional arrow on the scenario
    if (mode === 'gm' && activeTool === 'brush') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) };
      setBrushDraft({
        style: brushStyle,
        color: brushColor,
        size: brushSize,
        points: brushStyle === 'arrow' ? [pt, pt] : [pt],
      });
      return;
    }

    // Wall / Drawing Eraser tool
    if (mode === 'gm' && activeTool === 'wall_erase') {
      const hitWall = findWallNearPoint(px, py, 14);
      if (hitWall) {
        removeWall(hitWall.id);
        return;
      }
      const hitBrush = findBrushStrokeNearPoint(px, py, 16);
      if (hitBrush) {
        handleDeleteToken(hitBrush.id);
        return;
      }
      return;
    }

    // Draw Wall or Door segment
    if (mode === 'gm' && (activeTool === 'wall' || activeTool === 'door')) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const snapped = snapPointToExistingWall(nx, ny);
      setWallDraft({
        x1: Number(snapped.nx.toFixed(4)),
        y1: Number(snapped.ny.toFixed(4)),
        x2: Number(snapped.nx.toFixed(4)),
        y2: Number(snapped.ny.toFixed(4)),
        kind: activeTool === 'door' ? 'door' : 'wall',
      });
      return;
    }

    // Fog painting
    if (
      mode === 'gm' &&
      scene.fogEnabled &&
      (activeTool === 'fog_reveal' || activeTool === 'fog_hide')
    ) {
      e.currentTarget.setPointerCapture(e.pointerId);
      isPaintingFogRef.current = true;
      lastFogPointRef.current = { x: nx, y: ny };
      const stroke: FogStroke = {
        id: `fg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        mode: activeTool === 'fog_reveal' ? 'reveal' : 'hide',
        shape: 'circle',
        x: Number(nx.toFixed(4)),
        y: Number(ny.toFixed(4)),
        r: fogBrushRadius,
      };
      const next = [...fogDraftRef.current, stroke].slice(-400);
      fogDraftRef.current = next;
      setLocalFog(next);
      return;
    }

    // Windows Desktop-Style Marquee (Shape) Multi-Selection when dragging on empty map in Move mode
    if (mode === 'gm' && activeTool === 'move') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setMarqueeRect({
        startNx: nx,
        startNy: ny,
        endNx: nx,
        endNy: ny,
      });
      setSelectedTokenId(null);
      setSelectedTokenIds([]);
      setEditingTextId(null);
      return;
    }

    // Player Point & Click Interaction: tap to indicate location/move destination, or drag to trace route
    if (mode === 'player' && !effectiveDuel && onPublishPlayerMarker) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) };
      const selTok = playerSelectedToken;
      if (selTok) {
        const origin = { x: Number(selTok.x.toFixed(4)), y: Number(selTok.y.toFixed(4)) };
        setPlayerPathDraft({
          points: playerTool === 'path' ? [origin, pt] : [origin, pt],
          tokenId: selTok.id,
          tokenName: selTok.name,
          isFreehand: playerTool === 'path',
        });
      } else {
        setPlayerPathDraft({
          points: [pt],
          isFreehand: playerTool === 'path',
        });
      }
      return;
    }

    setSelectedTokenId(null);
    setSelectedTokenIds([]);
    setEditingTextId(null);
  }

  function handleStagePointerMove(e: React.PointerEvent) {
    if (!scene) return;

    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setMapPan({
        x: panStartRef.current.startX + dx,
        y: panStartRef.current.startY + dy,
      });
      return;
    }

    const { px, py, nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    lastHoverCoordsRef.current = { nx, ny };

    // Active Player Point & Click Path Tracing preview
    if (playerPathDraft && mode === 'player') {
      const pt = { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) };
      setPlayerPathDraft((prev) => {
        if (!prev) return null;
        const last = prev.points[prev.points.length - 1];
        if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.012) {
          return prev;
        }
        return {
          ...prev,
          isFreehand: true,
          points: [...prev.points, pt].slice(0, 38),
        };
      });
      return;
    }

    if (ruler) {
      setRuler((prev) => (prev ? { ...prev, endX: px, endY: py } : null));
      return;
    }

    // Active Windows Desktop-Style Marquee Box Selection
    if (marqueeRect && mode === 'gm') {
      const nextRect: MarqueeSelectionRect = {
        ...marqueeRect,
        endNx: nx,
        endNy: ny,
      };
      setMarqueeRect(nextRect);
      const dist = Math.hypot(
        nextRect.endNx - nextRect.startNx,
        nextRect.endNy - nextRect.startNy
      );
      if (dist > 0.01) {
        const matched = getTokensInsideMarquee(nextRect);
        setSelectedTokenIds(matched);
        setSelectedTokenId(matched.length === 1 ? matched[0] : null);
      }
      return;
    }

    // Active Brush Drawing
    if (brushDraft && mode === 'gm') {
      const pt = { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) };
      setBrushDraft((prev) => {
        if (!prev) return null;
        if (prev.style === 'arrow') {
          return { ...prev, points: [prev.points[0], pt] };
        }
        const last = prev.points[prev.points.length - 1];
        if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.004) {
          return prev;
        }
        return { ...prev, points: [...prev.points, pt].slice(0, 180) };
      });
      return;
    }

    if (wallDraft && mode === 'gm') {
      const snapped = snapPointToExistingWall(nx, ny);
      setWallDraft((prev) =>
        prev
          ? {
              ...prev,
              x2: Number(snapped.nx.toFixed(4)),
              y2: Number(snapped.ny.toFixed(4)),
            }
          : null
      );
      return;
    }

    if (isPaintingFogRef.current && mode === 'gm') {
      const last = lastFogPointRef.current;
      const dist = last ? Math.hypot(nx - last.x, ny - last.y) : 1;
      if (dist >= fogBrushRadius * 0.32) {
        lastFogPointRef.current = { x: nx, y: ny };
        const stroke: FogStroke = {
          id: `fg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          mode: activeTool === 'fog_reveal' ? 'reveal' : 'hide',
          shape: 'circle',
          x: Number(nx.toFixed(4)),
          y: Number(ny.toFixed(4)),
          r: fogBrushRadius,
        };
        const next = [...fogDraftRef.current, stroke].slice(-400);
        fogDraftRef.current = next;
        setLocalFog(next);
      }
      return;
    }

    // Active Photoshop-style Handle Resizing (broadcasts in real-time to Shared TV!)
    if (resizingState && mode === 'gm') {
      const dxRef = (nx - resizingState.startNx) * REFERENCE_MAP_WIDTH * 2;
      const dyRef =
        (ny - resizingState.startNy) *
        (REFERENCE_MAP_WIDTH / Math.max(0.25, mediaAspect)) *
        2;

      const dir = resizingState.handle;
      let nextW = resizingState.startW;
      let nextH = resizingState.startH;

      if (dir.includes('e')) nextW = resizingState.startW + dxRef;
      if (dir.includes('w')) nextW = resizingState.startW - dxRef;
      if (dir.includes('s')) nextH = resizingState.startH + dyRef;
      if (dir.includes('n')) nextH = resizingState.startH - dyRef;

      nextW = Math.max(18, Math.min(1150, Math.round(nextW)));
      nextH = Math.max(18, Math.min(1150, Math.round(nextH)));

      const isCorner = dir.length === 2;
      const isSide = dir.length === 1;

      const nextTokens = localTokens.map((t) => {
        if (t.id !== resizingState.tokenId) return t;
        if (t.layerKind === 'text') {
          const ratio = Math.max(0.4, nextW / Math.max(18, resizingState.startW));
          const nextFont = Math.max(12, Math.min(120, Math.round((t.fontSize || 24) * ratio)));
          return {
            ...t,
            widthPx: nextW,
            heightPx: nextH,
            sizePx: Math.max(nextW, nextH),
            fontSize: isCorner ? nextFont : t.fontSize || 24,
          };
        }

        // If circular token and dragging a corner without Shift, scale diameter uniformly
        if (!resizingState.isRect && isCorner && !e.shiftKey) {
          const uniform = Math.max(18, Math.min(1100, Math.round((nextW + nextH) / 2)));
          return {
            ...t,
            sizePx: uniform,
            widthPx: uniform,
            heightPx: uniform,
          };
        }

        // Side handle or rectangular image layer -> free width & height scaling!
        return {
          ...t,
          shape: isSide ? 'rect' : t.shape,
          widthPx: dir === 'n' || dir === 's' ? resizingState.startW : nextW,
          heightPx: dir === 'e' || dir === 'w' ? resizingState.startH : nextH,
          sizePx: Math.max(
            dir === 'n' || dir === 's' ? resizingState.startW : nextW,
            dir === 'e' || dir === 'w' ? resizingState.startH : nextH
          ),
        };
      });

      setLocalTokens(nextTokens);
      onTokensLiveChange?.(nextTokens);
      return;
    }

    // Active Multi-Token Group Dragging (broadcasts in real-time to Shared TV!)
    if (groupDragState && mode === 'gm') {
      const dx = nx - groupDragState.startNx;
      const dy = ny - groupDragState.startNy;
      const nextTokens = localTokens.map((t) => {
        const init = groupDragState.initialPositions[t.id];
        if (!init || t.locked) return t;
        const clampedX = Math.max(0.01, Math.min(0.99, init.x + dx));
        const clampedY = Math.max(0.01, Math.min(0.99, init.y + dy));
        return {
          ...t,
          x: Number(clampedX.toFixed(4)),
          y: Number(clampedY.toFixed(4)),
        };
      });
      setLocalTokens(nextTokens);
      onTokensLiveChange?.(nextTokens);
      return;
    }

    // Active Vision Cone Aiming Handle Dragging (live 60fps rotation on GM + TV!)
    if (aimingVisionTokenId && mode === 'gm') {
      const target = localTokens.find((t) => t.id === aimingVisionTokenId);
      if (target) {
        const dxPx = (nx - target.x) * mapBoxSize.width;
        const dyPx = (ny - target.y) * mapBoxSize.height;
        if (Math.hypot(dxPx, dyPx) > 4) {
          const deg = Math.round(((Math.atan2(dyPx, dxPx) * 180) / Math.PI + 90 + 360) % 360);
          const nextTokens = localTokens.map((t) =>
            t.id === aimingVisionTokenId ? { ...t, visionFacing: deg } : t
          );
          setLocalTokens(nextTokens);
          onTokensLiveChange?.(nextTokens);
        }
      }
      return;
    }

    // Active Single Token / Layer Dragging (broadcasts in real-time to Shared TV!)
    if (draggingTokenId && mode === 'gm') {
      const clampedX = Math.max(0.01, Math.min(0.99, nx - dragOffset.dx));
      const clampedY = Math.max(0.01, Math.min(0.99, ny - dragOffset.dy));
      const nextTokens = localTokens.map((t) =>
        t.id === draggingTokenId
          ? { ...t, x: Number(clampedX.toFixed(4)), y: Number(clampedY.toFixed(4)) }
          : t
      );
      setLocalTokens(nextTokens);
      onTokensLiveChange?.(nextTokens);
    }
  }

  function handleStagePointerUp(e?: React.PointerEvent) {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }
    if (playerPathDraft && mode === 'player') {
      const draft = playerPathDraft;
      setPlayerPathDraft(null);
      const pts = draft.points;
      if (pts.length > 0) {
        const endPt = pts[pts.length - 1];
        if (draft.tokenId && pts.length >= 2) {
          const dist = Math.hypot(endPt.x - pts[0].x, endPt.y - pts[0].y);
          if (dist < 0.015 && pts.length <= 2) {
            // Clicked directly on top of the selected token -> highlight it
            emitPlayerMarker({
              kind: 'token',
              x: pts[0].x,
              y: pts[0].y,
              tokenId: draft.tokenId,
              tokenName: draft.tokenName,
              label: draft.tokenName || 'Token',
            });
          } else {
            emitPlayerMarker({
              kind: 'path',
              x: endPt.x,
              y: endPt.y,
              points: pts,
              tokenId: draft.tokenId,
              tokenName: draft.tokenName,
              label: draft.tokenName ? `Ir com ${draft.tokenName}` : 'Ir aqui',
            });
          }
        } else if (pts.length >= 3) {
          emitPlayerMarker({
            kind: 'path',
            x: endPt.x,
            y: endPt.y,
            points: pts,
            label: 'Caminho',
          });
        } else {
          emitPlayerMarker({
            kind: 'ping',
            x: endPt.x,
            y: endPt.y,
            label: 'Aqui',
          });
        }
      }
      return;
    }
    if (ruler) {
      setRuler(null);
    }

    if (marqueeRect) {
      const dist = Math.hypot(
        marqueeRect.endNx - marqueeRect.startNx,
        marqueeRect.endNy - marqueeRect.startNy
      );
      if (dist > 0.01) {
        const matched = getTokensInsideMarquee(marqueeRect);
        setSelectedTokenIds(matched);
        setSelectedTokenId(matched.length === 1 ? matched[0] : null);
        if (matched.length === 2) {
          onNotify?.(
            '2 tokens selecionados! Arraste qualquer um para mover os dois juntos, ou clique com o botão direito neles para iniciar Modo Duelo 3D.'
          );
        }
      }
      setMarqueeRect(null);
    }

    if (brushDraft) {
      if (brushDraft.points.length >= 2) {
        const xs = brushDraft.points.map((p) => p.x);
        const ys = brushDraft.points.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const brushNames: Record<BrushStyleId, string> = {
          pen: 'Traço Caneta',
          marker: 'Marcador',
          chalk: 'Traço Giz',
          glow: 'Traço Neon',
          spray: 'Spray',
          arrow: 'Seta Tática',
        };
        const createdStroke: SceneToken = {
          id: `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: brushNames[brushDraft.style] || 'Desenho',
          layerKind: 'brush',
          x: Number(cx.toFixed(4)),
          y: Number(cy.toFixed(4)),
          sizePx: 40,
          color: brushDraft.color,
          brushStyle: brushDraft.style,
          brushSize: brushDraft.size,
          points: brushDraft.points,
          hiddenFromPlayers: false,
        };
        const next = [...localTokens, createdStroke];
        setLocalTokens(next);
        onTokensChange?.(next);
      }
      setBrushDraft(null);
    }

    if (wallDraft) {
      const lenPx = Math.hypot(
        (wallDraft.x2 - wallDraft.x1) * mapBoxSize.width,
        (wallDraft.y2 - wallDraft.y1) * mapBoxSize.height
      );
      if (lenPx >= 10) {
        const created: SceneWall = {
          id: `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
          x1: wallDraft.x1,
          y1: wallDraft.y1,
          x2: wallDraft.x2,
          y2: wallDraft.y2,
          kind: wallDraft.kind,
          isOpen: false,
        };
        const next = [...localWalls, created].slice(0, 300);
        setLocalWalls(next);
        onWallsChange?.(next);
      }
      setWallDraft(null);
    }

    if (isPaintingFogRef.current) {
      isPaintingFogRef.current = false;
      lastFogPointRef.current = null;
      onFogStrokesChange?.(fogDraftRef.current);
    }

    if (resizingState) {
      setResizingState(null);
      onTokensChange?.(localTokens);
    }

    if (groupDragState) {
      setGroupDragState(null);
      onTokensChange?.(localTokens);
    }

    if (aimingVisionTokenId) {
      setAimingVisionTokenId(null);
      onTokensChange?.(localTokens);
    }

    if (draggingTokenId) {
      const finishedTokenId = draggingTokenId;
      const dragStart = dragStartClientRef.current;
      dragStartClientRef.current = null;
      setDraggingTokenId(null);

      const movedPx =
        e && dragStart && dragStart.tokenId === finishedTokenId
          ? Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y)
          : 999;
      const finishedToken = localTokens.find((t) => t.id === finishedTokenId);

      if (movedPx < 6 && finishedToken?.isInvestigationTrigger) {
        onOpenInvestigationToken?.(finishedToken);
      } else {
        onTokensChange?.(localTokens);
      }
    }
  }

  function handleTokenPointerDown(e: React.PointerEvent, token: SceneToken) {
    if (e.button !== 0) return;

    // Player Point & Click token selection & target signaling (read-only — never moves or edits tokens!)
    if (mode === 'player') {
      if (
        effectiveDuel ||
        token.hiddenFromPlayers ||
        token.isInvestigationTrigger ||
        token.layerKind === 'text' ||
        token.layerKind === 'brush'
      ) {
        return;
      }
      e.stopPropagation();

      // In Path tool: start tracing a route directly from this token's position
      if (playerTool === 'path' && onPublishPlayerMarker) {
        setPlayerSelectedTokenId(token.id);
        mapBoxRef.current?.setPointerCapture(e.pointerId);
        const origin = { x: Number(token.x.toFixed(4)), y: Number(token.y.toFixed(4)) };
        setPlayerPathDraft({
          points: [origin],
          tokenId: token.id,
          tokenName: token.name,
          isFreehand: true,
        });
        return;
      }

      // In Point & Click mode: first click selects the token to plan a move; second click pings/highlights it
      if (playerSelectedTokenId === token.id) {
        emitPlayerMarker({
          kind: 'token',
          x: token.x,
          y: token.y,
          tokenId: token.id,
          tokenName: token.name,
          label: token.name,
        });
        onNotify?.(`Sinalizou "${token.name}" no mapa.`);
      } else {
        setPlayerSelectedTokenId(token.id);
        onNotify?.(`"${token.name}" selecionado — clique no mapa para indicar para onde ir.`);
      }
      return;
    }

    if (mode !== 'gm') return;

    // 1. Explicit Duel Tool ('duel' tool in top toolbar or active duelCandidateId)
    const isExplicitDuelTool = activeTool === 'duel' || Boolean(duelCandidateId);

    if (
      isExplicitDuelTool &&
      token.layerKind !== 'text' &&
      token.layerKind !== 'brush' &&
      !token.isInvestigationTrigger
    ) {
      e.stopPropagation();
      setContextMenu(null);
      const firstId = duelCandidateId;
      if (!firstId || firstId === token.id) {
        setDuelCandidateId(token.id);
        setSelectedTokenId(token.id);
        setSelectedTokenIds([token.id]);
        onNotify?.(`"${token.name}" selecionado para confronto. Agora clique no 2º token (oponente)!`);
        return;
      }
      const firstToken = localTokens.find((t) => t.id === firstId);
      if (firstToken && firstToken.id !== token.id) {
        setDuelCandidateId(null);
        setSelectedTokenId(null);
        setSelectedTokenIds([]);
        onRequestDuelPair?.(firstToken, token);
        return;
      }
    }

    if (activeTool !== 'move') return;
    e.stopPropagation();
    setContextMenu(null);
    if (editingTextId && editingTextId !== token.id) {
      setEditingTextId(null);
    }

    // Ctrl / Cmd / Shift + Click toggles token in multi-selection without conflicting with Duel Mode!
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const exists = selectedTokenIds.includes(token.id);
      const nextIds = exists
        ? selectedTokenIds.filter((id) => id !== token.id)
        : [...selectedTokenIds, token.id];
      setSelectedTokenIds(nextIds);
      setSelectedTokenId(nextIds.length === 1 ? nextIds[0] : null);
      if (nextIds.length === 2) {
        onNotify?.(
          '2 tokens selecionados! Clique com o botão direito em um deles para iniciar Modo Duelo 3D, ou arraste para mover juntos.'
        );
      }
      return;
    }

    const { nx, ny } = getRelativeCoords(e.clientX, e.clientY);

    // If clicking a token that is already part of a multi-selection (>1 tokens), start group drag for all selected tokens!
    if (selectedTokenIds.length > 1 && selectedTokenIds.includes(token.id)) {
      if (token.locked) return;
      const initialPositions: Record<string, { x: number; y: number }> = {};
      for (const t of localTokens) {
        if (selectedTokenIds.includes(t.id) && !t.locked) {
          initialPositions[t.id] = { x: t.x, y: t.y };
        }
      }
      mapBoxRef.current?.setPointerCapture(e.pointerId);
      setGroupDragState({
        anchorTokenId: token.id,
        startNx: nx,
        startNy: ny,
        initialPositions,
      });
      return;
    }

    // Single token selection & drag
    setSelectedTokenId(token.id);
    setSelectedTokenIds([token.id]);
    if (token.locked) {
      if (token.isInvestigationTrigger) {
        onOpenInvestigationToken?.(token);
      }
      return;
    }
    dragStartClientRef.current = { tokenId: token.id, x: e.clientX, y: e.clientY };
    setDragOffset({ dx: nx - token.x, dy: ny - token.y });
    mapBoxRef.current?.setPointerCapture(e.pointerId);
    setDraggingTokenId(token.id);
  }

  function handleResizeHandlePointerDown(
    e: React.PointerEvent,
    token: SceneToken,
    handle: ResizeHandleDir
  ) {
    if (mode !== 'gm') return;
    e.stopPropagation();
    e.preventDefault();
    if (token.locked) return;
    const { nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    mapBoxRef.current?.setPointerCapture(e.pointerId);
    setResizingState({
      tokenId: token.id,
      handle,
      startNx: nx,
      startNy: ny,
      startW: token.widthPx || token.sizePx || 56,
      startH: token.heightPx || token.sizePx || 56,
      isRect: token.shape === 'rect' || token.layerKind === 'image' || token.layerKind === 'text',
    });
  }

  function handleTokenContextMenu(e: React.MouseEvent, token: SceneToken) {
    if (mode !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    const { px: rawX, py: rawY } = getRelativeCoords(e.clientX, e.clientY);
    const popW = 290;
    const popH = 440;
    const x = Math.max(10, Math.min(mapBoxSize.width - popW - 10, rawX + 10));
    const y = Math.max(10, Math.min(mapBoxSize.height - popH - 10, rawY - 24));

    // If right-clicking a token while 2 or more tokens are selected (and this token is in the selection),
    // open the Multi-Selection & 3D Duel Context Menu!
    if (selectedTokenIds.length >= 2 && selectedTokenIds.includes(token.id)) {
      setContextMenu({ tokenId: token.id, x, y, isGroupMenu: true });
      return;
    }

    setSelectedTokenId(token.id);
    setSelectedTokenIds([token.id]);
    setContextMenu({ tokenId: token.id, x, y, isGroupMenu: false });
  }

  function updateSingleToken(updated: SceneToken) {
    const next = localTokens.map((t) => (t.id === updated.id ? updated : t));
    setLocalTokens(next);
    onTokensChange?.(next);
  }

  function triggerTokenHit(tokenId: string) {
    const hitTs = Date.now();
    const next = localTokens.map((t) =>
      t.id === tokenId ? { ...t, hitAtMs: hitTs } : t
    );
    setLocalTokens(next);
    setNowMs(hitTs);
    onTokensChange?.(next);
  }

  function handleToggleTokenVisibility(tokenId: string) {
    const next = localTokens.map((t) =>
      t.id === tokenId ? { ...t, hiddenFromPlayers: !t.hiddenFromPlayers } : t
    );
    setLocalTokens(next);
    onTokensChange?.(next);
  }

  function handleToggleTokenLock(tokenId: string) {
    const next = localTokens.map((t) =>
      t.id === tokenId ? { ...t, locked: !t.locked } : t
    );
    setLocalTokens(next);
    onTokensChange?.(next);
  }

  function handleDeleteToken(tokenId: string) {
    const next = localTokens.filter((t) => t.id !== tokenId);
    setLocalTokens(next);
    setSelectedTokenId(null);
    setSelectedTokenIds((prev) => prev.filter((id) => id !== tokenId));
    setEditingTextId(null);
    setContextMenu(null);
    onTokensChange?.(next);
  }

  function handleDeleteSelectedTokens(ids: string[]) {
    const idSet = new Set(ids);
    const next = localTokens.filter((t) => !idSet.has(t.id));
    setLocalTokens(next);
    setSelectedTokenId(null);
    setSelectedTokenIds([]);
    setEditingTextId(null);
    setContextMenu(null);
    onTokensChange?.(next);
  }

  function handleBatchVitalStatus(ids: string[], status: TokenVitalStatus) {
    const idSet = new Set(ids);
    const next = localTokens.map((t) =>
      idSet.has(t.id) && t.layerKind !== 'text' && t.layerKind !== 'brush'
        ? { ...t, vitalStatus: status }
        : t
    );
    setLocalTokens(next);
    onTokensChange?.(next);
  }

  function handleBatchVisibility(ids: string[], hidden: boolean) {
    const idSet = new Set(ids);
    const next = localTokens.map((t) =>
      idSet.has(t.id) ? { ...t, hiddenFromPlayers: hidden } : t
    );
    setLocalTokens(next);
    onTokensChange?.(next);
  }

  function handleBatchHit(ids: string[]) {
    const idSet = new Set(ids);
    const hitTs = Date.now();
    const next = localTokens.map((t) =>
      idSet.has(t.id) ? { ...t, hitAtMs: hitTs } : t
    );
    setLocalTokens(next);
    setNowMs(hitTs);
    onTokensChange?.(next);
  }

  // Drag & Drop tokens (from Vault / Character Sheets / New Token Builder) OR image files directly onto the exact spot on the Tabletop!
  function handleDragOver(e: React.DragEvent) {
    if (mode !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const { nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    setDragHoverCoords({ nx, ny });
    if (!isDragOverFile) setIsDragOverFile(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (mode !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && outerStageRef.current?.contains(related)) {
      return;
    }
    setIsDragOverFile(false);
    setDragHoverCoords(null);
  }

  async function handleDrop(e: React.DragEvent) {
    if (mode !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverFile(false);
    setDragHoverCoords(null);

    const { nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    const clampedX = Number(Math.max(0.03, Math.min(0.97, nx)).toFixed(4));
    const clampedY = Number(Math.max(0.03, Math.min(0.97, ny)).toFixed(4));

    // 1. Check if the user dragged a Token / Asset from the Vault, Character Sheets, or New Token Builder
    const tokenPayloadRaw =
      e.dataTransfer.getData('application/x-folio-token') ||
      e.dataTransfer.getData('application/x-folio-sheet-token');
    if (tokenPayloadRaw && scene) {
      try {
        const parsed = JSON.parse(tokenPayloadRaw) as Partial<SceneToken> & {
          saveToVaultOnDrop?: boolean;
        };
        const isRect = parsed.shape === 'rect' || parsed.layerKind === 'image';
        const w = parsed.widthPx || parsed.sizePx || (isRect ? 120 : 56);
        const h = parsed.heightPx || parsed.sizePx || (isRect ? 120 : 56);

        const droppedToken: SceneToken = {
          id: `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: (parsed.name || 'Token').trim(),
          layerKind: parsed.layerKind || (isRect ? 'image' : 'token'),
          tokenCategory:
            parsed.tokenCategory ||
            (parsed.sheetId ? 'player' : isRect ? 'item' : 'npc'),
          shape: parsed.shape || (isRect ? 'rect' : 'circle'),
          sheetId: parsed.sheetId,
          x: clampedX,
          y: clampedY,
          sizePx: Math.max(w, h),
          widthPx: w,
          heightPx: h,
          color: parsed.color || '#8f2d2d',
          outlineStyle: parsed.outlineStyle || (isRect ? 'none' : 'solid'),
          outlineColor: parsed.outlineColor || parsed.color || '#8f2d2d',
          shadow: parsed.shadow || 'soft',
          imageUrl: parsed.imageUrl || '',
          mediaId: parsed.mediaId || '',
          combatSpriteUrl: parsed.combatSpriteUrl || '',
          combatSpriteMediaId: parsed.combatSpriteMediaId || '',
          notes: parsed.notes || '',
          hiddenFromPlayers: Boolean(parsed.hiddenFromPlayers),
          visionEnabled:
            typeof parsed.visionEnabled === 'boolean'
              ? parsed.visionEnabled
              : Boolean(
                  parsed.sheetId && (scene.category === 'tactical' || scene.dynamicVision)
                ),
          visionRadius: parsed.visionRadius || 0.34,
        };

        const next = [...localTokens, droppedToken];
        setLocalTokens(next);
        setSelectedTokenId(droppedToken.id);
        setSelectedTokenIds([droppedToken.id]);
        onToolChange?.('move');
        onTokensChange?.(next);
        if (parsed.saveToVaultOnDrop && (droppedToken.imageUrl || droppedToken.mediaId)) {
          onSaveToVault?.(droppedToken);
        }
        onNotify?.(`"${droppedToken.name}" posicionado exatamente onde você soltou!`);
        return;
      } catch {
        // Fall through to file drop if payload wasn't valid JSON
      }
    }

    // 2. Otherwise check if the user dragged an image file from their computer/browser
    const files = Array.from(e.dataTransfer.files || []);
    const imgFile = files.find((f) => f.type.startsWith('image/'));
    if (imgFile) {
      await handleQuickInsertImageFile(imgFile, clampedX, clampedY);
    }
  }

  const selectedToken = localTokens.find((t) => t.id === selectedTokenId) || null;
  const selectedTokensList = localTokens.filter((t) => selectedTokenIds.includes(t.id));
  const selectedCombatantPair = selectedTokensList.filter(
    (t) => t.layerKind !== 'text' && t.layerKind !== 'brush' && !t.isInvestigationTrigger
  );
  const contextToken = contextMenu
    ? localTokens.find((t) => t.id === contextMenu.tokenId) || null
    : null;

  const brushLayers = localTokens.filter((t) => t.layerKind === 'brush');
  const interactiveLayers = localTokens.filter((t) => t.layerKind !== 'brush');

  // Quick ruler calculation (scaled to the exact mapBoxSize)
  let rulerSquares = 0;
  let rulerUnits = 0;
  if (ruler && scene) {
    const distPx = Math.hypot(ruler.endX - ruler.startX, ruler.endY - ruler.startY);
    const cell = Math.max(12, (scene.grid.cellSizePx || 56) * mapScale);
    rulerSquares = distPx / cell;
    rulerUnits = rulerSquares * (scene.grid.unitValue || 1.5);
  }

  if (!scene) {
    return (
      <div className="w-full h-full flex items-center justify-center vtt-subtle border p-8 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-base font-bold font-typewriter">Nenhuma cena ativa</p>
          <p className="text-xs vtt-muted">
            {mode === 'gm'
              ? 'Crie ou selecione uma cena na barra inferior para iniciar a mesa.'
              : 'Aguardando o mestre projetar a próxima cena.'}
          </p>
        </div>
      </div>
    );
  }

  const resolvedMediaKind =
    scene.mediaKind || detectSceneMediaKind(scene.imageUrl || bgUrl);

  const cursorClass =
    mode === 'player'
      ? playerTool === 'path'
        ? 'cursor-crosshair'
        : 'cursor-pointer'
      : mode !== 'gm'
        ? 'cursor-default'
        : activeTool === 'ruler' ||
            activeTool === 'wall' ||
            activeTool === 'door' ||
            activeTool === 'brush'
          ? 'cursor-crosshair'
          : activeTool === 'text'
            ? 'cursor-text'
            : activeTool === 'fog_reveal' || activeTool === 'fog_hide' || activeTool === 'wall_erase'
              ? 'cursor-cell'
              : 'cursor-default';

  const scaledCellSize = Math.max(8, (scene.grid.cellSizePx || 56) * mapScale);
  const scaledOffsetX = (scene.grid.offsetX || 0) * mapScale;
  const scaledOffsetY = (scene.grid.offsetY || 0) * mapScale;

  // Seamless Camera Zoom Transition into/out of 3D Duel Mode + Interactive Map Zoom
  const isDuelActive = Boolean(effectiveDuel);
  const effectiveStageScale = isDuelActive
    ? stageDisplayScale * 2.15
    : stageDisplayScale * mapZoom;
  const effectiveTransformOrigin = isDuelActive
    ? `${(duelZoomOrigin.x * 100).toFixed(1)}% ${(duelZoomOrigin.y * 100).toFixed(1)}%`
    : '50% 50%';

  function renderBrushStrokeSvg(stroke: {
    id: string;
    style: BrushStyleId;
    color: string;
    size: number;
    points: BrushPoint[];
    hidden?: boolean;
  }) {
    if (stroke.points.length === 0) return null;
    const w = mapBoxSize.width;
    const h = mapBoxSize.height;
    const strokeW = Math.max(1.5, stroke.size * mapScale);
    const d = pointsToSvgPath(stroke.points, w, h);

    if (stroke.style === 'arrow' && stroke.points.length >= 2) {
      const p1 = stroke.points[0];
      const p2 = stroke.points[stroke.points.length - 1];
      const x1 = p1.x * w;
      const y1 = p1.y * h;
      const x2 = p2.x * w;
      const y2 = p2.y * h;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(12, strokeW * 3.4);
      const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      return (
        <g key={stroke.id} opacity={stroke.hidden ? 0.45 : 0.95}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke.color}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
          <polygon
            points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
            fill={stroke.color}
          />
        </g>
      );
    }

    if (stroke.style === 'marker') {
      return (
        <path
          key={stroke.id}
          d={d}
          fill="none"
          stroke={stroke.color}
          strokeWidth={strokeW * 2.4}
          strokeOpacity={stroke.hidden ? 0.25 : 0.45}
          strokeLinecap="square"
          strokeLinejoin="round"
        />
      );
    }

    if (stroke.style === 'chalk') {
      return (
        <path
          key={stroke.id}
          d={d}
          fill="none"
          stroke={stroke.color}
          strokeWidth={strokeW * 1.15}
          strokeOpacity={stroke.hidden ? 0.4 : 0.85}
          strokeDasharray={`${Math.max(4, strokeW * 1.5)} ${Math.max(2, strokeW * 0.6)}`}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    if (stroke.style === 'glow') {
      return (
        <g key={stroke.id} opacity={stroke.hidden ? 0.45 : 1}>
          <path
            d={d}
            fill="none"
            stroke={stroke.color}
            strokeWidth={strokeW * 2.8}
            strokeOpacity={0.28}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={d}
            fill="none"
            stroke="#ffffff"
            strokeWidth={Math.max(1.5, strokeW * 0.7)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }

    return (
      <path
        key={stroke.id}
        d={d}
        fill="none"
        stroke={stroke.color}
        strokeWidth={strokeW}
        strokeOpacity={stroke.hidden ? 0.45 : 0.94}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <div
      ref={outerStageRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      className="relative w-full h-full overflow-hidden select-none touch-none bg-stone-950 flex items-center justify-center"
    >
      {/* Duel Pair Selection Banner */}
      {mode === 'gm' && (activeTool === 'duel' || duelCandidateId) && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-stone-950/95 border border-amber-500 text-stone-100 shadow-2xl flex items-center gap-3 text-xs"
        >
          <Swords className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {duelCandidateId ? (
              <>
                1º Combatente:{' '}
                <strong className="text-amber-300">
                  {localTokens.find((t) => t.id === duelCandidateId)?.name || 'Token'}
                </strong>{' '}
                — Agora clique no <strong>2º Token (Oponente)</strong> para iniciar o Modo Duelo 3D!
              </>
            ) : (
              <>
                <strong>Modo Confronto Direto:</strong> Clique no 1º Token (Player) e depois no 2º Token (NPC/Inimigo).
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setDuelCandidateId(null);
              if (activeTool === 'duel') onToolChange?.('move');
            }}
            className="px-2 py-0.5 text-[11px] border border-stone-700 hover:bg-stone-800"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Pre-Established Fixed Logical Coordinate Stage (1200 x referenceHeight, scaled uniformly + seamless duel zoom) */}
      <div
        ref={mapBoxRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onContextMenu={(e) => {
          if (
            mode === 'gm' &&
            (activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase')
          ) {
            e.preventDefault();
            const { px, py } = getRelativeCoords(e.clientX, e.clientY);
            const hit = findWallNearPoint(px, py, 14);
            if (hit) removeWall(hit.id);
            return;
          }
          // If 2+ tokens are selected and GM right-clicks anywhere on the map, open the group/duel context menu
          if (mode === 'gm' && selectedTokenIds.length >= 2) {
            e.preventDefault();
            const { px: rawX, py: rawY } = getRelativeCoords(e.clientX, e.clientY);
            const x = Math.max(10, Math.min(mapBoxSize.width - 300, rawX + 10));
            const y = Math.max(10, Math.min(mapBoxSize.height - 320, rawY - 24));
            setContextMenu({
              tokenId: selectedTokenIds[0],
              x,
              y,
              isGroupMenu: true,
            });
          }
        }}
        style={{
          width: `${mapBoxSize.width}px`,
          height: `${mapBoxSize.height}px`,
          transform: isDuelActive
            ? `scale(${effectiveStageScale})`
            : `translate(${mapPan.x}px, ${mapPan.y}px) scale(${effectiveStageScale})`,
          transformOrigin: effectiveTransformOrigin,
          transition: isPanning
            ? 'none'
            : isDuelActive
              ? 'transform 650ms cubic-bezier(0.16, 1, 0.3, 1)'
              : 'transform 160ms ease-out',
        }}
        className={`relative overflow-hidden shadow-2xl bg-stone-950 shrink-0 ${
          isPanning ? 'cursor-grabbing' : cursorClass
        }`}
      >
        {/* Live Drag-and-Drop Target Reticle on the Map before placing token/image */}
        {mode === 'gm' && isDragOverFile && dragHoverCoords && (
          <div className="absolute inset-0 z-50 pointer-events-none border-2 border-dashed border-amber-400/90 bg-black/20">
            <div
              style={{
                left: `${dragHoverCoords.nx * 100}%`,
                top: `${dragHoverCoords.ny * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className="absolute flex flex-col items-center gap-1.5"
            >
              <div className="w-16 h-16 rounded-full border-2 border-amber-400 bg-amber-500/25 shadow-[0_0_24px_rgba(251,191,36,0.75)] flex items-center justify-center">
                <Upload className="w-6 h-6 text-amber-300" />
              </div>
              <span className="px-2.5 py-1 text-xs font-bold font-typewriter bg-stone-950/95 border border-amber-400 text-amber-200 whitespace-nowrap shadow-xl">
                Solte aqui para posicionar na cena
              </span>
            </div>
          </div>
        )}

        {/* Windows Desktop-Style Marquee Selection Box */}
        {mode === 'gm' && marqueeRect && (
          <div
            style={{
              left: `${Math.min(marqueeRect.startNx, marqueeRect.endNx) * 100}%`,
              top: `${Math.min(marqueeRect.startNy, marqueeRect.endNy) * 100}%`,
              width: `${Math.abs(marqueeRect.endNx - marqueeRect.startNx) * 100}%`,
              height: `${Math.abs(marqueeRect.endNy - marqueeRect.startNy) * 100}%`,
            }}
            className="absolute z-30 pointer-events-none border border-sky-400 bg-sky-500/20 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
          />
        )}

        {/* Scene Background: Supports Video (.mp4/.webm), Animated GIF, and Static Images */}
        {bgUrl && !mediaError ? (
          resolvedMediaKind === 'video' ? (
            <video
              key={bgUrl}
              src={bgUrl}
              autoPlay
              loop
              muted
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth > 0 && v.videoHeight > 0) {
                  setMediaAspect(v.videoWidth / v.videoHeight);
                }
              }}
              onError={() => setMediaError(true)}
              className="w-full h-full object-fill pointer-events-none"
            />
          ) : (
            <img
              src={bgUrl}
              alt={scene.name}
              referrerPolicy="no-referrer"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setMediaAspect(img.naturalWidth / img.naturalHeight);
                }
              }}
              onError={() => setMediaError(true)}
              className="w-full h-full object-fill pointer-events-none"
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-stone-400">
            <ImageIcon className="w-10 h-10 opacity-50" />
            <span className="text-sm font-typewriter">{scene.name}</span>
          </div>
        )}

        {/* Optional Calibrated Grid Layer (scales proportionally with mapBoxSize) */}
        {scene.grid.enabled && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,${scene.grid.opacity}) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255,255,255,${scene.grid.opacity}) 1px, transparent 1px)
              `,
              backgroundSize: `${scaledCellSize}px ${scaledCellSize}px`,
              backgroundPosition: `${scaledOffsetX}px ${scaledOffsetY}px`,
            }}
          />
        )}

        {/* Freehand Brush Drawings Layer */}
        {(brushLayers.length > 0 || brushDraft) && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-[8]">
            {brushLayers.map((stroke) => {
              if (mode !== 'gm' && stroke.hiddenFromPlayers) return null;
              return renderBrushStrokeSvg({
                id: stroke.id,
                style: stroke.brushStyle || 'pen',
                color: stroke.color || '#ef4444',
                size: stroke.brushSize || 5,
                points: stroke.points || [],
                hidden: stroke.hiddenFromPlayers,
              });
            })}
            {brushDraft &&
              renderBrushStrokeSvg({
                id: 'draft_brush',
                style: brushDraft.style,
                color: brushDraft.color,
                size: brushDraft.size,
                points: brushDraft.points,
              })}
          </svg>
        )}

        {/* Interactive Layers: Tokens, Dropped/Pasted Images & Text Annotations */}
        <div className="absolute inset-0 pointer-events-none z-10">
          {interactiveLayers.map((token) => {
            if (mode !== 'gm' && token.hiddenFromPlayers) return null;
            const imgSrc = tokenImgUrls[token.id];
            const isSelected =
              mode === 'gm' &&
              (selectedTokenId === token.id || selectedTokenIds.includes(token.id));
            const isMultiSelected =
              mode === 'gm' && selectedTokenIds.length > 1 && selectedTokenIds.includes(token.id);
            const isHit = Boolean(token.hitAtMs && nowMs - token.hitAtMs < 650);
            const isText = token.layerKind === 'text';
            const isRect = token.shape === 'rect' || token.layerKind === 'image' || isText;
            const vitalStatus: TokenVitalStatus = token.vitalStatus || 'alive';

            const refW = token.widthPx || token.sizePx || 52;
            const refH = token.heightPx || token.sizePx || 52;
            const dispW = Math.max(16, refW * mapScale);
            const dispH = Math.max(16, refH * mapScale);

            const behaviorClass =
              vitalStatus === 'dead' || vitalStatus === 'unconscious'
                ? ''
                : token.behavior === 'float'
                  ? 'token-behavior-float'
                  : token.behavior === 'pulse'
                    ? 'token-behavior-pulse'
                    : token.behavior === 'tremble'
                      ? 'token-behavior-tremble'
                      : '';
            const texClass =
              token.texture === 'grain'
                ? 'token-tex-grain'
                : token.texture === 'holo'
                  ? 'token-tex-holo'
                  : token.texture === 'metallic'
                    ? 'token-tex-metallic'
                    : token.texture === 'aged'
                      ? 'token-tex-aged'
                      : '';
            const statuses = token.statuses || [];
            const outlineCol = token.outlineColor || token.color || '#8f2d2d';

            // Visual Filter for Vital Status (Unconscious, Dying, Dead)
            const vitalFilterCss =
              vitalStatus === 'dead'
                ? 'grayscale(1) contrast(1.45) brightness(0.42)'
                : vitalStatus === 'dying'
                  ? 'sepia(0.65) hue-rotate(-50deg) saturate(2.5) contrast(1.25) brightness(0.82)'
                  : vitalStatus === 'unconscious'
                    ? 'grayscale(0.78) brightness(0.68) contrast(1.12) hue-rotate(195deg)'
                    : undefined;

            return (
              <div
                key={token.id}
                onPointerDown={(e) => handleTokenPointerDown(e, token)}
                onDoubleClick={(e) => {
                  if (mode === 'gm' && isText) {
                    e.stopPropagation();
                    setSelectedTokenId(token.id);
                    setSelectedTokenIds([token.id]);
                    setEditingTextId(token.id);
                  }
                }}
                onContextMenu={(e) => handleTokenContextMenu(e, token)}
                style={{
                  left: `${token.x * 100}%`,
                  top: `${token.y * 100}%`,
                  width: `${dispW}px`,
                  height: `${dispH}px`,
                  transform:
                    vitalStatus === 'unconscious'
                      ? 'translate(-50%, -50%) rotate(-12deg)'
                      : 'translate(-50%, -50%)',
                  opacity: token.isInvestigationTrigger
                    ? 0.92
                    : token.hiddenFromPlayers
                      ? 0.52
                      : typeof token.opacity === 'number'
                        ? token.opacity
                        : 1,
                }}
                className={`absolute transition-transform duration-200 ${behaviorClass} ${
                  isHit ? 'token-hit-active' : ''
                } ${
                  mode === 'gm' && activeTool === 'move'
                    ? token.isInvestigationTrigger
                      ? 'pointer-events-auto cursor-pointer'
                      : token.locked
                        ? 'pointer-events-auto cursor-default'
                        : 'pointer-events-auto cursor-grab active:cursor-grabbing'
                    : mode === 'player' &&
                        !isText &&
                        !token.isInvestigationTrigger &&
                        !token.hiddenFromPlayers
                      ? 'pointer-events-auto cursor-pointer'
                      : 'pointer-events-none'
                } ${isSelected || (mode === 'player' && playerSelectedTokenId === token.id) ? 'z-20' : 'z-10'}`}
                title={
                  mode === 'gm'
                    ? token.isInvestigationTrigger
                      ? `${token.name} (Só Mestre · Clique para abrir a Cena de Investigação · Arraste para mover)`
                      : `${token.name} (arraste para mover · arraste caixa no mapa para selecionar vários · botão direito com 2 selecionados para Duelo 3D)`
                    : mode === 'player' && !isText
                      ? `${token.name} (clique para selecionar e indicar destino · clique novamente para sinalizar)`
                      : token.name
                }
              >
                {/* Player Local Selection Halo (Point & Click planning indicator) */}
                {mode === 'player' && playerSelectedTokenId === token.id && !isText && (
                  <div
                    className={`absolute -inset-2 ${
                      isRect ? 'rounded-none' : 'rounded-full'
                    } border-2 border-dashed pointer-events-none`}
                    style={{
                      borderColor: getPlayerMarkerColor(currentUserUid),
                      boxShadow: `0 0 16px ${getPlayerMarkerColor(currentUserUid)}aa`,
                    }}
                  />
                )}

                {/* Rotating Aura Ring Behavior */}
                {token.behavior === 'spin_ring' && !isText && vitalStatus === 'alive' && (
                  <div
                    className={`absolute -inset-1.5 ${isRect ? 'rounded-md' : 'rounded-full'} border-2 border-dashed pointer-events-none token-spin-aura`}
                    style={{ borderColor: outlineCol }}
                  />
                )}

                {/* Multi-Selection Highlight Ring */}
                {isMultiSelected && (
                  <div
                    className={`absolute -inset-1.5 ${
                      isRect ? 'rounded-none' : 'rounded-full'
                    } border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.75)] pointer-events-none`}
                  />
                )}

                {/* Main Visual Body: Text Layer vs Image/Token Layer */}
                {isText ? (
                  <div
                    style={{
                      fontSize: `${Math.max(10, (token.fontSize || 24) * mapScale)}px`,
                      color: token.color || '#fdfbf7',
                      backgroundColor:
                        token.textBg !== false ? 'rgba(15, 14, 13, 0.82)' : 'transparent',
                    }}
                    className={`w-full h-full px-2.5 py-1 flex items-center justify-center text-center font-typewriter font-bold leading-snug overflow-hidden ${
                      token.textBg !== false ? 'border border-white/15 shadow-md' : ''
                    }`}
                  >
                    {mode === 'gm' && editingTextId === token.id ? (
                      <textarea
                        autoFocus
                        value={token.text ?? token.name}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          updateSingleToken({
                            ...token,
                            text: e.target.value,
                            name: e.target.value.slice(0, 40) || 'Texto',
                          })
                        }
                        onBlur={() => setEditingTextId(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setEditingTextId(null);
                          }
                        }}
                        className="w-full h-full bg-transparent text-center resize-none focus:outline-none"
                      />
                    ) : (
                      <span className="whitespace-pre-wrap break-words">
                        {token.text ?? token.name}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      ...getTokenBorderStyle(token, isSelected),
                      boxShadow:
                        vitalStatus === 'dying'
                          ? '0 0 22px 6px rgba(220, 38, 38, 0.92), 0 6px 16px rgba(0,0,0,0.65)'
                          : vitalStatus === 'unconscious'
                            ? '0 0 16px 3px rgba(99, 102, 241, 0.75), 0 4px 12px rgba(0,0,0,0.6)'
                            : getTokenShadowStyle(token, isHit),
                    }}
                    className={`relative w-full h-full ${
                      isRect ? 'rounded-none' : 'rounded-full'
                    } flex items-center justify-center overflow-hidden ${
                      vitalStatus === 'dying'
                        ? 'animate-pulse ring-2 ring-red-500'
                        : vitalStatus === 'unconscious'
                          ? 'ring-2 ring-indigo-400/90'
                          : vitalStatus === 'dead'
                            ? 'ring-2 ring-red-900/90'
                            : ''
                    }`}
                  >
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ filter: vitalFilterCss }}
                    >
                      {token.isInvestigationTrigger ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[#0d111a]/95 text-amber-300 relative">
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background:
                                'radial-gradient(circle, rgba(245,158,11,0.28) 0%, rgba(13,17,26,0.95) 72%)',
                            }}
                          />
                          <Search
                            className="relative z-10 text-amber-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
                            style={{
                              width: `${Math.max(16, Math.min(32, dispW * 0.44))}px`,
                              height: `${Math.max(16, Math.min(32, dispH * 0.44))}px`,
                            }}
                          />
                        </div>
                      ) : imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={token.name}
                          referrerPolicy="no-referrer"
                          draggable={false}
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-xs font-bold text-white uppercase"
                          style={{ backgroundColor: token.color }}
                        >
                          {token.name.slice(0, 2)}
                        </div>
                      )}
                    </div>

                    {/* Texture Overlay */}
                    {texClass && (
                      <div className={`absolute inset-0 pointer-events-none ${texClass}`} />
                    )}

                    {/* Vital Condition Visual Overlays (Unconscious / Dying / Dead) */}
                    {vitalStatus === 'unconscious' && (
                      <div className="absolute inset-0 bg-indigo-950/40 pointer-events-none flex items-center justify-center">
                        <Moon
                          className="text-indigo-200 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]"
                          style={{
                            width: `${Math.max(14, Math.min(34, dispW * 0.42))}px`,
                            height: `${Math.max(14, Math.min(34, dispH * 0.42))}px`,
                          }}
                        />
                      </div>
                    )}

                    {vitalStatus === 'dying' && (
                      <div
                        className="absolute inset-0 pointer-events-none flex items-center justify-center"
                        style={{
                          background:
                            'radial-gradient(circle, rgba(220,38,38,0.18) 25%, rgba(153,27,27,0.72) 100%)',
                        }}
                      >
                        <HeartPulse
                          className="text-red-200 animate-pulse drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]"
                          style={{
                            width: `${Math.max(14, Math.min(36, dispW * 0.45))}px`,
                            height: `${Math.max(14, Math.min(36, dispH * 0.45))}px`,
                          }}
                        />
                      </div>
                    )}

                    {vitalStatus === 'dead' && (
                      <div className="absolute inset-0 bg-black/45 pointer-events-none flex items-center justify-center">
                        <svg
                          viewBox="0 0 100 100"
                          className="absolute inset-0 w-full h-full pointer-events-none"
                        >
                          <line
                            x1="14"
                            y1="14"
                            x2="86"
                            y2="86"
                            stroke="#dc2626"
                            strokeWidth="10"
                            strokeLinecap="round"
                            opacity="0.92"
                          />
                          <line
                            x1="86"
                            y1="14"
                            x2="14"
                            y2="86"
                            stroke="#dc2626"
                            strokeWidth="10"
                            strokeLinecap="round"
                            opacity="0.92"
                          />
                        </svg>
                        <Skull
                          className="relative z-10 text-stone-100 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]"
                          style={{
                            width: `${Math.max(14, Math.min(36, dispW * 0.45))}px`,
                            height: `${Math.max(14, Math.min(36, dispH * 0.45))}px`,
                          }}
                        />
                      </div>
                    )}

                    {/* Live Hit Flash Overlay */}
                    {isHit && (
                      <div className="absolute inset-0 bg-red-600/55 pointer-events-none" />
                    )}
                  </div>
                )}

                {/* Photoshop-Style Transform Bounding Box & 8 Resize Handles (GM Single Selected Layer) */}
                {isSelected && selectedTokenIds.length <= 1 && activeTool === 'move' && !token.locked && (
                  <div className="absolute -inset-1 border border-sky-400 pointer-events-none">
                    {(
                      [
                        ['nw', '-top-1.5 -left-1.5 cursor-nwse-resize'],
                        ['ne', '-top-1.5 -right-1.5 cursor-nesw-resize'],
                        ['sw', '-bottom-1.5 -left-1.5 cursor-nesw-resize'],
                        ['se', '-bottom-1.5 -right-1.5 cursor-nwse-resize'],
                        ['n', '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                        ['s', '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                        ['w', 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize'],
                        ['e', 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize'],
                      ] as Array<[ResizeHandleDir, string]>
                    ).map(([dir, posClass]) => (
                      <div
                        key={dir}
                        onPointerDown={(e) => handleResizeHandlePointerDown(e, token, dir)}
                        className={`absolute w-3 h-3 bg-white border-2 border-sky-500 shadow pointer-events-auto ${posClass}`}
                        title="Arraste para redimensionar livremente"
                      />
                    ))}
                  </div>
                )}

                {/* Subtle GM Facing Indicator & Draggable Aim Handle for Directional Cone FOV */}
                {mode === 'gm' && token.visionEnabled && token.visionMode === 'cone' && !isText && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ transform: `rotate(${token.visionFacing ?? 0}deg)` }}
                  >
                    {/* Compact facing arrowhead on the rim */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -top-2.5 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[8px] border-b-amber-400 drop-shadow"
                    />
                    {/* Draggable Aim Handle when single-selected in Move mode */}
                    {isSelected && selectedTokenIds.length <= 1 && activeTool === 'move' && (
                      <>
                        <div className="absolute left-1/2 -translate-x-1/2 -top-8 w-0.5 h-6 bg-amber-400/90" />
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setAimingVisionTokenId(token.id);
                          }}
                          className="absolute left-1/2 -translate-x-1/2 -top-10 w-4 h-4 rounded-full bg-amber-400 border-2 border-stone-950 shadow-md cursor-grab active:cursor-grabbing pointer-events-auto flex items-center justify-center"
                          title={`Arraste para girar a visão frontal (${Math.round(token.visionFacing ?? 0)}°)`}
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-stone-950" />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Clean Compact Status Dots / Indicators (Buffs & Debuffs) */}
                {statuses.length > 0 && !isText && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5 pointer-events-none">
                    {statuses.slice(0, 5).map((st) => (
                      <span
                        key={st.id}
                        title={`${st.kind === 'buff' ? 'Buff' : 'Debuff'}: ${st.label}`}
                        className="w-2.5 h-2.5 rounded-full border border-white/90 shadow-sm"
                        style={{ backgroundColor: st.color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Token labels, vital condition tags & concise status text cleanly positioned underneath */}
          {interactiveLayers.map((token) => {
            if (mode !== 'gm' && token.hiddenFromPlayers) return null;
            if (token.layerKind === 'text' || token.layerKind === 'image') return null;
            const statuses = token.statuses || [];
            const vitalStatus: TokenVitalStatus = token.vitalStatus || 'alive';
            const refH = token.heightPx || token.sizePx || 52;
            const dispH = Math.max(16, refH * mapScale);
            return (
              <div
                key={`${token.id}_label`}
                style={{
                  left: `${token.x * 100}%`,
                  top: `calc(${token.y * 100}% + ${dispH / 2 + 5}px)`,
                  transform: 'translateX(-50%)',
                }}
                className="absolute z-10 flex flex-col items-center gap-0.5 pointer-events-none"
              >
                <div
                  className={`px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap flex items-center gap-1 ${
                    token.isInvestigationTrigger
                      ? 'bg-[#121620]/95 text-amber-200 border border-amber-400/45 shadow-md'
                      : 'bg-black/80 text-stone-100'
                  }`}
                >
                  {token.isInvestigationTrigger && <Search className="w-2.5 h-2.5 text-amber-400" />}
                  <span>
                    {token.name}
                    {token.isInvestigationTrigger
                      ? ' · Só Mestre'
                      : mode === 'gm' && token.hiddenFromPlayers
                        ? ' (Oculto)'
                        : ''}
                  </span>
                </div>
                {vitalStatus !== 'alive' && (
                  <div
                    className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none whitespace-nowrap shadow ${
                      vitalStatus === 'dead'
                        ? 'bg-red-950/95 text-red-200 border border-red-600/80'
                        : vitalStatus === 'dying'
                          ? 'bg-red-700 text-white animate-pulse'
                          : 'bg-indigo-900/95 text-indigo-100 border border-indigo-400/70'
                    }`}
                  >
                    {vitalStatus === 'dead'
                      ? 'MORTO'
                      : vitalStatus === 'dying'
                        ? 'MORRENDO'
                        : 'INCONSCIENTE'}
                  </div>
                )}
                {statuses.length > 0 && (
                  <div className="px-1.5 py-0.5 text-[9px] leading-none bg-black/70 text-stone-200 whitespace-nowrap max-w-[140px] truncate">
                    {statuses.map((s) => s.label).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Fog of War + Dynamic 2D Raycast Vision Layer (z-20 hides unseen enemies on TV/Player!) */}
        {shouldRenderFogLayer && (
          <canvas
            ref={fogCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
          />
        )}

        {/* GM-Only Interactive Walls & Doors Overlay (Players never see GM wall wireframes!) */}
        {mode === 'gm' && (localWalls.length > 0 || wallDraft) && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-25">
            {localWalls.map((wall) => {
              const x1 = wall.x1 * mapBoxSize.width;
              const y1 = wall.y1 * mapBoxSize.height;
              const x2 = wall.x2 * mapBoxSize.width;
              const y2 = wall.y2 * mapBoxSize.height;
              const isDoor = wall.kind === 'door';
              const strokeColor = isDoor
                ? wall.isOpen
                  ? '#34d399'
                  : '#38bdf8'
                : '#f59e0b';
              return (
                <g key={wall.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="rgba(0,0,0,0.65)"
                    strokeWidth={isDoor ? 7 : 6}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={strokeColor}
                    strokeWidth={isDoor ? 3.5 : 3}
                    strokeDasharray={isDoor && wall.isOpen ? '6 5' : undefined}
                    strokeLinecap="round"
                  />
                  <circle cx={x1} cy={y1} r={3} fill={strokeColor} />
                  <circle cx={x2} cy={y2} r={3} fill={strokeColor} />
                </g>
              );
            })}

            {wallDraft && (
              <line
                x1={wallDraft.x1 * mapBoxSize.width}
                y1={wallDraft.y1 * mapBoxSize.height}
                x2={wallDraft.x2 * mapBoxSize.width}
                y2={wallDraft.y2 * mapBoxSize.height}
                stroke={wallDraft.kind === 'door' ? '#38bdf8' : '#fbbf24'}
                strokeWidth={3}
                strokeDasharray="6 4"
                strokeLinecap="round"
              />
            )}
          </svg>
        )}

        {/* GM-Only 1-Click Door Open/Close Toggle Handles */}
        {mode === 'gm' &&
          localWalls
            .filter((w) => w.kind === 'door')
            .map((door) => {
              const mx = ((door.x1 + door.x2) / 2) * 100;
              const my = ((door.y1 + door.y2) / 2) * 100;
              return (
                <button
                  key={`door_btn_${door.id}`}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeTool === 'wall_erase') {
                      removeWall(door.id);
                    } else {
                      toggleDoor(door.id);
                    }
                  }}
                  style={{
                    left: `${mx}%`,
                    top: `${my}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute z-30 w-6 h-6 rounded-full border shadow-md flex items-center justify-center transition-colors ${
                    door.isOpen
                      ? 'bg-emerald-700 border-emerald-200 text-white'
                      : 'bg-sky-700 border-sky-200 text-white'
                  }`}
                  title={
                    door.isOpen
                      ? 'Porta aberta (visão passa) — clique para fechar'
                      : 'Porta fechada (bloqueia visão) — clique para abrir'
                  }
                  aria-label={door.isOpen ? 'Fechar porta' : 'Abrir porta'}
                >
                  {door.isOpen ? (
                    <DoorOpen className="w-3.5 h-3.5" />
                  ) : (
                    <DoorClosed className="w-3.5 h-3.5" />
                  )}
                </button>
              );
            })}

        {/* Temporary Player Point & Click Markers, Traced Routes & Token Signals (Synced on GM, Player & TV) */}
        {(activePlayerMarkers.length > 0 || (mode === 'player' && playerPathDraft)) && (
          <>
            {/* Animated Route / Path SVG Layer */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-[28]">
              {activePlayerMarkers.map((marker) => {
                if (marker.kind !== 'path' || !marker.points || marker.points.length < 2) {
                  return null;
                }
                const remainingMs = Math.max(0, marker.expiresAtMs - markerNowMs);
                const fadeAlpha = Math.min(1, remainingMs / PLAYER_MARKER_FADE_MS);
                const w = mapBoxSize.width;
                const h = mapBoxSize.height;
                const d = pointsToSvgPath(marker.points, w, h);
                const lastPt = marker.points[marker.points.length - 1];
                const prevPt = marker.points[marker.points.length - 2];
                const x1 = prevPt.x * w;
                const y1 = prevPt.y * h;
                const x2 = lastPt.x * w;
                const y2 = lastPt.y * h;
                const angle = Math.atan2(y2 - y1, x2 - x1);
                const headLen = 14;
                const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
                const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
                const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
                const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
                const startX = marker.points[0].x * w;
                const startY = marker.points[0].y * h;

                return (
                  <g key={`pmk_path_${marker.id}`} opacity={fadeAlpha}>
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(0,0,0,0.72)"
                      strokeWidth={6.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={marker.color}
                      strokeWidth={3.2}
                      strokeDasharray="10 6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="player-path-march"
                    />
                    <circle
                      cx={startX}
                      cy={startY}
                      r={4.5}
                      fill={marker.color}
                      stroke="#0c0a09"
                      strokeWidth={2}
                    />
                    <polygon
                      points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
                      fill={marker.color}
                      stroke="#0c0a09"
                      strokeWidth={1.2}
                    />
                  </g>
                );
              })}

              {/* Live Path Draft while player is dragging */}
              {mode === 'player' && playerPathDraft && playerPathDraft.points.length >= 2 && (() => {
                const draftCol = getPlayerMarkerColor(currentUserUid);
                const w = mapBoxSize.width;
                const h = mapBoxSize.height;
                const d = pointsToSvgPath(playerPathDraft.points, w, h);
                return (
                  <g opacity={0.9}>
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(0,0,0,0.65)"
                      strokeWidth={6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={draftCol}
                      strokeWidth={3}
                      strokeDasharray="8 6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="player-path-march"
                    />
                  </g>
                );
              })()}
            </svg>

            {/* Point & Click Destination Beacons, Token Lock Halos & Interactive Labels */}
            <div className="absolute inset-0 pointer-events-none z-[29]">
              {activePlayerMarkers.map((marker) => {
                const remainingMs = Math.max(0, marker.expiresAtMs - markerNowMs);
                const fadeAlpha = Math.min(1, remainingMs / PLAYER_MARKER_FADE_MS);
                const liveToken = marker.tokenId
                  ? localTokens.find((t) => t.id === marker.tokenId) || null
                  : null;
                const posX = marker.kind === 'token' && liveToken ? liveToken.x : marker.x;
                const posY = marker.kind === 'token' && liveToken ? liveToken.y : marker.y;
                const tokenSpan = liveToken
                  ? Math.max(46, Math.max(liveToken.widthPx || liveToken.sizePx || 52, liveToken.heightPx || liveToken.sizePx || 52) + 18)
                  : 58;
                const canDismiss =
                  mode === 'gm' || (mode === 'player' && marker.authorUid === currentUserUid);
                const distUnits =
                  marker.kind === 'path' && scene.grid.enabled && marker.points && marker.points.length >= 2
                    ? computePolylineUnits(
                        marker.points,
                        mapBoxSize.width,
                        mapBoxSize.height,
                        scene.grid.cellSizePx,
                        scene.grid.unitValue
                      )
                    : 0;

                const captionText =
                  marker.kind === 'token'
                    ? `${marker.authorName} · ${marker.tokenName || marker.label || 'Alvo'}`
                    : marker.kind === 'path'
                      ? `${marker.authorName}${marker.tokenName ? ` · ${marker.tokenName}` : ' · Ir aqui'}${
                          distUnits >= 0.3 ? ` · ${distUnits.toFixed(1)}${scene.grid.unitLabel}` : ''
                        }`
                      : `${marker.authorName} · ${marker.label || 'Aqui'}`;

                return (
                  <div
                    key={marker.id}
                    style={{
                      left: `${posX * 100}%`,
                      top: `${posY * 100}%`,
                      opacity: fadeAlpha,
                      transition: 'opacity 300ms linear',
                    }}
                    className="absolute"
                  >
                    {marker.kind === 'token' ? (
                      <>
                        {/* Animated Token Target Lock Halo */}
                        <div
                          style={{
                            width: `${tokenSpan}px`,
                            height: `${tokenSpan}px`,
                            borderColor: marker.color,
                            boxShadow: `0 0 20px ${marker.color}88, inset 0 0 12px ${marker.color}33`,
                          }}
                          className="absolute rounded-full border-2 player-token-lock pointer-events-none"
                        />
                        <div
                          style={{
                            width: `${tokenSpan + 10}px`,
                            height: `${tokenSpan + 10}px`,
                            borderColor: marker.color,
                          }}
                          className="absolute rounded-full border player-ping-ripple pointer-events-none"
                        />
                      </>
                    ) : (
                      <>
                        {/* Point & Click Ground Reticle Ripples */}
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderColor: marker.color,
                          }}
                          className="absolute rounded-full border-2 player-ping-ripple pointer-events-none"
                        />
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderColor: marker.color,
                          }}
                          className="absolute rounded-full border player-ping-ripple-delayed pointer-events-none"
                        />
                        <div
                          style={{
                            width: '18px',
                            height: '18px',
                            borderColor: marker.color,
                            backgroundColor: `${marker.color}28`,
                            boxShadow: `0 0 12px ${marker.color}bb`,
                          }}
                          className="absolute rounded-full border-2 player-ping-beacon pointer-events-none flex items-center justify-center"
                        >
                          <div
                            style={{ backgroundColor: marker.color }}
                            className="w-2 h-2 rotate-45"
                          />
                        </div>
                      </>
                    )}

                    {/* Floating Crisp Author / Destination Label + GM/Owner Dismiss X */}
                    <div
                      style={{
                        transform: `translate(-50%, ${marker.kind === 'token' ? -(tokenSpan / 2 + 26) : -38}px)`,
                        borderColor: `${marker.color}99`,
                      }}
                      className="absolute flex items-center gap-1.5 px-2 py-0.5 bg-stone-950/92 border text-stone-100 text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-auto"
                    >
                      <span
                        style={{ backgroundColor: marker.color }}
                        className="w-2 h-2 shrink-0 rotate-45"
                      />
                      <span className="max-w-[200px] truncate">{captionText}</span>
                      {canDismiss && onRemovePlayerMarker && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDismissMarker(marker.id);
                          }}
                          className="ml-0.5 p-0.5 text-stone-400 hover:text-white hover:bg-white/15 transition-colors"
                          title="Apagar esta marcação"
                          aria-label="Apagar marcação"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Ephemeral Quick Ruler Layer */}
        {ruler && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
            <line
              x1={ruler.startX}
              y1={ruler.startY}
              x2={ruler.endX}
              y2={ruler.endY}
              stroke="#fdfbf7"
              strokeWidth="3"
              strokeDasharray="6 4"
            />
            <line
              x1={ruler.startX}
              y1={ruler.startY}
              x2={ruler.endX}
              y2={ruler.endY}
              stroke="#8f2d2d"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <circle
              cx={ruler.startX}
              cy={ruler.startY}
              r="4"
              fill="#fdfbf7"
              stroke="#8f2d2d"
              strokeWidth="2"
            />
            <circle
              cx={ruler.endX}
              cy={ruler.endY}
              r="4"
              fill="#fdfbf7"
              stroke="#8f2d2d"
              strokeWidth="2"
            />
            <g
              transform={`translate(${(ruler.startX + ruler.endX) / 2}, ${
                (ruler.startY + ruler.endY) / 2 - 14
              })`}
            >
              <rect x="-64" y="-14" width="128" height="24" rx="2" fill="rgba(20, 19, 17, 0.92)" />
              <text
                x="0"
                y="2"
                textAnchor="middle"
                fill="#fdfbf7"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
              >
                {rulerUnits.toFixed(1)}
                {scene.grid.unitLabel} · {rulerSquares.toFixed(1)}q
              </text>
            </g>
          </svg>
        )}

        {/* Right-Click Floating Context Menu: Multi-Selection & 3D Duel Menu OR Single Token Editor */}
        {mode === 'gm' && contextMenu && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, width: '286px' }}
            className="absolute z-40"
          >
            {contextMenu.isGroupMenu && selectedTokenIds.length >= 2 ? (
              <div className="vtt-surface border vtt-border shadow-2xl flex flex-col text-xs overflow-hidden">
                <div className="px-3 py-2.5 border-b vtt-border vtt-subtle flex items-center justify-between gap-2">
                  <span className="font-bold font-typewriter">
                    {selectedTokenIds.length} Tokens Selecionados
                  </span>
                  <button
                    type="button"
                    onClick={() => setContextMenu(null)}
                    className="p-1 vtt-muted hover:opacity-100"
                    aria-label="Fechar menu"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-3 space-y-2.5">
                  {selectedCombatantPair.length === 2 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const [tokA, tokB] = selectedCombatantPair;
                        setContextMenu(null);
                        onRequestDuelPair?.(tokA, tokB);
                      }}
                      className="w-full py-2.5 px-3 text-xs font-bold font-typewriter bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-md flex items-center justify-center gap-2"
                    >
                      <Swords className="w-4 h-4 shrink-0" />
                      <span className="truncate">
                        Iniciar Duelo 3D ({selectedCombatantPair[0].name} vs{' '}
                        {selectedCombatantPair[1].name})
                      </span>
                    </button>
                  ) : (
                    <p className="text-[11px] vtt-muted px-2 py-1.5 border vtt-border vtt-canvas">
                      Selecione exatamente <strong>2 tokens</strong> para iniciar o Modo Duelo 3D.
                    </p>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider vtt-muted block">
                      Estado Vital do Grupo
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => handleBatchVitalStatus(selectedTokenIds, 'alive')}
                        className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1.5"
                      >
                        <Heart className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Vivo / Normal</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBatchVitalStatus(selectedTokenIds, 'unconscious')}
                        className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1.5"
                      >
                        <Moon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Inconsciente</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBatchVitalStatus(selectedTokenIds, 'dying')}
                        className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1.5"
                      >
                        <HeartPulse className="w-3.5 h-3.5 text-amber-400" />
                        <span>Morrendo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBatchVitalStatus(selectedTokenIds, 'dead')}
                        className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1.5"
                      >
                        <Skull className="w-3.5 h-3.5 text-red-500" />
                        <span>Morto</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1 border-t vtt-border">
                    <button
                      type="button"
                      onClick={() => handleBatchHit(selectedTokenIds)}
                      className="py-1.5 px-2 text-[11px] font-semibold bg-red-700 hover:bg-red-800 text-white flex items-center justify-center gap-1"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Hit em Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchVisibility(selectedTokenIds, false)}
                      className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Revelar Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchVisibility(selectedTokenIds, true)}
                      className="py-1.5 px-2 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-center gap-1"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Ocultar Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSelectedTokens(selectedTokenIds)}
                      className="py-1.5 px-2 text-[11px] border vtt-border text-red-600 dark:text-red-400 hover:vtt-subtle flex items-center justify-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remover ({selectedTokenIds.length})
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              contextToken && (
                <TokenEditorPanel
                  token={contextToken}
                  uploadContext={uploadContext}
                  compact
                  onChange={(updated) => updateSingleToken(updated)}
                  onTriggerHit={() => triggerTokenHit(contextToken.id)}
                  onShowPopup={onShowTokenPopup}
                  onSaveToVault={onSaveToVault}
                  onDelete={() => handleDeleteToken(contextToken.id)}
                  onClose={() => setContextMenu(null)}
                  onNotify={onNotify}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* GM Multi-Selection Floating Quick Action Bar (when 2+ tokens are selected) */}
      {mode === 'gm' &&
        selectedTokenIds.length > 1 &&
        !draggingTokenId &&
        !groupDragState &&
        !resizingState &&
        !contextMenu && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 vtt-surface border px-3 py-2 flex items-center gap-2 shadow-xl max-w-[96%] flex-wrap justify-center"
          >
            <span className="text-xs font-bold font-typewriter text-amber-400">
              {selectedTokenIds.length} selecionados
            </span>
            {selectedCombatantPair.length === 2 && (
              <button
                type="button"
                onClick={() => onRequestDuelPair?.(selectedCombatantPair[0], selectedCombatantPair[1])}
                className="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-stone-950 flex items-center gap-1.5 shadow"
                title="Ou clique com o botão direito nos 2 tokens selecionados"
              >
                <Swords className="w-3.5 h-3.5" />
                Iniciar Duelo 3D (ou Botão Direito)
              </button>
            )}
            <div className="flex items-center gap-1 border-l vtt-border pl-2">
              <button
                type="button"
                onClick={() => handleBatchVitalStatus(selectedTokenIds, 'alive')}
                className="px-2 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1"
                title="Marcar selecionados como Vivos"
              >
                <Heart className="w-3 h-3 text-emerald-500" />
                Vivo
              </button>
              <button
                type="button"
                onClick={() => handleBatchVitalStatus(selectedTokenIds, 'unconscious')}
                className="px-2 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1"
                title="Marcar selecionados como Inconscientes"
              >
                <Moon className="w-3 h-3 text-indigo-400" />
                Inconsciente
              </button>
              <button
                type="button"
                onClick={() => handleBatchVitalStatus(selectedTokenIds, 'dying')}
                className="px-2 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1"
                title="Marcar selecionados como Morrendo"
              >
                <HeartPulse className="w-3 h-3 text-amber-400" />
                Morrendo
              </button>
              <button
                type="button"
                onClick={() => handleBatchVitalStatus(selectedTokenIds, 'dead')}
                className="px-2 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1"
                title="Marcar selecionados como Mortos"
              >
                <Skull className="w-3 h-3 text-red-500" />
                Morto
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleDeleteSelectedTokens(selectedTokenIds)}
              className="p-1.5 border vtt-border text-red-600 dark:text-red-400 hover:vtt-subtle"
              title="Remover selecionados"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      {/* GM Single Selected Layer Floating Quick Action Bar */}
      {mode === 'gm' &&
        selectedToken &&
        selectedTokenIds.length <= 1 &&
        !draggingTokenId &&
        !groupDragState &&
        !resizingState &&
        !contextMenu && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 vtt-surface border px-3 py-2 flex items-center gap-1.5 shadow-lg max-w-[96%] flex-wrap justify-center"
          >
            <span className="text-xs font-semibold truncate max-w-[120px]">
              {selectedToken.name}
            </span>
            <span className="text-xs vtt-muted" aria-hidden="true">
              ·
            </span>
            {selectedToken.isInvestigationTrigger ? (
              <button
                type="button"
                onClick={() => onOpenInvestigationToken?.(selectedToken)}
                className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-stone-950 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Abrir a aba de Cena de Investigação vinculada a este marcador"
              >
                <Search className="w-3.5 h-3.5" />
                Abrir Cena de Investigação
              </button>
            ) : (
              selectedToken.layerKind !== 'text' && (
                <>
                  {/* 1-Click Vital Condition Pills directly on the floating bar */}
                  <div className="flex items-center border vtt-border vtt-canvas">
                    {(
                      [
                        { id: 'alive' as const, label: 'Vivo', icon: Heart, color: 'text-emerald-500' },
                        {
                          id: 'unconscious' as const,
                          label: 'Inconsc.',
                          icon: Moon,
                          color: 'text-indigo-400',
                        },
                        {
                          id: 'dying' as const,
                          label: 'Morrendo',
                          icon: HeartPulse,
                          color: 'text-amber-400',
                        },
                        { id: 'dead' as const, label: 'Morto', icon: Skull, color: 'text-red-500' },
                      ]
                    ).map((st) => {
                      const Icon = st.icon;
                      const active = (selectedToken.vitalStatus || 'alive') === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            updateSingleToken({ ...selectedToken, vitalStatus: st.id })
                          }
                          className={`px-2 py-1 text-[11px] flex items-center gap-1 transition-colors ${
                            active
                              ? 'vtt-accent-btn font-bold'
                              : 'vtt-muted hover:opacity-100'
                          }`}
                          title={`Estado vital: ${st.label}`}
                        >
                          <Icon className={`w-3 h-3 ${active ? '' : st.color}`} />
                          <span className="hidden sm:inline">{st.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerTokenHit(selectedToken.id)}
                    className="px-2 py-1.5 text-xs font-semibold bg-red-700 hover:bg-red-800 text-white flex items-center gap-1 whitespace-nowrap shrink-0"
                    title="Efeito de dano / hit no token"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Hit
                  </button>
                </>
              )
            )}
            <button
              type="button"
              onClick={() =>
                setContextMenu({
                  tokenId: selectedToken.id,
                  x: Math.max(
                    12,
                    Math.min(
                      mapBoxSize.width - 294,
                      selectedToken.x * mapBoxSize.width + 24
                    )
                  ),
                  y: Math.max(
                    12,
                    Math.min(
                      mapBoxSize.height - 420,
                      selectedToken.y * mapBoxSize.height - 80
                    )
                  ),
                })
              }
              className="px-2.5 py-1.5 text-xs border vtt-border flex items-center gap-1 whitespace-nowrap shrink-0"
              title="Propriedades da camada (ou botão direito)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Editar
            </button>
            {onSaveToVault && (selectedToken.imageUrl || selectedToken.mediaId) && (
              <button
                type="button"
                onClick={() => onSaveToVault(selectedToken)}
                className="px-2 py-1.5 text-xs border vtt-border flex items-center gap-1 whitespace-nowrap shrink-0"
                title="Salvar imagem no Acervo para replicar"
              >
                <BookmarkPlus className="w-3.5 h-3.5 vtt-accent-text" />
                Acervo
              </button>
            )}
            {selectedToken.layerKind !== 'text' && (
              <button
                type="button"
                onClick={() =>
                  onShowTokenPopup?.({
                    id: `tok_pop_${selectedToken.id}`,
                    title: selectedToken.name,
                    kind: 'npc',
                    imageUrl: selectedToken.imageUrl || '',
                    mediaId: selectedToken.mediaId || '',
                    body: selectedToken.notes || '',
                    spotlightMode:
                      selectedToken.tokenCategory === 'item'
                        ? 'item'
                        : selectedToken.tokenCategory === 'player' || Boolean(selectedToken.sheetId)
                          ? 'character'
                          : 'npc',
                    accentColor: selectedToken.outlineColor || selectedToken.color || '',
                    combatSpriteUrl: selectedToken.combatSpriteUrl || '',
                    combatSpriteMediaId: selectedToken.combatSpriteMediaId || '',
                    presentedAtMs: Date.now(),
                  })
                }
                className="px-2.5 py-1.5 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Mostrar TV
              </button>
            )}
            <button
              type="button"
              onClick={() => handleToggleTokenLock(selectedToken.id)}
              className="p-1.5 text-xs border vtt-border shrink-0"
              title={selectedToken.locked ? 'Destravar camada' : 'Travar camada'}
            >
              {selectedToken.locked ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <Unlock className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleToggleTokenVisibility(selectedToken.id)}
              className="p-1.5 text-xs border vtt-border shrink-0"
              title={selectedToken.hiddenFromPlayers ? 'Revelar aos jogadores' : 'Ocultar dos jogadores'}
              aria-label={selectedToken.hiddenFromPlayers ? 'Revelar' : 'Ocultar'}
            >
              {selectedToken.hiddenFromPlayers ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteToken(selectedToken.id)}
              className="p-1.5 border vtt-border text-red-700 dark:text-red-400 shrink-0"
              title="Remover camada (Delete)"
              aria-label="Remover camada"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      {/* GM Quick Dismiss Control whenever players have active temporary pings/paths on this scene */}
      {mode === 'gm' && !effectiveDuel && activePlayerMarkers.length > 0 && onClearPlayerMarkers && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 right-3 z-30 flex items-center gap-1.5 vtt-surface/95 backdrop-blur-sm border vtt-border px-2.5 py-1.5 shadow-xl"
        >
          <span className="text-[11px] vtt-muted whitespace-nowrap tabular-nums">
            {activePlayerMarkers.length} marcaç{activePlayerMarkers.length === 1 ? 'ão' : 'ões'} de jogadores
          </span>
          <button
            type="button"
            onClick={() => handleClearMarkers('all')}
            className="px-2 py-1 text-[11px] font-semibold border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Apagar imediatamente todas as marcações e caminhos dos jogadores nesta cena"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        </div>
      )}

      {/* Player Point & Click Indication HUD Bar (Select Token, Mark Location, Trace Path — read-only) */}
      {mode === 'player' && !effectiveDuel && onPublishPlayerMarker && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 vtt-surface/95 backdrop-blur-md border vtt-border px-2 py-1.5 shadow-2xl flex items-center gap-1.5 max-w-[96%] overflow-x-auto"
        >
          <div className="flex items-center border vtt-border vtt-canvas shrink-0">
            <button
              type="button"
              onClick={() => setPlayerTool('point')}
              className={`min-h-[36px] px-2.5 py-1 text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                playerTool === 'point' ? 'vtt-accent-btn font-semibold' : 'vtt-muted hover:opacity-100'
              }`}
              title="Clique em um token para selecionar e clique no mapa para indicar destino, ou clique em qualquer lugar para marcar"
            >
              <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
              <span>Apontar / Ir</span>
            </button>
            <button
              type="button"
              onClick={() => setPlayerTool('path')}
              className={`min-h-[36px] px-2.5 py-1 text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                playerTool === 'path' ? 'vtt-accent-btn font-semibold' : 'vtt-muted hover:opacity-100'
              }`}
              title="Arraste sobre o mapa para traçar um caminho temporário até onde deseja ir"
            >
              <Route className="w-3.5 h-3.5 shrink-0" />
              <span>Traçar Caminho</span>
            </button>
          </div>

          {playerSelectedToken && (
            <div className="flex items-center gap-1.5 pl-1.5 border-l vtt-border shrink-0">
              <span className="text-xs font-semibold max-w-[110px] truncate" title={playerSelectedToken.name}>
                {playerSelectedToken.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  emitPlayerMarker({
                    kind: 'token',
                    x: playerSelectedToken.x,
                    y: playerSelectedToken.y,
                    tokenId: playerSelectedToken.id,
                    tokenName: playerSelectedToken.name,
                    label: playerSelectedToken.name,
                  });
                  onNotify?.(`Sinalizou "${playerSelectedToken.name}" para o mestre.`);
                }}
                className="min-h-[36px] px-2 py-1 text-[11px] font-semibold border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1 whitespace-nowrap shrink-0"
                title="Destacar este token no mapa para o mestre e outros jogadores"
              >
                <Crosshair className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                <span>Sinalizar</span>
              </button>
              <button
                type="button"
                onClick={() => setPlayerSelectedTokenId(null)}
                className="min-h-[36px] px-1.5 py-1 vtt-muted hover:opacity-100 shrink-0"
                title="Desmarcar token selecionado"
                aria-label="Desmarcar token"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {myActiveMarkersCount > 0 && onClearPlayerMarkers && (
            <button
              type="button"
              onClick={() => handleClearMarkers('mine')}
              className="min-h-[36px] px-2 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1 whitespace-nowrap shrink-0 ml-0.5"
              title="Apagar minhas marcações temporárias desta cena"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Limpar ({myActiveMarkersCount})</span>
            </button>
          )}
        </div>
      )}

      {/* Floating Map Zoom & Pan Controls (Zooms unified stage without shifting tokens, walls, or fog) */}
      {(mode === 'gm' || mode === 'player') && !effectiveDuel && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 left-3 z-20 vtt-surface/95 backdrop-blur-sm border vtt-border flex items-center gap-0.5 p-0.5 shadow-lg"
          title="Ctrl+Roda para dar zoom no mapa · Botão do meio ou Alt+Arrastar para mover"
        >
          <button
            type="button"
            onClick={() => setMapZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            disabled={mapZoom <= 0.5}
            className="p-1.5 vtt-muted hover:opacity-100 disabled:opacity-30 transition-opacity"
            title="Afastar zoom do mapa"
            aria-label="Afastar zoom"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMapZoom(1);
              setMapPan({ x: 0, y: 0 });
            }}
            className="px-2 py-1 text-[11px] font-semibold tabular-nums hover:vtt-subtle transition-colors min-w-[46px] text-center"
            title="Clique para resetar zoom e enquadramento (100%)"
          >
            {Math.round(mapZoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setMapZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
            disabled={mapZoom >= 4}
            className="p-1.5 vtt-muted hover:opacity-100 disabled:opacity-30 transition-opacity"
            title="Aproximar zoom do mapa"
            aria-label="Aproximar zoom"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          {(mapZoom !== 1 || mapPan.x !== 0 || mapPan.y !== 0) && (
            <button
              type="button"
              onClick={() => {
                setMapZoom(1);
                setMapPan({ x: 0, y: 0 });
              }}
              className="p-1.5 border-l vtt-border vtt-accent-text hover:vtt-subtle transition-colors"
              title="Resetar enquadramento do mapa"
              aria-label="Resetar zoom do mapa"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
