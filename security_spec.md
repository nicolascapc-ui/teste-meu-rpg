# Security Specification — Folio VTT

## 1. Data Invariants

1. **Verified Identity**: Every read and write operation requires a signed-in user with a verified Google email (`request.auth != null && request.auth.token.email_verified == true`).
2. **Campaign Master Gate**: Access to any campaign sub-resource (`/live/state`, `/live/wiki`, `/sheets`, `/rolls`, `/handouts`, `/members`) requires active membership in `/campaigns/{campaignId}/members/{request.auth.uid}` or being the verified GM (`gmUid == request.auth.uid`).
3. **GM Secret Isolation**: `CampaignNote` documents with `visibility == 'gm_only'` and `DiceRoll` documents with `visibility == 'gm_only'` are strictly unreadable by non-GM players. Public notes are mirrored to `/live/wiki` strictly by the GM.
4. **No Self-Promotion to GM**: A player joining via `/roomCodes/{roomCode}` can only create a membership document with `role == 'player'` and `uid == request.auth.uid`. Only the campaign creator (`gmUid`) can hold `role == 'gm'`.
5. **Immutable Ownership & Server Timestamps**: `gmUid`, `ownerUid`, `campaignId`, `rollerUid`, and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
6. **Volumetric Bounds & No Shadow Fields**: Every string has an explicit `.size()` ceiling, every array has a `.size() <= MAX` bound, and every `create` enforces `hasAll` + `hasOnly`, while every `update` enforces `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on Campaign Create**: Authenticated user `attacker` creates `/campaigns/c1` with `gmUid: "victim_gm"`. -> **PERMISSION_DENIED**.
2. **Privilege Escalation on Room Join**: Non-GM user creates `/campaigns/c1/members/attacker` with `role: "gm"`. -> **PERMISSION_DENIED**.
3. **GM Secret Note Leakage**: Campaign member (`role: "player"`) attempts `get` or `list` on `/campaigns/c1/notes/secret1` (`visibility: "gm_only"`). -> **PERMISSION_DENIED**.
4. **Hidden GM Roll Leakage**: Campaign member (`role: "player"`) attempts `get` or `list` on `/campaigns/c1/rolls/hidden1` (`visibility: "gm_only"`). -> **PERMISSION_DENIED**.
5. **Private Handout Interception**: Player B attempts `get` or `list` on `/campaigns/c1/handouts/clue1` where `targetUid == "playerA"`. -> **PERMISSION_DENIED**.
6. **Shadow Field Injection**: GM creates or updates `/campaigns/c1` including an undeclared field `isAdmin: true`. -> **PERMISSION_DENIED**.
7. **Timestamp Forgery**: User creates `/campaigns/c1/rolls/r1` with a client-forged past `createdAt` instead of `request.time`. -> **PERMISSION_DENIED**.
8. **ID Poisoning**: User attempts `create` at `/campaigns/${'a'.repeat(300)}` or with invalid characters `../admin`. -> **PERMISSION_DENIED**.
9. **Sheet Hijacking**: Player B attempts to update Player A's character sheet `/campaigns/c1/sheets/sheetA`. -> **PERMISSION_DENIED**.
10. **Owner Mutation on Update**: Player A attempts to update their own sheet changing `ownerUid` or `gmUid` or `campaignId`. -> **PERMISSION_DENIED**.
11. **Live State Tampering by Player**: Player attempts to overwrite `activeScene` or `theme` on `/campaigns/c1/live/state` (players may ONLY append to `recentPublicRolls`). -> **PERMISSION_DENIED**.
12. **Unverified Email Bypass**: User with `email_verified: false` attempts any read or write. -> **PERMISSION_DENIED**.
