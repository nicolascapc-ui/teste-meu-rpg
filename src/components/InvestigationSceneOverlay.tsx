import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  FilePlus2,
  Image as ImageIcon,
  Layers,
  Loader2,
  NotebookPen,
  Radio,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { resolveMediaUrl, uploadMediaFile } from '../lib/mediaStore';
import { createDefaultHotspot, DIFFICULTY_META } from '../lib/investigationEngine';
import type {
  InvestigationDifficulty,
  InvestigationHotspot,
  InvestigationJournalEntry,
  InvestigationSceneData,
} from '../types/vtt';

interface InvestigationSceneOverlayProps {
  campaignId: string;
  gmUid?: string;
  currentUserUid?: string;
  currentUserName?: string;
  mode: 'gm' | 'player' | 'screen';
  investigation: InvestigationSceneData;
  journalEntries: InvestigationJournalEntry[];
  onChangeInvestigation?: (updated: InvestigationSceneData) => void;
  onToggleLiveToPlayers?: (nextLive: boolean) => void;
  onCloseOverlay?: () => void;
  onNoteClue?: (hotspot: InvestigationHotspot) => Promise<void> | void;
  onRemoveJournalEntry?: (entryId: string) => Promise<void> | void;
  onNotify?: (message: string) => void;
}

/**
 * Isolated Point & Click Investigation Scene overlay.
 * - GM mode: upload background, click anywhere to place hotspots, drag to adjust,
 *   configure Title, Description, optional zoom image, Difficulty (1..3), and Player visibility,
 *   preview as Player with the dynamic flashlight, and toggle live projection to players/TV.
 * - Player / Screen mode: fullscreen background with smooth 60fps cursor flashlight vignette,
 *   subtle atmospheric indicators only on GM-visible hotspots, clean clue zoom modal,
 *   and a collapsible session Investigation Journal ("Diário da Investigação").
 */
export const InvestigationSceneOverlay: React.FC<InvestigationSceneOverlayProps> = ({
  campaignId,
  gmUid,
  currentUserUid,
  currentUserName,
  mode,
  investigation,
  journalEntries,
  onChangeInvestigation,
  onToggleLiveToPlayers,
  onCloseOverlay,
  onNoteClue,
  onRemoveJournalEntry,
  onNotify,
}) => {
  const isGm = mode === 'gm';
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);
  const isInteractivePlayerView = !isGm || previewAsPlayer;

  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(
    investigation.hotspots[0]?.id || null
  );
  const [inspectedHotspot, setInspectedHotspot] = useState<InvestigationHotspot | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalScope, setJournalScope] = useState<'scene' | 'all'>('all');
  const [expandedJournalId, setExpandedJournalId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [atmosphereOpen, setAtmosphereOpen] = useState(false);
  const [bgUrlInputOpen, setBgUrlInputOpen] = useState(false);
  const [bgUrlDraft, setBgUrlDraft] = useState('');

  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingZoom, setUploadingZoom] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  // Resolved background & zoom media URLs
  const [resolvedBgUrl, setResolvedBgUrl] = useState<string>(investigation.bgImageUrl || '');
  const [resolvedZoomUrl, setResolvedZoomUrl] = useState<string>('');
  const [resolvedJournalThumbMap, setResolvedJournalThumbMap] = useState<Record<string, string>>(
    {}
  );

  // Intrinsic image dimensions so normalized (0..1) hotspots align 1:1 across every screen ratio
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Smooth 60fps cursor flashlight tracking via refs + CSS custom properties (no re-renders per mouse move)
  const spotlightLayerRef = useRef<HTMLDivElement | null>(null);
  const pointerTargetRef = useRef<{ x: number; y: number; nx: number; ny: number; active: boolean }>({
    x: 0,
    y: 0,
    nx: 0.5,
    ny: 0.5,
    active: false,
  });
  const pointerCurrentRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorNorm, setCursorNorm] = useState<{ x: number; y: number; active: boolean }>({
    x: 0.5,
    y: 0.5,
    active: false,
  });
  const lastNormUpdateRef = useRef(0);

  // GM hotspot drag tracking
  const draggingHotspotRef = useRef<{
    id: string;
    moved: boolean;
    startClientX: number;
    startClientY: number;
  } | null>(null);

  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const zoomFileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve background mediaId -> URL
  useEffect(() => {
    let active = true;
    resolveMediaUrl(investigation.bgMediaId, investigation.bgImageUrl, campaignId).then((url) => {
      if (active) setResolvedBgUrl(url || '');
    });
    return () => {
      active = false;
    };
  }, [campaignId, investigation.bgMediaId, investigation.bgImageUrl]);

  // Selected hotspot in GM editor
  const selectedHotspot = useMemo(
    () => investigation.hotspots.find((h) => h.id === selectedHotspotId) || null,
    [investigation.hotspots, selectedHotspotId]
  );

  // Keep selectedHotspotId synced if hotspots list changes
  useEffect(() => {
    if (selectedHotspotId && !investigation.hotspots.some((h) => h.id === selectedHotspotId)) {
      setSelectedHotspotId(investigation.hotspots[0]?.id || null);
    }
  }, [investigation.hotspots, selectedHotspotId]);

  // Resolve secondary zoom image for either inspected modal (player) or selected hotspot (GM)
  const activeZoomSource = isInteractivePlayerView ? inspectedHotspot : selectedHotspot;
  useEffect(() => {
    let active = true;
    if (!activeZoomSource?.zoomMediaId && !activeZoomSource?.zoomImageUrl) {
      setResolvedZoomUrl('');
      return;
    }
    resolveMediaUrl(activeZoomSource.zoomMediaId, activeZoomSource.zoomImageUrl, campaignId).then(
      (url) => {
        if (active) setResolvedZoomUrl(url || '');
      }
    );
    return () => {
      active = false;
    };
  }, [campaignId, activeZoomSource?.zoomMediaId, activeZoomSource?.zoomImageUrl]);

  // Resolve thumbnails for journal entries when journal drawer is open
  useEffect(() => {
    if (!journalOpen) return;
    let active = true;
    const entriesWithMedia = journalEntries.filter((e) => e.zoomMediaId || e.zoomImageUrl);
    Promise.all(
      entriesWithMedia.map(async (entry) => {
        const url = await resolveMediaUrl(entry.zoomMediaId, entry.zoomImageUrl, campaignId);
        return [entry.id, url] as const;
      })
    ).then((pairs) => {
      if (!active) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) {
        if (url) map[id] = url;
      }
      setResolvedJournalThumbMap(map);
    });
    return () => {
      active = false;
    };
  }, [campaignId, journalOpen, journalEntries]);

  // Fit coordinate frame cleanly to viewport preserving exact image aspect ratio
  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const recompute = () => {
      const rect = el.getBoundingClientRect();
      const pad = isGm && !previewAsPlayer ? 24 : 0;
      const availW = Math.max(200, rect.width - pad);
      const availH = Math.max(160, rect.height - pad);
      const imgRatio = naturalSize.w / Math.max(1, naturalSize.h);
      const viewRatio = availW / availH;

      let width = availW;
      let height = availH;
      if (isInteractivePlayerView) {
        // Contain cleanly at maximum fullness so every hotspot stays clickable & never cropped out
        if (viewRatio > imgRatio) {
          height = availH;
          width = height * imgRatio;
        } else {
          width = availW;
          height = width / imgRatio;
        }
      } else {
        if (viewRatio > imgRatio) {
          height = availH;
          width = height * imgRatio;
        } else {
          width = availW;
          height = width / imgRatio;
        }
      }
      setStageBox({ width: Math.round(width), height: Math.round(height) });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [naturalSize, isGm, previewAsPlayer, isInteractivePlayerView, inspectorOpen, journalOpen]);

  // Smooth flashlight animation loop when in Player / TV / Preview mode
  useEffect(() => {
    if (!isInteractivePlayerView) return;
    let rafId = 0;
    const step = () => {
      const target = pointerTargetRef.current;
      const cur = pointerCurrentRef.current;
      const frame = imageFrameRef.current;
      if (frame) {
        if (!target.active && cur.x === 0 && cur.y === 0) {
          const rect = frame.getBoundingClientRect();
          cur.x = rect.width * 0.5;
          cur.y = rect.height * 0.5;
          target.x = cur.x;
          target.y = cur.y;
        }
        cur.x += (target.x - cur.x) * 0.22;
        cur.y += (target.y - cur.y) * 0.22;
        if (spotlightLayerRef.current) {
          spotlightLayerRef.current.style.setProperty('--spot-x', `${cur.x.toFixed(1)}px`);
          spotlightLayerRef.current.style.setProperty('--spot-y', `${cur.y.toFixed(1)}px`);
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isInteractivePlayerView]);

  // Keyboard Escape handler for modal or overlay
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inspectedHotspot) {
          setInspectedHotspot(null);
        } else if (journalOpen) {
          setJournalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectedHotspot, journalOpen]);

  const visibleHotspots = useMemo(
    () => (investigation.hotspots || []).filter((h) => h.visibleToPlayers),
    [investigation.hotspots]
  );

  const notedHotspotKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of journalEntries) {
      set.add(`${entry.investigationId}::${entry.hotspotId}`);
    }
    return set;
  }, [journalEntries]);

  const filteredJournal = useMemo(() => {
    if (journalScope === 'scene') {
      return journalEntries.filter((e) => e.investigationId === investigation.id);
    }
    return journalEntries;
  }, [journalEntries, journalScope, investigation.id]);

  const updateInvestigation = (patch: Partial<InvestigationSceneData>) => {
    if (!onChangeInvestigation) return;
    onChangeInvestigation({
      ...investigation,
      ...patch,
      updatedAtMs: Date.now(),
    });
  };

  const updateHotspot = (hotspotId: string, patch: Partial<InvestigationHotspot>) => {
    if (!onChangeInvestigation) return;
    const nextHotspots = investigation.hotspots.map((h) =>
      h.id === hotspotId ? { ...h, ...patch } : h
    );
    updateInvestigation({ hotspots: nextHotspots });
  };

  const deleteHotspot = (hotspotId: string) => {
    if (!onChangeInvestigation) return;
    const nextHotspots = investigation.hotspots.filter((h) => h.id !== hotspotId);
    updateInvestigation({ hotspots: nextHotspots });
    if (selectedHotspotId === hotspotId) {
      setSelectedHotspotId(nextHotspots[0]?.id || null);
    }
  };

  const handleUploadBg = async (file: File) => {
    if (!gmUid) return;
    setUploadingBg(true);
    try {
      const res = await uploadMediaFile(file, {
        campaignId,
        gmUid,
        uploaderUid: currentUserUid || gmUid,
        optimizeFor: 'scene',
      });
      updateInvestigation({
        bgMediaId: res.mediaId,
        bgImageUrl: res.url || '',
      });
      onNotify?.('Imagem de fundo da investigação carregada.');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar imagem de fundo.');
    } finally {
      setUploadingBg(false);
    }
  };

  const handleUploadZoomImage = async (file: File) => {
    if (!gmUid || !selectedHotspot) return;
    setUploadingZoom(true);
    try {
      const res = await uploadMediaFile(file, {
        campaignId,
        gmUid,
        uploaderUid: currentUserUid || gmUid,
        optimizeFor: 'handout',
      });
      updateHotspot(selectedHotspot.id, {
        zoomMediaId: res.mediaId,
        zoomImageUrl: res.url || '',
      });
      onNotify?.('Imagem secundária de zoom anexada à pista.');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar imagem de zoom.');
    } finally {
      setUploadingZoom(false);
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const frame = imageFrameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const nx = rect.width > 0 ? x / rect.width : 0.5;
    const ny = rect.height > 0 ? y / rect.height : 0.5;

    // GM dragging an existing hotspot
    if (isGm && !previewAsPlayer && draggingHotspotRef.current) {
      const drag = draggingHotspotRef.current;
      const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (dist > 4) {
        drag.moved = true;
        updateHotspot(drag.id, {
          x: Math.max(0.02, Math.min(0.98, nx)),
          y: Math.max(0.02, Math.min(0.98, ny)),
        });
      }
      return;
    }

    if (isInteractivePlayerView) {
      pointerTargetRef.current = { x, y, nx, ny, active: true };
      const now = performance.now();
      if (now - lastNormUpdateRef.current > 45) {
        lastNormUpdateRef.current = now;
        setCursorNorm({ x: nx, y: ny, active: true });
      }
    }
  };

  const handleStagePointerLeave = () => {
    if (isInteractivePlayerView) {
      pointerTargetRef.current.active = false;
      setCursorNorm((prev) => ({ ...prev, active: false }));
    }
  };

  const handleStagePointerUp = () => {
    if (draggingHotspotRef.current) {
      draggingHotspotRef.current = null;
    }
  };

  const handleStageClickForNewHotspot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isGm || previewAsPlayer || !resolvedBgUrl) return;
    // Ignore if click originated on an existing hotspot marker
    if ((e.target as HTMLElement).closest('[data-hotspot-pin="true"]')) return;
    const frame = imageFrameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const created = createDefaultHotspot(nx, ny, investigation.hotspots.length + 1);
    updateInvestigation({
      hotspots: [...investigation.hotspots, created],
    });
    setSelectedHotspotId(created.id);
    setInspectorOpen(true);
  };

  const handleNoteCurrentClue = async (hotspot: InvestigationHotspot) => {
    if (!onNoteClue) return;
    setSavingNoteId(hotspot.id);
    try {
      await onNoteClue(hotspot);
    } finally {
      setSavingNoteId(null);
    }
  };

  const flashlightRadius = investigation.flashlightRadiusPx ?? 220;
  const ambientDarkness = investigation.ambientDarkness ?? 0.88;

  const isInspectedAlreadyNoted = inspectedHotspot
    ? notedHotspotKeys.has(`${investigation.id}::${inspectedHotspot.id}`)
    : false;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-[#06070a] text-[#f3efe6] select-none overflow-hidden"
      onPointerUp={handleStagePointerUp}
    >
      {/* Hidden file inputs for GM */}
      {isGm && (
        <>
          <input
            ref={bgFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadBg(f);
              e.target.value = '';
            }}
          />
          <input
            ref={zoomFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadZoomImage(f);
              e.target.value = '';
            }}
          />
        </>
      )}

      {/* Top atmospheric control bar */}
      <header className="shrink-0 z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[#0a0c10]/92 border-b border-white/10 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          {isGm && onCloseOverlay && (
            <button
              type="button"
              onClick={onCloseOverlay}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/6 hover:bg-white/12 border border-white/12 text-white/90 transition-colors cursor-pointer"
              title="Voltar ao mapa tático desta cena"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar ao Mapa</span>
            </button>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-amber-400 shrink-0" />
            {isGm && !previewAsPlayer ? (
              <input
                type="text"
                value={investigation.title}
                onChange={(e) => updateInvestigation({ title: e.target.value })}
                placeholder="Título da Cena de Investigação..."
                className="bg-transparent border-b border-transparent hover:border-white/20 focus:border-amber-400/70 focus:outline-none text-sm font-typewriter font-semibold text-[#f5f1e8] px-1 py-0.5 min-w-[150px] max-w-[260px] truncate"
              />
            ) : (
              <h2 className="text-sm sm:text-base font-typewriter font-semibold text-[#f5f1e8] truncate">
                {investigation.title || 'Cena de Investigação'}
              </h2>
            )}
          </div>

          <span className="hidden md:inline text-[11px] text-white/45 tracking-wide">
            {isGm
              ? `${investigation.hotspots.length} ${
                  investigation.hotspots.length === 1 ? 'hotspot' : 'hotspots'
                } · ${visibleHotspots.length} visíveis`
              : 'Mova a luz para explorar · Clique nos brilhos para examinar'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {isGm && (
            <>
              <button
                type="button"
                onClick={() => bgFileInputRef.current?.click()}
                disabled={uploadingBg}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/6 hover:bg-white/12 border border-white/12 text-white/90 transition-colors cursor-pointer disabled:opacity-50"
                title="Enviar ou trocar a imagem de fundo da cena de investigação"
              >
                {uploadingBg ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {resolvedBgUrl ? 'Trocar Fundo' : 'Enviar Fundo'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPreviewAsPlayer((v) => !v);
                  setInspectedHotspot(null);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                  previewAsPlayer
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                    : 'bg-white/6 hover:bg-white/12 border-white/12 text-white/85'
                }`}
                title="Alternar entre Editor do Mestre e Prévia da Visão do Jogador"
              >
                {previewAsPlayer ? (
                  <>
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>Voltar ao Editor</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Prévia Jogador</span>
                  </>
                )}
              </button>

              {onToggleLiveToPlayers && (
                <button
                  type="button"
                  onClick={() => onToggleLiveToPlayers(!investigation.isLiveToPlayers)}
                  disabled={!resolvedBgUrl && !investigation.isLiveToPlayers}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-40 ${
                    investigation.isLiveToPlayers
                      ? 'bg-emerald-500/22 border-emerald-400/55 text-emerald-200 hover:bg-emerald-500/30'
                      : 'bg-amber-500/15 border-amber-400/40 text-amber-200 hover:bg-amber-500/25'
                  }`}
                  title={
                    investigation.isLiveToPlayers
                      ? 'Em exibição na tela dos jogadores e TV. Clique para encerrar a projeção.'
                      : 'Projetar esta cena de investigação na tela dos jogadores e TV'
                  }
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>
                    {investigation.isLiveToPlayers ? 'No Ar (Jogadores)' : 'Exibir aos Jogadores'}
                  </span>
                </button>
              )}

              {!previewAsPlayer && (
                <button
                  type="button"
                  onClick={() => {
                    setInspectorOpen((v) => !v);
                    if (!inspectorOpen) setJournalOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    inspectorOpen
                      ? 'bg-white/14 border-white/25 text-white'
                      : 'bg-white/6 hover:bg-white/12 border-white/12 text-white/80'
                  }`}
                  title="Mostrar ou recolher o editor de Hotspots"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Hotspots</span>
                </button>
              )}
            </>
          )}

          {/* Investigation Journal toggle button (visible to both GM and Players) */}
          <button
            type="button"
            onClick={() => {
              setJournalOpen((v) => !v);
              if (!journalOpen && isGm && !previewAsPlayer) setInspectorOpen(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
              journalOpen
                ? 'bg-amber-500/22 border-amber-400/50 text-amber-100'
                : 'bg-white/6 hover:bg-white/12 border-white/12 text-white/90'
            }`}
            title="Abrir Diário da Investigação da sessão"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-300" />
            <span>Diário</span>
            <span className="text-[11px] font-mono text-amber-200/90">
              ({journalEntries.length})
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Stage + Optional Side Drawer */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {/* Interactive Investigation Viewport */}
        <div
          ref={stageViewportRef}
          className="relative flex-1 min-w-0 min-h-0 flex items-center justify-center bg-[#040508] overflow-hidden"
        >
          {!resolvedBgUrl ? (
            /* Empty State */
            <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-[#0e1117] border border-white/10 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-lg bg-amber-500/12 border border-amber-400/25 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-amber-300" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-typewriter font-semibold text-white">
                  {isGm ? 'Envie a Imagem da Investigação' : 'Aguardando o Mestre preparar a cena'}
                </h3>
                <p className="text-xs text-white/60 leading-relaxed">
                  {isGm
                    ? 'Suba uma ilustração de sala, mesa, corredor ou documento. Depois, clique em qualquer ponto da imagem para posicionar pistas secretas.'
                    : 'A cena de investigação será revelada assim que o Mestre carregar o cenário.'}
                </p>
              </div>
              {isGm && (
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => bgFileInputRef.current?.click()}
                    disabled={uploadingBg}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {uploadingBg ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>Fazer Upload da Imagem de Fundo</span>
                  </button>

                  {!bgUrlInputOpen ? (
                    <button
                      type="button"
                      onClick={() => setBgUrlInputOpen(true)}
                      className="text-[11px] text-white/55 hover:text-white/85 underline underline-offset-4 cursor-pointer"
                    >
                      Ou colar link direto (URL) de imagem
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="url"
                        value={bgUrlDraft}
                        onChange={(e) => setBgUrlDraft(e.target.value)}
                        placeholder="https://..."
                        className="flex-1 bg-black/50 border border-white/15 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400/60"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = bgUrlDraft.trim();
                          if (!trimmed) return;
                          updateInvestigation({ bgImageUrl: trimmed, bgMediaId: '' });
                          setBgUrlDraft('');
                          setBgUrlInputOpen(false);
                        }}
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/12 hover:bg-white/20 text-white cursor-pointer"
                      >
                        Usar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Exact-Aspect Locked Stage Frame */
            <div
              ref={imageFrameRef}
              onClick={handleStageClickForNewHotspot}
              onPointerMove={handleStagePointerMove}
              onPointerLeave={handleStagePointerLeave}
              style={{
                width: stageBox.width > 0 ? `${stageBox.width}px` : '100%',
                height: stageBox.height > 0 ? `${stageBox.height}px` : '100%',
              }}
              className={`relative overflow-hidden shadow-2xl ${
                isGm && !previewAsPlayer
                  ? 'cursor-crosshair rounded-md ring-1 ring-white/12'
                  : 'cursor-none sm:cursor-crosshair'
              }`}
            >
              {/* Background Image */}
              <img
                src={resolvedBgUrl}
                alt={investigation.title || 'Cena de Investigação'}
                referrerPolicy="no-referrer"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
                className="w-full h-full object-cover pointer-events-none select-none"
              />

              {/* PLAYER / TV / PREVIEW MODE: Dynamic Soft Flashlight Vignette */}
              {isInteractivePlayerView && (
                <div
                  ref={spotlightLayerRef}
                  className="absolute inset-0 pointer-events-none z-10"
                  style={
                    {
                      '--spot-x': '50%',
                      '--spot-y': '50%',
                      background: `radial-gradient(circle ${flashlightRadius}px at var(--spot-x) var(--spot-y), rgba(255, 243, 214, 0.04) 0%, rgba(12, 13, 18, 0.14) 38%, rgba(5, 6, 10, ${Math.min(
                        0.96,
                        ambientDarkness * 0.72
                      ).toFixed(2)}) 72%, rgba(3, 4, 7, ${ambientDarkness.toFixed(2)}) 100%)`,
                    } as React.CSSProperties
                  }
                />
              )}

              {/* GM EDITOR MODE: Subtle instruction ribbon at bottom-left */}
              {isGm && !previewAsPlayer && (
                <div className="absolute bottom-3 left-3 z-20 pointer-events-none px-2.5 py-1 rounded bg-black/72 border border-white/12 text-[11px] text-white/80 backdrop-blur-sm">
                  Clique em qualquer ponto da imagem para criar um Hotspot · Arraste para reposicionar
                </div>
              )}

              {/* GM EDITOR MODE: All Hotspots (Visible + Hidden) */}
              {isGm && !previewAsPlayer &&
                investigation.hotspots.map((hotspot, idx) => {
                  const isSelected = hotspot.id === selectedHotspotId;
                  const diffMeta = DIFFICULTY_META[hotspot.difficulty || 1];
                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      data-hotspot-pin="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedHotspotId(hotspot.id);
                        setInspectorOpen(true);
                        draggingHotspotRef.current = {
                          id: hotspot.id,
                          moved: false,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                        };
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHotspotId(hotspot.id);
                        setInspectorOpen(true);
                      }}
                      style={{
                        left: `${hotspot.x * 100}%`,
                        top: `${hotspot.y * 100}%`,
                      }}
                      className={`group absolute z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full transition-transform cursor-grab active:cursor-grabbing ${
                        isSelected ? 'scale-120 z-30' : 'hover:scale-110'
                      }`}
                      title={`${hotspot.title || `Pista #${idx + 1}`} (${
                        hotspot.visibleToPlayers ? 'Visível aos jogadores' : 'Oculto (Só Mestre)'
                      })`}
                    >
                      <span
                        className={`flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-mono font-bold shadow-lg border-2 ${
                          hotspot.visibleToPlayers
                            ? 'bg-amber-500 text-black border-amber-100'
                            : 'bg-[#12151d]/92 text-white/80 border-dashed border-white/45'
                        } ${isSelected ? 'ring-3 ring-amber-400/50' : ''}`}
                      >
                        {idx + 1}
                      </span>
                      {/* Compact floating label on select or hover */}
                      <span
                        className={`pointer-events-none absolute top-full mt-1.5 whitespace-nowrap px-2 py-0.5 rounded bg-black/88 border border-white/15 text-[11px] text-white/95 shadow-lg transition-opacity ${
                          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {hotspot.title || `Pista #${idx + 1}`}
                        <span className="ml-1.5 text-[10px]" style={{ color: diffMeta.color }}>
                          · N{hotspot.difficulty}
                        </span>
                        {!hotspot.visibleToPlayers && (
                          <span className="ml-1 text-[10px] text-white/50">· Oculto</span>
                        )}
                      </span>
                    </button>
                  );
                })}

              {/* PLAYER / TV / PREVIEW MODE: Subtle Atmospheric Hotspots (ONLY visibleToPlayers) */}
              {isInteractivePlayerView &&
                visibleHotspots.map((hotspot) => {
                  const dx = cursorNorm.x - hotspot.x;
                  const dy = cursorNorm.y - hotspot.y;
                  const dist = Math.hypot(dx, dy);
                  const nearLight = cursorNorm.active && dist < 0.22;
                  const veryNear = cursorNorm.active && dist < 0.095;
                  const alreadyNoted = notedHotspotKeys.has(
                    `${investigation.id}::${hotspot.id}`
                  );

                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectedHotspot(hotspot);
                      }}
                      aria-label={`Examinar pista: ${hotspot.title || 'Detalhe misterioso'}`}
                      style={{
                        left: `${hotspot.x * 100}%`,
                        top: `${hotspot.y * 100}%`,
                      }}
                      className="group absolute z-20 -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
                    >
                      {/* Soft ambient halo that blooms softly when the lantern nears */}
                      <span
                        className="pointer-events-none absolute inset-1 rounded-full transition-all duration-300"
                        style={{
                          opacity: veryNear ? 0.95 : nearLight ? 0.58 : 0.2,
                          transform: veryNear ? 'scale(1.18)' : nearLight ? 'scale(1)' : 'scale(0.8)',
                          background: alreadyNoted
                            ? 'radial-gradient(circle, rgba(110, 231, 183, 0.36) 0%, rgba(110, 231, 183, 0.08) 55%, transparent 75%)'
                            : 'radial-gradient(circle, rgba(253, 224, 155, 0.44) 0%, rgba(245, 185, 84, 0.12) 52%, transparent 75%)',
                        }}
                      />

                      {/* Delicate shimmering core */}
                      <span
                        className="inv-glint-breathe pointer-events-none relative w-2.5 h-2.5 rounded-full transition-all duration-300"
                        style={{
                          background: alreadyNoted ? '#a7f3d0' : '#fef3c7',
                          boxShadow: alreadyNoted
                            ? '0 0 10px 2px rgba(52, 211, 153, 0.65)'
                            : '0 0 12px 3px rgba(251, 191, 36, 0.72)',
                          opacity: veryNear ? 1 : nearLight ? 0.82 : 0.44,
                        }}
                      />

                      {/* Two subtle drifting dust motes */}
                      <span
                        className="inv-mote-a pointer-events-none absolute w-1 h-1 rounded-full"
                        style={{
                          background: alreadyNoted ? '#6ee7b7' : '#fde68a',
                          top: '28%',
                          left: '58%',
                        }}
                      />
                      <span
                        className="inv-mote-b pointer-events-none absolute w-1 h-1 rounded-full"
                        style={{
                          background: alreadyNoted ? '#a7f3d0' : '#fef3c7',
                          top: '62%',
                          left: '34%',
                        }}
                      />

                      {/* Subtle reticle ring on direct proximity or hover */}
                      <span
                        className={`pointer-events-none absolute inset-2.5 rounded-full border transition-all duration-300 ${
                          alreadyNoted ? 'border-emerald-300/65' : 'border-amber-200/70'
                        } ${
                          veryNear
                            ? 'opacity-85 scale-100'
                            : 'opacity-0 scale-75 group-hover:opacity-90 group-hover:scale-100'
                        }`}
                      />
                    </button>
                  );
                })}
            </div>
          )}

          {/* Subtle player bottom-left counter if in Player/TV mode */}
          {isInteractivePlayerView && resolvedBgUrl && visibleHotspots.length > 0 && (
            <div className="absolute bottom-3 left-3 z-20 pointer-events-none px-2.5 py-1 rounded bg-black/68 border border-white/10 text-[11px] text-white/65 backdrop-blur-sm">
              {visibleHotspots.filter((h) => notedHotspotKeys.has(`${investigation.id}::${h.id}`))
                .length}{' '}
              / {visibleHotspots.length} pistas anotadas nesta cena
            </div>
          )}
        </div>

        {/* GM RIGHT DRAWER: Hotspot Editor */}
        {isGm && !previewAsPlayer && inspectorOpen && (
          <aside className="inv-panel-slide w-[310px] sm:w-[340px] shrink-0 h-full bg-[#0d1016] border-l border-white/10 flex flex-col overflow-hidden z-20">
            <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/85">
                  Hotspots da Cena
                </h3>
                <p className="text-[11px] text-white/45">
                  {investigation.hotspots.length} marcados · {visibleHotspots.length} visíveis
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
                title="Recolher editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              {/* Hotspot list */}
              {investigation.hotspots.length === 0 ? (
                <div className="p-4 rounded-lg bg-white/4 border border-dashed border-white/12 text-center space-y-1">
                  <p className="text-xs font-medium text-white/80">Nenhum hotspot ainda</p>
                  <p className="text-[11px] text-white/50">
                    {resolvedBgUrl
                      ? 'Clique em qualquer lugar da imagem ao lado para criar o primeiro marcador.'
                      : 'Primeiro envie uma imagem de fundo para posicionar pistas.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {investigation.hotspots.map((hs, idx) => {
                    const active = hs.id === selectedHotspotId;
                    const diffMeta = DIFFICULTY_META[hs.difficulty || 1];
                    return (
                      <div
                        key={hs.id}
                        onClick={() => setSelectedHotspotId(hs.id)}
                        className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                          active
                            ? 'bg-amber-500/14 border-amber-400/45 text-white'
                            : 'bg-white/3 hover:bg-white/7 border-white/8 text-white/80'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-mono font-bold ${
                              hs.visibleToPlayers
                                ? 'bg-amber-500 text-black'
                                : 'bg-white/12 text-white/70'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">
                              {hs.title || `Pista #${idx + 1}`}
                            </p>
                            <p className="text-[10px] text-white/45 truncate">
                              <span style={{ color: diffMeta.color }}>{diffMeta.shortLabel}</span>
                              {' · '}
                              {hs.visibleToPlayers ? 'Visível' : 'Oculto'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateHotspot(hs.id, { visibleToPlayers: !hs.visibleToPlayers });
                            }}
                            className={`p-1.5 rounded transition-colors cursor-pointer ${
                              hs.visibleToPlayers
                                ? 'text-amber-300 hover:bg-amber-500/15'
                                : 'text-white/40 hover:bg-white/10 hover:text-white/80'
                            }`}
                            title={
                              hs.visibleToPlayers
                                ? 'Visível aos jogadores (clique para ocultar)'
                                : 'Oculto dos jogadores (clique para revelar)'
                            }
                          >
                            {hs.visibleToPlayers ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHotspot(hs.id);
                            }}
                            className="p-1.5 rounded text-white/40 hover:text-rose-400 hover:bg-rose-500/12 transition-colors cursor-pointer"
                            title="Remover hotspot"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Selected Hotspot Form */}
              {selectedHotspot && (
                <div className="pt-3 border-t border-white/10 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/90">
                      Editar Hotspot Selecionado
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateHotspot(selectedHotspot.id, {
                          visibleToPlayers: !selectedHotspot.visibleToPlayers,
                        })
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                        selectedHotspot.visibleToPlayers
                          ? 'bg-emerald-500/18 border-emerald-400/45 text-emerald-200'
                          : 'bg-white/6 border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      {selectedHotspot.visibleToPlayers ? (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Visível aos Jogadores</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Oculto (Só Mestre)</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Title */}
                  <div className="space-y-1">
                    <label className="block text-[11px] text-white/60">Título da Pista</label>
                    <input
                      type="text"
                      value={selectedHotspot.title}
                      onChange={(e) =>
                        updateHotspot(selectedHotspot.id, { title: e.target.value })
                      }
                      placeholder="Ex: Carta Rasgada na Gaveta"
                      className="w-full bg-black/45 border border-white/12 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400/60"
                    />
                  </div>

                  {/* Difficulty 1..3 */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-white/60">
                      Nível de Dificuldade (1 a 3)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([1, 2, 3] as InvestigationDifficulty[]).map((level) => {
                        const active = selectedHotspot.difficulty === level;
                        const meta = DIFFICULTY_META[level];
                        return (
                          <button
                            key={level}
                            type="button"
                            onClick={() => updateHotspot(selectedHotspot.id, { difficulty: level })}
                            className={`px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                              active
                                ? 'bg-white/12 text-white border-amber-400/60'
                                : 'bg-black/35 text-white/60 border-white/10 hover:border-white/25 hover:text-white/90'
                            }`}
                          >
                            <span className="font-mono font-bold mr-1" style={{ color: meta.color }}>
                              {level}
                            </span>
                            <span>
                              {level === 1 ? 'Fácil' : level === 2 ? 'Média' : 'Difícil'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Detailed Description */}
                  <div className="space-y-1">
                    <label className="block text-[11px] text-white/60">Descrição Detalhada</label>
                    <textarea
                      rows={4}
                      value={selectedHotspot.description}
                      onChange={(e) =>
                        updateHotspot(selectedHotspot.id, { description: e.target.value })
                      }
                      placeholder="Descreva o que os jogadores descobrem ao examinar este ponto de perto..."
                      className="w-full bg-black/45 border border-white/12 rounded-md px-2.5 py-2 text-xs text-white/95 leading-relaxed resize-y focus:outline-none focus:border-amber-400/60"
                    />
                  </div>

                  {/* Optional Secondary Zoom Image */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-white/60">
                        Imagem Secundária (Zoom opcional)
                      </label>
                      {(selectedHotspot.zoomMediaId || selectedHotspot.zoomImageUrl) && (
                        <button
                          type="button"
                          onClick={() =>
                            updateHotspot(selectedHotspot.id, {
                              zoomImageUrl: '',
                              zoomMediaId: '',
                            })
                          }
                          className="text-[11px] text-rose-300/80 hover:text-rose-300 cursor-pointer"
                        >
                          Remover
                        </button>
                      )}
                    </div>

                    {resolvedZoomUrl && (
                      <div className="relative rounded-lg overflow-hidden border border-white/12 bg-black/60 aspect-video flex items-center justify-center">
                        <img
                          src={resolvedZoomUrl}
                          alt="Prévia de zoom"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => zoomFileInputRef.current?.click()}
                        disabled={uploadingZoom}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/8 hover:bg-white/14 border border-white/12 text-white/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {uploadingZoom ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>{resolvedZoomUrl ? 'Trocar Imagem' : 'Enviar Zoom'}</span>
                      </button>
                    </div>
                    <input
                      type="url"
                      value={selectedHotspot.zoomImageUrl || ''}
                      onChange={(e) =>
                        updateHotspot(selectedHotspot.id, {
                          zoomImageUrl: e.target.value,
                          zoomMediaId: e.target.value ? '' : selectedHotspot.zoomMediaId,
                        })
                      }
                      placeholder="Ou cole uma URL da imagem de zoom..."
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[11px] text-white/85 focus:outline-none focus:border-amber-400/60"
                    />
                  </div>
                </div>
              )}

              {/* Collapsible Flashlight Atmosphere Settings */}
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setAtmosphereOpen((v) => !v)}
                  className="w-full flex items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-white/65 hover:text-white cursor-pointer"
                >
                  <span>Atmosfera da Lanterna</span>
                  {atmosphereOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                {atmosphereOpen && (
                  <div className="mt-2.5 space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-white/60">
                        <span>Raio do Foco de Luz</span>
                        <span className="font-mono text-white/80">{flashlightRadius}px</span>
                      </div>
                      <input
                        type="range"
                        min={120}
                        max={380}
                        step={10}
                        value={flashlightRadius}
                        onChange={(e) =>
                          updateInvestigation({ flashlightRadiusPx: Number(e.target.value) })
                        }
                        className="w-full accent-amber-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-white/60">
                        <span>Escuridão da Vinheta</span>
                        <span className="font-mono text-white/80">
                          {Math.round(ambientDarkness * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.55}
                        max={0.96}
                        step={0.02}
                        value={ambientDarkness}
                        onChange={(e) =>
                          updateInvestigation({ ambientDarkness: Number(e.target.value) })
                        }
                        className="w-full accent-amber-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* COLLAPSIBLE SIDE PANEL: Diário da Investigação */}
        {journalOpen && (
          <aside className="inv-panel-slide w-[300px] sm:w-[340px] shrink-0 h-full bg-[#0d1016]/96 border-l border-white/12 flex flex-col overflow-hidden z-20 backdrop-blur-md">
            <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <NotebookPen className="w-4 h-4 text-amber-300 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-xs font-typewriter font-semibold text-white truncate">
                    Diário da Investigação
                  </h3>
                  <p className="text-[11px] text-white/45">
                    {filteredJournal.length}{' '}
                    {filteredJournal.length === 1 ? 'pista anotada' : 'pistas anotadas'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setJournalOpen(false)}
                className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
                title="Fechar Diário"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scope switch */}
            <div className="px-3.5 py-2 border-b border-white/8 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setJournalScope('all')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  journalScope === 'all'
                    ? 'bg-white/12 text-white'
                    : 'text-white/55 hover:text-white/85'
                }`}
              >
                Toda a Sessão ({journalEntries.length})
              </button>
              <button
                type="button"
                onClick={() => setJournalScope('scene')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  journalScope === 'scene'
                    ? 'bg-white/12 text-white'
                    : 'text-white/55 hover:text-white/85'
                }`}
              >
                Esta Cena (
                {journalEntries.filter((e) => e.investigationId === investigation.id).length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredJournal.length === 0 ? (
                <div className="p-5 rounded-lg bg-white/3 border border-white/8 text-center space-y-1.5">
                  <Sparkles className="w-5 h-5 text-amber-300/60 mx-auto" />
                  <p className="text-xs font-medium text-white/75">Nenhuma pista anotada ainda</p>
                  <p className="text-[11px] text-white/45 leading-relaxed">
                    Clique nos pontos brilhantes na imagem e use &ldquo;Anotar Pista&rdquo; para
                    registrar evidências neste diário.
                  </p>
                </div>
              ) : (
                filteredJournal.map((entry) => {
                  const isExpanded = expandedJournalId === entry.id;
                  const diffMeta = DIFFICULTY_META[entry.difficulty || 1];
                  const thumbUrl = resolvedJournalThumbMap[entry.id] || entry.zoomImageUrl || '';
                  const canRemove =
                    Boolean(onRemoveJournalEntry) &&
                    (isGm || (currentUserUid && entry.notedByUid === currentUserUid));

                  return (
                    <article
                      key={entry.id}
                      className="rounded-lg bg-white/4 border border-white/10 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedJournalId(isExpanded ? null : entry.id)}
                        className="w-full p-2.5 flex items-start gap-2.5 text-left hover:bg-white/4 transition-colors cursor-pointer"
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={entry.title}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded object-cover shrink-0 border border-white/12 bg-black/50"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded shrink-0 bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
                            <Search className="w-4 h-4 text-amber-300/80" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-typewriter font-semibold text-white truncate">
                            {entry.title}
                          </h4>
                          <p className="text-[10px] text-white/50 truncate mt-0.5">
                            <span style={{ color: diffMeta.color }}>{diffMeta.shortLabel}</span>
                            {' · '}
                            {entry.investigationTitle}
                          </p>
                          <p className="text-[10px] text-white/40 mt-0.5 truncate">
                            Anotado por {entry.notedByName || 'Investigador'}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-white/45 shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-white/45 shrink-0 mt-0.5" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-white/8 space-y-2.5">
                          {thumbUrl && (
                            <div className="rounded-md overflow-hidden border border-white/10 bg-black/65 max-h-44 flex items-center justify-center">
                              <img
                                src={thumbUrl}
                                alt={entry.title}
                                referrerPolicy="no-referrer"
                                className="w-full max-h-44 object-contain"
                              />
                            </div>
                          )}
                          <p className="text-xs text-white/85 whitespace-pre-wrap leading-relaxed">
                            {entry.description || 'Sem descrição detalhada.'}
                          </p>
                          {canRemove && onRemoveJournalEntry && (
                            <div className="flex justify-end pt-1">
                              <button
                                type="button"
                                onClick={() => onRemoveJournalEntry(entry.id)}
                                className="flex items-center gap-1 text-[11px] text-rose-300/75 hover:text-rose-300 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Remover do Diário</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>

      {/* CLEAN CLUE INSPECTION MODAL (Opened when clicking a visible Hotspot) */}
      {isInteractivePlayerView && inspectedHotspot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
          onClick={() => setInspectedHotspot(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="inv-modal-reveal relative w-full max-w-xl max-h-[88vh] flex flex-col rounded-xl bg-[#0e1117] border border-white/14 shadow-[0_24px_80px_rgba(0,0,0,0.85)] overflow-hidden"
          >
            {/* Optional Zoom Image */}
            {resolvedZoomUrl && (
              <div className="relative bg-[#06070a] border-b border-white/10 flex items-center justify-center max-h-[42vh] overflow-hidden">
                <img
                  src={resolvedZoomUrl}
                  alt={inspectedHotspot.title}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[42vh] object-contain"
                />
              </div>
            )}

            {/* Modal Content */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-white/50">
                    {investigation.title || 'Investigação'}
                    {' · '}
                    <span
                      style={{
                        color: DIFFICULTY_META[inspectedHotspot.difficulty || 1].color,
                      }}
                    >
                      {DIFFICULTY_META[inspectedHotspot.difficulty || 1].label}
                    </span>
                  </p>
                  <h3 className="text-lg sm:text-xl font-typewriter font-bold text-[#f7f3ea] leading-snug">
                    {inspectedHotspot.title || 'Evidência Encontrada'}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => setInspectedHotspot(null)}
                  className="p-1.5 rounded-md text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                  aria-label="Fechar detalhes da pista"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="h-px bg-white/10" />

              <p className="text-sm text-white/88 leading-relaxed whitespace-pre-wrap">
                {inspectedHotspot.description ||
                  'Você examina este ponto atentamente, mas não há anotações adicionais.'}
              </p>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-5 sm:px-6 py-3.5 bg-black/35 border-t border-white/10 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] text-white/45">
                {currentUserName ? `Investigador: ${currentUserName}` : 'Registro da sessão'}
              </span>

              <div className="flex items-center gap-2">
                {isInspectedAlreadyNoted ? (
                  <>
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/15 border border-emerald-400/35 text-emerald-200">
                      <Check className="w-3.5 h-3.5" />
                      <span>Pista Anotada</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedHotspot(null);
                        setJournalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/16 text-white transition-colors cursor-pointer"
                    >
                      Ver no Diário
                    </button>
                  </>
                ) : (
                  onNoteClue && (
                    <button
                      type="button"
                      disabled={savingNoteId === inspectedHotspot.id}
                      onClick={() => handleNoteCurrentClue(inspectedHotspot)}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {savingNoteId === inspectedHotspot.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FilePlus2 className="w-3.5 h-3.5" />
                      )}
                      <span>Anotar Pista</span>
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => setInspectedHotspot(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/6 hover:bg-white/12 border border-white/12 text-white/85 transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
