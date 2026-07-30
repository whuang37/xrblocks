import {Panel} from '../core/Panel';
import {PanelOptions} from '../core/PanelOptions';
import {ManipulationAction} from '../../interaction/manipulation/ManipulationTypes';

/**
 * A fundamental UI container that lets you display app content in a
 * 3D space. It can be thought of as a "window" or "surface" in XR. It provides
 * visual feedback for user interactions like hovering and selecting, driven by
 * a custom shader, and can be moved by the user.
 */
export type SpatialPanelOptions = PanelOptions & {
  showEdge?: boolean;
};

export class SpatialPanel extends Panel {
  /**
   * Creates an instance of SpatialPanel.
   */
  constructor(options: SpatialPanelOptions = {}) {
    options.xb ??= {
      manipulation: {
        actions: {translate: {faceCamera: true}},
        handle: {action: ManipulationAction.Translate},
      },
    };
    options.useBorderlessShader ??= false;
    super(options);
    this.mesh.material.visible = options.showEdge !== false;
  }

  update() {
    super.update();
    this._updateInteractionFeedback();
  }

  /**
   * Updates shader uniforms to provide visual feedback for controller
   * interactions, such as hover and selection highlights. This method is
   * optimized to only update uniforms when the state changes.
   */
  private _updateInteractionFeedback() {
    if (this.useBorderlessShader || !this.showHighlights) {
      return;
    }
    const [id1, id2] = this.ux.getPrimaryTwoControllerIds();

    // --- Update Selection Uniform ---
    const isSelected1 = id1 !== null ? this.ux.selected[id1] : false;
    const isSelected2 = id2 !== null ? this.ux.selected[id2] : false;

    this.mesh.material.uniforms.uSelected.value.set(
      isSelected1 ? 1.0 : 0.0,
      isSelected2 ? 1.0 : 0.0
    );

    // --- Update Reticle UVs Uniform ---
    const u1 = id1 !== null ? this.ux.uvs[id1].x : -1;
    const v1 = id1 !== null ? this.ux.uvs[id1].y : -1;
    const u2 = id2 !== null ? this.ux.uvs[id2].x : -1;
    const v2 = id2 !== null ? this.ux.uvs[id2].y : -1;

    this.mesh.material.uniforms.uReticleUVs.value.set(u1, v1, u2, v2);
  }
}
