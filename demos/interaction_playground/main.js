import * as THREE from 'three';
import * as xb from 'xrblocks';

let activePlayground;

const UI_THEME = Object.freeze({
  surface: 'rgba(10, 17, 31, 0.96)',
  surfaceRaised: 'rgba(22, 35, 58, 0.96)',
  surfaceSubtle: 'rgba(255, 255, 255, 0.08)',
  button: '#233653',
  buttonHover: '#315274',
  buttonActive: '#7c3aed',
  text: '#f8fafc',
  textMuted: '#cbd5e1',
  textDim: '#94a3b8',
  accent: '#67e8f9',
  accentStrong: '#22d3ee',
  mint: '#8ff0df',
  cardTitleSize: 64,
  cardSubtitleSize: 34,
  bodySize: 30,
  buttonSize: 40,
  badgeSize: 24,
  sectionSize: 44,
  sampleSize: 32,
});

function markFeature(feature) {
  activePlayground?.markFeature(feature);
}

function report(message, feature) {
  activePlayground?.report(message, feature);
}

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.08,
    emissive: color,
    emissiveIntensity: 0.04,
  });
}

function createCard(
  CardClass,
  {
    name,
    position,
    sizeX,
    sizeY,
    manipulation,
    pointerEvents,
    interactionEnabled,
    reticleMode,
    visible,
    ...style
  }
) {
  const card = new CardClass({
    name,
    position,
    sizeX,
    sizeY,
    manipulation,
    pointerEvents,
    interactionEnabled,
    reticleMode,
    visible,
    ...style,
  });
  return card;
}

function createPanel(properties = {}) {
  return new xb.UIPanel(properties);
}

function createText(text, properties = {}) {
  return new xb.UIText(text, properties);
}

function createIcon(icon, properties = {}) {
  return new xb.UIIcon(icon, properties);
}

function createImage(src, properties = {}) {
  return new xb.UIImage(src, properties);
}

class InteractiveObject extends xb.MeshScript {
  constructor({
    name,
    geometry,
    color,
    position,
    manipulation,
    reticleMode = 'auto',
    interactionEnabled = true,
    preventManipulation = false,
    onActivate,
  }) {
    const material = makeMaterial(color);
    super(geometry, material);
    this.name = name;
    this.position.copy(position);
    this.reticleMode = reticleMode;
    this.interactionEnabled = interactionEnabled;
    this.preventManipulation = preventManipulation;
    this.onActivate = onActivate;
    this.material = material;
    if (manipulation !== undefined) this.xb = {manipulation};
  }

  flash(intensity = 0.8) {
    this.material.emissiveIntensity = intensity;
    clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.material.emissiveIntensity = 0.22;
    }, 220);
  }

  onHoverEnter() {
    this.material.emissiveIntensity = 0.22;
    report(`${this.name}: hover enter`, 'selection');
    return true;
  }

  onHoverExit() {
    this.material.emissiveIntensity = 0.04;
    report(`${this.name}: hover exit`);
    return true;
  }

  onObjectSelectStart() {
    this.flash(0.5);
    report(`${this.name}: select start`, 'selection');
    return true;
  }

  onObjectSelectEnd() {
    this.flash();
    this.onActivate?.();
    report(`${this.name}: select end`, 'selection');
    return true;
  }

  onObjectLongSelect(event) {
    this.flash(1.4);
    report(
      `${this.name}: long select at ${event.duration.toFixed(2)}s`,
      'long-select'
    );
    return true;
  }

  onObjectTouchStart(event) {
    this.flash(0.7);
    report(`${this.name}: hand ${event.handIndex} touch start`, 'touch');
    return true;
  }

  onObjectTouching() {
    markFeature('touch');
    return true;
  }

  onObjectTouchEnd(event) {
    this.material.emissiveIntensity = 0.04;
    report(`${this.name}: hand ${event.handIndex} touch end`, 'touch');
    return true;
  }

  onObjectGrabStart(event) {
    this.flash(1.1);
    report(`${this.name}: hand ${event.handIndex} grab start`, 'touch');
  }

  onObjectGrabbing() {
    markFeature('touch');
  }

  onObjectGrabEnd(event) {
    this.material.emissiveIntensity = 0.04;
    report(`${this.name}: hand ${event.handIndex} grab end`, 'touch');
  }

  onObjectManipulate(event) {
    if (event.phase === 'start' && this.preventManipulation) {
      event.preventDefault();
      report(`${this.name}: prevented ${event.action}`, 'manipulation');
      return true;
    }
    if (event.phase !== 'update') {
      report(`${this.name}: ${event.action} ${event.phase}`, 'manipulation');
    }
    return true;
  }
}

class HandleOwner extends xb.Script {
  constructor() {
    super();
    this.name = 'Handle owner';
    this.position.set(-0.2, 1.12, -1.8);
    this.xb = {
      manipulation: {
        actions: {
          translate: {faceCamera: false},
          rotate: {axis: 'y', space: 'world'},
          scale: {minScale: 0.55, maxScale: 2.4},
        },
        handle: {action: xb.ManipulationAction.Translate},
      },
    };

    this.coreMaterial = makeMaterial(0x26c6da);
    this.ringMaterial = makeMaterial(0xffa726);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 2),
      this.coreMaterial
    );
    core.name = 'Translate handle';

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.045, 16, 48),
      this.ringMaterial
    );
    ring.name = 'Rotate handle';
    ring.xb = {
      manipulationHandle: {action: xb.ManipulationAction.Rotate},
    };
    this.add(core, ring);
  }

  onHoverEnter() {
    this.coreMaterial.emissiveIntensity = 0.22;
    this.ringMaterial.emissiveIntensity = 0.22;
    report('Handle owner: hover a child handle', 'selection');
  }

  onHoverExit() {
    this.coreMaterial.emissiveIntensity = 0.04;
    this.ringMaterial.emissiveIntensity = 0.04;
  }

  onObjectManipulate(event) {
    if (event.phase !== 'update') {
      report(`Handle owner: ${event.action} ${event.phase}`, 'manipulation');
    }
  }
}

class ReticleTarget extends xb.MeshScript {
  constructor({name, color, position, reticleMode, interactionEnabled = true}) {
    super(
      new THREE.BoxGeometry(0.34, 0.24, 0.04),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.68,
        emissive: color,
        emissiveIntensity: 0.08,
      })
    );
    this.name = name;
    this.position.copy(position);
    this.reticleMode = reticleMode;
    this.interactionEnabled = interactionEnabled;
  }

  onHoverEnter() {
    this.material.emissiveIntensity = 0.3;
    report(`${this.name}: ${this.reticleMode} reticle`, 'reticle');
    return true;
  }

  onHoverExit() {
    this.material.emissiveIntensity = 0.08;
    return true;
  }
}

class InstrumentedPanel extends xb.UIButton {
  constructor({label, onClick, ...properties}) {
    super({
      ariaLabel: label,
      onClick,
      ...properties,
    });
    this.name = label;
    this.label = label;
  }

  onHoverEnter() {
    this.setFillColor(UI_THEME.buttonHover);
    report(`${this.label}: UI hover enter`, 'ui');
    return true;
  }

  onHoverExit() {
    this.setFillColor(UI_THEME.button);
    report(`${this.label}: UI hover exit`);
    return true;
  }

  onObjectSelectStart() {
    report(`${this.label}: UI select start`, 'selection');
    return true;
  }

  onObjectSelectEnd(event) {
    report(`${this.label}: UI select end`, 'ui');
    return super.onObjectSelectEnd(event);
  }

  onObjectLongSelect(event) {
    this.setFillColor(UI_THEME.buttonActive);
    setTimeout(() => {
      this.setFillColor(UI_THEME.button);
    }, 260);
    report(
      `${this.label}: UI long select at ${event.duration.toFixed(2)}s`,
      'long-select'
    );
    return true;
  }
}

class InstrumentedCard extends xb.UICard {
  onObjectManipulate(event) {
    if (event.phase !== 'update') {
      report(`${this.name}: ${event.action} ${event.phase}`, 'manipulation');
    }
  }
}

const imageSource = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#5eead4"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
    <rect width="100" height="100" rx="24" fill="url(#g)"/>
    <path d="M25 64 42 47l12 12 11-11 16 16" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="35" cy="32" r="8" fill="white"/>
  </svg>
`)}`;

const featureLabels = {
  ui: 'UI',
  selection: 'SELECT',
  'long-select': 'HOLD',
  manipulation: 'MOVE',
  placement: 'PLACE',
  touch: 'TOUCH',
  reticle: 'RETICLE',
};

function makeSectionLabel(text, position, color) {
  const label = createCard(xb.UICard, {
    name: `${text} section label`,
    position,
    sizeX: 0.96,
    sizeY: 0.14,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    fillColor: UI_THEME.surface,
    strokeWidth: 2,
    strokeColor: color,
    cornerRadius: 22,
    pointerEvents: 'none',
  });
  label.add(
    createText(text, {
      width: '100%',
      fontSize: UI_THEME.sectionSize,
      fontWeight: 'bold',
      color,
      letterSpacing: 2,
      textAlign: 'center',
    })
  );
  return label;
}

function makeSampleLabel(text, position, color) {
  const label = createCard(xb.UICard, {
    name: `${text} sample label`,
    position,
    sizeX: 0.5,
    sizeY: 0.11,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    fillColor: UI_THEME.surfaceRaised,
    strokeWidth: 1.5,
    strokeColor: color,
    cornerRadius: 16,
    pointerEvents: 'none',
  });
  label.add(
    createText(text, {
      width: '100%',
      fontSize: UI_THEME.sampleSize,
      fontWeight: 'bold',
      color,
      letterSpacing: 0.5,
      textAlign: 'center',
    })
  );
  return label;
}

function makeButton(label, icon, onClick) {
  const button = new InstrumentedPanel({
    label,
    minWidth: 270,
    height: 118,
    paddingLeft: 30,
    paddingRight: 30,
    gap: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    cornerRadius: 22,
    fillColor: UI_THEME.button,
    strokeWidth: 2,
    strokeColor: UI_THEME.mint,
    onClick,
  });
  button.xb = {manipulationHandle: 'none'};
  button.add(
    createIcon(icon, {
      width: 48,
      height: 48,
      color: UI_THEME.mint,
      iconStyle: 'rounded',
    }),
    createText(label, {
      fontSize: UI_THEME.buttonSize,
      fontWeight: 'bold',
      color: UI_THEME.text,
    })
  );
  return button;
}

class InteractionPlayground extends xb.Script {
  resettableObjects = [];
  eventMessages = [];
  featureBadges = new Map();

  async init() {
    xb.core.scene.background = new THREE.Color(0x090d18);
    this.addLights();
    this.addBackdrop();
    this.addXRDashboard();
    this.addManipulationObjects();
    this.addPlacementObjects();
    this.addReticleTargets();
    this.addUICards();

    const depthMesh = xb.core.depth?.depthMesh;
    if (depthMesh) {
      depthMesh.name = 'Depth reticle surface';
      depthMesh.reticleMode = 'surface';
    }

    this.rememberInitialTransforms();
    markFeature('ui');
    markFeature('placement');
    report('Playground loaded: test any labeled feature');
  }

  addXRDashboard() {
    this.guideCard = createCard(xb.UICard, {
      name: 'XR scene guide',
      position: new THREE.Vector3(-1.35, 2.08, -2.85),
      sizeX: 1.16,
      sizeY: 0.72,
      padding: 28,
      gap: 12,
      fillColor: {
        gradientType: 'linear',
        rotation: 20,
        stops: [
          {position: 0, color: '#0c172a'},
          {position: 1, color: '#16344b'},
        ],
      },
      strokeWidth: 3,
      strokeColor: '#38bdf8',
      cornerRadius: 30,
      pointerEvents: 'none',
    });
    this.guideCard.add(
      createText('INTERACTION PLAYGROUND', {
        width: '100%',
        fontSize: 56,
        fontWeight: 'bold',
        color: '#7dd3fc',
        letterSpacing: 1.5,
        textAlign: 'center',
      }),
      createText('XR-native manual coverage for the UI refactor', {
        width: '100%',
        fontSize: 32,
        color: UI_THEME.text,
        textAlign: 'center',
      }),
      createText(
        [
          'INTERACTION  Move, rotate, scale, hold, touch, and block',
          'PLACEMENT    Follow object, face camera, follow head, fade',
          'RETICLES     Surface, hidden, disabled, and pass-through',
          'UI           Click, hold, move, scale, flex, media, emoji',
        ].join('\n'),
        {
          width: '100%',
          fontSize: 26,
          lineHeight: 1.35,
          color: UI_THEME.textMuted,
        }
      ),
      new xb.FaceCamera({mode: 'cylindrical', smoothing: 0.16})
    );

    this.statusCard = createCard(InstrumentedCard, {
      name: 'XR coverage and controls',
      position: new THREE.Vector3(1.35, 2.08, -2.85),
      sizeX: 1.16,
      sizeY: 0.76,
      manipulation: {
        actions: {translate: true, scale: {minScale: 0.75, maxScale: 1.5}},
      },
      manipulationEdge: {
        spotlightColor: '#c4b5fd',
      },
      padding: 28,
      gap: 15,
      fillColor: {
        gradientType: 'linear',
        rotation: -20,
        stops: [
          {position: 0, color: '#12172c'},
          {position: 1, color: '#261b45'},
        ],
      },
      strokeWidth: 3,
      strokeColor: '#8b5cf6',
      cornerRadius: 30,
    });
    this.statusCard.add(
      createText('LIVE COVERAGE + CONTROLS', {
        width: '100%',
        fontSize: 52,
        fontWeight: 'bold',
        color: '#c4b5fd',
        letterSpacing: 1,
        textAlign: 'center',
      })
    );

    const badgeRows = [
      ['ui', 'selection', 'long-select', 'manipulation'],
      ['placement', 'touch', 'reticle'],
    ];
    for (const features of badgeRows) {
      const row = createPanel({
        width: '100%',
        height: 50,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
      });
      for (const feature of features) {
        const badge = createPanel({
          minWidth: 118,
          height: 46,
          alignItems: 'center',
          justifyContent: 'center',
          fillColor: UI_THEME.surfaceSubtle,
          strokeWidth: 1.5,
          strokeColor: 'rgba(255, 255, 255, 0.24)',
          cornerRadius: 15,
          pointerEvents: 'none',
        });
        badge.add(
          createText(featureLabels[feature], {
            fontSize: UI_THEME.badgeSize,
            fontWeight: 'bold',
            color: UI_THEME.textDim,
            letterSpacing: 0.8,
          })
        );
        this.featureBadges.set(feature, badge);
        row.add(badge);
      }
      this.statusCard.add(row);
    }

    this.statusText = createText('Ready', {
      width: '100%',
      fontSize: UI_THEME.bodySize,
      fontWeight: 'bold',
      color: UI_THEME.accent,
      textAlign: 'center',
    });
    this.eventLogText = createText('No events yet', {
      width: '100%',
      fontSize: 22,
      lineHeight: 1.35,
      color: UI_THEME.textDim,
      textAlign: 'center',
    });
    this.statusCard.add(this.statusText, this.eventLogText);

    const controls = createPanel({
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
    });
    controls.add(
      makeButton('Reset', 'restart_alt', () => this.reset()),
      makeButton('UI panel', 'visibility', () => this.toggleUITransition()),
      makeButton('3D object', 'animation', () => this.toggleObjectTransition())
    );
    this.statusCard.add(
      controls,
      new xb.FollowHead({
        offset: new THREE.Vector3(1.35, 0.48, -2.85),
        smoothing: 0.08,
      }),
      new xb.FaceCamera({mode: 'spherical', smoothing: 0.12})
    );

    this.add(this.guideCard, this.statusCard);
    this.resettableObjects.push(this.guideCard, this.statusCard);
  }

  markFeature(feature) {
    const badge = this.featureBadges.get(feature);
    if (!badge || badge.userData.checked) return;
    badge.userData.checked = true;
    badge.setFillColor('rgba(16, 185, 129, 0.25)');
    badge.setStrokeColor('#5eead4');
    for (const child of badge.children) {
      if (child instanceof xb.UIText) child.setColor('#99f6e4');
    }
  }

  report(message, feature) {
    if (feature) this.markFeature(feature);
    this.statusText?.setText(message);
    this.eventMessages.unshift(message);
    this.eventMessages.length = Math.min(this.eventMessages.length, 4);
    if (this.eventLogText) {
      this.eventLogText.setText(this.eventMessages.join('\n'));
    }
  }

  addLights() {
    this.add(new THREE.HemisphereLight(0xcfe8ff, 0x252536, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
    keyLight.position.set(-1.5, 3, 1.5);
    this.add(keyLight);
  }

  addBackdrop() {
    const grid = new THREE.GridHelper(7, 28, 0x35516f, 0x172334);
    grid.name = 'Pointer-ignored floor grid';
    grid.pointerEvents = 'none';
    grid.position.y = -0.35;
    this.add(grid);

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(2.8, 64),
      new THREE.MeshBasicMaterial({
        color: 0x132238,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      })
    );
    halo.name = 'Pointer-ignored backdrop';
    halo.pointerEvents = 'none';
    halo.position.set(0, 1.25, -3.75);
    this.add(halo);
  }

  addManipulationObjects() {
    const sectionLabel = makeSectionLabel(
      'INTERACTION + MANIPULATION',
      new THREE.Vector3(0, 1.58, -3.05),
      '#22d3ee'
    );
    const defaultCube = new InteractiveObject({
      name: 'Default manipulation cube',
      geometry: new THREE.BoxGeometry(0.26, 0.26, 0.26),
      color: 0x26c6da,
      position: new THREE.Vector3(-1.8, 1.18, -2.5),
      manipulation: true,
    });

    const handles = new HandleOwner();
    handles.position.set(-1.08, 1.18, -2.5);

    const scaleSphere = new InteractiveObject({
      name: 'Scale-only sphere',
      geometry: new THREE.IcosahedronGeometry(0.16, 2),
      color: 0xec407a,
      position: new THREE.Vector3(-0.36, 1.18, -2.5),
      manipulation: {
        actions: {scale: {minScale: 0.45, maxScale: 2.75}},
      },
    });

    const longSelect = new InteractiveObject({
      name: 'Long-select gem',
      geometry: new THREE.DodecahedronGeometry(0.16),
      color: 0xffd54f,
      position: new THREE.Vector3(0.36, 1.18, -2.5),
    });

    const touchTarget = new InteractiveObject({
      name: 'Touch and grab capsule',
      geometry: new THREE.CapsuleGeometry(0.1, 0.2, 8, 16),
      color: 0xab47bc,
      position: new THREE.Vector3(1.08, 1.18, -2.5),
    });

    const locked = new InteractiveObject({
      name: 'Prevented manipulation object',
      geometry: new THREE.CylinderGeometry(0.14, 0.14, 0.28, 24),
      color: 0xef5350,
      position: new THREE.Vector3(1.8, 1.18, -2.5),
      manipulation: {
        actions: {translate: true},
        handle: {action: xb.ManipulationAction.Translate},
      },
      preventManipulation: true,
    });

    const labels = [
      makeSampleLabel(
        'MOVE + SCALE',
        new THREE.Vector3(-1.8, 0.91, -2.62),
        '#67e8f9'
      ),
      makeSampleLabel(
        'CHILD HANDLES',
        new THREE.Vector3(-1.08, 0.91, -2.62),
        '#fdba74'
      ),
      makeSampleLabel(
        'SCALE ONLY',
        new THREE.Vector3(-0.36, 0.91, -2.62),
        '#f9a8d4'
      ),
      makeSampleLabel(
        'HOLD 0.75 S',
        new THREE.Vector3(0.36, 0.91, -2.62),
        '#fde68a'
      ),
      makeSampleLabel(
        'TOUCH + GRAB',
        new THREE.Vector3(1.08, 0.91, -2.62),
        '#d8b4fe'
      ),
      makeSampleLabel(
        'PREVENTED',
        new THREE.Vector3(1.8, 0.91, -2.62),
        '#fca5a5'
      ),
    ];

    this.add(
      sectionLabel,
      defaultCube,
      handles,
      scaleSphere,
      longSelect,
      touchTarget,
      locked,
      ...labels
    );
    this.resettableObjects.push(
      defaultCube,
      handles,
      scaleSphere,
      longSelect,
      touchTarget,
      locked
    );
  }

  addPlacementObjects() {
    const sectionLabel = makeSectionLabel(
      'PLACEMENT SCRIPTS',
      new THREE.Vector3(0, 0.82, -3.04),
      '#a78bfa'
    );
    this.followAnchor = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshStandardMaterial({
        color: 0x80cbc4,
        emissive: 0x80cbc4,
        emissiveIntensity: 0.4,
      })
    );
    this.followAnchor.name = 'Animated follow anchor';
    this.followAnchor.pointerEvents = 'none';
    this.followAnchor.position.set(-1.55, 0.56, -2.5);

    const follower = new InteractiveObject({
      name: 'FollowObject cone',
      geometry: new THREE.ConeGeometry(0.11, 0.24, 20),
      color: 0x4dd0e1,
      position: new THREE.Vector3(-1.15, 0.56, -2.5),
      manipulation: true,
    });
    follower.add(
      new xb.FollowObject({
        target: this.followAnchor,
        mode: 'pose',
        positionOffset: new THREE.Vector3(0.4, 0, 0),
      })
    );

    const faceCamera = new InteractiveObject({
      name: 'FaceCamera pyramid',
      geometry: new THREE.ConeGeometry(0.14, 0.26, 4),
      color: 0x66bb6a,
      position: new THREE.Vector3(0.15, 0.56, -2.5),
      manipulation: true,
    });
    faceCamera.rotation.x = Math.PI / 2;
    faceCamera.add(new xb.FaceCamera({mode: 'spherical', smoothing: 0.14}));

    this.visibilityObject = new InteractiveObject({
      name: 'VisibilityTransition knot',
      geometry: new THREE.TorusKnotGeometry(0.12, 0.035, 72, 12),
      color: 0x7e57c2,
      position: new THREE.Vector3(1.35, 0.56, -2.5),
    });
    this.objectTransition = new xb.VisibilityTransition({duration: 0.32});
    this.visibilityObject.add(this.objectTransition);

    const labels = [
      makeSampleLabel(
        'ANIMATED TARGET',
        new THREE.Vector3(-1.55, 0.3, -2.62),
        '#99f6e4'
      ),
      makeSampleLabel(
        'FOLLOW POSE',
        new THREE.Vector3(-1.0, 0.3, -2.62),
        '#67e8f9'
      ),
      makeSampleLabel(
        'FACE CAMERA',
        new THREE.Vector3(0.15, 0.3, -2.62),
        '#86efac'
      ),
      makeSampleLabel(
        'VISIBILITY',
        new THREE.Vector3(1.35, 0.3, -2.62),
        '#c4b5fd'
      ),
    ];

    this.add(
      sectionLabel,
      this.followAnchor,
      follower,
      faceCamera,
      this.visibilityObject,
      ...labels
    );
    this.resettableObjects.push(follower, faceCamera, this.visibilityObject);
  }

  addReticleTargets() {
    const sectionLabel = makeSectionLabel(
      'RETICLE RESOLUTION',
      new THREE.Vector3(0, 0.14, -3.05),
      '#4ade80'
    );
    const surfaceTarget = new ReticleTarget({
      name: 'Surface target',
      color: 0x43a047,
      position: new THREE.Vector3(-1.2, -0.08, -2.45),
      reticleMode: 'surface',
    });
    const hiddenTarget = new ReticleTarget({
      name: 'Hidden target',
      color: 0x78909c,
      position: new THREE.Vector3(-0.4, -0.08, -2.45),
      reticleMode: 'hidden',
    });
    const disabledTarget = new ReticleTarget({
      name: 'Disabled blocking surface',
      color: 0x5c6b73,
      position: new THREE.Vector3(0.4, -0.08, -2.45),
      reticleMode: 'surface',
      interactionEnabled: false,
    });
    const passThroughTarget = new ReticleTarget({
      name: 'Pass-through target',
      color: 0x00acc1,
      position: new THREE.Vector3(1.2, -0.08, -2.52),
      reticleMode: 'auto',
    });

    const ignoredDecoration = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.19, 1),
      new THREE.MeshBasicMaterial({
        color: 0xb9f6ca,
        wireframe: true,
        transparent: true,
        opacity: 0.65,
      })
    );
    ignoredDecoration.name = 'Pointer-ignored wireframe';
    ignoredDecoration.position.set(1.2, -0.08, -2.31);
    ignoredDecoration.pointerEvents = 'none';

    const labels = [
      makeSampleLabel(
        'SURFACE',
        new THREE.Vector3(-1.2, -0.29, -2.62),
        '#86efac'
      ),
      makeSampleLabel(
        'HIDDEN',
        new THREE.Vector3(-0.4, -0.29, -2.62),
        '#cbd5e1'
      ),
      makeSampleLabel(
        'DISABLED',
        new THREE.Vector3(0.4, -0.29, -2.62),
        '#94a3b8'
      ),
      makeSampleLabel(
        'PASS-THROUGH',
        new THREE.Vector3(1.2, -0.29, -2.62),
        '#67e8f9'
      ),
    ];

    this.add(
      sectionLabel,
      surfaceTarget,
      hiddenTarget,
      disabledTarget,
      passThroughTarget,
      ignoredDecoration,
      ...labels
    );
  }

  addUICards() {
    this.galleryCard = createCard(InstrumentedCard, {
      name: 'UI component card',
      position: new THREE.Vector3(0, 2.08, -2.85),
      sizeX: 1.16,
      sizeY: 0.76,
      manipulation: {
        actions: {
          translate: true,
          scale: {minScale: 0.7, maxScale: 1.8},
        },
      },
      manipulationEdge: {
        spotlightColor: '#8ff0df',
      },
      padding: 30,
      gap: 16,
      fillColor: {
        gradientType: 'linear',
        rotation: 30,
        stops: [
          {position: 0, color: '#0d1825'},
          {position: 1, color: '#2c2050'},
        ],
      },
      strokeWidth: 3,
      strokeColor: '#6ee7d8',
      cornerRadius: 32,
    });

    this.galleryCard.add(
      createText('MAIN SDK UI', {
        width: '100%',
        fontSize: UI_THEME.cardTitleSize,
        fontWeight: 'bold',
        color: UI_THEME.mint,
        letterSpacing: 1.5,
        textAlign: 'center',
      }),
      createText('Panels, text, icons, images, and media', {
        width: '100%',
        fontSize: UI_THEME.cardSubtitleSize,
        color: UI_THEME.text,
        textAlign: 'center',
      })
    );

    const mediaRow = createPanel({
      width: '100%',
      height: 132,
      padding: 16,
      gap: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      fillColor: UI_THEME.surfaceSubtle,
      strokeWidth: 1.5,
      strokeColor: 'rgba(143, 240, 223, 0.3)',
      cornerRadius: 24,
    });
    mediaRow.add(
      createIcon('deployed_code', {
        width: 72,
        height: 72,
        color: '#fbbf24',
        iconStyle: 'rounded',
      }),
      createImage(imageSource, {
        width: 88,
        height: 88,
        borderRadius: 20,
        keepAspectRatio: true,
      }),
      createText('UIKit primitives\ninside UICard', {
        fontSize: UI_THEME.bodySize,
        lineHeight: 1.3,
        color: UI_THEME.textMuted,
      })
    );
    this.galleryCard.add(mediaRow);

    this.transitionPanel = createPanel({
      width: '100%',
      height: 76,
      alignItems: 'center',
      justifyContent: 'center',
      fillColor: '#153d44',
      strokeWidth: 2,
      strokeColor: '#5eead4',
      cornerRadius: 20,
    });
    this.transitionPanel.add(
      createText('VisibilityTransition attached to UIPanel', {
        fontSize: UI_THEME.bodySize,
        color: '#d5fffa',
      })
    );
    this.uiTransition = new xb.VisibilityTransition({duration: 0.28});
    this.transitionPanel.add(this.uiTransition);
    this.galleryCard.add(this.transitionPanel);

    const buttonRow = createPanel({
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 16,
    });
    buttonRow.add(
      makeButton('Click or hold', 'touch_app', () => {
        report('UI button clicked', 'ui');
      }),
      makeButton('Toggle panel', 'visibility', () => {
        this.toggleUITransition();
      })
    );
    this.galleryCard.add(buttonRow);
    this.galleryCard.add(
      new xb.FaceCamera({mode: 'cylindrical', smoothing: 0.16})
    );

    this.add(this.galleryCard);
    this.resettableObjects.push(this.galleryCard);
  }

  update(time = 0) {
    const seconds = time * 0.001;
    if (!this.followAnchor) return;
    this.followAnchor.position.x = -1.55 + Math.sin(seconds * 0.9) * 0.16;
    this.followAnchor.position.y = 0.56 + Math.sin(seconds * 1.4) * 0.08;
    this.followAnchor.rotation.y = seconds;
  }

  toggleUITransition() {
    this.uiTransition?.toggle();
    report('UIPanel visibility toggled', 'placement');
  }

  toggleObjectTransition() {
    this.objectTransition?.toggle();
    report('Object3D visibility toggled', 'placement');
  }

  rememberInitialTransforms() {
    for (const object of this.resettableObjects) {
      object.userData.initialTransform = {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      };
    }
  }

  reset() {
    for (const object of this.resettableObjects) {
      const initial = object.userData.initialTransform;
      object.visible = true;
      object.position.copy(initial.position);
      object.quaternion.copy(initial.quaternion);
      object.scale.copy(initial.scale);
      for (const child of object.children) {
        if (child instanceof xb.TransformScript) child.resume();
      }
    }
    this.uiTransition?.show();
    this.objectTransition?.show();
    report('Objects and placement baselines reset');
  }

  onSelectStart() {
    markFeature('selection');
  }

  onSelecting() {
    markFeature('selection');
  }

  onSelect() {
    markFeature('selection');
  }

  onSelectEnd() {
    markFeature('selection');
  }
}

const playground = new InteractionPlayground();
activePlayground = playground;

const options = new xb.Options();
options.setAppTitle('Interaction Playground');
options.setAppDescription(
  'Test interaction, manipulation, placement scripts, UIKit UI, and reticles.'
);
options.enableDepth();
options.depth.depthMesh.updateVertexNormals = true;
options.depth.depthMesh.updateFullResolutionGeometry = true;
options.reticles.enabled = true;
options.reticles.maxDistance = 4;
options.reticles.fadeDistance = 0.75;
options.controllers.visualizeRays = true;

xb.add(playground);
await xb.init(options);
