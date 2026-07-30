import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {FollowObject} from './FollowObject';
import {VisibilityTransition} from './VisibilityTransition';
import {
  resumeTransformScripts,
  suspendTransformScripts,
} from './TransformScript';

describe('placement scripts', () => {
  it('rebases a followed object after manipulation', () => {
    const target = new THREE.Object3D();
    const object = new THREE.Object3D();
    const follow = new FollowObject({target});
    object.add(follow);

    target.position.x = 1;
    follow.update();
    expect(object.position.x).toBe(1);

    suspendTransformScripts(object);
    object.position.x = 5;
    target.position.x = 2;
    follow.update();
    expect(object.position.x).toBe(5);

    resumeTransformScripts(object);
    target.position.x = 3;
    follow.update();
    expect(object.position.x).toBe(6);
  });

  it('shows and hides its parent without replacing visibility assignment', () => {
    const object = new THREE.Object3D();
    object.scale.setScalar(2);
    const transition = new VisibilityTransition({duration: 0.1});
    object.add(transition);
    transition.init({timer: {getDelta: () => 0.1} as THREE.Timer});

    transition.hide();
    transition.update();
    expect(object.visible).toBe(false);
    expect(object.scale.x).toBe(0);

    transition.show();
    transition.update();
    expect(object.visible).toBe(true);
    expect(object.scale.x).toBe(2);
  });
});
