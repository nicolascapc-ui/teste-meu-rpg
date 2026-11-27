import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Brush,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  Folder,
  FolderPlus,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  Lock,
  Maximize2,
  Package,
  Pencil,
  Plus,
  Send,
  Shield,
  SlidersHorizontal,
  Swords,
  Trash2,
  Type,
  Unlock,
  Upload,
  User,
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
  TokenCategory,
} from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { detectSceneMediaKind, type MediaOptimizeProfile } from '../lib/mediaOptimizer';
import {
  getAllDuelArenaPresets,
  loadCustomDuelPresets,
  loadSceneDuelConfig,
  saveSceneDuelConfig,
} from '../lib/duelEngine';
import {
  addVaultFolder,
  deleteVaultFolder,
  loadVaultFolders,
  moveAssetToVaultFolder,
  renameVaultFolder,
  type VaultAssetItem,
} from '../lib/assetVault';
import { TokenEditorPanel, TOKEN_SWATCH_COLORS } from './TokenEditorPanel';

function inferTokenCategory(t: SceneToken): TokenCategory {
  if (t.tokenCategory) return t.tokenCategory;
  if (t.sheetId) return 'player';
  if (t.layerKind === 'image' || t.shape === 'rect') return 'item';
  return 'npc';
}

interface ScenesHandoutsPanelProps {
  uploadContext: CampaignUploadContext;
  scenes: Scene[];
  savedSceneFolders?: string[];
  activeScene: Scene | null;
  activeSceneDuelConfig?: SceneDuelConfig;
  handouts: Handout[];
  activeHandout: ActiveHandoutProjection | null;
  audioTracks: AudioTrack[];
  members: CampaignMember[];
  sheets: CharacterSheet[];
  vaultAssets: VaultAssetItem[];
  onSelectScene: (scene: Scene) => void;
  onSaveSceneFolders?: (folders: string[]) => Promise<void>;
  onCreateScene: (data: {
    name: string;
    folder?: string;
    category: SceneCategory;
    imageUrl: string;
    mediaId: string;
    mediaKind: SceneMediaKind;
    linkedMusicId: string;
    linkedAmbienceId: string;
  }) => Promise<void>;
  onUpdateSceneMeta?: (
    scene: Scene,
    updates: {
      name: string;
      folder: string;
      category: SceneCategory;
      imageUrl: string;
      mediaId: string;
      mediaKind: SceneMediaKind;
      linkedMusicId: string;
      linkedAmbienceId: string;
    }
  ) => Promise<void>;
  onUpdateSceneAudio: (scene: Scene, musicId: string, ambienceId: string) => Promise<void>;
  onUpdateSceneDuelConfig?: (config: SceneDuelConfig) => void;
  onDeleteScene: (sceneId: string) => Promise<void>;
  onAddTokenToScene: (token: SceneToken) => Promise<void>;
  onUpdateSceneTokens: (tokens: SceneToken[]) => Promise<void>;
  onSaveTokenToVault: (token: SceneToken, folder?: string) => void;
  onRemoveVaultAsset: (assetId: string) => void;
  onSyncVaultAssets?: (nextAssets: VaultAssetItem[]) => void;
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
  savedSceneFolders,
  activeScene,
  activeSceneDuelConfig,
  handouts,
  activeHandout,
  audioTracks,
  members,
  sheets,
  vaultAssets,
  onSelectScene,
  onSaveSceneFolders,
  onCreateScene,
  onUpdateSceneMeta,
  onUpdateSceneAudio,
  onUpdateSceneDuelConfig,
  onDeleteScene,
  onAddTokenToScene,
  onUpdateSceneTokens,
  onSaveTokenToVault,
  onRemoveVaultAsset,
  onSyncVaultAssets,
  onCreateHandout,
  onProjectHandout,
  onSendHandoutToPlayer,
  onDeleteHandout,
  onNotify,
}: ScenesHandoutsPanelProps) {
  const [tab, setTab] = useState<'scenes' | 'layers' | 'handouts'>('scenes');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Collapsible forms & sub-sections (progressive disclosure with expand/collapse arrows)
  const [showSceneForm, setShowSceneForm] = useState(false);
  const [showHandoutForm, setShowHandoutForm] = useState(false);
  const [showNewTokenForm, setShowNewTokenForm] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [openAudioSection, setOpenAudioSection] = useState(false);
  const [openDuelSection, setOpenDuelSection] = useState(false);
  const [openVaultSection, setOpenVaultSection] = useState(true);
  const [openCharactersSection, setOpenCharactersSection] = useState(true);
  const [openLayersSection, setOpenLayersSection] = useState(true);

  // Scene Folders (Pastas de Cenários)
  const [activeSceneFolder, setActiveSceneFolder] = useState<string>('ALL');
  const [showNewSceneFolderInput, setShowNewSceneFolderInput] = useState(false);
  const [newSceneFolderName, setNewSceneFolderName] = useState('');

  const sceneFolders = useMemo(() => {
    const set = new Set<string>(savedSceneFolders || []);
    scenes.forEach((s) => {
      if (s.folder && s.folder.trim()) set.add(s.folder.trim());
    });
    return Array.from(set);
  }, [savedSceneFolders, scenes]);

  const filteredScenes = useMemo(() => {
    if (activeSceneFolder === 'ALL') return scenes;
    if (activeSceneFolder === '__NONE__') {
      return scenes.filter((s) => !s.folder || !s.folder.trim());
    }
    return scenes.filter((s) => (s.folder || '').trim() === activeSceneFolder);
  }, [scenes, activeSceneFolder]);

  // Dedicated Scene Edit Modal state
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editSceneName, setEditSceneName] = useState('');
  const [editSceneFolder, setEditSceneFolder] = useState('');
  const [editSceneCategory, setEditSceneCategory] = useState<SceneCategory>('location');
  const [editSceneUrl, setEditSceneUrl] = useState('');
  const [editSceneMediaId, setEditSceneMediaId] = useState('');
  const [editSceneMediaKind, setEditSceneMediaKind] = useState<SceneMediaKind>('image');
  const [editScenePreview, setEditScenePreview] = useState('');
  const [editSceneFileName, setEditSceneFileName] = useState('');
  const [editSceneMusicId, setEditSceneMusicId] = useState('');
  const [editSceneAmbienceId, setEditSceneAmbienceId] = useState('');
  const [editSceneDuelCfg, setEditSceneDuelCfg] = useState<SceneDuelConfig>({
    bgUrl: '',
    bgMediaId: '',
    bgMediaKind: 'image',
    arenaPreset: 'expedition_ruins',
    musicTrackId: '',
  });
  const [savingSceneEdit, setSavingSceneEdit] = useState(false);

  const editingSceneObj = scenes.find((s) => s.id === editingSceneId) || null;

  // Token Category filter in Camadas
  const [layerCategoryFilter, setLayerCategoryFilter] = useState<'all' | TokenCategory>('all');

  // Multi-Folder Asset Vault state (Pastas de Acervos de Tokens)
  const [vaultFolders, setVaultFolders] = useState<string[]>(() =>
    loadVaultFolders(uploadContext.campaignId)
  );
  const [activeVaultFolder, setActiveVaultFolder] = useState<string>('ALL');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');

  useEffect(() => {
    setVaultFolders(loadVaultFolders(uploadContext.campaignId));
  }, [uploadContext.campaignId, vaultAssets.length]);

  // New scene form (supports image, GIF, and MP4/WebM video + folder)
  const [sceneName, setSceneName] = useState('');
  const [sceneFolder, setSceneFolder] = useState('');
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
  const [tokenCategory, setTokenCategory] = useState<TokenCategory>('npc');
  const [tokenColor, setTokenColor] = useState(TOKEN_SWATCH_COLORS[0]);
  const [tokenUrl, setTokenUrl] = useState('');
  const [tokenMediaId, setTokenMediaId] = useState('');
  const [tokenPreview, setTokenPreview] = useState('');
  const [tokenFileName, setTokenFileName] = useState('');
  const [tokenCombatSpriteUrl, setTokenCombatSpriteUrl] = useState('');
  const [tokenCombatSpriteMediaId, setTokenCombatSpriteMediaId] = useState('');
  const [tokenCombatSpritePreview, setTokenCombatSpritePreview] = useState('');
  const [tokenCombatSpriteFileName, setTokenCombatSpriteFileName] = useState('');
  const [tokenNotes, setTokenNotes] = useState('');
  const [tokenHidden, setTokenHidden] = useState(false);
  const [tokenVision, setTokenVision] = useState(false);
  const [tokenVaultFolder, setTokenVaultFolder] = useState<string>('Tokens');

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

  function handleCreateVaultFolder(e: React.FormEvent) {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) return;
    const nextFolders = addVaultFolder(uploadContext.campaignId, clean);
    setVaultFolders(nextFolders);
    setActiveVaultFolder(clean);
    setTokenVaultFolder(clean);
    setNewFolderName('');
    setShowNewFolderInput(false);
    onNotify(`Pasta de acervo "${clean}" criada.`);
  }

  function handleConfirmRenameFolder(oldName: string) {
    const clean = renameFolderValue.trim();
    if (!clean || clean === oldName) {
      setRenamingFolder(null);
      return;
    }
    const { folders, assets } = renameVaultFolder(uploadContext.campaignId, oldName, clean);
    setVaultFolders(folders);
    onSyncVaultAssets?.(assets);
    if (activeVaultFolder === oldName) setActiveVaultFolder(clean);
    if (tokenVaultFolder === oldName) setTokenVaultFolder(clean);
    setRenamingFolder(null);
    onNotify(`Pasta renomeada para "${clean}".`);
  }

  function handleDeleteFolder(folderName: string) {
    if (vaultFolders.length <= 1) {
      onNotify('Mantenha pelo menos uma pasta no acervo.');
      return;
    }
    const { folders, assets } = deleteVaultFolder(uploadContext.campaignId, folderName);
    setVaultFolders(folders);
    onSyncVaultAssets?.(assets);
    if (activeVaultFolder === folderName) setActiveVaultFolder('ALL');
    onNotify(`Pasta "${folderName}" removida (itens movidos para "${folders[0]}").`);
  }

  function handleMoveAssetFolder(assetId: string, nextFolder: string) {
    const nextAssets = moveAssetToVaultFolder(uploadContext.campaignId, assetId, nextFolder);
    onSyncVaultAssets?.(nextAssets);
    onNotify(`Item movido para a pasta "${nextFolder}".`);
  }

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

  async function handleCreateSceneFolder(e: React.FormEvent) {
    e.preventDefault();
    const clean = newSceneFolderName.trim();
    if (!clean) return;
    const next = Array.from(new Set([...sceneFolders, clean]));
    if (onSaveSceneFolders) {
      await onSaveSceneFolders(next);
    }
    setActiveSceneFolder(clean);
    setSceneFolder(clean);
    setNewSceneFolderName('');
    setShowNewSceneFolderInput(false);
    onNotify(`Pasta de cenários "${clean}" criada.`);
  }

  async function handleDeleteSceneFolder(folderName: string) {
    const next = sceneFolders.filter((f) => f !== folderName);
    if (onSaveSceneFolders) {
      await onSaveSceneFolders(next);
    }
    if (activeSceneFolder === folderName) setActiveSceneFolder('ALL');
    // Unassign folder on scenes that belonged to it
    if (onUpdateSceneMeta) {
      const affected = scenes.filter((s) => (s.folder || '').trim() === folderName);
      for (const s of affected) {
        await onUpdateSceneMeta(s, {
          name: s.name,
          folder: '',
          category: s.category,
          imageUrl: s.imageUrl,
          mediaId: s.mediaId || '',
          mediaKind: s.mediaKind || 'image',
          linkedMusicId: s.linkedMusicId,
          linkedAmbienceId: s.linkedAmbienceId,
        });
      }
    }
    onNotify(`Pasta "${folderName}" removida (cenários mantidos em "Todas").`);
  }

  function openEditSceneModal(scene: Scene) {
    setEditingSceneId(scene.id);
    setEditSceneName(scene.name);
    setEditSceneFolder(scene.folder || '');
    setEditSceneCategory(scene.category);
    setEditSceneUrl(scene.imageUrl || '');
    setEditSceneMediaId(scene.mediaId || '');
    setEditSceneMediaKind(scene.mediaKind || 'image');
    setEditScenePreview('');
    setEditSceneFileName(scene.name);
    setEditSceneMusicId(scene.linkedMusicId || '');
    setEditSceneAmbienceId(scene.linkedAmbienceId || '');
    setEditSceneDuelCfg(loadSceneDuelConfig(uploadContext.campaignId, scene));
    void resolveMediaUrl(scene.mediaId, scene.imageUrl, uploadContext.campaignId).then((url) => {
      if (url) setEditScenePreview(url);
    });
  }

  async function handleSaveSceneEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSceneObj || !editSceneName.trim()) return;
    setSavingSceneEdit(true);
    try {
      if (onUpdateSceneMeta) {
        await onUpdateSceneMeta(editingSceneObj, {
          name: editSceneName.trim(),
          folder: editSceneFolder.trim(),
          category: editSceneCategory,
          imageUrl: editSceneUrl.trim(),
          mediaId: editSceneMediaId,
          mediaKind: editSceneMediaKind,
          linkedMusicId: editSceneMusicId,
          linkedAmbienceId: editSceneAmbienceId,
        });
      } else {
        await onUpdateSceneAudio(editingSceneObj, editSceneMusicId, editSceneAmbienceId);
      }

      saveSceneDuelConfig(uploadContext.campaignId, editingSceneObj.id, editSceneDuelCfg);
      if (activeScene?.id === editingSceneObj.id && onUpdateSceneDuelConfig) {
        onUpdateSceneDuelConfig(editSceneDuelCfg);
      }

      setEditingSceneId(null);
      onNotify(`Cena "${editSceneName.trim()}" atualizada.`);
    } finally {
      setSavingSceneEdit(false);
    }
  }

  async function handleSubmitScene(e: React.FormEvent) {
    e.preventDefault();
    if (!sceneName.trim()) return;
    await onCreateScene({
      name: sceneName.trim(),
      folder: sceneFolder.trim() || (activeSceneFolder !== 'ALL' && activeSceneFolder !== '__NONE__' ? activeSceneFolder : ''),
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
      tokenCategory: 'player',
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
      tokenCategory: asToken ? 'npc' : 'item',
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
      combatSpriteUrl: asset.combatSpriteUrl || '',
      combatSpriteMediaId: asset.combatSpriteMediaId || '',
      hiddenFromPlayers: false,
    };
    await onAddTokenToScene(created);
    onNotify(`"${asset.name}" replicado na cena!`);
  }

  async function handleDirectVaultUpload(file: File | undefined) {
    if (!file) return;
    const targetFolder =
      activeVaultFolder !== 'ALL' ? activeVaultFolder : vaultFolders[0] || 'Tokens';
    await handleFileUpload(file, 'handout', (res) => {
      const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || 'Item do Acervo';
      const tokenLike: SceneToken = {
        id: `vlt_${Date.now().toString(36)}`,
        name: cleanName,
        layerKind: 'token',
        shape: 'circle',
        x: 0.5,
        y: 0.5,
        sizePx: 64,
        widthPx: 64,
        heightPx: 64,
        color: '#8f2d2d',
        imageUrl: res.url,
        mediaId: res.mediaId,
      };
      onSaveTokenToVault(tokenLike, targetFolder);
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
      tokenCategory,
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
      combatSpriteUrl: tokenCombatSpriteUrl.trim() || '',
      combatSpriteMediaId: tokenCombatSpriteMediaId || '',
      notes: tokenNotes.trim() || '',
      hiddenFromPlayers: tokenHidden,
      visionEnabled: tokenVision,
      visionRadius: 0.34,
    };
    await onAddTokenToScene(token);
    if (token.imageUrl || token.mediaId) {
      const targetFolder =
        tokenVaultFolder || (activeVaultFolder !== 'ALL' ? activeVaultFolder : 'Tokens');
      onSaveTokenToVault(token, targetFolder);
    }
    setTokenName('');
    setTokenUrl('');
    setTokenMediaId('');
    setTokenPreview('');
    setTokenFileName('');
    setTokenCombatSpriteUrl('');
    setTokenCombatSpriteMediaId('');
    setTokenCombatSpritePreview('');
    setTokenCombatSpriteFileName('');
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

  const filteredVaultAssets =
    activeVaultFolder === 'ALL'
      ? vaultAssets
      : vaultAssets.filter((a) => (a.folder || 'Tokens') === activeVaultFolder);

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

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sceneCategory}
                    onChange={(e) => setSceneCategory(e.target.value as SceneCategory)}
                    className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                  >
                    <option value="location">Fachada / Local</option>
                    <option value="tactical">Mapa Tático (Grid)</option>
                    <option value="landscape">Paisagem</option>
                  </select>
                  <select
                    value={sceneFolder}
                    onChange={(e) => setSceneFolder(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    title="Pasta da cena"
                  >
                    <option value="">Sem pasta</option>
                    {sceneFolders.map((f) => (
                      <option key={f} value={f}>
                        Pasta: {f}
                      </option>
                    ))}
                  </select>
                </div>

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

            {/* Scene Folders Organization Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">
                  Cenas ({filteredScenes.length}/{scenes.length})
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewSceneFolderInput((v) => !v)}
                  className="px-2 py-1 text-[11px] border vtt-border vtt-surface hover:vtt-subtle flex items-center gap-1"
                  title="Organizar cenários em pastas (ex: Taverna, Masmorra, Cidade)"
                >
                  <FolderPlus className="w-3 h-3 vtt-accent-text" />
                  <span>+ Pasta</span>
                </button>
              </div>

              {showNewSceneFolderInput && (
                <form onSubmit={handleCreateSceneFolder} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    value={newSceneFolderName}
                    onChange={(e) => setNewSceneFolderName(e.target.value)}
                    placeholder="Nome da pasta (ex: Mansão, Interiores)"
                    className="flex-1 px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 text-xs font-semibold vtt-accent-btn"
                  >
                    Criar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewSceneFolderInput(false)}
                    className="px-2 py-1.5 text-xs border vtt-border vtt-surface"
                  >
                    ×
                  </button>
                </form>
              )}

              {/* Folder Filter Tabs */}
              {sceneFolders.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setActiveSceneFolder('ALL')}
                    className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                      activeSceneFolder === 'ALL'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                    }`}
                  >
                    <Folder className="w-3 h-3" />
                    Todas ({scenes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSceneFolder('__NONE__')}
                    className={`px-2 py-1 text-[11px] border ${
                      activeSceneFolder === '__NONE__'
                        ? 'vtt-accent-btn border-transparent font-semibold'
                        : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                    }`}
                  >
                    Sem pasta ({scenes.filter((s) => !s.folder?.trim()).length})
                  </button>
                  {sceneFolders.map((folder) => {
                    const count = scenes.filter((s) => (s.folder || '').trim() === folder).length;
                    const isActive = activeSceneFolder === folder;
                    return (
                      <div key={folder} className="inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => setActiveSceneFolder(folder)}
                          className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                            isActive
                              ? 'vtt-accent-btn border-transparent font-semibold'
                              : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                          }`}
                        >
                          <Folder className="w-3 h-3" />
                          <span>
                            {folder} ({count})
                          </span>
                        </button>
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteSceneFolder(folder)}
                            className="p-1 border border-l-0 vtt-border vtt-surface vtt-muted hover:text-red-500"
                            title={`Remover pasta "${folder}"`}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Existing Scenes List with Dedicated Edit Button */}
              <div className="divide-y vtt-border border vtt-border">
                {filteredScenes.length === 0 ? (
                  <p className="p-4 text-xs vtt-muted text-center">
                    Nenhuma cena nesta pasta.
                  </p>
                ) : (
                  filteredScenes.map((scene) => {
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
                          <p className="text-[11px] vtt-muted truncate">
                            {scene.folder ? `${scene.folder} · ` : ''}
                            {catLabel}
                            {kindSuffix}
                            {scene.walls && scene.walls.length > 0
                              ? ` · ${scene.walls.length} muro(s)`
                              : ''}
                          </p>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditSceneModal(scene)}
                            className="px-2 py-1 text-[11px] border vtt-border vtt-surface hover:vtt-canvas flex items-center gap-1"
                            title={`Editar configurações de "${scene.name}"`}
                          >
                            <Pencil className="w-3 h-3 vtt-accent-text" />
                            <span>Editar</span>
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
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Collapsible Sub-section: Active Scene Audio Link */}
            {activeScene && (
              <div className="border vtt-border vtt-canvas">
                <button
                  type="button"
                  onClick={() => setOpenAudioSection((v) => !v)}
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:vtt-subtle"
                >
                  <span className="text-xs font-semibold flex items-center gap-1.5 truncate">
                    {openAudioSection ? (
                      <ChevronDown className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    )}
                    <span className="truncate">Trilha da cena ativa</span>
                  </span>
                  <span className="text-[10px] vtt-muted truncate max-w-[110px]">
                    {activeScene.linkedMusicId || activeScene.linkedAmbienceId ? 'Vinculada' : 'Opcional'}
                  </span>
                </button>
                {openAudioSection && (
                  <div className="p-3 pt-0 space-y-2 border-t vtt-border mt-1 pt-2.5">
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
                            void onUpdateSceneAudio(
                              activeScene,
                              e.target.value,
                              activeScene.linkedAmbienceId
                            )
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
                            void onUpdateSceneAudio(
                              activeScene,
                              activeScene.linkedMusicId,
                              e.target.value
                            )
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
              </div>
            )}

            {/* Collapsible Sub-section: Per-Scene Specific 3D Duel Mode Background & Audio Config */}
            {activeScene && activeSceneDuelConfig && onUpdateSceneDuelConfig && (
              <div className="border vtt-border vtt-canvas">
                <button
                  type="button"
                  onClick={() => setOpenDuelSection((v) => !v)}
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:vtt-subtle"
                >
                  <span className="text-xs font-semibold flex items-center gap-1.5 truncate">
                    {openDuelSection ? (
                      <ChevronDown className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    )}
                    <Swords className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                    <span className="truncate">Cenário 3D de Duelo</span>
                  </span>
                  <span className="text-[10px] vtt-muted shrink-0">
                    {activeSceneDuelConfig.bgUrl ? 'Customizado' : 'Padrão'}
                  </span>
                </button>

                {openDuelSection && (
                  <div className="p-3 space-y-2.5 border-t vtt-border">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] vtt-muted">Fundo da arena 3D</span>
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
                        onChange={(e) => {
                          const nextId = e.target.value as DuelArenaPresetId;
                          const customObj =
                            loadCustomDuelPresets().find((c) => c.id === nextId) || null;
                          onUpdateSceneDuelConfig({
                            ...activeSceneDuelConfig,
                            arenaPreset: nextId,
                            customArenaStyle: customObj,
                          });
                        }}
                        className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                      >
                        {getAllDuelArenaPresets().map((p) => (
                          <option key={p.id} value={p.id}>
                            Cor & Partículas: {p.name}
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
                          <optgroup label="Músicas de Modo Duelo">
                            {duelMusicTracks.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {musicTracks.length > 0 && (
                          <optgroup label="Músicas de Fundo">
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
              </div>
            )}
          </>
        )}

        {tab === 'layers' && (
          <>
            {/* Collapsible Multi-Folder Asset Vault */}
            <div className="border vtt-border vtt-canvas">
              <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOpenVaultSection((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-left min-w-0"
                >
                  {openVaultSection ? (
                    <ChevronDown className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                  )}
                  <Bookmark className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                  <span className="truncate">
                    Acervos ({filteredVaultAssets.length}/{vaultAssets.length})
                  </span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenVaultSection(true);
                      setShowNewFolderInput((v) => !v);
                    }}
                    className="px-2 py-1 text-[11px] border vtt-border vtt-surface hover:opacity-80 flex items-center gap-1 whitespace-nowrap"
                    title="Criar nova pasta de acervo de tokens"
                  >
                    <FolderPlus className="w-3 h-3 vtt-accent-text" />
                    <span>+ Pasta</span>
                  </button>
                  <label className="px-2 py-1 text-[11px] font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1 whitespace-nowrap">
                    <Plus className="w-3 h-3" />
                    <span>{uploading ? `${uploadPct}%` : 'Guardar'}</span>
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
              </div>
              {openVaultSection && (
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t vtt-border">

              {/* Create New Vault Folder Inline Form */}
              {showNewFolderInput && (
                <form onSubmit={handleCreateVaultFolder} className="flex items-center gap-1.5 pt-1">
                  <input
                    type="text"
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Nome da pasta (ex: Chefes, Guardas, Magias)"
                    className="flex-1 px-2.5 py-1 text-xs border vtt-border vtt-surface"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-xs font-semibold vtt-accent-btn"
                  >
                    Criar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewFolderInput(false)}
                    className="px-2 py-1 text-xs border vtt-border vtt-surface"
                  >
                    ×
                  </button>
                </form>
              )}

              {/* Sectorized Folder Tabs */}
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                <button
                  type="button"
                  onClick={() => setActiveVaultFolder('ALL')}
                  className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                    activeVaultFolder === 'ALL'
                      ? 'vtt-accent-btn border-transparent font-semibold'
                      : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                  }`}
                >
                  <Folder className="w-3 h-3" />
                  <span>Todas ({vaultAssets.length})</span>
                </button>
                {vaultFolders.map((folder) => {
                  const count = vaultAssets.filter(
                    (a) => (a.folder || 'Tokens') === folder
                  ).length;
                  const isActive = activeVaultFolder === folder;
                  return (
                    <div key={folder} className="inline-flex items-center">
                      {renamingFolder === folder ? (
                        <div className="flex items-center border vtt-border vtt-surface px-1 py-0.5">
                          <input
                            type="text"
                            autoFocus
                            value={renameFolderValue}
                            onChange={(e) => setRenameFolderValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleConfirmRenameFolder(folder);
                              if (e.key === 'Escape') setRenamingFolder(null);
                            }}
                            className="w-24 text-[11px] bg-transparent focus:outline-none px-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleConfirmRenameFolder(folder)}
                            className="text-[10px] font-bold px-1 text-emerald-500"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveVaultFolder(folder)}
                          className={`px-2 py-1 text-[11px] border flex items-center gap-1 ${
                            isActive
                              ? 'vtt-accent-btn border-transparent font-semibold'
                              : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                          }`}
                        >
                          <Folder className="w-3 h-3" />
                          <span>
                            {folder} ({count})
                          </span>
                        </button>
                      )}
                      {isActive && renamingFolder !== folder && (
                        <div className="flex items-center border border-l-0 vtt-border vtt-surface">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingFolder(folder);
                              setRenameFolderValue(folder);
                            }}
                            className="p-1 vtt-muted hover:opacity-100"
                            title="Renomear pasta"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                          {vaultFolders.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(folder)}
                              className="p-1 vtt-muted hover:text-red-500"
                              title="Excluir pasta"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] vtt-muted leading-relaxed">
                <strong>Arraste qualquer card abaixo direto para o mapa</strong> para posicioná-lo onde quiser antes de soltar (ou clique em + Token / + Foto).
              </p>

              {filteredVaultAssets.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 pt-1 max-h-60 overflow-y-auto">
                  {filteredVaultAssets.map((asset) => {
                    const thumb = vaultThumbUrls[asset.id] || asset.imageUrl;
                    return (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData(
                            'application/x-folio-token',
                            JSON.stringify({
                              name: asset.name,
                              layerKind: asset.defaultKind === 'image' ? 'image' : 'token',
                              shape: asset.defaultKind === 'image' ? 'rect' : 'circle',
                              widthPx:
                                asset.defaultKind === 'image' ? asset.widthPx || 120 : 58,
                              heightPx:
                                asset.defaultKind === 'image' ? asset.heightPx || 120 : 58,
                              sizePx:
                                asset.defaultKind === 'image'
                                  ? Math.max(asset.widthPx || 120, asset.heightPx || 120)
                                  : 58,
                              color: '#8f2d2d',
                              outlineStyle: asset.defaultKind === 'image' ? 'none' : 'solid',
                              outlineColor: '#8f2d2d',
                              imageUrl: asset.imageUrl,
                              mediaId: asset.mediaId,
                              combatSpriteUrl: asset.combatSpriteUrl || '',
                              combatSpriteMediaId: asset.combatSpriteMediaId || '',
                            })
                          );
                        }}
                        className="group relative border vtt-border vtt-surface overflow-hidden flex flex-col cursor-grab active:cursor-grabbing"
                        title="Arraste direto para o mapa onde deseja posicionar!"
                      >
                        <div className="h-16 w-full bg-stone-900 overflow-hidden relative">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={asset.name}
                              referrerPolicy="no-referrer"
                              draggable={false}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-stone-500">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                          <span className="absolute top-1 left-1 px-1 py-0.5 bg-black/75 text-[9px] text-amber-300 flex items-center gap-0.5 pointer-events-none">
                            <GripVertical className="w-2.5 h-2.5" />
                            Arrastar
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemoveVaultAsset(asset.id)}
                            className="absolute top-1 right-1 p-1 bg-black/75 text-stone-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remover do acervo"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="px-1.5 pt-1 text-[10px] font-semibold truncate">
                          {asset.name}
                        </p>
                        {/* Sector Folder Mover Dropdown */}
                        <div className="px-1 pb-1">
                          <select
                            value={asset.folder || 'Tokens'}
                            onChange={(e) => handleMoveAssetFolder(asset.id, e.target.value)}
                            className="w-full text-[9px] px-1 py-0.5 border vtt-border vtt-canvas vtt-muted"
                            title="Mover para outra pasta do acervo"
                          >
                            {vaultFolders.map((f) => (
                              <option key={f} value={f}>
                                📁 {f}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 border-t vtt-border text-[10px]">
                          <button
                            type="button"
                            onClick={() => void handleSpawnFromVault(asset, true)}
                            className="py-1 hover:vtt-subtle font-semibold text-center border-r vtt-border"
                            title="Colocar como token circular"
                          >
                            + Token
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSpawnFromVault(asset, false)}
                            className="py-1 hover:vtt-subtle text-center"
                            title="Colocar como imagem livre redimensionável"
                          >
                            + Foto
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] vtt-muted py-3 text-center border border-dashed vtt-border">
                  Nenhum token/item nesta pasta. Clique em <strong>Guardar</strong> ou salve tokens do mapa no Acervo.
                </p>
              )}
                </div>
              )}
            </div>

            {/* Collapsible Quick Add / Drag from Character Sheets */}
            {sheets.length > 0 && activeScene && (
              <div className="border vtt-border vtt-canvas">
                <button
                  type="button"
                  onClick={() => setOpenCharactersSection((v) => !v)}
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:vtt-subtle"
                >
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    {openCharactersSection ? (
                      <ChevronDown className="w-3.5 h-3.5 vtt-accent-text" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 vtt-accent-text" />
                    )}
                    <UserCheck className="w-3.5 h-3.5 vtt-accent-text" />
                    Personagens ({sheets.length})
                  </span>
                  <span className="text-[10px] vtt-muted">Arraste ou clique</span>
                </button>
                {openCharactersSection && (
                  <div className="px-3 pb-3 pt-2 border-t vtt-border space-y-1.5">
                    {sheets.map((s) => {
                      const alreadyOnScene = activeScene.tokens.some((t) => t.sheetId === s.id);
                      return (
                        <div
                          key={s.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData(
                              'application/x-folio-token',
                              JSON.stringify({
                                name: s.name,
                                layerKind: 'token',
                                tokenCategory: 'player',
                                shape: 'circle',
                                sheetId: s.id,
                                widthPx: 54,
                                heightPx: 54,
                                sizePx: 54,
                                color: '#2f5d46',
                                outlineStyle: 'solid',
                                outlineColor: '#2f5d46',
                                imageUrl: s.avatarUrl || '',
                                mediaId: s.avatarMediaId || '',
                                notes: s.subtitle || '',
                                visionEnabled:
                                  activeScene.category === 'tactical' ||
                                  Boolean(activeScene.dynamicVision),
                                visionRadius: 0.34,
                              })
                            );
                          }}
                          className="flex items-center justify-between gap-2 border vtt-border vtt-surface px-2.5 py-1.5 cursor-grab active:cursor-grabbing"
                          title="Arraste este personagem direto para o ponto do mapa onde deseja posicioná-lo!"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <GripVertical className="w-3.5 h-3.5 vtt-muted shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{s.name}</p>
                              <p className="text-[10px] vtt-muted truncate">
                                {s.ownerName}
                                {s.subtitle ? ` · ${s.subtitle}` : ''}
                              </p>
                            </div>
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
                )}
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
                onSaveToVault={(tok) =>
                  onSaveTokenToVault(
                    tok,
                    activeVaultFolder !== 'ALL' ? activeVaultFolder : undefined
                  )
                }
                onDelete={() => {
                  const next = activeScene.tokens.filter((t) => t.id !== editingToken.id);
                  setEditingTokenId(null);
                  void onUpdateSceneTokens(next);
                }}
                onClose={() => setEditingTokenId(null)}
                onNotify={onNotify}
              />
            )}

            {/* Collapsible Photoshop-Style Scene Layers Stack with Player / NPC / Item Categorization */}
            {activeScene && (
              <div className="border vtt-border vtt-canvas">
                <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenLayersSection((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-left"
                  >
                    {openLayersSection ? (
                      <ChevronDown className="w-3.5 h-3.5 vtt-accent-text" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 vtt-accent-text" />
                    )}
                    Camadas da cena ({activeScene.tokens.length})
                  </button>
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

                {openLayersSection && (
                  <div className="px-3 pb-3 pt-2 border-t vtt-border space-y-2">
                    {/* Category Filter Tabs (Todos / Players / NPCs / Itens) */}
                    {activeScene.tokens.length > 0 && (
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            ['all', 'Todos'],
                            ['player', 'Players'],
                            ['npc', 'NPCs'],
                            ['item', 'Itens'],
                          ] as const
                        ).map(([catId, label]) => (
                          <button
                            key={catId}
                            type="button"
                            onClick={() => setLayerCategoryFilter(catId)}
                            className={`py-1 text-[10px] border transition-colors ${
                              layerCategoryFilter === catId
                                ? 'vtt-accent-btn border-transparent font-semibold'
                                : 'vtt-surface vtt-border vtt-muted hover:opacity-100'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}

                    {activeScene.tokens.length === 0 ? (
                      <p className="text-xs vtt-muted py-3 text-center">
                        Nenhuma camada nesta cena. Arraste um token do Acervo ou da Ficha para o mapa.
                      </p>
                    ) : (
                      <ul className="divide-y vtt-border border vtt-border vtt-surface">
                        {activeScene.tokens
                          .map((t, index) => ({ t, index }))
                          .filter(({ t }) => {
                            if (layerCategoryFilter === 'all') return true;
                            if (t.layerKind === 'brush' || t.layerKind === 'text') return false;
                            return inferTokenCategory(t) === layerCategoryFilter;
                          })
                          .map(({ t, index }) => {
                            const cat = inferTokenCategory(t);
                            const catTag =
                              t.layerKind === 'brush'
                                ? 'Traço'
                                : t.layerKind === 'text'
                                  ? 'Texto'
                                  : cat === 'player'
                                    ? 'Player'
                                    : cat === 'item'
                                      ? 'Item'
                                      : 'NPC';
                            const kindIcon =
                              t.layerKind === 'brush' ? (
                                <Brush className="w-3.5 h-3.5 vtt-muted shrink-0" />
                              ) : t.layerKind === 'text' ? (
                                <Type className="w-3.5 h-3.5 vtt-muted shrink-0" />
                              ) : cat === 'item' ? (
                                <Package className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              ) : cat === 'player' ? (
                                <User className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : (
                                <Shield className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              );

                            return (
                              <li
                                key={t.id}
                                className="p-2 flex items-center justify-between gap-1.5 text-xs"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {kindIcon}
                                  <span className="truncate font-semibold">{t.name}</span>
                                  <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 border vtt-border vtt-canvas vtt-muted shrink-0">
                                    {catTag}
                                  </span>
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
                                            item.id === t.id
                                              ? { ...item, locked: !item.locked }
                                              : item
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
                                      const next = activeScene.tokens.filter(
                                        (item) => item.id !== t.id
                                      );
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
              </div>
            )}

            {/* Collapsible Create Manual NPC / Prop Layer (Supports Dragging Token to Map Before Placing!) */}
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
                      onClick={() => {
                        setTokenShape('circle');
                        if (tokenCategory === 'item') setTokenCategory('npc');
                      }}
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
                      onClick={() => {
                        setTokenShape('rect');
                        setTokenCategory('item');
                      }}
                      className={`py-1.5 text-xs border ${
                        tokenShape === 'rect'
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-surface vtt-border'
                      }`}
                    >
                      Imagem / Objeto Livre
                    </button>
                  </div>

                  {/* Token Category Selector: Player / NPC / Item */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold vtt-muted">Categoria</span>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          ['player', 'Player'],
                          ['npc', 'NPC'],
                          ['item', 'Item / Elem.'],
                        ] as const
                      ).map(([catId, label]) => (
                        <button
                          key={catId}
                          type="button"
                          onClick={() => setTokenCategory(catId)}
                          className={`py-1.5 text-[11px] border ${
                            tokenCategory === catId
                              ? 'vtt-accent-btn border-transparent font-semibold'
                              : 'vtt-surface vtt-border'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
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

                  {/* Select Vault Folder to Save Token Into */}
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold vtt-muted">
                      Pasta do Acervo para salvar:
                    </span>
                    <select
                      value={tokenVaultFolder}
                      onChange={(e) => setTokenVaultFolder(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                    >
                      {vaultFolders.map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                  </label>

                  <MediaUploaderBox
                    label="Imagem (salva automaticamente na pasta do Acervo)"
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

                  <MediaUploaderBox
                    label="Foto de Combate (PNG Corpo Todo — opcional, recorte automático no Duelo 3D)"
                    accept="image/png,image/webp,image/*"
                    buttonLabel="Enviar PNG corpo todo para combate"
                    previewUrl={tokenCombatSpritePreview || tokenCombatSpriteUrl}
                    fileName={tokenCombatSpriteFileName}
                    externalUrl={tokenCombatSpriteUrl}
                    uploading={uploading}
                    progress={uploadPct}
                    onPickFile={(f) =>
                      void handleFileUpload(f, 'combat_sprite', (res) => {
                        setTokenCombatSpriteMediaId(res.mediaId);
                        setTokenCombatSpriteUrl(res.url);
                        setTokenCombatSpritePreview(res.previewUrl);
                        setTokenCombatSpriteFileName(res.fileName);
                      })
                    }
                    onChangeExternalUrl={(u) => {
                      setTokenCombatSpriteUrl(u);
                      setTokenCombatSpriteMediaId('');
                      setTokenCombatSpritePreview('');
                      setTokenCombatSpriteFileName('');
                    }}
                    onClearMedia={() => {
                      setTokenCombatSpriteUrl('');
                      setTokenCombatSpriteMediaId('');
                      setTokenCombatSpritePreview('');
                      setTokenCombatSpriteFileName('');
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

                  {/* Draggable Live Token Preview Card: Drag onto map to place anywhere before clicking Add! */}
                  <div
                    draggable
                    onDragStart={(e) => {
                      const isRect = tokenShape === 'rect';
                      const baseSize = isRect ? 120 : 54;
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData(
                        'application/x-folio-token',
                        JSON.stringify({
                          name: tokenName.trim() || 'Novo Token',
                          layerKind: isRect ? 'image' : 'token',
                          tokenCategory,
                          shape: tokenShape,
                          sizePx: baseSize,
                          widthPx: baseSize,
                          heightPx: baseSize,
                          color: tokenColor,
                          outlineStyle: isRect ? 'none' : 'solid',
                          outlineColor: tokenColor,
                          shadow: 'soft',
                          imageUrl: tokenUrl.trim() || '',
                          mediaId: tokenMediaId || '',
                          combatSpriteUrl: tokenCombatSpriteUrl.trim() || '',
                          combatSpriteMediaId: tokenCombatSpriteMediaId || '',
                          notes: tokenNotes.trim() || '',
                          hiddenFromPlayers: tokenHidden,
                          visionEnabled: tokenVision,
                          visionRadius: 0.34,
                          saveToVaultOnDrop: true,
                        })
                      );
                    }}
                    className="p-2.5 border border-dashed border-amber-500/80 vtt-surface flex items-center justify-between gap-2.5 cursor-grab active:cursor-grabbing"
                    title="Arraste esta prévia direto para o mapa onde quiser posicionar o token!"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 shrink-0 overflow-hidden flex items-center justify-center text-xs font-bold text-white border-2 ${
                          tokenShape === 'rect' ? 'rounded-none' : 'rounded-full'
                        }`}
                        style={{
                          backgroundColor: tokenColor,
                          borderColor: tokenColor,
                        }}
                      >
                        {tokenPreview || tokenUrl ? (
                          <img
                            src={tokenPreview || tokenUrl}
                            alt="Prévia"
                            draggable={false}
                            className="w-full h-full object-cover pointer-events-none"
                          />
                        ) : (
                          (tokenName.trim() || 'TK').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {tokenName.trim() || 'Arraste para posicionar no mapa'}
                        </p>
                        <p className="text-[10px] vtt-muted">
                          Segure e arraste este bloco até o ponto desejado da cena
                        </p>
                      </div>
                    </div>
                    <GripVertical className="w-4 h-4 vtt-accent-text shrink-0" />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={(!tokenUrl.trim() && !tokenMediaId) || uploading}
                      onClick={() => {
                        const isRect = tokenShape === 'rect';
                        const baseSize = isRect ? 120 : 54;
                        const vaultOnlyToken: SceneToken = {
                          id: `vlt_${Date.now().toString(36)}`,
                          name: tokenName.trim() || 'Token do Acervo',
                          layerKind: isRect ? 'image' : 'token',
                          shape: tokenShape,
                          x: 0.5,
                          y: 0.5,
                          sizePx: baseSize,
                          widthPx: baseSize,
                          heightPx: baseSize,
                          color: tokenColor,
                          imageUrl: tokenUrl.trim() || '',
                          mediaId: tokenMediaId || '',
                          combatSpriteUrl: tokenCombatSpriteUrl.trim() || '',
                          combatSpriteMediaId: tokenCombatSpriteMediaId || '',
                        };
                        onSaveTokenToVault(vaultOnlyToken, tokenVaultFolder);
                      }}
                      className="py-2.5 px-2 text-xs font-semibold border vtt-border vtt-surface hover:opacity-85 disabled:opacity-50"
                    >
                      Só Guardar no Acervo
                    </button>
                    <button
                      type="submit"
                      disabled={!tokenName.trim() || !activeScene || uploading}
                      className="py-2.5 px-2 text-xs font-semibold vtt-accent-btn disabled:opacity-60"
                    >
                      Adicionar ao Centro
                    </button>
                  </div>
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

      {/* Dedicated Visual Scene Edit Modal */}
      {editingSceneObj && (
        <div
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEditingSceneId(null)}
        >
          <form
            onSubmit={handleSaveSceneEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] vtt-surface border vtt-border shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b vtt-border vtt-subtle flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider vtt-muted">Configurações da Cena</p>
                <h2 className="text-sm font-bold font-typewriter truncate">
                  Editar Cena: {editingSceneObj.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingSceneId(null)}
                className="p-1.5 border vtt-border vtt-canvas hover:vtt-subtle"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Section 1: General Info & Background Media */}
              <div className="space-y-3 border vtt-border p-3.5 vtt-canvas">
                <p className="text-[11px] font-bold uppercase tracking-wider vtt-muted">
                  Geral & Cenário
                </p>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Nome da Cena</span>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={editSceneName}
                    onChange={(e) => setEditSceneName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Pasta</span>
                    <select
                      value={editSceneFolder}
                      onChange={(e) => setEditSceneFolder(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Sem pasta</option>
                      {sceneFolders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Categoria</span>
                    <select
                      value={editSceneCategory}
                      onChange={(e) => setEditSceneCategory(e.target.value as SceneCategory)}
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="location">Fachada / Local</option>
                      <option value="tactical">Mapa Tático (Grid)</option>
                      <option value="landscape">Paisagem Conceitual</option>
                    </select>
                  </label>
                </div>

                <MediaUploaderBox
                  label="Fundo da Cena (Foto, GIF ou Vídeo MP4/WebM)"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  buttonLabel="Trocar foto, GIF ou vídeo"
                  previewUrl={editScenePreview || editSceneUrl}
                  previewKind={editSceneMediaKind}
                  fileName={editSceneFileName}
                  externalUrl={editSceneUrl}
                  uploading={uploading}
                  progress={uploadPct}
                  onPickFile={(f) =>
                    void handleFileUpload(f, 'scene', (res) => {
                      setEditSceneMediaId(res.mediaId);
                      setEditSceneUrl(res.url);
                      setEditSceneMediaKind(res.mediaKind);
                      setEditScenePreview(res.previewUrl);
                      setEditSceneFileName(res.fileName);
                    })
                  }
                  onChangeExternalUrl={(u) => {
                    setEditSceneUrl(u);
                    setEditSceneMediaId('');
                    setEditSceneMediaKind(detectSceneMediaKind(u));
                    setEditScenePreview('');
                    setEditSceneFileName('');
                  }}
                  onClearMedia={() => {
                    setEditSceneUrl('');
                    setEditSceneMediaId('');
                    setEditSceneMediaKind('image');
                    setEditScenePreview('');
                    setEditSceneFileName('');
                  }}
                />
              </div>

              {/* Section 2: Linked Audio */}
              <div className="space-y-3 border vtt-border p-3.5 vtt-canvas">
                <p className="text-[11px] font-bold uppercase tracking-wider vtt-muted">
                  Trilha Automática da Cena
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Música de Fundo</span>
                    <select
                      value={editSceneMusicId}
                      onChange={(e) => setEditSceneMusicId(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Nenhuma</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Ambiente</span>
                    <select
                      value={editSceneAmbienceId}
                      onChange={(e) => setEditSceneAmbienceId(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Nenhum</option>
                      {ambienceTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Section 3: 3D Duel Arena Settings for this Scene */}
              <div className="space-y-3 border vtt-border p-3.5 vtt-canvas">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider vtt-muted flex items-center gap-1.5">
                    <Swords className="w-3.5 h-3.5 vtt-accent-text" />
                    Modo Duelo 3D desta Cena
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
                          setEditSceneDuelCfg((prev) => ({
                            ...prev,
                            bgUrl: res.url,
                            bgMediaId: res.mediaId,
                            bgMediaKind: res.mediaKind,
                          }));
                        });
                      }}
                    />
                  </label>
                </div>

                <input
                  type="text"
                  value={editSceneDuelCfg.bgUrl.startsWith('idb://') ? '' : editSceneDuelCfg.bgUrl}
                  onChange={(e) =>
                    setEditSceneDuelCfg((prev) => ({
                      ...prev,
                      bgUrl: e.target.value,
                      bgMediaId: '',
                      bgMediaKind: detectSceneMediaKind(e.target.value),
                    }))
                  }
                  placeholder="Link https:// da imagem ou vídeo de fundo do Duelo 3D..."
                  className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Cor & Partículas</span>
                    <select
                      value={editSceneDuelCfg.arenaPreset}
                      onChange={(e) => {
                        const nextId = e.target.value as DuelArenaPresetId;
                        const customObj =
                          loadCustomDuelPresets().find((c) => c.id === nextId) || null;
                        setEditSceneDuelCfg((prev) => ({
                          ...prev,
                          arenaPreset: nextId,
                          customArenaStyle: customObj,
                        }));
                      }}
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      {getAllDuelArenaPresets().map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Música de Duelo</span>
                    <select
                      value={editSceneDuelCfg.musicTrackId}
                      onChange={(e) =>
                        setEditSceneDuelCfg((prev) => ({
                          ...prev,
                          musicTrackId: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface"
                    >
                      <option value="">Padrão / Manter</option>
                      {duelMusicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          [Duelo] {t.name}
                        </option>
                      ))}
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t vtt-border vtt-subtle flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingSceneId(null)}
                className="px-3.5 py-2 text-xs border vtt-border vtt-surface"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!editSceneName.trim() || savingSceneEdit || uploading}
                className="px-4 py-2 text-xs font-semibold vtt-accent-btn disabled:opacity-50"
              >
                {savingSceneEdit ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
