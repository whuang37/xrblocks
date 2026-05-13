import * as THREE from 'three';
import * as xb from 'xrblocks';
import {Keyboard} from 'xrblocks/addons/virtualkeyboard/Keyboard.js';
import {BroadcastChannelTransport, NetObject} from 'netblocks';
import {NetSample} from '../Sample';

/**
 * IntegrationSample.
 *
 * The "shared room" demo. Combines every netblocks subsystem in a
 * single page so you can stand in a room with another tab and:
 *   - see each other as live ball-and-stick avatars (presence)
 *   - grab and toss shared cubes (NetObjects with cooperative ownership)
 *   - chat over the typed events bus
 *   - hear each other spatialized via WebRTC voice
 *
 * Movement, look, and the on-screen reticle come from the standard
 * xrblocks SimulatorControls (see google/xrblocks#262). The chat input
 * flips `xb.core.simulator.controls.enabled` on focus so typing doesn't
 * walk the avatar around — same pattern the chat sample uses. Each cube
 * is tagged `draggable` so the platform's built-in DragManager handles
 * translation; we only intercept `selectstart`/`selectend` to call
 * `session.claim()` / `session.release()` so the network knows who owns
 * what.
 */
const NUM_CUBES = 4;
const CUBE_COLORS = [0x9177c7, 0x7ac0ff, 0xffb86b, 0x7be3a4];

interface ChatPayload {
  from: string;
  text: string;
  ts: number;
}

class IntegrationSample extends NetSample {
  private _displayName = `User-${Math.floor(Math.random() * 1000)}`;
  private _cubes: NetObject[] = [];
  private _drag: {
    cube: NetObject;
    // Distance from the input source (camera for mouse, controller
    // origin for XR) to the drop target plane.
    distance: number;
    // Offset from the cursor/ray-projected world point to the cube
    // world position at drag-start, so the cube doesn't snap.
    offset: THREE.Vector3;
    // null = mouse drag, otherwise the XR controller object.
    controller: THREE.Object3D | null;
  } | null = null;
  private _voiceOn = false;
  private _log?: HTMLDivElement;
  private _chatPanel?: HTMLDivElement;
  private _spatialLog?: xb.ScrollingTroikaTextView;
  private _spatialLogLines: string[] = [];
  private _spatialVoiceBtn?: xb.TextButton;
  private _spatialDraft?: xb.TextView;
  private _keyboard?: Keyboard;
  // Last canvas-relative pointer position (NDC space), used to bypass
  // the platform mouse raycaster (which has been returning intersections
  // mirrored around the origin in this sample) and pick cubes ourselves
  // off the camera + cursor directly. -2 is a sentinel meaning "no event
  // received yet" so we don't fire phantom hits at frame 0.
  private _ndc = new THREE.Vector2(-2, -2);
  private _mouseDown = false;
  private _mouseRaycaster = new THREE.Raycaster();

  protected getJoinOptions() {
    return {
      roomId: 'netblocks-sample-integration',
      options: {
        transport: new BroadcastChannelTransport(),
        displayName: this._displayName,
      },
    };
  }

  protected onSession(session: NonNullable<this['net']['session']>) {
    this._spawnCubes(session);
    this._wireMouse();
    this._buildChatPanel(session);
    this._buildVoiceButton(session);
    this._buildSpatialHud(session);
  }

  // Track the canvas-relative cursor in NDC and our own mousedown
  // boolean. We intentionally don't rely on MouseController.userData
  // .selected for the mouse path because the platform's
  // setRaycasterFromController has been returning mirrored intersection
  // points for the simulator mouse in this sample.
  private _wireMouse() {
    const canvas = xb.core?.renderer?.domElement;
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this._ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1)
      );
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      onMove(e);
      this._mouseDown = true;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this._mouseDown = false;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
  }

  override update(time?: number, frame?: XRFrame) {
    super.update(time, frame);
    const session = this.net.session;
    if (session) this._tickDrag(session);
  }

  // ---- Shared cubes ------------------------------------------------------

  private _spawnCubes(session: NonNullable<this['net']['session']>) {
    // Lay the cubes out in a short row in front of the default sim
    // camera (which sits at (0,1.6,0) looking down -Z) so they're in
    // view from the moment the demo loads.
    const z = -1;
    const y = 1.3;
    const xs = [-0.45, -0.15, 0.15, 0.45];
    for (let i = 0; i < NUM_CUBES; i++) {
      const cube = session.createNetObject({id: `shared-cube-${i}`});
      cube.position.set(xs[i] ?? 0, y, z);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.15, 0.15),
        new THREE.MeshBasicMaterial({
          color: CUBE_COLORS[i % CUBE_COLORS.length],
        })
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.5,
        })
      );
      // Lines have no surface normal, so if the platform reticle picks
      // them up first it gets stuck at the fallback distance. Skip them
      // for raycasts so the reticle locks onto the cube body instead.
      (
        edges as unknown as {ignoreReticleRaycast: boolean}
      ).ignoreReticleRaycast = true;
      mesh.add(edges);
      cube.add(mesh);
      this._cubes.push(cube);
    }
  }

  // Simple plane-projection drag: on press, find the cube under the
  // cursor and remember (a) its distance from the camera and (b) the
  // offset from the cursor's world hit-point to the cube's world
  // position. Each frame we project the cursor onto the same-distance
  // plane in front of the camera and re-apply the offset. No matrix
  // gymnastics, no parent-frame issues.
  private _tickDrag(session: NonNullable<this['net']['session']>) {
    const camera = xb.core?.camera;
    if (!camera) return;
    const controllers = (xb.core?.input?.controllers ?? []).filter(
      (c) =>
        c && c.constructor?.name !== 'MouseController' && c.userData?.connected
    );

    if (!this._drag) {
      // Mouse path: pick whichever cube center is nearest the cursor.
      if (this._mouseDown && this._ndc.x > -2) {
        const cube = this._cubeUnderMouse(camera);
        if (cube) return this._beginMouseDrag(session, cube, camera);
      }
      // Controller path: any selected XR/sim controller. Pick the cube
      // closest to the controller's forward ray.
      for (const c of controllers) {
        if (!c.userData?.selected) continue;
        const cube = this._cubeUnderController(c);
        if (!cube) continue;
        return this._beginControllerDrag(session, cube, c);
      }
      return;
    }

    const drag = this._drag;
    const stillHeld =
      drag.controller === null
        ? this._mouseDown
        : !!drag.controller.userData?.selected;
    if (!stillHeld) {
      session.release(drag.cube);
      this._drag = null;
      return;
    }

    // Compute the new world target.
    let targetWorld: THREE.Vector3;
    if (drag.controller) {
      const ray = this._controllerRay(drag.controller);
      targetWorld = ray.origin
        .clone()
        .add(ray.direction.clone().multiplyScalar(drag.distance))
        .add(drag.offset);
    } else {
      const cameraWorld = new THREE.Vector3();
      camera.getWorldPosition(cameraWorld);
      const cursorWorld = this._cursorAtDistance(
        camera,
        drag.distance,
        cameraWorld
      );
      targetWorld = cursorWorld.add(drag.offset);
    }

    const cube = drag.cube;
    if (cube.parent) {
      cube.parent.updateMatrixWorld();
      const inv = new THREE.Matrix4().copy(cube.parent.matrixWorld).invert();
      cube.position.copy(targetWorld).applyMatrix4(inv);
    } else {
      cube.position.copy(targetWorld);
    }
  }

  private _beginMouseDrag(
    session: NonNullable<this['net']['session']>,
    cube: NetObject,
    camera: THREE.Camera
  ) {
    const cameraWorld = new THREE.Vector3();
    camera.getWorldPosition(cameraWorld);
    const cubeWorld = new THREE.Vector3();
    cube.getWorldPosition(cubeWorld);
    const distance = cameraWorld.distanceTo(cubeWorld);
    const cursorWorld = this._cursorAtDistance(camera, distance, cameraWorld);
    const offset = cubeWorld.clone().sub(cursorWorld);
    session.claim(cube);
    this._drag = {cube, distance, offset, controller: null};
  }

  private _beginControllerDrag(
    session: NonNullable<this['net']['session']>,
    cube: NetObject,
    controller: THREE.Object3D
  ) {
    const ray = this._controllerRay(controller);
    const cubeWorld = new THREE.Vector3();
    cube.getWorldPosition(cubeWorld);
    const distance = ray.origin.distanceTo(cubeWorld);
    const onRay = ray.origin
      .clone()
      .add(ray.direction.clone().multiplyScalar(distance));
    const offset = cubeWorld.clone().sub(onRay);
    session.claim(cube);
    this._drag = {cube, distance, offset, controller};
  }

  // World-space ray from a controller pose: origin = controller world
  // position, direction = controller's local -Z mapped to world.
  private _controllerRay(controller: THREE.Object3D): THREE.Ray {
    controller.updateMatrixWorld();
    const origin = new THREE.Vector3();
    controller.getWorldPosition(origin);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      controller.getWorldQuaternion(new THREE.Quaternion())
    );
    return new THREE.Ray(origin, direction);
  }

  // Pick the cube whose center is closest to the controller's forward
  // ray (within ~one cube radius perpendicular distance).
  private _cubeUnderController(
    controller: THREE.Object3D
  ): NetObject | undefined {
    const ray = this._controllerRay(controller);
    let best: NetObject | undefined;
    let bestDist = 0.15;
    const tmp = new THREE.Vector3();
    for (const cube of this._cubes) {
      cube.getWorldPosition(tmp);
      const along = tmp.clone().sub(ray.origin).dot(ray.direction);
      if (along <= 0) continue;
      const closest = ray.origin
        .clone()
        .add(ray.direction.clone().multiplyScalar(along));
      const d = closest.distanceTo(tmp);
      if (d < bestDist) {
        bestDist = d;
        best = cube;
      }
    }
    return best;
  }

  // Project the cursor (NDC) onto a plane perpendicular to the camera's
  // forward axis at the given distance from the camera.
  private _cursorAtDistance(
    camera: THREE.Camera,
    distance: number,
    cameraWorld: THREE.Vector3
  ): THREE.Vector3 {
    this._mouseRaycaster.setFromCamera(
      this._ndc,
      camera as THREE.PerspectiveCamera
    );
    const dir = this._mouseRaycaster.ray.direction;
    return cameraWorld.clone().add(dir.clone().multiplyScalar(distance));
  }

  // Pick the cube whose CENTER projects nearest to the cursor in NDC
  // space. This sidesteps THREE's `intersectObjects` returning multiple
  // (sometimes geometrically nonsensical) hits across the BoxGeometry
  // and EdgesGeometry children, and matches what the user actually
  // clicked on screen.
  private _cubeUnderMouse(camera: THREE.Camera): NetObject | undefined {
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    let best: NetObject | undefined;
    let bestDist = Infinity;
    const tmp = new THREE.Vector3();
    for (const cube of this._cubes) {
      cube.getWorldPosition(tmp);
      tmp.project(camera);
      // Skip cubes behind the camera (z > 1 after projection).
      if (tmp.z > 1) continue;
      const dx = tmp.x - this._ndc.x;
      const dy = tmp.y - this._ndc.y;
      const d = Math.hypot(dx, dy);
      // Reject clicks that are too far from any cube to count as a hit
      // (~0.15 NDC units is roughly a cube radius at the default
      // viewing distance).
      if (d > 0.15) continue;
      if (d < bestDist) {
        bestDist = d;
        best = cube;
      }
    }
    return best;
  }

  // ---- Chat panel --------------------------------------------------------

  private _buildChatPanel(session: NonNullable<this['net']['session']>) {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: '320px',
      maxHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(20, 20, 30, 0.85)',
      color: '#fff',
      borderRadius: '12px',
      padding: '10px',
      font: '13px system-ui, sans-serif',
      backdropFilter: 'blur(8px)',
      zIndex: '999',
    } as Partial<CSSStyleDeclaration>);

    const header = document.createElement('div');
    header.textContent = `💬 ${this._displayName}`;
    Object.assign(header.style, {
      fontWeight: '600',
      marginBottom: '6px',
      color: '#bfa9ff',
    });
    panel.appendChild(header);

    const log = document.createElement('div');
    Object.assign(log.style, {
      flex: '1 1 auto',
      overflowY: 'auto',
      minHeight: '120px',
      padding: '4px 0',
    });
    panel.appendChild(log);
    this._log = log;
    this._chatPanel = panel;

    const inputRow = document.createElement('form');
    Object.assign(inputRow.style, {
      display: 'flex',
      gap: '6px',
      marginTop: '6px',
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Say something…';
    input.maxLength = 280;
    Object.assign(input.style, {
      flex: '1 1 auto',
      padding: '6px 10px',
      borderRadius: '6px',
      border: '1px solid #444',
      background: '#13141c',
      color: '#fff',
      font: 'inherit',
    });
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send';
    Object.assign(send.style, {
      padding: '6px 14px',
      borderRadius: '6px',
      border: 'none',
      background: '#9177c7',
      color: '#fff',
      cursor: 'pointer',
      font: 'inherit',
    });
    inputRow.appendChild(input);
    inputRow.appendChild(send);
    panel.appendChild(inputRow);
    document.body.appendChild(panel);

    // Disable simulator controls while typing so WASD/space don't walk
    // the camera around (matches the chat sample / PR #262 pattern).
    const controls = xb.core?.simulator?.controls;
    input.addEventListener('focus', () => {
      if (controls) controls.enabled = false;
    });
    input.addEventListener('blur', () => {
      if (controls) controls.enabled = true;
    });

    inputRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const payload: ChatPayload = {
        from: this._displayName,
        text,
        ts: Date.now(),
      };
      session.events.emit('chat-message', payload);
      this._appendLine(payload, true);
      input.value = '';
    });
    session.events.on<ChatPayload>('chat-message', (payload) =>
      this._appendLine(payload, false)
    );
  }

  private _appendLine(p: ChatPayload, self: boolean) {
    if (this._log) {
      const line = document.createElement('div');
      line.style.padding = '2px 0';
      const who = document.createElement('span');
      who.textContent = self ? 'you' : p.from;
      who.style.color = self ? '#9177c7' : '#7ac0ff';
      who.style.fontWeight = '600';
      line.appendChild(who);
      line.appendChild(document.createTextNode(`: ${p.text}`));
      this._log.appendChild(line);
      this._log.scrollTop = this._log.scrollHeight;
    }
    this._appendSpatialLine(`${self ? 'you' : p.from}: ${p.text}`);
  }

  private _appendSpatialLine(text: string) {
    if (!this._spatialLog) return;
    this._spatialLogLines.push(text);
    if (this._spatialLogLines.length > 12) this._spatialLogLines.shift();
    this._spatialLog.setText(this._spatialLogLines.join('\n'));
  }

  // ---- Spatial HUD (visible in immersive XR) -----------------------------

  private _buildSpatialHud(session: NonNullable<this['net']['session']>) {
    const panel = new xb.SpatialPanel({
      width: 1.4,
      height: 1.0,
      backgroundColor: '#1a1a2add',
    });
    const grid = panel.addGrid();

    grid.addRow({weight: 0.1}).addText({
      text: `💬 ${this._displayName}`,
      fontSize: 0.05,
      fontColor: '#bfa9ff',
      textAlign: 'center',
    });

    this._spatialLog = new xb.ScrollingTroikaTextView({
      text: '(start typing on the keyboard below to chat)',
      fontSize: 0.04,
      textAlign: 'left',
    });
    grid.addRow({weight: 0.55}).add(this._spatialLog);

    this._spatialDraft = grid.addRow({weight: 0.13}).addText({
      text: '› ',
      fontSize: 0.04,
      fontColor: '#7ac0ff',
      textAlign: 'left',
    });

    this._spatialVoiceBtn = grid.addRow({weight: 0.22}).addTextButton({
      text: '🎙️ Enable voice',
      fontColor: '#ffffff',
      backgroundColor: '#9177c7',
      fontSize: 0.18,
    });
    this._spatialVoiceBtn.onTriggered = () => this._toggleVoice(session);

    panel.position.set(-1.2, 1.5, -1.5);
    panel.rotation.y = Math.PI / 8;
    this.add(panel);

    this._buildKeyboard(session);
  }

  private _buildKeyboard(session: NonNullable<this['net']['session']>) {
    // Subclass to override init() (which would otherwise reset the
    // keyboard's transform to its default position above the user).
    class PositionedKeyboard extends Keyboard {
      override init(): void {
        super.init();
        const sub = (this as unknown as {subspace: xb.SpatialPanel}).subspace;
        sub.position.set(-0.7, 0.7, -0.7);
        sub.scale.setScalar(0.6);
        sub.rotation.set(-Math.PI / 6, 0, 0);
      }
    }
    const keyboard = new PositionedKeyboard();
    this._keyboard = keyboard;
    xb.add(keyboard);
    keyboard.onTextChanged = (text: string) => {
      this._spatialDraft?.setText(`› ${text}`);
    };
    keyboard.onEnterPressed = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const payload: ChatPayload = {
        from: this._displayName,
        text: trimmed,
        ts: Date.now(),
      };
      session.events.emit('chat-message', payload);
      this._appendLine(payload, true);
      keyboard.clearText();
    };
  }

  private async _toggleVoice(session: NonNullable<this['net']['session']>) {
    if (this._voiceOn) {
      session.voice.disable();
      this._voiceOn = false;
      this._spatialVoiceBtn?.setText('🎙️ Enable voice');
    } else {
      try {
        await session.voice.enable(session.transport.remotePeerIds);
        this._voiceOn = true;
        this._spatialVoiceBtn?.setText('🔇 Disable voice');
      } catch (err) {
        this._appendSpatialLine(`voice error: ${(err as Error).message}`);
      }
    }
  }

  // ---- Voice button ------------------------------------------------------

  private _buildVoiceButton(session: NonNullable<this['net']['session']>) {
    const btn = document.createElement('button');
    btn.textContent = '🎙️ Enable voice';
    Object.assign(btn.style, {
      marginTop: '8px',
      padding: '8px 14px',
      background: '#9177c7',
      color: '#fff',
      border: 'none',
      borderRadius: '20px',
      fontSize: '13px',
      cursor: 'pointer',
      alignSelf: 'flex-start',
    } as Partial<CSSStyleDeclaration>);
    (this._chatPanel ?? document.body).appendChild(btn);
    btn.addEventListener('click', async () => {
      await this._toggleVoice(session);
      btn.textContent = this._voiceOn ? '🔇 Disable voice' : '🎙️ Enable voice';
    });
  }
}

NetSample.run(IntegrationSample);
