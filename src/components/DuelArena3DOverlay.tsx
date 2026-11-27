import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  Flame,
  Hammer,
  HeartPulse,
  ImagePlus,
  Lock,
  Music,
  Palette,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Tag,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type {
  ActiveDuelState,
  AudioTrack,
  CharacterSheet,
  CustomDuelArenaPreset,
  DuelActionItem,
  DuelArenaPresetId,
  DuelAttackSfxMap,
  DuelCameraAngle,
  DuelCombatantState,
  DuelCursorAttackMode,
  DuelCustomSfxEntry,
  DuelExtraSettings,
  DuelLiveEffect,
  DuelParticleKind,
  DuelStatusTag,
  DuelStatusTagTone,
  Scene,
  SceneDuelConfig,
  SceneMediaKind,
  SceneToken,
} from '../types/vtt';
import {
  buildCombatantFromTokenAndSheets,
  deleteCustomDuelPreset,
  DUEL_PARTICLE_OPTIONS,
  DUEL_STATUS_PRESETS,
  findSheetForToken,
  getAllDuelArenaPresets,
  getDuelArenaPreset,
  loadCampaignAttackSfx,
  loadCampaignDuelExtraSettings,
  loadCustomDuelPresets,
  playCombatCursorSfx,
  resolveDuelExtraSettings,
  saveActionCustomSfx,
  saveCampaignAttackSfx,
  saveCampaignDuelExtraSettings,
  saveCustomDuelPreset,
} from '../lib/duelEngine';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import {
  detectSceneMediaKind,
  trimTransparentSpriteUrl,
} from '../lib/mediaOptimizer';
import { DuelComboPop } from './DuelComboPop';
import { DuelExtraSettingsDrawer } from './DuelExtraSettingsDrawer';

const CURSOR_ATTACK_TYPES: Array<{
  id: 'blade' | 'blunt' | 'shot' | 'arcane';
  label: string;
  icon: typeof Swords;
}> = [
  { id: 'blade', label: 'Corte', icon: Swords },
  { id: 'blunt', label: 'Impacto', icon: Hammer },
  { id: 'shot', label: 'Tiro', icon: Crosshair },
  { id: 'arcane', label: 'Magia', icon: Sparkles },
];

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
  onUpdateTokenSprite?: (tokenId: string, url: string, mediaId: string) => void;
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
  onUpdateTokenSprite,
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
  const [tokenSpriteOverrides, setTokenSpriteOverrides] = useState<
    Record<string, { url: string; mediaId: string }>
  >({});
  const [uploadingSpriteSide, setUploadingSpriteSide] = useState<'player' | 'npc' | null>(null);
  const [playerSpritePreview, setPlayerSpritePreview] = useState('');
  const [npcSpritePreview, setNpcSpritePreview] = useState('');

  useEffect(() => {
    setPlayerSheetId(findSheetForToken(playerToken, sheets)?.id || '');
    setNpcSheetId(findSheetForToken(npcToken, sheets)?.id || '');
  }, [playerToken, npcToken, sheets]);

  const effectivePlayerSprite = tokenSpriteOverrides[playerToken.id] || {
    url: playerToken.combatSpriteUrl || '',
    mediaId: playerToken.combatSpriteMediaId || '',
  };
  const effectiveNpcSprite = tokenSpriteOverrides[npcToken.id] || {
    url: npcToken.combatSpriteUrl || '',
    mediaId: npcToken.combatSpriteMediaId || '',
  };

  const [allPresets, setAllPresets] = useState(() => getAllDuelArenaPresets());
  const [arenaPreset, setArenaPreset] = useState<DuelArenaPresetId>(
    initialConfig.arenaPreset || 'expedition_ruins'
  );
  const [customArenaStyle, setCustomArenaStyle] = useState<CustomDuelArenaPreset | null>(
    initialConfig.customArenaStyle || null
  );

  // Custom Preset Creator state
  const [showCustomCreator, setShowCustomCreator] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBgColor, setCustomBgColor] = useState('#1c1917');
  const [customFloorColor, setCustomFloorColor] = useState('#292524');
  const [customAccentColor, setCustomAccentColor] = useState('#f59e0b');
  const [customParticleKind, setCustomParticleKind] = useState<DuelParticleKind>('dust');

  const [bgUrl, setBgUrl] = useState(initialConfig.bgUrl || scene.imageUrl || '');
  const [bgMediaId, setBgMediaId] = useState(initialConfig.bgMediaId || scene.mediaId || '');
  const [bgMediaKind, setBgMediaKind] = useState<SceneMediaKind>(
    initialConfig.bgMediaKind || scene.mediaKind || 'image'
  );
  const [uploadingBg, setUploadingBg] = useState(false);

  // Custom Attack SFX map (Corte, Impacto, Tiro, Magia)
  const [attackSfxMap, setAttackSfxMap] = useState<DuelAttackSfxMap>(
    () => initialConfig.attackSfxMap || loadCampaignAttackSfx(uploadContext.campaignId)
  );
  const [showAttackSfxConfig, setShowAttackSfxConfig] = useState(false);
  const [uploadingSfxKey, setUploadingSfxKey] = useState<string | null>(null);

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

  // Default to TRUE: players only see the 3D arena, the 2 confronting tokens, and reactive effects
  const [hidePlayerActionsOnScreen, setHidePlayerActionsOnScreen] = useState(true);
  // Default to FALSE: names above tokens are hidden for players unless enabled
  const [showCombatantNamesOnScreen, setShowCombatantNamesOnScreen] = useState(false);
  // Default to FALSE: HP bars and combat info on visualization/player screen are hidden unless enabled
  const [showCombatInfoOnScreen, setShowCombatInfoOnScreen] = useState(false);

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

  useEffect(() => {
    let active = true;
    if (!effectivePlayerSprite.mediaId && !effectivePlayerSprite.url) {
      setPlayerSpritePreview('');
    } else {
      void resolveMediaUrl(
        effectivePlayerSprite.mediaId,
        effectivePlayerSprite.url,
        uploadContext.campaignId
      ).then((u) => {
        if (active) setPlayerSpritePreview(u || effectivePlayerSprite.url || '');
      });
    }
    if (!effectiveNpcSprite.mediaId && !effectiveNpcSprite.url) {
      setNpcSpritePreview('');
    } else {
      void resolveMediaUrl(
        effectiveNpcSprite.mediaId,
        effectiveNpcSprite.url,
        uploadContext.campaignId
      ).then((u) => {
        if (active) setNpcSpritePreview(u || effectiveNpcSprite.url || '');
      });
    }
    return () => {
      active = false;
    };
  }, [
    effectivePlayerSprite.mediaId,
    effectivePlayerSprite.url,
    effectiveNpcSprite.mediaId,
    effectiveNpcSprite.url,
    uploadContext.campaignId,
  ]);

  const previewPlayerCombatant = useMemo(() => {
    const chosenSheet = sheets.find((s) => s.id === playerSheetId) || null;
    const tokWithSheet: SceneToken = {
      ...playerToken,
      sheetId: chosenSheet?.id,
      combatSpriteUrl: effectivePlayerSprite.url,
      combatSpriteMediaId: effectivePlayerSprite.mediaId,
    };
    return buildCombatantFromTokenAndSheets(
      tokWithSheet,
      chosenSheet ? [chosenSheet] : [],
      'player'
    );
  }, [playerToken, playerSheetId, sheets, effectivePlayerSprite.url, effectivePlayerSprite.mediaId]);

  const previewNpcCombatant = useMemo(() => {
    const chosenSheet = sheets.find((s) => s.id === npcSheetId) || null;
    const tokWithSheet: SceneToken = {
      ...npcToken,
      sheetId: chosenSheet?.id,
      combatSpriteUrl: effectiveNpcSprite.url,
      combatSpriteMediaId: effectiveNpcSprite.mediaId,
    };
    return buildCombatantFromTokenAndSheets(tokWithSheet, chosenSheet ? [chosenSheet] : [], 'npc');
  }, [npcToken, npcSheetId, sheets, effectiveNpcSprite.url, effectiveNpcSprite.mediaId]);

  async function handleUploadCombatSprite(side: 'player' | 'npc', file: File | undefined) {
    if (!file) return;
    const targetToken = side === 'player' ? playerToken : npcToken;
    setUploadingSpriteSide(side);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'combat_sprite',
      });
      setTokenSpriteOverrides((prev) => ({
        ...prev,
        [targetToken.id]: { url: res.url, mediaId: res.mediaId },
      }));
      onUpdateTokenSprite?.(targetToken.id, res.url, res.mediaId);
      onNotify(
        `PNG de combate corpo todo vinculado a "${targetToken.name}"${
          res.compressionSummary ? ` (${res.compressionSummary})` : ''
        }.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar PNG de combate.');
    } finally {
      setUploadingSpriteSide(null);
    }
  }

  function handleClearCombatSprite(side: 'player' | 'npc') {
    const targetToken = side === 'player' ? playerToken : npcToken;
    setTokenSpriteOverrides((prev) => ({
      ...prev,
      [targetToken.id]: { url: '', mediaId: '' },
    }));
    onUpdateTokenSprite?.(targetToken.id, '', '');
  }

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

  async function handleUploadAttackTypeSfx(
    kind: 'blade' | 'blunt' | 'shot' | 'arcane',
    file: File | undefined
  ) {
    if (!file) return;
    setUploadingSfxKey(kind);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'audio',
      });
      const nextMap: DuelAttackSfxMap = {
        ...attackSfxMap,
        [kind]: {
          url: res.url,
          mediaId: res.mediaId,
          fileName: res.fileName,
        },
      };
      setAttackSfxMap(nextMap);
      saveCampaignAttackSfx(uploadContext.campaignId, nextMap);
      onNotify(`Som "${res.fileName}" definido para ${kind === 'blade' ? 'Corte' : kind === 'blunt' ? 'Impacto' : kind === 'shot' ? 'Tiro' : 'Magia'}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar áudio de ataque.');
    } finally {
      setUploadingSfxKey(null);
    }
  }

  function handleSetAttackTypeSfxUrl(
    kind: 'blade' | 'blunt' | 'shot' | 'arcane',
    url: string
  ) {
    const trimmed = url.trim();
    const nextMap: DuelAttackSfxMap = { ...attackSfxMap };
    if (!trimmed) {
      delete nextMap[kind];
    } else {
      nextMap[kind] = { url: trimmed, mediaId: '', fileName: '' };
    }
    setAttackSfxMap(nextMap);
    saveCampaignAttackSfx(uploadContext.campaignId, nextMap);
  }

  function handleSelectPreset(id: DuelArenaPresetId) {
    setArenaPreset(id);
    const savedCustom = loadCustomDuelPresets().find((p) => p.id === id) || null;
    setCustomArenaStyle(savedCustom);
  }

  function handleCreateCustomPreset() {
    const name = customName.trim() || `Preset ${allPresets.length + 1}`;
    const created: CustomDuelArenaPreset = {
      id: `custom_${Date.now().toString(36)}`,
      name,
      bgColor: customBgColor,
      floorColor: customFloorColor,
      accentColor: customAccentColor,
      particleKind: customParticleKind,
    };
    saveCustomDuelPreset(created);
    setAllPresets(getAllDuelArenaPresets());
    setArenaPreset(created.id);
    setCustomArenaStyle(created);
    setCustomName('');
    setShowCustomCreator(false);
    onNotify(`Preset "${created.name}" criado e selecionado.`);
  }

  function handleDeleteCustomPreset(id: string) {
    deleteCustomDuelPreset(id);
    const updated = getAllDuelArenaPresets();
    setAllPresets(updated);
    if (arenaPreset === id) {
      setArenaPreset('expedition_ruins');
      setCustomArenaStyle(null);
    }
  }

  function handleConfirmStart() {
    const savedConfig: SceneDuelConfig = {
      bgUrl,
      bgMediaId,
      bgMediaKind,
      arenaPreset,
      customArenaStyle,
      musicTrackId,
      attackSfxMap,
    };

    const savedExtras = loadCampaignDuelExtraSettings(uploadContext.campaignId);
    const duel: ActiveDuelState = {
      id: `duel_${Date.now().toString(36)}`,
      sceneId: scene.id,
      activeTurn: 'player',
      round: 1,
      arenaPreset,
      customArenaStyle,
      cameraAngle: 'dynamic',
      bgUrl,
      bgMediaId,
      bgMediaKind,
      musicTrackId,
      hidePlayerActionsOnScreen,
      showCombatantNamesOnScreen,
      showCombatInfoOnScreen,
      attackSfxMap,
      extraSettings: savedExtras,
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
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                  Lado A · Jogador
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-emerald-400">
                  {previewPlayerCombatant.hpCurrent}/{previewPlayerCombatant.hpMax} PV
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-12 h-12 rounded-full border-2 overflow-hidden shrink-0 flex items-center justify-center bg-stone-900 text-stone-200 font-bold"
                  style={{ borderColor: playerToken.outlineColor || playerToken.color }}
                >
                  {playerThumb ? (
                    <img
                      src={playerThumb}
                      alt={playerToken.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{playerToken.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold font-typewriter text-sm truncate">{playerToken.name}</p>
                  <p className="text-[11px] vtt-muted truncate">
                    {previewPlayerCombatant.actions.length} ação(ões) lidas da ficha
                  </p>
                </div>
              </div>
              <label className="block space-y-1 pt-1">
                <span className="text-[11px] vtt-muted">Ficha vinculada (Modular ou PDF):</span>
                <select
                  value={playerSheetId}
                  onChange={(e) => setPlayerSheetId(e.target.value)}
                  className="w-full px-2 py-1.5 border vtt-border vtt-surface text-xs"
                >
                  <option value="">Sem ficha (usar notas do token)</option>
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.templateId || 'Sistema'}
                      {s.mode === 'pdf' ? ' · PDF' : ''})
                    </option>
                  ))}
                </select>
              </label>

              {/* Optional Full-Body Combat PNG Slot (Lado A) */}
              <div className="pt-1.5 border-t vtt-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {playerSpritePreview ? (
                    <div
                      className="w-8 h-10 shrink-0 border vtt-border flex items-end justify-center overflow-hidden"
                      style={{
                        backgroundImage:
                          'repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, transparent 0% 50%)',
                        backgroundSize: '8px 8px',
                      }}
                    >
                      <img
                        src={playerSpritePreview}
                        alt="PNG Combate"
                        className="max-w-full max-h-full object-contain object-bottom"
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold truncate">
                      {playerSpritePreview ? 'PNG Corpo Todo ativo' : 'PNG Corpo Todo (opcional)'}
                    </p>
                    <p className="text-[9px] vtt-muted truncate">
                      {playerSpritePreview
                        ? 'Substitui o token no duelo 3D'
                        : 'Sem PNG: usa token padrão'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <label className="px-2 py-1 text-[10px] font-semibold border vtt-border vtt-surface hover:opacity-85 cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3 vtt-accent-text" />
                    <span>
                      {uploadingSpriteSide === 'player'
                        ? '...'
                        : playerSpritePreview
                          ? 'Trocar'
                          : 'PNG'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/webp,image/*"
                      className="hidden"
                      disabled={uploadingSpriteSide === 'player'}
                      onChange={(e) => {
                        void handleUploadCombatSprite('player', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {playerSpritePreview && (
                    <button
                      type="button"
                      onClick={() => handleClearCombatSprite('player')}
                      className="p-1 text-stone-400 hover:text-red-400"
                      title="Remover PNG de combate"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Swap Roles Button */}
            <div className="flex flex-col items-center justify-center gap-1">
              <span className="text-base font-bold font-typewriter vtt-accent-text">VS</span>
              <button
                type="button"
                onClick={() => setSwapped((s) => !s)}
                className="px-2.5 py-1.5 border vtt-border vtt-surface hover:opacity-80 flex items-center gap-1 text-[11px]"
                title="Inverter quem é o Jogador e quem é o NPC/Inimigo"
              >
                <RotateCcw className="w-3 h-3" />
                Inverter
              </button>
            </div>

            {/* NPC / Enemy Side */}
            <div className="border vtt-border vtt-canvas p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-red-950/80 text-red-300 border border-red-700/60 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Lado B · NPC / Oponente
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-red-400">
                  {previewNpcCombatant.hpCurrent}/{previewNpcCombatant.hpMax} PV
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-12 h-12 rounded-full border-2 overflow-hidden shrink-0 flex items-center justify-center bg-stone-900 text-stone-200 font-bold"
                  style={{ borderColor: npcToken.outlineColor || npcToken.color }}
                >
                  {npcThumb ? (
                    <img
                      src={npcThumb}
                      alt={npcToken.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{npcToken.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold font-typewriter text-sm truncate">{npcToken.name}</p>
                  <p className="text-[11px] vtt-muted truncate">
                    {previewNpcCombatant.actions.length} golpe(s) secretos (Só Mestre)
                  </p>
                </div>
              </div>
              <label className="block space-y-1 pt-1">
                <span className="text-[11px] vtt-muted">Ficha do NPC (Modular ou PDF):</span>
                <select
                  value={npcSheetId}
                  onChange={(e) => setNpcSheetId(e.target.value)}
                  className="w-full px-2 py-1.5 border vtt-border vtt-surface text-xs"
                >
                  <option value="">Sem ficha (usar notas do token)</option>
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.templateId || 'Sistema'}
                      {s.mode === 'pdf' ? ' · PDF' : ''})
                    </option>
                  ))}
                </select>
              </label>

              {/* Optional Full-Body Combat PNG Slot (Lado B / NPC) */}
              <div className="pt-1.5 border-t vtt-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {npcSpritePreview ? (
                    <div
                      className="w-8 h-10 shrink-0 border vtt-border flex items-end justify-center overflow-hidden"
                      style={{
                        backgroundImage:
                          'repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, transparent 0% 50%)',
                        backgroundSize: '8px 8px',
                      }}
                    >
                      <img
                        src={npcSpritePreview}
                        alt="PNG Combate NPC"
                        className="max-w-full max-h-full object-contain object-bottom"
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold truncate">
                      {npcSpritePreview ? 'PNG Corpo Todo ativo' : 'PNG Corpo Todo (opcional)'}
                    </p>
                    <p className="text-[9px] vtt-muted truncate">
                      {npcSpritePreview
                        ? 'Substitui o token no duelo 3D'
                        : 'Sem PNG: usa token padrão'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <label className="px-2 py-1 text-[10px] font-semibold border vtt-border vtt-surface hover:opacity-85 cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3 vtt-accent-text" />
                    <span>
                      {uploadingSpriteSide === 'npc'
                        ? '...'
                        : npcSpritePreview
                          ? 'Trocar'
                          : 'PNG'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/webp,image/*"
                      className="hidden"
                      disabled={uploadingSpriteSide === 'npc'}
                      onChange={(e) => {
                        void handleUploadCombatSprite('npc', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {npcSpritePreview && (
                    <button
                      type="button"
                      onClick={() => handleClearCombatSprite('npc')}
                      className="p-1 text-stone-400 hover:text-red-400"
                      title="Remover PNG de combate"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Scene 3D Arena Background & Direct Color/Particle Presets */}
          <div className="border vtt-border vtt-canvas p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="font-bold font-typewriter text-xs">
                  Cenário 3D, Cores de Fundo & Partículas ({scene.name})
                </p>
                <p className="text-[11px] vtt-muted">
                  Escolha uma cor e tipo de partícula direto ao ponto ou crie seu próprio preset.
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowAttackSfxConfig((v) => !v)}
                  className="px-2.5 py-1.5 border vtt-border vtt-surface hover:opacity-80 text-xs flex items-center gap-1"
                >
                  <Volume2 className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>{showAttackSfxConfig ? 'Fechar Sons' : 'Sons de Ataque (MP3/Link)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomCreator((v) => !v)}
                  className="px-2.5 py-1.5 border vtt-border vtt-surface hover:opacity-80 text-xs flex items-center gap-1"
                >
                  <Palette className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>{showCustomCreator ? 'Fechar Criador' : '+ Criar Preset'}</span>
                </button>
                <label className="px-2.5 py-1.5 text-xs font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1.5 shrink-0">
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{uploadingBg ? 'Enviando...' : 'Imagem / Vídeo 3D'}</span>
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
              </div>
            </div>

            {/* Custom Attack SFX Configurator (MP3 Upload or Audio URL for Corte, Impacto, Tiro, Magia) */}
            {showAttackSfxConfig && (
              <div className="border vtt-border vtt-surface p-3 space-y-2.5">
                <p className="text-xs font-bold font-typewriter">
                  Sons de Ataque no Duelo (MP3 padrão ativo · editável)
                </p>
                <p className="text-[11px] vtt-muted">
                  Corte, Impacto, Tiro e Magia já tocam os áudios MP3 padrões automaticamente. Só altere abaixo se quiser trocar durante a sessão.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => {
                    const entry = attackSfxMap[id];
                    const defaultLabel =
                      id === 'blade'
                        ? 'Padrão: Corte (Lâmina)'
                        : id === 'blunt'
                          ? 'Padrão: Soco / Impacto'
                          : id === 'shot'
                            ? 'Padrão: Tiro (Desert Eagle)'
                            : 'Padrão: Magia (Feitiço)';
                    return (
                      <div key={id} className="border vtt-border vtt-canvas p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold font-typewriter text-xs flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 vtt-accent-text" />
                            {label}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                playCombatCursorSfx(id, {
                                  url: entry?.url,
                                  mediaId: entry?.mediaId,
                                  campaignId: uploadContext.campaignId,
                                })
                              }
                              className="px-2 py-0.5 text-[10px] border vtt-border vtt-surface hover:opacity-80 flex items-center gap-1"
                              title="Ouvir som"
                            >
                              <Play className="w-2.5 h-2.5" />
                              Testar
                            </button>
                            <label className="px-2 py-0.5 text-[10px] font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1">
                              <Upload className="w-2.5 h-2.5" />
                              <span>{uploadingSfxKey === id ? '...' : 'MP3'}</span>
                              <input
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                disabled={uploadingSfxKey === id}
                                onChange={(e) => {
                                  void handleUploadAttackTypeSfx(id, e.target.files?.[0]);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={entry?.url?.startsWith('idb://') ? '' : entry?.url || ''}
                          onChange={(e) => handleSetAttackTypeSfxUrl(id, e.target.value)}
                          placeholder={
                            entry?.fileName
                              ? `Arquivo: ${entry.fileName}`
                              : `${defaultLabel} (ou cole link MP3)`
                          }
                          className="w-full px-2 py-1 border vtt-border vtt-surface text-[11px]"
                        />
                        {entry && (entry.url || entry.mediaId) ? (
                          <div className="flex items-center justify-between text-[10px] text-emerald-400">
                            <span className="truncate">
                              ✓ {entry.fileName || 'Link de áudio customizado'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSetAttackTypeSfxUrl(id, '')}
                              className="text-stone-400 hover:text-red-400 underline ml-2"
                            >
                              Usar padrão
                            </button>
                          </div>
                        ) : (
                          <p className="text-[10px] vtt-muted truncate">✓ {defaultLabel}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom Preset Builder */}
            {showCustomCreator && (
              <div className="border vtt-border vtt-surface p-3 space-y-2.5">
                <p className="text-xs font-bold font-typewriter">Novo Preset Customizado</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] vtt-muted">Nome do preset</span>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Ex: Azul Noturno · Chuva"
                      className="w-full px-2.5 py-1.5 border vtt-border vtt-canvas text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] vtt-muted">Partículas</span>
                    <select
                      value={customParticleKind}
                      onChange={(e) => setCustomParticleKind(e.target.value as DuelParticleKind)}
                      className="w-full px-2.5 py-1.5 border vtt-border vtt-canvas text-xs"
                    >
                      {DUEL_PARTICLE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] vtt-muted block">Cor de Fundo</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customBgColor}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                        className="w-8 h-7 border vtt-border bg-transparent cursor-pointer"
                      />
                      <span className="text-[11px] font-mono">{customBgColor}</span>
                    </div>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] vtt-muted block">Cor do Chão</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customFloorColor}
                        onChange={(e) => setCustomFloorColor(e.target.value)}
                        className="w-8 h-7 border vtt-border bg-transparent cursor-pointer"
                      />
                      <span className="text-[11px] font-mono">{customFloorColor}</span>
                    </div>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] vtt-muted block">Cor das Partículas</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customAccentColor}
                        onChange={(e) => setCustomAccentColor(e.target.value)}
                        className="w-8 h-7 border vtt-border bg-transparent cursor-pointer"
                      />
                      <span className="text-[11px] font-mono">{customAccentColor}</span>
                    </div>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCustomCreator(false)}
                    className="px-3 py-1 border vtt-border vtt-canvas text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateCustomPreset}
                    className="px-3 py-1 text-xs font-semibold vtt-accent-btn"
                  >
                    Salvar Preset Customizado
                  </button>
                </div>
              </div>
            )}

            {/* Direct Color & Particle Preset Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {allPresets.map((preset) => {
                const active = arenaPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`relative border text-left transition-all flex items-center justify-between p-2.5 ${
                      active
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border hover:opacity-90'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-white/30"
                          style={{ backgroundColor: preset.accentColor }}
                        />
                        <span className="text-xs font-bold font-typewriter truncate">
                          {preset.name}
                        </span>
                      </div>
                      <p
                        className={`text-[10px] truncate mt-0.5 ${
                          active ? 'text-stone-100/90' : 'vtt-muted'
                        }`}
                      >
                        {preset.subtitle}
                      </p>
                    </button>
                    {preset.isCustom && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomPreset(preset.id)}
                        className="p-1 ml-1 opacity-75 hover:opacity-100"
                        title="Excluir preset customizado"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="space-y-1">
                <span className="text-[11px] vtt-muted">
                  Link de Imagem/Vídeo de Fundo 3D (opcional):
                </span>
                <input
                  type="text"
                  value={bgUrl.startsWith('idb://') ? '' : bgUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBgUrl(val);
                    setBgMediaId('');
                    setBgMediaKind(detectSceneMediaKind(val));
                  }}
                  placeholder="https://... ou use o botão Imagem / Vídeo 3D"
                  className="w-full px-2.5 py-1.5 border vtt-border vtt-surface text-xs"
                />
                {bgPreview && (
                  <p className="text-[10px] text-emerald-400 truncate">
                    ✓ Cenário de fundo pronto para projeção 3D
                  </p>
                )}
              </label>

              <label className="space-y-1">
                <span className="text-[11px] vtt-muted">
                  Música de Modo Duelo (Fade Automático):
                </span>
                <select
                  value={musicTrackId}
                  onChange={(e) => setMusicTrackId(e.target.value)}
                  className="w-full px-2.5 py-1.5 border vtt-border vtt-surface text-xs"
                >
                  <option value="">Manter música atual da cena</option>
                  {duelMusicTracks.length > 0 && (
                    <optgroup label="⚔️ Músicas de Modo Duelo (Combate)">
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
          <div className="border vtt-border vtt-canvas p-3 space-y-2.5">
            <p className="text-[11px] font-bold font-typewriter uppercase tracking-wider vtt-muted">
              Visão do Duelo na Tela de Visualização (TV) & Players
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCombatantNamesOnScreen}
                onChange={(e) => setShowCombatantNamesOnScreen(e.target.checked)}
              />
              <span>
                <strong>Exibir Nomes na Tela de Visualização e Players</strong>
                <span className="block text-[11px] vtt-muted">
                  Quando ativado, os nomes dos combatentes aparecem em destaque acima dos personagens.
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer pt-1.5 border-t vtt-border">
              <input
                type="checkbox"
                checked={showCombatInfoOnScreen}
                onChange={(e) => {
                  setShowCombatInfoOnScreen(e.target.checked);
                  if (e.target.checked) setShowCombatantNamesOnScreen(true);
                }}
              />
              <span>
                <strong>Exibir Informações de Vida (PV) e Status de Combate na Tela</strong>
                <span className="block text-[11px] vtt-muted">
                  Quando ativado, barras de vida, rodada, turno atual e resumo de combate aparecem na Tela de Visualização e Players.
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer pt-1.5 border-t vtt-border">
              <input
                type="checkbox"
                checked={!hidePlayerActionsOnScreen}
                onChange={(e) => setHidePlayerActionsOnScreen(!e.target.checked)}
              />
              <span>
                <strong>Exibir Menu de Ataques / Ações do Jogador na Tela</strong>
                <span className="block text-[11px] vtt-muted">
                  Desativado por padrão (arena limpa). Ative se quiser mostrar as opções de golpes na tela.
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

interface BloodParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  shade: string;
  mode: 'drop' | 'mist';
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
  const [renderedDuel, setRenderedDuel] = useState<ActiveDuelState | null>(duel);
  const [visibilityPhase, setVisibilityPhase] = useState<
    'hidden' | 'entering' | 'active' | 'exiting'
  >(duel ? 'active' : 'hidden');

  useEffect(() => {
    if (duel) {
      setRenderedDuel(duel);
      setVisibilityPhase((prev) =>
        prev === 'hidden' || prev === 'exiting' ? 'entering' : 'active'
      );
      const t = window.setTimeout(() => setVisibilityPhase('active'), 45);
      return () => window.clearTimeout(t);
    } else if (renderedDuel) {
      setOpenTopMenu('none');
      setStatusPopoverSide(null);
      setShowExtraSettings(false);
      setLiveCombo(null);
      comboTrackerRef.current = { targetSide: null, count: 0, lastHitMs: 0 };
      setVisibilityPhase('exiting');
      const t = window.setTimeout(() => {
        setVisibilityPhase('hidden');
        setRenderedDuel(null);
      }, 620);
      return () => window.clearTimeout(t);
    }
  }, [duel]);

  const [bgResolvedUrl, setBgResolvedUrl] = useState('');
  const [playerImgUrl, setPlayerImgUrl] = useState('');
  const [npcImgUrl, setNpcImgUrl] = useState('');
  const [playerCombatSpriteUrl, setPlayerCombatSpriteUrl] = useState('');
  const [npcCombatSpriteUrl, setNpcCombatSpriteUrl] = useState('');

  // Broad, universal cursor attack modes: Corte ('blade'), Impacto ('blunt'), Tiro ('shot'), Magia ('arcane')
  const [cursorMode, setCursorMode] = useState<DuelCursorAttackMode>('blade');
  // Optional active action sound armed for the next mouse attack
  const [armedActionSfx, setArmedActionSfx] = useState<{
    actionId: string;
    label: string;
    url?: string;
    mediaId?: string;
  } | null>(null);

  const [activeActionSideTab, setActiveActionSideTab] = useState<'player' | 'npc'>('player');
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [showAddCustomMove, setShowAddCustomMove] = useState(false);
  const [customMoveName, setCustomMoveName] = useState('');
  const [customMoveFormula, setCustomMoveFormula] = useState('1d20 + 5');
  const [customMoveDamage, setCustomMoveDamage] = useState('1d8 + 3');
  const [customMoveSfxUrl, setCustomMoveSfxUrl] = useState('');
  const [customMoveSfxMediaId, setCustomMoveSfxMediaId] = useState('');
  const [customMoveSfxFileName, setCustomMoveSfxFileName] = useState('');
  const [uploadingBg, setUploadingBg] = useState(false);

  // Per-action SFX editor popover in bottom dock
  const [editingActionSfxId, setEditingActionSfxId] = useState<string | null>(null);
  const [uploadingSfxKey, setUploadingSfxKey] = useState<string | null>(null);

  // Categorized collapsible top bar menus & Extra Settings drawer (GM only)
  const [openTopMenu, setOpenTopMenu] = useState<'none' | 'attack' | 'scene' | 'vision'>('none');
  const [showExtraSettings, setShowExtraSettings] = useState(false);

  // Global Attack SFX collapsible section inside Attack menu
  const [showAttackSfxPopover, setShowAttackSfxPopover] = useState(false);

  // Status tag quick-add popover per combatant (GM only)
  const [statusPopoverSide, setStatusPopoverSide] = useState<'player' | 'npc' | null>(null);
  const [customStatusLabel, setCustomStatusLabel] = useState('');
  const [customStatusTone, setCustomStatusTone] = useState<DuelStatusTagTone>('warning');

  // Synced Hack-and-Slash Combo Counter (auto-resets cleanly after 4s)
  const [liveCombo, setLiveCombo] = useState<{
    targetSide: 'player' | 'npc';
    count: number;
    hitKey: string;
    damageApplied?: number;
  } | null>(null);
  const comboTrackerRef = useRef<{
    targetSide: 'player' | 'npc' | null;
    count: number;
    lastHitMs: number;
  }>({ targetSide: null, count: 0, lastHitMs: 0 });
  const comboResetTimerRef = useRef<number | null>(null);

  // Manual HP custom delta inputs for GM
  const [manualPlayerDelta, setManualPlayerDelta] = useState<string>('5');
  const [manualNpcDelta, setManualNpcDelta] = useState<string>('5');

  // Live Custom Preset creator inside Scene menu (GM only)
  const [allPresets, setAllPresets] = useState(() => getAllDuelArenaPresets());
  const [showArenaCustomizer, setShowArenaCustomizer] = useState(false);
  const [liveCustomName, setLiveCustomName] = useState('');
  const [liveBgColor, setLiveBgColor] = useState('#1c1917');
  const [liveFloorColor, setLiveFloorColor] = useState('#292524');
  const [liveAccentColor, setLiveAccentColor] = useState('#d9a760');
  const [liveParticleKind, setLiveParticleKind] = useState<DuelParticleKind>('dust');

  // Subtle 3D Mouse Parallax
  const [mouseTilt, setMouseTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });
  const [arenaOuterSize, setArenaOuterSize] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720,
  });

  // Pre-established fixed 16:9 3D Duel Stage dimensions (1280 x 720) so browser Ctrl+Zoom never shifts characters or floor
  const DUEL_STAGE_WIDTH = 1280;
  const DUEL_STAGE_HEIGHT = 720;
  const duelStageScale = Math.max(
    0.2,
    Math.min(arenaOuterSize.width / DUEL_STAGE_WIDTH, arenaOuterSize.height / DUEL_STAGE_HEIGHT)
  );

  // Refs for 3D Combatant Hitboxes & Interactive FX Canvas
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const fixedDuelStageRef = useRef<HTMLDivElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerBoxRef = useRef<HTMLDivElement | null>(null);
  const npcBoxRef = useRef<HTMLDivElement | null>(null);

  const isPointerDownRef = useRef(false);
  const slashTrailRef = useRef<SlashTrailPoint[]>([]);
  const burstsRef = useRef<BurstParticle[]>([]);
  const bloodDropsRef = useRef<BloodParticle[]>([]);
  const damageSeverityRef = useRef<{ player: number; npc: number }>({ player: 0, npc: 0 });
  const lastSlashHitMsRef = useRef<Record<'player' | 'npc', number>>({ player: 0, npc: 0 });
  const lastProcessedEffectIdRef = useRef<string>('');

  // Close open duel popovers/drawers cleanly on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenTopMenu('none');
        setStatusPopoverSide(null);
        setShowExtraSettings(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (comboResetTimerRef.current) {
        window.clearTimeout(comboResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setArenaOuterSize({ width, height });
        }
      }
    });
    obs.observe(el);

    // Block accidental Ctrl+Wheel browser zoom inside the 3D Duel Arena so positioning stays 100% locked
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
  }, [visibilityPhase]);

  function getDuelStageCoords(clientX: number, clientY: number): {
    x: number;
    y: number;
    nx: number;
    ny: number;
  } {
    const rect = fixedDuelStageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: DUEL_STAGE_WIDTH / 2, y: DUEL_STAGE_HEIGHT / 2, nx: 0.5, ny: 0.5 };
    }
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return {
      x: nx * DUEL_STAGE_WIDTH,
      y: ny * DUEL_STAGE_HEIGHT,
      nx,
      ny,
    };
  }

  useEffect(() => {
    if (renderedDuel?.activeTurn) {
      setActiveActionSideTab(renderedDuel.activeTurn);
    }
  }, [renderedDuel?.activeTurn]);

  // Resolve Media URLs for 3D Background, Tokens, and Auto-Cropped Full-Body Combat PNG Sprites
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

    // Resolve and auto-trim full-body combat PNGs so they tightly fill 100% of their standee bounds
    const resolveCombatSprite = async (
      mediaId: string | undefined,
      url: string | undefined,
      setter: (v: string) => void
    ) => {
      if (!mediaId && !url) {
        if (active) setter('');
        return;
      }
      const resolved = await resolveMediaUrl(mediaId, url, campaignId);
      if (!active) return;
      if (!resolved) {
        setter('');
        return;
      }
      const trimmed = await trimTransparentSpriteUrl(resolved);
      if (active) setter(trimmed || resolved);
    };

    void resolveCombatSprite(
      renderedDuel.player.combatSpriteMediaId,
      renderedDuel.player.combatSpriteUrl,
      setPlayerCombatSpriteUrl
    );
    void resolveCombatSprite(
      renderedDuel.npc.combatSpriteMediaId,
      renderedDuel.npc.combatSpriteUrl,
      setNpcCombatSpriteUrl
    );

    return () => {
      active = false;
    };
  }, [
    renderedDuel?.bgMediaId,
    renderedDuel?.bgUrl,
    renderedDuel?.player.mediaId,
    renderedDuel?.player.imageUrl,
    renderedDuel?.player.combatSpriteMediaId,
    renderedDuel?.player.combatSpriteUrl,
    renderedDuel?.npc.mediaId,
    renderedDuel?.npc.imageUrl,
    renderedDuel?.npc.combatSpriteMediaId,
    renderedDuel?.npc.combatSpriteUrl,
    campaignId,
  ]);

  // Keep live progressive low-HP damage severity synced into a ref for the 60fps blood particle emitter
  useEffect(() => {
    if (!renderedDuel) {
      damageSeverityRef.current = { player: 0, npc: 0 };
      return;
    }
    const calcSeverity = (cur: number, max: number) => {
      const ratio = Math.max(0, Math.min(1, cur / Math.max(1, max)));
      return ratio < 0.6 ? Math.min(1, (0.6 - ratio) / 0.6) : 0;
    };
    damageSeverityRef.current = {
      player: calcSeverity(renderedDuel.player.hpCurrent, renderedDuel.player.hpMax),
      npc: calcSeverity(renderedDuel.npc.hpCurrent, renderedDuel.npc.hpMax),
    };
  }, [
    renderedDuel?.player.hpCurrent,
    renderedDuel?.player.hpMax,
    renderedDuel?.npc.hpCurrent,
    renderedDuel?.npc.hpMax,
  ]);

  // Replay incoming live reactive effects (Corte, Impacto, Tiro, Magia) on Shared TV & Mobile — WITHOUT exposing HP numbers!
  useEffect(() => {
    const eff = renderedDuel?.lastEffect;
    if (!eff || eff.id === lastProcessedEffectIdRef.current) return;
    lastProcessedEffectIdRef.current = eff.id;

    const fallbackTypeSfx =
      eff.kind === 'blade' || eff.kind === 'blunt' || eff.kind === 'shot' || eff.kind === 'arcane'
        ? renderedDuel?.attackSfxMap?.[eff.kind]
        : undefined;

    playCombatCursorSfx(eff.kind, {
      url: eff.sfxUrl || fallbackTypeSfx?.url,
      mediaId: eff.sfxMediaId || fallbackTypeSfx?.mediaId,
      campaignId,
    });

    const targetEl = eff.targetSide === 'player' ? playerBoxRef.current : npcBoxRef.current;
    const stageEl = fixedDuelStageRef.current;

    let cx = eff.targetSide === 'player' ? DUEL_STAGE_WIDTH * 0.24 : DUEL_STAGE_WIDTH * 0.76;
    let cy = DUEL_STAGE_HEIGHT * 0.54;
    if (targetEl && stageEl) {
      const sRect = stageEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      if (sRect.width > 0 && sRect.height > 0) {
        cx = ((tRect.left - sRect.left + tRect.width / 2) / sRect.width) * DUEL_STAGE_WIDTH;
        cy = ((tRect.top - sRect.top + tRect.height / 2) / sRect.height) * DUEL_STAGE_HEIGHT;
      }
    }

    if (eff.slashPoints && eff.slashPoints.length >= 2) {
      const now = performance.now();
      for (const pt of eff.slashPoints) {
        slashTrailRef.current.push({
          x: pt.x * DUEL_STAGE_WIDTH,
          y: pt.y * DUEL_STAGE_HEIGHT,
          createdAt: now,
        });
      }
    }

    spawnImpactParticles(cx, cy, eff.kind, undefined, eff.comboCount || 0);

    // Sync fiery combo indicator across GM, Shared TV Screen, and Player devices (auto-resets after 4s)
    const comboSettings = resolveDuelExtraSettings(renderedDuel?.extraSettings);
    if (comboSettings.comboEnabled && eff.comboCount && eff.comboCount >= 2) {
      setLiveCombo({
        targetSide: eff.comboTargetSide || eff.targetSide,
        count: eff.comboCount,
        hitKey: eff.id,
        damageApplied: eff.damageApplied,
      });
      if (comboResetTimerRef.current) {
        window.clearTimeout(comboResetTimerRef.current);
      }
      comboResetTimerRef.current = window.setTimeout(() => {
        setLiveCombo(null);
        comboTrackerRef.current = { targetSide: null, count: 0, lastHitMs: 0 };
      }, 4000);
    }
  }, [renderedDuel?.lastEffect, renderedDuel?.extraSettings, campaignId]);

  function spawnImpactParticles(
    cx: number,
    cy: number,
    kind: DuelLiveEffect['kind'],
    slashAngle?: number,
    comboCount = 0
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

    if (kind === 'blade' || kind === 'shot') {
      const ang = slashAngle ?? (kind === 'shot' ? 0 : -Math.PI / 4);
      const len = kind === 'shot' ? 85 : 120;
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

    const count = kind === 'blunt' ? 28 : 22;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 8.5;
      burstsRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.2 + Math.random() * 4.2,
        color: i % 3 === 0 ? '#ffffff' : mainColor,
        alpha: 1,
        kind: 'spark',
      });
    }

    // Rising fiery combo ember burst when chaining 4+ hits!
    if (comboCount >= 4) {
      const fireCount = Math.min(34, 10 + comboCount * 2);
      const fireColors = ['#fef08a', '#fb923c', '#f97316', '#ef4444'];
      for (let i = 0; i < fireCount; i++) {
        burstsRef.current.push({
          x: cx + (Math.random() - 0.5) * 90,
          y: cy + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 4.5,
          vy: -(3.2 + Math.random() * 7.5),
          size: 3 + Math.random() * 5,
          color: fireColors[i % fireColors.length],
          alpha: 1,
          kind: 'spark',
        });
      }
    }
  }

  // Continuous 60fps HTML5 2D Canvas Loop for Atmospheric Particles + Slash Trail + Impact Bursts
  useEffect(() => {
    if (visibilityPhase === 'hidden' || !renderedDuel) return;
    const canvas = fxCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const preset = getDuelArenaPreset(renderedDuel.arenaPreset, renderedDuel.customArenaStyle);
    let animId = 0;

    const particleCount = preset.particleKind === 'none' ? 0 : 42;
    const ambientParticles = Array.from({ length: particleCount }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      vx:
        preset.particleKind === 'leaves'
          ? 0.0008 + Math.random() * 0.0012
          : (Math.random() - 0.5) * 0.0008,
      vy:
        preset.particleKind === 'rain'
          ? 0.013 + Math.random() * 0.008
          : preset.particleKind === 'leaves'
            ? 0.0012 + Math.random() * 0.0015
            : -(0.0006 + Math.random() * 0.0014),
      size:
        preset.particleKind === 'lights'
          ? 2.2 + Math.random() * 3.8
          : 1.5 + Math.random() * 3.0,
      phase: Math.random() * Math.PI * 2,
    }));

    const renderFrame = (now: number) => {
      const w = DUEL_STAGE_WIDTH;
      const h = DUEL_STAGE_HEIGHT;
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
        } else if (preset.particleKind === 'sparks') {
          ctx.strokeStyle = preset.accentColor;
          ctx.globalAlpha = Math.max(0.1, Math.min(0.9, alpha));
          ctx.lineWidth = 1.6 * p.z;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.sin(p.phase) * 5, py - 7 * p.z);
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

      // 2. Active Mouse Corte (Blade Slash) Trail
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

          ctx.strokeStyle = preset.accentColor;
          ctx.globalAlpha = Math.max(0, ageRatio * 0.65);
          ctx.lineWidth = width * 2.1;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();

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
          b.vy += 0.22;
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

      // 4. Progressive Low-HP Blood Droplets & Crimson Mist Particles around wounded combatants
      const stageEl = fixedDuelStageRef.current;
      const stageRect = stageEl?.getBoundingClientRect();
      const severities = damageSeverityRef.current;
      const bloodShades = ['#dc2626', '#b91c1c', '#991b1b', '#ef4444', '#7f1d1d'];

      const spawnBloodForBox = (boxEl: HTMLDivElement | null, severity: number) => {
        if (!boxEl || !stageRect || stageRect.width <= 0 || stageRect.height <= 0) return;
        if (severity <= 0.04 || bloodDropsRef.current.length >= 72) return;
        const spawnChance = 0.08 + severity * 0.44;
        if (Math.random() > spawnChance) return;

        const r = boxEl.getBoundingClientRect();
        const relLeft = ((r.left - stageRect.left) / stageRect.width) * w;
        const relTop = ((r.top - stageRect.top) / stageRect.height) * h;
        const relW = (r.width / stageRect.width) * w;
        const relH = (r.height / stageRect.height) * h;

        // Focus droplets on the character silhouette area (upper ~78% of column)
        const sx = relLeft + relW * (0.2 + Math.random() * 0.6);
        const sy = relTop + relH * (0.14 + Math.random() * 0.62);
        const isMist = severity > 0.35 && Math.random() < 0.35;

        bloodDropsRef.current.push({
          x: sx,
          y: sy,
          vx: (Math.random() - 0.5) * (isMist ? 0.6 : 0.9),
          vy: isMist
            ? -(0.35 + Math.random() * 0.75)
            : 0.45 + Math.random() * (1.2 + severity * 1.4),
          size: isMist
            ? 3.2 + Math.random() * (4.5 + severity * 4)
            : 1.8 + Math.random() * (2.6 + severity * 2.4),
          alpha: (isMist ? 0.28 : 0.62) + severity * 0.34,
          decay: isMist ? 0.012 : 0.015 + Math.random() * 0.01,
          shade: bloodShades[Math.floor(Math.random() * bloodShades.length)],
          mode: isMist ? 'mist' : 'drop',
        });
      };

      spawnBloodForBox(playerBoxRef.current, severities.player);
      spawnBloodForBox(npcBoxRef.current, severities.npc);

      if (bloodDropsRef.current.length > 0) {
        const nextBlood: BloodParticle[] = [];
        for (const p of bloodDropsRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.mode === 'drop') {
            p.vy += 0.04;
          } else {
            p.size += 0.08;
          }
          p.alpha -= p.decay;
          if (p.alpha > 0.025) {
            ctx.save();
            ctx.fillStyle = p.shade;
            ctx.globalAlpha = Math.max(0, Math.min(0.95, p.alpha));
            ctx.beginPath();
            if (p.mode === 'drop') {
              // Subtle teardrop vertical stretch as blood falls
              ctx.ellipse(p.x, p.y, p.size * 0.78, p.size * 1.45, 0, 0, Math.PI * 2);
            } else {
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
            nextBlood.push(p);
          }
        }
        bloodDropsRef.current = nextBlood;
      }

      animId = window.requestAnimationFrame(renderFrame);
    };

    animId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animId);
  }, [visibilityPhase, renderedDuel?.arenaPreset, renderedDuel?.customArenaStyle]);

  if (visibilityPhase === 'hidden' || !renderedDuel) {
    return null;
  }

  const preset = getDuelArenaPreset(renderedDuel.arenaPreset, renderedDuel.customArenaStyle);
  const nowMs = Date.now();
  const playerHitActive =
    Boolean(renderedDuel.player.lastHitAtMs) &&
    nowMs - (renderedDuel.player.lastHitAtMs || 0) < 650;
  const npcHitActive =
    Boolean(renderedDuel.npc.lastHitAtMs) && nowMs - (renderedDuel.npc.lastHitAtMs || 0) < 650;

  const extraSettings = resolveDuelExtraSettings(renderedDuel.extraSettings);
  const layoutStyle = extraSettings.layoutStyle;

  function updateExtraSettings(next: DuelExtraSettings) {
    if (!renderedDuel || !onUpdateDuel) return;
    const saved = saveCampaignDuelExtraSettings(campaignId, next);
    if (!saved.comboEnabled) {
      setLiveCombo(null);
    }
    onUpdateDuel({
      ...renderedDuel,
      extraSettings: saved,
    });
  }

  // Trigger reactive visual + audio strike effect + optional editable HP deduction + synced combo counter!
  function triggerMouseReactiveStrike(
    targetSide: 'player' | 'npc',
    kind: 'blade' | 'blunt' | 'shot' | 'arcane',
    slashPoints?: Array<{ x: number; y: number }>
  ) {
    if (!renderedDuel || mode !== 'gm' || !onUpdateDuel) return;
    const target = targetSide === 'player' ? renderedDuel.player : renderedDuel.npc;
    const attackerSide = targetSide === 'player' ? 'npc' : 'player';
    const attacker = attackerSide === 'player' ? renderedDuel.player : renderedDuel.npc;
    const hitTime = Date.now();

    const effectLabels: Record<'blade' | 'blunt' | 'shot' | 'arcane', string> = {
      blade: 'Corte',
      blunt: 'Impacto',
      shot: 'Tiro',
      arcane: 'Magia',
    };

    // Combo progression within a 4-second window on the same target
    const prevCombo = comboTrackerRef.current;
    const isChainingSameTarget =
      prevCombo.targetSide === targetSide && hitTime - prevCombo.lastHitMs <= 4000;
    const nextComboCount = isChainingSameTarget ? prevCombo.count + 1 : 1;
    comboTrackerRef.current = {
      targetSide,
      count: nextComboCount,
      lastHitMs: hitTime,
    };

    // Optional fixed HP deduction per mouse attack (default 1 PV, editable)
    const dmgToApply = extraSettings.mouseAttackDamageEnabled
      ? Math.max(1, extraSettings.mouseAttackDamage)
      : 0;
    const nextHp =
      dmgToApply > 0 ? Math.max(0, target.hpCurrent - dmgToApply) : target.hpCurrent;

    // Resolve custom sound: first check if an individual action SFX was armed, otherwise check the attack type SFX map
    const typeCustomSfx =
      renderedDuel.attackSfxMap?.[kind] || loadCampaignAttackSfx(campaignId)[kind];
    const resolvedSfxUrl = armedActionSfx?.url || typeCustomSfx?.url;
    const resolvedSfxMediaId = armedActionSfx?.mediaId || typeCustomSfx?.mediaId;

    const effect: DuelLiveEffect = {
      id: `fx_${hitTime}_${Math.random().toString(36).slice(2, 6)}`,
      timestampMs: hitTime,
      targetSide,
      kind,
      damageApplied: dmgToApply > 0 ? dmgToApply : undefined,
      comboCount: extraSettings.comboEnabled ? nextComboCount : undefined,
      comboTargetSide: extraSettings.comboEnabled ? targetSide : undefined,
      label: armedActionSfx?.label || effectLabels[kind],
      slashPoints,
      sfxUrl: resolvedSfxUrl,
      sfxMediaId: resolvedSfxMediaId,
    };

    const updatedTarget: DuelCombatantState = {
      ...target,
      hpCurrent: nextHp,
      lastHitAtMs: hitTime,
    };

    const updatedAttacker: DuelCombatantState = {
      ...attacker,
      lastLungeAtMs: hitTime,
    };

    const comboSuffix =
      extraSettings.comboEnabled && nextComboCount >= 2 ? ` · ${nextComboCount}× COMBO!` : '';
    const dmgSuffix = dmgToApply > 0 ? ` (-${dmgToApply} PV)` : '';

    const nextDuel: ActiveDuelState = {
      ...renderedDuel,
      player: targetSide === 'player' ? updatedTarget : updatedAttacker,
      npc: targetSide === 'npc' ? updatedTarget : updatedAttacker,
      lastEffect: effect,
      lastActionSummary: `${armedActionSfx?.label || effectLabels[kind]} em ${target.name}${dmgSuffix}${comboSuffix}`,
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
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && targetEl.closest('button, input, select, label, form, [data-gm-ui="true"]')) {
      return;
    }

    const { x, y } = getDuelStageCoords(e.clientX, e.clientY);

    isPointerDownRef.current = true;

    if (cursorMode === 'blade') {
      slashTrailRef.current = [{ x, y, createdAt: performance.now() }];
      return;
    }

    if (cursorMode === 'blunt' || cursorMode === 'shot' || cursorMode === 'arcane') {
      const hitSide = checkPointerHitsCombatant(e.clientX, e.clientY);
      if (hitSide) {
        triggerMouseReactiveStrike(hitSide, cursorMode);
      } else {
        const typeCustomSfx =
          renderedDuel?.attackSfxMap?.[cursorMode] ||
          loadCampaignAttackSfx(campaignId)[cursorMode];
        playCombatCursorSfx(cursorMode, {
          url: armedActionSfx?.url || typeCustomSfx?.url,
          mediaId: armedActionSfx?.mediaId || typeCustomSfx?.mediaId,
          campaignId,
        });
        spawnImpactParticles(x, y, cursorMode);
      }
    }
  }

  function handleArenaPointerMove(e: React.PointerEvent) {
    const { x, y, nx, ny } = getDuelStageCoords(e.clientX, e.clientY);

    setMouseTilt({
      rx: Number(((0.5 - ny) * 4.5).toFixed(2)),
      ry: Number(((nx - 0.5) * 7.5).toFixed(2)),
    });

    if (mode !== 'gm' || !isPointerDownRef.current || cursorMode !== 'blade') return;

    const now = performance.now();
    slashTrailRef.current.push({ x, y, createdAt: now });

    const hitSide = checkPointerHitsCombatant(e.clientX, e.clientY);
    if (hitSide && Date.now() - lastSlashHitMsRef.current[hitSide] > 340) {
      lastSlashHitMsRef.current[hitSide] = Date.now();
      const recentNormalized = slashTrailRef.current.slice(-10).map((pt) => ({
        x: Number((pt.x / DUEL_STAGE_WIDTH).toFixed(3)),
        y: Number((pt.y / DUEL_STAGE_HEIGHT).toFixed(3)),
      }));
      triggerMouseReactiveStrike(hitSide, 'blade', recentNormalized);
    }
  }

  function handleArenaPointerUp() {
    isPointerDownRef.current = false;
  }

  // Silent manual HP adjustment for the GM (invisible to players, does NOT trigger damage animations)
  function setCombatantHpManual(side: 'player' | 'npc', nextCurrent: number, nextMax?: number) {
    if (!renderedDuel || !onUpdateDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const resolvedMax = Math.max(1, nextMax !== undefined ? nextMax : target.hpMax);
    const resolvedCur = Math.max(0, Math.min(resolvedMax, Math.round(nextCurrent)));

    const updated: DuelCombatantState = {
      ...target,
      hpCurrent: resolvedCur,
      hpMax: resolvedMax,
    };

    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
    });
  }

  function adjustCombatantHpSilent(side: 'player' | 'npc', delta: number) {
    if (!renderedDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    setCombatantHpManual(side, target.hpCurrent + delta);
  }

  // Secondary Resource (MP / Sanidade / Energia) manual controls
  function setCombatantMpManual(side: 'player' | 'npc', nextCurrent: number, nextMax?: number) {
    if (!renderedDuel || !onUpdateDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const resolvedMax = Math.max(1, nextMax !== undefined ? nextMax : target.mpMax ?? 10);
    const resolvedCur = Math.max(0, Math.min(resolvedMax, Math.round(nextCurrent)));
    const updated: DuelCombatantState = {
      ...target,
      mpCurrent: resolvedCur,
      mpMax: resolvedMax,
      mpLabel: extraSettings.secondaryResourceLabel || target.mpLabel || 'MP',
    };
    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
    });
  }

  function adjustCombatantMp(side: 'player' | 'npc', delta: number) {
    if (!renderedDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    setCombatantMpManual(side, (target.mpCurrent ?? target.mpMax ?? 10) + delta);
  }

  // Status & Condition Tags controls
  function addCombatantStatusTag(
    side: 'player' | 'npc',
    label: string,
    tone: DuelStatusTagTone
  ) {
    if (!renderedDuel || !onUpdateDuel) return;
    const clean = label.trim().slice(0, 28);
    if (!clean) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const existing = target.statusTags || [];
    if (existing.some((t) => t.label.toLowerCase() === clean.toLowerCase())) return;
    const nextTag: DuelStatusTag = {
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      label: clean,
      tone,
    };
    const updated: DuelCombatantState = {
      ...target,
      statusTags: [...existing.slice(-7), nextTag],
    };
    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
    });
  }

  function removeCombatantStatusTag(side: 'player' | 'npc', tagId: string) {
    if (!renderedDuel || !onUpdateDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const updated: DuelCombatantState = {
      ...target,
      statusTags: (target.statusTags || []).filter((t) => t.id !== tagId),
    };
    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updated : renderedDuel.player,
      npc: side === 'npc' ? updated : renderedDuel.npc,
    });
  }

  async function handleUploadCustomMoveSfx(file: File | undefined) {
    if (!file || !uploadContext) return;
    setUploadingSfxKey('new_move');
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'audio',
      });
      setCustomMoveSfxUrl(res.url);
      setCustomMoveSfxMediaId(res.mediaId);
      setCustomMoveSfxFileName(res.fileName);
      onNotify?.(`Som "${res.fileName}" anexado à nova ação.`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao anexar áudio.');
    } finally {
      setUploadingSfxKey(null);
    }
  }

  function handleAddQuickAction(e: React.FormEvent) {
    e.preventDefault();
    if (!renderedDuel || !onUpdateDuel || !customMoveName.trim()) return;
    const side = activeActionSideTab;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const newAction: DuelActionItem = {
      id: `custom_${Date.now().toString(36)}`,
      label: customMoveName.trim(),
      category: 'attack',
      formula: customMoveFormula.trim() || '1d20',
      damageFormula: customMoveDamage.trim() || undefined,
      damageLabel: 'Dano',
      description: `Fórmula: ${customMoveFormula}`,
      sourceLabel: 'Customizado',
      sfxUrl: customMoveSfxUrl.trim() || undefined,
      sfxMediaId: customMoveSfxMediaId || undefined,
      sfxFileName: customMoveSfxFileName || undefined,
    };

    if (newAction.sfxUrl || newAction.sfxMediaId) {
      const normKey = newAction.label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      saveActionCustomSfx(campaignId, `${target.tokenId}_${normKey}`, {
        url: newAction.sfxUrl || '',
        mediaId: newAction.sfxMediaId,
        fileName: newAction.sfxFileName,
      });
    }

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
    setCustomMoveSfxUrl('');
    setCustomMoveSfxMediaId('');
    setCustomMoveSfxFileName('');
    setShowAddCustomMove(false);
    onNotify?.(`Ação "${newAction.label}" adicionada a ${target.name}.`);
  }

  async function handleUpdateActionSfx(
    side: 'player' | 'npc',
    action: DuelActionItem,
    entry: DuelCustomSfxEntry | null
  ) {
    if (!renderedDuel || !onUpdateDuel) return;
    const target = side === 'player' ? renderedDuel.player : renderedDuel.npc;
    const normKey = action.label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    saveActionCustomSfx(campaignId, `${target.tokenId}_${normKey}`, entry);

    const updatedActions = target.actions.map((a) =>
      a.id === action.id
        ? {
            ...a,
            sfxUrl: entry?.url || undefined,
            sfxMediaId: entry?.mediaId || undefined,
            sfxFileName: entry?.fileName || undefined,
          }
        : a
    );

    const updatedCombatant: DuelCombatantState = {
      ...target,
      actions: updatedActions,
    };

    onUpdateDuel({
      ...renderedDuel,
      player: side === 'player' ? updatedCombatant : renderedDuel.player,
      npc: side === 'npc' ? updatedCombatant : renderedDuel.npc,
    });
  }

  async function handleUploadActionSfxFile(
    side: 'player' | 'npc',
    action: DuelActionItem,
    file: File | undefined
  ) {
    if (!file || !uploadContext) return;
    setUploadingSfxKey(action.id);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'audio',
      });
      await handleUpdateActionSfx(side, action, {
        url: res.url,
        mediaId: res.mediaId,
        fileName: res.fileName,
      });
      setArmedActionSfx({
        actionId: action.id,
        label: action.label,
        url: res.url,
        mediaId: res.mediaId,
      });
      onNotify?.(`Som "${res.fileName}" vinculado ao ataque "${action.label}".`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar áudio do ataque.');
    } finally {
      setUploadingSfxKey(null);
    }
  }

  async function handleUploadGlobalAttackTypeSfx(
    kind: 'blade' | 'blunt' | 'shot' | 'arcane',
    file: File | undefined
  ) {
    if (!file || !uploadContext || !renderedDuel || !onUpdateDuel) return;
    setUploadingSfxKey(kind);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'audio',
      });
      const currentMap = renderedDuel.attackSfxMap || loadCampaignAttackSfx(campaignId);
      const nextMap: DuelAttackSfxMap = {
        ...currentMap,
        [kind]: {
          url: res.url,
          mediaId: res.mediaId,
          fileName: res.fileName,
        },
      };
      saveCampaignAttackSfx(campaignId, nextMap);
      onUpdateDuel({
        ...renderedDuel,
        attackSfxMap: nextMap,
      });
      onNotify?.(`Som "${res.fileName}" vinculado a ${kind === 'blade' ? 'Corte' : kind === 'blunt' ? 'Impacto' : kind === 'shot' ? 'Tiro' : 'Magia'}.`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar som de ataque.');
    } finally {
      setUploadingSfxKey(null);
    }
  }

  function handleSetGlobalAttackTypeSfxUrl(
    kind: 'blade' | 'blunt' | 'shot' | 'arcane',
    url: string
  ) {
    if (!renderedDuel || !onUpdateDuel) return;
    const currentMap = renderedDuel.attackSfxMap || loadCampaignAttackSfx(campaignId);
    const nextMap: DuelAttackSfxMap = { ...currentMap };
    const trimmed = url.trim();
    if (!trimmed) {
      delete nextMap[kind];
    } else {
      nextMap[kind] = { url: trimmed, mediaId: '', fileName: '' };
    }
    saveCampaignAttackSfx(campaignId, nextMap);
    onUpdateDuel({
      ...renderedDuel,
      attackSfxMap: nextMap,
    });
  }

  function handleSaveLiveCustomPreset() {
    if (!renderedDuel || !onUpdateDuel) return;
    const created: CustomDuelArenaPreset = {
      id: `custom_${Date.now().toString(36)}`,
      name: liveCustomName.trim() || `Preset ${allPresets.length + 1}`,
      bgColor: liveBgColor,
      floorColor: liveFloorColor,
      accentColor: liveAccentColor,
      particleKind: liveParticleKind,
    };
    saveCustomDuelPreset(created);
    setAllPresets(getAllDuelArenaPresets());
    onUpdateDuel({
      ...renderedDuel,
      arenaPreset: created.id,
      customArenaStyle: created,
    });
    setLiveCustomName('');
    setShowArenaCustomizer(false);
    onNotify?.(`Preset "${created.name}" aplicado na arena 3D.`);
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
      onNotify?.(`Fundo 3D atualizado com "${res.fileName}".`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao atualizar fundo 3D.');
    } finally {
      setUploadingBg(false);
    }
  }

  // Dynamic Turn-Based 3D Camera Perspective — WITHOUT clipping either character through the floor!
  const effectiveCamera = renderedDuel.cameraAngle;
  const isPlayerTurn = renderedDuel.activeTurn === 'player';

  let camRotateX = 4 + mouseTilt.rx * 0.6;
  let camRotateY = mouseTilt.ry * 0.65;
  let camRotateZ = 0;
  let camTranslateX = 0;
  let camScale = 1;

  if (effectiveCamera === 'dynamic') {
    if (isPlayerTurn) {
      camRotateY = 14 + mouseTilt.ry * 0.6;
      camRotateX = 4.5 + mouseTilt.rx * 0.55;
      camRotateZ = 1.1;
      camTranslateX = 36;
    } else {
      camRotateY = -14 + mouseTilt.ry * 0.6;
      camRotateX = 4.5 + mouseTilt.rx * 0.55;
      camRotateZ = -1.1;
      camTranslateX = -36;
    }
  } else if (effectiveCamera === 'stadium') {
    camRotateX = 7 + mouseTilt.rx * 0.5;
    camRotateY = (isPlayerTurn ? 11 : -11) + mouseTilt.ry * 0.5;
    camScale = 0.96;
  } else if (effectiveCamera === 'showdown') {
    camRotateX = 2 + mouseTilt.rx * 0.4;
    camRotateY = mouseTilt.ry * 0.4;
    camScale = 1.03;
  } else if (effectiveCamera === 'focus_player') {
    camRotateY = 17;
    camRotateZ = 1.2;
    camTranslateX = 110;
    camScale = 1.08;
  } else if (effectiveCamera === 'focus_npc') {
    camRotateY = -17;
    camRotateZ = -1.2;
    camTranslateX = -110;
    camScale = 1.08;
  }

  const playerLungeActive =
    Boolean(renderedDuel.player.lastLungeAtMs) &&
    nowMs - (renderedDuel.player.lastLungeAtMs || 0) < 520;
  const npcLungeActive =
    Boolean(renderedDuel.npc.lastLungeAtMs) &&
    nowMs - (renderedDuel.npc.lastLungeAtMs || 0) < 520;

  // Both characters stand on the EXACT SAME floor surface height (anchored from their bottom base `transformOrigin: '50% 100%'`),
  // so neither character ever drops below the floor plane!
  const playerScale = isPlayerTurn ? 1.07 : 0.94;
  const playerRotY = isPlayerTurn ? 10 : 15;

  const npcScale = !isPlayerTurn ? 1.07 : 0.94;
  const npcRotY = !isPlayerTurn ? -10 : -15;

  const resolvedMediaKind =
    renderedDuel.bgMediaKind || detectSceneMediaKind(renderedDuel.bgUrl || bgResolvedUrl);

  const showBottomCommandDock =
    mode === 'gm' || !renderedDuel.hidePlayerActionsOnScreen;

  // Names above characters: always visible to GM, and visible to Players/TV when showCombatantNamesOnScreen OR showCombatInfoOnScreen is enabled
  const shouldShowNamesAboveTokens =
    mode === 'gm' ||
    Boolean(renderedDuel.showCombatantNamesOnScreen) ||
    Boolean(renderedDuel.showCombatInfoOnScreen);

  // Public HP & Combat Info on Visualization (TV) & Player screens when enabled by GM
  const shouldShowPublicCombatInfo =
    mode !== 'gm' && Boolean(renderedDuel.showCombatInfoOnScreen);

  const cursorStyle =
    mode !== 'gm'
      ? 'cursor-default'
      : cursorMode === 'blade' || cursorMode === 'shot'
        ? 'cursor-crosshair'
        : 'cursor-pointer';

  const currentAttackSfxMap =
    renderedDuel.attackSfxMap || loadCampaignAttackSfx(campaignId);

  // Seamless zoom transition scale & opacity when turning Duel Mode ON or OFF
  const transitionStageScale =
    visibilityPhase === 'entering'
      ? duelStageScale * 0.76
      : visibilityPhase === 'exiting'
        ? duelStageScale * 1.24
        : duelStageScale;

  const activeCursorMeta =
    CURSOR_ATTACK_TYPES.find((c) => c.id === cursorMode) || CURSOR_ATTACK_TYPES[0];
  const ActiveCursorIcon = activeCursorMeta.icon;

  const isMedieval = layoutStyle === 'medieval';
  const isStylized = layoutStyle === 'stylized';

  const statusToneStyle = (tone: DuelStatusTagTone) => {
    if (isMedieval) {
      if (tone === 'danger') return 'bg-red-950/90 border-red-700/80 text-red-100';
      if (tone === 'warning') return 'bg-amber-950/90 border-amber-700/80 text-amber-100';
      if (tone === 'buff') return 'bg-emerald-950/90 border-emerald-700/80 text-emerald-100';
      return 'bg-sky-950/90 border-sky-700/80 text-sky-100';
    }
    if (isStylized) {
      if (tone === 'danger') return 'bg-red-600 border-stone-950 text-white font-black';
      if (tone === 'warning') return 'bg-amber-400 border-stone-950 text-stone-950 font-black';
      if (tone === 'buff') return 'bg-emerald-400 border-stone-950 text-stone-950 font-black';
      return 'bg-sky-400 border-stone-950 text-stone-950 font-black';
    }
    if (tone === 'danger') return 'bg-red-950/85 border-red-700/70 text-red-200';
    if (tone === 'warning') return 'bg-amber-950/85 border-amber-700/70 text-amber-200';
    if (tone === 'buff') return 'bg-emerald-950/85 border-emerald-700/70 text-emerald-200';
    return 'bg-sky-950/85 border-sky-700/70 text-sky-200';
  };

  const renderCombatantColumn = (side: 'player' | 'npc') => {
    const isPlayerSide = side === 'player';
    const combatant = isPlayerSide ? renderedDuel.player : renderedDuel.npc;
    const isActiveTurn = isPlayerSide ? isPlayerTurn : !isPlayerTurn;
    const isLunge = isPlayerSide ? playerLungeActive : npcLungeActive;
    const isHit = isPlayerSide ? playerHitActive : npcHitActive;
    const imgUrl = isPlayerSide ? playerImgUrl : npcImgUrl;
    const combatSpriteUrl = isPlayerSide ? playerCombatSpriteUrl : npcCombatSpriteUrl;
    const hasCombatSprite = Boolean(combatSpriteUrl);
    const scale = isPlayerSide ? playerScale : npcScale;
    const rotY = isPlayerSide ? playerRotY : npcRotY;
    const manualDelta = isPlayerSide ? manualPlayerDelta : manualNpcDelta;
    const setManualDelta = isPlayerSide ? setManualPlayerDelta : setManualNpcDelta;
    const sideAccent = isPlayerSide ? 'var(--accent-primary)' : '#ef4444';
    const hpBarColor = isPlayerSide ? 'bg-emerald-500' : 'bg-red-600';
    const hpTextColor = isPlayerSide ? 'text-emerald-400' : 'text-red-400';
    const hpRatio = Math.max(0, Math.min(1, combatant.hpCurrent / Math.max(1, combatant.hpMax)));
    const damageSeverity = hpRatio < 0.6 ? Math.min(1, (0.6 - hpRatio) / 0.6) : 0;
    const isDefeated = combatant.hpCurrent <= 0;
    const mpCur = combatant.mpCurrent ?? 10;
    const mpMax = Math.max(1, combatant.mpMax ?? 10);
    const mpLabel = extraSettings.secondaryResourceLabel || combatant.mpLabel || 'MP';
    const statusTags = combatant.statusTags || [];
    const showTagsForViewer =
      extraSettings.showStatusTags &&
      (mode === 'gm' || shouldShowPublicCombatInfo || shouldShowNamesAboveTokens);

    const hasComboHere =
      extraSettings.comboEnabled && liveCombo && liveCombo.targetSide === side;

    return (
      <div
        ref={isPlayerSide ? playerBoxRef : npcBoxRef}
        className={`absolute ${
          isPlayerSide ? 'left-[135px]' : 'right-[135px]'
        } bottom-[175px] w-64 flex flex-col items-center pointer-events-auto`}
        style={{
          transformOrigin: '50% 100%',
          transform: `translate3d(${
            isLunge
              ? isPlayerSide
                ? '85px'
                : '-85px'
              : isHit
                ? isPlayerSide
                  ? '-32px'
                  : '32px'
                : '0px'
          }, ${isLunge ? '-16px' : '0px'}, 0px) rotateY(${rotY}deg) scale(${scale})`,
          transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Fiery Hack-and-Slash Combo Pop-up right in front of the target receiving hits */}
        {hasComboHere && (
          <DuelComboPop
            comboCount={liveCombo.count}
            hitKey={liveCombo.hitKey}
            layoutStyle={layoutStyle}
            damageApplied={liveCombo.damageApplied}
            showDamageNumber={mode === 'gm' || shouldShowPublicCombatInfo}
            side={side}
          />
        )}

        {/* Theme-Adaptive Nameplate Above Character */}
        {shouldShowNamesAboveTokens && (
          <div className="mb-2 max-w-full flex flex-col items-center gap-1 z-20">
            {isStylized ? (
              <div
                className="px-3.5 py-1 border-2 border-stone-950 flex items-center gap-1.5 max-w-full"
                style={{
                  backgroundColor: isActiveTurn ? 'var(--accent-primary)' : '#09090b',
                  color: isActiveTurn ? 'var(--accent-contrast)' : '#fafaf9',
                  transform: 'skewX(-12deg)',
                  boxShadow: isActiveTurn
                    ? '4px 4px 0 #09090b'
                    : '4px 4px 0 var(--accent-primary)',
                }}
              >
                <span
                  className="font-duel-stylized-display text-sm font-black italic uppercase tracking-tight truncate"
                  style={{ transform: 'skewX(12deg)' }}
                >
                  {isActiveTurn ? '▸ ' : ''}
                  {combatant.name}
                </span>
              </div>
            ) : isMedieval ? (
              <div
                className="duel-medieval-panel px-3 py-1 flex items-center gap-2 max-w-full"
                style={{
                  borderColor: isActiveTurn ? 'var(--accent-primary)' : 'rgba(180,152,108,0.45)',
                }}
              >
                <span
                  className="duel-medieval-plaque w-5 h-5 flex items-center justify-center shrink-0 text-[10px] font-bold"
                  aria-hidden="true"
                >
                  {isPlayerSide ? '✦' : '⚔'}
                </span>
                <span className="font-duel-medieval-display text-base font-bold tracking-wider text-amber-100 truncate">
                  {combatant.name}
                </span>
              </div>
            ) : (
              <div
                className="px-3 py-1 text-xs font-bold font-typewriter tracking-wide border bg-stone-950/90 shadow-lg flex items-center gap-1.5 max-w-full"
                style={{
                  borderColor: isActiveTurn
                    ? isPlayerSide
                      ? preset.accentColor
                      : '#ef4444'
                    : 'rgba(120,113,108,0.6)',
                  color: isActiveTurn
                    ? isPlayerSide
                      ? preset.accentColor
                      : '#f87171'
                    : '#f5f5f4',
                }}
              >
                {isActiveTurn && <span className="text-[10px]">◆</span>}
                <span className="truncate">{combatant.name}</span>
              </div>
            )}

            {/* Status & Condition Tags Strip (synced when enabled) */}
            {showTagsForViewer && statusTags.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1 max-w-[260px]">
                {statusTags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`px-2 py-0.5 text-[10px] border leading-none flex items-center gap-1 ${statusToneStyle(
                      tag.tone
                    )} ${
                      isStylized
                        ? '-skew-x-10 uppercase tracking-tight shadow-[2px_2px_0_#09090b]'
                        : isMedieval
                          ? 'font-duel-medieval-body tracking-wide'
                          : 'font-medium'
                    }`}
                  >
                    <span className={isStylized ? 'skew-x-10' : ''}>{tag.label}</span>
                    {mode === 'gm' && (
                      <button
                        type="button"
                        data-gm-ui="true"
                        onClick={() => removeCombatantStatusTag(side, tag.id)}
                        className="ml-0.5 opacity-75 hover:opacity-100 font-bold"
                        title={`Remover condição ${tag.label}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* COMBATANT VISUAL: Persona-Style Full-Body Cutout Standee (when combat PNG is set) OR Classic Framed Token */}
        {hasCombatSprite ? (
          <>
            <div
              className={`relative w-[290px] h-[335px] flex items-end justify-center transition-transform duration-200 ${
                isHit
                  ? isPlayerSide
                    ? '-rotate-3 scale-[1.03]'
                    : 'rotate-3 scale-[1.03]'
                  : ''
              }`}
            >
              {/* Subtle Organic Persona Idle Breathing Wrapper (anchored at bottom feet) */}
              <div
                className={`relative h-full w-full flex items-end justify-center ${
                  isDefeated
                    ? 'opacity-70 grayscale-[0.45]'
                    : isPlayerSide
                      ? 'duel-sprite-idle-player'
                      : 'duel-sprite-idle-npc'
                }`}
              >
                <div className="relative h-full max-w-full flex items-end justify-center">
                  <img
                    src={combatSpriteUrl}
                    alt={combatant.name}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="h-full max-w-[290px] w-auto object-contain object-bottom select-none pointer-events-none"
                    style={{
                      filter: isHit
                        ? 'brightness(1.35) contrast(1.12) drop-shadow(0 0 24px rgba(239,68,68,0.95)) drop-shadow(0 18px 26px rgba(0,0,0,0.88))'
                        : `saturate(${(1 - damageSeverity * 0.25).toFixed(2)}) drop-shadow(0 18px 24px rgba(0,0,0,0.88)) drop-shadow(0 0 ${
                            isActiveTurn ? 18 : 10
                          }px ${
                            damageSeverity > 0.35
                              ? `rgba(220, 20, 35, ${(0.35 + damageSeverity * 0.55).toFixed(2)})`
                              : isActiveTurn
                                ? isPlayerSide
                                  ? preset.ambientGlow
                                  : 'rgba(239,68,68,0.45)'
                                : 'rgba(0,0,0,0.45)'
                          })`,
                    }}
                  />

                  {/* Progressive Low-HP Crimson Filter STRICTLY Masked to the Character Silhouette (Zero Box Artifact!) */}
                  {damageSeverity > 0.02 && (
                    <div
                      className={`absolute inset-0 pointer-events-none ${
                        damageSeverity > 0.45 ? 'duel-injured-pulse' : ''
                      }`}
                      style={
                        {
                          '--duel-dmg-alpha': String(
                            Math.min(0.76, 0.14 + damageSeverity * 0.62)
                          ),
                          opacity: Math.min(0.76, 0.14 + damageSeverity * 0.62),
                          background: `linear-gradient(to top, rgba(165, 8, 20, 0.96) 0%, rgba(215, 22, 34, 0.78) 54%, rgba(125, 6, 16, 0.48) 100%)`,
                          mixBlendMode: 'multiply',
                          WebkitMaskImage: `url("${combatSpriteUrl}")`,
                          maskImage: `url("${combatSpriteUrl}")`,
                          WebkitMaskSize: 'contain',
                          maskSize: 'contain',
                          WebkitMaskPosition: 'bottom center',
                          maskPosition: 'bottom center',
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                        } as React.CSSProperties
                      }
                    />
                  )}

                  {/* Silhouette-Masked Hit Impact Flash */}
                  {isHit && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: 'rgba(239, 68, 68, 0.52)',
                        mixBlendMode: 'screen',
                        WebkitMaskImage: `url("${combatSpriteUrl}")`,
                        maskImage: `url("${combatSpriteUrl}")`,
                        WebkitMaskSize: 'contain',
                        maskSize: 'contain',
                        WebkitMaskPosition: 'bottom center',
                        maskPosition: 'bottom center',
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Grounded Persona-Style Floor Contact Shadow + Turn Rim Glow (Flush Under Feet) */}
            <div
              className="w-60 h-8 -mt-4 rounded-full pointer-events-none"
              style={{
                background:
                  damageSeverity > 0.5
                    ? `radial-gradient(ellipse at center, rgba(153, 27, 27, 0.65) 0%, rgba(0,0,0,0.88) 58%, transparent 80%)`
                    : isActiveTurn
                      ? isPlayerSide
                        ? `radial-gradient(ellipse at center, ${preset.ambientGlow} 0%, rgba(0,0,0,0.86) 55%, transparent 78%)`
                        : 'radial-gradient(ellipse at center, rgba(220,38,38,0.48) 0%, rgba(0,0,0,0.88) 55%, transparent 78%)'
                      : 'radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 55%, transparent 78%)',
                border: isActiveTurn
                  ? `1px solid ${isPlayerSide ? preset.accentColor : 'rgba(239,68,68,0.65)'}`
                  : '1px solid transparent',
                transform: 'rotateX(70deg)',
                boxShadow: '0 10px 26px rgba(0,0,0,0.9)',
              }}
            />
          </>
        ) : (
          <>
            {/* Classic Framed 3D Token Standee Card (Unchanged when no Full-Body PNG is set) */}
            <div
              className={`relative w-52 h-52 overflow-hidden bg-stone-900 flex items-center justify-center transition-all duration-200 ${
                isStylized
                  ? 'rounded-none border-[3px] border-white'
                  : isMedieval
                    ? 'rounded-sm border-2'
                    : 'rounded-2xl border-2'
              } ${
                isHit
                  ? isPlayerSide
                    ? 'ring-4 ring-red-500 brightness-125 -rotate-3'
                    : 'ring-4 ring-red-500 brightness-125 rotate-3'
                  : ''
              }`}
              style={{
                borderColor:
                  damageSeverity > 0.65
                    ? '#dc2626'
                    : isStylized
                      ? '#fafaf9'
                      : isActiveTurn
                        ? isPlayerSide
                          ? preset.accentColor
                          : '#ef4444'
                        : combatant.color,
                boxShadow: isHit
                  ? '0 0 44px 12px rgba(239, 68, 68, 0.9), 0 22px 40px rgba(0,0,0,0.9)'
                  : damageSeverity > 0.35
                    ? `0 22px 44px rgba(0,0,0,0.92), 0 0 ${Math.round(
                        24 + damageSeverity * 28
                      )}px rgba(220, 20, 35, ${(0.3 + damageSeverity * 0.55).toFixed(2)})`
                    : isStylized
                      ? `8px 8px 0 ${isActiveTurn ? sideAccent : '#27272a'}, 14px 14px 0 rgba(0,0,0,0.82)`
                      : isMedieval
                        ? `inset 0 0 0 2px rgba(235,214,174,0.28), 0 22px 44px rgba(0,0,0,0.92), 0 0 28px ${
                            isPlayerSide ? preset.ambientGlow : 'rgba(220,38,38,0.28)'
                          }`
                        : `0 22px 44px rgba(0,0,0,0.9), 0 0 28px ${
                            isPlayerSide ? preset.ambientGlow : 'rgba(220, 38, 38, 0.28)'
                          }`,
              }}
            >
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={combatant.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  style={
                    damageSeverity > 0.1
                      ? {
                          filter: `saturate(${(1 - damageSeverity * 0.35).toFixed(2)}) contrast(${(
                            1 +
                            damageSeverity * 0.12
                          ).toFixed(2)})`,
                        }
                      : undefined
                  }
                />
              ) : (
                <span
                  className={`text-4xl font-bold text-stone-200 ${
                    isMedieval
                      ? 'font-duel-medieval-display'
                      : isStylized
                        ? 'font-duel-stylized-display italic'
                        : 'font-typewriter'
                  }`}
                >
                  {combatant.name.slice(0, 2).toUpperCase()}
                </span>
              )}

              {/* Progressive Low-HP Crimson Blood Filter on Normal Token */}
              {damageSeverity > 0.02 && (
                <>
                  <div
                    className={`absolute inset-0 pointer-events-none ${
                      damageSeverity > 0.45 ? 'duel-injured-pulse' : ''
                    }`}
                    style={
                      {
                        '--duel-dmg-alpha': String(Math.min(0.82, 0.16 + damageSeverity * 0.66)),
                        opacity: Math.min(0.82, 0.16 + damageSeverity * 0.66),
                        background: `radial-gradient(ellipse at 50% 44%, rgba(190, 18, 28, ${(
                          0.22 +
                          damageSeverity * 0.36
                        ).toFixed(2)}) 0%, rgba(155, 8, 18, ${(
                          0.55 +
                          damageSeverity * 0.38
                        ).toFixed(2)}) 66%, rgba(88, 4, 12, 0.96) 100%)`,
                        mixBlendMode: 'multiply',
                      } as React.CSSProperties
                    }
                  />
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      boxShadow: `inset 0 0 ${Math.round(
                        16 + damageSeverity * 42
                      )}px rgba(220, 20, 35, ${(0.28 + damageSeverity * 0.64).toFixed(2)})`,
                    }}
                  />
                </>
              )}

              {/* Medieval ornamental corner filigree brackets */}
              {isMedieval && (
                <>
                  <span className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-amber-200/75 pointer-events-none" />
                  <span className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-amber-200/75 pointer-events-none" />
                  <span className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-amber-200/75 pointer-events-none" />
                  <span className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-amber-200/75 pointer-events-none" />
                </>
              )}

              {isHit && <div className="absolute inset-0 bg-red-600/40 pointer-events-none" />}
            </div>

            {/* 3D Grounded Pedestal Disc resting flush on the floor surface */}
            <div
              className="w-56 h-7 -mt-3 rounded-full border"
              style={{
                borderColor:
                  damageSeverity > 0.6
                    ? 'rgba(220,38,38,0.85)'
                    : isPlayerSide
                      ? preset.accentColor
                      : 'rgba(239,68,68,0.65)',
                background: isPlayerSide
                  ? `radial-gradient(ellipse at center, ${preset.ambientGlow} 0%, rgba(0,0,0,0.92) 75%)`
                  : 'radial-gradient(ellipse at center, rgba(220,38,38,0.32) 0%, rgba(0,0,0,0.92) 75%)',
                transform: 'rotateX(65deg)',
                boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
              }}
            />
          </>
        )}

        {/* PUBLIC Visualization / Player Vida (PV) + Optional Secondary Resource Box */}
        {shouldShowPublicCombatInfo && (
          <div
            className={`absolute top-full mt-1.5 w-full p-2.5 shadow-2xl space-y-1.5 z-30 pointer-events-none ${
              isStylized
                ? 'duel-stylized-panel'
                : isMedieval
                  ? 'duel-medieval-panel'
                  : `bg-stone-950/92 border ${
                      isPlayerSide ? 'border-emerald-700/80' : 'border-red-800/80'
                    }`
            }`}
          >
            <div className={isStylized ? 'duel-stylized-unskew space-y-1.5' : 'space-y-1.5'}>
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={`text-xs font-bold text-stone-100 truncate ${
                    isMedieval
                      ? 'font-duel-medieval-display text-sm tracking-wide text-amber-100'
                      : isStylized
                        ? 'font-duel-stylized-display italic uppercase tracking-tight'
                        : 'font-typewriter'
                  }`}
                >
                  {combatant.name}
                </span>
                <span className={`text-xs font-bold tabular-nums ${hpTextColor}`}>
                  {combatant.hpCurrent}/{combatant.hpMax} PV
                </span>
              </div>
              <div className="w-full h-2 bg-stone-800 overflow-hidden">
                <div
                  className={`h-full ${hpBarColor} transition-all duration-300`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, (combatant.hpCurrent / Math.max(1, combatant.hpMax)) * 100)
                    )}%`,
                  }}
                />
              </div>

              {extraSettings.showSecondaryResource && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center justify-between text-[10px] tabular-nums">
                    <span className="text-sky-300 font-semibold uppercase tracking-wider">
                      {mpLabel}
                    </span>
                    <span className="text-sky-200 font-bold">
                      {mpCur}/{mpMax}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-stone-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-300"
                      style={{
                        width: `${Math.max(0, Math.min(100, (mpCur / mpMax) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* GM-ONLY Manual Vida (PV) + Optional Secondary Resource + Optional Status Tag Controls */}
        {mode === 'gm' && (
          <div
            data-gm-ui="true"
            className={`absolute top-full mt-1.5 w-full p-2 shadow-2xl space-y-1.5 z-30 ${
              isStylized
                ? 'duel-stylized-panel'
                : isMedieval
                  ? 'duel-medieval-panel'
                  : 'bg-stone-950/95 border border-stone-700/90'
            }`}
          >
            <div className={isStylized ? 'duel-stylized-unskew space-y-1.5' : 'space-y-1.5'}>
              {/* Name + Direct PV Inputs */}
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={`truncate font-bold ${
                    isMedieval
                      ? 'font-duel-medieval-display text-sm text-amber-100'
                      : isStylized
                        ? 'font-duel-stylized-display text-xs italic uppercase'
                        : 'text-[11px] font-typewriter'
                  }`}
                >
                  {combatant.name}
                </span>
                <div className={`flex items-center gap-1 text-xs font-bold tabular-nums ${hpTextColor}`}>
                  <input
                    type="number"
                    value={combatant.hpCurrent}
                    onChange={(e) => setCombatantHpManual(side, Number(e.target.value))}
                    className={`w-11 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 ${
                      isPlayerSide ? 'text-emerald-300' : 'text-red-300'
                    }`}
                    title="Editar vida atual diretamente"
                  />
                  <span>/</span>
                  <input
                    type="number"
                    value={combatant.hpMax}
                    onChange={(e) =>
                      setCombatantHpManual(side, combatant.hpCurrent, Number(e.target.value))
                    }
                    className="w-11 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                    title="Editar vida máxima"
                  />
                  <span className="text-[10px] text-stone-400">PV</span>
                </div>
              </div>

              {/* PV Progress Bar */}
              <div className="w-full h-1.5 bg-stone-800 overflow-hidden">
                <div
                  className={`h-full ${hpBarColor} transition-all duration-200`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, (combatant.hpCurrent / Math.max(1, combatant.hpMax)) * 100)
                    )}%`,
                  }}
                />
              </div>

              {/* Quick PV Stepper Buttons */}
              <div className="flex items-center justify-between gap-1 text-[10px]">
                <div className="flex items-center gap-0.5">
                  {([-10, -5, -1, 1, 5] as const).map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => adjustCombatantHpSilent(side, delta)}
                      className={`px-1.5 py-0.5 border tabular-nums ${
                        delta < 0
                          ? 'bg-red-950/90 border-red-800/80 text-red-200 hover:bg-red-900'
                          : 'bg-emerald-950/90 border-emerald-800/80 text-emerald-200 hover:bg-emerald-900'
                      }`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min={1}
                    value={manualDelta}
                    onChange={(e) => setManualDelta(e.target.value)}
                    className="w-9 px-1 py-0.5 bg-stone-900 border border-stone-700 text-center text-stone-200 tabular-nums"
                    title="Valor personalizado de vida"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      adjustCombatantHpSilent(side, -Math.max(1, Number(manualDelta) || 1))
                    }
                    className="px-1.5 py-0.5 bg-red-800 hover:bg-red-700 text-white font-bold"
                    title="Tirar esse valor da vida"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      adjustCombatantHpSilent(side, Math.max(1, Number(manualDelta) || 1))
                    }
                    className="px-1.5 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-white font-bold"
                    title="Somar esse valor na vida"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Optional Module: Secondary Resource Bar (MP / Sanidade / PE / Energia) */}
              {extraSettings.showSecondaryResource && (
                <div className="pt-1.5 border-t border-stone-800 space-y-1">
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <span className="font-semibold text-sky-300 truncate max-w-[85px]">
                      {mpLabel}
                    </span>
                    <div className="flex items-center gap-1 tabular-nums">
                      <button
                        type="button"
                        onClick={() => adjustCombatantMp(side, -1)}
                        className="px-1.5 py-0.5 bg-stone-900 border border-stone-700 text-stone-200 hover:bg-stone-800"
                      >
                        -1
                      </button>
                      <input
                        type="number"
                        value={mpCur}
                        onChange={(e) => setCombatantMpManual(side, Number(e.target.value))}
                        className="w-10 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 text-sky-300 font-bold"
                      />
                      <span className="text-stone-500">/</span>
                      <input
                        type="number"
                        value={mpMax}
                        onChange={(e) => setCombatantMpManual(side, mpCur, Number(e.target.value))}
                        className="w-10 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                      />
                      <button
                        type="button"
                        onClick={() => adjustCombatantMp(side, 1)}
                        className="px-1.5 py-0.5 bg-stone-900 border border-stone-700 text-stone-200 hover:bg-stone-800"
                      >
                        +1
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-1 bg-stone-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-200"
                      style={{
                        width: `${Math.max(0, Math.min(100, (mpCur / mpMax) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Optional Module: Status & Condition Tag Manager */}
              {extraSettings.showStatusTags && (
                <div className="relative pt-1 border-t border-stone-800 flex items-center justify-between gap-1">
                  <span className="text-[10px] text-stone-400">
                    Condições ({statusTags.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStatusPopoverSide(statusPopoverSide === side ? null : side)
                    }
                    className="px-2 py-0.5 text-[10px] bg-stone-900 border border-stone-700 hover:border-amber-500 text-amber-300 flex items-center gap-1"
                  >
                    <ShieldAlert className="w-2.5 h-2.5" />
                    <span>+ Status</span>
                  </button>

                  {statusPopoverSide === side && (
                    <div className="absolute left-0 bottom-7 w-64 bg-stone-950 border border-stone-700 p-2.5 shadow-2xl space-y-2 z-50">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold font-typewriter">
                          Condições · {combatant.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setStatusPopoverSide(null)}
                          className="text-stone-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {DUEL_STATUS_PRESETS.map((st) => (
                          <button
                            key={st.label}
                            type="button"
                            onClick={() => addCombatantStatusTag(side, st.label, st.tone)}
                            className={`px-1.5 py-0.5 text-[10px] border hover:brightness-110 ${statusToneStyle(
                              st.tone
                            )}`}
                          >
                            + {st.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 pt-1 border-t border-stone-800">
                        <input
                          type="text"
                          value={customStatusLabel}
                          onChange={(e) => setCustomStatusLabel(e.target.value)}
                          placeholder="Status livre..."
                          className="flex-1 min-w-0 px-1.5 py-1 bg-stone-900 border border-stone-700 text-[10px]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCombatantStatusTag(side, customStatusLabel, customStatusTone);
                              setCustomStatusLabel('');
                            }
                          }}
                        />
                        <select
                          value={customStatusTone}
                          onChange={(e) =>
                            setCustomStatusTone(e.target.value as DuelStatusTagTone)
                          }
                          className="px-1 py-1 bg-stone-900 border border-stone-700 text-[10px]"
                        >
                          <option value="danger">Dano</option>
                          <option value="warning">Alerta</option>
                          <option value="info">Neutro</option>
                          <option value="buff">Bônus</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            addCombatantStatusTag(side, customStatusLabel, customStatusTone);
                            setCustomStatusLabel('');
                          }}
                          className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold text-[10px]"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={arenaRef}
      onPointerDown={handleArenaPointerDown}
      onPointerMove={handleArenaPointerMove}
      onPointerUp={handleArenaPointerUp}
      onPointerCancel={handleArenaPointerUp}
      style={{
        transition: 'opacity 580ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className={`absolute inset-0 z-40 overflow-hidden select-none touch-none bg-stone-950 text-stone-100 ${cursorStyle} ${
        visibilityPhase === 'entering' || visibilityPhase === 'exiting'
          ? 'opacity-0'
          : 'opacity-100'
      }`}
    >
      {/* PRE-ESTABLISHED FIXED 1280x720 3D DUEL STAGE (Immune to Browser Ctrl+Zoom + Seamless Zoom In/Out!) */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
        <div
          ref={fixedDuelStageRef}
          style={{
            width: `${DUEL_STAGE_WIDTH}px`,
            height: `${DUEL_STAGE_HEIGHT}px`,
            transform: `scale(${transitionStageScale})`,
            transformOrigin: 'center center',
            transition: 'transform 620ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="relative overflow-hidden shrink-0 pointer-events-auto"
        >
          {/* Theme-Specific Subtle Stage Accents */}
          {isStylized && (
            <div
              className="absolute inset-0 pointer-events-none z-12 duel-stylized-stripes opacity-45"
              aria-hidden="true"
            />
          )}
          {isMedieval && (
            <div
              className="absolute inset-4 pointer-events-none z-12 border border-amber-200/20"
              style={{
                boxShadow: 'inset 0 0 80px rgba(0,0,0,0.45)',
              }}
              aria-hidden="true"
            />
          )}

          {/* Public Combat Banner on Visualization (TV) & Player screens when showCombatInfoOnScreen is active */}
          {shouldShowPublicCombatInfo && (
            <div
              className={`absolute top-5 left-1/2 -translate-x-1/2 z-30 px-5 py-2 shadow-2xl flex flex-col items-center gap-0.5 pointer-events-none min-w-[340px] ${
                isStylized
                  ? 'duel-stylized-accent-slab'
                  : isMedieval
                    ? 'duel-medieval-panel'
                    : 'bg-stone-950/92 border border-stone-700/90'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${
                  isStylized
                    ? 'duel-stylized-unskew font-duel-stylized-display italic'
                    : isMedieval
                      ? 'font-duel-medieval-display text-sm tracking-[0.18em]'
                      : 'font-typewriter'
                }`}
              >
                <span className={isStylized ? 'opacity-90' : 'text-stone-400'}>
                  Rodada {renderedDuel.round}
                </span>
                <span className="opacity-50">·</span>
                <span
                  style={{
                    color: isStylized
                      ? 'var(--accent-contrast)'
                      : isPlayerTurn
                        ? preset.accentColor
                        : '#f87171',
                  }}
                >
                  Turno de {isPlayerTurn ? renderedDuel.player.name : renderedDuel.npc.name}
                </span>
              </div>
              {renderedDuel.lastActionSummary && (
                <p
                  className={`text-[11px] truncate max-w-[440px] ${
                    isStylized
                      ? 'duel-stylized-unskew font-duel-stylized-display font-semibold opacity-95'
                      : isMedieval
                        ? 'font-duel-medieval-body text-amber-100/85'
                        : 'text-stone-300 font-typewriter'
                  }`}
                >
                  {renderedDuel.lastActionSummary}
                </p>
              )}
            </div>
          )}

          {/* LAYER 1 (z-10): 3D Environment Layer (Skybox Cyclorama + Tilted 3D Arena Floor Plane) */}
          <div
            className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
            style={{
              perspective: '1050px',
              perspectiveOrigin: isPlayerTurn ? '46% 48%' : '54% 48%',
              transition: 'perspective-origin 820ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div
              className="relative w-full h-full"
              style={{
                transform: `translate3d(${camTranslateX * 0.7}px, 0px, 0px) rotateX(${camRotateX}deg) rotateY(${camRotateY}deg) rotateZ(${camRotateZ}deg) scale(${camScale})`,
                transition: 'transform 820ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Skybox / Custom Scene Duel Background */}
              <div
                className="absolute inset-[-16%] overflow-hidden"
                style={{
                  background: preset.skyGradient,
                }}
              >
                {bgResolvedUrl && (
                  <div className="w-full h-full relative opacity-60">
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
                          'linear-gradient(to bottom, rgba(7,6,6,0.28) 0%, rgba(7,6,6,0.18) 50%, rgba(7,6,6,0.95) 100%)',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* 3D Ground Surface Plane */}
              <div
                className="absolute left-1/2 top-[52%] w-[2400px] h-[680px] -translate-x-1/2"
                style={{
                  transformOrigin: '50% 0%',
                  transform: 'perspective(900px) rotateX(66deg)',
                  background: preset.floorGradient,
                  boxShadow: `0 0 140px 20px ${preset.ambientGlow} inset, 0 -2px 24px ${preset.ambientGlow}`,
                  borderTop: `1px solid ${preset.floorGridColor}`,
                }}
              >
                <div
                  className="w-full h-full opacity-80"
                  style={{
                    backgroundImage: `
                      radial-gradient(circle at 50% 34%, transparent 16%, ${preset.floorGridColor} 16.5%, transparent 17.5%),
                      radial-gradient(circle at 50% 34%, transparent 32%, ${preset.floorGridColor} 32.5%, transparent 33.5%),
                      linear-gradient(to right, ${preset.floorGridColor} 1px, transparent 1px),
                      linear-gradient(to bottom, ${preset.floorGridColor} 1px, transparent 1px)
                    `,
                    backgroundSize: '100% 100%, 100% 100%, 74px 74px, 74px 74px',
                  }}
                />
              </div>

              {/* Volumetric Rim Spotlight Beams shifting dynamically with active turn */}
              <div
                className="absolute inset-0 pointer-events-none transition-all duration-700"
                style={{
                  background: `radial-gradient(circle at ${
                    isPlayerTurn ? '26% 58%' : '74% 58%'
                  }, ${preset.ambientGlow} 0%, transparent 56%)`,
                }}
              />
            </div>
          </div>

          {/* LAYER 2 (z-15): 3D Combatant Standees Layer */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-15"
            style={{
              perspective: '1050px',
              perspectiveOrigin: isPlayerTurn ? '46% 52%' : '54% 52%',
              transition: 'perspective-origin 820ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div
              className="relative w-full h-full max-w-[1152px] mx-auto px-6"
              style={{
                transformStyle: 'preserve-3d',
                transform: `translate3d(${camTranslateX}px, 0px, 0px) rotateX(${camRotateX * 0.45}deg) rotateY(${camRotateY}deg) rotateZ(${camRotateZ}deg) scale(${camScale})`,
                transition: 'transform 820ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {renderCombatantColumn('player')}
              {renderCombatantColumn('npc')}
            </div>
          </div>

          {/* LAYER 3 (z-20): Interactive 2D FX Canvas Overlay (Particles + Slash + Shockwaves + Combo Embers) */}
          <canvas
            ref={fxCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
          />
        </div>
      </div>

      {/* LAYER 4 (z-40): GM-ONLY Decluttered Categorized Top Combat Configuration Bar */}
      {mode === 'gm' && onUpdateDuel && (
        <header
          data-gm-ui="true"
          className={`relative z-40 px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 backdrop-blur-md shadow-xl ${
            isMedieval
              ? 'duel-medieval-panel border-b'
              : isStylized
                ? 'bg-stone-950/96 border-b-2 border-white'
                : 'bg-stone-950/95 border-stone-800'
          }`}
        >
          {/* ZONE 1: Core Turn Progression */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-2.5 py-1 text-xs font-bold whitespace-nowrap truncate max-w-[200px] ${
                isStylized
                  ? 'duel-stylized-accent-slab font-duel-stylized-display italic uppercase'
                  : isMedieval
                    ? 'duel-medieval-plaque font-duel-medieval-display text-sm tracking-wide'
                    : 'font-typewriter uppercase tracking-wider border'
              }`}
              style={
                !isStylized && !isMedieval
                  ? { borderColor: preset.accentColor, color: preset.accentColor }
                  : undefined
              }
            >
              <span className={isStylized ? 'duel-stylized-unskew inline-block' : ''}>
                R{renderedDuel.round} · {isPlayerTurn ? renderedDuel.player.name : renderedDuel.npc.name}
              </span>
            </span>

            <button
              type="button"
              onClick={() => {
                const nextTurn = isPlayerTurn ? 'npc' : 'player';
                const nextRound = nextTurn === 'player' ? renderedDuel.round + 1 : renderedDuel.round;
                onUpdateDuel({
                  ...renderedDuel,
                  activeTurn: nextTurn,
                  round: nextRound,
                  lastActionSummary: `Turno de ${
                    nextTurn === 'player' ? renderedDuel.player.name : renderedDuel.npc.name
                  }`,
                });
              }}
              className={`px-3 py-1 text-xs font-bold whitespace-nowrap shrink-0 transition-transform active:scale-95 ${
                isStylized
                  ? 'bg-white text-stone-950 border-2 border-stone-950 shadow-[3px_3px_0_var(--accent-primary)] font-duel-stylized-display italic uppercase'
                  : isMedieval
                    ? 'bg-amber-700 hover:bg-amber-600 text-amber-50 border border-amber-300/40 font-duel-medieval-body'
                    : 'bg-amber-600 hover:bg-amber-500 text-stone-950'
              }`}
              title="Alterna o turno e gira a perspectiva 3D da câmera"
            >
              Próximo Turno ➔
            </button>

            {armedActionSfx && (
              <span className="hidden lg:inline-flex px-2 py-0.5 text-[11px] bg-amber-950/90 border border-amber-600 text-amber-200 items-center gap-1 whitespace-nowrap">
                <Volume2 className="w-3 h-3" />
                {armedActionSfx.label}
                <button
                  type="button"
                  onClick={() => setArmedActionSfx(null)}
                  className="ml-1 hover:text-white"
                  title="Voltar ao som padrão do tipo de ataque"
                >
                  ×
                </button>
              </span>
            )}
          </div>

          {/* ZONE 2: Collapsible Category Dropdowns with Expand/Collapse Arrows */}
          <div className="flex items-center gap-1.5 text-xs">
            {/* CATEGORY 1: ATAQUE MOUSE (Type + Editable PV Damage + Collapsible Sons MP3) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenTopMenu((cur) => (cur === 'attack' ? 'none' : 'attack'))
                }
                className={`px-2.5 py-1.5 border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  openTopMenu === 'attack'
                    ? 'bg-stone-800 border-amber-500 text-white font-semibold'
                    : 'bg-stone-900/90 border-stone-700 text-stone-200 hover:bg-stone-800'
                }`}
                title="Tipo de ataque com mouse, dano por clique e sons MP3"
              >
                <span
                  className={
                    isMedieval
                      ? 'duel-medieval-plaque w-4 h-4 flex items-center justify-center'
                      : 'inline-flex'
                  }
                >
                  <ActiveCursorIcon className="w-3 h-3" />
                </span>
                <span>{activeCursorMeta.label}</span>
                {extraSettings.mouseAttackDamageEnabled && (
                  <span className="text-[10px] text-red-300 font-mono tabular-nums">
                    -{extraSettings.mouseAttackDamage}PV
                  </span>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-stone-400 transition-transform ${
                    openTopMenu === 'attack' ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {openTopMenu === 'attack' && (
                <div className="absolute left-0 top-10 w-80 bg-stone-950 border border-stone-700 p-3 shadow-2xl space-y-3 z-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter">
                      Ataque com Mouse
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenTopMenu('none')}
                      className="text-stone-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 4-Way Cursor Attack Type Selector */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setCursorMode(id)}
                        className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 transition-colors ${
                          cursorMode === id
                            ? 'bg-red-700 border-red-500 text-white font-semibold'
                            : 'bg-stone-900 border-stone-700 text-stone-300 hover:bg-stone-800'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Editable Mouse-Attack HP Damage Control (Default 1 PV) */}
                  <div className="p-2.5 bg-stone-900/80 border border-stone-800 space-y-2">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-[11px] font-semibold text-stone-200">
                        Tirar vida ao atacar com mouse
                      </span>
                      <input
                        type="checkbox"
                        checked={extraSettings.mouseAttackDamageEnabled}
                        onChange={(e) =>
                          updateExtraSettings({
                            ...extraSettings,
                            mouseAttackDamageEnabled: e.target.checked,
                          })
                        }
                      />
                    </label>
                    <div
                      className={`flex items-center justify-between gap-2 ${
                        extraSettings.mouseAttackDamageEnabled
                          ? ''
                          : 'opacity-45 pointer-events-none'
                      }`}
                    >
                      <span className="text-[11px] text-stone-400">Dano por golpe:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateExtraSettings({
                              ...extraSettings,
                              mouseAttackDamage: Math.max(1, extraSettings.mouseAttackDamage - 1),
                            })
                          }
                          className="w-6 h-6 bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={extraSettings.mouseAttackDamage}
                          onChange={(e) =>
                            updateExtraSettings({
                              ...extraSettings,
                              mouseAttackDamage: Math.max(
                                1,
                                Math.min(999, Math.round(Number(e.target.value) || 1))
                              ),
                            })
                          }
                          className="w-12 h-6 px-1 text-center bg-stone-950 border border-stone-700 text-red-300 font-bold tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateExtraSettings({
                              ...extraSettings,
                              mouseAttackDamage: Math.min(999, extraSettings.mouseAttackDamage + 1),
                            })
                          }
                          className="w-6 h-6 bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold"
                        >
                          +
                        </button>
                        <span className="text-[10px] text-stone-400 ml-0.5">PV</span>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Sub-Category: Custom Attack SFX (MP3/Link) */}
                  <div className="border-t border-stone-800 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAttackSfxPopover((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-semibold text-amber-300 hover:text-amber-200 py-1"
                    >
                      <span className="flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5" />
                        Sons de Ataque (MP3 / Link)
                      </span>
                      {showAttackSfxPopover ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {showAttackSfxPopover && (
                      <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                        {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => {
                          const entry = currentAttackSfxMap[id];
                          return (
                            <div
                              key={id}
                              className="border border-stone-800 bg-stone-900/90 p-2 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold font-typewriter flex items-center gap-1.5">
                                  <Icon className="w-3 h-3 text-amber-400" />
                                  {label}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playCombatCursorSfx(id, {
                                        url: entry?.url,
                                        mediaId: entry?.mediaId,
                                        campaignId,
                                      })
                                    }
                                    className="px-1.5 py-0.5 text-[10px] bg-stone-800 hover:bg-stone-700 border border-stone-700 flex items-center gap-1"
                                  >
                                    <Play className="w-2.5 h-2.5" />
                                    Ouvir
                                  </button>
                                  {uploadContext && (
                                    <label className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-600 hover:bg-amber-500 text-stone-950 cursor-pointer flex items-center gap-1">
                                      <Upload className="w-2.5 h-2.5" />
                                      <span>{uploadingSfxKey === id ? '...' : 'MP3'}</span>
                                      <input
                                        type="file"
                                        accept="audio/*"
                                        className="hidden"
                                        disabled={uploadingSfxKey === id}
                                        onChange={(e) => {
                                          void handleUploadGlobalAttackTypeSfx(
                                            id,
                                            e.target.files?.[0]
                                          );
                                          e.target.value = '';
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>
                              <input
                                type="text"
                                value={entry?.url?.startsWith('idb://') ? '' : entry?.url || ''}
                                onChange={(e) =>
                                  handleSetGlobalAttackTypeSfxUrl(id, e.target.value)
                                }
                                placeholder={
                                  entry?.fileName
                                    ? `MP3: ${entry.fileName}`
                                    : 'Ou cole link https://...mp3'
                                }
                                className="w-full px-2 py-1 bg-stone-950 border border-stone-700 text-[10px]"
                              />
                              {entry && (entry.url || entry.mediaId) && (
                                <div className="flex items-center justify-between text-[10px] text-emerald-400">
                                  <span className="truncate">
                                    ✓ {entry.fileName || 'Link de áudio ativo'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSetGlobalAttackTypeSfxUrl(id, '')}
                                    className="text-stone-400 hover:text-red-400 underline ml-2"
                                  >
                                    Resetar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* CATEGORY 2: CENÁRIO & CÂMERA (Perspective + Color/Particle Preset + Fundo 3D Upload) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenTopMenu((cur) => (cur === 'scene' ? 'none' : 'scene'))
                }
                className={`px-2.5 py-1.5 border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  openTopMenu === 'scene'
                    ? 'bg-stone-800 border-amber-500 text-white font-semibold'
                    : 'bg-stone-900/90 border-stone-700 text-stone-200 hover:bg-stone-800'
                }`}
                title="Perspectiva 3D, cores de fundo, partículas e imagem/vídeo da arena"
              >
                <span
                  className={
                    isMedieval
                      ? 'duel-medieval-plaque w-4 h-4 flex items-center justify-center'
                      : 'inline-flex'
                  }
                >
                  <Camera className="w-3 h-3" />
                </span>
                <span className="hidden sm:inline">Cenário</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-stone-400 transition-transform ${
                    openTopMenu === 'scene' ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {openTopMenu === 'scene' && (
                <div className="absolute right-0 top-10 w-80 bg-stone-950 border border-stone-700 p-3 shadow-2xl space-y-3 z-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter">
                      Cenário & Câmera 3D
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenTopMenu('none')}
                      className="text-stone-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Camera Angle */}
                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-400">Perspectiva da Câmera:</span>
                    <select
                      value={renderedDuel.cameraAngle}
                      onChange={(e) =>
                        onUpdateDuel({
                          ...renderedDuel,
                          cameraAngle: e.target.value as DuelCameraAngle,
                        })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-stone-900 border border-stone-700 text-stone-200"
                    >
                      <option value="dynamic">Dinâmica (Segue o Turno)</option>
                      <option value="stadium">Arena Diagonal</option>
                      <option value="showdown">Frontal</option>
                      <option value="focus_player">Foco em {renderedDuel.player.name}</option>
                      <option value="focus_npc">Foco em {renderedDuel.npc.name}</option>
                    </select>
                  </label>

                  {/* Color & Particle Preset */}
                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-400">Cores & Partículas:</span>
                    <select
                      value={renderedDuel.arenaPreset}
                      onChange={(e) => {
                        const nextId = e.target.value as DuelArenaPresetId;
                        const savedCustom =
                          loadCustomDuelPresets().find((p) => p.id === nextId) || null;
                        onUpdateDuel({
                          ...renderedDuel,
                          arenaPreset: nextId,
                          customArenaStyle: savedCustom,
                        });
                      }}
                      className="w-full px-2 py-1.5 text-xs bg-stone-900 border border-stone-700 text-stone-200"
                    >
                      {allPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Quick Upload 3D Background Image/Video */}
                  {uploadContext && (
                    <label className="w-full px-2.5 py-1.5 text-xs bg-stone-900 border border-stone-700 hover:bg-stone-800 cursor-pointer flex items-center justify-center gap-1.5">
                      <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {uploadingBg ? 'Enviando fundo...' : 'Trocar Imagem / Vídeo 3D'}
                      </span>
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

                  {/* Collapsible Sub-Category: Custom Preset Creator */}
                  <div className="border-t border-stone-800 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowArenaCustomizer((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-semibold text-amber-300 hover:text-amber-200 py-1"
                    >
                      <span className="flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5" />
                        Criar Preset Customizado
                      </span>
                      {showArenaCustomizer ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {showArenaCustomizer && (
                      <div className="mt-2 space-y-2 bg-stone-900/70 p-2 border border-stone-800">
                        <input
                          type="text"
                          value={liveCustomName}
                          onChange={(e) => setLiveCustomName(e.target.value)}
                          placeholder="Nome (ex: Cinza · Faíscas)"
                          className="w-full px-2 py-1 bg-stone-950 border border-stone-700 text-xs"
                        />
                        <select
                          value={liveParticleKind}
                          onChange={(e) =>
                            setLiveParticleKind(e.target.value as DuelParticleKind)
                          }
                          className="w-full px-2 py-1 bg-stone-950 border border-stone-700 text-xs"
                        >
                          {DUEL_PARTICLE_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              Partículas: {o.label}
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <label className="space-y-1">
                            <span className="text-stone-400 block">Fundo</span>
                            <input
                              type="color"
                              value={liveBgColor}
                              onChange={(e) => setLiveBgColor(e.target.value)}
                              className="w-full h-6 bg-transparent border border-stone-700 cursor-pointer"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-stone-400 block">Chão</span>
                            <input
                              type="color"
                              value={liveFloorColor}
                              onChange={(e) => setLiveFloorColor(e.target.value)}
                              className="w-full h-6 bg-transparent border border-stone-700 cursor-pointer"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-stone-400 block">Partículas</span>
                            <input
                              type="color"
                              value={liveAccentColor}
                              onChange={(e) => setLiveAccentColor(e.target.value)}
                              className="w-full h-6 bg-transparent border border-stone-700 cursor-pointer"
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={handleSaveLiveCustomPreset}
                          className="w-full py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-stone-950"
                        >
                          Salvar e Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* CATEGORY 3: VISÃO PLAYERS (Nomes · Vida & Combate · Golpes) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenTopMenu((cur) => (cur === 'vision' ? 'none' : 'vision'))
                }
                className={`px-2.5 py-1.5 border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  openTopMenu === 'vision'
                    ? 'bg-stone-800 border-amber-500 text-white font-semibold'
                    : 'bg-stone-900/90 border-stone-700 text-stone-200 hover:bg-stone-800'
                }`}
                title="O que aparece na Tela de Visualização (TV) e nos celulares dos jogadores"
              >
                <span
                  className={
                    isMedieval
                      ? 'duel-medieval-plaque w-4 h-4 flex items-center justify-center'
                      : 'inline-flex'
                  }
                >
                  <Eye className="w-3 h-3" />
                </span>
                <span className="hidden sm:inline">Visão Players</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-stone-400 transition-transform ${
                    openTopMenu === 'vision' ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {openTopMenu === 'vision' && (
                <div className="absolute right-0 top-10 w-72 bg-stone-950 border border-stone-700 p-3 shadow-2xl space-y-2.5 z-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter">
                      Visível para Players / TV
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenTopMenu('none')}
                      className="text-stone-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDuel({
                        ...renderedDuel,
                        showCombatantNamesOnScreen: !renderedDuel.showCombatantNamesOnScreen,
                      })
                    }
                    className={`w-full px-2.5 py-2 border text-left flex items-center justify-between gap-2 ${
                      renderedDuel.showCombatantNamesOnScreen ||
                      renderedDuel.showCombatInfoOnScreen
                        ? 'bg-emerald-950/70 border-emerald-600 text-emerald-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <Tag className="w-3.5 h-3.5" />
                      Exibir Nomes
                    </span>
                    <span className="text-[10px] font-bold uppercase">
                      {renderedDuel.showCombatantNamesOnScreen ||
                      renderedDuel.showCombatInfoOnScreen
                        ? 'Ativo'
                        : 'Oculto'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDuel({
                        ...renderedDuel,
                        showCombatInfoOnScreen: !renderedDuel.showCombatInfoOnScreen,
                        showCombatantNamesOnScreen: !renderedDuel.showCombatInfoOnScreen
                          ? true
                          : renderedDuel.showCombatantNamesOnScreen,
                      })
                    }
                    className={`w-full px-2.5 py-2 border text-left flex items-center justify-between gap-2 ${
                      renderedDuel.showCombatInfoOnScreen
                        ? 'bg-emerald-950/70 border-emerald-600 text-emerald-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <HeartPulse className="w-3.5 h-3.5" />
                      Barras de Vida & Turno
                    </span>
                    <span className="text-[10px] font-bold uppercase">
                      {renderedDuel.showCombatInfoOnScreen ? 'Ativo' : 'Oculto'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDuel({
                        ...renderedDuel,
                        hidePlayerActionsOnScreen: !renderedDuel.hidePlayerActionsOnScreen,
                      })
                    }
                    className={`w-full px-2.5 py-2 border text-left flex items-center justify-between gap-2 ${
                      !renderedDuel.hidePlayerActionsOnScreen
                        ? 'bg-emerald-950/70 border-emerald-600 text-emerald-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs">
                      {renderedDuel.hidePlayerActionsOnScreen ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      Menu de Golpes
                    </span>
                    <span className="text-[10px] font-bold uppercase">
                      {!renderedDuel.hidePlayerActionsOnScreen ? 'Ativo' : 'Oculto'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ZONE 3: Extra Duel Settings Drawer Toggle, Dock Collapse & End Duel */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setOpenTopMenu('none');
                setShowExtraSettings((v) => !v);
              }}
              className={`px-2.5 py-1.5 text-xs border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                showExtraSettings
                  ? 'vtt-accent-btn border-transparent font-bold'
                  : 'bg-stone-900 border-stone-700 text-stone-100 hover:bg-stone-800'
              }`}
              title="Customizar estilo visual do duelo, combos em chamas e módulos extras de RPG"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Extras</span>
              {layoutStyle !== 'minimal' && (
                <span className="text-[10px] opacity-80 hidden xl:inline">
                  · {layoutStyle === 'medieval' ? 'Medieval' : 'Estilizado'}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setHudCollapsed((v) => !v)}
              className="px-2 py-1.5 text-[11px] bg-stone-900 border border-stone-700 text-stone-300 hover:text-white whitespace-nowrap shrink-0"
              title="Mostrar ou recolher painel inferior de golpes"
            >
              {hudCollapsed ? '▴ Golpes' : '▾ Ocultar'}
            </button>

            <button
              type="button"
              onClick={onEndDuel}
              className="px-2.5 py-1.5 text-[11px] font-semibold bg-stone-800 hover:bg-red-900 border border-stone-600 text-stone-100 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Encerrar</span>
            </button>
          </div>
        </header>
      )}

      {/* EXTRA DUEL SETTINGS SIDEBAR (GM ONLY) */}
      {mode === 'gm' && onUpdateDuel && (
        <DuelExtraSettingsDrawer
          open={showExtraSettings}
          settings={extraSettings}
          onChange={updateExtraSettings}
          onClose={() => setShowExtraSettings(false)}
        />
      )}

      {/* LAYER 5 (z-30): Theme-Adaptive Bottom Turn-Based Roll & Attack Sound Dock */}
      {showBottomCommandDock && !hudCollapsed && (
        <div
          data-gm-ui="true"
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(940px,95vw)] shadow-2xl ${
            isStylized
              ? 'duel-stylized-panel'
              : isMedieval
                ? 'duel-medieval-panel'
                : 'bg-stone-950/95 border border-stone-700/90'
          }`}
        >
          <div className={isStylized ? 'duel-stylized-unskew' : ''}>
            <div className="px-4 py-2 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {mode === 'gm' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveActionSideTab('player')}
                      className={`px-3 py-1 text-xs font-bold border transition-colors ${
                        isMedieval
                          ? 'font-duel-medieval-display text-sm tracking-wide'
                          : isStylized
                            ? 'font-duel-stylized-display italic uppercase'
                            : 'font-typewriter'
                      } ${
                        activeActionSideTab === 'player'
                          ? 'bg-emerald-800/90 border-emerald-500 text-white'
                          : 'bg-stone-900 border-stone-700 text-stone-300'
                      }`}
                    >
                      {renderedDuel.player.name} ({renderedDuel.player.actions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveActionSideTab('npc')}
                      className={`px-3 py-1 text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                        isMedieval
                          ? 'font-duel-medieval-display text-sm tracking-wide'
                          : isStylized
                            ? 'font-duel-stylized-display italic uppercase'
                            : 'font-typewriter'
                      } ${
                        activeActionSideTab === 'npc'
                          ? 'bg-red-900/90 border-red-500 text-white'
                          : 'bg-stone-900 border-stone-700 text-stone-300'
                      }`}
                    >
                      <Lock className="w-3 h-3 text-red-400" />
                      {renderedDuel.npc.name} · Só Mestre ({renderedDuel.npc.actions.length})
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        isMedieval
                          ? 'duel-medieval-plaque w-6 h-6 flex items-center justify-center'
                          : 'inline-flex'
                      }
                    >
                      <Swords className="w-3.5 h-3.5 text-emerald-500" />
                    </span>
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isMedieval
                          ? 'font-duel-medieval-display text-sm text-amber-100'
                          : isStylized
                            ? 'font-duel-stylized-display italic'
                            : 'font-typewriter'
                      }`}
                    >
                      Ações de {renderedDuel.player.name}
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
                  {showAddCustomMove ? 'Fechar' : '+ Novo Ataque'}
                </button>
              )}
            </div>

            {/* Quick Add Custom Move Form with Custom MP3 / Link Audio Support (GM only) */}
            {mode === 'gm' && showAddCustomMove && (
              <form
                onSubmit={handleAddQuickAction}
                className="px-4 py-2.5 bg-stone-900/95 border-b border-stone-800 space-y-2 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    value={customMoveName}
                    onChange={(e) => setCustomMoveName(e.target.value)}
                    placeholder="Nome do ataque"
                    className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100"
                  />
                  <input
                    type="text"
                    value={customMoveFormula}
                    onChange={(e) => setCustomMoveFormula(e.target.value)}
                    placeholder="Fórmula de teste (ex: 1d20+5)"
                    className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100 font-mono"
                  />
                  <input
                    type="text"
                    value={customMoveDamage}
                    onChange={(e) => setCustomMoveDamage(e.target.value)}
                    placeholder="Fórmula de dano (ex: 1d8+3)"
                    className="px-2.5 py-1.5 bg-stone-950 border border-stone-700 text-stone-100 font-mono"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[200px] flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <input
                      type="text"
                      value={customMoveSfxUrl.startsWith('idb://') ? '' : customMoveSfxUrl}
                      onChange={(e) => {
                        setCustomMoveSfxUrl(e.target.value);
                        setCustomMoveSfxMediaId('');
                        setCustomMoveSfxFileName('');
                      }}
                      placeholder={
                        customMoveSfxFileName
                          ? `MP3 anexado: ${customMoveSfxFileName}`
                          : 'Link https://...mp3 do som deste ataque (opcional)'
                      }
                      className="w-full px-2.5 py-1 bg-stone-950 border border-stone-700 text-stone-100 text-[11px]"
                    />
                  </div>
                  {uploadContext && (
                    <label className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 border border-stone-600 text-[11px] cursor-pointer flex items-center gap-1">
                      <Upload className="w-3 h-3 text-amber-400" />
                      <span>
                        {uploadingSfxKey === 'new_move' ? 'Enviando...' : 'Enviar MP3'}
                      </span>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        disabled={uploadingSfxKey === 'new_move'}
                        onChange={(e) => {
                          void handleUploadCustomMoveSfx(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                  <button
                    type="submit"
                    className="px-3.5 py-1 font-semibold bg-amber-600 hover:bg-amber-500 text-stone-950"
                  >
                    Salvar em{' '}
                    {activeActionSideTab === 'player'
                      ? renderedDuel.player.name
                      : renderedDuel.npc.name}
                  </button>
                </div>
              </form>
            )}

            {/* Action Cards Grid */}
            <div className="p-2.5 max-h-36 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {(mode === 'gm' && activeActionSideTab === 'npc'
                ? renderedDuel.npc.actions
                : renderedDuel.player.actions
              ).map((act) => {
                const activeSide: 'player' | 'npc' =
                  mode === 'gm' ? activeActionSideTab : 'player';
                const hasCustomSfx = Boolean(act.sfxUrl || act.sfxMediaId);
                const isArmed = armedActionSfx?.actionId === act.id;
                const isEditingThisSfx = editingActionSfxId === act.id;

                return (
                  <div
                    key={act.id}
                    className={`border p-2 flex flex-col justify-between gap-1.5 transition-colors ${
                      isArmed
                        ? 'border-amber-500 bg-amber-950/30'
                        : isStylized
                          ? 'border-stone-700 bg-stone-950 hover:border-white'
                          : isMedieval
                            ? 'border-amber-900/50 bg-stone-900/80 hover:border-amber-600/70'
                            : 'border-stone-800 bg-stone-900/90 hover:border-stone-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate font-bold ${
                            isMedieval
                              ? 'font-duel-medieval-display text-sm text-amber-100'
                              : isStylized
                                ? 'font-duel-stylized-display text-xs italic uppercase text-white'
                                : 'text-xs font-typewriter text-stone-100'
                          }`}
                        >
                          {act.label}
                        </p>
                        <p className="text-[10px] text-stone-400 font-mono truncate">
                          {act.formula}
                          {act.damageFormula ? ` · ${act.damageFormula}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {mode === 'gm' && (
                          <>
                            {hasCustomSfx && (
                              <button
                                type="button"
                                onClick={() => {
                                  playCombatCursorSfx('blade', {
                                    url: act.sfxUrl,
                                    mediaId: act.sfxMediaId,
                                    campaignId,
                                  });
                                  setArmedActionSfx(
                                    isArmed
                                      ? null
                                      : {
                                          actionId: act.id,
                                          label: act.label,
                                          url: act.sfxUrl,
                                          mediaId: act.sfxMediaId,
                                        }
                                  );
                                }}
                                className={`p-1 border text-[10px] flex items-center gap-0.5 ${
                                  isArmed
                                    ? 'bg-amber-600 border-amber-400 text-stone-950 font-bold'
                                    : 'bg-stone-800 border-stone-700 text-emerald-300 hover:bg-stone-700'
                                }`}
                                title="Tocar som deste ataque e armar no mouse"
                              >
                                <Play className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setEditingActionSfxId(isEditingThisSfx ? null : act.id)
                              }
                              className={`p-1 border text-[10px] ${
                                hasCustomSfx
                                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                                  : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-stone-200'
                              }`}
                              title="Adicionar ou editar som MP3 / link deste ataque"
                            >
                              <Volume2 className="w-3 h-3" />
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onExecuteDuelAction?.({
                              side: activeSide,
                              action: act,
                              rollDamageOnly: false,
                            })
                          }
                          className={`py-1 px-2 text-[11px] font-bold flex items-center gap-1 ${
                            isStylized
                              ? 'bg-white hover:bg-amber-300 text-stone-950 font-duel-stylized-display italic uppercase'
                              : activeSide === 'npc'
                                ? 'bg-red-800 hover:bg-red-700 text-white'
                                : 'bg-amber-600 hover:bg-amber-500 text-stone-950'
                          }`}
                          title={`Rolar teste (${act.formula}) — não dispara animação de dano`}
                        >
                          <Dices className="w-3 h-3" />
                          <span>Rolar</span>
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
                            className="py-1 px-2 text-[11px] font-semibold bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 flex items-center gap-1"
                            title={`Rolar ${act.damageFormula}`}
                          >
                            <Flame className="w-3 h-3 text-amber-400" />
                            <span>Dano</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline MP3 / Audio Link Editor for this specific Attack */}
                    {mode === 'gm' && isEditingThisSfx && (
                      <div className="pt-1.5 mt-1 border-t border-stone-800 space-y-1.5 text-[10px]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={act.sfxUrl?.startsWith('idb://') ? '' : act.sfxUrl || ''}
                            onChange={(e) =>
                              void handleUpdateActionSfx(activeSide, act, {
                                url: e.target.value,
                                mediaId: '',
                                fileName: '',
                              })
                            }
                            placeholder={
                              act.sfxFileName
                                ? `Arquivo: ${act.sfxFileName}`
                                : 'Link https://...mp3 do ataque'
                            }
                            className="flex-1 px-2 py-1 bg-stone-950 border border-stone-700 text-stone-100"
                          />
                          {uploadContext && (
                            <label className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold cursor-pointer flex items-center gap-1 shrink-0">
                              <Upload className="w-2.5 h-2.5" />
                              <span>{uploadingSfxKey === act.id ? '...' : 'MP3'}</span>
                              <input
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                disabled={uploadingSfxKey === act.id}
                                onChange={(e) => {
                                  void handleUploadActionSfxFile(
                                    activeSide,
                                    act,
                                    e.target.files?.[0]
                                  );
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                        {hasCustomSfx && (
                          <div className="flex items-center justify-between text-emerald-400">
                            <span className="truncate">
                              ✓ {act.sfxFileName || 'Link de áudio configurado'}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleUpdateActionSfx(activeSide, act, null)}
                              className="text-stone-400 hover:text-red-400 underline"
                            >
                              Remover som
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
