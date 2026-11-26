import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { DEFAULT_THEME, sanitizeTheme } from './themes';
import { createBlankSheetBlocks, DEFAULT_WIKI_FOLDERS, STARTER_ASSETS } from './templates';
import {
  FIELD_LIMITS,
  type ActiveDuelState,
  type ActiveHandoutProjection,
  type AudioDspSettings,
  type AudioLayer,
  type AudioTrack,
  type Campaign,
  type CampaignMember,
  type CampaignNote,
  type CampaignTheme,
  type CharacterSheet,
  type DiceRoll,
  type FogStroke,
  type GridConfig,
  type Handout,
  type HandoutKind,
  type LivePublicWiki,
  type LiveSceneSnapshot,
  type LiveTableState,
  type PublicNoteSummary,
  type PublicRollSummary,
  type RollOutcome,
  type Scene,
  type SceneCategory,
  type SceneDuelConfig,
  type SceneMediaKind,
  type SceneToken,
  type SceneWall,
  type SheetBlock,
  type UserMembership,
} from '../types/vtt';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function clampStr(val: string | undefined, max: number): string {
  return (val || '').trim().slice(0, max);
}

/**
 * Recursively strips `undefined` properties from plain objects and arrays
 * so Firestore Web SDK never throws `Unsupported field value: undefined`.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Leave Firestore FieldValue / Timestamp / Date instances untouched
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeGridConfig(grid: GridConfig): GridConfig {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    enabled: Boolean(grid?.enabled),
    cellSizePx: Math.round(num(grid?.cellSizePx, 58, 16, 240)),
    unitLabel: clampStr(grid?.unitLabel, 16) || 'm',
    unitValue: num(grid?.unitValue, 1.5, 0.1, 1000),
    opacity: num(grid?.opacity, 0.4, 0, 1),
    offsetX: Math.round(num(grid?.offsetX, 0, -500, 500)),
    offsetY: Math.round(num(grid?.offsetY, 0, -500, 500)),
  };
}

// Local BroadcastChannel for zero-latency (<16ms) sync between GM window and Second Screen TV on the same machine
export function openTableChannel(campaignId: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(`folio_vtt_table_${campaignId}`);
}

export function broadcastLiveState(campaignId: string, state: LiveTableState) {
  const ch = openTableChannel(campaignId);
  if (!ch) return;
  try {
    ch.postMessage({ type: 'LIVE_STATE', payload: state });
  } finally {
    ch.close();
  }
}

export function sanitizePublicDuelState(
  duel: ActiveDuelState | null | undefined
): ActiveDuelState | null {
  if (!duel) return null;
  return stripUndefinedDeep({
    ...duel,
    // Keep NPC actions strictly hidden from public/player snapshots
    npc: {
      ...duel.npc,
      actions: [],
    },
  });
}

export function toLiveSceneSnapshot(
  scene: Scene,
  activeDuel?: ActiveDuelState | null,
  duelConfig?: SceneDuelConfig,
  playerViewMode?: 'scene' | 'clues' | 'dice' | 'standby'
): LiveSceneSnapshot {
  return stripUndefinedDeep({
    id: scene.id,
    name: scene.name,
    category: scene.category,
    imageUrl: scene.imageUrl || '',
    mediaId: scene.mediaId || '',
    mediaKind: scene.mediaKind || 'image',
    grid: sanitizeGridConfig(scene.grid),
    fogEnabled: Boolean(scene.fogEnabled),
    fogStrokes: scene.fogStrokes || [],
    walls: scene.walls || [],
    dynamicVision: Boolean(scene.dynamicVision),
    tokens: (scene.tokens || []).filter((t) => !t.hiddenFromPlayers),
    activeDuel: sanitizePublicDuelState(activeDuel),
    duelConfig,
    playerViewMode: playerViewMode || 'scene',
  });
}

export async function syncLiveDuelState(
  campaignId: string,
  scene: Scene,
  activeDuel: ActiveDuelState | null,
  currentLiveState: LiveTableState | null,
  duelConfig?: SceneDuelConfig
) {
  const snapshot = toLiveSceneSnapshot(
    scene,
    activeDuel,
    duelConfig || currentLiveState?.activeScene?.duelConfig,
    currentLiveState?.activeScene?.playerViewMode || 'scene'
  );
  if (currentLiveState) {
    broadcastLiveState(campaignId, {
      ...currentLiveState,
      activeScene: snapshot,
    });
  }
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
      activeScene: snapshot,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/state`);
  }
}

export async function syncPlayerViewMode(
  campaignId: string,
  playerViewMode: 'scene' | 'clues' | 'dice' | 'standby',
  currentLiveState: LiveTableState | null
) {
  if (!currentLiveState || !currentLiveState.activeScene) return;
  const updatedSnapshot: LiveSceneSnapshot = stripUndefinedDeep({
    ...currentLiveState.activeScene,
    playerViewMode,
  });
  broadcastLiveState(campaignId, {
    ...currentLiveState,
    activeScene: updatedSnapshot,
  });
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
      activeScene: updatedSnapshot,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/state`);
  }
}

// -----------------------------------------------------------------------------
// Subscriptions
// -----------------------------------------------------------------------------
export function subscribeOwnedCampaigns(
  uid: string,
  onData: (campaigns: Campaign[]) => void
): Unsubscribe {
  const path = 'campaigns';
  const q = query(collection(db, path), where('gmUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, 'id'>) }))
        .sort((a, b) => {
          const ta = typeof a.updatedAt === 'number' ? a.updatedAt : a.updatedAt?.toMillis?.() || 0;
          const tb = typeof b.updatedAt === 'number' ? b.updatedAt : b.updatedAt?.toMillis?.() || 0;
          return tb - ta;
        });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeUserMemberships(
  uid: string,
  onData: (memberships: UserMembership[]) => void
): Unsubscribe {
  const path = `users/${uid}/memberships`;
  const q = query(collection(db, 'users', uid, 'memberships'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserMembership, 'id'>),
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeCampaignDoc(
  campaignId: string,
  onData: (campaign: Campaign | null) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}`;
  return onSnapshot(
    doc(db, 'campaigns', campaignId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({ id: snap.id, ...(snap.data() as Omit<Campaign, 'id'>) });
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeLiveState(
  campaignId: string,
  onData: (state: LiveTableState | null) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/live/state`;
  return onSnapshot(
    doc(db, 'campaigns', campaignId, 'live', 'state'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as LiveTableState);
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeLiveWiki(
  campaignId: string,
  onData: (wiki: LivePublicWiki | null) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/live/wiki`;
  return onSnapshot(
    doc(db, 'campaigns', campaignId, 'live', 'wiki'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as LivePublicWiki);
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeGMScenes(
  campaignId: string,
  gmUid: string,
  onData: (scenes: Scene[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/scenes`;
  const q = query(collection(db, 'campaigns', campaignId, 'scenes'), where('gmUid', '==', gmUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Scene, 'id'>) }))
        .sort((a, b) => a.order - b.order);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGMHandouts(
  campaignId: string,
  gmUid: string,
  onData: (handouts: Handout[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/handouts`;
  const q = query(collection(db, 'campaigns', campaignId, 'handouts'), where('gmUid', '==', gmUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Handout, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribePlayerPrivateHandouts(
  campaignId: string,
  playerUid: string,
  onData: (handouts: Handout[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/handouts`;
  const q = query(collection(db, 'campaigns', campaignId, 'handouts'), where('targetUid', '==', playerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Handout, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeSheets(
  campaignId: string,
  filterField: 'gmUid' | 'ownerUid',
  uid: string,
  onData: (sheets: CharacterSheet[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/sheets`;
  const q = query(collection(db, 'campaigns', campaignId, 'sheets'), where(filterField, '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CharacterSheet, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGMNotes(
  campaignId: string,
  gmUid: string,
  onData: (notes: CampaignNote[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/notes`;
  const q = query(collection(db, 'campaigns', campaignId, 'notes'), where('gmUid', '==', gmUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampaignNote, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeRolls(
  campaignId: string,
  filterField: 'gmUid' | 'rollerUid',
  uid: string,
  onData: (rolls: DiceRoll[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/rolls`;
  const q = query(collection(db, 'campaigns', campaignId, 'rolls'), where(filterField, '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<DiceRoll, 'id'>) }))
        .sort((a, b) => {
          const ta = typeof a.createdAt === 'number' ? a.createdAt : a.createdAt?.toMillis?.() || 0;
          const tb = typeof b.createdAt === 'number' ? b.createdAt : b.createdAt?.toMillis?.() || 0;
          return tb - ta;
        });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGMAudioTracks(
  campaignId: string,
  gmUid: string,
  onData: (tracks: AudioTrack[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/audioTracks`;
  const q = query(collection(db, 'campaigns', campaignId, 'audioTracks'), where('gmUid', '==', gmUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AudioTrack, 'id'>) }))
        // Hide any legacy synth tracks from older campaigns
        .filter((t) => (t.sourceType as string) !== 'synth');
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeCampaignMembers(
  campaignId: string,
  gmUid: string,
  onData: (members: CampaignMember[]) => void
): Unsubscribe {
  const path = `campaigns/${campaignId}/members`;
  const q = query(collection(db, 'campaigns', campaignId, 'members'), where('gmUid', '==', gmUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampaignMember, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

// -----------------------------------------------------------------------------
// Campaign Creation & Seeding
// -----------------------------------------------------------------------------
export async function createCampaignWithStarterKit(params: {
  gmUid: string;
  gmName: string;
  title: string;
  system: string;
  description: string;
  theme?: CampaignTheme;
  withStarterContent?: boolean;
}): Promise<string> {
  const campaignId = makeId('camp');
  const roomCode = generateRoomCode();
  const theme = sanitizeTheme(params.theme || DEFAULT_THEME);
  const title = clampStr(params.title, FIELD_LIMITS.CAMPAIGN_TITLE) || 'Nova Campanha';
  const system = clampStr(params.system, FIELD_LIMITS.CAMPAIGN_SYSTEM) || 'Sistema Livre';
  const description = clampStr(params.description, FIELD_LIMITS.CAMPAIGN_DESC);
  const gmName = clampStr(params.gmName, FIELD_LIMITS.DISPLAY_NAME) || 'Mestre';

  const firstSceneId = makeId('scn');
  const secondSceneId = makeId('scn');
  const thirdSceneId = makeId('scn');

  // 1. Create parent campaign document first so subcollection rules' exists()/get() Master Gates pass
  const campaignPath = `campaigns/${campaignId}`;
  try {
    await setDoc(doc(db, 'campaigns', campaignId), {
      title,
      system,
      description,
      gmUid: params.gmUid,
      gmName,
      roomCode,
      activeSceneId: params.withStarterContent ? firstSceneId : '',
      theme,
      folders: [...DEFAULT_WIKI_FOLDERS],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, campaignPath);
  }

  // 2. Create Room Code Index, GM Member, Live State, Live Wiki, and optional starter scenes/handouts/notes
  const batch = writeBatch(db);

  batch.set(doc(db, 'roomCodes', roomCode), {
    campaignId,
    gmUid: params.gmUid,
    campaignTitle: title,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'campaigns', campaignId, 'members', params.gmUid), {
    uid: params.gmUid,
    gmUid: params.gmUid,
    campaignId,
    displayName: gmName,
    role: 'gm',
    joinedAt: serverTimestamp(),
  });

  const starterGrid: GridConfig = {
    enabled: false,
    cellSizePx: 56,
    unitLabel: 'm',
    unitValue: 1.5,
    opacity: 0.35,
    offsetX: 0,
    offsetY: 0,
  };

  const tacticalGrid: GridConfig = {
    enabled: true,
    cellSizePx: 60,
    unitLabel: 'm',
    unitValue: 1.5,
    opacity: 0.42,
    offsetX: 0,
    offsetY: 0,
  };

  let initialActiveScene: LiveSceneSnapshot | null = null;
  let initialPublicNotes: PublicNoteSummary[] = [];

  if (params.withStarterContent) {
    const scene1: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
      campaignId,
      gmUid: params.gmUid,
      name: 'A Âncora Enferrujada (Fachada)',
      category: 'location',
      imageUrl: STARTER_ASSETS.tavernScene,
      mediaId: '',
      order: 0,
      grid: starterGrid,
      fogEnabled: false,
      fogStrokes: [],
      tokens: [
        {
          id: 'tok_arquivista',
          name: 'Dr. Henrique (Arquivista)',
          x: 0.72,
          y: 0.68,
          sizePx: 52,
          color: '#8f2d2d',
          imageUrl: STARTER_ASSETS.npcArchivist,
          notes: 'Aguarda os personagens perto do cais com uma carta lacrada.',
          hiddenFromPlayers: false,
        },
      ],
      linkedMusicId: '',
      linkedAmbienceId: '',
    };

    const scene2: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
      campaignId,
      gmUid: params.gmUid,
      name: 'Santuário Antigo (Mapa Tático)',
      category: 'tactical',
      imageUrl: STARTER_ASSETS.tacticalCrypt,
      mediaId: '',
      order: 1,
      grid: tacticalGrid,
      fogEnabled: true,
      fogStrokes: [
        { id: 'fog_entry', mode: 'reveal', shape: 'circle', x: 0.5, y: 0.86, r: 0.16 },
      ],
      tokens: [
        { id: 'tok_p1', name: 'Helena', x: 0.45, y: 0.85, sizePx: 46, color: '#2f5d46', hiddenFromPlayers: false },
        { id: 'tok_p2', name: 'Mateus', x: 0.55, y: 0.86, sizePx: 46, color: '#37546e', hiddenFromPlayers: false },
        { id: 'tok_boss', name: 'Guardião do Altar', x: 0.5, y: 0.25, sizePx: 54, color: '#8f2d2d', hiddenFromPlayers: true },
      ],
      linkedMusicId: '',
      linkedAmbienceId: '',
    };

    const scene3: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
      campaignId,
      gmUid: params.gmUid,
      name: 'Escritório do Porto',
      category: 'landscape',
      imageUrl: STARTER_ASSETS.rainyOffice,
      mediaId: '',
      order: 2,
      grid: starterGrid,
      fogEnabled: false,
      fogStrokes: [],
      tokens: [],
      linkedMusicId: '',
      linkedAmbienceId: '',
    };

    batch.set(doc(db, 'campaigns', campaignId, 'scenes', firstSceneId), {
      ...scene1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'campaigns', campaignId, 'scenes', secondSceneId), {
      ...scene2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'campaigns', campaignId, 'scenes', thirdSceneId), {
      ...scene3,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    initialActiveScene = toLiveSceneSnapshot({ id: firstSceneId, ...scene1 });

    // Starter Handouts
    batch.set(doc(db, 'campaigns', campaignId, 'handouts', makeId('hnd')), {
      campaignId,
      gmUid: params.gmUid,
      title: 'Carta com Selo de Cera',
      kind: 'letter',
      imageUrl: STARTER_ASSETS.waxLetter,
      mediaId: '',
      body: 'As coordenadas 51.4816° N, 0.0093° E levam aos arquivos submersos. Encontrem a chave antes da meia-noite.',
      targetUid: 'none',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'campaigns', campaignId, 'handouts', makeId('hnd')), {
      campaignId,
      gmUid: params.gmUid,
      title: 'Retrato: Dr. Henrique',
      kind: 'npc',
      imageUrl: STARTER_ASSETS.npcArchivist,
      mediaId: '',
      body: 'Antigo curador do arquivo municipal. Carrega uma pequena chave de latão presa ao pescoço.',
      targetUid: 'none',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Starter Notes (Public + GM Secret)
    const pubNoteId = makeId('note');
    const pubNote = {
      folder: 'Locais',
      title: 'Taverna A Âncora Enferrujada',
      content: 'Ponto de encontro de marinheiros e pesquisadores no cais antigo. O taverneiro troca informações por moedas ou boas histórias.',
    };
    batch.set(doc(db, 'campaigns', campaignId, 'notes', pubNoteId), {
      campaignId,
      gmUid: params.gmUid,
      ...pubNote,
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'campaigns', campaignId, 'notes', makeId('note')), {
      campaignId,
      gmUid: params.gmUid,
      folder: 'NPCs',
      title: 'Segredo do Dr. Henrique',
      content: 'SEGREDO DO MESTRE: Henrique já abriu o santuário há dez anos e esconde a segunda metade da chave dentro da mesa do escritório.',
      visibility: 'gm_only',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    initialPublicNotes = [{ id: pubNoteId, ...pubNote }];
  }

  batch.set(doc(db, 'campaigns', campaignId, 'live', 'state'), {
    campaignId,
    gmUid: params.gmUid,
    campaignTitle: title,
    theme,
    activeScene: initialActiveScene,
    activeHandout: null,
    recentPublicRolls: [],
    shakePulseMs: 0,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'campaigns', campaignId, 'live', 'wiki'), {
    campaignId,
    gmUid: params.gmUid,
    notes: initialPublicNotes,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `campaigns/${campaignId}/batch_init`);
  }

  return campaignId;
}

// -----------------------------------------------------------------------------
// Join Campaign by Room Code (Mobile / Online Players)
// -----------------------------------------------------------------------------
export async function joinCampaignByRoomCode(params: {
  roomCode: string;
  uid: string;
  displayName: string;
}): Promise<{ campaignId: string; campaignTitle: string; gmUid: string }> {
  const code = params.roomCode.trim().toUpperCase().slice(0, 6);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error('Código da sala inválido. Use os 6 caracteres exibidos pelo mestre.');
  }

  const codePath = `roomCodes/${code}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'roomCodes', code));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, codePath);
  }

  if (!snap.exists()) {
    throw new Error('Sala não encontrada. Confira o código com o mestre.');
  }

  const info = snap.data() as { campaignId: string; gmUid: string; campaignTitle: string };
  const role: 'gm' | 'player' = info.gmUid === params.uid ? 'gm' : 'player';
  const safeName = clampStr(params.displayName, FIELD_LIMITS.DISPLAY_NAME) || 'Jogador';

  const memberRef = doc(db, 'campaigns', info.campaignId, 'members', params.uid);
  try {
    const existingMember = await getDoc(memberRef);
    if (!existingMember.exists()) {
      await setDoc(memberRef, {
        uid: params.uid,
        gmUid: info.gmUid,
        campaignId: info.campaignId,
        displayName: safeName,
        role,
        joinedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `campaigns/${info.campaignId}/members/${params.uid}`);
  }

  const userMemRef = doc(db, 'users', params.uid, 'memberships', info.campaignId);
  try {
    const existingUserMem = await getDoc(userMemRef);
    if (!existingUserMem.exists()) {
      await setDoc(userMemRef, {
        uid: params.uid,
        campaignId: info.campaignId,
        campaignTitle: clampStr(info.campaignTitle, FIELD_LIMITS.CAMPAIGN_TITLE) || 'Campanha',
        roomCode: code,
        role,
        joinedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${params.uid}/memberships/${info.campaignId}`);
  }

  return info;
}

// -----------------------------------------------------------------------------
// Campaign Theme, Folders, Shake Pulse & Live State Sync
// -----------------------------------------------------------------------------
export async function updateCampaignTheme(
  campaignId: string,
  theme: CampaignTheme,
  currentLiveState: LiveTableState | null
) {
  const cleanTheme = sanitizeTheme(theme);
  try {
    if (currentLiveState) {
      broadcastLiveState(campaignId, { ...currentLiveState, theme: cleanTheme });
    }
    await Promise.all([
      updateDoc(doc(db, 'campaigns', campaignId), {
        theme: cleanTheme,
        updatedAt: serverTimestamp(),
      }),
      updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
        theme: cleanTheme,
        updatedAt: serverTimestamp(),
      }),
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}`);
  }
}

export async function updateCampaignFolders(campaignId: string, folders: string[]) {
  const uniqueClean = Array.from(
    new Set(
      folders
        .map((f) => clampStr(f, FIELD_LIMITS.NOTE_FOLDER))
        .filter((f) => f.length > 0)
    )
  ).slice(0, 40);

  try {
    await updateDoc(doc(db, 'campaigns', campaignId), {
      folders: uniqueClean,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}`);
  }
}

export async function triggerShakePulse(
  campaignId: string,
  currentLiveState: LiveTableState | null
) {
  const pulseMs = Date.now();
  if (currentLiveState) {
    broadcastLiveState(campaignId, { ...currentLiveState, shakePulseMs: pulseMs });
  }
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
      shakePulseMs: pulseMs,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/state`);
  }
}

export async function deleteCampaign(campaignId: string, roomCode: string) {
  try {
    await deleteDoc(doc(db, 'roomCodes', roomCode));
    await deleteDoc(doc(db, 'campaigns', campaignId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}`);
  }
}

export async function activateScene(
  campaignId: string,
  scene: Scene,
  currentLiveState: LiveTableState | null
) {
  const snapshot = toLiveSceneSnapshot(
    scene,
    undefined,
    undefined,
    currentLiveState?.activeScene?.playerViewMode || 'scene'
  );
  if (currentLiveState) {
    broadcastLiveState(campaignId, { ...currentLiveState, activeScene: snapshot });
  }
  try {
    await Promise.all([
      updateDoc(doc(db, 'campaigns', campaignId), {
        activeSceneId: scene.id,
        updatedAt: serverTimestamp(),
      }),
      updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
        activeScene: snapshot,
        updatedAt: serverTimestamp(),
      }),
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/state`);
  }
}

export async function createScene(params: {
  campaignId: string;
  gmUid: string;
  name: string;
  category: SceneCategory;
  imageUrl: string;
  mediaId?: string;
  mediaKind?: SceneMediaKind;
  order: number;
  linkedMusicId?: string;
  linkedAmbienceId?: string;
}): Promise<string> {
  const sceneId = makeId('scn');
  const grid: GridConfig = {
    enabled: params.category === 'tactical',
    cellSizePx: 58,
    unitLabel: 'm',
    unitValue: 1.5,
    opacity: 0.4,
    offsetX: 0,
    offsetY: 0,
  };
  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'scenes', sceneId), {
      campaignId: params.campaignId,
      gmUid: params.gmUid,
      name: clampStr(params.name, FIELD_LIMITS.SCENE_NAME) || 'Nova Cena',
      category: params.category,
      imageUrl: clampStr(params.imageUrl, FIELD_LIMITS.URL_MAX),
      mediaId: clampStr(params.mediaId, FIELD_LIMITS.MEDIA_ID),
      mediaKind: params.mediaKind || 'image',
      order: Math.max(0, Math.min(1000, params.order)),
      grid,
      fogEnabled: false,
      fogStrokes: [],
      walls: [],
      dynamicVision: false,
      tokens: [],
      linkedMusicId: clampStr(params.linkedMusicId, FIELD_LIMITS.MEDIA_ID),
      linkedAmbienceId: clampStr(params.linkedAmbienceId, FIELD_LIMITS.MEDIA_ID),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/scenes/${sceneId}`);
  }
  return sceneId;
}

export async function updateSceneGrid(
  campaignId: string,
  scene: Scene,
  grid: GridConfig,
  isActive: boolean,
  liveState: LiveTableState | null
) {
  const cleanGrid = sanitizeGridConfig(grid);
  const updatedScene: Scene = { ...scene, grid: cleanGrid };
  const snapshot = toLiveSceneSnapshot(
    updatedScene,
    liveState?.activeScene?.activeDuel,
    liveState?.activeScene?.duelConfig,
    liveState?.activeScene?.playerViewMode || 'scene'
  );
  if (isActive && liveState) {
    broadcastLiveState(campaignId, { ...liveState, activeScene: snapshot });
  }
  try {
    const writes = [
      updateDoc(doc(db, 'campaigns', campaignId, 'scenes', scene.id), {
        grid: cleanGrid,
        updatedAt: serverTimestamp(),
      }),
    ];
    if (isActive) {
      writes.push(
        updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
          activeScene: snapshot,
          updatedAt: serverTimestamp(),
        })
      );
    }
    await Promise.all(writes);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/scenes/${scene.id}`);
  }
}

export async function updateSceneFog(
  campaignId: string,
  scene: Scene,
  fogEnabled: boolean,
  fogStrokes: FogStroke[],
  isActive: boolean,
  liveState: LiveTableState | null
) {
  const bounded = stripUndefinedDeep(fogStrokes.slice(-FIELD_LIMITS.MAX_FOG_STROKES));
  const updatedScene: Scene = { ...scene, fogEnabled, fogStrokes: bounded };
  const snapshot = toLiveSceneSnapshot(
    updatedScene,
    liveState?.activeScene?.activeDuel,
    liveState?.activeScene?.duelConfig,
    liveState?.activeScene?.playerViewMode || 'scene'
  );
  if (isActive && liveState) {
    broadcastLiveState(campaignId, { ...liveState, activeScene: snapshot });
  }
  try {
    const writes = [
      updateDoc(doc(db, 'campaigns', campaignId, 'scenes', scene.id), {
        fogEnabled,
        fogStrokes: bounded,
        updatedAt: serverTimestamp(),
      }),
    ];
    if (isActive) {
      writes.push(
        updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
          activeScene: snapshot,
          updatedAt: serverTimestamp(),
        })
      );
    }
    await Promise.all(writes);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/scenes/${scene.id}`);
  }
}

export async function updateSceneWalls(
  campaignId: string,
  scene: Scene,
  walls: SceneWall[],
  dynamicVision: boolean,
  isActive: boolean,
  liveState: LiveTableState | null
) {
  const bounded = stripUndefinedDeep(walls.slice(0, FIELD_LIMITS.MAX_WALLS));
  const updatedScene: Scene = { ...scene, walls: bounded, dynamicVision };
  const snapshot = toLiveSceneSnapshot(
    updatedScene,
    liveState?.activeScene?.activeDuel,
    liveState?.activeScene?.duelConfig,
    liveState?.activeScene?.playerViewMode || 'scene'
  );
  if (isActive && liveState) {
    broadcastLiveState(campaignId, { ...liveState, activeScene: snapshot });
  }
  try {
    const writes = [
      updateDoc(doc(db, 'campaigns', campaignId, 'scenes', scene.id), {
        walls: bounded,
        dynamicVision,
        updatedAt: serverTimestamp(),
      }),
    ];
    if (isActive) {
      writes.push(
        updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
          activeScene: snapshot,
          updatedAt: serverTimestamp(),
        })
      );
    }
    await Promise.all(writes);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/scenes/${scene.id}`);
  }
}

export async function updateSceneTokens(
  campaignId: string,
  scene: Scene,
  tokens: SceneToken[],
  isActive: boolean,
  liveState: LiveTableState | null
) {
  const bounded = stripUndefinedDeep(tokens.slice(0, FIELD_LIMITS.MAX_TOKENS));
  const updatedScene: Scene = { ...scene, tokens: bounded };
  const snapshot = toLiveSceneSnapshot(
    updatedScene,
    liveState?.activeScene?.activeDuel,
    liveState?.activeScene?.duelConfig,
    liveState?.activeScene?.playerViewMode || 'scene'
  );
  if (isActive && liveState) {
    broadcastLiveState(campaignId, { ...liveState, activeScene: snapshot });
  }
  try {
    const writes = [
      updateDoc(doc(db, 'campaigns', campaignId, 'scenes', scene.id), {
        tokens: bounded,
        updatedAt: serverTimestamp(),
      }),
    ];
    if (isActive) {
      writes.push(
        updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
          activeScene: snapshot,
          updatedAt: serverTimestamp(),
        })
      );
    }
    await Promise.all(writes);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/scenes/${scene.id}`);
  }
}

export async function updateSceneMeta(
  campaignId: string,
  sceneId: string,
  updates: {
    name: string;
    category: SceneCategory;
    imageUrl: string;
    mediaId: string;
    order: number;
    linkedMusicId: string;
    linkedAmbienceId: string;
  }
) {
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'scenes', sceneId), {
      name: clampStr(updates.name, FIELD_LIMITS.SCENE_NAME) || 'Cena',
      category: updates.category,
      imageUrl: clampStr(updates.imageUrl, FIELD_LIMITS.URL_MAX),
      mediaId: clampStr(updates.mediaId, FIELD_LIMITS.MEDIA_ID),
      order: updates.order,
      linkedMusicId: clampStr(updates.linkedMusicId, FIELD_LIMITS.MEDIA_ID),
      linkedAmbienceId: clampStr(updates.linkedAmbienceId, FIELD_LIMITS.MEDIA_ID),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/scenes/${sceneId}`);
  }
}

export async function deleteScene(campaignId: string, sceneId: string) {
  try {
    await deleteDoc(doc(db, 'campaigns', campaignId, 'scenes', sceneId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}/scenes/${sceneId}`);
  }
}

// -----------------------------------------------------------------------------
// Handouts & Fullscreen Pop-up Projection
// -----------------------------------------------------------------------------
export async function createHandout(params: {
  campaignId: string;
  gmUid: string;
  title: string;
  kind: HandoutKind;
  imageUrl: string;
  mediaId?: string;
  body: string;
}): Promise<string> {
  const id = makeId('hnd');
  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'handouts', id), {
      campaignId: params.campaignId,
      gmUid: params.gmUid,
      title: clampStr(params.title, FIELD_LIMITS.HANDOUT_TITLE) || 'Nova Pista',
      kind: params.kind,
      imageUrl: clampStr(params.imageUrl, FIELD_LIMITS.URL_MAX),
      mediaId: clampStr(params.mediaId, FIELD_LIMITS.MEDIA_ID),
      body: clampStr(params.body, FIELD_LIMITS.HANDOUT_BODY),
      targetUid: 'none',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/handouts/${id}`);
  }
  return id;
}

export async function projectHandoutToAll(
  campaignId: string,
  handout: ActiveHandoutProjection | null,
  liveState: LiveTableState | null
) {
  const cleanHandout = handout ? stripUndefinedDeep(handout) : null;
  if (liveState) {
    broadcastLiveState(campaignId, { ...liveState, activeHandout: cleanHandout });
  }
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'live', 'state'), {
      activeHandout: cleanHandout,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/state`);
  }
}

export async function sendHandoutToPlayer(
  campaignId: string,
  handoutId: string,
  targetUid: string
) {
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'handouts', handoutId), {
      targetUid: clampStr(targetUid, FIELD_LIMITS.MEDIA_ID) || 'none',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/handouts/${handoutId}`);
  }
}

export async function deleteHandout(campaignId: string, handoutId: string) {
  try {
    await deleteDoc(doc(db, 'campaigns', campaignId, 'handouts', handoutId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}/handouts/${handoutId}`);
  }
}

// -----------------------------------------------------------------------------
// Modular & PDF-Imported Character Sheets (System-Agnostic)
// -----------------------------------------------------------------------------
export async function createCharacterSheet(params: {
  campaignId: string;
  gmUid: string;
  ownerUid: string;
  ownerName: string;
  name: string;
  subtitle?: string;
  systemName?: string;
  mode?: 'modular' | 'pdf';
  avatarUrl?: string;
  avatarMediaId?: string;
  pdfUrl?: string;
  pdfMediaId?: string;
  pdfFileName?: string;
  blocks?: SheetBlock[];
}): Promise<string> {
  const id = makeId('sht');
  const blocks = stripUndefinedDeep(
    params.blocks && params.blocks.length > 0
      ? params.blocks.slice(0, FIELD_LIMITS.MAX_BLOCKS)
      : createBlankSheetBlocks()
  );

  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'sheets', id), {
      campaignId: params.campaignId,
      gmUid: params.gmUid,
      ownerUid: params.ownerUid,
      ownerName: clampStr(params.ownerName, FIELD_LIMITS.DISPLAY_NAME) || 'Jogador',
      name: clampStr(params.name, FIELD_LIMITS.SHEET_NAME) || 'Novo Personagem',
      subtitle: clampStr(params.subtitle || 'Ficha Livre', FIELD_LIMITS.SHEET_SUBTITLE),
      templateId: clampStr(params.systemName || 'Sistema Livre', FIELD_LIMITS.CAMPAIGN_SYSTEM),
      mode: params.mode || 'modular',
      avatarUrl: clampStr(params.avatarUrl, FIELD_LIMITS.URL_MAX),
      avatarMediaId: clampStr(params.avatarMediaId, FIELD_LIMITS.MEDIA_ID),
      pdfUrl: clampStr(params.pdfUrl, FIELD_LIMITS.URL_MAX),
      pdfMediaId: clampStr(params.pdfMediaId, FIELD_LIMITS.MEDIA_ID),
      pdfFileName: clampStr(params.pdfFileName, 200),
      blocks,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/sheets/${id}`);
  }
  return id;
}

export async function updateCharacterSheet(
  campaignId: string,
  sheetId: string,
  updates: {
    name: string;
    subtitle: string;
    templateId: string;
    mode: 'modular' | 'pdf';
    avatarUrl?: string;
    avatarMediaId?: string;
    pdfUrl: string;
    pdfMediaId: string;
    pdfFileName: string;
    blocks: SheetBlock[];
  }
) {
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'sheets', sheetId), {
      name: clampStr(updates.name, FIELD_LIMITS.SHEET_NAME) || 'Personagem',
      subtitle: clampStr(updates.subtitle, FIELD_LIMITS.SHEET_SUBTITLE),
      templateId: clampStr(updates.templateId || 'Sistema Livre', FIELD_LIMITS.CAMPAIGN_SYSTEM),
      mode: updates.mode,
      avatarUrl: clampStr(updates.avatarUrl, FIELD_LIMITS.URL_MAX),
      avatarMediaId: clampStr(updates.avatarMediaId, FIELD_LIMITS.MEDIA_ID),
      pdfUrl: clampStr(updates.pdfUrl, FIELD_LIMITS.URL_MAX),
      pdfMediaId: clampStr(updates.pdfMediaId, FIELD_LIMITS.MEDIA_ID),
      pdfFileName: clampStr(updates.pdfFileName, 200),
      blocks: stripUndefinedDeep(updates.blocks.slice(0, FIELD_LIMITS.MAX_BLOCKS)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/sheets/${sheetId}`);
  }
}

export async function deleteCharacterSheet(campaignId: string, sheetId: string) {
  try {
    await deleteDoc(doc(db, 'campaigns', campaignId, 'sheets', sheetId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}/sheets/${sheetId}`);
  }
}

// -----------------------------------------------------------------------------
// Campaign Wiki Notes (with GM Secret Isolation)
// -----------------------------------------------------------------------------
export async function syncPublicWikiNotes(campaignId: string, allNotes: CampaignNote[]) {
  const publicNotes: PublicNoteSummary[] = allNotes
    .filter((n) => n.visibility === 'public')
    .slice(0, FIELD_LIMITS.MAX_PUBLIC_NOTES)
    .map((n) => ({
      id: n.id,
      folder: n.folder,
      title: n.title,
      content: n.content,
    }));

  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'live', 'wiki'), {
      notes: publicNotes,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/live/wiki`);
  }
}

export async function createNote(params: {
  campaignId: string;
  gmUid: string;
  folder: string;
  title: string;
  content: string;
  visibility: 'public' | 'gm_only';
  existingNotes: CampaignNote[];
}): Promise<string> {
  const id = makeId('note');
  const noteData = {
    campaignId: params.campaignId,
    gmUid: params.gmUid,
    folder: clampStr(params.folder, FIELD_LIMITS.NOTE_FOLDER) || 'Notas',
    title: clampStr(params.title, FIELD_LIMITS.NOTE_TITLE) || 'Sem título',
    content: clampStr(params.content, FIELD_LIMITS.NOTE_CONTENT),
    visibility: params.visibility,
  };
  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'notes', id), {
      ...noteData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (params.visibility === 'public') {
      await syncPublicWikiNotes(params.campaignId, [...params.existingNotes, { id, ...noteData }]);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/notes/${id}`);
  }
  return id;
}

export async function updateNote(
  campaignId: string,
  noteId: string,
  updates: {
    folder: string;
    title: string;
    content: string;
    visibility: 'public' | 'gm_only';
  },
  allNotes: CampaignNote[]
) {
  const clean = {
    folder: clampStr(updates.folder, FIELD_LIMITS.NOTE_FOLDER) || 'Notas',
    title: clampStr(updates.title, FIELD_LIMITS.NOTE_TITLE) || 'Sem título',
    content: clampStr(updates.content, FIELD_LIMITS.NOTE_CONTENT),
    visibility: updates.visibility,
  };
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'notes', noteId), {
      ...clean,
      updatedAt: serverTimestamp(),
    });
    const nextNotes = allNotes.map((n) => (n.id === noteId ? { ...n, ...clean } : n));
    await syncPublicWikiNotes(campaignId, nextNotes);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/notes/${noteId}`);
  }
}

export async function deleteNote(campaignId: string, noteId: string, allNotes: CampaignNote[]) {
  try {
    await deleteDoc(doc(db, 'campaigns', campaignId, 'notes', noteId));
    await syncPublicWikiNotes(
      campaignId,
      allNotes.filter((n) => n.id !== noteId)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}/notes/${noteId}`);
  }
}

// -----------------------------------------------------------------------------
// Dice Rolls & Chat Feed
// -----------------------------------------------------------------------------
export async function recordDiceRoll(params: {
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
  currentRecentPublicRolls: PublicRollSummary[];
  liveState?: LiveTableState | null;
}): Promise<string> {
  const id = makeId('roll');
  const rollPayload = {
    campaignId: params.campaignId,
    gmUid: params.gmUid,
    rollerUid: params.rollerUid,
    rollerName: clampStr(params.rollerName, FIELD_LIMITS.DISPLAY_NAME) || 'Jogador',
    label: clampStr(params.label, FIELD_LIMITS.ROLL_LABEL),
    formula: clampStr(params.formula, FIELD_LIMITS.ROLL_FORMULA) || '-',
    resolvedFormula: clampStr(params.resolvedFormula, FIELD_LIMITS.ROLL_FORMULA),
    total: Number.isFinite(params.total) ? params.total : 0,
    summary: clampStr(params.summary, FIELD_LIMITS.ROLL_SUMMARY),
    breakdown: clampStr(params.breakdown, FIELD_LIMITS.ROLL_BREAKDOWN),
    outcome: params.outcome,
    visibility: params.visibility,
  };

  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'rolls', id), {
      ...rollPayload,
      createdAt: serverTimestamp(),
    });

    if (params.visibility === 'public') {
      const publicSummary: PublicRollSummary = {
        id,
        rollerName: rollPayload.rollerName,
        label: rollPayload.label,
        formula: rollPayload.formula,
        total: rollPayload.total,
        summary: rollPayload.summary,
        breakdown: rollPayload.breakdown,
        outcome: rollPayload.outcome,
        timestampMs: Date.now(),
      };
      const nextPublic = [publicSummary, ...params.currentRecentPublicRolls].slice(
        0,
        FIELD_LIMITS.MAX_PUBLIC_ROLLS
      );
      if (params.liveState) {
        broadcastLiveState(params.campaignId, {
          ...params.liveState,
          recentPublicRolls: nextPublic,
        });
      }
      await updateDoc(doc(db, 'campaigns', params.campaignId, 'live', 'state'), {
        recentPublicRolls: nextPublic,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/rolls/${id}`);
  }
  return id;
}

// -----------------------------------------------------------------------------
// User-Uploaded & Linked Audio Tracks (Cloud Persisted + DSP)
// -----------------------------------------------------------------------------
export async function createAudioTrack(params: {
  campaignId: string;
  gmUid: string;
  name: string;
  layer: AudioLayer;
  sourceType: 'url' | 'media' | 'youtube';
  url?: string;
  mediaId?: string;
  synthPreset?: string;
  dsp?: AudioDspSettings;
}): Promise<string> {
  const id = makeId('aud');
  const cleanDsp: AudioDspSettings = {
    startSec: Math.max(0, Math.min(36000, Number(params.dsp?.startSec) || 0)),
    speed: Math.max(0.5, Math.min(2.0, Number(params.dsp?.speed) || 1)),
    pitch: Math.max(-12, Math.min(12, Number(params.dsp?.pitch) || 0)),
    muffle: Math.max(0, Math.min(100, Number(params.dsp?.muffle) || 0)),
  };
  try {
    await setDoc(doc(db, 'campaigns', params.campaignId, 'audioTracks', id), {
      campaignId: params.campaignId,
      gmUid: params.gmUid,
      name: clampStr(params.name, FIELD_LIMITS.TRACK_NAME) || 'Faixa de Áudio',
      layer: params.layer,
      sourceType: params.sourceType,
      synthPreset: clampStr(params.synthPreset, 60),
      url: clampStr(params.url, FIELD_LIMITS.URL_MAX),
      mediaId: clampStr(params.mediaId, FIELD_LIMITS.MEDIA_ID),
      dsp: cleanDsp,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `campaigns/${params.campaignId}/audioTracks/${id}`);
  }
  return id;
}

export async function updateAudioTrackDsp(
  campaignId: string,
  trackId: string,
  dsp: AudioDspSettings
) {
  const cleanDsp: AudioDspSettings = {
    startSec: Math.max(0, Math.min(36000, Number(dsp.startSec) || 0)),
    speed: Math.max(0.5, Math.min(2.0, Number(dsp.speed) || 1)),
    pitch: Math.max(-12, Math.min(12, Number(dsp.pitch) || 0)),
    muffle: Math.max(0, Math.min(100, Number(dsp.muffle) || 0)),
  };
  try {
    await updateDoc(doc(db, 'campaigns', campaignId, 'audioTracks', trackId), {
      dsp: cleanDsp,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}/audioTracks/${trackId}`);
  }
}

export async function deleteAudioTrack(campaignId: string, trackId: string) {
  try {
    await deleteDoc(doc(db, 'campaigns', campaignId, 'audioTracks', trackId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `campaigns/${campaignId}/audioTracks/${trackId}`);
  }
}
