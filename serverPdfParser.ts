import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsLibPromise: Promise<PdfJsModule> | null = null;

async function getPdfJsLib(): Promise<PdfJsModule> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const localWorkerPath = path.resolve(
        __dirname,
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
      );
      if (!mod.GlobalWorkerOptions.workerSrc) {
        mod.GlobalWorkerOptions.workerSrc = pathToFileURL(localWorkerPath).href;
      }
      return mod;
    });
  }
  return pdfjsLibPromise;
}

export interface ParsedSheetBlock {
  id: string;
  type: 'bar' | 'attribute' | 'counter' | 'text';
  section: string;
  label: string;
  current?: number;
  max?: number;
  barColor?: string;
  value?: number;
  formula?: string;
  count?: number;
  maxCount?: number;
  text?: string;
}

export interface ParsedPdfSheetResult {
  systemName: string;
  characterName: string;
  subtitle: string;
  blocks: ParsedSheetBlock[];
}

type SystemId =
  | 'ordem'
  | 'coc'
  | 't20'
  | 'dnd5e'
  | 'vtm'
  | 'cyberpunk'
  | 'pathfinder'
  | 'savage'
  | 'gurps'
  | 'generic';

interface SystemProfile {
  id: SystemId;
  name: string;
  defaultFormula: (label: string, isPrimaryAttr?: boolean) => string;
  useDndAbilityMod?: boolean;
}

const SYSTEM_PROFILES: Record<SystemId, SystemProfile> = {
  ordem: {
    id: 'ordem',
    name: 'Ordem Paranormal',
    defaultFormula: (label, isPrimary) => (isPrimary ? `{${label}}d20kh1` : `1d20 + {${label}}`),
  },
  coc: {
    id: 'coc',
    name: 'Call of Cthulhu / d100',
    defaultFormula: (label) => `1d100 <= {${label}}`,
  },
  t20: {
    id: 't20',
    name: 'Tormenta20',
    defaultFormula: (label) => `1d20 + {${label}}`,
  },
  dnd5e: {
    id: 'dnd5e',
    name: 'D&D 5e',
    defaultFormula: (label) => `1d20 + {${label}}`,
    useDndAbilityMod: true,
  },
  vtm: {
    id: 'vtm',
    name: 'Vampiro / Storyteller',
    defaultFormula: (label) => `{${label}}d10>=6`,
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk RED',
    defaultFormula: (label) => `1d10! + {${label}}`,
  },
  pathfinder: {
    id: 'pathfinder',
    name: 'Pathfinder',
    defaultFormula: (label) => `1d20 + {${label}}`,
  },
  savage: {
    id: 'savage',
    name: 'Savage Worlds',
    defaultFormula: (label) => `1d6! + {${label}}`,
  },
  gurps: {
    id: 'gurps',
    name: 'GURPS',
    defaultFormula: (label) => `3d6 <= {${label}}`,
  },
  generic: {
    id: 'generic',
    name: 'Sistema do PDF',
    defaultFormula: (label) => `1d20 + {${label}}`,
  },
};

interface ExtractedField {
  rawName: string;
  cleanLabel: string;
  normKey: string;
  value: string;
}

function normalizeStr(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeFieldName(raw: string): string {
  return raw
    .replace(/\[\d+\]/g, '')
    .replace(/^.*\./, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function parseNumberLoose(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '.').replace(/%$/, '');
  const match = /^[+-]?\d+(?:\.\d+)?$/.exec(cleaned);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function parseRatio(raw: string): { current: number; max: number } | null {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!m) return null;
  const current = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
  return { current, max };
}

function detectSystem(corpusRaw: string, pdfTitle: string): SystemProfile {
  const c = normalizeStr(corpusRaw);
  const scores: Record<SystemId, number> = {
    ordem: 0,
    coc: 0,
    t20: 0,
    dnd5e: 0,
    vtm: 0,
    cyberpunk: 0,
    pathfinder: 0,
    savage: 0,
    gurps: 0,
    generic: 0,
  };

  const bump = (id: SystemId, pattern: RegExp, weight: number) => {
    if (pattern.test(c)) scores[id] += weight;
  };

  // Ordem Paranormal
  bump('ordem', /\bordem paranormal\b/, 10);
  bump('ordem', /\bnex\b/, 4);
  bump('ordem', /\bpontos de esforco\b|\besforco\b/, 4);
  bump('ordem', /\bocultismo\b|\brituais\b|\bparanormal\b/, 3);
  bump('ordem', /\bagilidade\b.*\bintelecto\b|\bintelecto\b.*\bpresenca\b/, 4);
  bump('ordem', /\bsanidade\b/, 2);

  // Call of Cthulhu / BRP
  bump('coc', /\bcall of cthulhu\b|\bchamado de cthulhu\b|\bcthulhu mythos\b|\bmitos de cthulhu\b/, 10);
  bump('coc', /\binvestigator\b|\binvestigador\b/, 3);
  bump('coc', /\bcredit rating\b|\bnivel de credito\b|\bcredito\b/, 3);
  bump('coc', /\b(edu|educacao)\b/, 3);
  bump('coc', /\b(siz|tam|tamanho)\b/, 2);
  bump('coc', /\b(pow|pod|poder)\b/, 2);
  bump('coc', /\bsanity\b|\bsanidade\b/, 2);
  bump('coc', /\bluck\b|\bsorte\b/, 2);

  // Tormenta20
  bump('t20', /\btormenta\s*20\b|\bt20\b/, 10);
  bump('t20', /\bpontos de mana\b|\btibares\b|\bdivindade\b/, 4);
  bump('t20', /\bdefesa\b.*\bdeslocamento\b|\bmisticismo\b|\bnobreza\b/, 3);

  // D&D 5e
  bump('dnd5e', /\bdungeons\s*(&|and|e)?\s*dragons\b|\bd&d\b|\bdnd\b|\b5e\b/, 10);
  bump('dnd5e', /\bproficiency bonus\b|\bbonus de proficiencia\b/, 5);
  bump('dnd5e', /\bsaving throws\b|\btestes de resistencia\b|\bdeath saves\b/, 4);
  bump('dnd5e', /\barmor class\b|\bclasse de armadura\b|\bhit dice\b|\bdados de vida\b/, 4);
  bump('dnd5e', /\binspiration\b|\binspiracao\b|\bpassive wisdom\b|\bpercepcao passiva\b/, 3);
  bump('dnd5e', /\b(str|dex|con|int|wis|cha)\b/, 2);

  // Vampiro / Storyteller
  bump('vtm', /\bvampire\b|\bvampiro\b|\bmasquerade\b|\bmascara\b|\bworld of darkness\b/, 10);
  bump('vtm', /\bdisciplines\b|\bdisciplinas\b|\bblood potency\b|\bpotencia de sangue\b/, 5);
  bump('vtm', /\bhunger\b|\bfome\b|\bpredator\b|\bpredador\b|\bclan\b|\bcla\b/, 4);
  bump('vtm', /\bhumanity\b|\bhumanidade\b|\bwillpower\b|\bforca de vontade\b/, 3);

  // Cyberpunk RED
  bump('cyberpunk', /\bcyberpunk\b|\bnetrunner\b|\bedgerunner\b|\bcyberware\b/, 10);
  bump('cyberpunk', /\brole ability\b|\bempathy\b|\bempatia\b.*\breflex/, 4);
  bump('cyberpunk', /\b(cool|tech|body|move|luck|emp)\b.*\b(ref|int)\b/, 4);

  // Pathfinder
  bump('pathfinder', /\bpathfinder\b/, 10);
  bump('pathfinder', /\bancestry\b|\bancestralidade\b|\bhero points\b|\bpontos heroicos\b/, 5);
  bump('pathfinder', /\bperception\b.*\bfortitude\b.*\breflex\b.*\bwill\b/, 3);

  // Savage Worlds
  bump('savage', /\bsavage worlds\b|\bswade\b/, 10);
  bump('savage', /\bbennies\b|\bbenes\b|\bparry\b|\baparar\b.*\btoughness\b|\bwild die\b/, 5);

  // GURPS
  bump('gurps', /\bgurps\b/, 10);
  bump('gurps', /\b(st|dx|iq|ht)\b.*\b(will|per|fp)\b/, 4);

  let best: SystemId = 'generic';
  let bestScore = 3; // Require at least 4 points for confident match
  for (const [id, score] of Object.entries(scores) as Array<[SystemId, number]>) {
    if (id !== 'generic' && score > bestScore) {
      bestScore = score;
      best = id;
    }
  }

  if (best === 'generic' && pdfTitle.trim().length >= 3 && pdfTitle.trim().length <= 50) {
    return {
      ...SYSTEM_PROFILES.generic,
      name: pdfTitle.trim(),
    };
  }
  return SYSTEM_PROFILES[best];
}

function chooseBarColor(normLabel: string): string {
  if (/vida|hp|pv|hit point|vital|sangue|ferimento/.test(normLabel)) return '#8f2d2d';
  if (/sanidade|san|mana|pm|esforco|pe|estresse|stress|vontade|willpower|mente/.test(normLabel)) {
    return '#34517a';
  }
  if (/sorte|luck|armadura|armor|escudo|shield|energia|stamina|fadiga|humanidade|humanity/.test(normLabel)) {
    return '#7a5a26';
  }
  return '#3f6b4b';
}

function cleanTitleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

async function extractPdfContent(pdfBuffer: Buffer): Promise<{
  fields: ExtractedField[];
  lines: string[];
  pdfTitle: string;
  pageCount: number;
}> {
  const pdfjsLib = await getPdfJsLib();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;
    let pdfTitle = '';
    try {
      const meta = await doc.getMetadata();
      const info = (meta?.info || {}) as Record<string, unknown>;
      if (typeof info.Title === 'string' && info.Title.trim()) {
        pdfTitle = info.Title.trim();
      }
    } catch {
      // Ignore metadata extraction errors
    }

    const fieldMap = new Map<string, ExtractedField>();

    // 1. Extract AcroForm fields via getFieldObjects (covers multi-page fillable sheets cleanly)
    try {
      const fieldObjects = await doc.getFieldObjects();
      if (fieldObjects && typeof fieldObjects === 'object') {
        for (const [rawName, entries] of Object.entries(fieldObjects)) {
          if (!Array.isArray(entries) || entries.length === 0) continue;
          const first = entries[0] as { value?: unknown; defaultValue?: unknown; type?: string };
          let valStr = '';
          if (Array.isArray(first.value)) {
            valStr = first.value.map((v) => String(v ?? '')).filter(Boolean).join(', ');
          } else if (first.value !== undefined && first.value !== null) {
            valStr = String(first.value);
          } else if (first.defaultValue !== undefined && first.defaultValue !== null) {
            valStr = String(first.defaultValue);
          }
          valStr = valStr.trim();
          if (valStr === 'Off' || valStr === 'No') valStr = '';

          const cleanLabel = humanizeFieldName(rawName);
          if (!cleanLabel) continue;
          const normKey = normalizeStr(cleanLabel);
          fieldMap.set(rawName, { rawName, cleanLabel, normKey, value: valStr });
        }
      }
    } catch {
      // Fall back to per-page annotations below
    }

    // 2. Extract page text lines + any widget annotations missed by getFieldObjects
    const maxPages = Math.min(pageCount, 12);
    const lines: string[] = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await doc.getPage(pageNum);

      // Widget fallback
      if (fieldMap.size === 0) {
        try {
          const annots = await page.getAnnotations();
          for (const annot of annots) {
            const a = annot as {
              subtype?: string;
              fieldName?: string;
              fieldValue?: unknown;
              buttonValue?: unknown;
            };
            if (a.subtype !== 'Widget' || !a.fieldName) continue;
            const rawVal = a.fieldValue ?? a.buttonValue ?? '';
            const valStr = String(rawVal === 'Off' ? '' : rawVal).trim();
            const cleanLabel = humanizeFieldName(a.fieldName);
            if (!cleanLabel) continue;
            if (!fieldMap.has(a.fieldName) || valStr) {
              fieldMap.set(a.fieldName, {
                rawName: a.fieldName,
                cleanLabel,
                normKey: normalizeStr(cleanLabel),
                value: valStr,
              });
            }
          }
        } catch {
          // Ignore annotation read failure on a page
        }
      }

      // Reconstruct readable lines by grouping text items on similar Y baselines
      try {
        const textContent = await page.getTextContent();
        const rows: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];

        for (const item of textContent.items) {
          if (!('str' in item) || typeof item.str !== 'string') continue;
          const str = item.str.trim();
          if (!str) continue;
          const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
          const x = Number(transform[4]) || 0;
          const y = Number(transform[5]) || 0;

          let row = rows.find((r) => Math.abs(r.y - y) <= 3.5);
          if (!row) {
            row = { y, items: [] };
            rows.push(row);
          }
          row.items.push({ x, str });
        }

        // PDF Y coordinates grow upward, so sort descending (top to bottom)
        rows.sort((a, b) => b.y - a.y);
        for (const row of rows) {
          row.items.sort((a, b) => a.x - b.x);
          const lineText = row.items
            .map((it) => it.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (lineText) {
            lines.push(lineText);
          }
        }
      } catch {
        // Ignore page text extraction error
      }
    }

    return {
      fields: Array.from(fieldMap.values()),
      lines,
      pdfTitle,
      pageCount,
    };
  } finally {
    if (typeof (doc as unknown as { destroy?: () => Promise<void> }).destroy === 'function') {
      await (doc as unknown as { destroy: () => Promise<void> }).destroy();
    } else if (typeof loadingTask.destroy === 'function') {
      await loadingTask.destroy();
    }
  }
}

const VITAL_KEYWORDS =
  /\b(vida|pv|hp|hit points?|hpmax|pvmax|sanidade|san|sanity|esforco|pe|mana|pm|estresse|stress|humanidade|humanity|sorte|luck|armadura|armor|escudo|shield|energia|energy|stamina|fadiga|fp|willpower|forca de vontade|vitalidade|vigor atual)\b/;

const COUNTER_KEYWORDS =
  /\b(municao|ammo|balas|espacos de magia|spell slots?|fome|hunger|ferimentos|wounds|morte|death saves?|hero points?|pontos heroicos|bennies|benes|destino|fate|cargas|charges|usos|uses|inspiracao)\b/;

const PRIMARY_ATTR_PATTERNS: Array<{ re: RegExp; canonical?: string }> = [
  { re: /^(forca|for|strength|str)$/ },
  { re: /^(destreza|des|dexterity|dex)$/ },
  { re: /^(constituicao|con|constitution)$/ },
  { re: /^(inteligencia|int|intelligence|intelecto)$/ },
  { re: /^(sabedoria|sab|wisdom|wis)$/ },
  { re: /^(carisma|car|charisma|cha)$/ },
  { re: /^(agilidade|agi|agility)$/ },
  { re: /^(presenca|pre|presence)$/ },
  { re: /^(vigor|vig|body|corpo)$/ },
  { re: /^(poder|pod|pow|power|espirito|spirit)$/ },
  { re: /^(educacao|edu|education)$/ },
  { re: /^(aparencia|apa|app|appearance)$/ },
  { re: /^(tamanho|tam|siz|size)$/ },
  { re: /^(reflexos|ref|reflexes|tecnica|tech|empatia|emp|empathy|autocontrole|cool|movimento|move)$/ },
  { re: /^(raciocinio|wits|determinacao|resolve|compostura|composure|manipulacao|manipulation)$/ },
  { re: /^(astucia|smarts|st|dx|iq|ht)$/ },
];

const COMBAT_KEYWORDS =
  /\b(ca|ac|classe de armadura|armor class|defesa|defense|iniciativa|initiative|deslocamento|speed|ataque|attack|dano|damage|arma|weapon|espada|pistola|rifle|arco|esquiva|dodge|aparar|parry|bloqueio|block|luta|pontaria|briga|brawl|firearms|armas)\b/;

const TEXT_SECTION_KEYWORDS =
  /\b(equipamento|equipment|inventario|inventory|mochila|habilidades|abilities|poderes|powers|talentos|feats|rituais|rituals|magias|spells|grimorio|disciplinas|disciplines|cyberware|implantes|historico|backstory|historia|background|personalidade|personality|ideais|vinculos|defeitos|notas|notes|anotacoes|caracteristicas|features|traits|tracos|aparencia|aliados|contatos|objetivos|ataques e conjuracao)\b/;

const IDENTITY_NAME_KEY =
  /\b(character\s*name|char\s*name|nome\s*do?\s*personagem|nome\s*do?\s*agente|nome\s*do?\s*investigador|personagem|investigator|charactername|playername|nome)\b/;

const SUBTITLE_KEYS =
  /\b(classe|classlevel|class|nivel|level|nex|origem|origin|ocupacao|occupation|raca|race|ancestralidade|ancestry|cla|clan|trilha|arqu[eé]tipo|role|papel|conceito|concept)\b/;

function isPrimaryAttr(normLabel: string): boolean {
  return PRIMARY_ATTR_PATTERNS.some((p) => p.re.test(normLabel));
}

function buildBlocksFromData(
  fields: ExtractedField[],
  lines: string[],
  system: SystemProfile,
  fileName: string
): ParsedPdfSheetResult {
  const blocks: ParsedSheetBlock[] = [];
  const usedKeys = new Set<string>();
  const ts = Date.now().toString(36);
  const nextId = () => `pdfblk_${ts}_${blocks.length}`;

  let characterName = '';
  const subtitleParts: string[] = [];

  // --- STEP A: Character identity from AcroForm fields ---
  for (const f of fields) {
    if (!f.value) continue;
    if (!characterName && IDENTITY_NAME_KEY.test(f.normKey) && !/jogador|player/.test(f.normKey)) {
      if (f.value.length >= 2 && f.value.length <= 80) {
        characterName = f.value;
      }
    } else if (SUBTITLE_KEYS.test(f.normKey) && f.value.length >= 1 && f.value.length <= 45) {
      if (subtitleParts.length < 3 && !subtitleParts.includes(f.value)) {
        subtitleParts.push(f.value);
      }
    }
  }

  // Fallback identity from printed text lines
  if (!characterName) {
    for (const line of lines.slice(0, 40)) {
      const m = /^(?:nome(?:\s+do\s+(?:personagem|agente|investigador))?|personagem|character\s*name|investigator)\s*[:\-–]\s*(.{2,60})$/i.exec(
        line
      );
      if (m && m[1] && !/^_{2,}$/.test(m[1].trim())) {
        characterName = m[1].trim();
        break;
      }
    }
  }

  if (subtitleParts.length === 0) {
    for (const line of lines.slice(0, 50)) {
      const m = /^(?:classe|origem|ocupa[çc][ãa]o|cl[ãa]|ra[çc]a|ancestralidade|n[íi]vel|nex|arqu[ée]tipo|conceito)\s*[:\-–]\s*(.{1,40})$/i.exec(
        line
      );
      if (m && m[1] && !/^_{2,}$/.test(m[1].trim())) {
        const val = m[1].trim();
        if (!subtitleParts.includes(val) && subtitleParts.length < 3) {
          subtitleParts.push(val);
        }
      }
    }
  }

  // --- STEP B: Build blocks from AcroForm fields (highest fidelity) ---
  if (fields.length > 0) {
    // Group bar current/max pairs (e.g. HP + HPMax, PV + PV_Max)
    const barBuckets = new Map<
      string,
      { label: string; current?: number; max?: number; norm: string }
    >();

    // Collect D&D modifiers if present so ability blocks use real modifiers
    const modifierLookup = new Map<string, number>();
    for (const f of fields) {
      const num = parseNumberLoose(f.value);
      if (num === null) continue;
      const modMatch = /^(str|dex|con|int|wis|cha|for|des|sab|car)\s*mod$|^mod\s*(str|dex|con|int|wis|cha|for|des|sab|car)$/.exec(
        f.normKey
      );
      if (modMatch) {
        const base = (modMatch[1] || modMatch[2] || '').trim();
        if (base) modifierLookup.set(base, num);
      }
    }

    for (const f of fields) {
      if (IDENTITY_NAME_KEY.test(f.normKey) || SUBTITLE_KEYS.test(f.normKey)) continue;
      if (/^(str|dex|con|int|wis|cha|for|des|sab|car)\s*mod$|^mod\s*(str|dex|con|int|wis|cha|for|des|sab|car)$/.test(f.normKey)) {
        continue;
      }

      const ratio = parseRatio(f.value);
      const num = parseNumberLoose(f.value);
      const isMaxVariant = /\b(max|maximo|total|base)\b/.test(f.normKey);
      const isCurrVariant = /\b(atual|current|curr|temp)\b/.test(f.normKey);

      // 1. Bars
      if (VITAL_KEYWORDS.test(f.normKey) || ratio) {
        const baseNorm = f.normKey
          .replace(/\b(max|maximo|atual|current|curr|total)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim() || f.normKey;
        const cleanBaseLabel = f.cleanLabel
          .replace(/\b(max|máximo|maximo|atual|current|curr)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim() || f.cleanLabel;

        const existing = barBuckets.get(baseNorm) || {
          label: cleanBaseLabel,
          norm: baseNorm,
        };
        if (ratio) {
          existing.current = ratio.current;
          existing.max = ratio.max;
        } else if (num !== null) {
          if (isMaxVariant) {
            existing.max = Math.max(1, num);
          } else if (isCurrVariant || existing.current === undefined) {
            existing.current = num;
          } else {
            existing.max = Math.max(1, num);
          }
        }
        barBuckets.set(baseNorm, existing);
        continue;
      }

      // 2. Counters
      if (COUNTER_KEYWORDS.test(f.normKey)) {
        if (usedKeys.has(`cnt:${f.normKey}`)) continue;
        usedKeys.add(`cnt:${f.normKey}`);
        const count = num !== null ? Math.min(20, Math.max(0, Math.round(num))) : 0;
        const maxCount = Math.min(20, Math.max(count || 5, 5));
        blocks.push({
          id: nextId(),
          type: 'counter',
          section: 'Recursos',
          label: f.cleanLabel,
          count,
          maxCount,
        });
        continue;
      }

      // 3. Dice formula inside a weapon/attack field (e.g. "1d8 + 3")
      const diceInside = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(f.value);
      if (diceInside && COMBAT_KEYWORDS.test(f.normKey)) {
        if (usedKeys.has(`attr:${f.normKey}`)) continue;
        usedKeys.add(`attr:${f.normKey}`);
        blocks.push({
          id: nextId(),
          type: 'attribute',
          section: 'Combate',
          label: f.cleanLabel,
          value: 0,
          formula: diceInside[1].replace(/\s+/g, ' '),
        });
        continue;
      }

      // 4. Numeric attributes & skills
      if (num !== null) {
        if (usedKeys.has(`attr:${f.normKey}`)) continue;
        usedKeys.add(`attr:${f.normKey}`);

        const primary = isPrimaryAttr(f.normKey);
        const combat = COMBAT_KEYWORDS.test(f.normKey);
        let value = num;
        if (system.useDndAbilityMod && primary) {
          const shortKey = f.normKey.slice(0, 3);
          if (modifierLookup.has(shortKey)) {
            value = modifierLookup.get(shortKey)!;
          } else if (num >= 3 && num <= 30) {
            value = Math.floor((num - 10) / 2);
          }
        }

        blocks.push({
          id: nextId(),
          type: 'attribute',
          section: primary ? 'Atributos' : combat ? 'Combate' : 'Perícias',
          label: f.cleanLabel,
          value,
          formula: system.defaultFormula(f.cleanLabel, primary),
        });
        continue;
      }

      // 5. Meaningful text blocks
      if (
        (f.value.length >= 6 && !/^(yes|sim|true|false|on)$/i.test(f.value)) ||
        (TEXT_SECTION_KEYWORDS.test(f.normKey) && f.value.length > 0)
      ) {
        if (usedKeys.has(`txt:${f.normKey}`)) continue;
        usedKeys.add(`txt:${f.normKey}`);
        blocks.push({
          id: nextId(),
          type: 'text',
          section: TEXT_SECTION_KEYWORDS.test(f.normKey) ? 'Habilidades e Inventário' : 'Notas',
          label: f.cleanLabel,
          text: f.value.slice(0, 2000),
        });
      }
    }

    // Flush grouped bars to the top of the sheet
    const barBlocks: ParsedSheetBlock[] = [];
    for (const bucket of barBuckets.values()) {
      const max = Math.max(1, bucket.max ?? bucket.current ?? 10);
      const current = bucket.current ?? max;
      usedKeys.add(`bar:${bucket.norm}`);
      barBlocks.push({
        id: `pdfblk_${ts}_bar_${barBlocks.length}`,
        type: 'bar',
        section: 'Recursos',
        label: bucket.label,
        current,
        max,
        barColor: chooseBarColor(bucket.norm),
      });
    }
    blocks.unshift(...barBlocks);
  }

  // --- STEP C: Extract from flat PDF text lines (for non-fillable / printed PDFs) ---
  if (blocks.length < 8 && lines.length > 0) {
    // 1. Look for "Label: current/max" or "Label current/max"
    for (const line of lines) {
      if (blocks.length >= 48) break;

      const ratioMatch = /^([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9\s/()]{1,36}?)\s*[:\-–]?\s*(-?\d{1,4})\s*\/\s*(\d{1,4})\b/.exec(
        line
      );
      if (ratioMatch) {
        const label = ratioMatch[1].trim();
        const norm = normalizeStr(label);
        if (norm && !usedKeys.has(`bar:${norm}`) && !/^(pagina|page|data|date|\d+)$/.test(norm)) {
          const current = Number(ratioMatch[2]);
          const max = Math.max(1, Number(ratioMatch[3]));
          if (VITAL_KEYWORDS.test(norm) || max <= 500) {
            usedKeys.add(`bar:${norm}`);
            blocks.push({
              id: nextId(),
              type: 'bar',
              section: 'Recursos',
              label,
              current,
              max,
              barColor: chooseBarColor(norm),
            });
            continue;
          }
        }
      }

      // 2. Look for weapon/attack dice notation: "Espada Longa: 1d8 + 3" or "Pistola 2d6"
      const diceLine = /^([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9\s().-]{1,36}?)\s*[:\-–]?\s*(\d{1,2}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\b/i.exec(
        line
      );
      if (diceLine) {
        const label = diceLine[1].trim();
        const norm = normalizeStr(label);
        if (norm && !usedKeys.has(`attr:${norm}`)) {
          usedKeys.add(`attr:${norm}`);
          blocks.push({
            id: nextId(),
            type: 'attribute',
            section: 'Combate',
            label,
            value: 0,
            formula: diceLine[2].replace(/\s+/g, ' '),
          });
          continue;
        }
      }

      // 3. Look for "Label: Value" or "Label +Value" pairs (supports multiple pairs on one line separated by wide spaces/pipes)
      const segments = line.split(/\s{2,}|\s*[|•·]\s*/);
      for (const seg of segments) {
        if (blocks.length >= 48) break;
        const kv = /^([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s().]{1,30}?)\s*[:\-–]?\s*([+-]?\d{1,3})%?$/.exec(
          seg.trim()
        );
        if (!kv) continue;
        const label = kv[1].trim();
        const norm = normalizeStr(label);
        if (!norm || norm.length < 2) continue;
        if (/^(pagina|page|cap|capitulo|edicao|nivel|level|nex|idade|age|altura|peso|ano|year)$/.test(norm)) {
          continue;
        }
        const num = Number(kv[2]);
        if (!Number.isFinite(num)) continue;

        if (VITAL_KEYWORDS.test(norm)) {
          if (usedKeys.has(`bar:${norm}`)) continue;
          usedKeys.add(`bar:${norm}`);
          const max = Math.max(1, num);
          blocks.push({
            id: nextId(),
            type: 'bar',
            section: 'Recursos',
            label,
            current: max,
            max,
            barColor: chooseBarColor(norm),
          });
        } else if (COUNTER_KEYWORDS.test(norm)) {
          if (usedKeys.has(`cnt:${norm}`)) continue;
          usedKeys.add(`cnt:${norm}`);
          const count = Math.min(20, Math.max(0, Math.round(num)));
          blocks.push({
            id: nextId(),
            type: 'counter',
            section: 'Recursos',
            label,
            count,
            maxCount: Math.max(count || 5, 5),
          });
        } else {
          if (usedKeys.has(`attr:${norm}`)) continue;
          usedKeys.add(`attr:${norm}`);
          const primary = isPrimaryAttr(norm);
          const combat = COMBAT_KEYWORDS.test(norm);
          let value = num;
          if (system.useDndAbilityMod && primary && num >= 3 && num <= 30) {
            value = Math.floor((num - 10) / 2);
          }
          blocks.push({
            id: nextId(),
            type: 'attribute',
            section: primary ? 'Atributos' : combat ? 'Combate' : 'Perícias',
            label,
            value,
            formula: system.defaultFormula(label, primary),
          });
        }
      }
    }

    // 4. Extract named text sections (Equipamento, Habilidades, Rituais, Histórico, etc.)
    for (let i = 0; i < lines.length && blocks.length < 52; i++) {
      const heading = lines[i].replace(/[:\-–]+$/, '').trim();
      const norm = normalizeStr(heading);
      if (heading.length >= 3 && heading.length <= 36 && TEXT_SECTION_KEYWORDS.test(norm)) {
        if (usedKeys.has(`txt:${norm}`)) continue;
        const collected: string[] = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const candidate = lines[j].trim();
          const candNorm = normalizeStr(candidate);
          if (candidate.length <= 32 && TEXT_SECTION_KEYWORDS.test(candNorm)) break;
          if (candidate.length >= 4) collected.push(candidate);
        }
        if (collected.length > 0) {
          usedKeys.add(`txt:${norm}`);
          blocks.push({
            id: nextId(),
            type: 'text',
            section: 'Habilidades e Inventário',
            label: heading,
            text: collected.join('\n').slice(0, 1800),
          });
        }
      }
    }
  }

  // --- STEP D: System-aware structure for blank sheets or scanned image-only PDFs ---
  if (blocks.length === 0) {
    const isScanned = lines.length === 0 && fields.length === 0;
    const starterBySystem = buildSystemStarterBlocks(system, ts, isScanned);
    blocks.push(...starterBySystem);
  }

  // Sort sections cleanly so Recursos -> Atributos -> Combate -> Perícias -> Habilidades -> Notas
  const sectionOrder: Record<string, number> = {
    Recursos: 0,
    Atributos: 1,
    Combate: 2,
    Perícias: 3,
    'Habilidades e Inventário': 4,
    Notas: 5,
  };

  blocks.sort((a, b) => (sectionOrder[a.section] ?? 9) - (sectionOrder[b.section] ?? 9));

  const finalName = characterName || cleanTitleFromFileName(fileName) || 'Personagem PDF';
  const finalSubtitle =
    subtitleParts.length > 0
      ? subtitleParts.join(' · ').slice(0, 120)
      : lines.length === 0 && fields.length === 0
      ? `${system.name} · PDF escaneado anexado`
      : system.name;

  return {
    systemName: system.name.slice(0, 80),
    characterName: finalName.slice(0, 100),
    subtitle: finalSubtitle.slice(0, 120),
    blocks: blocks.slice(0, 55),
  };
}

function buildSystemStarterBlocks(
  system: SystemProfile,
  ts: string,
  isScanned: boolean
): ParsedSheetBlock[] {
  const mkId = (i: number) => `pdfblk_${ts}_st_${i}`;
  const noteText = isScanned
    ? 'Este PDF é uma imagem escaneada sem texto selecionável. O arquivo original completo já está disponível na aba "PDF Original" ao lado, e você pode preencher os blocos interativos aqui.'
    : 'Ficha detectada em branco. Ajuste os valores e clique nos atributos para rolar diretamente no chat da mesa.';

  if (system.id === 'ordem') {
    return [
      { id: mkId(0), type: 'bar', section: 'Recursos', label: 'Vida (PV)', current: 20, max: 20, barColor: '#8f2d2d' },
      { id: mkId(1), type: 'bar', section: 'Recursos', label: 'Sanidade (SAN)', current: 12, max: 12, barColor: '#34517a' },
      { id: mkId(2), type: 'bar', section: 'Recursos', label: 'Esforço (PE)', current: 4, max: 4, barColor: '#7a5a26' },
      { id: mkId(3), type: 'attribute', section: 'Atributos', label: 'Agilidade', value: 2, formula: '{Agilidade}d20kh1' },
      { id: mkId(4), type: 'attribute', section: 'Atributos', label: 'Força', value: 1, formula: '{Força}d20kh1' },
      { id: mkId(5), type: 'attribute', section: 'Atributos', label: 'Intelecto', value: 2, formula: '{Intelecto}d20kh1' },
      { id: mkId(6), type: 'attribute', section: 'Atributos', label: 'Presença', value: 2, formula: '{Presença}d20kh1' },
      { id: mkId(7), type: 'attribute', section: 'Atributos', label: 'Vigor', value: 2, formula: '{Vigor}d20kh1' },
      { id: mkId(8), type: 'text', section: 'Notas', label: 'Rituais, Poderes e Inventário', text: noteText },
    ];
  }

  if (system.id === 'coc') {
    return [
      { id: mkId(0), type: 'bar', section: 'Recursos', label: 'Pontos de Vida', current: 11, max: 11, barColor: '#8f2d2d' },
      { id: mkId(1), type: 'bar', section: 'Recursos', label: 'Sanidade', current: 55, max: 99, barColor: '#34517a' },
      { id: mkId(2), type: 'bar', section: 'Recursos', label: 'Sorte', current: 50, max: 99, barColor: '#7a5a26' },
      { id: mkId(3), type: 'attribute', section: 'Atributos', label: 'Força', value: 50, formula: '1d100 <= {Força}' },
      { id: mkId(4), type: 'attribute', section: 'Atributos', label: 'Destreza', value: 55, formula: '1d100 <= {Destreza}' },
      { id: mkId(5), type: 'attribute', section: 'Atributos', label: 'Inteligência', value: 65, formula: '1d100 <= {Inteligência}' },
      { id: mkId(6), type: 'attribute', section: 'Atributos', label: 'Poder', value: 55, formula: '1d100 <= {Poder}' },
      { id: mkId(7), type: 'attribute', section: 'Atributos', label: 'Educação', value: 60, formula: '1d100 <= {Educação}' },
      { id: mkId(8), type: 'text', section: 'Notas', label: 'Equipamento e Pistas', text: noteText },
    ];
  }

  if (system.id === 'vtm') {
    return [
      { id: mkId(0), type: 'bar', section: 'Recursos', label: 'Vitalidade', current: 6, max: 6, barColor: '#8f2d2d' },
      { id: mkId(1), type: 'bar', section: 'Recursos', label: 'Força de Vontade', current: 5, max: 5, barColor: '#34517a' },
      { id: mkId(2), type: 'counter', section: 'Recursos', label: 'Fome', count: 1, maxCount: 5 },
      { id: mkId(3), type: 'attribute', section: 'Atributos', label: 'Força', value: 2, formula: '{Força}d10>=6' },
      { id: mkId(4), type: 'attribute', section: 'Atributos', label: 'Destreza', value: 3, formula: '{Destreza}d10>=6' },
      { id: mkId(5), type: 'attribute', section: 'Atributos', label: 'Carisma', value: 3, formula: '{Carisma}d10>=6' },
      { id: mkId(6), type: 'attribute', section: 'Atributos', label: 'Raciocínio', value: 2, formula: '{Raciocínio}d10>=6' },
      { id: mkId(7), type: 'text', section: 'Notas', label: 'Disciplinas e Notas', text: noteText },
    ];
  }

  if (system.id === 'dnd5e' || system.id === 't20' || system.id === 'pathfinder') {
    const blocks: ParsedSheetBlock[] = [
      { id: mkId(0), type: 'bar', section: 'Recursos', label: 'Pontos de Vida', current: 12, max: 12, barColor: '#8f2d2d' },
    ];
    if (system.id === 't20') {
      blocks.push({ id: mkId(1), type: 'bar', section: 'Recursos', label: 'Pontos de Mana', current: 6, max: 6, barColor: '#34517a' });
    }
    const attrs = ['Força', 'Destreza', 'Constituição', 'Inteligência', 'Sabedoria', 'Carisma'];
    attrs.forEach((label, idx) => {
      blocks.push({
        id: mkId(idx + 2),
        type: 'attribute',
        section: 'Atributos',
        label,
        value: 0,
        formula: `1d20 + {${label}}`,
      });
    });
    blocks.push({ id: mkId(9), type: 'text', section: 'Notas', label: 'Habilidades e Equipamento', text: noteText });
    return blocks;
  }

  return [
    { id: mkId(0), type: 'bar', section: 'Recursos', label: 'Vida / Recurso Principal', current: 10, max: 10, barColor: '#8f2d2d' },
    { id: mkId(1), type: 'attribute', section: 'Atributos', label: 'Atributo 1', value: 0, formula: '1d20 + {Atributo 1}' },
    { id: mkId(2), type: 'attribute', section: 'Atributos', label: 'Atributo 2', value: 0, formula: '1d20 + {Atributo 2}' },
    { id: mkId(3), type: 'text', section: 'Notas', label: 'Anotações da Ficha', text: noteText },
  ];
}

export async function parseSheetPdfLocally(
  pdfBuffer: Buffer,
  fileName: string
): Promise<ParsedPdfSheetResult> {
  const { fields, lines, pdfTitle } = await extractPdfContent(pdfBuffer);

  const corpus = [
    fileName,
    pdfTitle,
    ...fields.map((f) => `${f.cleanLabel} ${f.value}`),
    ...lines.slice(0, 120),
  ].join('\n');

  const system = detectSystem(corpus, pdfTitle);
  return buildBlocksFromData(fields, lines, system, fileName);
}
