import { useEffect, useRef, useState } from 'react';
import {
  DoorClosed,
  DoorOpen,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Maximize2,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  FogStroke,
  LiveSceneSnapshot,
  SceneToken,
  SceneWall,
} from '../types/vtt';
import { resolveMediaUrl, type CampaignUploadContext } from '../lib/mediaStore';
import { detectSceneMediaKind } from '../lib/mediaOptimizer';
import { computeVisibilityPolygon, distancePointToSegment } from '../lib/visionEngine';
import { TokenEditorPanel } from './TokenEditorPanel';

export type CanvasTool =
  | 'move'
  | 'ruler'
  | 'fog_reveal'
  | 'fog_hide'
  | 'wall'
  | 'door'
  | 'wall_erase';

interface TabletopCanvasProps {
  campaignId?: string;
  uploadContext?: CampaignUploadContext;
  scene: LiveSceneSnapshot | null;
  mode: 'gm' | 'screen' | 'player';
  activeTool?: CanvasTool;
  fogBrushRadius?: number; // normalized 0.03 .. 0.18
  onTokensChange?: (tokens: SceneToken[]) => void;
  onFogStrokesChange?: (strokes: FogStroke[]) => void;
  onWallsChange?: (walls: SceneWall[]) => void;
  onShowTokenPopup?: (handout: ActiveHandoutProjection) => void;
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

interface ContextMenuState {
  tokenId: string;
  x: number;
  y: number;
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
  const style = token.outlineStyle || 'solid';
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

export function TabletopCanvas({
  campaignId,
  uploadContext,
  scene,
  mode,
  activeTool = 'move',
  fogBrushRadius = 0.08,
  onTokensChange,
  onFogStrokesChange,
  onWallsChange,
  onShowTokenPopup,
  onNotify,
}: TabletopCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [bgUrl, setBgUrl] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 675 });

  // Local optimistic state for smooth dragging, fog painting & wall drawing
  const [localTokens, setLocalTokens] = useState<SceneToken[]>(scene?.tokens || []);
  const [localFog, setLocalFog] = useState<FogStroke[]>(scene?.fogStrokes || []);
  const [localWalls, setLocalWalls] = useState<SceneWall[]>(scene?.walls || []);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Hit-flash ticker so hit recoil auto-clears cleanly after ~600ms
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ephemeral Quick Ruler
  const [ruler, setRuler] = useState<RulerState | null>(null);
  // Wall / Door drawing preview
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);

  // Fog painting state
  const isPaintingFogRef = useRef(false);
  const lastFogPointRef = useRef<{ x: number; y: number } | null>(null);
  const fogDraftRef = useRef<FogStroke[]>([]);

  // Token image URL cache
  const [tokenImgUrls, setTokenImgUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!draggingTokenId) {
      setLocalTokens(scene?.tokens || []);
    }
  }, [scene?.tokens, draggingTokenId]);

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
    const tokens = scene?.tokens || [];
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
  }, [scene?.tokens, campaignId]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({ width, height });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Determine whether Fog / Dynamic Line-of-Sight Canvas should be rendered
  const visionTokens = localTokens.filter(
    (t) => t.visionEnabled && (mode === 'gm' || !t.hiddenFromPlayers)
  );
  const dynamicVisionActive = Boolean(scene?.dynamicVision) && visionTokens.length > 0;
  const shouldRenderFogLayer = Boolean(scene?.fogEnabled) || dynamicVisionActive;

  // Render Fog of War + Dynamic 2D Raycast Line-of-Sight Canvas
  useEffect(() => {
    const canvas = fogCanvasRef.current;
    if (!canvas || !shouldRenderFogLayer) return;

    const w = Math.max(1, Math.round(stageSize.width));
    const h = Math.max(1, Math.round(stageSize.height));
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
    stageSize,
    mode,
  ]);

  function getRelativeCoords(e: React.PointerEvent): {
    px: number;
    py: number;
    nx: number;
    ny: number;
  } {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { px: 0, py: 0, nx: 0, ny: 0 };
    }
    const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    return { px, py, nx: px / rect.width, ny: py / rect.height };
  }

  // Gently snap new wall endpoints to nearby existing wall corners for crisp room closures
  function snapPointToExistingWall(nx: number, ny: number): { nx: number; ny: number } {
    const threshold = 0.014;
    for (const w of localWalls) {
      if (Math.hypot(nx - w.x1, ny - w.y1) < threshold) return { nx: w.x1, ny: w.y1 };
      if (Math.hypot(nx - w.x2, ny - w.y2) < threshold) return { nx: w.x2, ny: w.y2 };
    }
    return { nx, ny };
  }

  function findWallNearPoint(px: number, py: number, maxDistPx = 11): SceneWall | null {
    const w = stageSize.width;
    const h = stageSize.height;
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

    const { px, py, nx, ny } = getRelativeCoords(e);

    // Quick Ruler
    if (mode === 'gm' && (activeTool === 'ruler' || e.shiftKey)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setRuler({ startX: px, startY: py, endX: px, endY: py });
      return;
    }

    // Wall Eraser tool
    if (mode === 'gm' && activeTool === 'wall_erase') {
      const hit = findWallNearPoint(px, py, 14);
      if (hit) {
        removeWall(hit.id);
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
  }

  function handleStagePointerMove(e: React.PointerEvent) {
    if (!scene) return;
    const { px, py, nx, ny } = getRelativeCoords(e);

    if (ruler) {
      setRuler((prev) => (prev ? { ...prev, endX: px, endY: py } : null));
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

    if (draggingTokenId && mode === 'gm') {
      setLocalTokens((prev) =>
        prev.map((t) =>
          t.id === draggingTokenId
            ? { ...t, x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) }
            : t
        )
      );
    }
  }

  function handleStagePointerUp() {
    if (ruler) {
      setRuler(null);
    }

    if (wallDraft) {
      const lenPx = Math.hypot(
        (wallDraft.x2 - wallDraft.x1) * stageSize.width,
        (wallDraft.y2 - wallDraft.y1) * stageSize.height
      );
      if (lenPx >= 12) {
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

    if (draggingTokenId) {
      setDraggingTokenId(null);
      onTokensChange?.(localTokens);
    }
  }

  function handleTokenPointerDown(e: React.PointerEvent, token: SceneToken) {
    if (mode !== 'gm') return;
    if (e.button !== 0) return;
    if (activeTool !== 'move' || e.shiftKey) return;
    e.stopPropagation();
    setContextMenu(null);
    stageRef.current?.setPointerCapture(e.pointerId);
    setSelectedTokenId(token.id);
    setDraggingTokenId(token.id);
  }

  function handleTokenContextMenu(e: React.MouseEvent, token: SceneToken) {
    if (mode !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    // Clamp floating popover cleanly inside stage bounds
    const popW = 284;
    const popH = 420;
    const x = Math.max(10, Math.min(rect.width - popW - 10, rawX + 10));
    const y = Math.max(10, Math.min(rect.height - popH - 10, rawY - 24));
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

  function handleDeleteToken(tokenId: string) {
    const next = localTokens.filter((t) => t.id !== tokenId);
    setLocalTokens(next);
    setSelectedTokenId(null);
    setContextMenu(null);
    onTokensChange?.(next);
  }

  const selectedToken = localTokens.find((t) => t.id === selectedTokenId) || null;
  const contextToken = contextMenu
    ? localTokens.find((t) => t.id === contextMenu.tokenId) || null
    : null;

  // Quick ruler calculation
  let rulerSquares = 0;
  let rulerUnits = 0;
  if (ruler && scene) {
    const distPx = Math.hypot(ruler.endX - ruler.startX, ruler.endY - ruler.startY);
    const cell = Math.max(16, scene.grid.cellSizePx || 56);
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
      : activeTool === 'ruler' || activeTool === 'wall' || activeTool === 'door'
        ? 'cursor-crosshair'
        : activeTool === 'fog_reveal' || activeTool === 'fog_hide' || activeTool === 'wall_erase'
          ? 'cursor-cell'
          : 'cursor-default';

  return (
    <div
      ref={stageRef}
      onPointerDown={handleStagePointerDown}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerUp}
      onPointerCancel={handleStagePointerUp}
      onContextMenu={(e) => {
        if (mode === 'gm' && (activeTool === 'wall' || activeTool === 'door' || activeTool === 'wall_erase')) {
          e.preventDefault();
          const rect = stageRef.current?.getBoundingClientRect();
          if (rect) {
            const hit = findWallNearPoint(e.clientX - rect.left, e.clientY - rect.top, 14);
            if (hit) removeWall(hit.id);
          }
        }
      }}
      className={`relative w-full h-full overflow-hidden select-none touch-none bg-stone-950 ${cursorClass}`}
    >
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
            onError={() => setMediaError(true)}
            className="w-full h-full object-contain pointer-events-none"
          />
        ) : (
          <img
            src={bgUrl}
            alt={scene.name}
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setMediaError(true)}
            className="w-full h-full object-contain pointer-events-none"
          />
        )
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-stone-400">
          <ImageIcon className="w-10 h-10 opacity-50" />
          <span className="text-sm font-typewriter">{scene.name}</span>
        </div>
      )}

      {/* Optional Calibrated Grid Layer */}
      {scene.grid.enabled && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,${scene.grid.opacity}) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,${scene.grid.opacity}) 1px, transparent 1px)
            `,
            backgroundSize: `${scene.grid.cellSizePx}px ${scene.grid.cellSizePx}px`,
            backgroundPosition: `${scene.grid.offsetX}px ${scene.grid.offsetY}px`,
          }}
        />
      )}

      {/* Draggable & Deeply Customizable Tokens Layer */}
      <div className="absolute inset-0 pointer-events-none z-10">
        {localTokens.map((token) => {
          if (mode !== 'gm' && token.hiddenFromPlayers) return null;
          const imgSrc = tokenImgUrls[token.id];
          const isSelected = mode === 'gm' && selectedTokenId === token.id;
          const isHit = Boolean(token.hitAtMs && nowMs - token.hitAtMs < 650);
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
              onContextMenu={(e) => handleTokenContextMenu(e, token)}
              style={{
                left: `${token.x * 100}%`,
                top: `${token.y * 100}%`,
                width: `${token.sizePx}px`,
                height: `${token.sizePx}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute ${behaviorClass} ${isHit ? 'token-hit-active' : ''} ${
                mode === 'gm' && activeTool === 'move'
                  ? 'pointer-events-auto cursor-grab active:cursor-grabbing'
                  : 'pointer-events-none'
              } ${token.hiddenFromPlayers ? 'opacity-55' : ''} ${
                isSelected ? 'z-20' : 'z-10'
              }`}
              title={mode === 'gm' ? `${token.name} (botão direito para customizar)` : token.name}
            >
              {/* Rotating Aura Ring Behavior */}
              {token.behavior === 'spin_ring' && (
                <div
                  className="absolute -inset-1.5 rounded-full border-2 border-dashed pointer-events-none token-spin-aura"
                  style={{ borderColor: outlineCol }}
                />
              )}

              {/* Token Disc */}
              <div
                style={{
                  ...getTokenBorderStyle(token, isSelected),
                  boxShadow: getTokenShadowStyle(token, isHit),
                }}
                className={`relative w-full h-full rounded-full flex items-center justify-center overflow-hidden ${
                  isSelected ? 'ring-2 ring-white/90' : ''
                }`}
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
                {texClass && <div className={`absolute inset-0 pointer-events-none ${texClass}`} />}

                {/* Live Hit Flash Overlay */}
                {isHit && (
                  <div className="absolute inset-0 bg-red-600/55 pointer-events-none" />
                )}
              </div>

              {/* Clean Compact Status Dots / Indicators (Buffs & Debuffs) */}
              {statuses.length > 0 && (
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
        {localTokens.map((token) => {
          if (mode !== 'gm' && token.hiddenFromPlayers) return null;
          const statuses = token.statuses || [];
          return (
            <div
              key={`${token.id}_label`}
              style={{
                left: `${token.x * 100}%`,
                top: `calc(${token.y * 100}% + ${token.sizePx / 2 + 6}px)`,
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
            const x1 = wall.x1 * stageSize.width;
            const y1 = wall.y1 * stageSize.height;
            const x2 = wall.x2 * stageSize.width;
            const y2 = wall.y2 * stageSize.height;
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
              x1={wallDraft.x1 * stageSize.width}
              y1={wallDraft.y1 * stageSize.height}
              x2={wallDraft.x2 * stageSize.width}
              y2={wallDraft.y2 * stageSize.height}
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
          <circle cx={ruler.startX} cy={ruler.startY} r="4" fill="#fdfbf7" stroke="#8f2d2d" strokeWidth="2" />
          <circle cx={ruler.endX} cy={ruler.endY} r="4" fill="#fdfbf7" stroke="#8f2d2d" strokeWidth="2" />
          <g transform={`translate(${(ruler.startX + ruler.endX) / 2}, ${(ruler.startY + ruler.endY) / 2 - 14})`}>
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
            onDelete={() => handleDeleteToken(contextToken.id)}
            onClose={() => setContextMenu(null)}
            onNotify={onNotify}
          />
        </div>
      )}

      {/* GM Selected Token Floating Quick Action Bar */}
      {mode === 'gm' && selectedToken && !draggingTokenId && !contextMenu && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 vtt-surface border px-3 py-2 flex items-center gap-1.5 shadow-lg max-w-[96%]"
        >
          <span className="text-xs font-semibold truncate max-w-[120px]">
            {selectedToken.name}
          </span>
          <span className="text-xs vtt-muted" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => triggerTokenHit(selectedToken.id)}
            className="px-2 py-1.5 text-xs font-semibold bg-red-700 hover:bg-red-800 text-white flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Efeito de dano / hit no token"
          >
            <Zap className="w-3.5 h-3.5" />
            Hit
          </button>
          <button
            type="button"
            onClick={() =>
              setContextMenu({
                tokenId: selectedToken.id,
                x: Math.max(12, Math.min(stageSize.width - 294, selectedToken.x * stageSize.width + 24)),
                y: Math.max(12, Math.min(stageSize.height - 420, selectedToken.y * stageSize.height - 80)),
              })
            }
            className="px-2.5 py-1.5 text-xs border vtt-border flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Customizar aparência, buffs, efeitos e visão (ou clique com botão direito)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Customizar
          </button>
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
          <button
            type="button"
            onClick={() => handleToggleTokenVisibility(selectedToken.id)}
            className="p-1.5 text-xs border vtt-border shrink-0"
            title={selectedToken.hiddenFromPlayers ? 'Revelar token' : 'Ocultar token'}
            aria-label={selectedToken.hiddenFromPlayers ? 'Revelar token' : 'Ocultar token'}
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
            title="Remover token"
            aria-label="Remover token"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
