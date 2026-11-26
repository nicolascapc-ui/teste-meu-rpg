import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  Flame,
  Hammer,
  ImagePlus,
  Lock,
  Music,
  Palette,
  Play,
  Plus,
  RotateCcw,
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
  DuelLiveEffect,
  DuelParticleKind,
  Scene,
  SceneDuelConfig,
  SceneMediaKind,
  SceneToken,
} from '../types/vtt';
import {
  buildCombatantFromTokenAndSheets,
  deleteCustomDuelPreset,
  DUEL_PARTICLE_OPTIONS,
  findSheetForToken,
  getAllDuelArenaPresets,
  getDuelArenaPreset,
  loadCampaignAttackSfx,
  loadCustomDuelPresets,
  playCombatCursorSfx,
  saveActionCustomSfx,
  saveCampaignAttackSfx,
  saveCustomDuelPreset,
} from '../lib/duelEngine';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { detectSceneMediaKind } from '../lib/mediaOptimizer';

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
      attackSfxMap,
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
                  Sons de Ataque Customizados (Arquivo MP3 ou Link)
                </p>
                <p className="text-[11px] vtt-muted">
                  Personalize o som de cada tipo de ataque do mouse. Você também pode adicionar sons individuais para cada golpe dentro da arena.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => {
                    const entry = attackSfxMap[id];
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
                              : 'Ou cole link https://...mp3'
                          }
                          className="w-full px-2 py-1 border vtt-border vtt-surface text-[11px]"
                        />
                        {entry && (entry.url || entry.mediaId) && (
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hidePlayerActionsOnScreen}
                onChange={(e) => setHidePlayerActionsOnScreen(e.target.checked)}
              />
              <span>
                <strong>
                  Visualização limpa para Jogadores (apenas arena 3D, personagens e efeitos reativos)
                </strong>
                <span className="block text-[11px] vtt-muted">
                  Ativado por padrão: os jogadores nunca veem barras de vida nem menus de ataques.
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer pt-1 border-t vtt-border">
              <input
                type="checkbox"
                checked={showCombatantNamesOnScreen}
                onChange={(e) => setShowCombatantNamesOnScreen(e.target.checked)}
              />
              <span>
                <strong>Mostrar nomes em cima dos personagens para os jogadores</strong>
                <span className="block text-[11px] vtt-muted">
                  Desabilitado por padrão (você também pode ligar/desligar a qualquer momento durante o duelo).
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

  // Global Attack SFX popover in top GM toolbar (Corte, Impacto, Tiro, Magia)
  const [showAttackSfxPopover, setShowAttackSfxPopover] = useState(false);

  // Manual HP custom delta inputs for GM
  const [manualPlayerDelta, setManualPlayerDelta] = useState<string>('5');
  const [manualNpcDelta, setManualNpcDelta] = useState<string>('5');

  // Live Custom Preset popover inside 3D Arena (GM only)
  const [allPresets, setAllPresets] = useState(() => getAllDuelArenaPresets());
  const [showArenaCustomizer, setShowArenaCustomizer] = useState(false);
  const [liveCustomName, setLiveCustomName] = useState('');
  const [liveBgColor, setLiveBgColor] = useState('#1c1917');
  const [liveFloorColor, setLiveFloorColor] = useState('#292524');
  const [liveAccentColor, setLiveAccentColor] = useState('#d9a760');
  const [liveParticleKind, setLiveParticleKind] = useState<DuelParticleKind>('dust');

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

    const canvas = fxCanvasRef.current;
    const targetEl = eff.targetSide === 'player' ? playerBoxRef.current : npcBoxRef.current;
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();

    let cx = eff.targetSide === 'player' ? cRect.width * 0.28 : cRect.width * 0.72;
    let cy = cRect.height * 0.5;
    if (targetEl) {
      const tRect = targetEl.getBoundingClientRect();
      cx = tRect.left - cRect.left + tRect.width / 2;
      cy = tRect.top - cRect.top + tRect.height / 2;
    }

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
  }, [renderedDuel?.lastEffect, campaignId]);

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

  // Trigger ONLY the reactive visual + audio strike effect when the GM attacks with the mouse!
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
      label: armedActionSfx?.label || effectLabels[kind],
      slashPoints,
      sfxUrl: resolvedSfxUrl,
      sfxMediaId: resolvedSfxMediaId,
    };

    const updatedTarget: DuelCombatantState = {
      ...target,
      lastHitAtMs: hitTime,
    };

    const updatedAttacker: DuelCombatantState = {
      ...attacker,
      lastLungeAtMs: hitTime,
    };

    const nextDuel: ActiveDuelState = {
      ...renderedDuel,
      player: targetSide === 'player' ? updatedTarget : updatedAttacker,
      npc: targetSide === 'npc' ? updatedTarget : updatedAttacker,
      lastEffect: effect,
      lastActionSummary: `${armedActionSfx?.label || effectLabels[kind]} em ${target.name}`,
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
    const arenaRect = arenaRef.current?.getBoundingClientRect();
    if (!arenaRect || arenaRect.width === 0 || arenaRect.height === 0) return;

    const nx = (e.clientX - arenaRect.left) / arenaRect.width;
    const ny = (e.clientY - arenaRect.top) / arenaRect.height;

    setMouseTilt({
      rx: Number(((0.5 - ny) * 4.5).toFixed(2)),
      ry: Number(((nx - 0.5) * 7.5).toFixed(2)),
    });

    if (mode !== 'gm' || !isPointerDownRef.current || cursorMode !== 'blade') return;

    const x = e.clientX - arenaRect.left;
    const y = e.clientY - arenaRect.top;
    const now = performance.now();
    slashTrailRef.current.push({ x, y, createdAt: now });

    const hitSide = checkPointerHitsCombatant(e.clientX, e.clientY);
    if (hitSide && Date.now() - lastSlashHitMsRef.current[hitSide] > 340) {
      lastSlashHitMsRef.current[hitSide] = Date.now();
      const recentNormalized = slashTrailRef.current.slice(-10).map((pt) => ({
        x: Number((pt.x / arenaRect.width).toFixed(3)),
        y: Number((pt.y / arenaRect.height).toFixed(3)),
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
    mode === 'gm' || (!renderedDuel.hidePlayerActionsOnScreen && mode === 'player');

  // Names above characters: always visible to GM, and visible to Players/TV when showCombatantNamesOnScreen is enabled
  const shouldShowNamesAboveTokens =
    mode === 'gm' || Boolean(renderedDuel.showCombatantNamesOnScreen);

  const cursorStyle =
    mode !== 'gm'
      ? 'cursor-default'
      : cursorMode === 'blade' || cursorMode === 'shot'
        ? 'cursor-crosshair'
        : 'cursor-pointer';

  const currentAttackSfxMap =
    renderedDuel.attackSfxMap || loadCampaignAttackSfx(campaignId);

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
      {/* LAYER 1 (z-10): 3D Environment Layer (Skybox Cyclorama + Tilted 3D Arena Floor Plane) */}
      {/* Keeping the 3D floor in its own layer guarantees characters NEVER clip or sink beneath the floor! */}
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

          {/* 3D Ground Surface Plane (Anchored at the horizon line `top: 52%` and tilted down toward the viewer) */}
          <div
            className="absolute left-1/2 top-[52%] w-[200vw] h-[95vh] -translate-x-1/2"
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

      {/* LAYER 2 (z-15): 3D Combatant Standees Layer (Grounded on the EXACT SAME floor surface elevation!) */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none z-15"
        style={{
          perspective: '1050px',
          perspectiveOrigin: isPlayerTurn ? '46% 52%' : '54% 52%',
          transition: 'perspective-origin 820ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          className="relative w-full h-full max-w-6xl mx-auto px-6"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translate3d(${camTranslateX}px, 0px, 0px) rotateX(${camRotateX * 0.45}deg) rotateY(${camRotateY}deg) rotateZ(${camRotateZ}deg) scale(${camScale})`,
            transition: 'transform 820ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {/* PLAYER COMBATANT (Left Surface Position — Same Ground Elevation `bottom-[23%] sm:bottom-[25%]`) */}
          <div
            ref={playerBoxRef}
            className="absolute left-[7%] sm:left-[12%] bottom-[23%] sm:bottom-[25%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
            style={{
              transformOrigin: '50% 100%',
              transform: `translate3d(${
                playerLungeActive ? '85px' : playerHitActive ? '-32px' : '0px'
              }, ${playerLungeActive ? '-16px' : '0px'}, 0px) rotateY(${playerRotY}deg) scale(${playerScale})`,
              transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Optional Nameplate Above Character (Always shown to GM; toggleable for Players/TV) */}
            {shouldShowNamesAboveTokens && (
              <div
                className="mb-2.5 px-3 py-1 text-xs font-bold font-typewriter tracking-wide border bg-stone-950/90 shadow-lg flex items-center gap-1.5 max-w-full"
                style={{
                  borderColor: isPlayerTurn ? preset.accentColor : 'rgba(120,113,108,0.6)',
                  color: isPlayerTurn ? preset.accentColor : '#f5f5f4',
                }}
              >
                {isPlayerTurn && <span className="text-[10px]">◆</span>}
                <span className="truncate">{renderedDuel.player.name}</span>
              </div>
            )}

            {/* 3D Character Standee Card */}
            <div
              className={`relative w-40 h-40 sm:w-52 sm:h-52 rounded-2xl border-2 overflow-hidden bg-stone-900 flex items-center justify-center transition-all duration-200 ${
                playerHitActive ? 'ring-4 ring-red-500 brightness-125 -rotate-3' : ''
              }`}
              style={{
                borderColor: isPlayerTurn ? preset.accentColor : renderedDuel.player.color,
                boxShadow: playerHitActive
                  ? '0 0 44px 12px rgba(239, 68, 68, 0.9), 0 22px 40px rgba(0,0,0,0.9)'
                  : `0 22px 44px rgba(0,0,0,0.9), 0 0 28px ${preset.ambientGlow}`,
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

              {playerHitActive && (
                <div className="absolute inset-0 bg-red-600/40 pointer-events-none" />
              )}
            </div>

            {/* 3D Grounded Pedestal Disc resting flush on the floor surface */}
            <div
              className="w-44 sm:w-56 h-7 -mt-3 rounded-full border"
              style={{
                borderColor: preset.accentColor,
                background: `radial-gradient(ellipse at center, ${preset.ambientGlow} 0%, rgba(0,0,0,0.92) 75%)`,
                transform: 'rotateX(65deg)',
                boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
              }}
            />

            {/* GM-ONLY Manual Vida (PV) Control Box — Positioned below the pedestal so both pedestals stay on the exact same floor height! */}
            {mode === 'gm' && (
              <div
                data-gm-ui="true"
                className="absolute top-full mt-1.5 w-full bg-stone-950/95 border border-stone-700/90 p-2 shadow-2xl space-y-1.5 z-30"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[11px] font-bold font-typewriter truncate">
                    {renderedDuel.player.name}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-bold tabular-nums text-emerald-400">
                    <input
                      type="number"
                      value={renderedDuel.player.hpCurrent}
                      onChange={(e) =>
                        setCombatantHpManual('player', Number(e.target.value))
                      }
                      className="w-11 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 text-emerald-300"
                      title="Editar vida atual diretamente"
                    />
                    <span>/</span>
                    <input
                      type="number"
                      value={renderedDuel.player.hpMax}
                      onChange={(e) =>
                        setCombatantHpManual(
                          'player',
                          renderedDuel.player.hpCurrent,
                          Number(e.target.value)
                        )
                      }
                      className="w-11 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                      title="Editar vida máxima"
                    />
                    <span className="text-[10px] text-stone-400">PV</span>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-200"
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

                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('player', -10)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -10
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('player', -5)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('player', -1)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('player', 1)}
                      className="px-1.5 py-0.5 bg-emerald-950/90 border border-emerald-800/80 text-emerald-200 hover:bg-emerald-900"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('player', 5)}
                      className="px-1.5 py-0.5 bg-emerald-950/90 border border-emerald-800/80 text-emerald-200 hover:bg-emerald-900"
                    >
                      +5
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={1}
                      value={manualPlayerDelta}
                      onChange={(e) => setManualPlayerDelta(e.target.value)}
                      className="w-9 px-1 py-0.5 bg-stone-900 border border-stone-700 text-center text-stone-200 tabular-nums"
                      title="Valor personalizado de vida"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        adjustCombatantHpSilent(
                          'player',
                          -Math.max(1, Number(manualPlayerDelta) || 1)
                        )
                      }
                      className="px-1.5 py-0.5 bg-red-800 hover:bg-red-700 text-white font-bold"
                      title="Tirar esse valor da vida"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        adjustCombatantHpSilent(
                          'player',
                          Math.max(1, Number(manualPlayerDelta) || 1)
                        )
                      }
                      className="px-1.5 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-white font-bold"
                      title="Somar esse valor na vida"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* NPC / ENEMY COMBATANT (Right Surface Position — Exact Same Ground Elevation `bottom-[23%] sm:bottom-[25%]`!) */}
          <div
            ref={npcBoxRef}
            className="absolute right-[7%] sm:right-[12%] bottom-[23%] sm:bottom-[25%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
            style={{
              transformOrigin: '50% 100%',
              transform: `translate3d(${
                npcLungeActive ? '-85px' : npcHitActive ? '32px' : '0px'
              }, ${npcLungeActive ? '-16px' : '0px'}, 0px) rotateY(${npcRotY}deg) scale(${npcScale})`,
              transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Optional Nameplate Above Character (Always shown to GM; toggleable for Players/TV) */}
            {shouldShowNamesAboveTokens && (
              <div
                className="mb-2.5 px-3 py-1 text-xs font-bold font-typewriter tracking-wide border bg-stone-950/90 shadow-lg flex items-center gap-1.5 max-w-full"
                style={{
                  borderColor: !isPlayerTurn ? '#ef4444' : 'rgba(120,113,108,0.6)',
                  color: !isPlayerTurn ? '#f87171' : '#f5f5f4',
                }}
              >
                {!isPlayerTurn && <span className="text-[10px]">◆</span>}
                <span className="truncate">{renderedDuel.npc.name}</span>
              </div>
            )}

            {/* 3D Enemy Standee Card */}
            <div
              className={`relative w-40 h-40 sm:w-52 sm:h-52 rounded-2xl border-2 overflow-hidden bg-stone-900 flex items-center justify-center transition-all duration-200 ${
                npcHitActive ? 'ring-4 ring-red-500 brightness-125 rotate-3' : ''
              }`}
              style={{
                borderColor: !isPlayerTurn ? '#ef4444' : renderedDuel.npc.color,
                boxShadow: npcHitActive
                  ? '0 0 44px 12px rgba(239, 68, 68, 0.9), 0 22px 40px rgba(0,0,0,0.9)'
                  : '0 22px 44px rgba(0,0,0,0.9), 0 0 28px rgba(220, 38, 38, 0.28)',
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

              {npcHitActive && (
                <div className="absolute inset-0 bg-red-600/40 pointer-events-none" />
              )}
            </div>

            {/* 3D Grounded Pedestal Disc resting flush on the exact same floor surface */}
            <div
              className="w-44 sm:w-56 h-7 -mt-3 rounded-full border border-red-500/60"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(220,38,38,0.32) 0%, rgba(0,0,0,0.92) 75%)',
                transform: 'rotateX(65deg)',
                boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
              }}
            />

            {/* GM-ONLY Manual Vida (PV) Control Box */}
            {mode === 'gm' && (
              <div
                data-gm-ui="true"
                className="absolute top-full mt-1.5 w-full bg-stone-950/95 border border-stone-700/90 p-2 shadow-2xl space-y-1.5 z-30"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[11px] font-bold font-typewriter truncate">
                    {renderedDuel.npc.name}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-bold tabular-nums text-red-400">
                    <input
                      type="number"
                      value={renderedDuel.npc.hpCurrent}
                      onChange={(e) =>
                        setCombatantHpManual('npc', Number(e.target.value))
                      }
                      className="w-11 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 text-red-300"
                      title="Editar vida atual do oponente diretamente"
                    />
                    <span>/</span>
                    <input
                      type="number"
                      value={renderedDuel.npc.hpMax}
                      onChange={(e) =>
                        setCombatantHpManual(
                          'npc',
                          renderedDuel.npc.hpCurrent,
                          Number(e.target.value)
                        )
                      }
                      className="w-11 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                      title="Editar vida máxima do oponente"
                    />
                    <span className="text-[10px] text-stone-400">PV</span>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-200"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (renderedDuel.npc.hpCurrent / Math.max(1, renderedDuel.npc.hpMax)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('npc', -10)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -10
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('npc', -5)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('npc', -1)}
                      className="px-1.5 py-0.5 bg-red-950/90 border border-red-800/80 text-red-200 hover:bg-red-900"
                    >
                      -1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('npc', 1)}
                      className="px-1.5 py-0.5 bg-emerald-950/90 border border-emerald-800/80 text-emerald-200 hover:bg-emerald-900"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCombatantHpSilent('npc', 5)}
                      className="px-1.5 py-0.5 bg-emerald-950/90 border border-emerald-800/80 text-emerald-200 hover:bg-emerald-900"
                    >
                      +5
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={1}
                      value={manualNpcDelta}
                      onChange={(e) => setManualNpcDelta(e.target.value)}
                      className="w-9 px-1 py-0.5 bg-stone-900 border border-stone-700 text-center text-stone-200 tabular-nums"
                      title="Valor personalizado de vida"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        adjustCombatantHpSilent(
                          'npc',
                          -Math.max(1, Number(manualNpcDelta) || 1)
                        )
                      }
                      className="px-1.5 py-0.5 bg-red-800 hover:bg-red-700 text-white font-bold"
                      title="Tirar esse valor da vida"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        adjustCombatantHpSilent(
                          'npc',
                          Math.max(1, Number(manualNpcDelta) || 1)
                        )
                      }
                      className="px-1.5 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-white font-bold"
                      title="Somar esse valor na vida"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LAYER 3 (z-20): Interactive 2D FX Canvas Overlay (Particles + Corte Slash + Impacto/Tiro/Magia Shockwaves) */}
      <canvas
        ref={fxCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      />

      {/* LAYER 4 (z-30): GM-ONLY Top Control Bar (Players & TV have 100% pure unobstructed 3D Arena view!) */}
      {mode === 'gm' && onUpdateDuel && (
        <header
          data-gm-ui="true"
          className="relative z-30 px-4 py-2 bg-stone-950/92 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="px-2 py-0.5 text-xs font-bold font-typewriter uppercase tracking-wider border"
              style={{ borderColor: preset.accentColor, color: preset.accentColor }}
            >
              Turno: {isPlayerTurn ? renderedDuel.player.name : renderedDuel.npc.name}
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
              className="px-3 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-stone-950"
              title="Alterna o turno e gira a perspectiva 3D da câmera"
            >
              Alternar Turno / Perspectiva ➔
            </button>
            {armedActionSfx && (
              <span className="px-2 py-0.5 text-[11px] bg-amber-950/90 border border-amber-600 text-amber-200 flex items-center gap-1">
                <Volume2 className="w-3 h-3" />
                Som armado: {armedActionSfx.label}
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

          {/* Broad, Universal Mouse Attack Effect Types (Corte, Impacto, Tiro, Magia) + Custom Attack Sounds */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <div className="relative flex items-center bg-stone-900 border border-stone-700 p-0.5">
              <span className="px-2 text-[10px] uppercase tracking-wider text-stone-400 hidden sm:inline">
                Ataque Mouse:
              </span>
              {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCursorMode(id)}
                  className={`px-2.5 py-1 text-[11px] flex items-center gap-1 transition-colors ${
                    cursorMode === id
                      ? 'bg-red-700 text-white font-semibold'
                      : 'text-stone-300 hover:bg-stone-800'
                  }`}
                  title={
                    id === 'blade'
                      ? 'Corte: arraste o mouse sobre o personagem para fatiar'
                      : `${label}: clique sobre o personagem para disparar o efeito`
                  }
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              ))}

              {/* Custom Attack Sounds Button (MP3 upload or Link per Attack Type) */}
              <button
                type="button"
                onClick={() => setShowAttackSfxPopover((v) => !v)}
                className={`ml-1 px-2 py-1 text-[11px] border-l border-stone-700 flex items-center gap-1 ${
                  showAttackSfxPopover
                    ? 'bg-amber-600 text-stone-950 font-bold'
                    : 'text-amber-300 hover:bg-stone-800'
                }`}
                title="Adicionar arquivo MP3 ou link de áudio para cada ataque"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sons MP3</span>
              </button>

              {showAttackSfxPopover && (
                <div className="absolute left-0 top-9 w-80 sm:w-96 bg-stone-950 border border-stone-700 p-3 shadow-2xl space-y-2.5 z-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                      Sons de Ataque (MP3 ou Link)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAttackSfxPopover(false)}
                      className="text-stone-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400">
                    Envie um arquivo MP3/WAV ou cole um link para cada tipo de ataque (ou configure sons individuais em cada golpe na barra inferior).
                  </p>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {CURSOR_ATTACK_TYPES.map(({ id, label, icon: Icon }) => {
                      const entry = currentAttackSfxMap[id];
                      return (
                        <div
                          key={id}
                          className="border border-stone-800 bg-stone-900/90 p-2 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold font-typewriter flex items-center gap-1.5">
                              <Icon className="w-3.5 h-3.5 text-amber-400" />
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
                                className="px-2 py-0.5 text-[10px] bg-stone-800 hover:bg-stone-700 border border-stone-700 flex items-center gap-1"
                              >
                                <Play className="w-2.5 h-2.5" />
                                Ouvir
                              </button>
                              {uploadContext && (
                                <label className="px-2 py-0.5 text-[10px] font-bold bg-amber-600 hover:bg-amber-500 text-stone-950 cursor-pointer flex items-center gap-1">
                                  <Upload className="w-2.5 h-2.5" />
                                  <span>{uploadingSfxKey === id ? '...' : 'Arquivo MP3'}</span>
                                  <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    disabled={uploadingSfxKey === id}
                                    onChange={(e) => {
                                      void handleUploadGlobalAttackTypeSfx(id, e.target.files?.[0]);
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
                            onChange={(e) => handleSetGlobalAttackTypeSfxUrl(id, e.target.value)}
                            placeholder={
                              entry?.fileName
                                ? `MP3: ${entry.fileName}`
                                : 'Ou cole link https://...mp3'
                            }
                            className="w-full px-2 py-1 bg-stone-950 border border-stone-700 text-[11px]"
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
                </div>
              )}
            </div>

            {/* 3D Camera Perspective Selector */}
            <select
              value={renderedDuel.cameraAngle}
              onChange={(e) =>
                onUpdateDuel({
                  ...renderedDuel,
                  cameraAngle: e.target.value as DuelCameraAngle,
                })
              }
              className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 text-stone-200"
              title="Perspectiva 3D da Câmera"
            >
              <option value="dynamic">Perspectiva: Dinâmica (Segue Turno)</option>
              <option value="stadium">Perspectiva: Arena Diagonal</option>
              <option value="showdown">Perspectiva: Frontal</option>
              <option value="focus_player">Perspectiva: Foco {renderedDuel.player.name}</option>
              <option value="focus_npc">Perspectiva: Foco {renderedDuel.npc.name}</option>
            </select>

            {/* Direct Color & Particle Preset Selector + Custom Preset Creator */}
            <div className="relative flex items-center">
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
                className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 text-stone-200"
                title="Cor de fundo e partículas"
              >
                {allPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowArenaCustomizer((v) => !v)}
                className="px-2 py-1 text-[11px] bg-stone-900 border border-l-0 border-stone-700 hover:bg-stone-800 text-amber-400 flex items-center gap-1"
                title="Criar preset customizado de cores e partículas"
              >
                <Palette className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">+ Preset</span>
              </button>

              {showArenaCustomizer && (
                <div className="absolute right-0 top-9 w-72 bg-stone-950 border border-stone-700 p-3 shadow-2xl space-y-2.5 z-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter">
                      Criar Preset de Fundo & Partículas
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowArenaCustomizer(false)}
                      className="text-stone-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={liveCustomName}
                    onChange={(e) => setLiveCustomName(e.target.value)}
                    placeholder="Nome (ex: Cinza · Faíscas)"
                    className="w-full px-2 py-1 bg-stone-900 border border-stone-700 text-xs"
                  />
                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-400">Partículas</span>
                    <select
                      value={liveParticleKind}
                      onChange={(e) => setLiveParticleKind(e.target.value as DuelParticleKind)}
                      className="w-full px-2 py-1 bg-stone-900 border border-stone-700 text-xs"
                    >
                      {DUEL_PARTICLE_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <label className="space-y-1">
                      <span className="text-stone-400 block">Fundo</span>
                      <input
                        type="color"
                        value={liveBgColor}
                        onChange={(e) => setLiveBgColor(e.target.value)}
                        className="w-full h-7 bg-transparent border border-stone-700 cursor-pointer"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-stone-400 block">Chão</span>
                      <input
                        type="color"
                        value={liveFloorColor}
                        onChange={(e) => setLiveFloorColor(e.target.value)}
                        className="w-full h-7 bg-transparent border border-stone-700 cursor-pointer"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-stone-400 block">Partículas</span>
                      <input
                        type="color"
                        value={liveAccentColor}
                        onChange={(e) => setLiveAccentColor(e.target.value)}
                        className="w-full h-7 bg-transparent border border-stone-700 cursor-pointer"
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

            {/* Toggle Combatant Names Above Characters on Players/TV Screen (Disabled by Default) */}
            <button
              type="button"
              onClick={() =>
                onUpdateDuel({
                  ...renderedDuel,
                  showCombatantNamesOnScreen: !renderedDuel.showCombatantNamesOnScreen,
                })
              }
              className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                renderedDuel.showCombatantNamesOnScreen
                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-200'
                  : 'bg-stone-900 border-stone-700 text-stone-300'
              }`}
              title="Mostrar ou ocultar os nomes em cima dos personagens na tela dos jogadores (desabilitado por padrão)"
            >
              <Tag className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">
                {renderedDuel.showCombatantNamesOnScreen ? 'Nomes TV: ON' : 'Nomes TV: OFF'}
              </span>
            </button>

            {/* Toggle Player Attack Menu Visibility (Default: Disabled / Hidden) */}
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
                  ? 'bg-stone-900 border-stone-700 text-stone-300'
                  : 'bg-emerald-950/80 border-emerald-600 text-emerald-200'
              }`}
              title="Por padrão os jogadores só veem a arena 3D e os tokens. Clique se quiser mostrar os ataques para o jogador no celular."
            >
              {renderedDuel.hidePlayerActionsOnScreen ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Só Arena</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Menu Player ON</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setHudCollapsed((v) => !v)}
              className="px-2 py-1 text-[11px] bg-stone-900 border border-stone-700 text-stone-300 hover:text-white"
            >
              {hudCollapsed ? '▴ Fichas/Dados' : '▾ Ocultar Aba'}
            </button>

            {/* End Duel Button */}
            <button
              type="button"
              onClick={onEndDuel}
              className="px-2.5 py-1 text-[11px] font-semibold bg-stone-800 hover:bg-red-900 border border-stone-600 text-stone-100 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Encerrar
            </button>
          </div>
        </header>
      )}

      {/* LAYER 5 (z-30): Bottom Turn-Based Roll & Attack Sound Dock (Visible to GM; hidden by default for Players/TV) */}
      {showBottomCommandDock && !hudCollapsed && (
        <div
          data-gm-ui="true"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(940px,95vw)] bg-stone-950/95 border border-stone-700/90 shadow-2xl"
        >
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
                    Ataques / Rolagens de {renderedDuel.player.name} ({renderedDuel.player.actions.length})
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
                    Ataques de {renderedDuel.npc.name} (Só Mestre ·{' '}
                    {renderedDuel.npc.actions.length})
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Swords className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold font-typewriter uppercase tracking-wider">
                    Ações de {renderedDuel.player.name}
                  </span>
                </div>
              )}
            </div>

            {mode === 'gm' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-stone-400 hidden lg:inline">
                  Adicione som MP3 ou link em qualquer ataque clicando no ícone 🔊 do golpe!
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddCustomMove((v) => !v)}
                  className="px-2.5 py-1 text-[11px] border border-stone-700 bg-stone-900 hover:bg-stone-800 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  {showAddCustomMove ? 'Fechar' : '+ Novo Ataque'}
                </button>
              </div>
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
                      {uploadingSfxKey === 'new_move' ? 'Enviando...' : 'Enviar MP3 do Ataque'}
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

          {/* Action Cards Grid (Rolling dice ONLY checks the roll; each attack also supports custom MP3/link audio!) */}
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
                      : 'border-stone-800 bg-stone-900/90 hover:border-stone-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold font-typewriter text-stone-100 truncate">
                        {act.label}
                      </p>
                      <p className="text-[10px] text-stone-400 font-mono truncate">
                        {act.formula}
                        {act.damageFormula ? ` · ${act.damageFormula}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Per-Attack Custom Sound Button (Play / Arm / Edit MP3 or Link) */}
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
                          activeSide === 'npc'
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
      )}
    </div>
  );
}
