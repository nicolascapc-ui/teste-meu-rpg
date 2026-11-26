import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Flame,
  Maximize2,
  Plus,
  Radar,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  SceneToken,
  TokenBehavior,
  TokenOutlineStyle,
  TokenShadow,
  TokenStatusEffect,
  TokenTexture,
} from '../types/vtt';
import { uploadMediaFile, type CampaignUploadContext } from '../lib/mediaStore';

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
  onDelete,
  onClose,
  onNotify,
}: TokenEditorPanelProps) {
  const [tab, setTab] = useState<'actions' | 'visual' | 'vision'>('actions');
  const [customStatusLabel, setCustomStatusLabel] = useState('');
  const [customStatusKind, setCustomStatusKind] = useState<'buff' | 'debuff'>('buff');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const statuses = token.statuses || [];

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
        optimizeFor: 'token',
      });
      patch({ mediaId: res.mediaId, imageUrl: res.url });
      onNotify?.(
        res.compressionSummary
          ? `Retrato atualizado (${res.compressionSummary}).`
          : `Retrato atualizado: ${res.fileName}`
      );
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setUploadingPhoto(false);
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
            aria-label="Fechar editor do token"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 3 Calm Progressive-Disclosure Tabs */}
      <div className="grid grid-cols-3 border-b vtt-border vtt-canvas">
        {(
          [
            ['actions', 'Status'],
            ['visual', 'Aparência'],
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
            {/* Quick Table Actions */}
            <div className="grid grid-cols-2 gap-1.5">
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
                    })
                  }
                  className="py-2 px-2.5 text-[11px] font-semibold vtt-accent-btn flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Mostrar TV
                </button>
              )}
            </div>

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
                onClick={onDelete}
                className="p-1.5 border vtt-border text-red-700 dark:text-red-400 hover:vtt-subtle shrink-0"
                title="Remover token da cena"
                aria-label="Remover token"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Buffs & Debuffs Profiles */}
            <div className="space-y-2 border-t vtt-border pt-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 vtt-accent-text" />
                  Buffs & Debuffs
                </span>
                {statuses.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patch({ statuses: [] })}
                    className="text-[10px] vtt-muted hover:underline"
                  >
                    Limpar ({statuses.length})
                  </button>
                )}
              </div>

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
            </div>
          </>
        )}

        {tab === 'visual' && (
          <>
            {/* Name & Photo */}
            <div className="space-y-1.5">
              <label className="block space-y-1">
                <span className="text-[11px] vtt-muted">Nome</span>
                <input
                  type="text"
                  value={token.name}
                  maxLength={60}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas"
                />
              </label>

              {uploadContext && (
                <label className="w-full py-1.5 px-2.5 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>{uploadingPhoto ? 'Otimizando e enviando...' : 'Trocar foto do token'}</span>
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
            </div>

            {/* Outline Style & Color */}
            <div className="space-y-1.5 border-t vtt-border pt-2.5">
              <span className="text-[11px] font-semibold block">Borda (Outline)</span>
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

            {/* Size */}
            <label className="block space-y-1 border-t vtt-border pt-2.5">
              <div className="flex justify-between text-[11px]">
                <span className="font-semibold">Tamanho</span>
                <span className="vtt-muted tabular-nums">{token.sizePx}px</span>
              </div>
              <input
                type="range"
                min={32}
                max={96}
                step={2}
                value={token.sizePx}
                onChange={(e) => patch({ sizePx: Number(e.target.value) })}
                className="w-full"
              />
            </label>
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
                  })
                }
              />
            </label>

            {token.visionEnabled && (
              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold">Alcance da visão</span>
                  <span className="vtt-muted tabular-nums">
                    {Math.round((token.visionRadius || 0.34) * 100)}% do mapa
                  </span>
                </div>
                <input
                  type="range"
                  min={0.12}
                  max={0.85}
                  step={0.02}
                  value={token.visionRadius || 0.34}
                  onChange={(e) => patch({ visionRadius: Number(e.target.value) })}
                  className="w-full"
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
