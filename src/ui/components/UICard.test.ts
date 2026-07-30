import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {FaceCamera} from '../../placement/FaceCamera';
import {VisibilityTransition} from '../../placement/VisibilityTransition';
import {UICard} from './UICard';
import {UIPanel} from './UIPanel';

describe('UICard', () => {
  it('uses the shared manipulation configuration', () => {
    const card = new UICard({manipulation: true});

    expect(card.xb?.manipulation).toBe(true);
    expect(card.isUI).toBe(true);

    card.dispose();
  });

  it('allows placement scripts on cards and panels', () => {
    const card = new UICard();
    const panel = new UIPanel();
    const cardBehavior = new FaceCamera();
    const panelBehavior = new VisibilityTransition();

    expect(() => card.add(cardBehavior)).not.toThrow();
    expect(() => panel.add(panelBehavior)).not.toThrow();
    expect(cardBehavior.parent).toBe(card);
    expect(panelBehavior.parent).toBe(panel);

    card.dispose();
    panel.dispose();
  });

  it('rejects ordinary Object3D children', () => {
    const card = new UICard();
    const object = new THREE.Object3D();

    expect(() => card.add(object)).toThrow(/TransformScript/);
    expect(object.parent).toBeNull();

    card.dispose();
  });
});
