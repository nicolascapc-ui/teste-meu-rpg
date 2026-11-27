import type { SceneWall } from '../types/vtt';

export interface TacticalWallDetectionResult {
  isTacticalMap: boolean;
  reason: string;
  walls: SceneWall[];
}

/**
 * Loads a scene image onto an offscreen canvas (max 1024px) and exports it as JPEG base64
 * so the server-side Gemini Vision analyzer can identify tactical walls accurately.
 */
async function renderImageUrlToJpegBase64(imageUrl: string): Promise<{
  base64: string;
  mimeType: string;
}> {
  const loadImage = (src: string, useCors: boolean) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem do mapa.'));
      img.src = src;
    });

  let img: HTMLImageElement;
  try {
    img = await loadImage(imageUrl, true);
  } catch {
    // Retry via fetch -> blob URL if CORS headers allow fetch
    const resp = await fetch(imageUrl);
    if (!resp.ok) {
      throw new Error('Não foi possível acessar a imagem deste mapa para análise.');
    }
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      img = await loadImage(objUrl, false);
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }

  const natW = img.naturalWidth || img.width || 1024;
  const natH = img.naturalHeight || img.height || 1024;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const outW = Math.max(64, Math.round(natW * scale));
  const outH = Math.max(64, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Navegador sem suporte a canvas 2D.');
  }
  ctx.drawImage(img, 0, 0, outW, outH);

  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    throw new Error(
      'Esta imagem externa bloqueia leitura por CORS. Faça upload do mapa direto do seu dispositivo para usar o Auto-Muros.'
    );
  }

  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/i, '');
  return { base64, mimeType: 'image/jpeg' };
}

/**
 * Experimental feature: sends a tactical battlemap image to the server-side
 * Gemini Vision endpoint to identify if it is a tactical map and generate a
 * simplified base of line-of-sight walls and doors.
 */
export async function detectTacticalMapWalls(
  resolvedImageUrl: string
): Promise<TacticalWallDetectionResult> {
  if (!resolvedImageUrl) {
    throw new Error('Adicione uma imagem de mapa tático nesta cena primeiro.');
  }

  const { base64, mimeType } = await renderImageUrlToJpegBase64(resolvedImageUrl);

  const response = await fetch('/api/detect-tactical-walls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: base64,
      mimeType,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    isTacticalMap?: boolean;
    reason?: string;
    walls?: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      kind?: 'wall' | 'door';
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error || 'Falha ao analisar os muros do mapa.');
  }

  const nowTag = Date.now().toString(36);
  const walls: SceneWall[] = (payload.walls || []).map((w, idx) => ({
    id: `awall_${nowTag}_${idx}`,
    x1: Math.max(0, Math.min(1, Number(w.x1) || 0)),
    y1: Math.max(0, Math.min(1, Number(w.y1) || 0)),
    x2: Math.max(0, Math.min(1, Number(w.x2) || 0)),
    y2: Math.max(0, Math.min(1, Number(w.y2) || 0)),
    kind: w.kind === 'door' ? 'door' : 'wall',
    isOpen: false,
  }));

  return {
    isTacticalMap: Boolean(payload.isTacticalMap),
    reason: String(payload.reason || ''),
    walls,
  };
}
