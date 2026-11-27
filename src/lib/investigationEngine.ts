import type {
  InvestigationDifficulty,
  InvestigationHotspot,
  InvestigationSceneData,
  SceneToken,
} from '../types/vtt';

const STORAGE_PREFIX = 'folio_vtt_investigations_v1_';

export const DIFFICULTY_META: Record<
  InvestigationDifficulty,
  { label: string; shortLabel: string; hint: string; color: string }
> = {
  1: {
    label: 'Nível 1 · Evidente',
    shortLabel: 'Nível 1',
    hint: 'Pista perceptível ao olhar atento',
    color: '#34d399',
  },
  2: {
    label: 'Nível 2 · Oculta',
    shortLabel: 'Nível 2',
    hint: 'Exige inspeção cuidadosa ou teste moderado',
    color: '#f59e0b',
  },
  3: {
    label: 'Nível 3 · Críptica',
    shortLabel: 'Nível 3',
    hint: 'Segredo profundo ou detalhe quase imperceptível',
    color: '#f43f5e',
  },
};

export function createInvestigationId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createHotspotId(): string {
  return `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultInvestigation(params: {
  id: string;
  sceneId: string;
  tokenId: string;
  title?: string;
}): InvestigationSceneData {
  return {
    id: params.id,
    sceneId: params.sceneId,
    tokenId: params.tokenId,
    title: params.title?.trim() || 'Cena de Investigação',
    bgImageUrl: '',
    bgMediaId: '',
    hotspots: [],
    flashlightRadiusPx: 220,
    ambientDarkness: 0.88,
    isLiveToPlayers: false,
    updatedAtMs: Date.now(),
  };
}

export function createInvestigationTriggerToken(params: {
  investigationId: string;
  name?: string;
  x?: number;
  y?: number;
}): SceneToken {
  return {
    id: `tok_inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: params.name?.trim() || 'Investigação',
    x: params.x ?? 0.5,
    y: params.y ?? 0.5,
    sizePx: 66,
    layerKind: 'token',
    tokenCategory: 'item',
    shape: 'circle',
    color: '#f59e0b',
    outlineStyle: 'dashed',
    outlineColor: '#fbbf24',
    shadow: 'dramatic',
    hiddenFromPlayers: true,
    isInvestigationTrigger: true,
    investigationId: params.investigationId,
    notes: 'Marcador de Cena de Investigação (visível apenas para o Mestre). Clique para abrir.',
  };
}

export function createDefaultHotspot(x: number, y: number, index: number): InvestigationHotspot {
  return {
    id: createHotspotId(),
    x: Math.max(0.02, Math.min(0.98, x)),
    y: Math.max(0.02, Math.min(0.98, y)),
    title: `Pista #${index}`,
    description: '',
    zoomImageUrl: '',
    zoomMediaId: '',
    difficulty: 1,
    visibleToPlayers: false,
  };
}

export function loadCampaignInvestigations(
  campaignId: string
): Record<string, InvestigationSceneData> {
  if (typeof window === 'undefined' || !campaignId) return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${campaignId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, InvestigationSceneData>;
  } catch {
    return {};
  }
}

export function saveCampaignInvestigations(
  campaignId: string,
  map: Record<string, InvestigationSceneData>
): void {
  if (typeof window === 'undefined' || !campaignId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${campaignId}`, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Strips all GM-hidden hotspots before sending an Investigation Scene to Players / TV.
 * Players will never receive hidden hotspot coordinates, titles, or descriptions.
 */
export function sanitizePublicInvestigation(
  inv: InvestigationSceneData | null | undefined
): InvestigationSceneData | null {
  if (!inv || !inv.isLiveToPlayers) return null;
  return {
    id: inv.id,
    sceneId: inv.sceneId,
    tokenId: inv.tokenId,
    title: inv.title,
    bgImageUrl: inv.bgImageUrl || '',
    bgMediaId: inv.bgMediaId || '',
    flashlightRadiusPx: inv.flashlightRadiusPx ?? 220,
    ambientDarkness: inv.ambientDarkness ?? 0.88,
    isLiveToPlayers: true,
    updatedAtMs: inv.updatedAtMs || Date.now(),
    hotspots: (inv.hotspots || []).filter((h) => h.visibleToPlayers === true),
  };
}
