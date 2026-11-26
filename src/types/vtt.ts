import type { Timestamp } from 'firebase/firestore';

export type CampaignFontId =
  | 'typewriter'
  | 'editorial'
  | 'modern'
  | 'terminal'
  | 'noir_press';

export type ColorFilterPreset =
  | 'none'
  | 'sepia'
  | 'noir'
  | 'cold'
  | 'warm'
  | 'high_contrast';

export interface SceneEffects {
  preset: string;
  crt: number; // 0..100
  noise: number; // 0..100
  glitch: number; // 0..100
  bloodDanger: number; // 0..100
  shake: number; // 0..100
  vignette: number; // 0..100
  colorFilter: ColorFilterPreset;
  saturation: number; // 0..200 (100 default)
  contrast: number; // 50..180 (100 default)
}

export interface CampaignTheme {
  preset: string;
  isDark: boolean;
  bgCanvas: string;
  bgSurface: string;
  bgSubtle: string;
  textPrimary: string;
  textMuted: string;
  borderColor: string;
  accentColor: string;
  fontFamily?: CampaignFontId;
  effects?: SceneEffects;
}

export interface GridConfig {
  enabled: boolean;
  cellSizePx: number;
  unitLabel: string;
  unitValue: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
}

export interface FogStroke {
  id: string;
  mode: 'reveal' | 'hide';
  shape: 'circle' | 'rect';
  x: number;
  y: number;
  r?: number;
  w?: number;
  h?: number;
}

export type SceneMediaKind = 'image' | 'video' | 'gif';

export interface SceneWall {
  id: string;
  x1: number; // normalized 0..1
  y1: number;
  x2: number;
  y2: number;
  kind: 'wall' | 'door';
  isOpen?: boolean;
}

export type TokenOutlineStyle = 'solid' | 'dashed' | 'double' | 'glow' | 'none';
export type TokenTexture = 'none' | 'grain' | 'holo' | 'metallic' | 'aged';
export type TokenShadow = 'none' | 'soft' | 'dramatic' | 'colored';
export type TokenBehavior = 'none' | 'float' | 'pulse' | 'spin_ring' | 'tremble';

export interface TokenStatusEffect {
  id: string;
  label: string;
  kind: 'buff' | 'debuff';
  color: string;
}

export interface SceneToken {
  id: string;
  name: string;
  x: number;
  y: number;
  sizePx: number;
  color: string;
  imageUrl?: string;
  mediaId?: string;
  notes?: string;
  hiddenFromPlayers?: boolean;
  sheetId?: string;
  outlineStyle?: TokenOutlineStyle;
  outlineColor?: string;
  texture?: TokenTexture;
  shadow?: TokenShadow;
  behavior?: TokenBehavior;
  hitAtMs?: number;
  statuses?: TokenStatusEffect[];
  visionEnabled?: boolean;
  visionRadius?: number; // normalized 0.10 .. 0.85
}

export type SceneCategory = 'tactical' | 'landscape' | 'location';

export interface Scene {
  id: string;
  campaignId: string;
  gmUid: string;
  name: string;
  category: SceneCategory;
  imageUrl: string;
  mediaId: string;
  mediaKind?: SceneMediaKind;
  order: number;
  grid: GridConfig;
  fogEnabled: boolean;
  fogStrokes: FogStroke[];
  walls?: SceneWall[];
  dynamicVision?: boolean;
  tokens: SceneToken[];
  linkedMusicId: string;
  linkedAmbienceId: string;
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export type HandoutKind = 'clue' | 'npc' | 'letter' | 'map';

export interface Handout {
  id: string;
  campaignId: string;
  gmUid: string;
  title: string;
  kind: HandoutKind;
  imageUrl: string;
  mediaId: string;
  body: string;
  targetUid: string; // 'none' | 'all' | specific player uid
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export interface ActiveHandoutProjection {
  id: string;
  title: string;
  kind: HandoutKind;
  imageUrl: string;
  mediaId: string;
  body: string;
}

export type SheetBlockType = 'bar' | 'attribute' | 'counter' | 'text';

export interface SheetBlock {
  id: string;
  type: SheetBlockType;
  section?: string;
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

export interface CharacterSheet {
  id: string;
  campaignId: string;
  gmUid: string;
  ownerUid: string;
  ownerName: string;
  name: string;
  subtitle: string;
  templateId: string; // Stores the custom RPG system name (e.g. 'Sistema Livre' or detected from PDF)
  mode: 'modular' | 'pdf';
  avatarUrl?: string;
  avatarMediaId?: string;
  pdfUrl: string;
  pdfMediaId: string;
  pdfFileName: string;
  blocks: SheetBlock[];
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export interface CampaignNote {
  id: string;
  campaignId: string;
  gmUid: string;
  folder: string;
  title: string;
  content: string;
  visibility: 'public' | 'gm_only';
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export interface PublicNoteSummary {
  id: string;
  folder: string;
  title: string;
  content: string;
}

export type RollOutcome = 'normal' | 'crit' | 'fumble' | 'success' | 'failure' | 'chat';

export interface DiceRoll {
  id: string;
  campaignId: string;
  gmUid: string;
  rollerUid: string;
  rollerName: string;
  label: string;
  formula: string;
  resolvedFormula: string;
  total: number;
  summary: string;
  breakdown: string;
  outcome: RollOutcome;
  visibility: 'public' | 'gm_only';
  createdAt?: Timestamp | number;
}

export interface PublicRollSummary {
  id: string;
  rollerName: string;
  label: string;
  formula: string;
  total: number;
  summary: string;
  breakdown: string;
  outcome: RollOutcome;
  timestampMs: number;
}

export type AudioLayer = 'music' | 'ambience' | 'sfx';

export interface AudioDspSettings {
  startSec: number; // 0 .. 36000
  speed: number; // 0.5 .. 2.0
  pitch: number; // -12 .. +12 semitones
  muffle: number; // 0 .. 100 (low-pass muffler %)
}

export const DEFAULT_AUDIO_DSP: AudioDspSettings = {
  startSec: 0,
  speed: 1,
  pitch: 0,
  muffle: 0,
};

export interface AudioTrack {
  id: string;
  campaignId: string;
  gmUid: string;
  name: string;
  layer: AudioLayer;
  sourceType: 'url' | 'media' | 'youtube';
  synthPreset: string;
  url: string;
  mediaId: string;
  dsp?: AudioDspSettings;
  createdAt?: Timestamp | number;
}

export interface CampaignMember {
  id: string;
  uid: string;
  gmUid: string;
  campaignId: string;
  displayName: string;
  role: 'gm' | 'player';
  joinedAt?: Timestamp | number;
}

export interface UserMembership {
  id: string;
  uid: string;
  campaignId: string;
  campaignTitle: string;
  roomCode: string;
  role: 'gm' | 'player';
  joinedAt?: Timestamp | number;
}

export interface Campaign {
  id: string;
  title: string;
  system: string;
  description: string;
  gmUid: string;
  gmName: string;
  roomCode: string;
  activeSceneId: string;
  theme: CampaignTheme;
  folders?: string[];
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export interface LiveSceneSnapshot {
  id: string;
  name: string;
  category: SceneCategory;
  imageUrl: string;
  mediaId: string;
  mediaKind?: SceneMediaKind;
  grid: GridConfig;
  fogEnabled: boolean;
  fogStrokes: FogStroke[];
  walls?: SceneWall[];
  dynamicVision?: boolean;
  tokens: SceneToken[];
}

export interface LiveTableState {
  campaignId: string;
  gmUid: string;
  campaignTitle: string;
  theme: CampaignTheme;
  activeScene: LiveSceneSnapshot | null;
  activeHandout: ActiveHandoutProjection | null;
  recentPublicRolls: PublicRollSummary[];
  shakePulseMs?: number;
  updatedAt?: Timestamp | number;
}

export interface LivePublicWiki {
  campaignId: string;
  gmUid: string;
  notes: PublicNoteSummary[];
  updatedAt?: Timestamp | number;
}

export const FIELD_LIMITS = {
  CAMPAIGN_TITLE: 120,
  CAMPAIGN_SYSTEM: 80,
  CAMPAIGN_DESC: 500,
  DISPLAY_NAME: 80,
  SCENE_NAME: 100,
  URL_MAX: 1024,
  MEDIA_ID: 128,
  HANDOUT_TITLE: 120,
  HANDOUT_BODY: 4000,
  SHEET_NAME: 100,
  SHEET_SUBTITLE: 120,
  NOTE_FOLDER: 60,
  NOTE_TITLE: 140,
  NOTE_CONTENT: 15000,
  ROLL_LABEL: 120,
  ROLL_FORMULA: 120,
  ROLL_SUMMARY: 240,
  ROLL_BREAKDOWN: 400,
  TRACK_NAME: 100,
  MAX_FOG_STROKES: 400,
  MAX_WALLS: 300,
  MAX_TOKENS: 120,
  MAX_BLOCKS: 100,
  MAX_PUBLIC_ROLLS: 40,
  MAX_PUBLIC_NOTES: 80,
} as const;
