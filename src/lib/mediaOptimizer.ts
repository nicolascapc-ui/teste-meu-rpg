import type { SceneMediaKind } from '../types/vtt';

export type MediaOptimizeProfile = 'token' | 'scene' | 'handout' | 'audio' | 'none';

export interface OptimizationResult {
  file: File;
  wasCompressed: boolean;
  originalBytes: number;
  finalBytes: number;
  mediaKind: SceneMediaKind;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function detectSceneMediaKind(urlOrName?: string, mimeType?: string): SceneMediaKind {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m === 'image/gif') return 'gif';
  const clean = (urlOrName || '').split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(clean)) return 'video';
  if (/\.gif$/.test(clean)) return 'gif';
  return 'image';
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Image load timeout'));
    }, 5000);
    img.onload = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objUrl);
      reject(err);
    };
    img.src = objUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

export async function optimizeImageFile(
  file: File,
  profile: 'token' | 'scene' | 'handout'
): Promise<OptimizationResult> {
  const originalBytes = file.size;
  const mediaKind = detectSceneMediaKind(file.name, file.type);

  // Preserve animated GIFs and videos untouched so animation/playback is never lost
  if (mediaKind === 'gif' || mediaKind === 'video' || !file.type.startsWith('image/')) {
    return {
      file,
      wasCompressed: false,
      originalBytes,
      finalBytes: originalBytes,
      mediaKind,
    };
  }

  const maxEdge = profile === 'token' ? 400 : profile === 'handout' ? 1400 : 1600;
  const targetMaxBytes = profile === 'token' ? 140 * 1024 : 340 * 1024;

  // Skip already tiny images
  if (originalBytes <= (profile === 'token' ? 85 * 1024 : 220 * 1024)) {
    return {
      file,
      wasCompressed: false,
      originalBytes,
      finalBytes: originalBytes,
      mediaKind: 'image',
    };
  }

  try {
    const img = await loadImageElement(file);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) {
      return { file, wasCompressed: false, originalBytes, finalBytes: originalBytes, mediaKind: 'image' };
    }

    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { file, wasCompressed: false, originalBytes, finalBytes: originalBytes, mediaKind: 'image' };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dstW, dstH);

    // Prefer WebP (supports alpha transparency & superior compression), fallback to JPEG
    let blob = await canvasToBlob(canvas, 'image/webp', 0.8);
    let outMime = 'image/webp';
    let outExt = '.webp';

    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
      outMime = 'image/jpeg';
      outExt = '.jpg';
    }

    if (blob && blob.size > targetMaxBytes) {
      const tighter = await canvasToBlob(canvas, outMime, 0.65);
      if (tighter && tighter.size < blob.size) {
        blob = tighter;
      }
    }

    if (!blob || blob.size >= originalBytes * 0.94) {
      return {
        file,
        wasCompressed: false,
        originalBytes,
        finalBytes: originalBytes,
        mediaKind: 'image',
      };
    }

    const cleanBase = file.name.replace(/\.[^.]+$/, '') || 'imagem';
    const optimized = new File([blob], `${cleanBase}${outExt}`, {
      type: outMime,
      lastModified: Date.now(),
    });

    return {
      file: optimized,
      wasCompressed: true,
      originalBytes,
      finalBytes: optimized.size,
      mediaKind: 'image',
    };
  } catch {
    return {
      file,
      wasCompressed: false,
      originalBytes,
      finalBytes: originalBytes,
      mediaKind: 'image',
    };
  }
}

function encodeMonoWav16(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function optimizeAudioFile(file: File): Promise<OptimizationResult> {
  const originalBytes = file.size;
  const isWav = file.type === 'audio/wav' || /\.wav$/i.test(file.name);

  // Only attempt fast offline downsampling for heavy WAV or oversized audio files (> 2.4 MB)
  const threshold = isWav ? 1.0 * 1024 * 1024 : 2.8 * 1024 * 1024;
  if (originalBytes <= threshold || typeof AudioContext === 'undefined') {
    return {
      file,
      wasCompressed: false,
      originalBytes,
      finalBytes: originalBytes,
      mediaKind: 'image',
    };
  }

  try {
    const arrayBuf = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const decodeCtx = new AudioCtx();
    const decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
    await decodeCtx.close().catch(() => undefined);

    const targetRate = 22050;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    // Guard against huge 20-minute tracks overflowing memory
    if (frameCount > targetRate * 360) {
      return { file, wasCompressed: false, originalBytes, finalBytes: originalBytes, mediaKind: 'image' };
    }

    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const wavBlob = encodeMonoWav16(rendered.getChannelData(0), targetRate);

    // Only keep compressed output if genuinely smaller than original (e.g. shrinks heavy WAVs by ~4x)
    if (wavBlob.size >= originalBytes * 0.9) {
      return {
        file,
        wasCompressed: false,
        originalBytes,
        finalBytes: originalBytes,
        mediaKind: 'image',
      };
    }

    const cleanBase = file.name.replace(/\.[^.]+$/, '') || 'audio';
    const optimized = new File([wavBlob], `${cleanBase}_opt.wav`, {
      type: 'audio/wav',
      lastModified: Date.now(),
    });

    return {
      file: optimized,
      wasCompressed: true,
      originalBytes,
      finalBytes: optimized.size,
      mediaKind: 'image',
    };
  } catch {
    return {
      file,
      wasCompressed: false,
      originalBytes,
      finalBytes: originalBytes,
      mediaKind: 'image',
    };
  }
}

export async function optimizeMediaFile(
  file: File,
  profile: MediaOptimizeProfile = 'none'
): Promise<OptimizationResult> {
  if (profile === 'token' || profile === 'scene' || profile === 'handout') {
    return optimizeImageFile(file, profile);
  }
  if (profile === 'audio') {
    return optimizeAudioFile(file);
  }
  return {
    file,
    wasCompressed: false,
    originalBytes: file.size,
    finalBytes: file.size,
    mediaKind: detectSceneMediaKind(file.name, file.type),
  };
}
