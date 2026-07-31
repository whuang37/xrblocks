import * as THREE from 'three';
import * as xb from 'xrblocks';

const PANEL_BG_COLOR = '#00000000';
const PANEL_SIZE = 0.65;
const PANEL_ROT_X_OFFSET = -Math.PI / 8;

const ICON_SIZE = 160;
const ICON_COLOR = '#ffffff';
const BG_COLOR = 'rgba(30, 30, 30, 0.85)';
const EDGE_COLOR = '#555555';

/** Creates a basic spatial panel positioned in 3D space with a specified rotation. */
export function createSpatialPanel(
  width: number,
  height: number,
  position: THREE.Vector3,
  rotX: number
) {
  const panel = new xb.UICard({
    sizeX: width,
    sizeY: height,
    fillColor: PANEL_BG_COLOR,
    position,
  });
  panel.rotation.x = rotX;
  return panel;
}

/** Constructs an interactive spatial action panel with a given icon and trigger callback. */
export function buildSpatialActionPanel(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  icon: string,
  buttons: xb.UIButton[],
  onTriggerCallback: () => void
) {
  const panel = createSpatialPanel(
    PANEL_SIZE,
    PANEL_SIZE,
    position,
    PANEL_ROT_X_OFFSET
  );
  scene.add(panel);
  const button = new xb.UIButton({
    ariaLabel: icon,
    width: '100%',
    height: '100%',
    fillColor: BG_COLOR,
    strokeColor: EDGE_COLOR,
    strokeWidth: 4,
    cornerRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    onClick: onTriggerCallback,
  });
  button.add(
    new xb.UIIcon(icon, {
      width: ICON_SIZE,
      height: ICON_SIZE,
      color: ICON_COLOR,
    })
  );
  panel.add(button);
  buttons.push(button);

  return {panel, button};
}
