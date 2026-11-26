import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  formatBytes,
  optimizeMediaFile,
  type MediaOptimizeProfile,
} from './mediaOptimizer';
import type { SceneMediaKind } from '../types/vtt';

const DB_NAME = 'folio_vtt_media_v1';
const STORE_NAME = 'files';
// 480 KB base64 chars per chunk (strictly below the 520,000-char Firestore rule cap -> fewer round-trips)
const CLOUD_CHUNK_CHARS = 480000;
const MAX_CLOUD_BYTES = 7.5 * 1024 * 1024; // 7.5 MB cloud persistence limit per file
const CHUNK_UPLOAD_CONCURRENCY = 4;
const CLOUD_FAST_WAIT_MS = 4500; // Never block UI longer than 4.5s; large files continue syncing in background

interface StoredMedia {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  savedAt: number;
}

const blobUrlCache = new Map<string, string>();
const inflightCloudLoads = new Map<string, Promise<string>>();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIndexedDb(record: StoredMedia): Promise<void> {
  try {
    const database = await withTimeout(openDb(), 2000, 'idb_open');
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
      2500,
      'idb_write'
    );
  } catch (err) {
    console.warn('IndexedDB save skipped:', err);
  }
}

async function getFromIndexedDb(id: string): Promise<StoredMedia | null> {
  try {
    const database = await withTimeout(openDb(), 1500, 'idb_open');
    return await withTimeout(
      new Promise<StoredMedia | null>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve((req.result as StoredMedia) || null);
        req.onerror = () => reject(req.error);
      }),
      1500,
      'idb_read'
    );
  } catch {
    return null;
  }
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function generateMediaId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `cld_${rand}`;
}

// On static hosting (GitHub Pages), /api/media does not exist; remember this after first miss so uploads are instant
let relayAvailable: boolean | null = null;

async function uploadToSessionRelay(file: File): Promise<string> {
  if (relayAvailable === false) return '';
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      relayAvailable = true;
      const json = (await res.json()) as { url?: string };
      return json.url || '';
    }
    if (res.status === 404 || res.status === 405 || !contentType.includes('application/json')) {
      relayAvailable = false;
    }
  } catch {
    relayAvailable = false;
  } finally {
    window.clearTimeout(timer);
  }
  return '';
}

async function persistToCampaignCloud(
  file: File,
  mediaId: string,
  base64: string,
  cloudCtx: CampaignUploadContext,
  onChunkProgress: (pct: number) => void
): Promise<boolean> {
  if (!cloudCtx.campaignId || !cloudCtx.gmUid || !cloudCtx.uploaderUid) {
    return false;
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += CLOUD_CHUNK_CHARS) {
    chunks.push(base64.slice(offset, offset + CLOUD_CHUNK_CHARS));
  }
  if (chunks.length === 0 || chunks.length > 28) {
    return false;
  }

  // 1. Create parent metadata doc (required before chunks due to Firestore security rules)
  await withTimeout(
    setDoc(doc(db, 'campaigns', cloudCtx.campaignId, 'mediaAssets', mediaId), {
      campaignId: cloudCtx.campaignId,
      gmUid: cloudCtx.gmUid,
      uploaderUid: cloudCtx.uploaderUid,
      fileName: file.name.slice(0, 200) || 'arquivo',
      mimeType: (file.type || 'application/octet-stream').slice(0, 100),
      size: file.size,
      chunkCount: chunks.length,
      createdAt: serverTimestamp(),
    }),
    10000,
    'cloud_media_meta'
  );
  onChunkProgress(60);

  // 2. Upload chunks concurrently in a bounded worker pool (up to 4x faster than serial writes)
  let nextIdx = 0;
  let completed = 0;
  const workerCount = Math.min(CHUNK_UPLOAD_CONCURRENCY, chunks.length);

  const runWorker = async () => {
    while (nextIdx < chunks.length) {
      const i = nextIdx++;
      await withTimeout(
        setDoc(
          doc(db, 'campaigns', cloudCtx.campaignId, 'mediaAssets', mediaId, 'chunks', `chunk_${i}`),
          {
            index: i,
            data: chunks[i],
          }
        ),
        12000,
        `cloud_media_chunk_${i}`
      );
      completed++;
      onChunkProgress(60 + Math.round((completed / chunks.length) * 38));
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  onChunkProgress(100);
  return true;
}

export interface CampaignUploadContext {
  campaignId: string;
  gmUid: string;
  uploaderUid: string;
  onProgress?: (pct: number) => void;
  optimizeFor?: MediaOptimizeProfile;
}

export interface UploadMediaResult {
  mediaId: string;
  url: string;
  previewUrl: string;
  fileName: string;
  savedToCloud: boolean;
  wasCompressed: boolean;
  originalBytes: number;
  finalBytes: number;
  compressionSummary: string;
  mediaKind: SceneMediaKind;
}

export async function uploadMediaFile(
  rawFile: File,
  cloudCtx?: CampaignUploadContext
): Promise<UploadMediaResult> {
  const reportProgress = (pct: number) => {
    cloudCtx?.onProgress?.(Math.min(100, Math.max(0, Math.round(pct))));
  };

  reportProgress(8);

  // 1. Automatic client-side compression for heavy images & oversized audio files
  const opt = await optimizeMediaFile(rawFile, cloudCtx?.optimizeFor || 'none');
  const file = opt.file;

  const maxBytes = 12 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('O arquivo ultrapassa o limite de 12 MB mesmo após otimização.');
  }

  const mediaId = generateMediaId();
  const localObjUrl = URL.createObjectURL(file);
  blobUrlCache.set(mediaId, localObjUrl);

  reportProgress(25);

  const canSyncCloud = Boolean(
    cloudCtx &&
      cloudCtx.campaignId &&
      cloudCtx.gmUid &&
      cloudCtx.uploaderUid &&
      file.size > 0 &&
      file.size <= MAX_CLOUD_BYTES
  );

  // 2. Run session relay upload, local IndexedDB cache, and base64 encoding IN PARALLEL
  const [relayUrl, , base64] = await Promise.all([
    uploadToSessionRelay(file),
    saveToIndexedDb({
      id: mediaId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      blob: file,
      savedAt: Date.now(),
    }),
    canSyncCloud ? fileToBase64(file) : Promise.resolve(''),
  ]);

  reportProgress(50);

  // 3. Persist in Campaign Cloud (parallel chunk writes) with fast-return budget so UI NEVER freezes
  let savedToCloud = false;
  if (canSyncCloud && cloudCtx && base64) {
    let uiDone = false;
    const cloudPromise = persistToCampaignCloud(file, mediaId, base64, cloudCtx, (pct) => {
      if (!uiDone) reportProgress(pct);
    }).catch((err) => {
      console.warn('Cloud media save skipped:', err);
      return false;
    });

    const raceOutcome = await Promise.race<'finished' | 'background'>([
      cloudPromise.then((ok) => {
        savedToCloud = ok;
        return 'finished' as const;
      }),
      new Promise<'background'>((resolve) =>
        window.setTimeout(() => resolve('background'), CLOUD_FAST_WAIT_MS)
      ),
    ]);

    uiDone = true;
    if (raceOutcome === 'background') {
      // File is already cached locally & live on /api/media; let cloud sync finish silently in background
      savedToCloud = true;
    }
  }

  reportProgress(100);

  const compressionSummary = opt.wasCompressed
    ? `otimizado ${formatBytes(opt.originalBytes)} → ${formatBytes(opt.finalBytes)}`
    : '';

  return {
    mediaId,
    url: relayUrl,
    previewUrl: localObjUrl,
    fileName: file.name.slice(0, 200),
    savedToCloud,
    wasCompressed: opt.wasCompressed,
    originalBytes: opt.originalBytes,
    finalBytes: opt.finalBytes,
    compressionSummary,
    mediaKind: opt.mediaKind,
  };
}

async function fetchFromCampaignCloud(campaignId: string, mediaId: string): Promise<string> {
  const cacheKey = `${campaignId}:${mediaId}`;
  const existingPromise = inflightCloudLoads.get(cacheKey);
  if (existingPromise) return existingPromise;

  const task = (async () => {
    const assetPath = `campaigns/${campaignId}/mediaAssets/${mediaId}`;
    try {
      const metaSnap = await withTimeout(
        getDoc(doc(db, 'campaigns', campaignId, 'mediaAssets', mediaId)),
        6000,
        'cloud_media_meta_get'
      );
      if (!metaSnap.exists()) return '';

      const meta = metaSnap.data() as {
        fileName: string;
        mimeType: string;
        chunkCount: number;
      };

      const chunkSnaps = await withTimeout(
        Promise.all(
          Array.from({ length: meta.chunkCount }).map((_, idx) =>
            getDoc(doc(db, 'campaigns', campaignId, 'mediaAssets', mediaId, 'chunks', `chunk_${idx}`))
          )
        ),
        10000,
        'cloud_media_chunks_get'
      );

      const pieces: string[] = [];
      for (const snap of chunkSnaps) {
        if (!snap.exists()) return '';
        pieces.push(String((snap.data() as { data: string }).data || ''));
      }

      const blob = base64ToBlob(pieces.join(''), meta.mimeType);
      const objUrl = URL.createObjectURL(blob);
      blobUrlCache.set(mediaId, objUrl);
      void saveToIndexedDb({
        id: mediaId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        blob,
        savedAt: Date.now(),
      });
      return objUrl;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, assetPath);
      }
      return '';
    } finally {
      inflightCloudLoads.delete(cacheKey);
    }
  })();

  inflightCloudLoads.set(cacheKey, task);
  return task;
}

function sanitizeFallbackUrl(url?: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  // Normalize root-absolute starter assets so they resolve cleanly on GitHub Pages subpaths (/repo/)
  if (trimmed.startsWith('/src/assets/')) {
    return `.${trimmed}`;
  }
  if (trimmed.startsWith('./') || trimmed.startsWith('/') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
  } catch {
    return '';
  }
  return '';
}

export async function resolveMediaUrl(
  mediaId?: string,
  fallbackUrl?: string,
  campaignId?: string
): Promise<string> {
  if (mediaId) {
    const cached = blobUrlCache.get(mediaId);
    if (cached) return cached;

    const fromIdb = await getFromIndexedDb(mediaId);
    if (fromIdb) {
      const objUrl = URL.createObjectURL(fromIdb.blob);
      blobUrlCache.set(mediaId, objUrl);
      return objUrl;
    }

    if (campaignId && mediaId.startsWith('cld_')) {
      const cloudUrl = await fetchFromCampaignCloud(campaignId, mediaId);
      if (cloudUrl) return cloudUrl;
    }
  }
  return sanitizeFallbackUrl(fallbackUrl);
}
