/**
 * Security Rules Specification Verification Suite for Folio VTT
 * Validates the 12 adversarial ("Dirty Dozen") scenarios against firestore.rules.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  actor: { uid: string; emailVerified: boolean; role: 'gm' | 'player' | 'outsider' };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOW';
}

export const DIRTY_DOZEN_CASES: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Campaign Create',
    actor: { uid: 'attacker_uid', emailVerified: true, role: 'outsider' },
    operation: 'create',
    path: '/campaigns/camp_01',
    payload: { gmUid: 'victim_gm', title: 'Spoofed', system: 'D&D', gmName: 'Hack', roomCode: 'ABC123' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Privilege Escalation on Room Join',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'create',
    path: '/campaigns/camp_01/members/player_01',
    payload: { uid: 'player_01', gmUid: 'gm_01', campaignId: 'camp_01', displayName: 'Rogue', role: 'gm' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'GM Secret Note Leakage',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'get',
    path: '/campaigns/camp_01/notes/secret_note_1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Hidden GM Roll Leakage',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'get',
    path: '/campaigns/camp_01/rolls/hidden_roll_1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Private Handout Interception',
    actor: { uid: 'player_02', emailVerified: true, role: 'player' },
    operation: 'get',
    path: '/campaigns/camp_01/handouts/private_for_player_01',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow Field Injection on Campaign Update',
    actor: { uid: 'gm_01', emailVerified: true, role: 'gm' },
    operation: 'update',
    path: '/campaigns/camp_01',
    payload: { title: 'Valid', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Timestamp Forgery on Roll Create',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'create',
    path: '/campaigns/camp_01/rolls/roll_forged',
    payload: { createdAt: '1999-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning (>128 chars)',
    actor: { uid: 'gm_01', emailVerified: true, role: 'gm' },
    operation: 'create',
    path: `/campaigns/${'x'.repeat(200)}`,
    payload: { title: 'Overflow' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Character Sheet Hijacking by Another Player',
    actor: { uid: 'player_02', emailVerified: true, role: 'player' },
    operation: 'update',
    path: '/campaigns/camp_01/sheets/sheet_player_01',
    payload: { name: 'Hacked' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Owner Mutation on Sheet Update',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'update',
    path: '/campaigns/camp_01/sheets/sheet_player_01',
    payload: { ownerUid: 'player_02' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Live Scene Tampering by Non-GM Player',
    actor: { uid: 'player_01', emailVerified: true, role: 'player' },
    operation: 'update',
    path: '/campaigns/camp_01/live/state',
    payload: { activeScene: { name: 'Injected Scene' } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unverified Email Bypass',
    actor: { uid: 'unverified_uid', emailVerified: false, role: 'outsider' },
    operation: 'get',
    path: '/roomCodes/ABC123',
    expected: 'PERMISSION_DENIED',
  },
];
