import * as THREE from 'three';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  type LongSelectEvent,
  type ObjectTouchStartEvent,
  Script,
  type SelectEndEvent,
  type SelectEvent,
} from '../core/Script';
import {isDefaultScriptMethod} from '../core/ScriptHooks';
import type {Controller} from '../input/Controller';
import {UIButton} from '../ui/components/UIButton';
import {UICard} from '../ui/components/UICard';
import {UISlider} from '../ui/components/UISlider';
import {Interaction} from './Interaction';
import type {
  GlobalInteractionHook,
  InteractionCallbackDispatch,
  InteractionFrameInput,
  InteractionSourceType,
  RaySourceInput,
  TargetedInteractionHook,
} from './InteractionTypes';
import {ManipulationManager} from './manipulation/ManipulationManager';

class CallbackHarness implements InteractionCallbackDispatch {
  globals: {hook: GlobalInteractionHook; event: SelectEvent}[] = [];

  isScript(object: THREE.Object3D): boolean {
    return (object as Script).isXRScript === true;
  }

  hasTargetHandler(
    object: THREE.Object3D,
    sourceType: InteractionSourceType
  ): boolean {
    if (!this.isScript(object)) return false;
    const hooks: TargetedInteractionHook[] =
      sourceType === 'direct-touch'
        ? [
            'onObjectTouchStart',
            'onObjectTouching',
            'onObjectTouchEnd',
            'onObjectSelectStart',
            'onObjectSelectEnd',
            'onObjectLongSelect',
          ]
        : [
            'onObjectSelectStart',
            'onObjectSelectEnd',
            'onObjectLongSelect',
            'onHoverEnter',
            'onHovering',
            'onHoverExit',
          ];
    return hooks.some((hook) => this.hasTargetHook(object, hook));
  }

  hasTargetHook(
    object: THREE.Object3D,
    hook: TargetedInteractionHook
  ): boolean {
    return (
      this.isScript(object) && !isDefaultScriptMethod(Reflect.get(object, hook))
    );
  }

  invokeTarget(
    script: THREE.Object3D,
    hook: TargetedInteractionHook,
    event: unknown
  ): unknown {
    return Reflect.apply(Reflect.get(script, hook), script, [
      {...(event as object), currentTarget: script},
    ]);
  }

  invokeSemantic(_object: THREE.Object3D, callback: () => void): void {
    callback();
  }

  invokeGlobal(hook: GlobalInteractionHook, event: SelectEvent): void {
    this.globals.push({hook, event});
  }

  invokeManipulation(script: Script, event: unknown): boolean {
    return script.onObjectManipulate(event as never) === true;
  }
}

class RecordingButton extends UIButton {
  starts: SelectEvent[] = [];
  ends: SelectEndEvent[] = [];
  longSelects: LongSelectEvent[] = [];
  touchStarts: ObjectTouchStartEvent[] = [];

  override onObjectSelectStart(event: SelectEvent): true {
    this.starts.push(event);
    return true;
  }

  override onObjectSelectEnd(event: SelectEndEvent): true {
    this.ends.push(event);
    return true;
  }

  override onObjectLongSelect(event: LongSelectEvent): true {
    this.longSelects.push(event);
    return true;
  }

  override onObjectTouchStart(event: ObjectTouchStartEvent): true {
    this.touchStarts.push(event);
    return true;
  }
}

const EMPTY_FRAME: InteractionFrameInput = {
  raySources: [],
  directTouches: [],
};

describe('Interaction public behavior', () => {
  let callbacks: CallbackHarness;
  let interaction: Interaction;

  beforeEach(() => {
    callbacks = new CallbackHarness();
    const manager = new ManipulationManager(
      callbacks.invokeManipulation.bind(callbacks)
    );
    interaction = new Interaction({callbacks, manipulation: manager});
  });

  it('keeps one semantic capture inside a manipulable card and cancels invalid releases', () => {
    const clicked = vi.fn();
    const card = new UICard({
      size: {width: 0.5, height: 0.3},
      manipulation: true,
    });
    const button = new RecordingButton({label: 'Save', onClick: clicked});
    card.add(button);
    new THREE.Scene().add(card);
    const primary = controller(0);
    const unrelated = controller(1);

    updateRays(interaction, [
      ray(primary, false, hit(button)),
      ray(unrelated, false),
    ]);
    updateRays(interaction, [
      ray(primary, true, hit(button)),
      ray(unrelated, false),
    ]);
    updateRays(interaction, [
      ray(primary, true, hit(button)),
      ray(unrelated, true),
    ]);
    updateRays(interaction, [
      ray(primary, true, hit(button)),
      ray(unrelated, false),
    ]);
    expect(interaction.isSelectingAt(button)).toBe(true);

    updateRays(interaction, [ray(primary, false)]);
    expect(clicked).not.toHaveBeenCalled();
    expect(button.ends.at(-1)).toMatchObject({
      completed: false,
      reason: 'released-outside',
    });
    expect(callbacks.globals.at(-1)).toMatchObject({
      hook: 'onSelectEnd',
      event: {completed: false, reason: 'released-outside'},
    });

    updateRays(interaction, [ray(primary, true, hit(button))]);
    interaction.update(EMPTY_FRAME);
    expect(button.ends.at(-1)).toMatchObject({
      completed: false,
      reason: 'source-lost',
    });
    expect(clicked).not.toHaveBeenCalled();

    updateRays(interaction, [ray(primary, false, hit(button))]);
    updateRays(interaction, [ray(primary, true, hit(button))]);
    updateRays(interaction, [ray(primary, false, hit(button))]);
    expect(clicked).toHaveBeenCalledOnce();
    expect(button.ends.at(-1)?.completed).toBe(true);
  });

  it('dispatches touch first, honors prevention, suspends the ray, and completes an unprevented touch', () => {
    const clicked = vi.fn();
    const button = new RecordingButton({label: 'Touch', onClick: clicked});
    button.onObjectTouchStart = (event) => {
      event.preventDefault();
      button.touchStarts.push(event);
      return true;
    };
    const physical = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const unregister = interaction.registerHitSurface(physical, button, {
      kind: 'content',
    });
    const hand = controller(0);
    const touch = {
      controller: hand,
      handIndex: 0,
      hand: new THREE.Object3D(),
      point: new THREE.Vector3(),
      selected: false,
    };

    interaction.update({
      raySources: [ray(hand, true, hit(button))],
      directTouches: [touch],
    });
    expect(button.touchStarts).toHaveLength(1);
    expect(button.starts).toHaveLength(0);
    expect(interaction.getResolvedRay(hand)).toBeUndefined();

    interaction.update({
      raySources: [ray(hand, true, hit(button))],
      directTouches: [{...touch, point: new THREE.Vector3(2, 0, 0)}],
    });
    interaction.update({
      raySources: [ray(hand, false, hit(button))],
      directTouches: [],
    });
    expect(clicked).not.toHaveBeenCalled();

    unregister();
    const acceptedClick = vi.fn();
    const accepted = new RecordingButton({
      label: 'Accepted touch',
      onClick: acceptedClick,
    });
    const acceptedPhysical = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    interaction.registerHitSurface(acceptedPhysical, accepted, {
      kind: 'content',
    });
    interaction.update({
      raySources: [ray(hand, false)],
      directTouches: [touch],
    });
    interaction.update({
      raySources: [ray(hand, false)],
      directTouches: [{...touch, point: new THREE.Vector3(2, 0, 0)}],
    });
    expect(acceptedClick).toHaveBeenCalledOnce();
    expect(accepted.ends.at(-1)?.completed).toBe(true);
    expect(accepted.ends.at(-1)?.source.type).toBe('direct-touch');
  });

  it('jumps and streams a slider, commits once, and restores on cancellation', () => {
    const onInput = vi.fn();
    const onChange = vi.fn();
    const slider = new UISlider({ariaLabel: 'Volume', onInput, onChange});
    const source = controller(0);
    const second = controller(1);

    updateRays(interaction, [ray(source, false, hit(slider, 1, 0.25))]);
    updateRays(interaction, [ray(source, true, hit(slider, 1, 0.75))]);
    updateRays(interaction, [
      ray(source, true, hit(slider, 1, 0.75)),
      ray(second, true, hit(slider, 1, 0.1)),
    ]);
    updateRays(interaction, [
      ray(source, true, hit(slider, 1, 1)),
      ray(second, false, hit(slider, 1, 0.1)),
    ]);
    updateRays(interaction, [ray(source, false, hit(slider, 1, 1))]);

    expect(slider.value).toBe(1);
    expect(onInput.mock.calls.map(([value]) => value)).toEqual([0.75, 1]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);

    updateRays(interaction, [ray(source, true, hit(slider, 1, 0.5))]);
    expect(slider.value).toBe(0.5);
    slider.disabled = true;
    updateRays(interaction, [ray(source, true, hit(slider, 1, 0.5))]);
    expect(slider.value).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('limits gaze to buttons and makes long-select suppress normal click', () => {
    const gazeClick = vi.fn();
    const gazeButton = new RecordingButton({
      label: 'Gaze',
      onClick: gazeClick,
    });
    const gaze = controller(2);
    updateRays(interaction, [ray(gaze, false, hit(gazeButton), 'gaze')], 0);
    updateRays(interaction, [ray(gaze, false, hit(gazeButton), 'gaze')], 2);
    expect(gazeClick).toHaveBeenCalledOnce();
    updateRays(interaction, [ray(gaze, false, hit(gazeButton), 'gaze')], 2);
    expect(gazeClick).toHaveBeenCalledOnce();

    const longClick = vi.fn();
    const longButton = new RecordingButton({
      label: 'Hold',
      onClick: longClick,
    });
    const pointer = controller(0);
    updateRays(interaction, [ray(pointer, false, hit(longButton))]);
    updateRays(interaction, [ray(pointer, true, hit(longButton))], 0);
    updateRays(interaction, [ray(pointer, true, hit(longButton))], 0.8);
    updateRays(interaction, [ray(pointer, false, hit(longButton))]);

    expect(longButton.longSelects).toHaveLength(1);
    expect(longClick).not.toHaveBeenCalled();
    expect(
      callbacks.globals.filter(({hook}) => hook === 'onLongSelect')
    ).toHaveLength(1);
  });

  it('uses the edge for Translate and supports generic or opposite-corner Scale', () => {
    const scene = new THREE.Scene();
    const card = new UICard({
      size: {width: 0.5, height: 0.3},
      manipulation: true,
      edge: true,
    });
    scene.add(card);
    const edge = new THREE.Object3D();
    const surface = new THREE.Object3D();
    interaction.registerHitSurface(edge, card, {kind: 'card-edge'});
    interaction.registerHitSurface(surface, card, {kind: 'card-surface'});
    const first = controller(0);
    const second = controller(1);

    updateRays(interaction, [ray(first, false, hit(surface))]);
    updateRays(interaction, [ray(first, true, hit(surface))]);
    expect(interaction.isManipulating(card)).toBe(false);
    updateRays(interaction, [ray(first, false, hit(surface))]);

    updateRays(interaction, [ray(first, true, hit(edge))]);
    updateRays(interaction, [
      ray(first, true, hit(edge), 'controller-ray', new THREE.Vector3(1, 0, 0)),
    ]);
    expect(card.position.x).not.toBe(0);

    updateRays(interaction, [ray(first, true, hit(edge)), ray(second, true)]);
    updateRays(interaction, [
      ray(first, true, hit(edge)),
      ray(
        second,
        true,
        undefined,
        'controller-ray',
        new THREE.Vector3(2, 0, 0)
      ),
    ]);
    expect(card.scale.x).not.toBe(1);
    interaction.clear();

    const cornerCard = new UICard({
      size: {width: 0.5, height: 0.3},
      manipulation: true,
      edge: {scale: true},
    });
    scene.add(cornerCard);
    const cornerSurface = new THREE.Object3D();
    interaction.registerHitSurface(cornerSurface, cornerCard, {
      kind: 'card-edge',
    });
    updateRays(interaction, [
      ray(first, true, hit(cornerSurface, 1, 0.1, 0.9)),
    ]);
    expect(cornerCard.position.toArray()).toEqual([0, 0, 0]);
    updateRays(interaction, [
      ray(first, true, hit(cornerSurface, 1, 0.1, 0.9)),
      ray(
        second,
        true,
        hit(cornerSurface, 1, 0.9, 0.1),
        'controller-ray',
        new THREE.Vector3(1, 0, 0)
      ),
    ]);
    updateRays(interaction, [
      ray(first, true, hit(cornerSurface, 1, 0.1, 0.9)),
      ray(
        second,
        true,
        hit(cornerSurface, 1, 0.9, 0.1),
        'controller-ray',
        new THREE.Vector3(2, 0, 0)
      ),
    ]);
    expect(cornerCard.scale.x).toBeGreaterThan(1);
  });
});

function controller(id: number): Controller {
  const value = new THREE.Object3D() as Controller;
  value.userData = {id, connected: true, selected: false};
  return value;
}

function hit(
  object: THREE.Object3D,
  distance = 1,
  u = 0.5,
  v = 0.5
): THREE.Intersection {
  return {
    distance,
    object,
    point: new THREE.Vector3(0, 0, -distance),
    uv: new THREE.Vector2(u, v),
  };
}

function ray(
  source: Controller,
  selected: boolean,
  intersection?: THREE.Intersection,
  sourceType: RaySourceInput['sourceType'] = 'controller-ray',
  position = new THREE.Vector3()
): RaySourceInput {
  source.userData.selected = selected;
  return {
    controller: source,
    sourceType,
    selected,
    ray: new THREE.Ray(position, new THREE.Vector3(0, 0, -1)),
    intersections: intersection ? [intersection] : [],
    position,
    orientation: new THREE.Quaternion(),
  };
}

function updateRays(
  interaction: Interaction,
  raySources: RaySourceInput[],
  delta = 0
): void {
  interaction.update({raySources, directTouches: []}, delta);
}
