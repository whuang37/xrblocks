import * as THREE from 'three';

import type {Controller} from '../../input/Controller';
import type {
  GlobalInteractionHook,
  InteractionCallbackDispatch,
  InteractionSourceType,
  TargetedInteractionHook,
} from '../../interaction/InteractionTypes';
import type {ManipulationEvent} from '../../interaction/manipulation/ManipulationTypes';
import {
  KeyEvent,
  type ObjectGrabEvent,
  type ObjectTouchEvent,
  Script,
  SelectEvent,
} from '../Script';

type MaybeScript = THREE.Object3D & {isXRScript?: boolean};

export enum ScriptsManagerEventType {
  EXCEPTION = 'exception',
}

export type ScriptsManagerEventMap = THREE.Object3DEventMap & {
  [ScriptsManagerEventType.EXCEPTION]: {
    scriptName: string;
    context: string;
    error: Error;
    timestamp: number;
  };
};

export class ScriptsManager
  extends THREE.EventDispatcher<ScriptsManagerEventMap>
  implements InteractionCallbackDispatch
{
  /** The set of all currently initialized scripts. */
  scripts = new Set<Script>();

  /** The set of scripts currently being initialized. */
  private initializingScripts = new Set<Script>();

  private seenScripts = new Set<Script>();
  private syncPromises: Promise<void>[] = [];

  /** Whether to catch all exceptions thrown by developer scripts. */
  catchExceptions = true;

  constructor(private initScriptFunction: (script: Script) => Promise<void>) {
    super();
  }

  isScript = (object: THREE.Object3D): boolean =>
    (object as MaybeScript).isXRScript === true;

  // The legacy UI merge is separate. Until then, every Script remains a
  // logical interaction target, matching the current SDK behavior.
  hasTargetHandler = (
    object: THREE.Object3D,
    _sourceType: InteractionSourceType
  ): boolean => this.isScript(object);

  invokeTarget = (
    object: THREE.Object3D,
    hook: TargetedInteractionHook,
    argument: unknown
  ): boolean => {
    if (!this.isScript(object)) return false;
    return this.callTargeted([object as Script], hook, (script) => {
      if (hook === 'onObjectSelectStart') {
        return script.onObjectSelectStart(argument as SelectEvent);
      }
      if (hook === 'onObjectSelectEnd') {
        return script.onObjectSelectEnd(argument as SelectEvent);
      }
      if (hook === 'onObjectTouchStart') {
        return script.onObjectTouchStart(argument as ObjectTouchEvent);
      }
      if (hook === 'onObjectTouching') {
        return script.onObjectTouching(argument as ObjectTouchEvent);
      }
      if (hook === 'onObjectTouchEnd') {
        return script.onObjectTouchEnd(argument as ObjectTouchEvent);
      }
      if (hook === 'onObjectGrabStart') {
        return script.onObjectGrabStart(argument as ObjectGrabEvent);
      }
      if (hook === 'onObjectGrabbing') {
        return script.onObjectGrabbing(argument as ObjectGrabEvent);
      }
      if (hook === 'onObjectGrabEnd') {
        return script.onObjectGrabEnd(argument as ObjectGrabEvent);
      }
      const controller = argument as Controller;
      if (hook === 'onHoverEnter') return script.onHoverEnter(controller);
      if (hook === 'onHoverExit') return script.onHoverExit(controller);
      return script.onHovering(controller);
    });
  };

  invokeGlobal = (hook: GlobalInteractionHook, event: SelectEvent): void => {
    if (hook === 'onSelectStart') {
      this.callSelectStart(event);
    } else if (hook === 'onSelecting') {
      this.callSelecting(event.target);
    } else if (hook === 'onSelect') {
      this.callSelect(event);
    } else {
      this.callSelectEnd(event);
    }
  };

  invokeManipulation = (script: Script, event: ManipulationEvent): boolean =>
    this.callTargeted([script], 'onObjectManipulate', (target) =>
      target.onObjectManipulate(event)
    );

  private handleException(error: Error, script: Script, context: string) {
    console.error(
      `An error occurred in script ${
        script.name || script.constructor.name
      } [${context}]:`,
      error
    );

    this.dispatchEvent({
      type: ScriptsManagerEventType.EXCEPTION,
      scriptName: script.name || script.constructor.name,
      context,
      error,
      timestamp: performance.now(),
    });
  }

  /**
   * Calls one targeted hook along a captured Script path. Only a literal true
   * return value stops propagation. Developer errors use the same exception
   * policy as global Script callbacks.
   */
  callTargeted(
    path: readonly Script[],
    context: string,
    callback: (script: Script) => boolean | void
  ): boolean {
    const catchExceptions = this.catchExceptions;
    for (const script of path) {
      if (!catchExceptions) {
        if (callback(script) === true) return true;
        continue;
      }

      try {
        if (callback(script) === true) return true;
      } catch (error: unknown) {
        this.handleException(
          error instanceof Error ? error : new Error(String(error)),
          script,
          context
        );
      }
    }
    return false;
  }

  /**
   * Initializes a script and adds it to the set of scripts which will receive
   * callbacks. This will be called automatically by Core when a script is found
   * in the scene but can also be called manually.
   * @param script - The script to initialize
   * @returns A promise which resolves when the script is initialized.
   */
  async initScript(script: Script) {
    if (this.scripts.has(script) || this.initializingScripts.has(script)) {
      return;
    }
    this.initializingScripts.add(script);
    await this.initScriptFunction(script);
    this.scripts.add(script);
    this.initializingScripts.delete(script);
  }

  /**
   * Uninitializes a script calling dispose and removes it from the set of
   * scripts which will receive callbacks.
   * @param script - The script to uninitialize.
   */
  uninitScript(script: Script) {
    if (!this.scripts.has(script)) {
      return;
    }
    script.dispose();
    this.scripts.delete(script);
    this.initializingScripts.delete(script);
  }

  /**
   * Helper for scene traversal to avoid closure allocation.
   */
  private checkScript = (obj: THREE.Object3D) => {
    if ((obj as MaybeScript).isXRScript) {
      const script = obj as Script;
      this.syncPromises.push(this.initScript(script));
      this.seenScripts.add(script);
    }
  };

  /**
   * Finds all scripts in the scene and initializes them or uninitailizes them.
   * Returns a promise which resolves when all new scripts are finished
   * initalizing.
   * @param scene - The main scene which is used to find scripts.
   */
  syncScriptsWithScene(
    scene: THREE.Scene
  ): Promise<PromiseSettledResult<void>[]> {
    this.seenScripts.clear();
    this.syncPromises.length = 0;

    scene.traverse(this.checkScript);

    // Delete missing scripts.
    for (const script of this.scripts) {
      if (!this.seenScripts.has(script)) {
        this.uninitScript(script);
      }
    }

    return Promise.allSettled(this.syncPromises);
  }

  resetUX = () => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.ux.reset();
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'ux.reset'
          );
        }
      } else {
        script.ux.reset();
      }
    }
  };

  callSelecting = (controller: Controller) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSelecting({target: controller});
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSelecting'
          );
        }
      } else {
        script.onSelecting({target: controller});
      }
    }
  };

  callSqueezing = (controller: Controller) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSqueezing({target: controller});
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSqueezing'
          );
        }
      } else {
        script.onSqueezing({target: controller});
      }
    }
  };

  update = (time: number, frame: XRFrame) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.update(time, frame);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'update'
          );
        }
      } else {
        script.update(time, frame);
      }
    }
  };

  physicsStep = () => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.physicsStep();
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'physicsStep'
          );
        }
      } else {
        script.physicsStep();
      }
    }
  };

  callSelectStart = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSelectStart(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSelectStart'
          );
        }
      } else {
        script.onSelectStart(event);
      }
    }
  };

  callSelectEnd = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSelectEnd(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSelectEnd'
          );
        }
      } else {
        script.onSelectEnd(event);
      }
    }
  };

  callSelect = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSelect(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSelect'
          );
        }
      } else {
        script.onSelect(event);
      }
    }
  };

  callSqueezeStart = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSqueezeStart(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSqueezeStart'
          );
        }
      } else {
        script.onSqueezeStart(event);
      }
    }
  };

  callSqueezeEnd = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSqueezeEnd(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSqueezeEnd'
          );
        }
      } else {
        script.onSqueezeEnd(event);
      }
    }
  };

  callSqueeze = (event: SelectEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSqueeze(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSqueeze'
          );
        }
      } else {
        script.onSqueeze(event);
      }
    }
  };

  callKeyDown = (event: KeyEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onKeyDown(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onKeyDown'
          );
        }
      } else {
        script.onKeyDown(event);
      }
    }
  };

  callKeyUp = (event: KeyEvent) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onKeyUp(event);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onKeyUp'
          );
        }
      } else {
        script.onKeyUp(event);
      }
    }
  };

  onXRSessionStarted = (session: XRSession) => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onXRSessionStarted(session);
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onXRSessionStarted'
          );
        }
      } else {
        script.onXRSessionStarted(session);
      }
    }
  };

  onXRSessionEnded = () => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onXRSessionEnded();
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onXRSessionEnded'
          );
        }
      } else {
        script.onXRSessionEnded();
      }
    }
  };

  onSimulatorStarted = () => {
    const catchExceptions = this.catchExceptions;
    for (const script of this.scripts) {
      if (catchExceptions) {
        try {
          script.onSimulatorStarted();
        } catch (error: unknown) {
          this.handleException(
            error instanceof Error ? error : new Error(String(error)),
            script,
            'onSimulatorStarted'
          );
        }
      } else {
        script.onSimulatorStarted();
      }
    }
  };
}
