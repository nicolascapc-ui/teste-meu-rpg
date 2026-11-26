import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  DoorClosed,
  DoorOpen,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Maximize2,
  SlidersHorizontal,
  Swords,
  Trash2,
  Unlock,
  Upload,
  Zap,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  BrushPoint,
  BrushStyleId,
  FogStroke,
  LiveSceneSnapshot,
  SceneToken,
  SceneWall,
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
  onSaveToVault?: (token: SceneToken) => void;
  onToolChange?: (tool: CanvasTool) => void;
  onNotify?: (msg: string) => void;
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
}

const REFERENCE_MAP_WIDTH = 1200;

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
  onSaveToVault,
  onToolChange,
  onNotify,
}: TabletopCanvasProps) {
  const outerStageRef = useRef<HTMLDivElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
  const [duelCandidateId, setDuelCandidateId] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [resizingState, setResizingState] = useState<ResizeInteractionState | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [dragHoverCoords, setDragHoverCoords] = useState<{ nx: number; ny: number } | null>(null);

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
    if (!draggingTokenId && !resizingState) {
      setLocalTokens(scene?.tokens || []);
    }
  }, [scene?.tokens, draggingTokenId, resizingState]);

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

    // Block accidental Ctrl+Wheel browser zoom while hovering over the map stage so token/wall positioning stays 100% locked
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      obs.disconnect();
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Support Ctrl+V (paste image directly onto tabletop!) and Delete/Backspace for selected layer
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTokenId) {
        e.preventDefault();
        handleDeleteToken(selectedTokenId);
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
        const poly = computeVisibilityPolygon(ox, oy, radiusPx, localWalls, w, h);
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

  function handleStagePointerDown(e: React.PointerEvent) {
    if (!scene) return;
    setContextMenu(null);
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

    setSelectedTokenId(null);
    setEditingTextId(null);
  }

  function handleStagePointerMove(e: React.PointerEvent) {
    if (!scene) return;
    const { px, py, nx, ny } = getRelativeCoords(e.clientX, e.clientY);
    lastHoverCoordsRef.current = { nx, ny };

    if (ruler) {
      setRuler((prev) => (prev ? { ...prev, endX: px, endY: py } : null));
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

    // Active Token / Layer Dragging (broadcasts in real-time to Shared TV!)
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

  function handleStagePointerUp() {
    if (ruler) {
      setRuler(null);
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

    if (draggingTokenId) {
      setDraggingTokenId(null);
      onTokensChange?.(localTokens);
    }
  }

  function handleTokenPointerDown(e: React.PointerEvent, token: SceneToken) {
    if (mode !== 'gm') return;
    if (e.button !== 0) return;

    // 1. Direct Confrontation / Duel Mode Selection (clicking Token 1 then Token 2, or Shift+Click)
    const isDuelSelection =
      activeTool === 'duel' ||
      Boolean(duelCandidateId) ||
      (activeTool === 'move' && e.shiftKey && selectedTokenId && selectedTokenId !== token.id);

    if (isDuelSelection && token.layerKind !== 'text' && token.layerKind !== 'brush') {
      e.stopPropagation();
      setContextMenu(null);
      const firstId = duelCandidateId || (e.shiftKey ? selectedTokenId : null);
      if (!firstId || firstId === token.id) {
        setDuelCandidateId(token.id);
        setSelectedTokenId(token.id);
        onNotify?.(`"${token.name}" selecionado para confronto. Agora clique no 2º token (oponente)!`);
        return;
      }
      const firstToken = localTokens.find((t) => t.id === firstId);
      if (firstToken && firstToken.id !== token.id) {
        setDuelCandidateId(null);
        setSelectedTokenId(null);
        onRequestDuelPair?.(firstToken, token);
        return;
      }
    }

    if (activeTool !== 'move' || e.shiftKey) return;
    e.stopPropagation();
    setContextMenu(null);
    if (editingTextId && editingTextId !== token.id) {
      setEditingTextId(null);
    }
    setSelectedTokenId(token.id);
    if (token.locked) return;
    const { nx, ny } = getRelativeCoords(e.clientX, e.clientY);
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
    const popW = 284;
    const popH = 420;
    const x = Math.max(10, Math.min(mapBoxSize.width - popW - 10, rawX + 10));
    const y = Math.max(10, Math.min(mapBoxSize.height - popH - 10, rawY - 24));
    setSelectedTokenId(token.id);
    setContextMenu({ tokenId: token.id, x, y });
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
    setEditingTextId(null);
    setContextMenu(null);
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
    const tokenPayloadRaw = e.dataTransfer.getData('application/x-folio-token');
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
    mode !== 'gm'
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

      {/* Pre-Established Fixed Logical Coordinate Stage (1200 x referenceHeight, scaled uniformly) */}
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
          }
        }}
        style={{
          width: `${mapBoxSize.width}px`,
          height: `${mapBoxSize.height}px`,
          transform: `scale(${stageDisplayScale})`,
          transformOrigin: 'center center',
        }}
        className={`relative overflow-hidden shadow-2xl bg-stone-950 shrink-0 ${cursorClass}`}
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
            const isSelected = mode === 'gm' && selectedTokenId === token.id;
            const isHit = Boolean(token.hitAtMs && nowMs - token.hitAtMs < 650);
            const isText = token.layerKind === 'text';
            const isRect = token.shape === 'rect' || token.layerKind === 'image' || isText;

            const refW = token.widthPx || token.sizePx || 52;
            const refH = token.heightPx || token.sizePx || 52;
            const dispW = Math.max(16, refW * mapScale);
            const dispH = Math.max(16, refH * mapScale);

            const behaviorClass =
              token.behavior === 'float'
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

            return (
              <div
                key={token.id}
                onPointerDown={(e) => handleTokenPointerDown(e, token)}
                onDoubleClick={(e) => {
                  if (mode === 'gm' && isText) {
                    e.stopPropagation();
                    setSelectedTokenId(token.id);
                    setEditingTextId(token.id);
                  }
                }}
                onContextMenu={(e) => handleTokenContextMenu(e, token)}
                style={{
                  left: `${token.x * 100}%`,
                  top: `${token.y * 100}%`,
                  width: `${dispW}px`,
                  height: `${dispH}px`,
                  transform: 'translate(-50%, -50%)',
                  opacity: token.hiddenFromPlayers
                    ? 0.52
                    : typeof token.opacity === 'number'
                      ? token.opacity
                      : 1,
                }}
                className={`absolute ${behaviorClass} ${isHit ? 'token-hit-active' : ''} ${
                  mode === 'gm' && activeTool === 'move'
                    ? token.locked
                      ? 'pointer-events-auto cursor-default'
                      : 'pointer-events-auto cursor-grab active:cursor-grabbing'
                    : 'pointer-events-none'
                } ${isSelected ? 'z-20' : 'z-10'}`}
                title={
                  mode === 'gm'
                    ? `${token.name} (arraste as alças nos cantos para redimensionar · botão direito para editar)`
                    : token.name
                }
              >
                {/* Rotating Aura Ring Behavior */}
                {token.behavior === 'spin_ring' && !isText && (
                  <div
                    className={`absolute -inset-1.5 ${isRect ? 'rounded-md' : 'rounded-full'} border-2 border-dashed pointer-events-none token-spin-aura`}
                    style={{ borderColor: outlineCol }}
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
                      boxShadow: getTokenShadowStyle(token, isHit),
                    }}
                    className={`relative w-full h-full ${
                      isRect ? 'rounded-none' : 'rounded-full'
                    } flex items-center justify-center overflow-hidden`}
                  >
                    {imgSrc ? (
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

                    {/* Texture Overlay */}
                    {texClass && (
                      <div className={`absolute inset-0 pointer-events-none ${texClass}`} />
                    )}

                    {/* Live Hit Flash Overlay */}
                    {isHit && (
                      <div className="absolute inset-0 bg-red-600/55 pointer-events-none" />
                    )}
                  </div>
                )}

                {/* Photoshop-Style Transform Bounding Box & 8 Resize Handles (GM Selected Layer) */}
                {isSelected && activeTool === 'move' && !token.locked && (
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

          {/* Token labels & concise status text cleanly positioned underneath */}
          {interactiveLayers.map((token) => {
            if (mode !== 'gm' && token.hiddenFromPlayers) return null;
            if (token.layerKind === 'text' || token.layerKind === 'image') return null;
            const statuses = token.statuses || [];
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
                <div className="px-1.5 py-0.5 text-[11px] leading-none bg-black/75 text-stone-100 whitespace-nowrap">
                  {token.name}
                  {mode === 'gm' && token.hiddenFromPlayers ? ' (Oculto)' : ''}
                </div>
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

        {/* Right-Click Floating Token Customization Popover (GM Only) */}
        {mode === 'gm' && contextMenu && contextToken && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, width: '280px' }}
            className="absolute z-40"
          >
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
          </div>
        )}
      </div>

      {/* GM Selected Layer Floating Quick Action Bar */}
      {mode === 'gm' &&
        selectedToken &&
        !draggingTokenId &&
        !resizingState &&
        !contextMenu && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 vtt-surface border px-3 py-2 flex items-center gap-1.5 shadow-lg max-w-[96%]"
          >
            <span className="text-xs font-semibold truncate max-w-[120px]">
              {selectedToken.name}
            </span>
            <span className="text-xs vtt-muted" aria-hidden="true">
              ·
            </span>
            {selectedToken.layerKind !== 'text' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDuelCandidateId(selectedToken.id);
                    onNotify?.(
                      `"${selectedToken.name}" pronto para duelo! Clique agora no token do oponente.`
                    );
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-stone-950 flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="Selecionar um segundo token para abrir o Modo Duelo 3D (ou Shift+Clique em outro token)"
                >
                  <Swords className="w-3.5 h-3.5" />
                  Duelo 3D
                </button>
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
    </div>
  );
}
