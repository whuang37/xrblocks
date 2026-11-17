---
title: Build a shared spatial experience
slug: /examples/shared-experience
sidebar_position: 4
---

# Build a shared spatial experience

Start with two tabs sharing presence and one movable object. Use a local
transport first so networking-service setup does not obscure application state.

## Run a complete shared-object example

[Open shared objects](https://xrblocks.github.io/demos/netblocks/basic/objects/) in two tabs on the
same origin. The [HTML](https://github.com/google/xrblocks/blob/main/demos/netblocks/basic/objects/index.html) loads
the [application source](https://github.com/google/xrblocks/blob/main/demos/netblocks/src/objects.ts).
The example uses the Netblocks addon; its
[existing README](https://github.com/google/xrblocks/blob/main/src/addons/netblocks/README.md) owns transport setup.

## Compose the parts

`enableNet()` attaches networking to the SDK frame loop. Join a room with a
transport, give each peer a display name, and register a `NetObject` with a
stable shared ID for the object both peers should see. Ownership lets a peer
claim the object during manipulation and release it afterward.

A `BroadcastChannelTransport` connects tabs locally. WebRTC and WebSocket paths
need their corresponding signaling/relay setup. Changing transport does not
make differently initialized application scenes equivalent.

## Define a shared coordinate policy

Matching position numbers do not align two physical rooms. For the two-tab test,
both peers can use the same simulator environment and starting frame. Native
co-location needs an explicit alignment/calibration or shared-anchor strategy
that the application and devices support. Do not promise automatic alignment
from state replication alone.

## Verify and clean up

Move the object in each tab and inspect the other tab's result. Try simultaneous
grabs, release ownership, disconnect a peer, and rejoin. Keep shared IDs and
initial state deterministic. Use the networking owner's `leaveRoom()` when the
app stops participating, and release app listeners/resources.

For a larger composition, see [Roomcraft collaboration](https://github.com/google/xrblocks/tree/main/demos/roomcraft-collab)
and its [source documentation](https://github.com/google/xrblocks/blob/main/src/addons/roomcraft/README.md).

[Coordinates](/sdk/coordinates) · [Interaction](/sdk/interaction) ·
[Setup guides](/integrations) · [Verification](/sdk/verification)
