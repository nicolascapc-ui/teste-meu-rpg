export interface ResolvedMediaLink {
  sourceType: 'youtube' | 'url';
  videoId?: string;
  url: string;
  title: string;
  mediaKind: 'audio' | 'video';
}

function isSafeExternalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.') ||
    h.startsWith('0.')
  ) {
    return false;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const oct = Number(m172[1]);
    if (oct >= 16 && oct <= 31) return false;
  }
  if (h.startsWith('[') || h.includes(':')) {
    const stripped = h.replace(/^\[|\]$/g, '');
    if (/^(::1|fe80|fc|fd|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.|::ffff:169\.254\.)/i.test(stripped)) {
      return false;
    }
  }
  return true;
}

function extractYouTubeVideoId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    const candidate = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = parsed.searchParams.get('v') || '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
      return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
    }
  }
  return null;
}

/**
 * 100% browser-side media link validator & YouTube title resolver.
 * Works identically on GitHub Pages / pure static HTML with zero backend server.
 */
export async function resolveMediaLinkInBrowser(rawInput: string): Promise<ResolvedMediaLink> {
  const rawUrl = rawInput.trim();
  if (!rawUrl || rawUrl.length > 1024) {
    throw new Error('Informe um link válido (http ou https).');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Formato de link inválido.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Apenas links http:// ou https:// são permitidos.');
  }
  if (!isSafeExternalHostname(parsed.hostname)) {
    throw new Error('Endereço não permitido.');
  }

  // 1. YouTube audio-only extraction
  const ytId = extractYouTubeVideoId(parsed);
  if (ytId) {
    let title = `YouTube (${ytId})`;
    const canonical = `https://www.youtube.com/watch?v=${ytId}`;

    // Fetch title via CORS-enabled noembed endpoint (pure browser, zero backend)
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3200);
      const res = await fetch(
        `https://noembed.com/embed?url=${encodeURIComponent(canonical)}`,
        { signal: controller.signal }
      );
      window.clearTimeout(timer);
      if (res.ok) {
        const meta = (await res.json()) as { title?: string };
        if (typeof meta.title === 'string' && meta.title.trim()) {
          title = meta.title.trim().slice(0, 96);
        }
      }
    } catch {
      // Keep clean fallback title if offline or blocked
    }

    return {
      sourceType: 'youtube',
      videoId: ytId,
      url: canonical,
      title,
      mediaKind: 'audio',
    };
  }

  // 2. Direct audio or video link (MP3, WAV, OGG, M4A, MP4, WebM, MOV, etc.)
  const pathnameLower = parsed.pathname.toLowerCase();
  const baseName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 90);

  const isDirectVideo = /\.(mp4|webm|mov|m4v|ogv)$/i.test(pathnameLower);

  return {
    sourceType: 'url',
    url: parsed.toString(),
    title: baseName || parsed.hostname,
    mediaKind: isDirectVideo ? 'video' : 'audio',
  };
}
