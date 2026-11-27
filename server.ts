import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { parseSheetPdfLocally } from './serverPdfParser.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);

const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // 12 MB
const MEDIA_DIR = path.join(os.tmpdir(), 'folio-vtt-media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

interface MediaEntry {
  id: string;
  mimeType: string;
  fileName: string;
  filePath: string;
  size: number;
  createdAt: number;
}

const mediaIndex = new Map<string, MediaEntry>();
const ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

async function startServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Upload session media (images, PDFs, audio) so Second Screen TV and mobile players can load them
  app.post(
    '/api/media',
    express.raw({ type: '*/*', limit: '12mb' }),
    (req, res) => {
      try {
        const rawContentType = String(req.headers['content-type'] || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (!ALLOWED_MIME_TYPES.has(rawContentType)) {
          res.status(415).json({ error: 'Tipo de arquivo não suportado.' });
          return;
        }

        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
          res.status(400).json({ error: 'Arquivo vazio.' });
          return;
        }
        if (buffer.length > MAX_MEDIA_BYTES) {
          res.status(413).json({ error: 'Arquivo excede o limite de 12 MB.' });
          return;
        }

        const rawName = String(req.headers['x-file-name'] || 'arquivo');
        const safeName = decodeURIComponent(rawName)
          .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
          .slice(0, 120);
        const id = crypto.randomUUID().replace(/-/g, '');
        const filePath = path.join(MEDIA_DIR, id);

        fs.writeFileSync(filePath, buffer);
        const entry: MediaEntry = {
          id,
          mimeType: rawContentType,
          fileName: safeName,
          filePath,
          size: buffer.length,
          createdAt: Date.now(),
        };
        mediaIndex.set(id, entry);

        if (mediaIndex.size > 150) {
          const oldestKey = mediaIndex.keys().next().value;
          if (oldestKey) {
            const oldest = mediaIndex.get(oldestKey);
            if (oldest && fs.existsSync(oldest.filePath)) {
              fs.unlinkSync(oldest.filePath);
            }
            mediaIndex.delete(oldestKey);
          }
        }

        res.status(201).json({
          id,
          url: `/api/media/${id}`,
          mimeType: rawContentType,
          fileName: safeName,
          size: buffer.length,
        });
      } catch (err) {
        console.error('Media upload failed:', err);
        res.status(500).json({ error: 'Falha ao salvar mídia da sessão.' });
      }
    }
  );

  app.get('/api/media/:id', (req, res) => {
    const id = req.params.id;
    if (!ID_REGEX.test(id)) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const entry = mediaIndex.get(id);
    if (!entry || !fs.existsSync(entry.filePath)) {
      res.status(404).json({ error: 'Mídia não encontrada nesta sessão.' });
      return;
    }

    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${entry.fileName.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(entry.filePath).pipe(res);
  });

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
      // Block IPv6 private/link-local/loopback literals
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

  // Validate external audio/video/YouTube links safely (SSRF-hardened) and fetch clean metadata
  app.post('/api/resolve-media-link', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!rawUrl || rawUrl.length > 1024) {
        res.status(400).json({ error: 'Informe um link válido (http ou https).' });
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        res.status(400).json({ error: 'Formato de link inválido.' });
        return;
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        res.status(400).json({ error: 'Apenas links http:// ou https:// são permitidos.' });
        return;
      }
      if (!isSafeExternalHostname(parsed.hostname)) {
        res.status(400).json({ error: 'Endereço não permitido.' });
        return;
      }

      // 1. YouTube audio extraction mode (uses official YouTube oEmbed + browser IFrame Audio-Only API)
      const ytId = extractYouTubeVideoId(parsed);
      if (ytId) {
        let title = `YouTube (${ytId})`;
        const canonical = `https://www.youtube.com/watch?v=${ytId}`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (oembedRes.ok) {
            const meta = (await oembedRes.json()) as { title?: string };
            if (typeof meta.title === 'string' && meta.title.trim()) {
              title = meta.title.trim().slice(0, 96);
            }
          }
        } catch {
          // Keep clean fallback title if oEmbed times out
        }

        res.json({
          sourceType: 'youtube',
          videoId: ytId,
          url: canonical,
          title,
          mediaKind: 'audio',
        });
        return;
      }

      // 2. Direct audio or video link (MP3, WAV, OGG, M4A, MP4, WebM, MOV, etc.)
      const pathnameLower = parsed.pathname.toLowerCase();
      const baseName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .slice(0, 90);

      const isDirectVideo = /\.(mp4|webm|mov|m4v|ogv)$/i.test(pathnameLower);
      const isDirectAudio = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(pathnameLower);

      res.json({
        sourceType: 'url',
        url: parsed.toString(),
        title: baseName || parsed.hostname,
        mediaKind: isDirectVideo ? 'video' : isDirectAudio ? 'audio' : 'audio',
      });
    } catch (err) {
      console.error('Resolve media link failed:', err);
      res.status(500).json({ error: 'Não foi possível validar o link informado.' });
    }
  });

  // Local PDF -> Automated Modular Character Sheet Parser (100% free, zero external APIs)
  app.post(
    '/api/parse-sheet-pdf',
    express.json({ limit: '18mb' }),
    express.raw({ type: 'application/pdf', limit: '12mb' }),
    async (req, res) => {
      try {
        let pdfBuffer: Buffer | null = null;
        let fileName = 'ficha.pdf';

        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
          const payload = req.body as { pdfBase64?: unknown; fileName?: unknown };
          if (typeof payload.pdfBase64 === 'string' && payload.pdfBase64.trim()) {
            const cleanB64 = payload.pdfBase64.replace(/^data:application\/pdf;base64,/i, '').trim();
            const estimatedBytes = Math.ceil((cleanB64.length * 3) / 4);
            if (estimatedBytes > MAX_MEDIA_BYTES) {
              res.status(413).json({ error: 'O PDF ultrapassa o limite de 12 MB.' });
              return;
            }
            pdfBuffer = Buffer.from(cleanB64, 'base64');
          }
          if (typeof payload.fileName === 'string' && payload.fileName.trim()) {
            fileName = payload.fileName.trim().slice(0, 120);
          }
        } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          if (req.body.length > MAX_MEDIA_BYTES) {
            res.status(413).json({ error: 'O PDF ultrapassa o limite de 12 MB.' });
            return;
          }
          pdfBuffer = req.body;
          const rawFileName = String(req.headers['x-file-name'] || 'ficha.pdf');
          fileName = decodeURIComponent(rawFileName).slice(0, 120);
        }

        if (!pdfBuffer || pdfBuffer.length === 0) {
          res.status(400).json({ error: 'Envie um arquivo PDF válido.' });
          return;
        }
        if (pdfBuffer.length > MAX_MEDIA_BYTES) {
          res.status(413).json({ error: 'O PDF ultrapassa o limite de 12 MB.' });
          return;
        }

        const parsed = await parseSheetPdfLocally(pdfBuffer, fileName);
        res.json(parsed);
      } catch (err) {
        console.error('Local PDF parse failed:', err);
        const message =
          err instanceof Error ? err.message : 'Erro ao interpretar o PDF da ficha.';
        res.status(500).json({ error: `Falha ao ler PDF: ${message}` });
      }
    }
  );

  // Experimental: AI-assisted Tactical Map Auto-Wall Detection (Gemini Vision)
  app.post(
    '/api/detect-tactical-walls',
    express.json({ limit: '10mb' }),
    async (req, res) => {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          res.status(503).json({
            error:
              'Chave da API Gemini não configurada no ambiente (Settings > Secrets).',
          });
          return;
        }

        const body = req.body as {
          imageBase64?: unknown;
          mimeType?: unknown;
        };
        const rawB64 = typeof body?.imageBase64 === 'string' ? body.imageBase64.trim() : '';
        const mimeType =
          typeof body?.mimeType === 'string' &&
          ['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType.toLowerCase())
            ? body.mimeType.toLowerCase()
            : 'image/jpeg';

        if (!rawB64 || rawB64.length > 9 * 1024 * 1024) {
          res.status(400).json({ error: 'Imagem do mapa inválida ou muito grande.' });
          return;
        }

        const cleanB64 = rawB64.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const prompt = [
          'Analyze this image for a tabletop RPG virtual tabletop (VTT) dynamic line-of-sight wall system.',
          'Step 1: Determine if this image is a top-down / overhead tactical battlemap or floorplan (dungeon, building interior, cave corridors, tavern layout, ship deck, streets).',
          'Set isTacticalMap=false if it is a landscape painting, first-person view, character portrait, isometric non-map illustration, or blank texture without clear walkable rooms/walls.',
          'Step 2: If isTacticalMap=true, output a CLEAN, SIMPLIFIED base of structural line-of-sight walls and obvious doors.',
          'Coordinate system: x and y are integers from 0 to 1000 where (0,0) is top-left and (1000,1000) is bottom-right of the image.',
          'Rules for walls:',
          '- Trace the main solid walls (outer building walls, room dividers, cavern rock faces, thick columns) that block vision.',
          '- Mark clear doorway openings with kind="door" and solid walls with kind="wall".',
          '- Keep it SIMPLE and clean: merge straight collinear wall runs into single segments, connect wall corners neatly at matching endpoints, and return roughly 8 to 80 high-value segments.',
          '- Ignore floor tiles, tactical grid lines, chairs, tables, carpets, beds, rugs, crates, torches, and small decorative props.',
          'Respond strictly in the JSON schema, with reason written concisely in Portuguese (pt-BR).',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: cleanB64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isTacticalMap: {
                  type: Type.BOOLEAN,
                  description: 'True only if the image is a top-down tactical RPG map or floorplan.',
                },
                reason: {
                  type: Type.STRING,
                  description: 'Short Portuguese explanation of what was identified on the map.',
                },
                walls: {
                  type: Type.ARRAY,
                  description: 'Simplified structural wall and door line segments in 0..1000 normalized coordinates.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      x1: { type: Type.NUMBER },
                      y1: { type: Type.NUMBER },
                      x2: { type: Type.NUMBER },
                      y2: { type: Type.NUMBER },
                      kind: {
                        type: Type.STRING,
                        description: 'Either "wall" or "door".',
                      },
                    },
                    required: ['x1', 'y1', 'x2', 'y2', 'kind'],
                  },
                },
              },
              required: ['isTacticalMap', 'reason', 'walls'],
            },
          },
        });

        const rawJson = (response.text ?? '').trim();
        let parsed: {
          isTacticalMap?: boolean;
          reason?: string;
          walls?: Array<{ x1: number; y1: number; x2: number; y2: number; kind?: string }>;
        };
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          res.status(502).json({ error: 'Resposta inválida da análise de mapa. Tente novamente.' });
          return;
        }

        const isTacticalMap = Boolean(parsed.isTacticalMap);
        const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 240) : '';

        if (!isTacticalMap) {
          res.json({
            isTacticalMap: false,
            reason:
              reason ||
              'A imagem não parece ser um mapa tático visto de cima com paredes bem definidas.',
            walls: [],
          });
          return;
        }

        // Normalize 0..1000 -> 0..1, drop degenerate micro-segments, and snap nearby corners cleanly
        const normalized = (Array.isArray(parsed.walls) ? parsed.walls : [])
          .map((w) => {
            const x1 = Math.max(0, Math.min(1000, Number(w.x1) || 0)) / 1000;
            const y1 = Math.max(0, Math.min(1000, Number(w.y1) || 0)) / 1000;
            const x2 = Math.max(0, Math.min(1000, Number(w.x2) || 0)) / 1000;
            const y2 = Math.max(0, Math.min(1000, Number(w.y2) || 0)) / 1000;
            return {
              x1,
              y1,
              x2,
              y2,
              kind: w.kind === 'door' ? ('door' as const) : ('wall' as const),
            };
          })
          .filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.015)
          .slice(0, 140);

        // Snap endpoints within 1.4% of each other so room corners seal without light leaks
        const SNAP_DIST = 0.014;
        const anchors: Array<{ x: number; y: number }> = [];
        const snapPt = (x: number, y: number) => {
          for (const a of anchors) {
            if (Math.hypot(a.x - x, a.y - y) <= SNAP_DIST) {
              return { x: a.x, y: a.y };
            }
          }
          const pt = {
            x: Math.round(x * 1000) / 1000,
            y: Math.round(y * 1000) / 1000,
          };
          anchors.push(pt);
          return pt;
        };

        const cleanedWalls = normalized
          .map((w) => {
            const p1 = snapPt(w.x1, w.y1);
            const p2 = snapPt(w.x2, w.y2);
            return {
              x1: p1.x,
              y1: p1.y,
              x2: p2.x,
              y2: p2.y,
              kind: w.kind,
            };
          })
          .filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.015);

        res.json({
          isTacticalMap: true,
          reason:
            reason ||
            `${cleanedWalls.length} segmento(s) estruturais detectados no mapa tático.`,
          walls: cleanedWalls,
        });
      } catch (err) {
        console.error('Detect tactical walls failed:', err);
        const msg = err instanceof Error ? err.message : 'Erro ao analisar o mapa tático.';
        res.status(500).json({ error: `Falha na análise de muros: ${msg}` });
      }
    }
  );

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio VTT server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
