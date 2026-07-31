import * as THREE from 'three';
import * as xb from 'xrblocks';
import {createSpatialPanel} from './spatial_action_panel.js';

const PANEL_WIDTH = 1.2;
const PANEL_HEIGHT = 0.6;
const PANEL_POS_X = 0;
const PANEL_POS_Y = 2.2;
const PANEL_POS_Z = -1.0;
const PANEL_ROT_X = Math.PI / 8;

const BUTTON_WIDTH = '25%';
const IMAGE_WIDTH = '50%';
const ICON_SIZE = 100;
const ICON_COLOR = '#ffffff';

/** Configuration data for an animal model in the application. */
export interface AnimalModel {
  img: string;
  file: string;
  path: string;
  scale: number;
  rotY: number;
  tint?: number;
  talking: boolean;
}

/** UI component that presents a slider interface for selecting animal models. */
export class AnimalSlider {
  public models: AnimalModel[];
  public currentIndex = 0;
  public paletteItems: xb.UIImage[] = [];
  public textures: THREE.Texture[];
  public panel: xb.UICard;
  public prevBtn!: xb.UIButton;
  public nextBtn!: xb.UIButton;
  public sliderImage!: xb.UIImage;

  public constructor(scene: THREE.Object3D, models: AnimalModel[]) {
    this.models = models;
    this.textures = models.map(({img}) => new THREE.TextureLoader().load(img));
    this.panel = AnimalSlider.createPanel();
    scene.add(this.panel);
    this.setupContent();
  }

  /** Creates the base spatial panel for the slider. */
  public static createPanel() {
    return createSpatialPanel(
      PANEL_WIDTH,
      PANEL_HEIGHT,
      new THREE.Vector3(PANEL_POS_X, PANEL_POS_Y, PANEL_POS_Z),
      PANEL_ROT_X
    );
  }

  /** Initializes the animal image and navigation controls. */
  private setupContent() {
    const row = new xb.UIPanel({
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      fillColor: 'rgba(30, 30, 30, 0.85)',
      strokeColor: '#555555',
      strokeWidth: 4,
      cornerRadius: 24,
    });
    this.prevBtn = this.createButton('arrow_back', 'Previous animal', () =>
      this.slide(-1)
    );
    this.sliderImage = new xb.UIImage(this.textures[this.currentIndex], {
      width: IMAGE_WIDTH,
      height: '100%',
      objectFit: 'cover',
    });
    this.sliderImage.userData = {
      isPaletteItem: true,
      animalIndex: this.currentIndex,
    };
    this.nextBtn = this.createButton('arrow_forward', 'Next animal', () =>
      this.slide(1)
    );
    row.add(this.prevBtn, this.sliderImage, this.nextBtn);
    this.panel.add(row);
    this.paletteItems.push(this.sliderImage);
  }

  private createButton(icon: string, ariaLabel: string, onClick: () => void) {
    const button = new xb.UIButton({
      ariaLabel,
      width: BUTTON_WIDTH,
      height: '100%',
      fillColor: '#00000000',
      alignItems: 'center',
      justifyContent: 'center',
      onClick,
    });
    button.add(
      new xb.UIIcon(icon, {
        width: ICON_SIZE,
        height: ICON_SIZE,
        color: ICON_COLOR,
      })
    );
    return button;
  }

  /** Shifts the slider selection by the given direction offset. */
  public slide(direction: number) {
    this.currentIndex = AnimalSlider.getWrappedIndex(
      this.currentIndex,
      direction,
      this.models.length
    );
    this.sliderImage.setSrc(this.textures[this.currentIndex]);
    this.sliderImage.userData.animalIndex = this.currentIndex;
  }

  /** Calculates a safely wrapped array index to handle circular scrolling. */
  public static getWrappedIndex(
    currentIndex: number,
    direction: number,
    totalLength: number
  ) {
    return THREE.MathUtils.euclideanModulo(
      currentIndex + direction,
      totalLength
    );
  }

  /** Retrieves the meshes that should be interactable within this UI. */
  public getHitboxes() {
    return [this.prevBtn, this.nextBtn, this.sliderImage];
  }

  /** Retrieves the draggable/spawning elements from the slider. */
  public getPaletteItems() {
    return this.paletteItems;
  }
}
