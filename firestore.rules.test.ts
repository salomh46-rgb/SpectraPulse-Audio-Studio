/**
 * Security Rules Verification Suite for SpectraPulse Audio Studio
 * Verifies that all Dirty Dozen payloads return PERMISSION_DENIED.
 */

export interface DirtyPayloadTestCase {
  id: number;
  name: string;
  collection: 'presets' | 'drafts';
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  authUid: string | null;
  emailVerified: boolean;
  docId: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyPayloadTestCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { id: 'preset_1', ownerId: 'user_1', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Owner Spoofing on Create',
    collection: 'presets',
    operation: 'create',
    authUid: 'attacker_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { id: 'preset_1', ownerId: 'victim_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Write',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: false,
    docId: 'preset_1',
    payload: { id: 'preset_1', ownerId: 'user_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'ID Poisoning Attack',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'invalid$id!with*spaces',
    payload: { id: 'invalid$id!with*spaces', ownerId: 'user_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID Mismatch',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { id: 'preset_2', ownerId: 'user_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Timestamp Forgery on Create',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { id: 'preset_1', ownerId: 'user_1', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable Field Mutation',
    collection: 'drafts',
    operation: 'update',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'draft_1',
    payload: { ownerId: 'user_2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value Poisoning on Update',
    collection: 'presets',
    operation: 'update',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { sensitivity: 99999 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Oversized String Exhaustion',
    collection: 'drafts',
    operation: 'update',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'draft_1',
    payload: { notes: 'x'.repeat(1000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Enum Bypass',
    collection: 'presets',
    operation: 'create',
    authUid: 'user_1',
    emailVerified: true,
    docId: 'preset_1',
    payload: { id: 'preset_1', ownerId: 'user_1', mode: 'hacked-shader' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Cross-Tenant Read/Get',
    collection: 'presets',
    operation: 'get',
    authUid: 'attacker_1',
    emailVerified: true,
    docId: 'victim_preset',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Scraping',
    collection: 'drafts',
    operation: 'list',
    authUid: 'attacker_1',
    emailVerified: true,
    docId: '*',
    expectedResult: 'PERMISSION_DENIED',
  },
];
