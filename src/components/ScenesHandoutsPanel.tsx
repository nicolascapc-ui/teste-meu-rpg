import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Brush,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  Lock,
  Maximize2,
  Plus,
  Send,
  SlidersHorizontal,
  Swords,
  Trash2,
  Type,
  Unlock,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  ActiveHandoutProjection,
  AudioTrack,
  CampaignMember,
  CharacterSheet,
  DuelArenaPresetId,
  Handout,
  HandoutKind,
  Scene,
  SceneCategory,
  SceneDuelConfig,
  SceneMediaKind,
  SceneToken,
} from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { detectSceneMediaKind, type MediaOptimizeProfile } from '../lib/mediaOptimizer';
import { DUEL_ARENA_PRESETS } from '../lib/duelEngine';
import type { VaultAssetItem } from '../lib/assetVault';
import { TokenEditorPanel, TOKEN_SWATCH_COLORS } from './TokenEditorPanel';

interface ScenesHandoutsPanelProps {
  uploadContext: CampaignUploadContext;
  scenes: Scene[];
  activeScene: Scene | null;
  activeSceneDuelConfig?: SceneDuelConfig;
  handouts: Handout[];
  activeHandout: ActiveHandoutProjection | null;
  audioTracks: AudioTrack[];
  members: CampaignMember[];
  sheets: CharacterSheet[];
  vaultAssets: VaultAssetItem[];
  onSelectScene: (scene: Scene) => void;
  onCreateScene: (data: {
    name: string;
    category: SceneCategory;
    imageUrl: string;
    mediaId: string;
    mediaKind: SceneMediaKind;
    linkedMusicId: string;
    linkedAmbienceId: string;
  }) => Promise<void>;
  onUpdateSceneAudio: (scene: Scene, musicId: string, ambienceId: string) => Promise<void>;
  onUpdateSceneDuelConfig?: (config: SceneDuelConfig) => void;
  onDeleteScene: (sceneId: string) => Promise<void>;
  onAddTokenToScene: (token: SceneToken) => Promise<void>;
  onUpdateSceneTokens: (tokens: SceneToken[]) => Promise<void>;
  onSaveTokenToVault: (token: SceneToken) => void;
  onRemoveVaultAsset: (assetId: string) => void;
  onCreateHandout: (data: {
    title: string;
    kind: HandoutKind;
    imageUrl: string;
    mediaId: string;
    body: string;
  }) => Promise<void>;
  onProjectHandout: (handout: ActiveHandoutProjection | null) => Promise<void>;
  onSendHandoutToPlayer: (handoutId: string, targetUid: string) => Promise<void>;
  onDeleteHandout: (handoutId: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

interface MediaUploaderBoxProps {
  label: string;
  accept: string;
  buttonLabel: string;
  previewUrl: string;
  previewKind?: SceneMediaKind;
  fileName: string;
  externalUrl: string;
  uploading: boolean;
  progress: number;
  onPickFile: (file: File | undefined) => void;
  onChangeExternalUrl: (url: string) => void;
  onClearMedia: () => void;
}

function MediaUploaderBox({
  label,
  accept,
  buttonLabel,
  previewUrl,
  previewKind = 'image',
  fileName,
  externalUrl,
  uploading,
  progress,
  onPickFile,
  onChangeExternalUrl,
  onClearMedia,
}: MediaUploaderBoxProps) {
  const [showUrlInput, setShowUrlInput] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold vtt-muted">{label}</span>
        <button
          type="button"
          onClick={() => setShowUrlInput((v) => !v)}
          className="text-[11px] vtt-muted hover:underline flex items-center gap-1"
        >
          <Link2 className="w-3 h-3" />
          {showUrlInput ? 'Ocultar link' : 'Usar link externo'}
        </button>
      </div>

      {previewUrl ? (
        <div className="relative border vtt-border vtt-surface p-2 flex items-center gap-2.5">
          {previewKind === 'video' ? (
            <video
              src={previewUrl}
              muted
              loop
              autoPlay
              playsInline
              className="w-12 h-12 object-cover border vtt-border shrink-0 bg-black"
            />
          ) : (
            <img
              src={previewUrl}
              alt="Prévia da mídia"
              className="w-12 h-12 object-cover border vtt-border shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate">{fileName || 'Mídia selecionada'}</p>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
              {uploading
                ? `Otimizando e salvando (${progress}%)...`
                : previewKind === 'video'
                  ? 'Vídeo pronto (loop silencioso)'
                  : previewKind === 'gif'
                    ? 'GIF animado pronto'
                    : 'Pronta para usar na mesa'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearMedia}
            className="p-1.5 vtt-muted hover:text-red-700 shrink-0"
            title="Remover mídia"
            aria-label="Remover mídia"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <label className="w-full py-3 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
          <Upload className="w-4 h-4 vtt-accent-text" />
          <span>{uploading ? `Enviando (${progress}%)...` : buttonLabel}</span>
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {showUrlInput && (
        <input
          type="text"
          value={externalUrl}
          onChange={(e) => onChangeExternalUrl(e.target.value)}
          placeholder="https://... (imagem, .gif, .mp4 ou .webm)"
          className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
        />
      )}
    </div>
  );
}

export function ScenesHandoutsPanel({
  uploadContext,
  scenes,
  activeScene,
  activeSceneDuelConfig,
  handouts,
  activeHandout,
  audioTracks,
  members,
  sheets,
  vaultAssets,
  onSelectScene,
  onCreateScene,
  onUpdateSceneAudio,
  onUpdateSceneDuelConfig,
  onDeleteScene,
  onAddTokenToScene,
  onUpdateSceneTokens,
  onSaveTokenToVault,
  onRemoveVaultAsset,
  onCreateHandout,
  onProjectHandout,
  onSendHandoutToPlayer,
  onDeleteHandout,
  onNotify,
}: ScenesHandoutsPanelProps) {
  const [tab, setTab] = useState<'scenes' | 'layers' | 'handouts'>('scenes');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Collapsible forms for calm, uncluttered UX
  const [showSceneForm, setShowSceneForm] = useState(false);
  const [showHandoutForm, setShowHandoutForm] = useState(false);
  const [showNewTokenForm, setShowNewTokenForm] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);

  // New scene form (supports image, GIF, and MP4/WebM video)
  const [sceneName, setSceneName] = useState('');
  const [sceneCategory, setSceneCategory] = useState<SceneCategory>('location');
  const [sceneUrl, setSceneUrl] = useState('');
  const [sceneMediaId, setSceneMediaId] = useState('');
  const [sceneMediaKind, setSceneMediaKind] = useState<SceneMediaKind>('image');
  const [scenePreview, setScenePreview] = useState('');
  const [sceneFileName, setSceneFileName] = useState('');
  const [sceneMusicId, setSceneMusicId] = useState('');
  const [sceneAmbienceId, setSceneAmbienceId] = useState('');

  // New manual token / prop form
  const [tokenName, setTokenName] = useState('');
  const [tokenShape, setTokenShape] = useState<'circle' | 'rect'>('circle');
  const [tokenColor, setTokenColor] = useState(TOKEN_SWATCH_COLORS[0]);
  const [tokenUrl, setTokenUrl] = useState('');
  const [tokenMediaId, setTokenMediaId] = useState('');
  const [tokenPreview, setTokenPreview] = useState('');
  const [tokenFileName, setTokenFileName] = useState('');
  const [tokenNotes, setTokenNotes] = useState('');
  const [tokenHidden, setTokenHidden] = useState(false);
  const [tokenVision, setTokenVision] = useState(false);

  // New handout form
  const [hTitle, setHTitle] = useState('');
  const [hKind, setHKind] = useState<HandoutKind>('clue');
  const [hUrl, setHUrl] = useState('');
  const [hMediaId, setHMediaId] = useState('');
  const [hPreview, setHPreview] = useState('');
  const [hFileName, setHFileName] = useState('');
  const [hBody, setHBody] = useState('');

  // Vault thumbnail cache
  const [vaultThumbUrls, setVaultThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    Promise.all(
      vaultAssets.map(async (a) => {
        const u = await resolveMediaUrl(a.mediaId, a.imageUrl, uploadContext.campaignId);
        return [a.id, u] as const;
      })
    ).then((pairs) => {
      if (!alive) return;
      const map: Record<string, string> = {};
      for (const [id, u] of pairs) {
        if (u) map[id] = u;
      }
      setVaultThumbUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [vaultAssets, uploadContext.campaignId]);

  const musicTracks = audioTracks.filter((t) => t.layer === 'music' && t.synthPreset !== 'duel');
  const duelMusicTracks = audioTracks.filter((t) => t.layer === 'music' && t.synthPreset === 'duel');
  const ambienceTracks = audioTracks.filter((t) => t.layer === 'ambience');
  const players = members.filter((m) => m.role === 'player');

  const editingToken = activeScene?.tokens.find((t) => t.id === editingTokenId) || null;

  async function handleFileUpload(
    file: File | undefined,
    profile: MediaOptimizeProfile,
    onDone: (res: {
      mediaId: string;
      url: string;
      previewUrl: string;
      fileName: string;
      mediaKind: SceneMediaKind;
    }) => void
  ) {
    if (!file) return;
    setUploading(true);
    setUploadPct(10);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: profile,
        onProgress: (p) => setUploadPct(p),
      });
      onDone(res);
      const optNote = res.compressionSummary ? ` (${res.compressionSummary})` : '';
      onNotify(
        res.savedToCloud
          ? `"${res.fileName}" salvo na nuvem${optNote}.`
          : `"${res.fileName}" carregado na sessão${optNote}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro no envio do arquivo.');
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  async function handleSubmitScene(e: React.FormEvent) {
    e.preventDefault();
    if (!sceneName.trim()) return;
    await onCreateScene({
      name: sceneName.trim(),
      category: sceneCategory,
      imageUrl: sceneUrl.trim(),
      mediaId: sceneMediaId,
      mediaKind: sceneMediaKind,
      linkedMusicId: sceneMusicId,
      linkedAmbienceId: sceneAmbienceId,
    });
    setSceneName('');
    setSceneUrl('');
    setSceneMediaId('');
    setSceneMediaKind('image');
    setScenePreview('');
    setSceneFileName('');
    setSceneMusicId('');
    setSceneAmbienceId('');
    setShowSceneForm(false);
    onNotify('Nova cena criada e pronta para uso.');
  }

  async function handleSpawnFromSheet(sheet: CharacterSheet) {
    if (!activeScene) return;
    const offset = (activeScene.tokens.length % 5) * 0.04;
    const token: SceneToken = {
      id: `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: sheet.name,
      layerKind: 'token',
      shape: 'circle',
      sheetId: sheet.id,
      x: Number((0.44 + offset).toFixed(3)),
      y: Number((0.5 + (offset % 0.08)).toFixed(3)),
      sizePx: 54,
      widthPx: 54,
      heightPx: 54,
      color: '#2f5d46',
      outlineStyle: 'solid',
      outlineColor: '#2f5d46',
      shadow: 'soft',
      imageUrl: sheet.avatarUrl || '',
      mediaId: sheet.avatarMediaId || '',
      notes: sheet.subtitle || '',
      hiddenFromPlayers: false,
      visionEnabled: activeScene.category === 'tactical' || Boolean(activeScene.dynamicVision),
      visionRadius: 0.34,
    };
    await onAddTokenToScene(token);
    onNotify(`Token de "${sheet.name}" adicionado à cena.`);
  }

  async function handleSpawnFromVault(asset: VaultAssetItem, asToken = false) {
    if (!activeScene) return;
    const jitter = ((activeScene.tokens.length % 6) - 2.5) * 0.03;
    const w = asToken ? 58 : asset.widthPx || 120;
    const h = asToken ? 58 : asset.heightPx || 120;
    const created: SceneToken = {
      id: `vsp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: asset.name,
      layerKind: asToken ? 'token' : 'image',
      shape: asToken ? 'circle' : 'rect',
      x: Number(Math.max(0.1, Math.min(0.9, 0.5 + jitter)).toFixed(4)),
      y: Number(Math.max(0.1, Math.min(0.9, 0.5 + jitter)).toFixed(4)),
      sizePx: Math.max(w, h),
      widthPx: w,
      heightPx: h,
      color: '#8f2d2d',
      outlineStyle: asToken ? 'solid' : 'none',
      outlineColor: '#8f2d2d',
      shadow: 'soft',
      imageUrl: asset.imageUrl,
      mediaId: asset.mediaId,
      hiddenFromPlayers: false,
    };
    await onAddTokenToScene(created);
    onNotify(`"${asset.name}" replicado na cena!`);
  }

  async function handleDirectVaultUpload(file: File | undefined) {
    if (!file) return;
    await handleFileUpload(file, 'handout', (res) => {
      const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || 'Item do Acervo';
      const tokenLike: SceneToken = {
        id: `vlt_${Date.now().toString(36)}`,
        name: cleanName,
        layerKind: 'image',
        shape: 'rect',
        x: 0.5,
        y: 0.5,
        sizePx: 130,
        widthPx: 130,
        heightPx: 130,
        color: '#8f2d2d',
        imageUrl: res.url,
        mediaId: res.mediaId,
      };
      onSaveTokenToVault(tokenLike);
    });
  }

  async function handleSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim() || !activeScene) return;
    const isRect = tokenShape === 'rect';
    const baseSize = isRect ? 120 : 54;
    const token: SceneToken = {
      id: `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: tokenName.trim(),
      layerKind: isRect ? 'image' : 'token',
      shape: tokenShape,
      x: 0.5,
      y: 0.5,
      sizePx: baseSize,
      widthPx: baseSize,
      heightPx: baseSize,
      color: tokenColor,
      outlineStyle: isRect ? 'none' : 'solid',
      outlineColor: tokenColor,
      shadow: 'soft',
      imageUrl: tokenUrl.trim() || '',
      mediaId: tokenMediaId || '',
      notes: tokenNotes.trim() || '',
      hiddenFromPlayers: tokenHidden,
      visionEnabled: tokenVision,
      visionRadius: 0.34,
    };
    await onAddTokenToScene(token);
    if (token.imageUrl || token.mediaId) {
      onSaveTokenToVault(token);
    }
    setTokenName('');
    setTokenUrl('');
    setTokenMediaId('');
    setTokenPreview('');
    setTokenFileName('');
    setTokenNotes('');
    setTokenHidden(false);
    setTokenVision(false);
    setShowNewTokenForm(false);
    onNotify(`"${token.name}" adicionado à cena.`);
  }

  function moveLayerOrder(idx: number, dir: -1 | 1) {
    if (!activeScene) return;
    const target = idx + dir;
    if (target < 0 || target >= activeScene.tokens.length) return;
    const copy = [...activeScene.tokens];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    void onUpdateSceneTokens(copy);
  }

  function duplicateLayer(token: SceneToken) {
    if (!activeScene) return;
    const clone: SceneToken = {
      ...token,
      id: `dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      x: Number(Math.min(0.95, token.x + 0.04).toFixed(4)),
      y: Number(Math.min(0.95, token.y + 0.04).toFixed(4)),
    };
    void onAddTokenToScene(clone);
    onNotify(`Camada "${token.name}" duplicada.`);
  }

  async function handleSubmitHandout(e: React.FormEvent) {
    e.preventDefault();
    if (!hTitle.trim()) return;
    await onCreateHandout({
      title: hTitle.trim(),
      kind: hKind,
      imageUrl: hUrl.trim(),
      mediaId: hMediaId,
      body: hBody.trim(),
    });
    setHTitle('');
    setHUrl('');
    setHMediaId('');
    setHPreview('');
    setHFileName('');
    setHBody('');
    setShowHandoutForm(false);
    onNotify('Pista salva na biblioteca.');
  }

  return (
    <div className="h-full flex flex-col">
      {/* Segmented filter tabs */}
      <div className="p-3 border-b vtt-border flex items-center gap-1 vtt-subtle">
        {(
          [
            ['scenes', 'Cenas'],
            ['layers', 'Camadas & Acervo'],
            ['handouts', 'Handouts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === id ? 'vtt-accent-btn' : 'vtt-muted hover:opacity-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {tab === 'scenes' && (
          <>
            <button
              type="button"
              onClick={() => setShowSceneForm((v) => !v)}
              className="w-full py-2.5 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <ImagePlus className="w-3.5 h-3.5" />
                Nova cena (foto, GIF ou vídeo)
              </span>
              {showSceneForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showSceneForm && (
              <form onSubmit={handleSubmitScene} className="space-y-3 border vtt-border p-3.5 vtt-canvas">
                <input
                  type="text"
                  required
                  value={sceneName}
                  onChange={(e) => setSceneName(e.target.value)}
                  maxLength={100}
                  placeholder="Nome da cena (ex: Taverna, Porto, Cripta)"
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                />

                <select
                  value={sceneCategory}
                  onChange={(e) => setSceneCategory(e.target.value as SceneCategory)}
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                >
                  <option value="location">Fachada / Local</option>
                  <option value="tactical">Mapa Tático (Grid ativado)</option>
                  <option value="landscape">Paisagem Conceitual</option>
                </select>

                <MediaUploaderBox
                  label="Fundo da cena (Imagem, GIF ou Vídeo MP4/WebM)"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  buttonLabel="Escolher foto, GIF ou vídeo"
                  previewUrl={scenePreview || sceneUrl}
                  previewKind={sceneMediaKind}
                  fileName={sceneFileName}
                  externalUrl={sceneUrl}
                  uploading={uploading}
                  progress={uploadPct}
                  onPickFile={(f) =>
                    void handleFileUpload(f, 'scene', (res) => {
                      setSceneMediaId(res.mediaId);
                      setSceneUrl(res.url);
                      setSceneMediaKind(res.mediaKind);
                      setScenePreview(res.previewUrl);
                      setSceneFileName(res.fileName);
                    })
                  }
                  onChangeExternalUrl={(u) => {
                    setSceneUrl(u);
                    setSceneMediaId('');
                    setSceneMediaKind(detectSceneMediaKind(u));
                    setScenePreview('');
                    setSceneFileName('');
                  }}
                  onClearMedia={() => {
                    setSceneUrl('');
                    setSceneMediaId('');
                    setSceneMediaKind('image');
                    setScenePreview('');
                    setSceneFileName('');
                  }}
                />

                {(musicTracks.length > 0 || ambienceTracks.length > 0) && (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={sceneMusicId}
                      onChange={(e) => setSceneMusicId(e.target.value)}
                      className="px-2 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Música (opcional)</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={sceneAmbienceId}
                      onChange={(e) => setSceneAmbienceId(e.target.value)}
                      className="px-2 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Ambiente (opcional)</option>
                      {ambienceTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!sceneName.trim() || uploading}
                  className="w-full py-2.5 text-xs font-semibold vtt-accent-btn disabled:opacity-60"
                >
                  Salvar cena
                </button>
              </form>
            )}

            {/* Existing Scenes List */}
            <div className="space-y-2">
              <p className="text-xs font-semibold">Cenas da campanha ({scenes.length})</p>
              <div className="divide-y vtt-border border vtt-border">
                {scenes.map((scene) => {
                  const isActive = activeScene?.id === scene.id;
                  const catLabel =
                    scene.category === 'tactical'
                      ? 'Mapa Tático'
                      : scene.category === 'landscape'
                        ? 'Paisagem'
                        : 'Fachada / Local';
                  const kindSuffix =
                    scene.mediaKind === 'video'
                      ? ' · Vídeo'
                      : scene.mediaKind === 'gif'
                        ? ' · GIF'
                        : '';
                  return (
                    <div
                      key={scene.id}
                      className={`p-2.5 flex items-center justify-between gap-2 ${
                        isActive ? 'vtt-subtle' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectScene(scene)}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                          {isActive ? '● ' : ''}
                          {scene.mediaKind === 'video' && (
                            <Film className="w-3 h-3 vtt-accent-text shrink-0" />
                          )}
                          <span className="truncate">{scene.name}</span>
                        </p>
                        <p className="text-[11px] vtt-muted">
                          {catLabel}
                          {kindSuffix}
                          {scene.walls && scene.walls.length > 0
                            ? ` · ${scene.walls.length} muro(s)`
                            : ''}
                        </p>
                      </button>
                      {scenes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void onDeleteScene(scene.id)}
                          className="p-1.5 vtt-muted hover:text-red-700 shrink-0"
                          title="Excluir cena"
                          aria-label={`Excluir cena ${scene.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active Scene Audio Link */}
            {activeScene && (
              <div className="border vtt-border p-3.5 space-y-2.5 vtt-canvas">
                <p className="text-xs font-semibold">Trilha automática da cena ativa</p>
                <p className="text-[11px] vtt-muted truncate">{activeScene.name}</p>
                {musicTracks.length === 0 && ambienceTracks.length === 0 ? (
                  <p className="text-[11px] vtt-muted">
                    Envie músicas ou links na aba <strong>Áudio</strong> para vincular a esta cena.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      value={activeScene.linkedMusicId}
                      onChange={(e) =>
                        void onUpdateSceneAudio(activeScene, e.target.value, activeScene.linkedAmbienceId)
                      }
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Sem música vinculada</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          Música: {t.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={activeScene.linkedAmbienceId}
                      onChange={(e) =>
                        void onUpdateSceneAudio(activeScene, activeScene.linkedMusicId, e.target.value)
                      }
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Sem ambiente vinculado</option>
                      {ambienceTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          Ambiente: {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Per-Scene Specific 3D Duel Mode Background & Audio Config */}
            {activeScene && activeSceneDuelConfig && onUpdateSceneDuelConfig && (
              <div className="border vtt-border p-3.5 space-y-2.5 vtt-canvas">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    <Swords className="w-3.5 h-3.5 vtt-accent-text" />
                    Fundo 3D de Modo Duelo desta Cena
                  </p>
                  <label className="px-2 py-1 text-[11px] font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    <span>{uploading ? `${uploadPct}%` : 'Enviar Fundo 3D'}</span>
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/webm"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        void handleFileUpload(f, 'scene', (res) => {
                          onUpdateSceneDuelConfig({
                            ...activeSceneDuelConfig,
                            bgUrl: res.url,
                            bgMediaId: res.mediaId,
                            bgMediaKind: res.mediaKind,
                          });
                        });
                      }}
                    />
                  </label>
                </div>

                <p className="text-[11px] vtt-muted leading-snug">
                  Cada cena pode ter seu próprio cenário 3D e música específica quando você selecionar 2 tokens para Duelo.
                </p>

                <input
                  type="text"
                  value={
                    activeSceneDuelConfig.bgUrl.startsWith('idb://')
                      ? ''
                      : activeSceneDuelConfig.bgUrl
                  }
                  onChange={(e) =>
                    onUpdateSceneDuelConfig({
                      ...activeSceneDuelConfig,
                      bgUrl: e.target.value,
                      bgMediaId: '',
                      bgMediaKind: detectSceneMediaKind(e.target.value),
                    })
                  }
                  placeholder="Ou cole link https:// da imagem/vídeo para o Duelo 3D..."
                  className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                />

                <div className="grid grid-cols-1 gap-2">
                  <select
                    value={activeSceneDuelConfig.arenaPreset}
                    onChange={(e) =>
                      onUpdateSceneDuelConfig({
                        ...activeSceneDuelConfig,
                        arenaPreset: e.target.value as DuelArenaPresetId,
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                  >
                    {DUEL_ARENA_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        Arena 3D: {p.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={activeSceneDuelConfig.musicTrackId}
                    onChange={(e) =>
                      onUpdateSceneDuelConfig({
                        ...activeSceneDuelConfig,
                        musicTrackId: e.target.value,
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                  >
                    <option value="">Música de Duelo: Padrão / Manter</option>
                    {duelMusicTracks.length > 0 && (
                      <optgroup label="⚔️ Músicas de Modo Duelo">
                        {duelMusicTracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {musicTracks.length > 0 && (
                      <optgroup label="🎵 Músicas de Fundo">
                        {musicTracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'layers' && (
          <>
            {/* Quick Drag & Paste Tip + Asset Vault (Acervo de Fotos & Itens) */}
            <div className="border vtt-border p-3 space-y-2.5 vtt-canvas">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 vtt-accent-text" />
                  Acervo de Itens & Fotos ({vaultAssets.length})
                </p>
                <label className="px-2 py-1 text-[11px] font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1 whitespace-nowrap">
                  <Plus className="w-3 h-3" />
                  <span>{uploading ? `${uploadPct}%` : 'Guardar foto'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      void handleDirectVaultUpload(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] vtt-muted leading-relaxed">
                Arraste qualquer imagem direto para o mapa ou pressione <strong>Ctrl+V</strong> para colar. Elas ficam salvas aqui para replicar em 1 clique.
              </p>

              {vaultAssets.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-1 max-h-52 overflow-y-auto">
                  {vaultAssets.map((asset) => {
                    const thumb = vaultThumbUrls[asset.id] || asset.imageUrl;
                    return (
                      <div
                        key={asset.id}
                        className="group relative border vtt-border vtt-surface overflow-hidden flex flex-col"
                      >
                        <div className="h-16 w-full bg-stone-900 overflow-hidden relative">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={asset.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-stone-500">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => onRemoveVaultAsset(asset.id)}
                            className="absolute top-1 right-1 p-1 bg-black/75 text-stone-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remover do acervo"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="px-1.5 py-1 text-[10px] font-semibold truncate">{asset.name}</p>
                        <div className="grid grid-cols-2 border-t vtt-border text-[10px]">
                          <button
                            type="button"
                            onClick={() => void handleSpawnFromVault(asset, false)}
                            className="py-1 hover:vtt-subtle font-semibold text-center border-r vtt-border"
                            title="Colocar como imagem livre redimensionável"
                          >
                            + Foto
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSpawnFromVault(asset, true)}
                            className="py-1 hover:vtt-subtle text-center"
                            title="Colocar como token circular"
                          >
                            + Token
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quick 1-Click Add from Player Character Sheets */}
            {sheets.length > 0 && activeScene && (
              <div className="border vtt-border p-3 space-y-2 vtt-canvas">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 vtt-accent-text" />
                  Personagens da campanha
                </p>
                <div className="space-y-1.5">
                  {sheets.map((s) => {
                    const alreadyOnScene = activeScene.tokens.some((t) => t.sheetId === s.id);
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 border vtt-border vtt-surface px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{s.name}</p>
                          <p className="text-[10px] vtt-muted truncate">
                            {s.ownerName}
                            {s.subtitle ? ` · ${s.subtitle}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSpawnFromSheet(s)}
                          className="px-2.5 py-1 text-[11px] font-semibold vtt-accent-btn whitespace-nowrap shrink-0"
                        >
                          {alreadyOnScene ? '+ Outro' : '+ Colocar'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Inline Layer Editor when editing an existing layer from the sidebar */}
            {editingToken && activeScene && (
              <TokenEditorPanel
                token={editingToken}
                uploadContext={uploadContext}
                onChange={(updated) => {
                  const next = activeScene.tokens.map((t) => (t.id === updated.id ? updated : t));
                  void onUpdateSceneTokens(next);
                }}
                onTriggerHit={() => {
                  const hitTs = Date.now();
                  const next = activeScene.tokens.map((t) =>
                    t.id === editingToken.id ? { ...t, hitAtMs: hitTs } : t
                  );
                  void onUpdateSceneTokens(next);
                }}
                onShowPopup={(h) => void onProjectHandout(h)}
                onSaveToVault={onSaveTokenToVault}
                onDelete={() => {
                  const next = activeScene.tokens.filter((t) => t.id !== editingToken.id);
                  setEditingTokenId(null);
                  void onUpdateSceneTokens(next);
                }}
                onClose={() => setEditingTokenId(null)}
                onNotify={onNotify}
              />
            )}

            {/* Photoshop-Style Scene Layers Stack (Tokens, Images, Texts, Brush Strokes) */}
            {activeScene && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">
                    Camadas da cena ({activeScene.tokens.length})
                  </p>
                  {activeScene.tokens.some((t) => t.layerKind === 'brush') && (
                    <button
                      type="button"
                      onClick={() => {
                        const withoutBrushes = activeScene.tokens.filter(
                          (t) => t.layerKind !== 'brush'
                        );
                        void onUpdateSceneTokens(withoutBrushes);
                        onNotify('Traços de pincel limpos.');
                      }}
                      className="text-[11px] vtt-muted hover:underline"
                    >
                      Limpar desenhos
                    </button>
                  )}
                </div>

                {activeScene.tokens.length === 0 ? (
                  <p className="text-xs vtt-muted py-3 text-center border vtt-border vtt-canvas">
                    Nenhuma camada nesta cena. Arraste uma imagem para o mapa, use o Pincel/Texto ou crie um token abaixo.
                  </p>
                ) : (
                  <ul className="divide-y vtt-border border vtt-border vtt-surface">
                    {activeScene.tokens.map((t, index) => {
                      const kindIcon =
                        t.layerKind === 'brush' ? (
                          <Brush className="w-3.5 h-3.5 vtt-muted shrink-0" />
                        ) : t.layerKind === 'text' ? (
                          <Type className="w-3.5 h-3.5 vtt-muted shrink-0" />
                        ) : t.layerKind === 'image' || t.shape === 'rect' ? (
                          <ImageIcon className="w-3.5 h-3.5 vtt-muted shrink-0" />
                        ) : (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: t.outlineColor || t.color }}
                          />
                        );

                      return (
                        <li
                          key={t.id}
                          className="p-2 flex items-center justify-between gap-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {kindIcon}
                            <span className="truncate font-semibold">{t.name}</span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveLayerOrder(index, -1)}
                              disabled={index === 0}
                              className="p-1 vtt-muted hover:opacity-100 disabled:opacity-30"
                              title="Enviar para trás"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveLayerOrder(index, 1)}
                              disabled={index === activeScene.tokens.length - 1}
                              className="p-1 vtt-muted hover:opacity-100 disabled:opacity-30"
                              title="Trazer para frente"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateLayer(t)}
                              className="p-1 vtt-muted hover:opacity-100"
                              title="Duplicar camada"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = activeScene.tokens.map((item) =>
                                  item.id === t.id
                                    ? { ...item, hiddenFromPlayers: !item.hiddenFromPlayers }
                                    : item
                                );
                                void onUpdateSceneTokens(next);
                              }}
                              className="p-1 vtt-muted hover:opacity-100"
                              title={
                                t.hiddenFromPlayers
                                  ? 'Oculto dos jogadores (clique para mostrar)'
                                  : 'Visível para jogadores (clique para ocultar)'
                              }
                            >
                              {t.hiddenFromPlayers ? (
                                <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {t.layerKind !== 'brush' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = activeScene.tokens.map((item) =>
                                      item.id === t.id ? { ...item, locked: !item.locked } : item
                                    );
                                    void onUpdateSceneTokens(next);
                                  }}
                                  className="p-1 vtt-muted hover:opacity-100"
                                  title={t.locked ? 'Destravar camada' : 'Travar camada'}
                                >
                                  {t.locked ? (
                                    <Lock className="w-3 h-3 text-amber-600" />
                                  ) : (
                                    <Unlock className="w-3 h-3" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingTokenId((cur) => (cur === t.id ? null : t.id))
                                  }
                                  className={`px-1.5 py-1 text-[10px] border flex items-center gap-1 ${
                                    editingTokenId === t.id
                                      ? 'vtt-accent-btn border-transparent'
                                      : 'vtt-canvas vtt-border'
                                  }`}
                                >
                                  <SlidersHorizontal className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const next = activeScene.tokens.filter((item) => item.id !== t.id);
                                if (editingTokenId === t.id) setEditingTokenId(null);
                                void onUpdateSceneTokens(next);
                              }}
                              className="p-1 vtt-muted hover:text-red-700"
                              title="Excluir camada"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Collapsible Create Manual NPC / Prop Layer */}
            <div className="border-t vtt-border pt-3">
              <button
                type="button"
                onClick={() => setShowNewTokenForm((v) => !v)}
                className="w-full py-2 px-3 text-xs font-semibold border vtt-border vtt-surface flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 vtt-accent-text" />
                  Novo token ou objeto manual
                </span>
                {showNewTokenForm ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showNewTokenForm && (
                <form
                  onSubmit={handleSubmitToken}
                  className="mt-2 space-y-3 border vtt-border p-3 vtt-canvas"
                >
                  <input
                    type="text"
                    required
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    maxLength={60}
                    placeholder="Nome do NPC, criatura ou objeto"
                    className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                  />

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTokenShape('circle')}
                      className={`py-1.5 text-xs border ${
                        tokenShape === 'circle'
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-surface vtt-border'
                      }`}
                    >
                      Token Circular
                    </button>
                    <button
                      type="button"
                      onClick={() => setTokenShape('rect')}
                      className={`py-1.5 text-xs border ${
                        tokenShape === 'rect'
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-surface vtt-border'
                      }`}
                    >
                      Imagem / Objeto Livre
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {TOKEN_SWATCH_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setTokenColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${
                          tokenColor === c
                            ? 'border-stone-900 dark:border-white scale-110'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                        aria-label={`Cor ${c}`}
                      />
                    ))}
                  </div>

                  <MediaUploaderBox
                    label="Imagem (salva automaticamente no Acervo)"
                    accept="image/*"
                    buttonLabel="Escolher foto do computador"
                    previewUrl={tokenPreview || tokenUrl}
                    fileName={tokenFileName}
                    externalUrl={tokenUrl}
                    uploading={uploading}
                    progress={uploadPct}
                    onPickFile={(f) =>
                      void handleFileUpload(
                        f,
                        tokenShape === 'rect' ? 'handout' : 'token',
                        (res) => {
                          setTokenMediaId(res.mediaId);
                          setTokenUrl(res.url);
                          setTokenPreview(res.previewUrl);
                          setTokenFileName(res.fileName);
                        }
                      )
                    }
                    onChangeExternalUrl={(u) => {
                      setTokenUrl(u);
                      setTokenMediaId('');
                      setTokenPreview('');
                      setTokenFileName('');
                    }}
                    onClearMedia={() => {
                      setTokenUrl('');
                      setTokenMediaId('');
                      setTokenPreview('');
                      setTokenFileName('');
                    }}
                  />

                  <textarea
                    value={tokenNotes}
                    onChange={(e) => setTokenNotes(e.target.value)}
                    rows={2}
                    placeholder="Descrição exibida ao clicar em 'Mostrar TV'"
                    className="w-full px-3 py-2 text-xs border vtt-border vtt-surface resize-none"
                  />
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tokenHidden}
                        onChange={(e) => setTokenHidden(e.target.checked)}
                      />
                      <span>Iniciar oculto dos jogadores</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tokenVision}
                        onChange={(e) => setTokenVision(e.target.checked)}
                      />
                      <span>Emite campo de visão (respeita muros e portas)</span>
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={!tokenName.trim() || !activeScene || uploading}
                    className="w-full py-2.5 text-xs font-semibold vtt-accent-btn disabled:opacity-60"
                  >
                    Adicionar à cena
                  </button>
                </form>
              )}
            </div>
          </>
        )}

        {tab === 'handouts' && (
          <>
            {activeHandout && (
              <div className="p-3 border vtt-border vtt-subtle flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] vtt-muted">Projetado na TV agora</p>
                  <p className="text-xs font-semibold truncate">{activeHandout.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void onProjectHandout(null)}
                  className="px-3 py-1.5 text-xs font-semibold vtt-accent-btn whitespace-nowrap shrink-0"
                >
                  Recolher
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowHandoutForm((v) => !v)}
              className="w-full py-2.5 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Nova pista ou retrato pop-up
              </span>
              {showHandoutForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showHandoutForm && (
              <form onSubmit={handleSubmitHandout} className="space-y-3 border vtt-border p-3.5 vtt-canvas">
                <input
                  type="text"
                  required
                  value={hTitle}
                  onChange={(e) => setHTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Título (ex: Bilhete rasgado, Retrato da Baronesa)"
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                />
                <select
                  value={hKind}
                  onChange={(e) => setHKind(e.target.value as HandoutKind)}
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                >
                  <option value="clue">Pista</option>
                  <option value="letter">Carta / Documento</option>
                  <option value="npc">Retrato de NPC</option>
                  <option value="map">Recorte de Mapa</option>
                </select>

                <MediaUploaderBox
                  label="Imagem do handout (opcional)"
                  accept="image/*"
                  buttonLabel="Escolher foto do computador"
                  previewUrl={hPreview || hUrl}
                  fileName={hFileName}
                  externalUrl={hUrl}
                  uploading={uploading}
                  progress={uploadPct}
                  onPickFile={(f) =>
                    void handleFileUpload(f, 'handout', (res) => {
                      setHMediaId(res.mediaId);
                      setHUrl(res.url);
                      setHPreview(res.previewUrl);
                      setHFileName(res.fileName);
                    })
                  }
                  onChangeExternalUrl={(u) => {
                    setHUrl(u);
                    setHMediaId('');
                    setHPreview('');
                    setHFileName('');
                  }}
                  onClearMedia={() => {
                    setHUrl('');
                    setHMediaId('');
                    setHPreview('');
                    setHFileName('');
                  }}
                />

                <textarea
                  value={hBody}
                  onChange={(e) => setHBody(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  placeholder="Texto da carta, descrição do NPC ou pista..."
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-surface resize-y"
                />
                <button
                  type="submit"
                  disabled={!hTitle.trim() || uploading}
                  className="w-full py-2.5 text-xs font-semibold vtt-accent-btn disabled:opacity-60"
                >
                  Criar handout
                </button>
              </form>
            )}

            <div className="space-y-3">
              {handouts.length === 0 ? (
                <p className="text-xs vtt-muted py-4 text-center">
                  Nenhuma pista cadastrada ainda. Clique em &ldquo;Nova pista ou retrato pop-up&rdquo; acima.
                </p>
              ) : (
                handouts.map((h) => {
                  const isProjected = activeHandout?.id === h.id;
                  return (
                    <div key={h.id} className="border vtt-border p-3 space-y-2.5 vtt-canvas">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold font-typewriter truncate">{h.title}</p>
                          {h.body && (
                            <p className="text-[11px] vtt-muted line-clamp-2 mt-0.5">{h.body}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void onDeleteHandout(h.id)}
                          className="p-1 vtt-muted hover:text-red-700 shrink-0"
                          aria-label={`Excluir ${h.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            void onProjectHandout(
                              isProjected
                                ? null
                                : {
                                    id: h.id,
                                    title: h.title,
                                    kind: h.kind,
                                    imageUrl: h.imageUrl,
                                    mediaId: h.mediaId,
                                    body: h.body,
                                  }
                            )
                          }
                          className="px-3 py-1.5 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Maximize2 className="w-3 h-3" />
                          {isProjected ? 'Recolher da TV' : 'Mostrar para todos'}
                        </button>

                        {players.length > 0 && (
                          <div className="flex items-center gap-1 flex-1 min-w-[140px]">
                            <Send className="w-3 h-3 vtt-muted shrink-0" />
                            <select
                              value={h.targetUid === 'none' || h.targetUid === 'all' ? '' : h.targetUid}
                              onChange={(e) => {
                                const val = e.target.value || 'none';
                                void onSendHandoutToPlayer(h.id, val);
                                const target = players.find((p) => p.uid === val);
                                onNotify(
                                  target
                                    ? `Bilhete "${h.title}" enviado só para ${target.displayName}.`
                                    : `Entrega individual removida.`
                                );
                              }}
                              className="flex-1 px-2 py-1.5 text-[11px] border vtt-border vtt-surface"
                            >
                              <option value="">Enviar só para jogador...</option>
                              {players.map((p) => (
                                <option key={p.uid} value={p.uid}>
                                  Só para: {p.displayName}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
