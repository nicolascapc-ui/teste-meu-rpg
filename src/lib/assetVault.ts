export interface VaultAssetItem {
  id: string;
  name: string;
  imageUrl: string;
  mediaId: string;
  combatSpriteUrl?: string;
  combatSpriteMediaId?: string;
  defaultKind: 'image' | 'token';
  widthPx: number;
  heightPx: number;
  folder: string;
  createdAtMs: number;
}

export const DEFAULT_VAULT_FOLDERS = [
  'Tokens',
  'NPCs & Monstros',
  'Jogadores',
  'Itens & Props',
];

function getVaultKey(campaignId: string): string {
  return `folio_vtt_vault_${campaignId}`;
}

function getVaultFoldersKey(campaignId: string): string {
  return `folio_vtt_vault_folders_${campaignId}`;
}

export function loadVaultFolders(campaignId: string): string[] {
  try {
    const raw = localStorage.getItem(getVaultFoldersKey(campaignId));
    if (!raw) return [...DEFAULT_VAULT_FOLDERS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_VAULT_FOLDERS];
    const cleaned = parsed
      .map((f) => String(f || '').trim())
      .filter((f) => f.length > 0);
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...DEFAULT_VAULT_FOLDERS];
  } catch {
    return [...DEFAULT_VAULT_FOLDERS];
  }
}

export function saveVaultFolders(campaignId: string, folders: string[]): string[] {
  const cleaned = Array.from(
    new Set(folders.map((f) => f.trim()).filter((f) => f.length > 0))
  );
  const finalFolders = cleaned.length > 0 ? cleaned : [...DEFAULT_VAULT_FOLDERS];
  try {
    localStorage.setItem(getVaultFoldersKey(campaignId), JSON.stringify(finalFolders));
  } catch {
    // Ignore storage quota warnings
  }
  return finalFolders;
}

export function addVaultFolder(campaignId: string, folderName: string): string[] {
  const clean = folderName.trim().slice(0, 36);
  if (!clean) return loadVaultFolders(campaignId);
  const current = loadVaultFolders(campaignId);
  if (current.some((f) => f.toLowerCase() === clean.toLowerCase())) {
    return current;
  }
  return saveVaultFolders(campaignId, [...current, clean]);
}

export function renameVaultFolder(
  campaignId: string,
  oldName: string,
  newName: string
): { folders: string[]; assets: VaultAssetItem[] } {
  const cleanNew = newName.trim().slice(0, 36);
  const currentFolders = loadVaultFolders(campaignId);
  const currentAssets = loadVaultAssets(campaignId);
  if (!cleanNew || oldName === cleanNew) {
    return { folders: currentFolders, assets: currentAssets };
  }
  const nextFolders = saveVaultFolders(
    campaignId,
    currentFolders.map((f) => (f === oldName ? cleanNew : f))
  );
  const nextAssets = currentAssets.map((a) =>
    (a.folder || 'Tokens') === oldName ? { ...a, folder: cleanNew } : a
  );
  try {
    localStorage.setItem(getVaultKey(campaignId), JSON.stringify(nextAssets));
  } catch {
    // Ignore
  }
  return { folders: nextFolders, assets: nextAssets };
}

export function deleteVaultFolder(
  campaignId: string,
  folderName: string
): { folders: string[]; assets: VaultAssetItem[] } {
  const currentFolders = loadVaultFolders(campaignId);
  const remaining = currentFolders.filter((f) => f !== folderName);
  const nextFolders = saveVaultFolders(
    campaignId,
    remaining.length > 0 ? remaining : ['Tokens']
  );
  const fallbackFolder = nextFolders[0] || 'Tokens';
  const currentAssets = loadVaultAssets(campaignId);
  const nextAssets = currentAssets.map((a) =>
    (a.folder || 'Tokens') === folderName ? { ...a, folder: fallbackFolder } : a
  );
  try {
    localStorage.setItem(getVaultKey(campaignId), JSON.stringify(nextAssets));
  } catch {
    // Ignore
  }
  return { folders: nextFolders, assets: nextAssets };
}

export function loadVaultAssets(campaignId: string): VaultAssetItem[] {
  try {
    const raw = localStorage.getItem(getVaultKey(campaignId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VaultAssetItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      ...item,
      folder: item.folder && item.folder.trim() ? item.folder.trim() : 'Tokens',
    }));
  } catch {
    return [];
  }
}

export function saveAssetToVault(
  campaignId: string,
  item: Omit<VaultAssetItem, 'id' | 'createdAtMs' | 'folder'> & { folder?: string }
): VaultAssetItem[] {
  const current = loadVaultAssets(campaignId);
  const targetFolder =
    item.folder && item.folder.trim()
      ? item.folder.trim()
      : item.defaultKind === 'image'
        ? 'Itens & Props'
        : 'Tokens';

  // Ensure the target folder exists in the folder list
  const folders = loadVaultFolders(campaignId);
  if (!folders.includes(targetFolder)) {
    saveVaultFolders(campaignId, [...folders, targetFolder]);
  }

  // Avoid exact duplicates by mediaId or imageUrl inside the same folder
  const exists = current.find(
    (a) =>
      ((item.mediaId && a.mediaId === item.mediaId) ||
        (item.imageUrl &&
          !item.imageUrl.startsWith('idb://') &&
          a.imageUrl === item.imageUrl)) &&
      (a.folder || 'Tokens') === targetFolder
  );
  if (exists) {
    return current;
  }

  const created: VaultAssetItem = {
    ...item,
    folder: targetFolder,
    id: `vlt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAtMs: Date.now(),
  };
  const next = [created, ...current].slice(0, 120);
  try {
    localStorage.setItem(getVaultKey(campaignId), JSON.stringify(next));
  } catch {
    // Ignore storage quota warnings
  }
  return next;
}

export function moveAssetToVaultFolder(
  campaignId: string,
  assetId: string,
  nextFolder: string
): VaultAssetItem[] {
  const cleanFolder = nextFolder.trim() || 'Tokens';
  const folders = loadVaultFolders(campaignId);
  if (!folders.includes(cleanFolder)) {
    saveVaultFolders(campaignId, [...folders, cleanFolder]);
  }
  const current = loadVaultAssets(campaignId);
  const next = current.map((a) =>
    a.id === assetId ? { ...a, folder: cleanFolder } : a
  );
  try {
    localStorage.setItem(getVaultKey(campaignId), JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}

export function removeAssetFromVault(campaignId: string, assetId: string): VaultAssetItem[] {
  const current = loadVaultAssets(campaignId);
  const next = current.filter((a) => a.id !== assetId);
  try {
    localStorage.setItem(getVaultKey(campaignId), JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}
