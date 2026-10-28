# Security Specification — SpectraPulse Audio Studio

## 1. Data Invariants
1. **Identity & Ownership**: Every document in `/presets/{presetId}` and `/drafts/{draftId}` must belong to an authenticated user with a verified email (`request.auth.token.email_verified == true`), and `ownerId` must strictly equal `request.auth.uid`.
2. **Path & Document ID Binding**: Document ID `{presetId}` or `{draftId}` must match `^[a-zA-Z0-9_\-]+$` (length 1..128) and equal `incoming().id`.
3. **Immutable Fields**: `id`, `ownerId`, and `createdAt` can never be mutated during an `update` operation.
4. **Server Timestamps Only**: `createdAt` must equal `request.time` on `create`, and `updatedAt` must equal `request.time` on both `create` and `update`.
5. **Strict Schema & Volumetric Bounds**: No extra shadow keys are permitted (`keys().hasOnly(...)`). All strings have strict `.size()` boundaries and enums are strictly checked.
6. **Zero-Trust Query Enforcement**: `list` queries on `/presets` and `/drafts` must explicitly enforce `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection**: Adding `"isAdmin": true` to a `/presets/{presetId}` document creation payload.
2. **Owner Spoofing on Create**: Creating a preset where `ownerId: "victim-uid"` while authenticated as `"attacker-uid"`.
3. **Unverified Email Write**: Attempting to create a preset when `request.auth.token.email_verified == false`.
4. **ID Poisoning Attack**: Creating a document at `/presets/invalid$id!with*spaces` or a 200-char ID.
5. **ID Mismatch**: Creating `/presets/preset_1` where payload `id` is `"preset_2"`.
6. **Timestamp Forgery on Create**: Creating a preset with a client-supplied past or future `createdAt` instead of `request.time`.
7. **Immutable Field Mutation**: Updating `ownerId` or `createdAt` on an existing `/drafts/{draftId}` document.
8. **Value Poisoning on Update**: Updating `sensitivity` to a string `"high"` or `99999` (out of range `0.2..4.0`).
9. **Oversized String Exhaustion**: Updating `notes` on `/drafts/{draftId}` with a 10,000-character string (exceeds `maxLength: 500`).
10. **Enum Bypass**: Creating a preset with `mode: "hacked-shader"` or `colorTheme: "rainbow-exploit"`.
11. **Cross-Tenant Read/Get**: Authenticated user `"attacker-uid"` reading `/presets/victim_preset` owned by `"victim-uid"`.
12. **Blanket List Scraping**: Executing an unfiltered `list` query on `/drafts` without `where("ownerId", "==", request.auth.uid)`.
