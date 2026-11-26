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
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  Swords,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ActiveDuelState,
  AudioTrack,
  CharacterSheet,
  CustomDuelArenaPreset,
  DuelActionItem,
  DuelArenaPresetId,
  DuelCameraAngle,
  DuelCombatantState,
  DuelCursorAttackMode,
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
  loadCustomDuelPresets,
  playCombatCursorSfx,
  saveCustomDuelPreset,
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

  // Default to TRUE: players only see the 3D arena, the 2 confronting tokens in dynamic perspective, and reactive effects
  const [hidePlayerActionsOnScreen, setHidePlayerActionsOnScreen] = useState(true);

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
              <div className="flex items-center gap-1.5">
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
          <div className="border vtt-border vtt-canvas p-3 flex flex-wrap items-center justify-between gap-3">
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
                  Ativado por padrão: os jogadores nunca veem barras de vida nem menus de ataques, apenas o confronto 3D em perspectiva dinâmica.
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
  const [activeActionSideTab, setActiveActionSideTab] = useState<'player' | 'npc'>('player');
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [showAddCustomMove, setShowAddCustomMove] = useState(false);
  const [customMoveName, setCustomMoveName] = useState('');
  const [customMoveFormula, setCustomMoveFormula] = useState('1d20 + 5');
  const [customMoveDamage, setCustomMoveDamage] = useState('1d8 + 3');
  const [uploadingBg, setUploadingBg] = useState(false);

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

    // Play procedural combat sound
    playCombatCursorSfx(eff.kind);

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

    // Diagonal slash line across target for 'blade' (Corte) or 'shot' (Tiro)
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

    // Radial sparks / droplets
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
  // (HP is controlled manually by the GM so players never see HP numbers or automatic deductions)
  function triggerMouseReactiveStrike(
    targetSide: 'player' | 'npc',
    kind: DuelLiveEffect['kind'],
    slashPoints?: Array<{ x: number; y: number }>
  ) {
    if (!renderedDuel || mode !== 'gm' || !onUpdateDuel) return;
    const target = targetSide === 'player' ? renderedDuel.player : renderedDuel.npc;
    const attackerSide = targetSide === 'player' ? 'npc' : 'player';
    const attacker = attackerSide === 'player' ? renderedDuel.player : renderedDuel.npc;
    const hitTime = Date.now();

    const effectLabels: Record<DuelLiveEffect['kind'], string> = {
      blade: 'Corte',
      blunt: 'Impacto',
      shot: 'Tiro',
      arcane: 'Magia',
      heal: 'Cura',
      shield: 'Defesa',
    };

    const effect: DuelLiveEffect = {
      id: `fx_${hitTime}_${Math.random().toString(36).slice(2, 6)}`,
      timestampMs: hitTime,
      targetSide,
      kind,
      label: effectLabels[kind],
      slashPoints,
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
      lastActionSummary: `${effectLabels[kind]} em ${target.name}`,
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

    setMouseTilt({
      rx: Number(((0.5 - ny) * 5.0).toFixed(2)),
      ry: Number(((nx - 0.5) * 8.0).toFixed(2)),
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
      description: `Fórmula: ${customMoveFormula}`,
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
    onNotify?.(`Ação "${newAction.label}" adicionada a ${target.name}.`);
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

  // Dynamic Turn-Based 3D Camera Perspective ("brinque com perspectiva")
  const effectiveCamera = renderedDuel.cameraAngle;
  const isPlayerTurn = renderedDuel.activeTurn === 'player';

  let camRotateX = 6 + mouseTilt.rx * 0.7;
  let camRotateY = mouseTilt.ry * 0.7;
  let camRotateZ = 0;
  let camTranslateZ = 0;
  let camTranslateX = 0;
  let camTranslateY = 0;

  if (effectiveCamera === 'dynamic') {
    if (isPlayerTurn) {
      // Over-the-shoulder diagonal perspective behind Player looking across the 3D arena at the Opponent
      camRotateY = 15 + mouseTilt.ry * 0.65;
      camRotateX = 7.5 + mouseTilt.rx * 0.65;
      camRotateZ = 1.3;
      camTranslateX = 48;
      camTranslateY = -8;
      camTranslateZ = 34;
    } else {
      // Dramatic counter-angle swinging across the 3D arena when it's the Opponent's turn
      camRotateY = -16 + mouseTilt.ry * 0.65;
      camRotateX = 8.5 + mouseTilt.rx * 0.65;
      camRotateZ = -1.4;
      camTranslateX = -48;
      camTranslateY = -6;
      camTranslateZ = 34;
    }
  } else if (effectiveCamera === 'stadium') {
    camRotateX = 12 + mouseTilt.rx * 0.6;
    camRotateY = (isPlayerTurn ? 12 : -12) + mouseTilt.ry * 0.6;
    camTranslateZ = -30;
  } else if (effectiveCamera === 'showdown') {
    camRotateX = 3 + mouseTilt.rx * 0.5;
    camRotateY = mouseTilt.ry * 0.5;
    camTranslateZ = 25;
  } else if (effectiveCamera === 'focus_player') {
    camRotateY = 18;
    camRotateZ = 1.5;
    camTranslateX = 125;
    camTranslateZ = 75;
  } else if (effectiveCamera === 'focus_npc') {
    camRotateY = -18;
    camRotateZ = -1.5;
    camTranslateX = -125;
    camTranslateZ = 75;
  }

  // Dynamic per-turn 3D depth for Player and Opponent standees
  const playerLungeActive =
    Boolean(renderedDuel.player.lastLungeAtMs) &&
    nowMs - (renderedDuel.player.lastLungeAtMs || 0) < 520;
  const npcLungeActive =
    Boolean(renderedDuel.npc.lastLungeAtMs) &&
    nowMs - (renderedDuel.npc.lastLungeAtMs || 0) < 520;

  const playerZ = isPlayerTurn ? 78 : -16;
  const playerScale = isPlayerTurn ? 1.07 : 0.93;
  const playerRotY = isPlayerTurn ? 12 : 16;

  const npcZ = !isPlayerTurn ? 72 : -22;
  const npcScale = !isPlayerTurn ? 1.07 : 0.94;
  const npcRotY = !isPlayerTurn ? -12 : -16;

  const resolvedMediaKind =
    renderedDuel.bgMediaKind || detectSceneMediaKind(renderedDuel.bgUrl || bgResolvedUrl);

  // By default hidePlayerActionsOnScreen is true so players ONLY see the 3D arena and the 2 tokens confronting
  const showBottomCommandDock =
    mode === 'gm' || (!renderedDuel.hidePlayerActionsOnScreen && mode === 'player');

  const cursorStyle =
    mode !== 'gm'
      ? 'cursor-default'
      : cursorMode === 'blade' || cursorMode === 'shot'
        ? 'cursor-crosshair'
        : 'cursor-pointer';

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
      {/* 1. Deep 3D Perspective Viewport (Cyclorama Backdrop + 3D Tilted Arena Floor + 3D Standees) */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{
          perspective: '1050px',
          perspectiveOrigin: isPlayerTurn ? '46% 44%' : '54% 44%',
          transition: 'perspective-origin 820ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translate3d(${camTranslateX}px, ${camTranslateY}px, ${camTranslateZ}px) rotateX(${camRotateX}deg) rotateY(${camRotateY}deg) rotateZ(${camRotateZ}deg)`,
            transition: 'transform 820ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {/* 3D Skybox / Custom Scene Duel Background Cyclorama */}
          <div
            className="absolute inset-[-18%] overflow-hidden"
            style={{
              transform: 'translateZ(-260px) scale(1.32)',
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
                      'linear-gradient(to bottom, rgba(7,6,6,0.3) 0%, rgba(7,6,6,0.15) 45%, rgba(7,6,6,0.92) 100%)',
                  }}
                />
              </div>
            )}
          </div>

          {/* 3D Ground Plane (Tilted in 3D space with tactical concentric rings & grid) */}
          <div
            className="absolute left-1/2 top-[52%] w-[170vw] h-[135vh] -translate-x-1/2 -translate-y-1/2"
            style={{
              transform: 'rotateX(76deg) translateZ(-115px)',
              background: preset.floorGradient,
              boxShadow: `0 0 140px 20px ${preset.ambientGlow} inset`,
            }}
          >
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

          {/* Volumetric Rim Spotlight Beams shifting dynamically with active turn */}
          <div
            className="absolute inset-0 pointer-events-none transition-all duration-700"
            style={{
              background: `radial-gradient(circle at ${
                isPlayerTurn ? '26% 56%' : '74% 44%'
              }, ${preset.ambientGlow} 0%, transparent 58%)`,
            }}
          />

          {/* 3D Combatant Stage Container */}
          <div
            className="absolute inset-0 max-w-6xl mx-auto px-6"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* PLAYER COMBATANT (Left 3D Platform) */}
            <div
              ref={playerBoxRef}
              className="absolute left-[7%] sm:left-[12%] bottom-[20%] sm:bottom-[22%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
              style={{
                transform: `translate3d(${
                  playerLungeActive ? '85px' : playerHitActive ? '-32px' : '0px'
                }, ${playerLungeActive ? '-20px' : '0px'}, ${playerZ}px) rotateY(${playerRotY}deg) scale(${playerScale})`,
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Subtle Turn Indicator */}
              {isPlayerTurn && (
                <div
                  className="mb-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border bg-black/80"
                  style={{ borderColor: preset.accentColor, color: preset.accentColor }}
                >
                  ◆ {renderedDuel.player.name}
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
                    ? '0 0 44px 12px rgba(239, 68, 68, 0.9), 0 24px 44px rgba(0,0,0,0.88)'
                    : `0 26px 52px rgba(0,0,0,0.88), 0 0 28px ${preset.ambientGlow}`,
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

              {/* 3D Grounded Pedestal Disc */}
              <div
                className="w-44 sm:w-56 h-7 -mt-3 rounded-full border"
                style={{
                  borderColor: preset.accentColor,
                  background: `radial-gradient(ellipse at center, ${preset.ambientGlow} 0%, rgba(0,0,0,0.9) 75%)`,
                  transform: 'rotateX(65deg)',
                  boxShadow: '0 14px 28px rgba(0,0,0,0.95)',
                }}
              />

              {/* GM-ONLY Manual Vida (PV) Control Box — Completely invisible to Players & TV! */}
              {mode === 'gm' && (
                <div
                  data-gm-ui="true"
                  className="mt-2 w-full bg-stone-950/95 border border-stone-700/90 p-2.5 shadow-2xl space-y-2"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold font-typewriter truncate">
                      {renderedDuel.player.name}
                    </span>
                    <div className="flex items-center gap-1 text-xs font-bold tabular-nums text-emerald-400">
                      <input
                        type="number"
                        value={renderedDuel.player.hpCurrent}
                        onChange={(e) =>
                          setCombatantHpManual('player', Number(e.target.value))
                        }
                        className="w-12 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 text-emerald-300"
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
                        className="w-12 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                        title="Editar vida máxima"
                      />
                      <span className="text-[10px] text-stone-400">PV</span>
                    </div>
                  </div>

                  {/* Visual HP Bar for GM only */}
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

                  {/* Manual Subtract / Add Controls */}
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <div className="flex items-center gap-1">
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

                    {/* Custom Exact Value Subtract/Add */}
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        min={1}
                        value={manualPlayerDelta}
                        onChange={(e) => setManualPlayerDelta(e.target.value)}
                        className="w-10 px-1 py-0.5 bg-stone-900 border border-stone-700 text-center text-stone-200 tabular-nums"
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

            {/* NPC / ENEMY COMBATANT (Right 3D Platform) */}
            <div
              ref={npcBoxRef}
              className="absolute right-[7%] sm:right-[12%] top-[14%] sm:top-[16%] w-48 sm:w-64 flex flex-col items-center pointer-events-auto"
              style={{
                transform: `translate3d(${
                  npcLungeActive ? '-85px' : npcHitActive ? '32px' : '0px'
                }, ${npcLungeActive ? '20px' : '0px'}, ${npcZ}px) rotateY(${npcRotY}deg) scale(${npcScale})`,
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Subtle Turn Indicator */}
              {!isPlayerTurn && (
                <div className="mb-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest border border-red-500 text-red-400 bg-black/80">
                  ◆ {renderedDuel.npc.name}
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
                    ? '0 0 44px 12px rgba(239, 68, 68, 0.9), 0 24px 44px rgba(0,0,0,0.88)'
                    : '0 26px 52px rgba(0,0,0,0.88), 0 0 28px rgba(220, 38, 38, 0.28)',
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

              {/* GM-ONLY Manual Vida (PV) Control Box — Completely invisible to Players & TV! */}
              {mode === 'gm' && (
                <div
                  data-gm-ui="true"
                  className="mt-2 w-full bg-stone-950/95 border border-stone-700/90 p-2.5 shadow-2xl space-y-2"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold font-typewriter truncate">
                      {renderedDuel.npc.name}
                    </span>
                    <div className="flex items-center gap-1 text-xs font-bold tabular-nums text-red-400">
                      <input
                        type="number"
                        value={renderedDuel.npc.hpCurrent}
                        onChange={(e) =>
                          setCombatantHpManual('npc', Number(e.target.value))
                        }
                        className="w-12 px-1 py-0.5 text-right bg-stone-900 border border-stone-700 text-red-300"
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
                        className="w-12 px-1 py-0.5 bg-stone-900 border border-stone-700 text-stone-300"
                        title="Editar vida máxima do oponente"
                      />
                      <span className="text-[10px] text-stone-400">PV</span>
                    </div>
                  </div>

                  {/* Visual HP Bar for GM only */}
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

                  {/* Manual Subtract / Add Controls */}
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <div className="flex items-center gap-1">
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

                    {/* Custom Exact Value Subtract/Add */}
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        min={1}
                        value={manualNpcDelta}
                        onChange={(e) => setManualNpcDelta(e.target.value)}
                        className="w-10 px-1 py-0.5 bg-stone-900 border border-stone-700 text-center text-stone-200 tabular-nums"
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
      </div>

      {/* 2. Interactive 2D FX Canvas Overlay (Particles + Corte Slash + Impacto/Tiro/Magia Shockwaves) */}
      <canvas
        ref={fxCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      />

      {/* 3. GM-ONLY Top Control Bar (Players & TV have 100% pure unobstructed 3D Arena view!) */}
      {mode === 'gm' && onUpdateDuel && (
        <header
          data-gm-ui="true"
          className="relative z-30 px-4 py-2 bg-stone-950/92 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2.5 min-w-0">
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
            {renderedDuel.lastActionSummary && (
              <span className="text-[11px] text-stone-400 truncate hidden xl:inline">
                {renderedDuel.lastActionSummary}
              </span>
            )}
          </div>

          {/* Broad, Universal Mouse Attack Effect Types (Corte, Impacto, Tiro, Magia) */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <div className="flex items-center bg-stone-900 border border-stone-700 p-0.5">
              <span className="px-2 text-[10px] uppercase tracking-wider text-stone-400 hidden sm:inline">
                Ataque Mouse:
              </span>
              {(
                [
                  ['blade', 'Corte', Swords],
                  ['blunt', 'Impacto', Hammer],
                  ['shot', 'Tiro', Crosshair],
                  ['arcane', 'Magia', Sparkles],
                ] as const
              ).map(([id, label, Icon]) => (
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
                  <span className="hidden lg:inline">Tela Limpa (Só Arena)</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Ataques Player Visíveis</span>
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

      {/* 4. Bottom Turn-Based Roll Dock (Visible to GM; hidden by default for Players/TV) */}
      {showBottomCommandDock && !hudCollapsed && (
        <div
          data-gm-ui="true"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(920px,95vw)] bg-stone-950/95 border border-stone-700/90 shadow-2xl"
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
                    Rolagens de {renderedDuel.player.name} ({renderedDuel.player.actions.length})
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
                    Rolagens de {renderedDuel.npc.name} (Só Mestre ·{' '}
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
                <span className="text-[11px] text-stone-400 hidden md:inline">
                  Rolar dados aqui apenas testa o acerto/dano. Use o mouse no personagem para a animação de ataque!
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddCustomMove((v) => !v)}
                  className="px-2.5 py-1 text-[11px] border border-stone-700 bg-stone-900 hover:bg-stone-800 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  {showAddCustomMove ? 'Fechar' : '+ Ação'}
                </button>
              </div>
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
                placeholder="Nome da ação"
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
                placeholder="Fórmula secundária (ex: 1d8+3)"
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

          {/* Action Cards Grid (Rolling dice ONLY checks the roll — does NOT trigger hit animation) */}
          <div className="p-2.5 max-h-36 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {(mode === 'gm' && activeActionSideTab === 'npc'
              ? renderedDuel.npc.actions
              : renderedDuel.player.actions
            ).map((act) => {
              const activeSide: 'player' | 'npc' =
                mode === 'gm' ? activeActionSideTab : 'player';

              return (
                <div
                  key={act.id}
                  className="border border-stone-800 bg-stone-900/90 hover:border-stone-600 p-2 flex items-center justify-between gap-2 transition-colors"
                >
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
                      title={`Rolar teste (${act.formula})`}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
