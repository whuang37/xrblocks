# netblocks

> Multiplayer XR for [xrblocks](https://github.com/google/xrblocks).

`netblocks` is a batteries-included addon that turns any xrblocks app into a
shared, real-time XR experience. It gives you:

- 👥 **Presence** — see other users' heads (and hands when they're in XR
  with hand tracking) as live avatars,
  with an SDF name label floating above each one.
- 📦 **Shared objects** — `NetObject` syncs `position`/`quaternion`/`scale`
  with cooperative ownership (claim on grab, release on drop).
- 📨 **Typed events** — `session.events.emit('chat', payload)` style RPC.
- 🎙️ **Spatial voice** — opt-in WebRTC audio that pans with each peer's head.
- 🔌 **Pluggable transports** — pick the right one for your environment:
  - `BroadcastChannelTransport` — zero-config, two browser tabs see each
    other instantly. Perfect for local dev.
  - `WebRTCTransport` — peer-to-peer over the public PeerJS broker (or
    your own); no backend, low latency, ≤ ~12 peers.
  - `WebSocketTransport` — connect to a tiny relay (`server/relay.js`)
    for reliable, scalable multi-user rooms.

The whole system is one mental model: **a `Transport` moves opaque bytes
between peers; a `NetSession` layers presence, RPC, replicated objects, and
voice on top.** Swap transports without changing app code.

---

## Quick start

```ts
import * as xb from 'xrblocks';
import {
  NetCore,
  BroadcastChannelTransport,
} from 'xrblocks/addons/netblocks/src';

class MyApp extends xb.Script {
  net = new NetCore(this);

  async init() {
    const session = await this.net.joinRoom('my-room', {
      transport: new BroadcastChannelTransport(),
      displayName: 'Alice',
    });

    session.events.on('chat', (text, fromPeerId) => {
      console.log(`${fromPeerId}: ${text}`);
    });
  }

  update(time, frame) {
    this.net.update(time, frame);
  }
}

xb.add(new MyApp());
xb.init();
```

Open the same page in two browser tabs and you'll instantly see the other
tab's head rendered as a colored ball-and-stick avatar with a name label
hovering above it. Open the page in XR with hand tracking and the avatar
also gets two stick-figure hands.

---

## Porting an existing xrblocks sample to multiplayer

Adding netblocks to an existing scene is small. The pattern is:

1. Construct a `NetCore` as a child of your root `xb.Script`.
2. `await net.joinRoom(...)` in `init()`.
3. Call `net.update(t, frame)` from your `update()`.

That's enough to get remote head/hand avatars rendered into your scene. From
there you wrap any `Object3D` you want shared in a `NetObject` and add it to
`net.session.netObjects`, and use `net.session.events` for chat / cursor
pings / button presses.

Concretely, taking the standard xb starter:

```diff
 import * as xb from 'xrblocks';
+import {NetCore, WebRTCTransport} from 'xrblocks/addons/netblocks/src/index.js';

 class App extends xb.Script {
   cube = new THREE.Mesh(/* ... */);
+  net = new NetCore(this);
+  sharedCube = new NetObject({id: 'cube', object: this.cube});

   async init() {
     this.add(this.cube);
+    await this.net.joinRoom('demo', {
+      transport: new WebRTCTransport(),
+      displayName: 'Alice',
+    });
+    this.net.session?.netObjects.add(this.sharedCube);
   }

-  update(t, frame) {}
+  update(t, frame) {
+    this.net.update(t, frame);
+  }
 }
```

That's it — open the page in two tabs and dragging the cube in one tab moves
it in the other. Add `events.on('chat', cb)` for typed RPC, or
`net.session?.voice.enable()` for spatial voice. See `samples/integration/`
for a fully wired example.

---

## Concepts

### NetCore

The single facade you instantiate per app. Holds the active `NetSession`
and exposes `joinRoom`, `leaveRoom`, and `update`.

### NetSession

The brain. Owns the transport, dispatches inbound messages to subsystems,
and broadcasts outbound presence + object updates each frame. You'll
mostly interact with `session.events`, `session.users`, and
`session.createNetObject()`.

### NetUser

Per-peer state — `peerId`, `displayName`, `avatar` (a
`RemoteUserAvatar` `THREE.Group`), and `lastSeenMs`. Iterate via
`session.users`.

### Transport

A `Transport` is just **send bytes** + **peer-join/leave/message events**.
Implement your own (e.g., to plug into a Liveblocks room or a Unity bridge)
by extending the `Transport` base class.

### NetObject

A `THREE.Group` whose transform is replicated on a fixed cadence (default
20 Hz). Owners broadcast; non-owners interpolate. Ownership is cooperative
— call `session.claim(obj)` on grab and `session.release(obj)` on drop.
The protocol is race-aware: stale transforms from a previous owner are
ignored after a claim, releases include a final canonical xform so all
peers converge on the same resting position, and the sample shows how a
grabber that loses ownership mid-drag should drop its local override.

### NetEvents

A typed pub/sub bus over the wire. `events.on(topic, handler)`,
`events.emit(topic, payload)`, `events.emitTo(peerId, topic, payload)`.
Use this for chat, button presses, emoji bursts, cursor pings — anything
that isn't a recurring transform.

### VoiceChat + SpatialVoice

WebRTC audio that piggybacks on the **active transport** for signaling
(SDP/ICE flow as `voice` messages over whatever NetSession is using —
BroadcastChannel, WebSocket, or WebRTC data channels). Audio itself
always flows directly between browsers over a dedicated WebRTC peer
connection, parented to each peer's `headPivot` via
`THREE.PositionalAudio` so it spatializes naturally. Enable via
`{voice: true}` in `joinRoom()` or `session.voice.enable(...)` later.

---

## Transports in detail

### BroadcastChannelTransport

Same-origin, same-machine, zero infrastructure. Perfect for local
development and for QA-ing UX without juggling two devices.

```ts
new BroadcastChannelTransport();
```

### WebRTCTransport

Peer-to-peer using the public PeerJS broker for signaling. Audio and data
flow directly between browsers, so latency is excellent. Limitations:

- The public broker is best-effort and rate-limits aggressive reconnects;
  supply your own `signalingUrl` (`npx peerjs --port 9000`) for anything
  beyond local demos.
- Without TURN, NAT traversal can fail across some networks. Pass
  `iceServers` to add TURN.
- Full mesh with a 12-slot pool — best for ≤ 12 participants.

```ts
new WebRTCTransport({
  iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    // {urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p'},
  ],
});
```

### WebSocketTransport

Connects to a small relay server included in the addon
(`server/relay.js`). Run it with:

```sh
npm i ws
node node_modules/xrblocks/build/addons/netblocks/server/relay.js
# or, in this repo: node src/addons/netblocks/server/relay.js
```

Then point the client at it:

```ts
new WebSocketTransport({url: 'ws://localhost:8765'});
```

The relay is dumb fan-out — under 200 LOC, no auth, no persistence. For
production, add auth in front (e.g., reverse-proxy with an ID token check)
and consider adding rate-limiting.

---

## Wire protocol

All messages are JSON envelopes carrying a tagged union:

| `type`              | Direction     | Purpose                                            |
| ------------------- | ------------- | -------------------------------------------------- |
| `hello`             | broadcast     | Announce capabilities + display name on join.      |
| `welcome`           | unicast       | Bring a new peer up to speed on existing peers.    |
| `bye`               | broadcast     | Graceful leave.                                    |
| `pose`              | broadcast     | Compact binary head + hands snapshot (base64).     |
| `netobject`         | broadcast     | Replicated transform + optional state for one obj. |
| `netobject.claim`   | broadcast     | Request ownership of a NetObject.                  |
| `netobject.release` | broadcast     | Drop ownership of a NetObject.                     |
| `rpc`               | uni/broadcast | Typed pub/sub event.                               |
| `voice`             | unicast       | WebRTC SDP/ICE for spatial voice negotiation.      |
| `ping` / `pong`     | reserved      | Keepalive (currently unused).                      |

Pose snapshots are encoded as a fixed 386-byte binary blob (head pose +
two hands × 25 quantized joints) wrapped in base64 inside the JSON
envelope. See `src/core/codec/PoseCodec.ts` for the byte layout.

---

## Samples

See [`samples/SAMPLES.md`](./samples/SAMPLES.md). Highlights:

- `samples/basic/presence` — see remote heads (and hands in XR with hand
  tracking).
- `samples/basic/objects` — drag a shared cube; ownership transfers on grab.
- `samples/basic/events` — broadcast emoji bursts via the RPC bus.
- `samples/basic/voice` — push-to-talk spatial voice chat. WASD/mouse
  (or gamepad sticks) to walk around in 2D; the headset's pose drives
  it in XR.
- `samples/basic/transports` — switch transports at runtime.
- `samples/netblocks/` — assembled "shared room" demo combining
  presence + objects + chat + emoji-burst RPC + voice. (Top-level
  headline sample.)

---

## Design choices and trade-offs

- **Cooperative ownership over server authority.** netblocks does not assume
  a backend — most setups use peer-to-peer or a dumb relay. We resolve
  conflicts by preferring the lower peer id on race, which is good enough
  for pickup-and-throw semantics. For competitive/anti-cheat workloads,
  add a server-authoritative arbiter on top of the same protocol.
- **JSON envelopes, binary pose payloads.** JSON keeps the protocol
  introspectable (open dev-tools and read traffic) without sacrificing
  pose bandwidth — pose is the only frame we send at frame-rate, so we
  spend the complexity budget there.
- **Fixed 20 Hz pose / object updates.** Tunable, but defaults work for
  every browser/device combination we tested. Avatars use lerp/slerp
  smoothing so 20 Hz looks like 60 Hz.
- **No CRDT.** Shared documents are out of scope. If you need them, layer
  Yjs or Automerge on top of `session.events.emit('crdt-update', ...)`.
