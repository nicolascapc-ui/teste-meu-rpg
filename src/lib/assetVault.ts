export interface VaultAssetItem {
  id: string;
  name: string;
  imageUrl: string;
  mediaId: string;
  defaultKind: 'image' | 'token';
  widthPx: number;
  heightPx: number;
  createdAtMs: number;
}

const VAULT_STORAGE_PREFIX = 'folio_vtt_asset_vault_v1_';

function getStorageKey(campaignId: string): string {
  return `${VAULT_STORAGE_PREFIX}${campaignId || 'global'}`;
}

export function loadVaultAssets(campaignId: string): VaultAssetItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(campaignId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is VaultAssetItem =>
        Boolean(item && typeof item.id === 'string' && (item.imageUrl || item.mediaId))
    );
  } catch {
    return [];
  }
}

export function saveAssetToVault(
  campaignId: string,
  asset: Omit<VaultAssetItem, 'id' | 'createdAtMs'>
): VaultAssetItem[] {
  const current = loadVaultAssets(campaignId);
  // Deduplicate by mediaId or imageUrl
  const filtered = current.filter(
    (a) =>
      !(asset.mediaId && a.mediaId === asset.mediaId) &&
      !(asset.imageUrl && a.imageUrl === asset.imageUrl)
  );
  const entry: VaultAssetItem = {
    ...asset,
    id: `vlt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAtMs: Date.now(),
  };
  const next = [entry, ...filtered].slice(0, 60);
  try {
    window.localStorage.setItem(getStorageKey(campaignId), JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function removeAssetFromVault(campaignId: string, assetId: string): VaultAssetItem[] {
  const current = loadVaultAssets(campaignId);
  const next = current.filter((a) => a.id !== assetId);
  try {
    window.localStorage.setItem(getStorageKey(campaignId), JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}
