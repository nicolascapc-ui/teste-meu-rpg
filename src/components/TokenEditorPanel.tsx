import { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  EyeOff,
  Flame,
  Heart,
  HeartPulse,
  Lock,
  Maximize2,
  Moon,
  Plus,
  Radar,
  Skull,
  Sparkles,
  Square,
  Swords,
  Trash2,
  Unlock,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  SceneToken,
  TokenBehavior,
  TokenCategory,
  TokenOutlineStyle,
  TokenShadow,
  TokenStatusEffect,
  TokenTexture,
  TokenVitalStatus,
} from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';

export const TOKEN_SWATCH_COLORS = [
  '#8f2d2d',
  '#2f5d46',
  '#37546e',
  '#9c6b27',
  '#5b4372',
  '#e7e2d8',
  '#1f1e1c',
];

export const PRESET_STATUS_PROFILES: TokenStatusEffect[] = [
  // Buffs
  { id: 'buff_escudo', label: 'Escudo', kind: 'buff', color: '#2563eb' },
  { id: 'buff_abencoado', label: 'Abençoado', kind: 'buff', color: '#ca8a04' },
  { id: 'buff_furia', label: 'Fúria', kind: 'buff', color: '#ea580c' },
  { id: 'buff_focado', label: 'Focado', kind: 'buff', color: '#0d9488' },
  { id: 'buff_invisivel', label: 'Furtivo', kind: 'buff', color: '#64748b' },
  // Debuffs
  { id: 'debuff_sangrando', label: 'Sangrando', kind: 'debuff', color: '#b91c1c' },
  { id: 'debuff_veneno', label: 'Envenenado', kind: 'debuff', color: '#15803d' },
  { id: 'debuff_queimando', label: 'Queimando', kind: 'debuff', color: '#dc2626' },
  { id: 'debuff_atordoado', label: 'Atordoado', kind: 'debuff', color: '#7c3aed' },
  { id: 'debuff_marcado', label: 'Marcado', kind: 'debuff', color: '#be185d' },
];

interface TokenEditorPanelProps {
  token: SceneToken;
  uploadContext?: CampaignUploadContext;
  compact?: boolean;
  onChange: (updated: SceneToken) => void;
  onTriggerHit: () => void;
  onShowPopup?: (handout: ActiveHandoutProjection) => void;
  onSaveToVault?: (token: SceneToken) => void;
  onDelete: () => void;
  onClose?: () => void;
  onNotify?: (msg: string) => void;
}

export function TokenEditorPanel({
  token,
  uploadContext,
  compact = false,
  onChange,
  onTriggerHit,
  onShowPopup,
  onSaveToVault,
  onDelete,
  onClose,
  onNotify,
}: TokenEditorPanelProps) {
  const [tab, setTab] = useState<'actions' | 'visual' | 'vision'>('actions');
  const [customStatusLabel, setCustomStatusLabel] = useState('');
  const [customStatusKind, setCustomStatusKind] = useState<'buff' | 'debuff'>('buff');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCombatSprite, setUploadingCombatSprite] = useState(false);
  const [combatSpritePreview, setCombatSpritePreview] = useState('');
  const [showCombatSpriteUrl, setShowCombatSpriteUrl] = useState(false);
  const [showStatusAccordion, setShowStatusAccordion] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!token.combatSpriteMediaId && !token.combatSpriteUrl) {
      setCombatSpritePreview('');
      return;
    }
    void resolveMediaUrl(
      token.combatSpriteMediaId,
      token.combatSpriteUrl,
      uploadContext?.campaignId
    ).then((url) => {
      if (alive) setCombatSpritePreview(url || token.combatSpriteUrl || '');
    });
    return () => {
      alive = false;
    };
  }, [token.combatSpriteMediaId, token.combatSpriteUrl, uploadContext?.campaignId]);

  const statuses = token.statuses || [];
  const vitalStatus: TokenVitalStatus = token.vitalStatus || 'alive';
  const isTextLayer = token.layerKind === 'text';
  const isImageLayer = token.layerKind === 'image';
  const currentW = Math.round(token.widthPx || token.sizePx || 56);
  const currentH = Math.round(token.heightPx || token.sizePx || 56);

  function patch(partial: Partial<SceneToken>) {
    onChange({ ...token, ...partial });
  }

  function togglePresetStatus(preset: TokenStatusEffect) {
    const exists = statuses.some((s) => s.id === preset.id || s.label === preset.label);
    const next = exists
      ? statuses.filter((s) => s.id !== preset.id && s.label !== preset.label)
      : [...statuses, preset].slice(0, 8);
    patch({ statuses: next });
  }

  function addCustomStatus(e: React.FormEvent) {
    e.preventDefault();
    const label = customStatusLabel.trim().slice(0, 24);
    if (!label) return;
    const item: TokenStatusEffect = {
      id: `st_${Date.now().toString(36)}`,
      label,
      kind: customStatusKind,
      color: customStatusKind === 'buff' ? '#0f766e' : '#b91c1c',
    };
    patch({ statuses: [...statuses, item].slice(0, 8) });
    setCustomStatusLabel('');
  }

  async function handlePhotoUpload(file: File | undefined) {
    if (!file || !uploadContext) return;
    setUploadingPhoto(true);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: isImageLayer ? 'handout' : 'token',
      });
      patch({ mediaId: res.mediaId, imageUrl: res.url });
      onNotify?.(
        res.compressionSummary
          ? `Imagem atualizada (${res.compressionSummary}).`
          : `Imagem atualizada: ${res.fileName}`
      );
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleCombatSpriteUpload(file: File | undefined) {
    if (!file || !uploadContext) return;
    setUploadingCombatSprite(true);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'combat_sprite',
      });
      patch({ combatSpriteMediaId: res.mediaId, combatSpriteUrl: res.url });
      setCombatSpritePreview(res.previewUrl || res.url);
      onNotify?.(
        res.compressionSummary
          ? `PNG de combate auto-recortado (${res.compressionSummary}).`
          : `PNG de combate atualizado: ${res.fileName}`
      );
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar PNG de combate.');
    } finally {
      setUploadingCombatSprite(false);
    }
  }

  return (
    <div className="vtt-surface border vtt-border shadow-2xl flex flex-col text-xs overflow-hidden">
      {/* Compact Header */}
      <div className="px-3 py-2.5 border-b vtt-border vtt-subtle flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full shrink-0 border border-black/25"
            style={{ backgroundColor: token.outlineColor || token.color }}
          />
          <span className="font-bold font-typewriter truncate">{token.name}</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 vtt-muted hover:opacity-100 shrink-0"
            aria-label="Fechar editor da camada"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 3 Calm Progressive-Disclosure Tabs */}
      <div className="grid grid-cols-3 border-b vtt-border vtt-canvas">
        {(
          [
            ['actions', isTextLayer ? 'Texto' : 'Ações'],
            ['visual', 'Transformar'],
            ['vision', 'Visão'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`py-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
              tab === id ? 'vtt-accent-btn' : 'vtt-muted hover:opacity-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`p-3 space-y-3 overflow-y-auto ${compact ? 'max-h-[360px]' : 'max-h-[440px]'}`}>
        {tab === 'actions' && (
          <>
            {isTextLayer ? (
              <div className="space-y-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold">Conteúdo do Texto</span>
                  <textarea
                    value={token.text ?? token.name}
                    onChange={(e) =>
                      patch({
                        text: e.target.value,
                        name: e.target.value.slice(0, 40) || 'Texto',
                      })
                    }
                    rows={3}
                    className="w-full px-2.5 py-2 text-xs border vtt-border vtt-canvas resize-y"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-semibold">Tamanho da Fonte</span>
                    <span className="vtt-muted tabular-nums">{token.fontSize || 24}px</span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={96}
                    step={2}
                    value={token.fontSize || 24}
                    onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 p-2 border vtt-border vtt-canvas cursor-pointer">
                  <span className="text-[11px] font-semibold">Fundo escuro legível</span>
                  <input
                    type="checkbox"
                    checked={token.textBg !== false}
                    onChange={(e) => patch({ textBg: e.target.checked })}
                  />
                </label>
              </div>
            ) : (
              <>
                {/* Estado Vital / Condição Visual no Mapa */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider vtt-muted block">
                    Estado Vital no Mapa (Filtro Visual)
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        {
                          id: 'alive' as const,
                          label: 'Vivo / Normal',
                          icon: Heart,
                          activeClass: 'bg-emerald-700 text-white border-emerald-500 font-bold',
                        },
                        {
                          id: 'unconscious' as const,
                          label: 'Inconsciente',
                          icon: Moon,
                          activeClass: 'bg-indigo-700 text-white border-indigo-400 font-bold',
                        },
                        {
                          id: 'dying' as const,
                          label: 'Morrendo',
                          icon: HeartPulse,
                          activeClass: 'bg-amber-700 text-white border-amber-400 font-bold',
                        },
                        {
                          id: 'dead' as const,
                          label: 'Morto',
                          icon: Skull,
                          activeClass: 'bg-red-800 text-white border-red-500 font-bold',
                        },
                      ]
                    ).map((item) => {
                      const Icon = item.icon;
                      const active = vitalStatus === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => patch({ vitalStatus: item.id })}
                          className={`py-1.5 px-2 text-[11px] border flex items-center gap-1.5 transition-all ${
                            active
                              ? item.activeClass
                              : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Table Actions */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={onTriggerHit}
                    className="py-2 px-2.5 text-[11px] font-semibold bg-red-700 hover:bg-red-800 text-white flex items-center justify-center gap-1.5 whitespace-nowrap"
                    title="Dispara flash vermelho + recuo de dano no token (sincronizado na TV)"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Tomar Hit
                  </button>

                  {onShowPopup && (
                    <button
                      type="button"
                      onClick={() =>
                        onShowPopup({
                          id: `tok_pop_${token.id}`,
                          title: token.name,
                          kind: 'npc',
                          imageUrl: token.imageUrl || '',
                          mediaId: token.mediaId || '',
                          body: token.notes || '',
                          spotlightMode:
                            token.tokenCategory === 'item'
                              ? 'item'
                              : token.tokenCategory === 'player' || Boolean(token.sheetId)
                                ? 'character'
                                : 'npc',
                          accentColor: token.outlineColor || token.color || '',
                          combatSpriteUrl: token.combatSpriteUrl || '',
                          combatSpriteMediaId: token.combatSpriteMediaId || '',
                          presentedAtMs: Date.now(),
                        })
                      }
                      className="py-2 px-2.5 text-[11px] font-semibold vtt-accent-btn flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      Mostrar TV
                    </button>
                  )}
                </div>

                {onSaveToVault && (token.imageUrl || token.mediaId) && (
                  <button
                    type="button"
                    onClick={() => onSaveToVault(token)}
                    className="w-full py-1.5 px-2.5 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5 vtt-accent-text" />
                    Salvar no Acervo para replicar
                  </button>
                )}

                {/* Quick Combat Full-Body PNG Shortcut */}
                <button
                  type="button"
                  onClick={() => setTab('visual')}
                  className="w-full py-1.5 px-2.5 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Swords className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    <span className="truncate font-semibold">
                      {token.combatSpriteUrl || token.combatSpriteMediaId
                        ? 'PNG Corpo Todo (Combate 3D) ativo'
                        : 'Adicionar PNG Corpo Todo (Duelo 3D)'}
                    </span>
                  </span>
                  <span className="text-[10px] vtt-muted shrink-0">
                    {token.combatSpriteUrl || token.combatSpriteMediaId ? 'Editar' : 'Abrir'}
                  </span>
                </button>
              </>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => patch({ hiddenFromPlayers: !token.hiddenFromPlayers })}
                className="flex-1 py-1.5 px-2.5 text-[11px] border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {token.hiddenFromPlayers ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    Revelar aos jogadores
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    Ocultar dos jogadores
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => patch({ locked: !token.locked })}
                className="p-1.5 border vtt-border vtt-canvas hover:vtt-subtle shrink-0"
                title={token.locked ? 'Desbloquear camada' : 'Travar posição da camada'}
              >
                {token.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 border vtt-border text-red-700 dark:text-red-400 hover:vtt-subtle shrink-0"
                title="Remover da cena"
                aria-label="Remover da cena"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Buffs & Debuffs Profiles (Progressive Disclosure Accordion) */}
            {!isTextLayer && (
              <div className="space-y-2 border-t vtt-border pt-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowStatusAccordion((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold hover:opacity-100"
                  >
                    <Flame className="w-3.5 h-3.5 vtt-accent-text" />
                    <span>Buffs & Debuffs ({statuses.length})</span>
                    {showStatusAccordion ? (
                      <ChevronUp className="w-3.5 h-3.5 vtt-muted" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
                    )}
                  </button>
                  {statuses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => patch({ statuses: [] })}
                      className="text-[10px] vtt-muted hover:underline"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {/* Active status badges always visible when collapsed */}
                {!showStatusAccordion && statuses.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {statuses.map((s) => (
                      <span
                        key={s.id}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-white flex items-center gap-1"
                        style={{ backgroundColor: s.color }}
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                )}

                {showStatusAccordion && (
                  <>
                    <div className="grid grid-cols-2 gap-1">
                      {PRESET_STATUS_PROFILES.map((preset) => {
                        const active = statuses.some((s) => s.id === preset.id || s.label === preset.label);
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => togglePresetStatus(preset)}
                            className={`px-2 py-1.5 text-[11px] border text-left flex items-center gap-1.5 transition-colors ${
                              active
                                ? 'vtt-subtle border-current font-semibold'
                                : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: preset.color }}
                            />
                            <span className="truncate">{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <form onSubmit={addCustomStatus} className="flex items-center gap-1 pt-1">
                      <select
                        value={customStatusKind}
                        onChange={(e) => setCustomStatusKind(e.target.value as 'buff' | 'debuff')}
                        className="px-1.5 py-1.5 text-[11px] border vtt-border vtt-canvas shrink-0"
                        aria-label="Tipo de efeito"
                      >
                        <option value="buff">Buff</option>
                        <option value="debuff">Debuff</option>
                      </select>
                      <input
                        type="text"
                        value={customStatusLabel}
                        onChange={(e) => setCustomStatusLabel(e.target.value)}
                        maxLength={24}
                        placeholder="Efeito próprio..."
                        className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
                      />
                      <button
                        type="submit"
                        disabled={!customStatusLabel.trim()}
                        className="p-1.5 vtt-accent-btn disabled:opacity-40 shrink-0"
                        aria-label="Adicionar status"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'visual' && (
          <>
            {/* Name, Category & Photo */}
            <div className="space-y-1.5">
              <label className="block space-y-1">
                <span className="text-[11px] vtt-muted">Nome da Camada</span>
                <input
                  type="text"
                  value={token.name}
                  maxLength={60}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas"
                />
              </label>

              {!isTextLayer && (
                <div className="space-y-1 pt-0.5">
                  <span className="text-[11px] vtt-muted block">Categoria</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['player', 'Player'],
                        ['npc', 'NPC'],
                        ['item', 'Item / Elem.'],
                      ] as Array<[TokenCategory, string]>
                    ).map(([cat, label]) => {
                      const currentCat: TokenCategory =
                        token.tokenCategory ||
                        (token.sheetId
                          ? 'player'
                          : token.layerKind === 'image' || token.shape === 'rect'
                            ? 'item'
                            : 'npc');
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => patch({ tokenCategory: cat })}
                          className={`py-1.5 px-1.5 text-[10px] border whitespace-nowrap ${
                            currentCat === cat
                              ? 'vtt-accent-btn border-transparent font-semibold'
                              : 'vtt-canvas vtt-border vtt-muted'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!isTextLayer && (
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        shape: 'circle',
                        layerKind: 'token',
                      })
                    }
                    className={`py-1.5 px-2 text-[11px] border flex items-center justify-center gap-1 ${
                      token.shape !== 'rect' && token.layerKind !== 'image'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-canvas vtt-border vtt-muted'
                    }`}
                  >
                    <Circle className="w-3 h-3" />
                    Token Circular
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        shape: 'rect',
                        layerKind: 'image',
                      })
                    }
                    className={`py-1.5 px-2 text-[11px] border flex items-center justify-center gap-1 ${
                      token.shape === 'rect' || token.layerKind === 'image'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-canvas vtt-border vtt-muted'
                    }`}
                  >
                    <Square className="w-3 h-3" />
                    Imagem Livre
                  </button>
                </div>
              )}

              {uploadContext && !isTextLayer && (
                <label className="w-full py-1.5 px-2.5 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>{uploadingPhoto ? 'Otimizando...' : 'Trocar imagem do token'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      void handlePhotoUpload(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}

              {/* Extra Full-Body Combat PNG Slot (Auto-Cropped Transparent Standee for 3D Duel) */}
              {!isTextLayer && (
                <div className="mt-2 p-2.5 border vtt-border vtt-canvas space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold flex items-center gap-1.5">
                      <Swords className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                      Foto de Combate (PNG Corpo Todo)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCombatSpriteUrl((v) => !v)}
                      className="text-[10px] vtt-muted hover:underline shrink-0"
                    >
                      {showCombatSpriteUrl ? 'Ocultar link' : 'Link PNG'}
                    </button>
                  </div>
                  <p className="text-[10px] vtt-muted leading-snug">
                    Opcional. Recorta automaticamente as bordas transparentes e substitui o token por um personagem de corpo inteiro no Duelo 3D.
                  </p>

                  {combatSpritePreview ? (
                    <div className="flex items-center gap-2.5 p-2 border vtt-border vtt-surface">
                      <div
                        className="w-12 h-16 shrink-0 flex items-end justify-center overflow-hidden border vtt-border"
                        style={{
                          backgroundImage:
                            'repeating-conic-gradient(rgba(128,128,128,0.18) 0% 25%, transparent 0% 50%)',
                          backgroundSize: '10px 10px',
                        }}
                      >
                        <img
                          src={combatSpritePreview}
                          alt={`Sprite de combate ${token.name}`}
                          referrerPolicy="no-referrer"
                          className="max-w-full max-h-full object-contain object-bottom"
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          PNG de combate pronto
                        </p>
                        <div className="flex items-center gap-1.5">
                          {uploadContext && (
                            <label className="px-2 py-1 text-[10px] font-semibold border vtt-border vtt-canvas hover:vtt-subtle cursor-pointer">
                              {uploadingCombatSprite ? 'Recortando...' : 'Trocar'}
                              <input
                                type="file"
                                accept="image/png,image/webp,image/*"
                                className="hidden"
                                disabled={uploadingCombatSprite}
                                onChange={(e) => {
                                  void handleCombatSpriteUpload(e.target.files?.[0]);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              patch({ combatSpriteUrl: '', combatSpriteMediaId: '' });
                              setCombatSpritePreview('');
                            }}
                            className="px-2 py-1 text-[10px] border vtt-border text-red-600 dark:text-red-400 hover:vtt-subtle"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    uploadContext && (
                      <label className="w-full py-2 px-2.5 border border-dashed vtt-border vtt-surface hover:vtt-subtle cursor-pointer flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                        <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                        <span>
                          {uploadingCombatSprite
                            ? 'Recortando transparência...'
                            : 'Enviar PNG corpo todo'}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/webp,image/*"
                          className="hidden"
                          disabled={uploadingCombatSprite}
                          onChange={(e) => {
                            void handleCombatSpriteUpload(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )
                  )}

                  {showCombatSpriteUrl && (
                    <input
                      type="text"
                      value={token.combatSpriteUrl || ''}
                      onChange={(e) =>
                        patch({
                          combatSpriteUrl: e.target.value.trim(),
                          combatSpriteMediaId: '',
                        })
                      }
                      placeholder="https://.../personagem_corpo_todo.png"
                      className="w-full px-2 py-1.5 text-[11px] border vtt-border vtt-surface"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Freeform Photoshop-style Width & Height sliders (also draggable directly via canvas handles!) */}
            <div className="space-y-2 border-t vtt-border pt-2.5">
              <p className="text-[10px] vtt-muted">
                Arraste as alças nos cantos da imagem no mapa ou ajuste livremente abaixo:
              </p>
              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold">Largura</span>
                  <span className="vtt-muted tabular-nums">{currentW}px</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={720}
                  step={2}
                  value={currentW}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (token.shape === 'rect' || token.layerKind === 'image') {
                      patch({ widthPx: v, sizePx: Math.max(v, currentH) });
                    } else {
                      patch({ sizePx: v, widthPx: v, heightPx: v });
                    }
                  }}
                  className="w-full"
                />
              </label>

              {(token.shape === 'rect' || token.layerKind === 'image') && (
                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-semibold">Altura</span>
                    <span className="vtt-muted tabular-nums">{currentH}px</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={720}
                    step={2}
                    value={currentH}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      patch({ heightPx: v, sizePx: Math.max(currentW, v) });
                    }}
                    className="w-full"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold">Opacidade</span>
                  <span className="vtt-muted tabular-nums">
                    {Math.round((token.opacity ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={token.opacity ?? 1}
                  onChange={(e) => patch({ opacity: Number(e.target.value) })}
                  className="w-full"
                />
              </label>
            </div>

            {/* Outline Style & Color */}
            <div className="space-y-1.5 border-t vtt-border pt-2.5">
              <span className="text-[11px] font-semibold block">
                {isTextLayer ? 'Cor do Texto' : 'Borda (Outline)'}
              </span>
              {!isTextLayer && (
                <div className="grid grid-cols-5 gap-1">
                  {(
                    [
                      ['solid', 'Sólida'],
                      ['dashed', 'Traço'],
                      ['double', 'Dupla'],
                      ['glow', 'Brilho'],
                      ['none', 'Sem'],
                    ] as Array<[TokenOutlineStyle, string]>
                  ).map(([style, label]) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => patch({ outlineStyle: style })}
                      className={`py-1.5 text-[10px] border whitespace-nowrap ${
                        (token.outlineStyle || 'solid') === style
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-canvas vtt-border vtt-muted'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1">
                {TOKEN_SWATCH_COLORS.map((c) => {
                  const active = (token.outlineColor || token.color) === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patch({ outlineColor: c, color: c })}
                      className={`w-5 h-5 rounded-full border ${
                        active ? 'ring-2 ring-offset-1 ring-current scale-110' : 'border-black/25'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Cor ${c}`}
                    />
                  );
                })}
                <input
                  type="color"
                  value={token.outlineColor || token.color || '#8f2d2d'}
                  onChange={(e) => patch({ outlineColor: e.target.value, color: e.target.value })}
                  className="w-6 h-5 border vtt-border bg-transparent cursor-pointer ml-auto"
                  title="Cor personalizada"
                />
              </div>
            </div>

            {/* Texture & Shadow */}
            {!isTextLayer && (
              <>
                <div className="grid grid-cols-2 gap-2 border-t vtt-border pt-2.5">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold block">Textura</span>
                    <select
                      value={token.texture || 'none'}
                      onChange={(e) => patch({ texture: e.target.value as TokenTexture })}
                      className="w-full px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
                    >
                      <option value="none">Nenhuma</option>
                      <option value="grain">Grão / Papel</option>
                      <option value="holo">Holográfica</option>
                      <option value="metallic">Metálica</option>
                      <option value="aged">Envelhecida</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold block">Sombra</span>
                    <select
                      value={token.shadow || 'soft'}
                      onChange={(e) => patch({ shadow: e.target.value as TokenShadow })}
                      className="w-full px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
                    >
                      <option value="none">Sem sombra</option>
                      <option value="soft">Suave</option>
                      <option value="dramatic">Dramática</option>
                      <option value="colored">Aura colorida</option>
                    </select>
                  </label>
                </div>

                {/* Behavior Animation */}
                <div className="space-y-1.5 border-t vtt-border pt-2.5">
                  <span className="text-[11px] font-semibold flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 vtt-accent-text" />
                    Comportamento / Animação
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['none', 'Parado'],
                        ['float', 'Flutuante'],
                        ['pulse', 'Respirando'],
                        ['spin_ring', 'Aura'],
                        ['tremble', 'Tremendo'],
                      ] as Array<[TokenBehavior, string]>
                    ).map(([beh, label]) => (
                      <button
                        key={beh}
                        type="button"
                        onClick={() => patch({ behavior: beh })}
                        className={`py-1.5 px-1.5 text-[10px] border whitespace-nowrap ${
                          (token.behavior || 'none') === beh
                            ? 'vtt-accent-btn border-transparent font-semibold'
                            : 'vtt-canvas vtt-border vtt-muted'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'vision' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-2.5 border vtt-border vtt-canvas">
              <Radar className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
              <p className="text-[11px] vtt-muted leading-relaxed">
                Quando ativo em mapas com <strong>Muros e Portas</strong>, este token revela o campo de visão dos jogadores e bloqueia o que está atrás das paredes.
              </p>
            </div>

            <label className="flex items-center justify-between gap-2 p-2.5 border vtt-border vtt-canvas cursor-pointer">
              <span className="font-semibold text-xs">Emite Campo de Visão</span>
              <input
                type="checkbox"
                checked={Boolean(token.visionEnabled)}
                onChange={(e) =>
                  patch({
                    visionEnabled: e.target.checked,
                    visionRadius: token.visionRadius || 0.34,
                    visionMode: token.visionMode || 'circle',
                    visionAngle: token.visionAngle || 90,
                    visionFacing: token.visionFacing ?? 0,
                  })
                }
              />
            </label>

            {token.visionEnabled && (
              <div className="space-y-3">
                {/* Vision Shape Mode: Circular 360° vs Directional Front Cone */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold block">Formato da Visão</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => patch({ visionMode: 'circle' })}
                      className={`py-2 px-2 text-[11px] border text-center transition-colors ${
                        (token.visionMode || 'circle') === 'circle'
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                      }`}
                    >
                      Circular 360°
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          visionMode: 'cone',
                          visionAngle: token.visionAngle || 90,
                          visionFacing: token.visionFacing ?? 0,
                        })
                      }
                      className={`py-2 px-2 text-[11px] border text-center transition-colors ${
                        token.visionMode === 'cone'
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                      }`}
                    >
                      Cone Frontal
                    </button>
                  </div>
                </div>

                {/* Vision Distance / Reach */}
                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-semibold">Distância / Alcance</span>
                    <span className="vtt-muted tabular-nums">
                      {Math.round((token.visionRadius || 0.34) * 100)}% do mapa
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.02}
                    value={token.visionRadius || 0.34}
                    onChange={(e) => patch({ visionRadius: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>

                {/* Directional Cone Options: Opening Angle & Facing Direction */}
                {token.visionMode === 'cone' && (
                  <div className="space-y-3 p-2.5 border vtt-border vtt-canvas">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold">Ângulo de Abertura</span>
                        <span className="vtt-accent-text font-semibold tabular-nums">
                          {Math.round(token.visionAngle || 90)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={25}
                        max={240}
                        step={5}
                        value={token.visionAngle || 90}
                        onChange={(e) => patch({ visionAngle: Number(e.target.value) })}
                        className="w-full"
                      />
                      <div className="grid grid-cols-4 gap-1">
                        {[45, 90, 120, 180].map((deg) => (
                          <button
                            key={deg}
                            type="button"
                            onClick={() => patch({ visionAngle: deg })}
                            className={`py-1 text-[10px] border tabular-nums ${
                              Math.round(token.visionAngle || 90) === deg
                                ? 'vtt-accent-btn border-transparent font-semibold'
                                : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t vtt-border">
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold">Direção Frontal</span>
                        <span className="vtt-muted tabular-nums">
                          {Math.round(token.visionFacing ?? 0)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={355}
                        step={5}
                        value={Math.round(token.visionFacing ?? 0)}
                        onChange={(e) => patch({ visionFacing: Number(e.target.value) })}
                        className="w-full"
                      />
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            [0, '↑ N'],
                            [45, '↗ NE'],
                            [90, '→ L'],
                            [135, '↘ SE'],
                            [180, '↓ S'],
                            [225, '↙ SO'],
                            [270, '← O'],
                            [315, '↖ NO'],
                          ] as const
                        ).map(([deg, label]) => (
                          <button
                            key={deg}
                            type="button"
                            onClick={() => patch({ visionFacing: deg })}
                            className={`py-1 text-[10px] border ${
                              Math.round(token.visionFacing ?? 0) === deg
                                ? 'vtt-accent-btn border-transparent font-semibold'
                                : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] vtt-muted leading-snug pt-0.5">
                        Dica: você também pode arrastar a alça laranja de direção direto no token sobre o mapa.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
