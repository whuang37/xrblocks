/**
 * NetSession: the orchestrator that lives between a Transport and the rest
 * of netblocks. Responsibilities:
 *
 *   - Wraps a Transport, owns the local peer id, and maintains a Map of
 *     active NetUsers.
 *   - Encodes every outbound NetMessage (adding `from`, `ts`) and decodes
 *     every inbound payload, dispatching to:
 *       * PresenceBroadcaster (outbound pose)  / pose buffer per NetUser (inbound)
 *       * NetEvents bus (typed RPC)
 *       * NetObjectRegistry (replicated transforms + ownership)
 *       * VoiceChat (out-of-band SDP/ICE signaling)
 *   - Per-frame `update()` drives presence broadcasting, smooth interpolation
 *     of remote avatars and net objects, and broadcasting transforms for
 *     locally-owned net objects.
 *   - Emits high-level events (`user-join`, `user-leave`) for the host app.
 *
 * The root xrblocks `Script` passed in is used purely as a scene-graph
 * mount point for remote avatars; netblocks never manipulates the host
 * script's properties.
 */
import * as THREE from 'three';
import * as xb from 'xrblocks';

import {
  decodeMessage,
  encodeMessage,
  HelloMessage,
  NetMessage,
  PeerCapabilities,
  RpcMessage,
  VoiceSignalMessage,
  WelcomeMessage,
} from './codec/MessageCodec';
import {base64ToBytes, decodePose} from './codec/PoseCodec';
import {
  DEFAULT_NETOBJECT_HZ,
  NET_PROTOCOL_VERSION,
} from './constants/NetConstants';
import {NetObject} from './objects/NetObject';
import {NetObjectRegistry} from './objects/NetObjectRegistry';
import {NetUser} from './NetUser';
import {PresenceBroadcaster} from './presence/PresenceBroadcaster';
import {NetEvents} from './rpc/NetEvents';
import {
  Transport,
  TransportMessageEventDetail,
  TransportPeerEventDetail,
} from './transport/Transport';
import {SpatialVoice} from './voice/SpatialVoice';
import {VoiceChat} from './voice/VoiceChat';

export interface NetSessionOptions {
  /** Display name announced to other peers. */
  displayName?: string;
  /** Override the presence broadcast frequency in Hz (default: 20). */
  presenceHz?: number;
  /** Override the netobject broadcast frequency in Hz (default: 20). */
  netObjectHz?: number;
  /** Whether to enable voice chat at session start. Defaults to false. */
  voice?: boolean;
}

export type NetSessionEventName =
  | 'open'
  | 'close'
  | 'user-join'
  | 'user-leave'
  | 'voice-state';

export interface UserEventDetail {
  user: NetUser;
}

const DEFAULT_CAPABILITIES: PeerCapabilities = {
  pose: true,
  voice: true,
  netobject: true,
};

export class NetSession extends EventTarget {
  readonly transport: Transport;
  readonly events: NetEvents;
  readonly netObjects = new NetObjectRegistry();
  readonly presence: PresenceBroadcaster;
  readonly voice: VoiceChat;

  private _root: THREE.Object3D;
  private _users = new Map<string, NetUser>();
  /**
   * Tracks users we created from a non-hello first message. We defer
   * `user-join` until either their hello arrives (so the listener sees a
   * populated displayName) or a small grace window elapses.
   */
  private _pendingJoinTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _opts: Required<
    Pick<NetSessionOptions, 'presenceHz' | 'netObjectHz' | 'voice'>
  > &
    NetSessionOptions;
  private _spatialVoice?: SpatialVoice;
  private _isOpen = false;
  private _capabilities = {...DEFAULT_CAPABILITIES};

  constructor(
    transport: Transport,
    root: THREE.Object3D,
    opts: NetSessionOptions = {}
  ) {
    super();
    this.transport = transport;
    this._root = root;
    this._opts = {
      presenceHz: opts.presenceHz ?? 20,
      netObjectHz: opts.netObjectHz ?? DEFAULT_NETOBJECT_HZ,
      voice: opts.voice ?? false,
      displayName: opts.displayName,
    };
    this.presence = new PresenceBroadcaster(
      (msg) => this._sendNet(msg),
      this._opts.presenceHz
    );
    this.events = new NetEvents((msg) => this._sendNet(msg));
    this.voice = new VoiceChat((msg) => this._sendNet(msg));
    this.voice.onTrack((peerId, stream) => this._onVoiceTrack(peerId, stream));
    this.voice.onTrackRemoved((peerId) => this._spatialVoice?.detach(peerId));

    this.transport.addEventListener('peer-join', (e) =>
      this._onPeerJoin(
        (e as CustomEvent<TransportPeerEventDetail>).detail.peerId
      )
    );
    this.transport.addEventListener('peer-leave', (e) =>
      this._onPeerLeave(
        (e as CustomEvent<TransportPeerEventDetail>).detail.peerId
      )
    );
    this.transport.addEventListener('message', (e) =>
      this._onMessage((e as CustomEvent<TransportMessageEventDetail>).detail)
    );
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  get localPeerId(): string {
    return this.transport.localPeerId;
  }

  get users(): ReadonlyMap<string, NetUser> {
    return this._users;
  }

  /** Connect the underlying transport and announce ourselves. */
  async open(roomId: string): Promise<void> {
    await this.transport.connect({roomId});
    this._isOpen = true;
    this.voice.setLocalPeerId(this.transport.localPeerId);

    // Lazy-init spatial voice (needs a camera; safe to skip if none yet).
    const cam = xb.core?.camera;
    if (cam && !this._spatialVoice) this._spatialVoice = new SpatialVoice(cam);

    // Greet every peer already known.
    const hello: HelloMessage = {
      type: 'hello',
      protocol: NET_PROTOCOL_VERSION,
      displayName: this._opts.displayName,
      capabilities: this._capabilities,
    };
    this._sendNet(hello);

    if (this._opts.voice) {
      try {
        await this.voice.enable(this.transport.remotePeerIds);
      } catch (err) {
        console.warn('[netblocks] voice.enable() failed:', err);
      }
    }
    this.dispatchEvent(new Event('open'));
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._sendNet({type: 'bye'});
    this.voice.disable();
    this.transport.close();
    for (const t of this._pendingJoinTimers.values()) clearTimeout(t);
    this._pendingJoinTimers.clear();
    for (const [, user] of this._users) {
      this.netObjects.releaseOwnedBy(user.peerId);
      user.dispose();
    }
    this._users.clear();
    this.dispatchEvent(new Event('close'));
  }

  /** Register an existing NetObject so its transform is replicated. */
  addNetObject(obj: NetObject): void {
    if (!obj.ownerId) obj.ownerId = this.localPeerId;
    this.netObjects.add(obj);
  }

  /** Convenience: create + auto-add a NetObject parented to `root`. */
  createNetObject(
    opts?: ConstructorParameters<typeof NetObject>[0]
  ): NetObject {
    const obj = new NetObject(opts);
    obj.ownerId = obj.ownerId || this.localPeerId;
    this.netObjects.add(obj);
    this._root.add(obj);
    return obj;
  }

  removeNetObject(obj: NetObject): void {
    this.netObjects.remove(obj);
    obj.parent?.remove(obj);
  }

  /** Claim ownership of an object (e.g., on grab). */
  claim(obj: NetObject): void {
    if (this.netObjects.applyClaim(obj.netId, this.localPeerId)) {
      this._sendNet({type: 'netobject.claim', id: obj.netId});
    }
  }

  /** Release ownership of an object (e.g., on release). */
  release(obj: NetObject): void {
    if (this.netObjects.applyRelease(obj.netId, this.localPeerId)) {
      // Send a final canonical xform before relinquishing ownership so any
      // peer whose interpolation hadn't converged snaps to the same resting
      // position; otherwise tabs can be left showing the cube in different
      // places when both peers stop dragging at the same time.
      this._sendNet({
        type: 'netobject',
        id: obj.netId,
        xform: obj.toXform(),
        state: Object.keys(obj.state).length ? obj.state : undefined,
      });
      this._sendNet({type: 'netobject.release', id: obj.netId});
    }
  }

  /** Per-frame tick. Call from the host xb.Script's `update()`. */
  update(_time?: number, _frame?: XRFrame): void {
    if (!this._isOpen) return;
    const now = performance.now();

    // Outbound presence.
    this.presence.update(now);

    // Smooth remote avatars.
    for (const [, user] of this._users) {
      user.avatar.applyPose(now);
    }

    // Replicated objects.
    const period = 1000 / this._opts.netObjectHz;
    for (const obj of this.netObjects.values()) {
      if (obj.ownerId === this.localPeerId) {
        if (now - obj._lastSendMs >= period) {
          obj._lastSendMs = now;
          this._sendNet({
            type: 'netobject',
            id: obj.netId,
            xform: obj.toXform(),
            state: Object.keys(obj.state).length ? obj.state : undefined,
          });
        }
      } else if (obj.ownerId && obj._hasTarget) {
        // Only interpolate when a remote peer owns the object. If no
        // one owns it (post-release), leave the cube where the last
        // owner put it — otherwise we'd drift back toward a stale
        // target buffered from before the most recent claim.
        // ~12 Hz convergence per second of dt; we don't have dt here so use a
        // fixed fraction tuned for 60+ fps host applications.
        obj.stepInterpolation(0.2);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: send / dispatch / lifecycle
  // -----------------------------------------------------------------------

  private _sendNet(msg: NetMessage): void {
    if (!this.transport.isOpen) return;
    msg.from = this.localPeerId;
    msg.ts = msg.ts ?? performance.now();
    const bytes = encodeMessage(msg);
    if (msg.to) {
      this.transport.send(bytes, msg.to);
    } else {
      this.transport.send(bytes);
    }
  }

  private _onPeerJoin(peerId: string): void {
    // We defer creating a NetUser (and dispatching `user-join`) until the
    // first message arrives — typically a hello carrying their display name.
    // This keeps the public event clean: by the time a listener fires, the
    // user object has its display name and capabilities populated.
    // Re-introduce ourselves so the new peer learns our capabilities.
    this._sendNet({
      type: 'hello',
      protocol: NET_PROTOCOL_VERSION,
      displayName: this._opts.displayName,
      capabilities: this._capabilities,
      to: peerId,
    } as HelloMessage);
    this.voice.notifyPeerJoined(peerId);
  }

  private _onPeerLeave(peerId: string): void {
    const pending = this._pendingJoinTimers.get(peerId);
    if (pending !== undefined) {
      clearTimeout(pending);
      this._pendingJoinTimers.delete(peerId);
    }
    const user = this._users.get(peerId);
    if (!user) return;
    this.netObjects.releaseOwnedBy(peerId);
    this.voice.notifyPeerLeft(peerId);
    this._spatialVoice?.detach(peerId);
    user.dispose();
    this._users.delete(peerId);
    this.dispatchEvent(
      new CustomEvent<UserEventDetail>('user-leave', {detail: {user}})
    );
  }

  private _onMessage(detail: TransportMessageEventDetail): void {
    let msg: NetMessage;
    try {
      msg = decodeMessage(detail.data);
    } catch (err) {
      console.warn('[netblocks] failed to decode message:', err);
      return;
    }
    msg.from = msg.from ?? detail.peerId;
    if (msg.from === this.localPeerId) return; // ignore loopback
    let user = this._users.get(msg.from);
    if (!user) {
      const initialDisplayName =
        msg.type === 'hello' ? msg.displayName : undefined;
      const initialCapabilities =
        msg.type === 'hello' ? msg.capabilities : {...DEFAULT_CAPABILITIES};
      user = new NetUser(msg.from, initialCapabilities, initialDisplayName);
      user.avatar.displayName = user.displayName;
      this._users.set(msg.from, user);
      this._root.add(user.avatar);
      if (msg.type === 'hello') {
        this.dispatchEvent(
          new CustomEvent<UserEventDetail>('user-join', {detail: {user}})
        );
      } else {
        // Defer dispatch: a hello is almost certainly already in flight from
        // the remote's `_onPeerJoin` handler. Wait briefly so listeners see a
        // populated displayName. If it never arrives, dispatch anyway.
        const peerId = msg.from;
        const dispatchUser = user;
        const timer = setTimeout(() => {
          if (this._pendingJoinTimers.delete(peerId)) {
            this.dispatchEvent(
              new CustomEvent<UserEventDetail>('user-join', {
                detail: {user: dispatchUser},
              })
            );
          }
        }, 1500);
        this._pendingJoinTimers.set(peerId, timer);
      }
    }
    user.lastSeenMs = performance.now();

    switch (msg.type) {
      case 'hello': {
        user.displayName = msg.displayName ?? user.displayName;
        user.capabilities = msg.capabilities;
        user.avatar.displayName = user.displayName;
        // Flush any deferred user-join now that we have the displayName.
        const pending = this._pendingJoinTimers.get(msg.from);
        if (pending !== undefined) {
          clearTimeout(pending);
          this._pendingJoinTimers.delete(msg.from);
          this.dispatchEvent(
            new CustomEvent<UserEventDetail>('user-join', {detail: {user}})
          );
        }
        // Reply with a welcome containing the rooms's known peer list.
        this._sendNet({
          type: 'welcome',
          to: msg.from,
          peers: [...this._users.values()].map((u) => ({
            id: u.peerId,
            displayName: u.displayName,
            capabilities: u.capabilities,
          })),
        } as WelcomeMessage);
        break;
      }
      case 'welcome':
        for (const p of msg.peers) {
          if (p.id === this.localPeerId) continue;
          let other = this._users.get(p.id);
          if (!other) {
            other = new NetUser(p.id, p.capabilities, p.displayName);
            this._users.set(p.id, other);
            this._root.add(other.avatar);
            this.dispatchEvent(
              new CustomEvent<UserEventDetail>('user-join', {
                detail: {user: other},
              })
            );
          } else {
            other.displayName = p.displayName ?? other.displayName;
            other.capabilities = p.capabilities;
            other.avatar.displayName = other.displayName;
          }
        }
        break;
      case 'bye':
        this._onPeerLeave(msg.from);
        break;
      case 'pose':
        try {
          const snap = decodePose(base64ToBytes(msg.data));
          user.avatar.pose.push(snap, msg.ts ?? performance.now());
        } catch (err) {
          console.warn('[netblocks] failed to decode pose:', err);
        }
        break;
      case 'netobject': {
        const obj = this.netObjects.get(msg.id);
        if (!obj) break;
        // If we both think we own it (e.g., both peers auto-owned the same
        // deterministic id at create-time), the lex-smaller peer id wins —
        // matches the explicit-claim tiebreak in NetObjectRegistry.
        if (obj.ownerId === this.localPeerId && msg.from < this.localPeerId) {
          obj.ownerId = msg.from;
        }
        if (obj.ownerId !== this.localPeerId) {
          // Only accept xform updates from the current owner. A netobject
          // message from anyone else is necessarily stale (in-flight from
          // a previous owner whose release/claim has since been processed)
          // and applying it would lerp the object back to an old position.
          if (obj.ownerId && msg.from !== obj.ownerId) {
            break;
          }
          obj.setTargetXform(msg.xform);
          if (msg.state) Object.assign(obj.state, msg.state);
        }
        break;
      }
      case 'netobject.claim':
        this.netObjects.applyClaim(msg.id, msg.from);
        break;
      case 'netobject.release':
        this.netObjects.applyRelease(msg.id, msg.from);
        break;
      case 'rpc':
        this.events._dispatch(msg as RpcMessage);
        break;
      case 'voice':
        void this.voice.handleSignal(msg.from, msg as VoiceSignalMessage);
        break;
      case 'ping':
      case 'pong':
        // Reserved for future keepalive use.
        break;
    }
  }

  private _onVoiceTrack(peerId: string, stream: MediaStream): void {
    if (!this._spatialVoice) {
      const cam = xb.core?.camera;
      if (cam) this._spatialVoice = new SpatialVoice(cam);
    }
    const user = this._users.get(peerId);
    if (!this._spatialVoice || !user) return;
    this._spatialVoice.attach(peerId, user.avatar.headPivot, stream);
    this.dispatchEvent(
      new CustomEvent('voice-state', {detail: {peerId, on: true}})
    );
  }
}
