import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  Link2,
  Maximize2,
  Plus,
  Send,
  SlidersHorizontal,
  Trash2,
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
  Handout,
  HandoutKind,
  Scene,
  SceneCategory,
  SceneMediaKind,
  SceneToken,
} from '../types/vtt';
import { uploadMediaFile, type CampaignUploadContext } from '../lib/mediaStore';
import { detectSceneMediaKind, type MediaOptimizeProfile } from '../lib/mediaOptimizer';
import { TokenEditorPanel, TOKEN_SWATCH_COLORS } from './TokenEditorPanel';

interface ScenesHandoutsPanelProps {
  uploadContext: CampaignUploadContext;
  scenes: Scene[];
  activeScene: Scene | null;
  handouts: Handout[];
  activeHandout: ActiveHandoutProjection | null;
  audioTracks: AudioTrack[];
  members: CampaignMember[];
  sheets: CharacterSheet[];
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
  onDeleteScene: (sceneId: string) => Promise<void>;
  onAddTokenToScene: (token: SceneToken) => Promise<void>;
  onUpdateSceneTokens: (tokens: SceneToken[]) => Promise<void>;
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
  handouts,
  activeHandout,
  audioTracks,
  members,
  sheets,
  onSelectScene,
  onCreateScene,
  onUpdateSceneAudio,
  onDeleteScene,
  onAddTokenToScene,
  onUpdateSceneTokens,
  onCreateHandout,
  onProjectHandout,
  onSendHandoutToPlayer,
  onDeleteHandout,
  onNotify,
}: ScenesHandoutsPanelProps) {
  const [tab, setTab] = useState<'scenes' | 'handouts' | 'tokens'>('scenes');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Collapsible forms for calm, uncluttered UX
  const [showSceneForm, setShowSceneForm] = useState(false);
  const [showHandoutForm, setShowHandoutForm] = useState(false);
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

  // New manual token form
  const [tokenName, setTokenName] = useState('');
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

  const musicTracks = audioTracks.filter((t) => t.layer === 'music');
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
      sheetId: sheet.id,
      x: Number((0.44 + offset).toFixed(3)),
      y: Number((0.5 + (offset % 0.08)).toFixed(3)),
      sizePx: 50,
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

  async function handleSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim() || !activeScene) return;
    const token: SceneToken = {
      id: `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: tokenName.trim(),
      x: 0.5,
      y: 0.5,
      sizePx: 50,
      color: tokenColor,
      outlineStyle: 'solid',
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
    setTokenName('');
    setTokenUrl('');
    setTokenMediaId('');
    setTokenPreview('');
    setTokenFileName('');
    setTokenNotes('');
    setTokenHidden(false);
    setTokenVision(false);
    onNotify(`Token "${token.name}" colocado no centro da cena.`);
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
            ['handouts', 'Handouts'],
            ['tokens', 'Tokens'],
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

        {tab === 'tokens' && (
          <>
            {/* Quick 1-Click Add from Player Character Sheets */}
            {sheets.length > 0 && activeScene && (
              <div className="border vtt-border p-3 space-y-2 vtt-canvas">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 vtt-accent-text" />
                  Adicionar das fichas dos jogadores
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

            {/* Inline Token Editor when editing an existing token from the sidebar */}
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
                onDelete={() => {
                  const next = activeScene.tokens.filter((t) => t.id !== editingToken.id);
                  setEditingTokenId(null);
                  void onUpdateSceneTokens(next);
                }}
                onClose={() => setEditingTokenId(null)}
                onNotify={onNotify}
              />
            )}

            {/* Existing Scene Tokens List with 1-click Edit Appearance */}
            {activeScene && activeScene.tokens.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold">Tokens nesta cena ({activeScene.tokens.length})</p>
                <p className="text-[11px] vtt-muted">
                  Clique com o <strong>botão direito</strong> no token no mapa ou clique em <strong>Editar</strong> abaixo.
                </p>
                <ul className="divide-y vtt-border border vtt-border">
                  {activeScene.tokens.map((t) => (
                    <li key={t.id} className="p-2 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: t.outlineColor || t.color }}
                        />
                        <span className="truncate font-semibold">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] vtt-muted flex items-center gap-0.5">
                          {t.hiddenFromPlayers ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTokenId((cur) => (cur === t.id ? null : t.id))
                          }
                          className={`px-2 py-1 text-[11px] border flex items-center gap-1 whitespace-nowrap ${
                            editingTokenId === t.id
                              ? 'vtt-accent-btn border-transparent'
                              : 'vtt-canvas vtt-border'
                          }`}
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          Editar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Create Manual NPC / Prop Token */}
            <form onSubmit={handleSubmitToken} className="space-y-3 border-t vtt-border pt-4">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 vtt-accent-text" />
                Criar novo token avulso (NPC / Inimigo)
              </p>
              <input
                type="text"
                required
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                maxLength={60}
                placeholder="Nome do personagem, NPC ou pista"
                className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
              />
              <div className="flex items-center gap-2">
                {TOKEN_SWATCH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTokenColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${
                      tokenColor === c ? 'border-stone-900 dark:border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>

              <MediaUploaderBox
                label="Retrato do token (otimizado automaticamente)"
                accept="image/*"
                buttonLabel="Escolher foto do computador"
                previewUrl={tokenPreview || tokenUrl}
                fileName={tokenFileName}
                externalUrl={tokenUrl}
                uploading={uploading}
                progress={uploadPct}
                onPickFile={(f) =>
                  void handleFileUpload(f, 'token', (res) => {
                    setTokenMediaId(res.mediaId);
                    setTokenUrl(res.url);
                    setTokenPreview(res.previewUrl);
                    setTokenFileName(res.fileName);
                  })
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
                placeholder="Descrição exibida ao clicar em 'Mostrar TV' no token"
                className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas resize-none"
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
                Adicionar ao centro da cena
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
