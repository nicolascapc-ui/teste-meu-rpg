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
  x1: number; // normalized 0..1 inside the map image coordinate box
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
export type TokenVitalStatus = 'alive' | 'unconscious' | 'dying' | 'dead';
export type TokenCategory = 'player' | 'npc' | 'item';

export type CanvasLayerKind = 'token' | 'image' | 'text' | 'brush';
export type BrushStyleId = 'pen' | 'marker' | 'chalk' | 'glow' | 'spray' | 'arrow';

export interface TokenStatusEffect {
  id: string;
  label: string;
  kind: 'buff' | 'debuff';
  color: string;
}

export interface BrushPoint {
  x: number; // normalized 0..1 inside map coordinate box
  y: number;
}

export interface SceneToken {
  id: string;
  name: string;
  x: number; // normalized 0..1 inside map coordinate box
  y: number; // normalized 0..1 inside map coordinate box
  sizePx: number; // base size in 1200px reference canvas units
  widthPx?: number; // freeform width in 1200px reference canvas units
  heightPx?: number; // freeform height in 1200px reference canvas units
  layerKind?: CanvasLayerKind; // 'token' (default) | 'image' | 'text' | 'brush'
  tokenCategory?: TokenCategory; // 'player' | 'npc' | 'item'
  shape?: 'circle' | 'rect';
  locked?: boolean;
  opacity?: number; // 0.1 .. 1
  color: string;
  imageUrl?: string;
  mediaId?: string;
  combatSpriteUrl?: string;
  combatSpriteMediaId?: string;
  notes?: string;
  hiddenFromPlayers?: boolean;
  sheetId?: string;
  outlineStyle?: TokenOutlineStyle;
  outlineColor?: string;
  texture?: TokenTexture;
  shadow?: TokenShadow;
  behavior?: TokenBehavior;
  vitalStatus?: TokenVitalStatus;
  hitAtMs?: number;
  statuses?: TokenStatusEffect[];
  visionEnabled?: boolean;
  visionRadius?: number; // normalized 0.10 .. 0.85
  // Text layer fields
  text?: string;
  fontSize?: number; // in 1200px reference units
  textBg?: boolean;
  // Brush stroke layer fields
  brushStyle?: BrushStyleId;
  brushSize?: number;
  points?: BrushPoint[];
}

export type SceneCategory = 'tactical' | 'landscape' | 'location';

export interface Scene {
  id: string;
  campaignId: string;
  gmUid: string;
  name: string;
  folder?: string;
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

export type SheetBlockType = 'bar' | 'attribute' | 'item' | 'counter' | 'text';

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
  // Universal Custom Item / Action fields
  linkedAttribute?: string; // Name of attribute to pull automatically
  secondaryAttribute?: string; // Optional second attribute to sum/combine
  diceType?: string; // e.g. '1d20', '2d6', '1d100', 'pool_d20', 'pool_d10', 'pool_d6', '1d12', '1d10', '1d8', '1d6', '1d4'
  bonus?: number; // Numeric flat bonus
  damageFormula?: string; // Optional secondary roll (e.g. '1d8 + {Força}')
  damageLabel?: string; // e.g. 'Dano' or 'Efeito'
}

export interface CharacterSheet {
  id: string;
  campaignId: string;
  gmUid: string;
  ownerUid: string;
  ownerName: string;
  name: string;
  subtitle: string;
  templateId: string; // Stores the custom RPG system name
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
  sceneFolders?: string[];
  createdAt?: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export type DuelArenaPresetId =
  | 'expedition_ruins'
  | 'persona_crimson'
  | 'pokemon_stadium'
  | 'astral_sanctuary'
  | 'noir_rain'
  | 'shadow_forest'
  | string;

export type DuelParticleKind = 'none' | 'dust' | 'sparks' | 'rain' | 'lights' | 'leaves';

export interface CustomDuelArenaPreset {
  id: string;
  name: string;
  bgColor: string;
  floorColor: string;
  accentColor: string;
  particleKind: DuelParticleKind;
}

export type DuelCameraAngle =
  | 'dynamic'
  | 'stadium'
  | 'showdown'
  | 'focus_player'
  | 'focus_npc';

export type DuelCursorAttackMode = 'none' | 'blade' | 'blunt' | 'shot' | 'arcane';

export type DuelLayoutStyle = 'minimal' | 'medieval' | 'stylized';

export type DuelStatusTagTone = 'danger' | 'warning' | 'info' | 'buff';

export interface DuelStatusTag {
  id: string;
  label: string;
  tone: DuelStatusTagTone;
}

export interface DuelExtraSettings {
  layoutStyle: DuelLayoutStyle;
  comboEnabled: boolean;
  mouseAttackDamageEnabled: boolean;
  mouseAttackDamage: number;
  showSecondaryResource: boolean;
  secondaryResourceLabel: string;
  showStatusTags: boolean;
}

export interface DuelCustomSfxEntry {
  url: string;
  mediaId?: string;
  fileName?: string;
}

export type DuelAttackSfxMap = Partial<
  Record<'blade' | 'blunt' | 'shot' | 'arcane', DuelCustomSfxEntry>
>;

export interface DuelActionItem {
  id: string;
  label: string;
  category: 'attack' | 'skill' | 'spell' | 'defense';
  formula: string;
  damageFormula?: string;
  damageLabel?: string;
  description?: string;
  sourceLabel?: string;
  sfxUrl?: string;
  sfxMediaId?: string;
  sfxFileName?: string;
}

export interface DuelCombatantState {
  tokenId: string;
  sheetId?: string;
  name: string;
  subtitle?: string;
  role: 'player' | 'npc';
  imageUrl: string;
  mediaId?: string;
  combatSpriteUrl?: string;
  combatSpriteMediaId?: string;
  color: string;
  hpCurrent: number;
  hpMax: number;
  mpCurrent?: number;
  mpMax?: number;
  mpLabel?: string;
  statusTags?: DuelStatusTag[];
  actions: DuelActionItem[];
  lastHitAtMs?: number;
  lastLungeAtMs?: number;
  isDefending?: boolean;
}

export interface DuelLiveEffect {
  id: string;
  timestampMs: number;
  targetSide: 'player' | 'npc';
  kind: 'blade' | 'blunt' | 'shot' | 'arcane' | 'heal' | 'shield';
  damageAmount?: number;
  damageApplied?: number;
  comboCount?: number;
  comboTargetSide?: 'player' | 'npc';
  label?: string;
  isCrit?: boolean;
  slashPoints?: Array<{ x: number; y: number }>;
  sfxUrl?: string;
  sfxMediaId?: string;
}

export interface ActiveDuelState {
  id: string;
  sceneId: string;
  activeTurn: 'player' | 'npc';
  round: number;
  arenaPreset: DuelArenaPresetId;
  customArenaStyle?: CustomDuelArenaPreset | null;
  cameraAngle: DuelCameraAngle;
  bgUrl: string;
  bgMediaId?: string;
  bgMediaKind?: SceneMediaKind;
  musicTrackId?: string;
  hidePlayerActionsOnScreen: boolean;
  showCombatantNamesOnScreen?: boolean;
  showCombatInfoOnScreen?: boolean;
  attackSfxMap?: DuelAttackSfxMap;
  extraSettings?: DuelExtraSettings;
  player: DuelCombatantState;
  npc: DuelCombatantState;
  lastActionSummary?: string;
  lastEffect?: DuelLiveEffect | null;
  startedAtMs: number;
}

export interface SceneDuelConfig {
  bgUrl: string;
  bgMediaId: string;
  bgMediaKind?: SceneMediaKind;
  arenaPreset: DuelArenaPresetId;
  customArenaStyle?: CustomDuelArenaPreset | null;
  musicTrackId: string;
  attackSfxMap?: DuelAttackSfxMap;
}

export type PlayerViewSectionMode = 'scene' | 'clues' | 'dice' | 'standby';

export type InterludeIconId =
  | 'sparkles'
  | 'hourglass'
  | 'compass'
  | 'book'
  | 'moon'
  | 'swords'
  | 'none';

export interface InterludeConfig {
  title: string;
  subtitle: string;
  icon: InterludeIconId;
  imageUrl: string;
  mediaId: string;
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
  activeDuel?: ActiveDuelState | null;
  duelConfig?: SceneDuelConfig;
  playerViewMode?: PlayerViewSectionMode;
}

export interface LiveAudioLayerSnapshot {
  trackId: string;
  name: string;
  sourceType: 'url' | 'media' | 'youtube';
  url: string;
  mediaId: string;
  paused: boolean;
  dsp: AudioDspSettings;
  startedAtMs: number;
}

export interface LiveAudioSfxPulse {
  id: string;
  trackId: string;
  name: string;
  sourceType: 'url' | 'media' | 'youtube';
  url: string;
  mediaId: string;
  dsp: AudioDspSettings;
  triggeredAtMs: number;
}

export interface LiveAudioState {
  music: LiveAudioLayerSnapshot | null;
  ambience: LiveAudioLayerSnapshot | null;
  sfxPulse?: LiveAudioSfxPulse | null;
  volumes: {
    master: number;
    music: number;
    ambience: number;
    sfx: number;
    muted: boolean;
  };
  updatedAtMs: number;
}

export interface LiveTableState {
  campaignId: string;
  gmUid: string;
  campaignTitle: string;
  theme: CampaignTheme;
  activeScene: LiveSceneSnapshot | null;
  activeHandout: ActiveHandoutProjection | null;
  interludeConfig?: InterludeConfig | null;
  liveAudio?: LiveAudioState | null;
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

export type ChatAttachmentKind = 'image' | 'file' | 'item' | 'npc' | 'character' | 'scene';

export interface ChatAttachment {
  kind: ChatAttachmentKind;
  title: string;
  subtitle?: string;
  url?: string;
  mediaId?: string;
  fileName?: string;
  mimeType?: string;
  entityId?: string;
  itemBlock?: SheetBlock;
  statsSummary?: string;
}

export interface ChatReplyRef {
  id: string;
  senderName: string;
  textPreview: string;
}

export interface ChatMessage {
  id: string;
  campaignId: string;
  gmUid: string;
  channelId: string; // 'general' or 'dm_<uidA>_<uidB>'
  senderUid: string;
  senderName: string;
  senderRole: 'gm' | 'player';
  recipientUid?: string;
  recipientName?: string;
  text: string;
  replyTo?: ChatReplyRef | null;
  attachment?: ChatAttachment | null;
  timestampMs: number;
  createdAt?: Timestamp | number;
}

export interface ChatRosterEntry {
  uid: string;
  displayName: string;
  role: 'gm' | 'player';
}

export interface LiveCampaignChat {
  campaignId: string;
  gmUid: string;
  messages: ChatMessage[];
  roster: ChatRosterEntry[];
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
