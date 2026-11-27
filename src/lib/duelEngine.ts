import { audioEngine } from './audioEngine';
import { buildAutoItemFormula } from './diceEngine';
import { resolveMediaUrl } from './mediaStore';
import type {
  ActiveDuelState,
  CharacterSheet,
  CustomDuelArenaPreset,
  DuelActionItem,
  DuelArenaPresetId,
  DuelAttackSfxMap,
  DuelCombatantState,
  DuelCustomSfxEntry,
  DuelExtraSettings,
  DuelParticleKind,
  DuelStatusTagTone,
  Scene,
  SceneDuelConfig,
  SceneToken,
  SheetBlock,
} from '../types/vtt';

export interface DuelArenaPresetMeta {
  id: DuelArenaPresetId;
  name: string;
  subtitle: string;
  bgColor: string;
  floorColor: string;
  skyGradient: string;
  floorGradient: string;
  floorGridColor: string;
  accentColor: string;
  ambientGlow: string;
  particleKind: DuelParticleKind;
  isCustom?: boolean;
}

export const DUEL_PARTICLE_OPTIONS: Array<{ id: DuelParticleKind; label: string }> = [
  { id: 'none', label: 'Sem partículas' },
  { id: 'dust', label: 'Poeira' },
  { id: 'sparks', label: 'Faíscas' },
  { id: 'rain', label: 'Chuva' },
  { id: 'lights', label: 'Pontos de Luz' },
  { id: 'leaves', label: 'Folhas / Flocos' },
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#d9a760').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildArenaPresetMetaFromCustom(custom: CustomDuelArenaPreset): DuelArenaPresetMeta {
  const bg = custom.bgColor || '#1a1614';
  const floor = custom.floorColor || '#2b231d';
  const accent = custom.accentColor || '#d9a760';
  const partLabel =
    DUEL_PARTICLE_OPTIONS.find((p) => p.id === custom.particleKind)?.label || 'Sem partículas';

  return {
    id: custom.id,
    name: custom.name || 'Customizado',
    subtitle: `Fundo ${bg} · Partículas: ${partLabel}`,
    bgColor: bg,
    floorColor: floor,
    skyGradient: `radial-gradient(ellipse at 50% 24%, ${bg} 0%, #090808 68%, #040404 100%)`,
    floorGradient: `radial-gradient(circle at 50% 50%, ${hexToRgba(floor, 0.88)} 0%, ${hexToRgba(
      bg,
      0.96
    )} 68%, #050505 100%)`,
    floorGridColor: hexToRgba(accent, 0.25),
    accentColor: accent,
    ambientGlow: hexToRgba(accent, 0.26),
    particleKind: custom.particleKind || 'dust',
    isCustom: true,
  };
}

export const DUEL_ARENA_PRESETS: DuelArenaPresetMeta[] = [
  {
    id: 'expedition_ruins',
    name: 'Âmbar · Poeira',
    subtitle: 'Fundo âmbar escuro · Partículas de poeira',
    bgColor: '#2c221e',
    floorColor: '#48382c',
    skyGradient: 'radial-gradient(ellipse at 50% 25%, #2c221e 0%, #120e0c 58%, #070606 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(72, 56, 44, 0.88) 0%, rgba(22, 18, 15, 0.96) 68%, rgba(8, 7, 6, 1) 100%)',
    floorGridColor: 'rgba(217, 167, 96, 0.22)',
    accentColor: '#d9a760',
    ambientGlow: 'rgba(217, 167, 96, 0.24)',
    particleKind: 'dust',
  },
  {
    id: 'persona_crimson',
    name: 'Vermelho · Faíscas',
    subtitle: 'Fundo vermelho escuro · Faíscas',
    bgColor: '#450a0a',
    floorColor: '#7f1d1d',
    skyGradient: 'radial-gradient(ellipse at 55% 20%, #450a0a 0%, #180404 55%, #050202 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(127, 29, 29, 0.78) 0%, rgba(24, 6, 6, 0.96) 65%, rgba(5, 2, 2, 1) 100%)',
    floorGridColor: 'rgba(239, 68, 68, 0.3)',
    accentColor: '#ef4444',
    ambientGlow: 'rgba(239, 68, 68, 0.28)',
    particleKind: 'sparks',
  },
  {
    id: 'pokemon_stadium',
    name: 'Azul · Luzes',
    subtitle: 'Fundo azul escuro · Pontos de luz',
    bgColor: '#1e293b',
    floorColor: '#1e3a5f',
    skyGradient: 'radial-gradient(ellipse at 50% 18%, #1e293b 0%, #0f172a 58%, #04070d 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(30, 58, 95, 0.82) 0%, rgba(15, 23, 42, 0.96) 68%, rgba(4, 7, 13, 1) 100%)',
    floorGridColor: 'rgba(56, 189, 248, 0.26)',
    accentColor: '#38bdf8',
    ambientGlow: 'rgba(56, 189, 248, 0.24)',
    particleKind: 'lights',
  },
  {
    id: 'astral_sanctuary',
    name: 'Roxo · Poeira',
    subtitle: 'Fundo roxo escuro · Partículas de poeira',
    bgColor: '#2e1065',
    floorColor: '#4c1d95',
    skyGradient: 'radial-gradient(ellipse at 50% 22%, #2e1065 0%, #110626 60%, #05020c 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(76, 29, 149, 0.75) 0%, rgba(19, 9, 39, 0.95) 68%, rgba(5, 2, 12, 1) 100%)',
    floorGridColor: 'rgba(168, 85, 247, 0.28)',
    accentColor: '#a855f7',
    ambientGlow: 'rgba(168, 85, 247, 0.26)',
    particleKind: 'dust',
  },
  {
    id: 'noir_rain',
    name: 'Cinza · Chuva',
    subtitle: 'Fundo cinza escuro · Chuva',
    bgColor: '#1c242b',
    floorColor: '#263038',
    skyGradient: 'radial-gradient(ellipse at 50% 20%, #1c242b 0%, #0d1114 60%, #050608 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(38, 48, 56, 0.85) 0%, rgba(14, 18, 22, 0.96) 68%, rgba(5, 6, 8, 1) 100%)',
    floorGridColor: 'rgba(148, 163, 184, 0.2)',
    accentColor: '#94a3b8',
    ambientGlow: 'rgba(148, 163, 184, 0.2)',
    particleKind: 'rain',
  },
  {
    id: 'shadow_forest',
    name: 'Verde · Folhas',
    subtitle: 'Fundo verde escuro · Folhas / flocos',
    bgColor: '#062e1e',
    floorColor: '#14532d',
    skyGradient: 'radial-gradient(ellipse at 50% 22%, #062e1e 0%, #04170f 60%, #020805 100%)',
    floorGradient:
      'radial-gradient(circle at 50% 50%, rgba(20, 83, 45, 0.76) 0%, rgba(7, 26, 16, 0.96) 68%, rgba(2, 8, 5, 1) 100%)',
    floorGridColor: 'rgba(52, 211, 153, 0.24)',
    accentColor: '#10b981',
    ambientGlow: 'rgba(16, 185, 129, 0.24)',
    particleKind: 'leaves',
  },
];

const CUSTOM_DUEL_PRESETS_KEY = 'folio_custom_duel_presets_v1';

export function loadCustomDuelPresets(): CustomDuelArenaPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_DUEL_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomDuelArenaPreset[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomDuelPreset(preset: CustomDuelArenaPreset): CustomDuelArenaPreset[] {
  const existing = loadCustomDuelPresets().filter((p) => p.id !== preset.id);
  const next = [...existing, preset];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CUSTOM_DUEL_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota
    }
  }
  return next;
}

export function deleteCustomDuelPreset(id: string): CustomDuelArenaPreset[] {
  const next = loadCustomDuelPresets().filter((p) => p.id !== id);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CUSTOM_DUEL_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function getAllDuelArenaPresets(): DuelArenaPresetMeta[] {
  const customs = loadCustomDuelPresets().map(buildArenaPresetMetaFromCustom);
  return [...DUEL_ARENA_PRESETS, ...customs];
}

export function getDuelArenaPreset(
  id?: DuelArenaPresetId,
  customStyle?: CustomDuelArenaPreset | null
): DuelArenaPresetMeta {
  if (customStyle && (!id || id === customStyle.id)) {
    return buildArenaPresetMetaFromCustom(customStyle);
  }
  const builtIn = DUEL_ARENA_PRESETS.find((p) => p.id === id);
  if (builtIn) return builtIn;
  const savedCustom = loadCustomDuelPresets().find((p) => p.id === id);
  if (savedCustom) return buildArenaPresetMetaFromCustom(savedCustom);
  if (customStyle) return buildArenaPresetMetaFromCustom(customStyle);
  return DUEL_ARENA_PRESETS[0];
}

const DUEL_CFG_STORAGE_PREFIX = 'folio_scene_duel_cfg_v1';
const CAMPAIGN_ATTACK_SFX_PREFIX = 'folio_duel_attack_sfx_v1';
const CAMPAIGN_ACTION_SFX_PREFIX = 'folio_duel_action_sfx_v1';
const CAMPAIGN_DUEL_EXTRAS_PREFIX = 'folio_duel_extras_v1';
const CAMPAIGN_DUELS_BY_SCENE_PREFIX = 'folio_duels_by_scene_v1';

export const DEFAULT_DUEL_EXTRA_SETTINGS: DuelExtraSettings = {
  layoutStyle: 'minimal',
  comboEnabled: true,
  mouseAttackDamageEnabled: true,
  mouseAttackDamage: 1,
  showSecondaryResource: false,
  secondaryResourceLabel: 'MP',
  showStatusTags: false,
};

export const DUEL_STATUS_PRESETS: Array<{ label: string; tone: DuelStatusTagTone }> = [
  { label: 'Queimando', tone: 'danger' },
  { label: 'Sangrando', tone: 'danger' },
  { label: 'Envenenado', tone: 'danger' },
  { label: 'Atordoado', tone: 'warning' },
  { label: 'Caído', tone: 'warning' },
  { label: 'Vulnerável', tone: 'warning' },
  { label: 'Focado', tone: 'info' },
  { label: 'Concentrado', tone: 'info' },
  { label: 'Protegido', tone: 'buff' },
  { label: 'Inspirado', tone: 'buff' },
];

export function resolveDuelExtraSettings(
  settings?: Partial<DuelExtraSettings> | null
): DuelExtraSettings {
  const rawDamage = Number(settings?.mouseAttackDamage);
  return {
    layoutStyle:
      settings?.layoutStyle === 'medieval' || settings?.layoutStyle === 'stylized'
        ? settings.layoutStyle
        : 'minimal',
    comboEnabled:
      typeof settings?.comboEnabled === 'boolean'
        ? settings.comboEnabled
        : DEFAULT_DUEL_EXTRA_SETTINGS.comboEnabled,
    mouseAttackDamageEnabled:
      typeof settings?.mouseAttackDamageEnabled === 'boolean'
        ? settings.mouseAttackDamageEnabled
        : DEFAULT_DUEL_EXTRA_SETTINGS.mouseAttackDamageEnabled,
    mouseAttackDamage:
      Number.isFinite(rawDamage) && rawDamage >= 1 ? Math.min(999, Math.round(rawDamage)) : 1,
    showSecondaryResource: Boolean(settings?.showSecondaryResource),
    secondaryResourceLabel:
      typeof settings?.secondaryResourceLabel === 'string' &&
      settings.secondaryResourceLabel.trim().length > 0
        ? settings.secondaryResourceLabel.trim().slice(0, 16)
        : 'MP',
    showStatusTags: Boolean(settings?.showStatusTags),
  };
}

export function loadCampaignDuelExtraSettings(campaignId: string): DuelExtraSettings {
  if (!campaignId || typeof window === 'undefined') return { ...DEFAULT_DUEL_EXTRA_SETTINGS };
  try {
    const raw = window.localStorage.getItem(`${CAMPAIGN_DUEL_EXTRAS_PREFIX}_${campaignId}`);
    if (!raw) return { ...DEFAULT_DUEL_EXTRA_SETTINGS };
    return resolveDuelExtraSettings(JSON.parse(raw) as Partial<DuelExtraSettings>);
  } catch {
    return { ...DEFAULT_DUEL_EXTRA_SETTINGS };
  }
}

export function saveCampaignDuelExtraSettings(
  campaignId: string,
  settings: DuelExtraSettings
): DuelExtraSettings {
  const clean = resolveDuelExtraSettings(settings);
  if (campaignId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${CAMPAIGN_DUEL_EXTRAS_PREFIX}_${campaignId}`,
        JSON.stringify(clean)
      );
    } catch {
      // ignore quota
    }
  }
  return clean;
}

export function loadCampaignDuelsByScene(campaignId: string): Record<string, ActiveDuelState> {
  if (!campaignId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${CAMPAIGN_DUELS_BY_SCENE_PREFIX}_${campaignId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, ActiveDuelState> = {};
    for (const [sceneId, duel] of Object.entries(parsed as Record<string, ActiveDuelState>)) {
      if (duel && typeof duel === 'object' && duel.sceneId === sceneId && duel.player && duel.npc) {
        valid[sceneId] = duel;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

export function saveCampaignDuelsByScene(
  campaignId: string,
  map: Record<string, ActiveDuelState>
): void {
  if (!campaignId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${CAMPAIGN_DUELS_BY_SCENE_PREFIX}_${campaignId}`,
      JSON.stringify(map)
    );
  } catch {
    // ignore quota
  }
}

export function loadCampaignAttackSfx(campaignId: string): DuelAttackSfxMap {
  if (!campaignId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${CAMPAIGN_ATTACK_SFX_PREFIX}_${campaignId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DuelAttackSfxMap) : {};
  } catch {
    return {};
  }
}

export function saveCampaignAttackSfx(
  campaignId: string,
  map: DuelAttackSfxMap
): DuelAttackSfxMap {
  if (campaignId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${CAMPAIGN_ATTACK_SFX_PREFIX}_${campaignId}`,
        JSON.stringify(map)
      );
    } catch {
      // ignore quota
    }
  }
  return map;
}

export function loadActionCustomSfxMap(
  campaignId?: string
): Record<string, DuelCustomSfxEntry> {
  if (!campaignId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${CAMPAIGN_ACTION_SFX_PREFIX}_${campaignId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, DuelCustomSfxEntry>)
      : {};
  } catch {
    return {};
  }
}

export function saveActionCustomSfx(
  campaignId: string,
  actionKey: string,
  entry: DuelCustomSfxEntry | null
): Record<string, DuelCustomSfxEntry> {
  const current = loadActionCustomSfxMap(campaignId);
  const next = { ...current };
  if (!entry || (!entry.url && !entry.mediaId)) {
    delete next[actionKey];
  } else {
    next[actionKey] = entry;
  }
  if (campaignId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${CAMPAIGN_ACTION_SFX_PREFIX}_${campaignId}`,
        JSON.stringify(next)
      );
    } catch {
      // ignore quota
    }
  }
  return next;
}

export function loadSceneDuelConfig(campaignId: string, scene: Scene | null): SceneDuelConfig {
  const fallback: SceneDuelConfig = {
    bgUrl: scene?.imageUrl || '',
    bgMediaId: scene?.mediaId || '',
    bgMediaKind: scene?.mediaKind || 'image',
    arenaPreset: 'expedition_ruins',
    customArenaStyle: null,
    musicTrackId: scene?.linkedMusicId || '',
    attackSfxMap: loadCampaignAttackSfx(campaignId),
  };
  if (!scene || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`${DUEL_CFG_STORAGE_PREFIX}_${campaignId}_${scene.id}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SceneDuelConfig>;
    return {
      bgUrl: typeof parsed.bgUrl === 'string' ? parsed.bgUrl : fallback.bgUrl,
      bgMediaId: typeof parsed.bgMediaId === 'string' ? parsed.bgMediaId : fallback.bgMediaId,
      bgMediaKind: parsed.bgMediaKind || fallback.bgMediaKind,
      arenaPreset: parsed.arenaPreset || fallback.arenaPreset,
      customArenaStyle: parsed.customArenaStyle || null,
      musicTrackId:
        typeof parsed.musicTrackId === 'string' ? parsed.musicTrackId : fallback.musicTrackId,
      attackSfxMap: parsed.attackSfxMap || fallback.attackSfxMap,
    };
  } catch {
    return fallback;
  }
}

export function saveSceneDuelConfig(
  campaignId: string,
  sceneId: string,
  config: SceneDuelConfig
): SceneDuelConfig {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${DUEL_CFG_STORAGE_PREFIX}_${campaignId}_${sceneId}`,
        JSON.stringify(config)
      );
    } catch {
      // ignore storage quota errors
    }
  }
  if (config.attackSfxMap) {
    saveCampaignAttackSfx(campaignId, config.attackSfxMap);
  }
  return config;
}

const COMBAT_PRIORITY_RE =
  /\b(luta|pontaria|ataque|attack|espada|pistola|rifle|arco|faca|adaga|machado|lan[çc]a|briga|brawl|armas|weapon|magia|ocultismo|ritual|feiti[çc]o|spell|esquiva|dodge|bloqueio|contra[- ]?ataque|for[çc]a|agilidade|destreza|vigor|intelecto|presen[çc]a|iniciativa|furtividade|atletismo|acrobacia|intimida[çc][ãa]o)\b/i;

const DEFENSE_RE = /\b(esquiva|dodge|defesa|defense|bloqueio|block|aparar|parry|resist[êe]ncia|fortitude|reflexos|vontade)\b/i;
const SPELL_RE = /\b(ocultismo|ritual|magia|spell|feiti[çc]o|arcano|poder|ps[íi]quico|maldi[çc][ãa]o|paranormal|disciplina)\b/i;

function normalizeMatch(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function findSheetForToken(
  token: SceneToken,
  sheets: CharacterSheet[]
): CharacterSheet | null {
  if (token.sheetId) {
    const byId = sheets.find((s) => s.id === token.sheetId);
    if (byId) return byId;
  }
  const tokNorm = normalizeMatch(token.name);
  if (!tokNorm) return null;
  const exact = sheets.find((s) => normalizeMatch(s.name) === tokNorm);
  if (exact) return exact;
  return (
    sheets.find(
      (s) =>
        tokNorm.includes(normalizeMatch(s.name)) ||
        normalizeMatch(s.name).includes(tokNorm)
    ) || null
  );
}

/**
 * Extracts all combat moves, items, skills, spells, and PDF abilities from a CharacterSheet
 * (both modular custom sheets and imported PDF sheets) or Token notes.
 */
export function extractActionsFromSheetAndToken(
  token: SceneToken,
  sheet: CharacterSheet | null
): DuelActionItem[] {
  const actions: DuelActionItem[] = [];
  const seenLabels = new Set<string>();
  const savedActionSfx = loadActionCustomSfxMap(sheet?.campaignId);

  const pushUnique = (item: DuelActionItem) => {
    const key = normalizeMatch(item.label);
    if (!key || seenLabels.has(key)) return;
    seenLabels.add(key);
    const savedSfx = savedActionSfx[`${token.id}_${key}`] || savedActionSfx[key];
    actions.push(
      savedSfx
        ? {
            ...item,
            sfxUrl: savedSfx.url,
            sfxMediaId: savedSfx.mediaId,
            sfxFileName: savedSfx.fileName,
          }
        : item
    );
  };

  const blocks: SheetBlock[] = sheet?.blocks || [];

  // Determine the sheet's primary attack roll formula for text/PDF abilities that only state damage
  const attrBlocks = blocks.filter((b) => b.type === 'attribute');
  const primaryCombatAttr =
    attrBlocks.find((b) => /\b(luta|pontaria|ataque|for[çc]a|agilidade|destreza)\b/i.test(b.label)) ||
    attrBlocks[0];
  const defaultHitFormula = primaryCombatAttr?.formula || '1d20';

  // 1. Custom Items / Weapons / Abilities (type === 'item')
  for (const b of blocks) {
    if (b.type !== 'item') continue;
    const autoFormula =
      b.formula ||
      buildAutoItemFormula({
        diceType: b.diceType || '1d20',
        linkedAttribute: b.linkedAttribute,
        secondaryAttribute: b.secondaryAttribute,
        bonus: b.bonus,
      });
    const isSpell = SPELL_RE.test(b.label) || SPELL_RE.test(b.linkedAttribute || '');
    const isDefense = DEFENSE_RE.test(b.label);
    pushUnique({
      id: `act_itm_${b.id}`,
      label: b.label,
      category: isDefense ? 'defense' : isSpell ? 'spell' : 'attack',
      formula: autoFormula,
      damageFormula: b.damageFormula || (isDefense ? undefined : '1d8'),
      damageLabel: b.damageLabel || 'Dano',
      description: [
        b.linkedAttribute ? `Atributo: ${b.linkedAttribute}` : '',
        b.secondaryAttribute ? `+ ${b.secondaryAttribute}` : '',
        b.damageFormula ? `${b.damageLabel || 'Dano'}: ${b.damageFormula}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      sourceLabel: sheet?.mode === 'pdf' ? 'Item do PDF' : 'Item da Ficha',
    });
  }

  // 2. Combat & Primary Attributes / Skills from Sheet (modular or PDF)
  const sortedAttrs = [...attrBlocks].sort((a, b) => {
    const aCombat = a.section === 'Combate' ? 2 : COMBAT_PRIORITY_RE.test(a.label) ? 1 : 0;
    const bCombat = b.section === 'Combate' ? 2 : COMBAT_PRIORITY_RE.test(b.label) ? 1 : 0;
    return bCombat - aCombat;
  });

  for (const b of sortedAttrs) {
    if (actions.length >= 14) break;
    const isCombatSection = b.section === 'Combate';
    const isPriority = COMBAT_PRIORITY_RE.test(b.label);
    if (!isCombatSection && !isPriority && actions.length >= 8) continue;

    const formula = b.formula || `1d20 + {${b.label}}`;
    const isDefense = DEFENSE_RE.test(b.label);
    const isSpell = SPELL_RE.test(b.label);
    const hasEmbeddedDamage = /^\d+d(4|6|8|10|12)\b/i.test(formula.trim());

    pushUnique({
      id: `act_atr_${b.id}`,
      label: b.label,
      category: isDefense ? 'defense' : isSpell ? 'spell' : isCombatSection ? 'attack' : 'skill',
      formula,
      damageFormula:
        isDefense
          ? undefined
          : hasEmbeddedDamage
            ? formula
            : isCombatSection || /\b(luta|pontaria|ataque|for[çc]a|espada|pistola|arco)\b/i.test(b.label)
              ? `1d8 + {${b.label}}`
              : undefined,
      damageLabel: 'Dano',
      description: `Valor: ${b.value ?? 0} · Rola ${formula}`,
      sourceLabel: sheet?.mode === 'pdf' ? 'Extraído do PDF' : b.section || 'Ficha',
    });
  }

  // 3. Parse Text Blocks (Habilidades, Rituais, Magias, Ataques do PDF) & Token Notes
  const textSources: Array<{ title: string; content: string; origin: string }> = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text && b.text.trim()) {
      textSources.push({
        title: b.label,
        content: b.text,
        origin: sheet?.mode === 'pdf' ? 'PDF' : 'Ficha',
      });
    }
  }
  if (token.notes && token.notes.trim()) {
    textSources.push({
      title: 'Notas do Token',
      content: token.notes,
      origin: 'Token',
    });
  }

  for (const src of textSources) {
    const rawLines = src.content
      .split(/\n|[•·;]/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 3 && l.length <= 140);

    for (const line of rawLines) {
      if (actions.length >= 18) break;
      // Ignore generic placeholder text
      if (/^ficha detectada em branco|^este pdf e uma imagem/i.test(normalizeMatch(line))) {
        continue;
      }

      const diceMatch = /(\d{1,2}d\d{1,3}(?:kh1|kl1|!|>=?\d+|<=?\d+)?(?:\s*[+-]\s*\d{1,3})?)/i.exec(
        line
      );
      const colonParts = /^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s()'/-]{2,38})\s*[:\-–]\s*(.+)$/.exec(line);

      if (diceMatch || colonParts || COMBAT_PRIORITY_RE.test(line)) {
        const rawTitle = colonParts
          ? colonParts[1].trim()
          : line.replace(/\(.*?\)/g, '').split(/[.,:]/)[0].trim().slice(0, 36);
        if (!rawTitle || rawTitle.length < 2) continue;

        const detectedFormula = diceMatch ? diceMatch[1].replace(/\s+/g, '') : defaultHitFormula;
        const isD20OrD100 = /d(20|100)\b/i.test(detectedFormula);
        const isSpell = SPELL_RE.test(rawTitle) || SPELL_RE.test(src.title);
        const isDefense = DEFENSE_RE.test(rawTitle);

        pushUnique({
          id: `act_txt_${actions.length}_${Date.now().toString(36)}`,
          label: rawTitle,
          category: isDefense ? 'defense' : isSpell ? 'spell' : 'attack',
          formula: isD20OrD100 ? detectedFormula : defaultHitFormula,
          damageFormula: !isD20OrD100 && diceMatch ? detectedFormula : isDefense ? undefined : '1d8+2',
          damageLabel: isSpell ? 'Efeito' : 'Dano',
          description: line.slice(0, 110),
          sourceLabel: src.origin,
        });
      }
    }
  }

  // 4. Universal Tactical Fallbacks so every combatant has a full turn-based kit
  pushUnique({
    id: 'act_basic_strike',
    label: 'Ataque',
    category: 'attack',
    formula: defaultHitFormula,
    damageFormula: '1d8',
    damageLabel: 'Dano',
    description: 'Rolagem de ataque padrão.',
    sourceLabel: 'Padrão',
  });

  pushUnique({
    id: 'act_defensive_stance',
    label: 'Defesa / Esquiva',
    category: 'defense',
    formula: defaultHitFormula,
    description: 'Rolagem de defesa ou esquiva.',
    sourceLabel: 'Defesa',
  });

  return actions.slice(0, 16);
}

export function buildCombatantFromTokenAndSheets(
  token: SceneToken,
  sheets: CharacterSheet[],
  role: 'player' | 'npc'
): DuelCombatantState {
  const sheet = findSheetForToken(token, sheets);
  const bars = (sheet?.blocks || []).filter((b) => b.type === 'bar');

  const hpBar =
    bars.find((b) => /\b(vida|pv|hp|hit|vitalidade|sangue)\b/i.test(b.label)) || bars[0];
  const mpBar = bars.find(
    (b) => b.id !== hpBar?.id && /\b(sanidade|san|mana|pm|esfor[çc]o|pe|energia|vontade)\b/i.test(b.label)
  );

  const hpMax = Math.max(1, Number(hpBar?.max) || (role === 'npc' ? 35 : 24));
  const hpCurrent =
    hpBar?.current !== undefined ? Math.max(0, Math.min(hpMax, Number(hpBar.current))) : hpMax;

  const actions = extractActionsFromSheetAndToken(token, sheet);

  return {
    tokenId: token.id,
    sheetId: sheet?.id || token.sheetId,
    name: token.name || sheet?.name || (role === 'player' ? 'Jogador' : 'Oponente'),
    subtitle:
      sheet?.subtitle ||
      (sheet?.templateId ? `${sheet.templateId}${sheet.mode === 'pdf' ? ' · PDF' : ''}` : token.notes?.slice(0, 60) || (role === 'player' ? 'Combatente' : 'Ameaça')),
    role,
    imageUrl: token.imageUrl || sheet?.avatarUrl || '',
    mediaId: token.mediaId || sheet?.avatarMediaId || '',
    combatSpriteUrl: token.combatSpriteUrl || '',
    combatSpriteMediaId: token.combatSpriteMediaId || '',
    color: token.outlineColor || token.color || (role === 'player' ? '#2f5d46' : '#8f2d2d'),
    hpCurrent,
    hpMax,
    mpCurrent: mpBar ? Number(mpBar.current ?? mpBar.max ?? 10) : undefined,
    mpMax: mpBar ? Math.max(1, Number(mpBar.max ?? 10)) : undefined,
    mpLabel: mpBar?.label,
    actions,
    isDefending: false,
  };
}

// -----------------------------------------------------------------------------
// Zero-Dependency Procedural Web Audio Combat SFX (Fruit Ninja Blade, Blunt Hit, Shot, Arcane)
// -----------------------------------------------------------------------------
let sfxCtx: AudioContext | null = null;

function getSfxContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sfxCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) sfxCtx = new Ctx();
  }
  if (sfxCtx && sfxCtx.state === 'suspended') {
    void sfxCtx.resume().catch(() => {});
  }
  return sfxCtx;
}

export const DEFAULT_DUEL_SFX_URLS: Partial<
  Record<'blade' | 'blunt' | 'shot' | 'arcane' | 'heal' | 'shield', string>
> = {
  blade: '/assets/aistudio/fruit_ninja_slicing_fruit_sound_effect_4__mp3cut.net__d36c150f.mp3',
  arcane: '/assets/aistudio/magic_spell_hit_-_sound_effect__mp3cut.net__d31a681a.mp3',
  shot: '/assets/aistudio/Desert_Eagle_Single_Shot_Gunshot_Sound_Effect_4__mp3cut.net__fef90a08.mp3',
  blunt: '/assets/aistudio/More_Punch_Sound_Effects__mp3cut.net__f1610e00.mp3',
};

const defaultSfxAudioCache = new Map<string, HTMLAudioElement>();

function getSfxEffectiveVolume(): number {
  const vols = audioEngine.getVolumes();
  if (vols.muted) return 0;
  return Math.max(0, Math.min(1, vols.master * vols.sfx));
}

function playOneShotAudioUrl(
  url: string,
  fallbackKind: 'blade' | 'blunt' | 'shot' | 'arcane' | 'heal' | 'shield'
) {
  const volume = getSfxEffectiveVolume();
  if (volume <= 0.001) return;

  try {
    let base = defaultSfxAudioCache.get(url);
    if (!base) {
      base = new Audio(url);
      base.preload = 'auto';
      if (!url.startsWith('/')) {
        base.crossOrigin = 'anonymous';
      }
      defaultSfxAudioCache.set(url, base);
    }
    const instance = base.cloneNode(true) as HTMLAudioElement;
    instance.volume = volume;
    instance.currentTime = 0;
    void instance.play().catch(() => {
      playProceduralCombatSfx(fallbackKind);
    });
  } catch {
    playProceduralCombatSfx(fallbackKind);
  }
}

export function playCombatCursorSfx(
  kind: 'blade' | 'blunt' | 'shot' | 'arcane' | 'heal' | 'shield',
  customSfx?: { url?: string; mediaId?: string; campaignId?: string }
) {
  const volume = getSfxEffectiveVolume();
  if (volume <= 0.001) return;

  if (customSfx && (customSfx.url || customSfx.mediaId)) {
    void resolveMediaUrl(customSfx.mediaId, customSfx.url || '', customSfx.campaignId)
      .then((resolved) => {
        if (!resolved) {
          const defaultUrl = DEFAULT_DUEL_SFX_URLS[kind];
          if (defaultUrl) {
            playOneShotAudioUrl(defaultUrl, kind);
          } else {
            playProceduralCombatSfx(kind);
          }
          return;
        }
        const audio = new Audio();
        if (!resolved.startsWith('/')) {
          audio.crossOrigin = 'anonymous';
        }
        audio.src = resolved;
        audio.volume = volume;
        void audio.play().catch(() => {
          const defaultUrl = DEFAULT_DUEL_SFX_URLS[kind];
          if (defaultUrl) {
            playOneShotAudioUrl(defaultUrl, kind);
          } else {
            playProceduralCombatSfx(kind);
          }
        });
      })
      .catch(() => {
        const defaultUrl = DEFAULT_DUEL_SFX_URLS[kind];
        if (defaultUrl) {
          playOneShotAudioUrl(defaultUrl, kind);
        } else {
          playProceduralCombatSfx(kind);
        }
      });
    return;
  }

  const defaultUrl = DEFAULT_DUEL_SFX_URLS[kind];
  if (defaultUrl) {
    playOneShotAudioUrl(defaultUrl, kind);
    return;
  }

  playProceduralCombatSfx(kind);
}

function playProceduralCombatSfx(
  kind: 'blade' | 'blunt' | 'shot' | 'arcane' | 'heal' | 'shield'
) {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  try {
    if (kind === 'blade') {
      // Metallic katana swoosh + razor ring
      const bufferSize = Math.floor(ctx.sampleRate * 0.22);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const out = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        out[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(3.2, now);
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(3800, now + 0.14);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);

      // Subtle steel harmonic ping
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2450, now);
      osc.frequency.exponentialRampToValueAtTime(1120, now + 0.18);
      oscGain.gain.setValueAtTime(0.14, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      return;
    }

    if (kind === 'blunt') {
      // Heavy low-end punch impact ("Porrada")
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(155, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.24);
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.27);

      // Impact crunch transient
      const bufLen = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2.5);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(640, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.35, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.connect(lp);
      lp.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(now);
      return;
    }

    if (kind === 'shot') {
      // Sharp crack + ricochet
      const bufLen = Math.floor(ctx.sampleRate * 0.18);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 3.2);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.45, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      noise.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(now);
      return;
    }

    if (kind === 'arcane' || kind === 'heal' || kind === 'shield') {
      // Shimmering chord pulse
      const freqs = kind === 'heal' ? [523.25, 659.25, 783.99] : [220, 329.63, 493.88];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = kind === 'arcane' ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.03);
        osc.frequency.exponentialRampToValueAtTime(
          kind === 'arcane' ? f * 0.72 : f * 1.15,
          now + 0.35
        );
        g.gain.setValueAtTime(0.11, now + idx * 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now + idx * 0.03);
        osc.stop(now + 0.4);
      });
    }
  } catch {
    // Ignore audio context restrictions
  }
}
