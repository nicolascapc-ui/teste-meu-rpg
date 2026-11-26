import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  Flame,
  Hammer,
  Heart,
  ImagePlus,
  Lock,
  Music,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Wand2,
  X,
} from 'lucide-react';
import type {
  ActiveDuelState,
  AudioTrack,
  CharacterSheet,
  DuelActionItem,
  DuelArenaPresetId,
  DuelCameraAngle,
  DuelCombatantState,
  DuelCursorAttackMode,
  DuelLiveEffect,
  Scene,
  SceneDuelConfig,
  SceneMediaKind,
  SceneToken,
} from '../types/vtt';
import {
  buildCombatantFromTokenAndSheets,
  DUEL_ARENA_PRESETS,
  findSheetForToken,
  getDuelArenaPreset,
  playCombatCursorSfx,
} from '../lib/duelEngine';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { detectSceneMediaKind } from '../lib/mediaOptimizer';

// -----------------------------------------------------------------------------
// 1. Confrontation Setup Pop-up (When 2 Tokens are selected on the Tabletop)
// -----------------------------------------------------------------------------
interface DuelSetupModalProps {
  tokenA: SceneToken;
  tokenB: SceneToken;
  scene: Scene;
  initialConfig: SceneDuelConfig;
  sheets: CharacterSheet[];
  audioTracks: AudioTrack[];
  uploadContext: CampaignUploadContext;
  onStartDuel: (duel: ActiveDuelState, savedConfig: SceneDuelConfig) => void;
  onCancel: () => void;
  onNotify: (msg: string) => void;
}

export function DuelSetupModal({
  tokenA,
  tokenB,
  scene,
  initialConfig,
  sheets,
  audioTracks,
  uploadContext,
  onStartDuel,
  onCancel,
  onNotify,
}: DuelSetupModalProps) {
  const [swapped, setSwapped] = useState(false);
  const playerToken = swapped ? tokenB : tokenA;
  const npcToken = swapped ? tokenA : tokenB;

  const autoPlayerSheet = useMemo(
    () => findSheetForToken(playerToken, sheets),
    [playerToken, sheets]
  );
  const autoNpcSheet = useMemo(
    () => findSheetForToken(npcToken, sheets),
    [npcToken, sheets]
  );

  const [playerSheetId, setPlayerSheetId] = useState<string>(autoPlayerSheet?.id || '');
  const [npcSheetId, setNpcSheetId] = useState<string>(autoNpcSheet?.id || '');

  useEffect(() => {
    setPlayerSheetId(findSheetForToken(playerToken, sheets)?.id || '');
    setNpcSheetId(findSheetForToken(npcToken, sheets)?.id || '');
  }, [playerToken, npcToken, sheets]);

  const [arenaPreset, setArenaPreset] = useState<DuelArenaPresetId>(
    initialConfig.arenaPreset || 'expedition_ruins'
  );
  const [bgUrl, setBgUrl] = useState(initialConfig.bgUrl || scene.imageUrl || '');
  const [bgMediaId, setBgMediaId] = useState(initialConfig.bgMediaId || scene.mediaId || '');
  const [bgMediaKind, setBgMediaKind] = useState<SceneMediaKind>(
    initialConfig.bgMediaKind || scene.mediaKind || 'image'
  );
  const [uploadingBg, setUploadingBg] = useState(false);

  // Prefer Duel Music tracks first, then regular music tracks
  const duelMusicTracks = useMemo(
    () => audioTracks.filter((t) => t.layer === 'music' && t.synthPreset === 'duel'),
    [audioTracks]
  );
  const regularMusicTracks = useMemo(
    () => audioTracks.filter((t) => t.layer === 'music' && t.synthPreset !== 'duel'),
    [audioTracks]
  );

  const [musicTrackId, setMusicTrackId] = useState<string>(
    initialConfig.musicTrackId || duelMusicTracks[0]?.id || scene.linkedMusicId || ''
  );
  const [hidePlayerActionsOnScreen, setHidePlayerActionsOnScreen] = useState(false);

  const [playerThumb, setPlayerThumb] = useState('');
  const [npcThumb, setNpcThumb] = useState('');
  const [bgPreview, setBgPreview] = useState('');

  useEffect(() => {
    let active = true;
    void resolveMediaUrl(
      playerToken.mediaId,
      playerToken.imageUrl,
      uploadContext.campaignId
    ).then((u) => {
      if (active) setPlayerThumb(u);
    });
    void resolveMediaUrl(npcToken.mediaId, npcToken.imageUrl, uploadContext.campaignId).then(
      (u) => {
        if (active) setNpcThumb(u);
      }
    );
    return () => {
      active = false;
    };
  }, [playerToken, npcToken, uploadContext.campaignId]);

  useEffect(() => {
    let active = true;
    void resolveMediaUrl(bgMediaId, bgUrl, uploadContext.campaignId).then((u) => {
      if (active) setBgPreview(u);
    });
    return () => {
      active = false;
    };
  }, [bgMediaId, bgUrl, uploadContext.campaignId]);

  const previewPlayerCombatant = useMemo(() => {
    const chosenSheet = sheets.find((s) => s.id === playerSheetId) || null;
    const tokWithSheet = { ...playerToken, sheetId: chosenSheet?.id };
    return buildCombatantFromTokenAndSheets(
      tokWithSheet,
      chosenSheet ? [chosenSheet] : [],
      'player'
    );
  }, [playerToken, playerSheetId, sheets]);

  const previewNpcCombatant = useMemo(() => {
    const chosenSheet = sheets.find((s) => s.id === npcSheetId) || null;
    const tokWithSheet = { ...npcToken, sheetId: chosenSheet?.id };
    return buildCombatantFromTokenAndSheets(tokWithSheet, chosenSheet ? [chosenSheet] : [], 'npc');
  }, [npcToken, npcSheetId, sheets]);

  async function handleUploadDuelBg(file: File | undefined) {
    if (!file) return;
    setUploadingBg(true);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'scene',
      });
      setBgUrl(res.url);
      setBgMediaId(res.mediaId);
      setBgMediaKind(res.mediaKind);
      setBgPreview(res.previewUrl);
      onNotify(`Fundo 3D de duelo "${res.fileName}" vinculado a esta cena.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar fundo de duelo.');
    } finally {
      setUploadingBg(false);
    }
  }

  function handleConfirmStart() {
    const savedConfig: SceneDuelConfig = {
      bgUrl,
      bgMediaId,
      bgMediaKind,
      arenaPreset,
      musicTrackId,
    };

    const duel: ActiveDuelState = {
      id: `duel_${Date.now().toString(36)}`,
      sceneId: scene.id,
      activeTurn: 'player',
      round: 1,
      arenaPreset,
      cameraAngle: 'dynamic',
      bgUrl,
      bgMediaId,
      bgMediaKind,
      musicTrackId,
      hidePlayerActionsOnScreen,
      player: previewPlayerCombatant,
      npc: previewNpcCombatant,
      lastActionSummary: `Confronto iniciado: ${previewPlayerCombatant.name} vs ${previewNpcCombatant.name}`,
      lastEffect: null,
      startedAtMs: Date.now(),
    };

    onStartDuel(duel, savedConfig);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl vtt-surface border vtt-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b vtt-border flex items-center justify-between vtt-subtle">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 vtt-accent-text" />
            <h2 className="text-sm font-bold font-typewriter tracking-wide uppercase">
              Confronto Direto · Configurar Modo Duelo 3D
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 vtt-muted hover:opacity-100"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Combatants VS Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
            {/* Player Side */}
            <div className="border vtt-border vtt-canvas p-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-12 h-12 rounded-full border-2 overflow-hidden shrink-0 flex items-center justify-center bg-stone-900 text-stone-100 font-bold"
                  style={{ borderColor: previewPlayerCombatant.color }}
                >
                  {playerThumb ? (
                    <img
                      src={playerThumb}
                      alt={previewPlayerCombatant.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{previewPlayerCombatant.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Jogador / Aliado
                  </span>
                  <p className="text-sm font-bold font-typewriter truncate">
                    {previewPlayerCombatant.name}
                  </p>
                  <p className="text-[11px] vtt-muted truncate">
                    PV: {previewPlayerCombatant.hpCurrent}/{previewPlayerCombatant.hpMax} ·{' '}
                    {previewPlayerCombatant.actions.length} ações lidas
                  </p>
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] vtt-muted">Ficha vinculada (Modular ou PDF):</span>
                <select
                  value={playerSheetId}
                  onChange={(e) => setPlayerSheetId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                >
                  <option value="">Sem ficha (usar valores básicos)</option>
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.templateId}
                      {s.mode === 'pdf' ? ' · PDF' : ''})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Swap Button */}
            <div className="flex flex-col items-center justify-center gap-1">
              <span className="text-base font-bold font-typewriter vtt-accent-text">VS</span>
              <button
                type="button"
                onClick={() => setSwapped((v) => !v)}
                className="px-2.5 py-1 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center gap-1"
                title="Inverter quem é o Player e quem é o NPC"
              >
                <RotateCcw className="w-3 h-3" />
                Inverter
              </button>
            </div>

            {/* NPC / Enemy Side */}
            <div className="border vtt-border vtt-canvas p-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-12 h-12 rounded-full border-2 overflow-hidden shrink-0 flex items-center justify-center bg-stone-900 text-stone-100 font-bold"
                  style={{ borderColor: previewNpcCombatant.color }}
                >
                  {npcThumb ? (
                    <img
                      src={npcThumb}
                      alt={previewNpcCombatant.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{previewNpcCombatant.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    NPC / Inimigo (Ações Ocultas)
                  </span>
                  <p className="text-sm font-bold font-typewriter truncate">
                    {previewNpcCombatant.name}
                  </p>
                  <p className="text-[11px] vtt-muted truncate">
                    PV: {previewNpcCombatant.hpCurrent}/{previewNpcCombatant.hpMax} ·{' '}
                    {previewNpcCombatant.actions.length} golpes secretos
                  </p>
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] vtt-muted">Ficha do NPC (Modular ou PDF):</span>
                <select
                  value={npcSheetId}
                  onChange={(e) => setNpcSheetId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                >
                  <option value="">Sem ficha (usar golpes táticos + notas)</option>
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.templateId}
                      {s.mode === 'pdf' ? ' · PDF' : ''})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* 3D Arena Atmosphere Preset + Per-Scene Duel Background */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t vtt-border pt-4">
            <div className="space-y-2">
              <label className="block font-semibold">Estilo da Arena 3D</label>
              <div className="grid grid-cols-2 gap-1.5">
                {DUEL_ARENA_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setArenaPreset(p.id)}
                    className={`p-2 text-left border transition-colors ${
                      arenaPreset === p.id
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-canvas vtt-border hover:vtt-subtle'
                    }`}
                  >
                    <p className="text-xs truncate">{p.name}</p>
                    <p className="text-[10px] opacity-75 truncate">{p.subtitle.split('·')[0]}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="block font-semibold">
                Fundo 3D Específico de Duelo ({scene.name})
              </label>
              <div className="border vtt-border vtt-canvas p-2.5 flex items-center gap-2.5">
                <div className="w-16 h-12 bg-stone-900 border vtt-border overflow-hidden shrink-0 flex items-center justify-center">
                  {bgPreview ? (
                    bgMediaKind === 'video' ? (
                      <video
                        src={bgPreview}
                        muted
                        loop
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={bgPreview}
                        alt="Fundo Duelo"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <span className="text-[10px] text-stone-400">Arena 3D</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <label className="px-2.5 py-1 text-[11px] font-semibold vtt-accent-btn cursor-pointer inline-flex items-center gap-1">
                      <ImagePlus className="w-3 h-3" />
                      <span>{uploadingBg ? 'Enviando...' : 'Trocar Fundo 3D'}</span>
                      <input
                        type="file"
                        accept="image/*,video/mp4,video/webm"
                        className="hidden"
                        disabled={uploadingBg}
                        onChange={(e) => {
                          void handleUploadDuelBg(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {(bgUrl !== scene.imageUrl || bgMediaId !== scene.mediaId) && (
                      <button
                        type="button"
                        onClick={() => {
                          setBgUrl(scene.imageUrl);
                          setBgMediaId(scene.mediaId);
                          setBgMediaKind(scene.mediaKind || 'image');
                        }}
                        className="px-2 py-1 text-[10px] border vtt-border vtt-surface"
                      >
                        Usar da Cena
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={bgUrl.startsWith('idb://') ? '' : bgUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBgUrl(val);
                      setBgMediaId('');
                      setBgMediaKind(detectSceneMediaKind(val));
                    }}
                    placeholder="Ou cole link https:// de imagem/GIF/vídeo..."
                    className="w-full px-2 py-1 text-[11px] border vtt-border vtt-surface"
                  />
                </div>
              </div>

              {/* Duel Music Selector */}
              <label className="block space-y-1">
                <span className="font-semibold flex items-center gap-1">
                  <Music className="w-3 h-3 vtt-accent-text" />
                  Música de Modo Duelo (Fade Automático)
                </span>
                <select
                  value={musicTrackId}
                  onChange={(e) => setMusicTrackId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                >
                  <option value="">Manter trilha atual da cena</option>
                  {duelMusicTracks.length > 0 && (
                    <optgroup label="⚔️ Músicas de Modo Duelo">
                      {duelMusicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {regularMusicTracks.length > 0 && (
                    <optgroup label="🎵 Músicas de Fundo">
                      {regularMusicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            </div>
          </div>

          {/* Screen Visibility & Privacy Options */}
          <div className="border vtt-border vtt-canvas p-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hidePlayerActionsOnScreen}
                onChange={(e) => setHidePlayerActionsOnScreen(e.target.checked)}
              />
              <span>
                <strong>Ocultar menu de ações do Player na Tela Compartilhada (TV)</strong>
                <span className="block text-[11px] vtt-muted">
                  As ações do NPC já ficam 100% ocultas para jogadores; marque para deixar a TV apenas com o visual 3D cinematográfico.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t vtt-border vtt-subtle flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs border vtt-border vtt-surface hover:opacity-80"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmStart}
            className="px-5 py-2 text-xs font-bold vtt-accent-btn flex items-center gap-2"
          >
            <Swords className="w-4 h-4" />
            Ativar Modo Duelo 3D
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2. Fullscreen 3D Turn-Based Duel Arena Overlay (GM, Shared TV Screen, Mobile)
// -----------------------------------------------------------------------------
interface DuelArena3DOverlayProps {
  campaignId: string;
  uploadContext?: CampaignUploadContext;
  duel: ActiveDuelState | null;
  mode: 'gm' | 'screen' | 'player';
  onUpdateDuel?: (next: ActiveDuelState) => void;
  onExecuteDuelAction?: (params: {
    side: 'player' | 'npc';
    action: DuelActionItem;
    rollDamageOnly?: boolean;
  }) => void;
  onEndDuel?: () => void;
  onSaveSceneDuelBg?: (bgUrl: string, bgMediaId: string, bgMediaKind: SceneMediaKind) => void;
  onNotify?: (msg: string) => void;
}

interface SlashTrailPoint {
  x: number;
  y: number;
  createdAt: number;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  kind: 'spark' | 'ring' | 'slash_line';
  x2?: number;
  y2?: number;
}

export function DuelArena3DOverlay({
  campaignId,
  uploadContext,
  duel,
  mode,
  onUpdateDuel,
  onExecuteDuelAction,
  onEndDuel,
  onSaveSceneDuelBg,
  onNotify,
}: DuelArena3DOverlayProps) {
  // Smooth subtle entrance & exit transition states
  const [renderedDuel, setRenderedDuel] = useState<ActiveDuelState | null>(duel);
  const [visibilityPhase, setVisibilityPhase] = useState<'hidden' | 'entering' | 'active' | 'exiting'>(
    duel ? 'active' : 'hidden'
  );

  useEffect(() => {
    if (duel) {
      setRenderedDuel(duel);
      setVisibilityPhase((prev) => (prev === 'hidden' || prev === 'exiting' ? 'entering' : 'active'));
      const t = window.setTimeout(() => setVisibilityPhase('active'), 40);
      return () => window.clearTimeout(t);
    } else if (renderedDuel) {
      setVisibilityPhase('exiting');
      const t = window.setTimeout(() => {
        setVisibilityPhase('hidden');
        setRenderedDuel(null);
      }, 420);
      return () => window.clearTimeout(t);
    }
  }, [duel]);

  const [bgResolvedUrl, setBgResolvedUrl] = useState('');
  const [playerImgUrl, setPlayerImgUrl] = useState('');
  const [npcImgUrl, setNpcImgUrl] = useState('');

  // GM Interactive Cursor Damage Mode ("Fruit Ninja" Blade, Blunt Smash, Shot, Arcane)
  const [cursorMode, setCursorMode] = useState<DuelCursorAttackMode>('blade');
  const [cursorDamage, setCursorDamage] = useState<number>(5);
  const [activeActionSideTab, setActiveActionSideTab] = useState<'player' | 'npc'>('player');
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [showAddCustomMove, setShowAddCustomMove] = useState(false);
  const [customMoveName, setCustomMoveName] = useState('');
  const [customMoveFormula, setCustomMoveFormula] = useState('1d20 + 5');
  const [customMoveDamage, setCustomMoveDamage] = useState('1d8 + 3');
  const [uploadingBg, setUploadingBg] = useState(false);

  // Subtle 3D Mouse Parallax
  const [mouseTilt, setMouseTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });

  // Refs for 3D Combatant Hitboxes & Interactive FX Canvas
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerBoxRef = useRef<HTMLDivElement | null>(null);
  const npcBoxRef = useRef<HTMLDivElement | null>(null);

  const isPointerDownRef = useRef(false);
  const slashTrailRef = useRef<SlashTrailPoint[]>([]);
  const burstsRef = useRef<BurstParticle[]>([]);
  const lastSlashHitMsRef = useRef<Record<'player' | 'npc', number>>({ player: 0, npc: 0 });
  const lastProcessedEffectIdRef = useRef<string>('');

  // Floating Damage Popups
  const [floatingPopups, setFloatingPopups] = useState<
    Array<{
      id: string;
      side: 'player' | 'npc';
      text: string;
      subtext?: string;
      color: string;
    }>
  >([]);

  useEffect(() => {
    if (renderedDuel?.activeTurn) {
      setActiveActionSideTab(renderedDuel.activeTurn);
    }
  }, [renderedDuel?.activeTurn]);

  // Resolve Media URLs for 3D Background and Combatants
  useEffect(() => {
    let active = true;
    if (!renderedDuel) return;
    void resolveMediaUrl(renderedDuel.bgMediaId, renderedDuel.bgUrl, campaignId).then((u) => {
      if (active) setBgResolvedUrl(u);
    });
    void resolveMediaUrl(
      renderedDuel.player.mediaId,
      renderedDuel.player.imageUrl,
      campaignId
    ).then((u) => {
      if (active) setPlayerImgUrl(u);
    });
    void resolveMediaUrl(renderedDuel.npc.mediaId, renderedDuel.npc.imageUrl, campaignId).then(
      (u) => {
        if (active) setNpcImgUrl(u);
      }
    );
    return () => {
      active = false;
    };
  }, [
    renderedDuel?.bgMediaId,
    renderedDuel?.bgUrl,
    renderedDuel?.player.mediaId,
    renderedDuel?.player.imageUrl,
    renderedDuel?.npc.mediaId,
    renderedDuel?.npc.imageUrl,
    campaignId,
  ]);

  // Replay incoming live effects (slash trails, blunt shockwaves, floating damage numbers) on Shared TV & Mobile
  useEffect(() => {
    const eff = renderedDuel?.lastEffect;
    if (!eff || eff.id === lastProcessedEffectIdRef.current) return;
    lastProcessedEffectIdRef.current = eff.id;

    // Play procedural combat sound
    playCombatCursorSfx(eff.kind);

    // Spawn floating damage/effect number
    const popupId = `pop_${eff.id}`;
    const text =
      eff.kind === 'heal'
        ? `+${eff.damageAmount || 0} PV`
        : eff.kind === 'shield'
          ? 'DEFESA!'
          : eff.damageAmount && eff.damageAmount > 0
            ? `-${eff.damageAmount} PV`
            : eff.label || 'IMPACTO!';
    const color =
      eff.kind === 'heal'
        ? '#34d399'
        : eff.kind === 'shield'
          ? '#38bdf8'
          : eff.isCrit
            ? '#f59e0b'
            : '#f87171';

    setFloatingPopups((prev) => [
      ...prev.slice(-6),
      {
        id: popupId,
        side: eff.targetSide,
        text,
        subtext: eff.label,
        color,
      },
    ]);
    window.setTimeout(() => {
      setFloatingPopups((prev) => prev.filter((p) => p.id !== popupId));
    }, 1350);

    // Spawn canvas visual burst at target combatant's position
    const canvas = fxCanvasRef.current;
    const targetEl = eff.targetSide === 'player' ? playerBoxRef.current : npcBoxRef.current;
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();

    let cx = eff.targetSide === 'player' ? cRect.width * 0.28 : cRect.width * 0.72;
    let cy = eff.targetSide === 'player' ? cRect.height * 0.56 : cRect.height * 0.44;
    if (targetEl) {
      const tRect = targetEl.getBoundingClientRect();
      cx = tRect.left - cRect.left + tRect.width / 2;
      cy = tRect.top - cRect.top + tRect.height / 2;
    }

    // If slashPoints were broadcast from GM's Fruit Ninja blade swipe, render them on TV too!
    if (eff.slashPoints && eff.slashPoints.length >= 2) {
      const now = performance.now();
      for (const pt of eff.slashPoints) {
        slashTrailRef.current.push({
          x: pt.x * cRect.width,
          y: pt.y * cRect.height,
          createdAt: now,
        });
      }
    }

    spawnImpactParticles(cx, cy, eff.kind);
  }, [renderedDuel?.lastEffect]);

  function spawnImpactParticles(
    cx: number,
    cy: number,
    kind: DuelLiveEffect['kind'],
    slashAngle?: number
  ) {
    const colorMap: Record<DuelLiveEffect['kind'], string> = {
      blade: '#f87171',
      blunt: '#fbbf24',
      shot: '#38bdf8',
      arcane: '#c084fc',
      heal: '#34d399',
      shield: '#60a5fa',
    };
    const mainColor = colorMap[kind] || '#f87171';

    // Shockwave ring
    burstsRef.current.push({
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      size: 14,
      color: mainColor,
      alpha: 1,
      kind: 'ring',
    });

    // Diagonal razor slash line across target
    if (kind === 'blade') {
      const ang = slashAngle ?? -Math.PI / 4;
      const len = 115;
      burstsRef.current.push({
        x: cx - Math.cos(ang) * len,
        y: cy - Math.sin(ang) * len,
        x2: cx + Math.cos(ang) * len,
        y2: cy + Math.sin(ang) * len,
        vx: 0,
        vy: 0,
        size: 5,
        color: '#ffffff',
        alpha: 1,
        kind: 'slash_line',
      });
    }

    // Radial sparks / blood / energy droplets
    const count = kind === 'blunt' ? 26 : 22;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 8.5;
      burstsRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === 'heal' ? 2.5 : 0),
        size: 2.2 + Math.random() * 4.2,
        color: i % 3 === 0 ? '#ffffff' : mainColor,
        alpha: 1,
        kind: 'spark',
      });
    }
  }

  // Continuous 60fps HTML5 2D Canvas Loop for 3D Atmospheric Particles + Fruit Ninja Blade Slash Trail + Impact Bursts
  useEffect(() => {
    if (visibilityPhase === 'hidden' || !renderedDuel) return;
    const canvas = fxCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const preset = getDuelArenaPreset(renderedDuel.arenaPreset);
    let animId = 0;

    const ambientParticles = Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      vx: (Math.random() - 0.5) * 0.0008,
      vy:
        preset.particleKind === 'rain'
          ? 0.012 + Math.random() * 0.008
          : -(0.0007 + Math.random() * 0.0014),
      size: 1.5 + Math.random() * 3.2,
      phase: Math.random() * Math.PI * 2,
    }));

    const renderFrame = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      // 1. Atmospheric 3D Arena Particles
      for (const p of ambientParticles) {
        p.x += p.vx * p.z;
        p.y += p.vy * p.z;
        p.phase += 0.03;
        if (p.y < -0.05) p.y = 1.05;
        if (p.y > 1.05) p.y = -0.05;
        if (p.x < -0.05) p.x = 1.05;
        if (p.x > 1.05) p.x = -0.05;

        const px = p.x * w;
        const py = p.y * h;
        const alpha = (0.25 + 0.35 * Math.sin(p.phase)) * p.z;

        ctx.save();
        if (preset.particleKind === 'rain') {
          ctx.strokeStyle = `rgba(186, 230, 253, ${alpha * 0.7})`;
          ctx.lineWidth = 1.2 * p.z;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - 6 * p.z, py + 24 * p.z);
          ctx.stroke();
        } else {
          ctx.fillStyle = preset.accentColor;
          ctx.globalAlpha = Math.max(0.05, Math.min(0.85, alpha));
          ctx.beginPath();
          ctx.arc(px, py, p.size * p.z, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 2. Active "Fruit Ninja" Katana Blade Slash Trail
      const trail = slashTrailRef.current.filter((pt) => now - pt.createdAt < 240);
      slashTrailRef.current = trail;
      if (trail.length >= 2) {
        ctx.save();
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          const ageRatio = 1 - (now - p1.createdAt) / 240;
          const progressRatio = i / trail.length;
          const width = Math.max(1.5, 14 * ageRatio * progressRatio);

          // Outer crimson/gold energy glow
          ctx.strokeStyle = preset.accentColor;
          ctx.globalAlpha = Math.max(0, ageRatio * 0.65);
          ctx.lineWidth = width * 2.1;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();

          // Inner white-hot razor core
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = Math.max(0, ageRatio);
          ctx.lineWidth = width * 0.75;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 3. Impact Bursts (Shockwave Rings, Slash Cuts, Sparks)
      const nextBursts: BurstParticle[] = [];
      for (const b of burstsRef.current) {
        if (b.kind === 'ring') {
          b.size += 7.5;
          b.alpha -= 0.048;
          if (b.alpha > 0.02) {
            ctx.save();
            ctx.strokeStyle = b.color;
            ctx.globalAlpha = b.alpha;
            ctx.lineWidth = Math.max(1.5, 5 * b.alpha);
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            nextBursts.push(b);
          }
        } else if (b.kind === 'slash_line') {
          b.alpha -= 0.055;
          if (b.alpha > 0.02 && b.x2 !== undefined && b.y2 !== undefined) {
            ctx.save();
            ctx.strokeStyle = '#ef4444';
            ctx.globalAlpha = b.alpha * 0.85;
            ctx.lineWidth = 11 * b.alpha;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x2, b.y2);
            ctx.stroke();

            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = b.alpha;
            ctx.lineWidth = 3.5 * b.alpha;
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x2, b.y2);
            ctx.stroke();
            ctx.restore();
            nextBursts.push(b);
          }
        } else {
          b.x += b.vx;
          b.y += b.vy;
          b.vy += 0.22; // gravity
          b.alpha -= 0.032;
          if (b.alpha > 0.02) {
            ctx.save();
            ctx.fillStyle = b.color;
            ctx.globalAlpha = b.alpha;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            nextBursts.push(b);
          }
        }
      }
      burstsRef.current = nextBursts;

      animId = window.requestAnimationFrame(renderFrame);
    };

    animId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animId);
  }, [visibilityPhase, renderedDuel?.arenaPreset]);

  if (visibilityPhase === 'hidden' || !renderedDuel) {
    return null;
  }

  const preset = getDuelArenaPreset(renderedDuel.arenaPreset);
  const nowMs = Date.now();
  const playerHitActive =
    Boolean(renderedDuel.player.lastHitAtMs) && nowMs - (renderedDuel.player.lastHitAtMs || 0) < 650;
  const npcHitActive =
    Boolean(renderedDuel.npc.lastHitAtMs) && nowMs - (renderedDuel.npc.lastHitAtMs || 0) < 650;
  const playerLungeActive =
    Boolean(renderedDuel.player.lastLungeAtMs) &&
    nowMs - (renderedDuel.player.lastLungeAtMs || 0) < 550;
  const npcLungeActive =
    Boolean(renderedDuel.npc.lastLungeAtMs) && nowMs - (renderedDuel.npc.lastLungeAtMs || 0) < 550;

  // Apply direct damage/effect to a combatant and broadcast live to Shared TV & Players
  function applyInteractiveStrike(
    targetSide: 'player' | 'npc',
    kind: DuelLiveEffect['kind'],
    slashPoints?: Array<{ x: number; y: number }>
  ) {
    if (!renderedDuel || mode !== 'gm' || !onUpdateDuel) return;
    const target = targetSide === 'player' ? renderedDuel.player : renderedDuel.npc;
    const dmg = Math.max(0, cursorDamage);
    const nextHp = Math.max(0, target.hpCurrent - dmg);
    const hitTime = Date.now();

    const effectLabels: Record<DuelLiveEffect['kind'], string> = {
      blade: 'Corte de Lâmina',
      blunt: 'Golpe Contundente',
      shot: 'Disparo Certeiro',
      arcane: 'Impacto Arcano',
      heal: 'Restauração',
      shield: 'Guarda Defensiva',
    };

    const effect: DuelLiveEffect = {
      id: `fx_${hitTime}_${Math.random().toString(36).slice(2, 6)}`,
      timestampMs: hitTime,
      targetSide,
      kind,
      damageAmount: dmg,
      label: effectLabels[kind],
      slashPoints,
    };

    const updatedTarget: DuelCombatantState = {
      ...target,
      hpCurrent: nextHp,
      lastHitAtMs: hitTime,
    };

    const nextDuel: ActiveDuelState = {
      ...renderedDuel,
      player: targetSide === 'player' ? updatedTarget : renderedDuel.player,
      npc: targetSide === 'npc' ? updatedTarget : renderedDuel.npc,
      lastEffect: effect,
      lastActionSummary:
        dmg > 0
          ? `${effectLabels[kind]} em ${target.name} (-${dmg} PV)`
          : `${effectLabels[kind]} atingiu ${target.name}!`,
    };

    onUpdateDuel(nextDuel);
  }

  function checkPointerHitsCombatant(
    clientX: number,
    clientY: number
  ): 'player' | 'npc' | null {
    const pRect = playerBoxRef.current?.getBoundingClientRect();
    if (
      pRect &&
      clientX >= pRect.left &&
      clientX <= pRect.right &&
      clientY >= pRect.top &&
      clientY <= pRect.bottom
    ) {
      return 'player';
    }
    const nRect = npcBoxRef.current?.getBoundingClientRect();
    if (
      nRect &&
      clientX >= nRect.left &&
      clientX <= nRect.right &&
      clientY >= nRect.top &&
      clientY <= nRect.bottom
    ) {
      return 'npc';
    }
    return null;
  }

  function handleArenaPointerDown(e: React.PointerEvent) {
    if (mode !== 'gm') return;
    const targetTag = (e.target as HTMLElement)?.tagName;
    if (targetTag && ['BUTTON', 'INPUT', 'SELECT', 'LABEL'].includes(targetTag)) return;

    const arenaRect = arenaRef.current?.getBoundingClientRect();
    if (!arenaRect) return;
    const x = e.clientX - arenaRect.left;
    const y = e.clientY - arenaRect.top;

    isPointerDownRef.current = true;

    if (cursorMode === 'blade') {
      slashTrailRef.current = [{ x, y, createdAt: performance.now() }];
      return;
    }

    if (cursorMode === 'blunt' || cursorMode === 'shot' || cursorMode === 'arcane') {
      const hitSide = checkPointerHitsCombatant(e.clientX, e.clientY);
      if (hitSide) {
        applyInteractiveStrike(hitSide, cursorMode);
      } else {
        // Still play visual impact at click point even if on background
        playCombatCursorSfx(cursorMode);
        spawnImpactParticles(x, y, cursorMode);
      }
    }
  }

  function handleArenaPointerMove(e: React.PointerEvent) {
    const arenaRect = arenaRef.current?.getBoundingClientRect();
    if (!arenaRect || arenaRect.width === 0 || arenaRect.height === 0) return;

    const nx = (e.clientX - arenaRect.left) / arenaRect.width;
    const ny = (e.clientY - arenaRect.top) / arenaRect.height;

    // Subtle 3D camera parallax tilt
    setMouseTilt({
      rx: Number(((0.5 - ny) * 5.5).toFixed(2)),
      ry: Number(((nx - 0.5) * 8.5).toFixed(2)),
    });

    if (mode !== 'gm' || !isPointerDownRef.current || cursorMode !== 'blade') return;

    const x = e.clientX - arenaRect.left;
    const y = e.clientY - arenaRect.top;
    const now = performance.now();
    slashTrailRef.current.push({ x, y, createdAt: now });

    // Check if the blade swipe just sliced across either combatant ("Fruit Ninja" hit detection!)
    const hitSide = checkPointerHitsCombatant(e.clientX, e.clientY);
    if (hitSide && Date.now() - lastSlashHitMsRef.current[hitSide] > 360) {
      lastSlashHitMsRef.current[hitSide] = Date.now();
      const recentNormalized = slashTrailRef.current.slice(-10).map((pt) => ({
        x: Number((pt.x / arenaRect.width).toFixed(3)),
        y: Number((pt.y / arenaRect.height).toFixed(3)),
      }));
      applyInteractiveStrike(hitSide, 'blade', recentNormalized);
    }
  }

  function handleArenaPointerUp() {
    isPointerDownRef.current = false;
  }

  function adjustCombatantHp(side: 'player' | 'npc', delta: number) {
    if (!renderedDuel || !onUpdateDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const nextHp = Math.max(0, Math.min(target.hpMax, target.hpCurrent + delta));
    const now = Date.now();
    const isDamage = delta < 0;

    const updated: DuelCombatantState = {
      ...target,
      hpCurrent: nextHp,
      lastHitAtMs: isDamage ? now : target.lastHitAtMs,
    };

    const effect: DuelLiveEffect = {
      id: `hp_${now}`,
      timestampMs: now,
      targetSide: side,
      kind: isDamage ? 'blunt' : 'heal',
      damageAmount: Math.abs(delta),
      label: isDamage ? 'Dano' : 'Cura',
    };

    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
      lastEffect: effect,
      lastActionSummary: `${target.name}: ${delta > 0 ? `+${delta}` : delta} PV (${nextHp}/${target.hpMax})`,
    });
  }

  function handleAddQuickAction(e: React.FormEvent) {
    e.preventDefault();
    if (!renderedDuel || !onUpdateDuel || !customMoveName.trim()) return;
    const newAction: DuelActionItem = {
      id: `custom_${Date.now().toString(36)}`,
      label: customMoveName.trim(),
      category: 'attack',
      formula: customMoveFormula.trim() || '1d20',
      damageFormula: customMoveDamage.trim() || undefined,
      damageLabel: 'Dano',
      description: `Golpe adicionado em combate (${customMoveFormula})`,
      sourceLabel: 'Customizado',
    };
    const side = activeActionSideTab;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const updated: DuelCombatantState = {
      ...target,
      actions: [newAction, ...target.actions],
    };
    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
    });
    setCustomMoveName('');
    setShowAddCustomMove(false);
    onNotify?.(`Golpe "${newAction.label}" adicionado a ${target.name}.`);
  }

  async function handleQuickBgUpload(file: File | undefined) {
    if (!file || !uploadContext || !renderedDuel || !onUpdateDuel) return;
    setUploadingBg(true);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'scene',
      });
      onUpdateDuel({
        ...renderedDuel,
        bgUrl: res.url,
        bgMediaId: res.mediaId,
        bgMediaKind: res.mediaKind,
      });
      onSaveSceneDuelBg?.(res.url, res.mediaId, res.mediaKind);
      onNotify?.(`Fundo 3D de duelo atualizado com "${res.fileName}".`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao atualizar fundo 3D.');
    } finally {
      setUploadingBg(false);
    }
  }

  // Compute 3D Camera Transform based on cameraAngle, activeTurn, and mouse parallax
  const effectiveCamera = renderedDuel.cameraAngle;
  let camRotateX = 4 + mouseTilt.rx;
  let camRotateY = mouseTilt.ry;
  let camTranslateZ = 0;
  let camTranslateX = 0;

  if (effectiveCamera === 'dynamic') {
    if (renderedDuel.activeTurn === 'player') {
      camRotateY = 9 + mouseTilt.ry * 0.7;
      camRotateX = 5 + mouseTilt.rx * 0.7;
      camTranslateX = 28;
    } else {
      camRotateY = -10 + mouseTilt.ry * 0.7;
      camRotateX = 6 + mouseTilt.rx * 0.7;
      camTranslateX = -28;
    }
  } else if (effectiveCamera === 'stadium') {
    camRotateX = 11 + mouseTilt.rx * 0.6;
    camRotateY = 14 + mouseTilt.ry * 0.6;
    camTranslateZ = -35;
  } else if (effectiveCamera === 'showdown') {
    camRotateX = 2 + mouseTilt.rx * 0.5;
    camRotateY = mouseTilt.ry * 0.5;
    camTranslateZ = 25;
  } else if (effectiveCamera === 'focus_player') {
    camRotateY = 16;
    camTranslateX = 120;
    camTranslateZ = 65;
  } else if (effectiveCamera === 'focus_npc') {
    camRotateY = -16;
    camTranslateX = -120;
    camTranslateZ = 65;
  }

  const resolvedMediaKind =
    renderedDuel.bgMediaKind || detectSceneMediaKind(renderedDuel.bgUrl || bgResolvedUrl);

  // Determine whether the bottom action command dock should be visible on this screen
  const showBottomCommandDock =
    mode === 'gm' ||
    mode === 'player' ||
    (mode === 'screen' && !renderedDuel.hidePlayerActionsOnScreen);

  const cursorStyle =
    mode !== 'gm'
      ? 'cursor-default'
      : cursorMode === 'blade' || cursorMode === 'shot'
        ? 'cursor-crosshair'
        : cursorMode === 'blunt' || cursorMode === 'arcane'
          ? 'cursor-pointer'
          : 'cursor-default';

  return (
    <div
      ref={arenaRef}
      onPointerDown={handleArenaPointerDown}
      onPointerMove={handleArenaPointerMove}
      onPointerUp={handleArenaPointerUp}
      onPointerCancel={handleArenaPointerUp}
      className={`fixed inset-0 z-40 overflow-hidden select-none touch-none bg-stone-950 text-stone-100 transition-all duration-400 ease-out ${cursorStyle} ${
        visibilityPhase === 'entering' || visibilityPhase === 'exiting'
          ? 'opacity-0 scale-105'
          : 'opacity-100 scale-100'
      }`}
    >
      {/* 1. Deep 3D Perspective Viewport (Cyclorama Backdrop + 3D Tilted Arena Floor + 3D Pedestals) */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{
          perspective: '1150px',
          perspectiveOrigin: '50% 44%',
        }}
      >
        <div
          className="relative w-full h-full transition-transform duration-700 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translate3d(${camTranslateX}px, 0px, ${camTranslateZ}px) rotateX(${camRotateX}deg) rotateY(${camRotateY}deg)`,
          }}
        >
          {/* 3D Skybox / Custom Scene Duel Background Cyclorama */}
          <div
            className="absolute inset-[-14%] overflow-hidden"
            style={{
              transform: 'translateZ(-240px) scale(1.26)',
              background: preset.skyGradient,
            }}
          >
            {bgResolvedUrl && (
              <div className="w-full h-full relative opacity-55">
                {resolvedMediaKind === 'video' ? (
                  <video
                    src={bgResolvedUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={bgResolvedUrl}
                    alt="Cenário 3D de Duelo"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                )}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(7,6,6,0.35) 0%, rgba(7,6,6,0.15) 45%, rgba(7,6,6,0.92) 100%)',
                  }}
                />
              </div>
            )}
          </div>

          {/* 3D Ground Plane (Tilted in 3D space with tactical concentric rings & grid) */}
          <div
            className="absolute left-1/2 top-[48%] w-[160vw] h-[130vh] -translate-x-1/2 -translate-y-1/2"
            style={{
              transform: 'rotateX(75deg) translateZ(-110px)',
              background: preset.floorGradient,
              boxShadow: `0 0 140px 20px ${preset.ambientGlow} inset`,
            }}
          >
            {/* Perspective Tactical Grid & Duel Rings */}
            <div
              className="w-full h-full opacity-75"
              style={{
                backgroundImage: `
                  radial-gradient(circle at 50% 50%, transparent 18%, ${preset.floorGridColor} 18.5%, transparent 19.5%),
                  radial-gradient(circle at 50% 50%, transparent 36%, ${preset.floorGridColor} 36.5%, transparent 37.5%),
                  linear-gradient(to right, ${preset.floorGridColor} 1px, transparent 1px),
                  linear-gradient(to bottom, ${preset.floorGridColor} 1px, transparent 1px)
                `,
                backgroundSize: '100% 100%, 100% 100%, 76px 76px, 76px 76px',
              }}
            />
          </div>

          {/* Volumetric Rim Spotlight Beams */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(circle at ${
                renderedDuel.activeTurn === 'player' ? '28% 58%' : '72% 44%'
              }, ${preset.ambientGlow} 0%, transparent 55%)`,
            }}
          />

          {/* 3D Combatant Stage Container */}
          <div
            className="absolute inset-0 max-w-6xl mx-auto px-6"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* PLAYER COMBATANT (Foreground-Left 3D Platform — Expedition 33 / Pokémon angle) */}
            <div
              ref={playerBoxRef}
              className="absolute left-[6%] sm:left-[11%] bottom-[22%] sm:bottom-[24%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
              style={{
                transform: `translate3d(${playerLungeActive ? '68px' : playerHitActive ? '-26px' : '0px'}, ${
                  playerLungeActive ? '-18px' : '0px'
                }, 48px) rotateY(8deg)`,
                transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Floating Damage Popups for Player */}
              {floatingPopups
                .filter((p) => p.side === 'player')
                .map((pop) => (
                  <div
                    key={pop.id}
                    className="absolute -top-14 z-30 px-3 py-1 bg-black/85 border border-white/20 shadow-xl animate-bounce"
                    style={{ color: pop.color }}
                  >
                    <p className="text-lg sm:text-xl font-extrabold font-typewriter tracking-tight">
                      {pop.text}
                    </p>
                    {pop.subtext && (
                      <p className="text-[10px] uppercase tracking-wider text-stone-300 text-center">
                        {pop.subtext}
                      </p>
                    )}
                  </div>
                ))}

              {/* Active Turn Indicator Crown */}
              {renderedDuel.activeTurn === 'player' && (
                <div
                  className="mb-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border bg-black/80"
                  style={{ borderColor: preset.accentColor, color: preset.accentColor }}
                >
                  ◆ Turno Ativo
                </div>
              )}

              {/* 3D Character Standee Card */}
              <div
                className={`relative w-36 h-36 sm:w-48 sm:h-48 rounded-2xl border-2 overflow-hidden bg-stone-900 flex items-center justify-center transition-all duration-200 ${
                  playerHitActive ? 'ring-4 ring-red-500 brightness-125' : ''
                }`}
                style={{
                  borderColor:
                    renderedDuel.activeTurn === 'player'
                      ? preset.accentColor
                      : renderedDuel.player.color,
                  boxShadow: playerHitActive
                    ? '0 0 38px 10px rgba(239, 68, 68, 0.85), 0 22px 40px rgba(0,0,0,0.85)'
                    : `0 24px 48px rgba(0,0,0,0.85), 0 0 24px ${preset.ambientGlow}`,
                }}
              >
                {playerImgUrl ? (
                  <img
                    src={playerImgUrl}
                    alt={renderedDuel.player.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-4xl font-bold font-typewriter text-stone-200">
                    {renderedDuel.player.name.slice(0, 2).toUpperCase()}
                  </span>
                )}

                {renderedDuel.player.isDefending && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-sky-950/90 border border-sky-400 text-sky-200 text-[10px] font-bold flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Guarda
                  </div>
                )}

                {playerHitActive && (
                  <div className="absolute inset-0 bg-red-600/35 pointer-events-none" />
                )}
              </div>

              {/* 3D Grounded Pedestal Disc & Contact Shadow */}
              <div
                className="w-44 sm:w-56 h-7 -mt-3 rounded-full border"
                style={{
                  borderColor: preset.accentColor,
                  background: `radial-gradient(ellipse at center, ${preset.ambientGlow} 0%, rgba(0,0,0,0.88) 75%)`,
                  transform: 'rotateX(65deg)',
                  boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
                }}
              />

              {/* Player Vital HUD Plate */}
              <div className="mt-2 w-full bg-stone-950/90 border border-stone-700/80 p-2.5 shadow-2xl">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold font-typewriter truncate">
                      {renderedDuel.player.name}
                    </p>
                    {renderedDuel.player.subtitle && (
                      <p className="text-[10px] text-stone-400 truncate">
                        {renderedDuel.player.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-bold tabular-nums text-emerald-400 shrink-0">
                    {renderedDuel.player.hpCurrent}/{renderedDuel.player.hpMax} PV
                  </span>
                </div>

                {/* HP Bar */}
                <div className="mt-1.5 w-full h-2 bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (renderedDuel.player.hpCurrent /
                            Math.max(1, renderedDuel.player.hpMax)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>

                {/* Secondary Bar (Sanity / Mana / PE) if available */}
                {renderedDuel.player.mpMax !== undefined && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-sky-300">
                    <span className="truncate">{renderedDuel.player.mpLabel || 'Energia'}</span>
                    <span className="tabular-nums">
                      {renderedDuel.player.mpCurrent ?? renderedDuel.player.mpMax}/
                      {renderedDuel.player.mpMax}
                    </span>
                  </div>
                )}

                {/* Quick GM HP Controls */}
                {mode === 'gm' && (
                  <div className="mt-2 pt-1.5 border-t border-stone-800 flex items-center justify-between gap-1 text-[10px]">
                    <span className="text-stone-400">PV Rápido:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('player', -5)}
                        className="px-1.5 py-0.5 bg-red-950/80 border border-red-800/70 text-red-200 hover:bg-red-900"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('player', -1)}
                        className="px-1.5 py-0.5 bg-red-950/80 border border-red-800/70 text-red-200 hover:bg-red-900"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('player', 1)}
                        className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800/70 text-emerald-200 hover:bg-emerald-900"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('player', 5)}
                        className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800/70 text-emerald-200 hover:bg-emerald-900"
                      >
                        +5
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* NPC / ENEMY COMBATANT (Midground-Right 3D Platform) */}
            <div
              ref={npcBoxRef}
              className="absolute right-[6%] sm:right-[11%] top-[16%] sm:top-[18%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
              style={{
                transform: `translate3d(${npcLungeActive ? '-68px' : npcHitActive ? '26px' : '0px'}, ${
                  npcLungeActive ? '18px' : '0px'
                }, -18px) rotateY(-10deg)`,
                transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Floating Damage Popups for NPC */}
              {floatingPopups
                .filter((p) => p.side === 'npc')
                .map((pop) => (
                  <div
                    key={pop.id}
                    className="absolute -top-14 z-30 px-3 py-1 bg-black/85 border border-white/20 shadow-xl animate-bounce"
                    style={{ color: pop.color }}
                  >
                    <p className="text-lg sm:text-xl font-extrabold font-typewriter tracking-tight">
                      {pop.text}
                    </p>
                    {pop.subtext && (
                      <p className="text-[10px] uppercase tracking-wider text-stone-300 text-center">
                        {pop.subtext}
                      </p>
                    )}
                  </div>
                ))}

              {/* Active Turn Indicator Crown */}
              {renderedDuel.activeTurn === 'npc' && (
                <div className="mb-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border border-red-500 text-red-400 bg-black/80">
                  ◆ Turno do Oponente
                </div>
              )}

              {/* 3D Enemy Standee Card */}
              <div
                className={`relative w-36 h-36 sm:w-48 sm:h-48 rounded-2xl border-2 overflow-hidden bg-stone-900 flex items-center justify-center transition-all duration-200 ${
                  npcHitActive ? 'ring-4 ring-red-500 brightness-125' : ''
                }`}
                style={{
                  borderColor:
                    renderedDuel.activeTurn === 'npc' ? '#ef4444' : renderedDuel.npc.color,
                  boxShadow: npcHitActive
                    ? '0 0 38px 10px rgba(239, 68, 68, 0.85), 0 22px 40px rgba(0,0,0,0.85)'
                    : '0 24px 48px rgba(0,0,0,0.88), 0 0 28px rgba(220, 38, 38, 0.28)',
                }}
              >
                {npcImgUrl ? (
                  <img
                    src={npcImgUrl}
                    alt={renderedDuel.npc.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-4xl font-bold font-typewriter text-stone-200">
                    {renderedDuel.npc.name.slice(0, 2).toUpperCase()}
                  </span>
                )}

                {renderedDuel.npc.isDefending && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-sky-950/90 border border-sky-400 text-sky-200 text-[10px] font-bold flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Guarda
                  </div>
                )}

                {npcHitActive && (
                  <div className="absolute inset-0 bg-red-600/35 pointer-events-none" />
                )}
              </div>

              {/* 3D Grounded Pedestal Disc */}
              <div
                className="w-44 sm:w-56 h-7 -mt-3 rounded-full border border-red-500/60"
                style={{
                  background:
                    'radial-gradient(ellipse at center, rgba(220,38,38,0.32) 0%, rgba(0,0,0,0.9) 75%)',
                  transform: 'rotateX(65deg)',
                  boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
                }}
              />

              {/* Enemy Vital HUD Plate */}
              <div className="mt-2 w-full bg-stone-950/90 border border-stone-700/80 p-2.5 shadow-2xl">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold font-typewriter truncate">
                      {renderedDuel.npc.name}
                    </p>
                    {renderedDuel.npc.subtitle && (
                      <p className="text-[10px] text-stone-400 truncate">
                        {renderedDuel.npc.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-bold tabular-nums text-red-400 shrink-0">
                    {renderedDuel.npc.hpCurrent}/{renderedDuel.npc.hpMax} PV
                  </span>
                </div>

                {/* HP Bar */}
                <div className="mt-1.5 w-full h-2 bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-300"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (renderedDuel.npc.hpCurrent / Math.max(1, renderedDuel.npc.hpMax)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>

                {/* Quick GM HP Controls */}
                {mode === 'gm' && (
                  <div className="mt-2 pt-1.5 border-t border-stone-800 flex items-center justify-between gap-1 text-[10px]">
                    <span className="text-stone-400">PV Rápido:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('npc', -5)}
                        className="px-1.5 py-0.5 bg-red-950/80 border border-red-800/70 text-red-200 hover:bg-red-900"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('npc', -1)}
                        className="px-1.5 py-0.5 bg-red-950/80 border border-red-800/70 text-red-200 hover:bg-red-900"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('npc', 1)}
                        className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800/70 text-emerald-200 hover:bg-emerald-900"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCombatantHp('npc', 5)}
                        className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800/70 text-emerald-200 hover:bg-emerald-900"
                      >
                        +5
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Interactive 2D FX Canvas Overlay (Particles + Fruit Ninja Blade Slash + Shockwaves) */}
      <canvas
        ref={fxCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      />

      {/* 3. Top Duel Status & GM Interactive Cursor Toolbar */}
      <header className="relative z-30 px-4 py-2.5 bg-stone-950/90 border-b border-stone-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="px-2.5 py-1 text-xs font-bold font-typewriter uppercase tracking-wider border"
            style={{ borderColor: preset.accentColor, color: preset.accentColor }}
          >
            Rodada {renderedDuel.round}
          </span>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold font-typewriter truncate">
              {renderedDuel.player.name}{' '}
              <span className="text-stone-500 font-normal">vs</span> {renderedDuel.npc.name}
            </p>
            {renderedDuel.lastActionSummary && (
              <p className="text-[11px] text-amber-300/90 truncate">
                {renderedDuel.lastActionSummary}
              </p>
            )}
          </div>
        </div>

        {/* GM Interactive Cursor FX & Camera Controls */}
        {mode === 'gm' && onUpdateDuel && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {/* Cursor FX Mode Selector ("Fruit Ninja" Blade, Blunt Smash, Shot, Arcane) */}
            <div className="flex items-center bg-stone-900 border border-stone-700 p-0.5">
              {(
                [
                  ['blade', 'Lâmina (Fruit Ninja)', Swords],
                  ['blunt', 'Porrada', Hammer],
                  ['shot', 'Disparo', Crosshair],
                  ['arcane', 'Ritual', Sparkles],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCursorMode(id)}
                  className={`px-2 py-1 text-[11px] flex items-center gap-1 transition-colors ${
                    cursorMode === id
                      ? 'bg-red-700 text-white font-semibold'
                      : 'text-stone-300 hover:bg-stone-800'
                  }`}
                  title={
                    id === 'blade'
                      ? 'Arraste o mouse cortando o Player ou NPC como uma lâmina (Fruit Ninja)'
                      : `Clique no Player ou NPC para aplicar ${label}`
                  }
                >
                  <Icon className="w-3 h-3" />
                  <span className="hidden md:inline">{label.split(' ')[0]}</span>
                </button>
              ))}

              {/* Damage per cursor strike */}
              <select
                value={cursorDamage}
                onChange={(e) => setCursorDamage(Number(e.target.value))}
                className="ml-1 px-1.5 py-1 text-[11px] bg-stone-950 border-l border-stone-700 text-amber-300 font-semibold"
                title="Dano descontado ao cortar/bater com o cursor"
              >
                <option value={0}>Só Efeito (0 PV)</option>
                <option value={2}>-2 PV / golpe</option>
                <option value={5}>-5 PV / golpe</option>
                <option value={10}>-10 PV / golpe</option>
                <option value={15}>-15 PV / golpe</option>
              </select>
            </div>

            {/* 3D Camera Angle Switcher */}
            <select
              value={renderedDuel.cameraAngle}
              onChange={(e) =>
                onUpdateDuel({
                  ...renderedDuel,
                  cameraAngle: e.target.value as DuelCameraAngle,
                })
              }
              className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 text-stone-200"
              title="Ângulo da Câmera 3D"
            >
              <option value="dynamic">Câmera 3D: Dinâmica (Turno)</option>
              <option value="stadium">Câmera 3D: Coliseu (Pokémon)</option>
              <option value="showdown">Câmera 3D: Confronto Lateral</option>
              <option value="focus_player">Câmera 3D: Foco Player</option>
              <option value="focus_npc">Câmera 3D: Foco Oponente</option>
            </select>

            {/* 3D Arena Preset Switcher */}
            <select
              value={renderedDuel.arenaPreset}
              onChange={(e) =>
                onUpdateDuel({
                  ...renderedDuel,
                  arenaPreset: e.target.value as DuelArenaPresetId,
                })
              }
              className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 text-stone-200"
              title="Estilo da Arena 3D"
            >
              {DUEL_ARENA_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  Arena: {p.name}
                </option>
              ))}
            </select>

            {/* Quick Upload 3D Background Image/Video */}
            {uploadContext && (
              <label
                className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 hover:bg-stone-800 cursor-pointer flex items-center gap-1"
                title="Trocar imagem/vídeo de fundo 3D deste duelo"
              >
                <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden xl:inline">{uploadingBg ? '...' : 'Fundo 3D'}</span>
                <input
                  type="file"
                  accept="image/*,video/mp4,video/webm"
                  className="hidden"
                  disabled={uploadingBg}
                  onChange={(e) => {
                    void handleQuickBgUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}

            {/* Toggle Hide Player Actions on Shared TV Screen */}
            <button
              type="button"
              onClick={() =>
                onUpdateDuel({
                  ...renderedDuel,
                  hidePlayerActionsOnScreen: !renderedDuel.hidePlayerActionsOnScreen,
                })
              }
              className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                renderedDuel.hidePlayerActionsOnScreen
                  ? 'bg-amber-950/80 border-amber-600 text-amber-200'
                  : 'bg-stone-900 border-stone-700 text-stone-300'
              }`}
              title="Ocultar ou mostrar as opções de ação do Player na Tela Compartilhada (TV)"
            >
              {renderedDuel.hidePlayerActionsOnScreen ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">HUD TV Oculto</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">HUD TV Visível</span>
                </>
              )}
            </button>

            {/* Next Turn Button */}
            <button
              type="button"
              onClick={() => {
                const nextTurn = renderedDuel.activeTurn === 'player' ? 'npc' : 'player';
                const nextRound =
                  nextTurn === 'player' ? renderedDuel.round + 1 : renderedDuel.round;
                onUpdateDuel({
                  ...renderedDuel,
                  activeTurn: nextTurn,
                  round: nextRound,
                  lastActionSummary: `Turno de ${
                    nextTurn === 'player' ? renderedDuel.player.name : renderedDuel.npc.name
                  }`,
                });
              }}
              className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-stone-950"
            >
              Passar Turno ➔
            </button>

            {/* End Duel Button */}
            <button
              type="button"
              onClick={onEndDuel}
              className="px-2.5 py-1 text-[11px] font-semibold bg-stone-800 hover:bg-red-900 border border-stone-600 text-stone-100 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Encerrar Duelo
            </button>
          </div>
        )}
      </header>

      {/* Subtle GM Helper Tip for Cursor Slash */}
      {mode === 'gm' && (
        <div className="relative z-30 px-4 py-1 bg-black/60 border-b border-stone-800/60 flex items-center justify-between text-[11px] text-stone-300">
          <span>
            {cursorMode === 'blade'
              ? '💡 Modo Lâmina ativo: passe o mouse cortando o Player ou o NPC como em Fruit Ninja para fatiar e aplicar dano ao vivo!'
              : `💡 Modo ${
                  cursorMode === 'blunt'
                    ? 'Porrada'
                    : cursorMode === 'shot'
                      ? 'Disparo'
                      : 'Ritual'
                } ativo: clique diretamente sobre o Player ou NPC para disparar o impacto!`}
          </span>
          <button
            type="button"
            onClick={() => setHudCollapsed((v) => !v)}
            className="text-stone-400 hover:text-white underline ml-2 shrink-0"
          >
            {hudCollapsed ? '▴ Mostrar Comandos de Combate' : '▾ Recolher Comandos'}
          </button>
        </div>
      )}

      {/* 4. Bottom Turn-Based Command Dock (Persona / Expedition 33 / Pokémon Style) */}
      {showBottomCommandDock && !hudCollapsed && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(940px,95vw)] bg-stone-950/95 border border-stone-700/90 shadow-2xl">
          {/* Dock Header: Combatant Action Tabs (GM sees both Player & Secret NPC actions; Players/TV NEVER see NPC actions!) */}
          <div className="px-4 py-2 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {mode === 'gm' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveActionSideTab('player')}
                    className={`px-3 py-1 text-xs font-bold font-typewriter border transition-colors ${
                      activeActionSideTab === 'player'
                        ? 'bg-emerald-800/90 border-emerald-500 text-white'
                        : 'bg-stone-900 border-stone-700 text-stone-300'
                    }`}
                  >
                    ⚔️ Ações de {renderedDuel.player.name} ({renderedDuel.player.actions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionSideTab('npc')}
                    className={`px-3 py-1 text-xs font-bold font-typewriter border flex items-center gap-1.5 transition-colors ${
                      activeActionSideTab === 'npc'
                        ? 'bg-red-900/90 border-red-500 text-white'
                        : 'bg-stone-900 border-stone-700 text-stone-300'
                    }`}
                  >
                    <Lock className="w-3 h-3 text-red-400" />
                    Golpes Secretos de {renderedDuel.npc.name} (Só Mestre ·{' '}
                    {renderedDuel.npc.actions.length})
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Swords className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold font-typewriter uppercase tracking-wider">
                    Comandos de Combate · {renderedDuel.player.name}
                  </span>
                </div>
              )}
            </div>

            {mode === 'gm' && (
              <button
                type="button"
                onClick={() => setShowAddCustomMove((v) => !v)}
                className="px-2.5 py-1 text-[11px] border border-stone-700 bg-stone-900 hover:bg-stone-800 flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-amber-400" />
                {showAddCustomMove ? 'Fechar' : '+ Adicionar Golpe / Ação'}
              </button>
            )}
          </div>

          {/* Quick Add Custom Move Form (GM only) */}
          {mode === 'gm' && showAddCustomMove && (
            <form
              onSubmit={handleAddQuickAction}
              className="px-4 py-2.5 bg-stone-900/90 border-b border-stone-800 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs"
            >
              <input
                type="text"
                required
                value={customMoveName}
                onChange={(e) => setCustomMoveName(e.target.value)}
                placeholder="Nome do golpe (ex: Garras Sombrias)"
                className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100"
              />
              <input
                type="text"
                value={customMoveFormula}
                onChange={(e) => setCustomMoveFormula(e.target.value)}
                placeholder="Fórmula de ataque (ex: 2d20kh1+6)"
                className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100 font-mono"
              />
              <input
                type="text"
                value={customMoveDamage}
                onChange={(e) => setCustomMoveDamage(e.target.value)}
                placeholder="Fórmula de dano (ex: 2d8+4)"
                className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100 font-mono"
              />
              <button
                type="submit"
                className="px-3 py-1.5 font-semibold bg-amber-600 hover:bg-amber-500 text-stone-950"
              >
                Adicionar a{' '}
                {activeActionSideTab === 'player'
                  ? renderedDuel.player.name
                  : renderedDuel.npc.name}
              </button>
            </form>
          )}

          {/* Action Cards Grid (Extracted from Sheet / PDF) */}
          <div className="p-3 max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {(mode === 'gm' && activeActionSideTab === 'npc'
              ? renderedDuel.npc.actions
              : renderedDuel.player.actions
            ).map((act) => {
              const activeSide: 'player' | 'npc' =
                mode === 'gm' ? activeActionSideTab : 'player';
              const canTrigger = mode === 'gm' || mode === 'player';

              return (
                <div
                  key={act.id}
                  className="border border-stone-800 bg-stone-900/90 hover:border-stone-600 p-2.5 flex flex-col justify-between gap-2 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold font-typewriter text-stone-100 truncate">
                        {act.label}
                      </span>
                      {act.sourceLabel && (
                        <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-stone-800 text-stone-300 shrink-0">
                          {act.sourceLabel}
                        </span>
                      )}
                    </div>
                    {act.description && (
                      <p className="text-[10px] text-stone-400 truncate mt-0.5">
                        {act.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    {canTrigger ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onExecuteDuelAction?.({
                              side: activeSide,
                              action: act,
                              rollDamageOnly: false,
                            })
                          }
                          className={`flex-1 py-1.5 px-2 text-[11px] font-bold flex items-center justify-center gap-1 ${
                            activeSide === 'npc'
                              ? 'bg-red-800 hover:bg-red-700 text-white'
                              : 'bg-amber-600 hover:bg-amber-500 text-stone-950'
                          }`}
                        >
                          <Dices className="w-3.5 h-3.5" />
                          <span>Usar ({act.formula})</span>
                        </button>
                        {act.damageFormula && (
                          <button
                            type="button"
                            onClick={() =>
                              onExecuteDuelAction?.({
                                side: activeSide,
                                action: act,
                                rollDamageOnly: true,
                              })
                            }
                            className="py-1.5 px-2 text-[11px] font-semibold bg-stone-800 hover:bg-red-950 border border-stone-700 text-red-300 flex items-center gap-1 shrink-0"
                            title={`Rolar e aplicar ${act.damageLabel || 'Dano'}: ${act.damageFormula}`}
                          >
                            <Flame className="w-3 h-3" />
                            <span>{act.damageLabel || 'Dano'}</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] font-mono text-stone-400">
                        {act.formula}
                        {act.damageFormula ? ` · Dano: ${act.damageFormula}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
