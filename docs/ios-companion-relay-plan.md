# Vault iOS Companion — Implementation Plan

## Context

The vault is a local-first, markdown-based personal knowledge + task system in [craft-agents-oss](.). Today it lives in an Electron app + headless `server-core`, with a fully working JSON-RPC-over-WebSocket transport ([packages/server-core/src/transport/server.ts](packages/server-core/src/transport/server.ts)) and a recently-shipped macOS menubar Days tray ([apps/electron/src/renderer/days-tray/](apps/electron/src/renderer/days-tray/)) that proves the data is glance-able.

The user wants a SwiftUI iOS companion with **full Days parity** (Today + Next + Someday + day nav + journal/scratch viewer + capture). The app should work even when the Mac is asleep, so this requires a **cloud relay** rather than a same-LAN-only design. Decisions already settled with the user:

- **Connectivity**: Cloud relay (always-on)
- **Hosting**: Cloudflare Workers + Durable Objects
- **Relay role**: State-holding cache + write queue (phone usable when Mac is offline; phone writes queue until Mac reconnects)
- **iOS stack**: SwiftUI native (iOS 17+)
- **Pairing**: QR code, one-time pairing token → long-lived device token in Keychain
- **Encryption**: TLS only for v1 (trust the relay operator). E2E flagged as v2.

The wire format is already plain JSON (envelope at [packages/shared/src/protocol/types.ts](packages/shared/src/protocol/types.ts), codec at [packages/server-core/src/transport/codec.ts](packages/server-core/src/transport/codec.ts)) — Swift `Codable` + `URLSessionWebSocketTask` speak it natively. All domain types are already JSON-shaped (`TaskRecord`, `DayRecord`, `DaysBoardRecord`, `DayTask`, `CaptureItem`).

## Current status (reconciliation — updated)

A first implementation already landed on branch `ios-app` as commit `8e3c88c` (50 files, +2408). It is `rocky` + 1 commit; `rocky`/`origin/rocky` are unchanged at the merge-base, so **no rebase is needed** (it would be a no-op). The commit already embodies the full design below *including every P1 review fix*:

- Pre-work refactors landed: public `WsRpcServer.dispatch(channel, ctx, args)` ([server.ts:218](packages/server-core/src/transport/server.ts)) and `EventSink` wired into `push()` ([server.ts:206](packages/server-core/src/transport/server.ts)).
- Relay mints all tokens via `/room/create` + HMAC ([apps/relay/src/worker.ts](apps/relay/src/worker.ts), [auth.ts](apps/relay/src/auth.ts)); DO persists snapshot/queue/pairing/revocation + `relay:setMeta` for `desktopWorkspaceId` ([apps/relay/src/durable/VaultRoom.ts](apps/relay/src/durable/VaultRoom.ts)).
- Bridge: `EventSink` outbound, `desktopWorkspaceId` injection, `(deviceId,writeId)` dedup, `dispatch` with real `RequestContext` ([packages/server-core/src/relay/relay-bridge.ts](packages/server-core/src/relay/relay-bridge.ts)); started for `remoteServer.mode === 'relay'` workspaces in [packages/server/src/index.ts:282](packages/server/src/index.ts).
- iOS: `RelayClient` unwraps `relay:event.envelope` with `serverSeq` gating ([apps/ios/Sources/Networking/RelayClient.swift](apps/ios/Sources/Networking/RelayClient.swift)); Models/Store/Persistence/Pairing + Today/Inbox/Notes/Pairing/Root views.

**Remaining last-mile work (this is the real backlog now):**
1. **Runnable iOS app target** — current `apps/ios` is a `Package.swift` source library; no `.xcodeproj`/app target/Info.plist, so it can't launch in a simulator. Add an app target (and the App Group for the share extension).
2. **Desktop pairing UX** — Electron-side `/room/create` bootstrap + QR pairing window are not wired (`apps/electron/src/main` has no relay bootstrap). The headless bridge runs, but there's no way to pair a phone from the UI yet.
3. **Share Extension** — not present (plan v1 item; build-order step 9).
4. **Verify Full Days parity** — confirm Next/Someday + WeekStrip day-nav exist (may be embedded in `TodayView`) vs. plan's screen list.
5. **Run & verify** — relay `auth.test.ts` + `relay-bridge.test.ts` exist but unrun; no end-to-end pass against the verification checklist below.

The sections below remain the design of record; treat them now as the spec to **verify the existing code against and finish**, not a greenfield build.

## Architecture

```
[ iOS app ] <--wss--> [ Cloudflare Worker + Durable Object ] <--wss--> [ Electron / server-core ]
   SwiftUI               VaultRoom DO: snapshot + queue + log         relay-bridge dials outbound
```

**Routing context comes from the URL + auth, not from a wrapper envelope.** The DO already knows `roomId` from the URL path and `deviceId` from the bearer token; both ends speak the existing unmodified `MessageEnvelope` for the existing `tasks:*`/`days:*`/`capture:*` channels. The relay's own write/snapshot semantics live in a small set of new RPC channels under `relay:*`, not in a wrapper layer.

**Sequence numbers are *not* shared with the existing `MessageEnvelope.seq`.** That field is per-client local-server delivery state (see [server.ts:703](packages/server-core/src/transport/server.ts)) and stays untouched. The relay's room-scoped, durable replay sequence lives only on `RelayEvent.serverSeq` and `RelayAck.upToSeq` (defined below).

---

## Pre-work refactors (block everything else)

These two server-core changes must land first; the rest of the plan depends on them.

### 1. Public handler dispatch on `WsRpcServer`

`WsRpcServer.handlers` is private and only invoked from `onRequest` for real client sockets ([server.ts:626](packages/server-core/src/transport/server.ts)). The relay-bridge needs to apply phone-originated writes through the same handlers without faking a WebSocket. Pick one:

- **Option a (preferred)**: extract `RpcHandlerRegistry` — a tiny class owning the `Map<string, HandlerFn>` and a `dispatch(channel, ctx, args)` method. `WsRpcServer` takes a registry in its options instead of owning the map. The relay-bridge takes the same registry.
- **Option b**: add `WsRpcServer.dispatch(channel, ctx, args)` as a public method that runs a handler exactly as `onRequest` does, minus the socket I/O.

`ctx` is the existing `RequestContext` shape — `{ clientId, workspaceId, webContentsId }` only ([transport/types.ts:7](packages/server-core/src/transport/types.ts)). Do *not* invent a `capabilities` field; capabilities live on `ClientConnection` for invokeClient routing, not on requests. If the bridge later needs auth policy, add it deliberately as a new field with handler audit.

Tests: round-trip an in-process dispatch through a real handler (e.g. `tasks:list`) and verify the result matches the WS path.

### 2. Outgoing-event hook on `WsRpcServer`

`WsRpcServer.push()` writes to live client sockets ([server.ts:189](packages/server-core/src/transport/server.ts)) but offers no observer. The relay-bridge needs every `*:changed` event the server pushes locally. Wire the existing `EventSink` type already declared in [transport/types.ts:28](packages/server-core/src/transport/types.ts) (`(channel, target, ...args) => void`) as a constructor option `eventSink?: EventSink`; on every `push()` call, invoke it after the existing client-fanout loop. Existing call sites unchanged. Test: register a fake `EventSink`, fire a change, assert the callback receives identical channel/args to what real clients see.

These two refactors are tiny but unblock everything; do them in one PR with tests, before opening `apps/relay/`.

---

## A. Relay service — `apps/relay/` (new)

Cloudflare Worker with one Durable Object class `VaultRoom`. One DO per paired desktop+devices (room).

### Files

- `apps/relay/wrangler.toml` — DO bindings, KV namespace.
- `apps/relay/src/worker.ts` — fetch entry; routes `/pair/*` HTTP, `/v1/desktop` and `/v1/device` WS upgrades.
- `apps/relay/src/durable/VaultRoom.ts` — DO class. Use Hibernation API (`acceptWebSocket()`) for idle phones. **Spike to verify**: cost of always-on desktop ping at 30s — may need to lengthen to 5min and lean on TCP keepalive.
- `apps/relay/src/pairing.ts` — issue/redeem 10-min pairing tokens.
- `apps/relay/src/auth.ts` — verify HMAC-signed bearer tokens bound to `(roomId, deviceId)`.

### Relay protocol (the new bits)

Define new RPC channels in [packages/shared/src/protocol/channels.ts](packages/shared/src/protocol/channels.ts) under `relay:*`. These are spoken **only** between relay endpoints; existing `tasks:*`/`days:*`/`capture:*` channels are untouched and forwarded verbatim.

**`relay:write`** — phone → relay → desktop (queued writes).
```ts
// Phone sends:
{
  writeId: string;          // UUID, client-generated, idempotency key
  targetChannel: string;    // e.g. 'tasks:update'
  args: unknown[];          // domain args (excluding workspaceId — see below)
  createdAt: string;
}
// Relay forwards to desktop, ADDING server-trusted fields:
{
  ...above,
  deviceId: string;         // from socket auth — never trusted from phone
  workspaceId: string;      // injected from meta.desktopWorkspaceId
}
```
Crucially, `writeId` lives on the relay envelope, **not** inside `args` — so domain handlers ([tasks.ts:41](packages/server-core/src/handlers/rpc/tasks.ts), [days.ts:90](packages/server-core/src/handlers/rpc/days.ts), [capture.ts:20](packages/server-core/src/handlers/rpc/capture.ts)) get unmodified inputs. The phone never supplies `workspaceId`; the relay injects `meta.desktopWorkspaceId` on receive, and the desktop bridge prepends it to `args` before `dispatch()` for handlers whose first arg is `workspaceId` (every write handler in scope today). The bridge dedupes by `writeId` before dispatching.

**`relay:snapshot`** — desktop → relay (push), relay → phone on connect.
```ts
{
  kind: 'tasks' | 'inbox' | 'day';
  key?: string;             // 'YYYY-MM-DD' for day; absent for tasks/inbox
  payload: unknown;         // the same shape `tasks:list` / `capture:list` / `days:getBoard` returns
  version: number;          // monotonic per (room, kind, key)
  capturedAt: string;
}
```

**`relay:event`** — desktop → relay → phone. Wraps a normal pushed event so phones can ack:
```ts
{ originDeviceId: string; serverSeq: number; envelope: MessageEnvelope }
```

**Unwrapping rule (both sides):**
- Desktop bridge: when `EventSink` fires for `tasks:changed` / `days:changed` / `capture:saved`, build a synthetic `MessageEnvelope { type: 'event', channel, args }` and wrap it in `relay:event` going up to the relay. Do **not** send raw `tasks:changed` envelopes — the relay only forwards `relay:*` channels to phones.
- iOS `RelayClient`: receives `relay:event`, validates `serverSeq > lastSeenSeq`, advances `lastSeenSeq`, then dispatches `envelope.channel` + `envelope.args` to `VaultStore` exactly as if the inner channel had arrived directly. Periodically (or on flush) sends `relay:ack { kind: 'event', upToSeq }`.

This is the rule that makes "iOS subscribes to `tasks:changed`" actually work — the relay never delivers `tasks:changed` directly; it always delivers `relay:event` with `tasks:changed` nested inside, and the client unwraps.

**`relay:ack`** — phone → relay (and relay → phone for write confirmations).
```ts
{ kind: 'event', upToSeq: number } | { kind: 'write', writeId: string, status: 'applied'|'rejected', error?: WireError }
```

That's it — no protocol fork, no envelope wrapper. The DO routes by URL + auth, identifies sender by socket attachment (set on accept), and forwards opaque `tasks:*`/`days:*`/`capture:*` envelopes unchanged.

### DO storage layout

- `meta` — `{ vaultName, ownerDeviceId, desktopWorkspaceId, createdAt }`. `desktopWorkspaceId` is set by the desktop bridge during its first WS handshake (it's the workspace this room represents) and is the field the relay injects into every `relay:write`. The relay rejects `relay:write` if `meta.desktopWorkspaceId` is unset.
- `devices/<deviceId>` — `{ kind: 'desktop'|'phone'|'pad', name, pairedAt, lastSeenAt, revokedAt? }`
- `snap/tasks`, `snap/days/<YYYY-MM-DD>`, `snap/inbox` — last `relay:snapshot` payload per kind+key
- `queue/<seq>` — pending phone writes (`relay:write` records); `seq` is room-scoped monotonic
- `log/<seq>` — server-stamped event log for replay (channel, args, originDeviceId, capturedAt)
- `pair/<token>` — short-lived pairing handshake state (10 min TTL)

**Replay model is the relay's own, not borrowed from `WsRpcServer`.** Local `WsRpcServer` replay is per-client, 500 events, 30s TTL, 60s disconnected retention ([server.ts:703](packages/server-core/src/transport/server.ts), [server.ts:750](packages/server-core/src/transport/server.ts)) — fine for IPC reconnects, useless for "phone foregrounded after an hour". The relay log is **room-scoped, durable, capped by count + age** (e.g. last 5000 events or 7 days, whichever is shorter). Compaction job: when log grows past cap, drop the prefix and stamp `compactedThroughSeq` in `meta`. Phone reconnects with `lastSeenSeq < compactedThroughSeq` are forced through the snapshot path instead of replay. This is the actually-correct model for an always-on relay.

### HTTP endpoints

- `POST /room/create` — **bootstrap**. No prior auth (rate-limited per IP, e.g. 5/hour). Body: `{ vaultName }`. Mints a fresh `roomId` (ULID) and a long-lived `desktopToken` (HMAC-signed by a Worker secret). Creates the DO. Returns `{ roomId, desktopToken, relayWsUrl }`. The room is empty + uninteresting until pairing happens, so unauthenticated creation is acceptable; the *desktop token* is what gates everything subsequent. The Worker secret is set in env (`wrangler secret put RELAY_HMAC_KEY`).
- `POST /pair/start` (auth: desktop bearer) → `{ pairingToken, roomId, relayUrl, expiresAt }`
- `POST /pair/complete` (no auth, one-shot pairing token) → `{ deviceId, deviceToken, roomId, relayWsUrl }`
- `POST /pair/revoke` (auth: desktop bearer) → marks device revoked; closes its WS
- `GET /v1/desktop?room=<id>` — WS upgrade (desktop bearer)
- `GET /v1/device?room=<id>&device=<id>` — WS upgrade (device bearer)

The desktop bearer and device bearer tokens are both **relay-minted** (HMAC-signed with the same Worker secret). Neither side ever signs its own credentials. This breaks the previous circular-auth design where the desktop "generated" its own token — the relay had no way to verify a token it didn't mint.

### Idempotency

Phone writes carry a UUID `writeId` on the `relay:write` envelope. On the desktop bridge, **before** calling `dispatch()`, check a per-device LRU (e.g. 1k entries, 24h TTL) keyed by `(deviceId, writeId)`; on hit, immediately echo the cached ack without re-applying. On apply, store the result. The relay also persists `(deviceId, writeId) → applied|rejected` in DO storage so a desktop restart doesn't double-apply on queue redrain.

---

## B. Desktop sync client — `packages/server-core/src/relay/` (new)

Outbound WS to the relay. Speaks the existing `MessageEnvelope` format directly — **does not wrap or extend `WsRpcClient`**, because that class deserializes envelopes raw with no hook for an outer frame ([client.ts:402](packages/server-core/src/transport/client.ts), [client.ts:416](packages/server-core/src/transport/client.ts)). Instead, build a small focused client that uses `ws` directly.

### Files

- `packages/server-core/src/relay/relay-socket.ts` — minimal outbound WS using `ws` package: connect, handshake (existing envelope shape), heartbeat, exponential reconnect (1s/2s/5s/15s/60s + jitter), `send(envelope)`/`onMessage(envelope)`. Lifts the *patterns* from `client.ts` — connection state machine, error classification — without inheriting its dispatch surface.
- `packages/server-core/src/relay/relay-bridge.ts` — bidirectional bridge:
  - **Outbound**: subscribes to the new `EventSink` hook (see Pre-work §2) and forwards every `tasks:changed`, `days:changed`, `capture:saved` to the relay as `relay:event` (assigning a fresh server-issued `serverSeq` on the relay side).
  - **Inbound writes**: receives `relay:write` envelopes; checks the dedup LRU keyed by `(deviceId, writeId)`; on miss, prepends `meta.desktopWorkspaceId` to `args` and calls `registry.dispatch(targetChannel, ctx, args)` (see Pre-work §1) with `ctx = { clientId: 'relay:'+deviceId, workspaceId: desktopWorkspaceId, webContentsId: null }`; sends `relay:ack { kind: 'write', writeId, status }` with the result.
  - **Inbound reads**: pass-through `tasks:list`/`days:getBoard`/`capture:list` requests dispatch identically (same ctx shape).
- `packages/server-core/src/relay/relay-snapshot.ts` — on connect: calls registry handlers `tasks:list`, `days:getBoard` (today and ±N days), `capture:list`; sends each as a `relay:snapshot`.

### Channels to bridge

Already defined at [packages/shared/src/protocol/channels.ts](packages/shared/src/protocol/channels.ts):

- **Push from desktop (events)**: `tasks:changed`, `days:changed`, `capture:saved`
- **Apply from phone (writes)**: `tasks:create`, `tasks:update`, `tasks:promote`, `days:moveTask`, `days:updateFile`, `days:updateTaskLists` *(needed for tray-style drag/reorder — see `electronAPI.updateDayTaskLists` call site at [DaysTrayPopover.tsx:123](apps/electron/src/renderer/days-tray/DaysTrayPopover.tsx))*, `days:pullForward`, `capture:save`, `capture:promote`, `capture:delete`
- **Read from phone**: `tasks:list`, `tasks:get`, `days:getBoard`, `days:get`, `days:list`, `days:incompleteTasks`, `capture:list`

### Wire-up point

[packages/server/src/index.ts](packages/server/src/index.ts) — after `WsRpcServer.listen()` and handler registration, start `RelayBridge` if relay config is present. Electron picks this up automatically since it embeds the same headless server.

### Config — careful: `remoteServer` is not a stub

`remoteServer` is **already active routing**, not just scaffolding. Touching it means coordinating across:
- `RemoteServerConfig` shape: [packages/core/src/types/workspace.ts:15](packages/core/src/types/workspace.ts)
- Storage helpers: `updateWorkspaceRemoteServer` and friends at [packages/shared/src/config/storage.ts:687](packages/shared/src/config/storage.ts)
- Electron preload routing that decides "is this workspace local or remote?": [apps/electron/src/transport/routed-client.ts:95](apps/electron/src/transport/routed-client.ts)
- Workspace-id mapping in routed-client (the `remoteWorkspaceId` field is read on every routed call)

**Strategy**: introduce `remoteServer.mode: 'direct' | 'relay'` as an **optional, defaulted** field (`mode ?? 'direct'` everywhere it's read), and keep the `direct` shape byte-identical to today. Relay mode adds `roomId` (replaces `remoteWorkspaceId` for relay only). `routed-client.ts` must be updated to: if `mode === 'relay'`, treat the workspace as **local** for routing purposes (because the relay is bridging the *local* server-core, not a remote one) — only `direct` mode triggers the routed-remote path.

Token at rest: Electron `safeStorage` (already used elsewhere); headless fallback file at 0600.

---

## C. iOS app — `apps/ios/` (new)

Sibling to `apps/electron/`. Xcode project; main app target + share extension target sharing an App Group container.

### Module split

- `Networking/` — `RelayClient` (URLSessionWebSocketTask), `Envelope`, `RpcCorrelator`, `Reconnector` (1s/2s/5s/15s/60s with jitter — mirror the patterns from `WsRpcClient`).
- `Models/` — Codable mirrors (snake_case via `CodingKeys`):
  - `TaskRecord`, `TaskStatus`, `TaskListKind`, `TaskPromoteTarget` ([packages/shared/src/tasks/types.ts](packages/shared/src/tasks/types.ts))
  - `DayRecord`, `DayTask`, `DaysBoardRecord` ([packages/shared/src/days/store.ts](packages/shared/src/days/store.ts))
  - `CaptureItem` ([packages/shared/src/capture/store.ts](packages/shared/src/capture/store.ts))
  - `MessageEnvelope`, `WireError`, plus the new `RelayWrite`, `RelaySnapshot`, `RelayEvent`, `RelayAck`
- `Store/` — `VaultStore` (`@MainActor ObservableObject`): board, inbox, outbox. Subscribes to `*:changed` events.
- `Persistence/` — **GRDB** SQLite at `Application Support/vault.sqlite` in an App Group container. Tables: `kv` (snapshot blobs), `outbox` (writeId, channel, JSON args, attempts, createdAt). GRDB > Core Data > raw JSON file: small, no schema migrations needed for v1, share-extension-safe.
- `Pairing/` — `QRScannerView` (AVFoundation), `PairingService`, `KeychainStore` (group access).
- `Views/` — SwiftUI screens.

### Screens (Full Days parity)

| Screen | Calls |
|---|---|
| TodayView | `days:getBoard`; subscribes `days:changed`, `tasks:changed` |
| WeekStrip (prev/today/next) | `days:list`, `days:getBoard` per date |
| NextListView, SomedayListView | derived from `DaysBoardRecord.tasks` |
| JournalView, ScratchView | `days:get` (read-only in v1; edit = v2) |
| InboxView | `capture:list`; `capture:saved` event |
| CaptureSheet | `capture:save` |
| PairingView | QR scanner → `POST /pair/complete` |
| SettingsView | unpair, room name, current device list |

Mirror the gestures from [apps/electron/src/renderer/days-tray/DaysTrayPopover.tsx](apps/electron/src/renderer/days-tray/DaysTrayPopover.tsx) (which renders the shared `TaskBoard` from `@craft-agent/ui/days`) — status cycling (`tasks:update`), drag-to-list (`days:updateTaskLists` via `updateDayTaskLists`), pull-forward (`days:pullForward`).

**Background**: foreground-only WS (sustained background WS isn't viable on iOS). On open: reconnect with the relay's seq (`relay:ack { kind:'event', upToSeq }`); if `lastSeenSeq < compactedThroughSeq`, fall through to snapshot. APNs wakeup is v2.

### Share extension

`apps/ios/VaultShareExtension/`: receives URL+title+selection from Safari/anywhere, writes a `PendingWrite` row to the shared GRDB outbox, returns immediately. Main app drains on next foreground. No WS in the extension.

---

## D. Pairing handshake

The relay mints **all** tokens. Neither side ever signs its own credentials. There are two distinct flows: **room bootstrap** (one-time, on first desktop launch with relay enabled) and **device pairing** (each time a new phone/iPad is added).

### Room bootstrap (desktop, one-time)

`apps/electron/src/main/relay/bootstrap.ts`:
1. Detect missing `remoteServer.token` for the workspace.
2. `POST /room/create` with `{ vaultName }`. No auth — rate-limited per IP. Receives `{ roomId, desktopToken, relayWsUrl }`.
3. Store `desktopToken` in Electron `safeStorage`; persist `{ mode: 'relay', url: relayWsUrl, token, roomId }` into `remoteServer` config ([storage.ts:687](packages/shared/src/config/storage.ts)).
4. Open the desktop WS — first frame after handshake is a `relay:setMeta { desktopWorkspaceId }` so the relay can populate `meta.desktopWorkspaceId` (required before any `/pair/*` will succeed).

### Device pairing (each phone)

**Desktop UI** — `apps/electron/src/main/relay/pairing.ts` + a renderer view for the QR.
1. `POST /pair/start` (auth: `desktopToken`) → `{ pairingToken, roomId, relayUrl, expiresAt }`. The relay generates `pairingToken` as a one-shot HMAC-signed value with 10-min TTL stored at `pair/<token>` in DO.
2. Show QR encoding `vault-pair://v1?relay=<urlenc>&room=<roomId>&pt=<pairingToken>&exp=<unix>&name=<vaultName>` (`qrcode` npm package — custom scheme is for QR parsing only, never opened in a browser).
3. Watch for the new device to appear via a `relay:devicePaired` event on the desktop WS; show it in the device list.

**Phone**:
1. Scan QR → parse fields.
2. `POST /pair/complete` (no auth — the one-shot `pairingToken` *is* the auth) with `{ pairingToken, deviceName: UIDevice.current.name, kind: 'phone' | 'pad' }` → `{ deviceId, deviceToken, roomId, relayWsUrl }`. Relay burns the pairing token, mints `deviceToken` HMAC-signed with the same Worker secret, writes `devices/<deviceId>` to DO storage, and pushes `relay:devicePaired` on the desktop's WS.
3. Store in iOS Keychain under service `craft.vault.relay`, account `<roomId>:<deviceId>`, with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and access group `group.<bundle>.vault` so the share extension can read it.
4. Open WS to `relayWsUrl` with `deviceToken` as bearer.

**Multi-device**: each `/pair/complete` mints a new `deviceId`. iPhone + iPad both attach naturally. **Revocation**: desktop Settings → `POST /pair/revoke { deviceId }` (auth: `desktopToken`) → DO marks `revokedAt`, closes WS, relay checks revoked status on every WS upgrade and every `relay:write` (one map lookup).

---

## Existing code to reuse / study

- WS server with reconnect/replay/heartbeat (patterns to mirror, not subclass): [packages/server-core/src/transport/server.ts](packages/server-core/src/transport/server.ts)
- WS client (patterns to mirror, but **not** wrap — see B above): [packages/server-core/src/transport/client.ts](packages/server-core/src/transport/client.ts)
- JSON envelope codec: [packages/server-core/src/transport/codec.ts](packages/server-core/src/transport/codec.ts)
- Channel registry (full set of v1 channels exists today): [packages/shared/src/protocol/channels.ts](packages/shared/src/protocol/channels.ts)
- Domain types (1:1 Swift `Codable` mirrors): [packages/shared/src/tasks/types.ts](packages/shared/src/tasks/types.ts), [packages/shared/src/days/store.ts](packages/shared/src/days/store.ts), [packages/shared/src/capture/store.ts](packages/shared/src/capture/store.ts)
- RPC handlers the relay-bridge will dispatch into: [packages/server-core/src/handlers/rpc/days.ts](packages/server-core/src/handlers/rpc/days.ts), [tasks.ts](packages/server-core/src/handlers/rpc/tasks.ts), [capture.ts](packages/server-core/src/handlers/rpc/capture.ts)
- Reference UX for phone-shaped interactions: [apps/electron/src/renderer/days-tray/](apps/electron/src/renderer/days-tray/)
- Existing remote-server config (must extend without breakage): [packages/shared/src/config/storage.ts:687](packages/shared/src/config/storage.ts), [packages/core/src/types/workspace.ts:15](packages/core/src/types/workspace.ts), [apps/electron/src/transport/routed-client.ts:95](apps/electron/src/transport/routed-client.ts)

---

## Build order

1. **Pre-work refactors** (server-core): public dispatch + `onPush` hook. One PR, with tests.
2. **Relay protocol definition**: add `relay:*` channels to [protocol/channels.ts](packages/shared/src/protocol/channels.ts); define types for `RelayWrite`, `RelaySnapshot`, `RelayEvent`, `RelayAck`. Pure types PR — no runtime.
3. **Relay skeleton** — `apps/relay/` with `POST /room/create`, the room-mint flow, DO + WS upgrade + pairing HTTP. Proxying envelopes blindly between desktop and phone is enough at this step. Test with two `wscat` clients (one as desktop, one as phone).
4. **Minimal snapshot + queue in DO** *(moved earlier — required for the "Mac asleep" milestone)*: persist `relay:snapshot` payloads, serve them inline on phone connect, persist `relay:write` queue with idempotency, persist `meta.desktopWorkspaceId` set via `relay:setMeta`. Without this, iOS read parity can't be tested when the desktop is offline, which is the headline feature.
5. **Desktop sync client** — `relay-socket.ts` + `relay-bridge.ts`, pushes initial snapshot, forwards `*:changed` via `onPush`, applies incoming `relay:write`s via `registry.dispatch()`. Test against `wscat` as fake phone, then against the DO.
6. **iOS pairing** — Xcode project; QR scan, Keychain store, open WS, complete handshake. Smallest "hello, room name" milestone.
7. **iOS Days screens** — read-only Today + Week + Next + Someday + Inbox, served from the DO snapshot (works with desktop offline).
8. **iOS writes + outbox** — task check-off, move (`days:moveTask`), reorder (`days:updateTaskLists`), capture from inside app; idempotency via `writeId` on the relay envelope.
9. **Share extension** — Safari URL → outbox.
10. **Revocation UI on desktop**.

---

## v2 (out of scope, called out so we don't drift)

Journal/scratch editing with conflict UI, R2 for large day-history snapshots, APNs wakeup → live updates while backgrounded, E2E encryption, multi-workspace, watchOS, iCloud Keychain pairing sync.

---

## Open questions / spike before locking design

- **Cloudflare DO Hibernation cost** with always-on desktop pinging every 30s. The DO-with-WebSocket shape is supported and recommended ([Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Hibernation example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)) — but hibernation only saves idle duration *after handlers complete*; active pings/messages still wake the object. One-day spike to measure billable wall-time before locking design. Mitigation if costly: 5-min desktop heartbeat + TCP keepalive instead of app-level ping at 30s.
- **Pre-work option choice**: extracted `RpcHandlerRegistry` (cleaner, more refactor) vs. public `WsRpcServer.dispatch()` (smaller, leaves `WsRpcServer` doing more). Read [server.ts:189](packages/server-core/src/transport/server.ts) `push()` and [server.ts:626](packages/server-core/src/transport/server.ts) `onRequest()` to decide.
- **`routed-client.ts` semantics under relay mode**: confirm that treating relay-mode workspaces as *local* in the Electron preload is right (local-server-core is the truth; the relay is just a bridge). [apps/electron/src/transport/routed-client.ts:95](apps/electron/src/transport/routed-client.ts).

---

## Verification

End-to-end happy path before declaring v1 done:
1. **Pairing**: Desktop UI shows QR → phone scans → device appears in desktop's device list within 5s.
2. **Read parity (Mac offline)**: Toggle Mac to airplane mode. Phone still loads Today + Next + Someday from the relay snapshot. Toggle back; no errors. *(Tested at step 7 in build order, not step 10.)*
3. **Write replay**: Mac asleep → phone checks off a Today task → reopen Mac → task is checked off in `days/{date}/tasks.md` and the desktop UI within 10s. Outbox empty on phone.
4. **Capture from Safari**: Phone share extension → URL → reopen Mac → file appears in `inbox/`.
5. **Reconnect replay (short gap)**: Phone offline 60s during a desktop edit → phone reconnects → live state matches desktop without a manual refresh.
6. **Reconnect replay (long gap, past `compactedThroughSeq`)**: Phone offline 24h → reconnects → relay forces snapshot path; UI catches up without showing stale state.
7. **Idempotency**: Force-kill the desktop while a write is in flight; relaunch; same `writeId` does not double-apply (verify by reading the markdown file before/after).
8. **Revocation**: Unpair phone from desktop Settings → phone WS closes within 5s; further requests rejected.
9. **Tests**:
   - server-core refactors: round-trip `dispatch()` matches WS path; `onPush` callback receives identical events to live clients (`packages/server-core/src/transport/__tests__/`).
   - Relay: unit tests for pairing, dedup, queue replay, compaction (`apps/relay/src/__tests__/`).
   - Desktop bridge: `packages/server-core/src/relay/__tests__/` with a fake-WS relay double.
   - iOS: XCTest for `Models` Codable round-trip vs. fixture JSON copied from server-side handler outputs; integration tests against a local mock relay.
