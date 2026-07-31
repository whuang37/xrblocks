import * as THREE from 'three';
import * as xb from 'xrblocks';

/** Renders a movable spatial question card with two captured buttons. */
export class UIManager extends xb.Script {
  constructor() {
    super();

    const card = new xb.UICard({
      name: 'WelcomeCard',
      position: new THREE.Vector3(0, 1.2, -1),
      sizeX: 0.75,
      sizeY: 0.34,
      fillColor: '#00000000',
      manipulation: true,
    });
    this.add(card);

    const panel = new xb.UIPanel({
      width: '100%',
      height: '100%',
      padding: 24,
      gap: 18,
      flexDirection: 'column',
      alignItems: 'stretch',
      justifyContent: 'center',
      fillColor: 'rgba(43, 43, 43, 0.9)',
      strokeColor: '#686868',
      strokeWidth: 2,
      cornerRadius: 20,
    });
    card.add(panel);

    this.question = new xb.UIText(
      'Welcome to UI Playground! Is it your first time here?',
      {
        width: '100%',
        flexGrow: 1,
        fontSize: 28,
        color: '#ffffff',
        textAlign: 'center',
      }
    );
    panel.add(this.question);

    const controls = new xb.UIPanel({
      width: '100%',
      height: 96,
      gap: 18,
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'center',
      fillColor: '#00000000',
    });
    controls.add(
      this.createButton('check_circle', 'Yes', '#338a4b', () => this._onYes()),
      this.createButton('cancel', 'No', '#a43e3e', () => this._onNo())
    );
    panel.add(controls);
  }

  createButton(icon, ariaLabel, fillColor, onClick) {
    const button = new xb.UIButton({
      ariaLabel,
      width: '50%',
      height: '100%',
      fillColor,
      cornerRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      onClick,
    });
    button.add(new xb.UIIcon(icon, {width: 48, height: 48, color: '#ffffff'}));
    return button;
  }

  _onYes() {
    console.log('yes');
  }

  _onNo() {
    console.log('no');
  }
}
