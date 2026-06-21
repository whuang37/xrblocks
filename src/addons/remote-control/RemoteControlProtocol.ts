import type {EmbodiedControlStep, XRCompoundControl} from '../embodied-control';
import type {SensorsOptions, SensorsObservation} from '../sensors';

export const REMOTE_CONTROL_PROTOCOL_VERSION = 1;

export type RemoteControlHandshakeMessage = {
  type: 'HANDSHAKE';
  client: 'xrblocks-remote-control';
  version: number;
  capabilities: {
    compoundControl: true;
    embodiedControl: true;
  };
};

export type RemoteControlBaseMessage = {
  id?: string;
  sensors?: SensorsOptions; // Support configuring sensors on any command!
};

export type RemoteControlStepMessage = EmbodiedControlStep &
  RemoteControlBaseMessage & {
    type: 'STEP';
    control: XRCompoundControl;
  };

export type RemoteControlTeleportMessage = RemoteControlBaseMessage & {
  type: 'TELEPORT_TO';
  target: [number, number, number] | string;
  options?: {distance?: number; faceTarget?: boolean; snapToGround?: boolean};
};

export type RemoteControlLookAtMessage = RemoteControlBaseMessage & {
  type: 'LOOK_AT_TARGET';
  target: [number, number, number] | string;
  options?: {velocity?: number};
};

export type RemoteControlPointToMessage = RemoteControlBaseMessage & {
  type: 'POINT_TO';
  handIndex: number;
  target: [number, number, number] | string;
  options?: {velocity?: number};
};

export type RemoteControlReachToMessage = RemoteControlBaseMessage & {
  type: 'REACH_TO';
  handIndex: number;
  target: [number, number, number] | string;
  options?: {velocity?: number};
};

export type RemoteControlClickMessage = RemoteControlBaseMessage & {
  type: 'CLICK';
  handIndex: number;
  options?: {durationMs?: number};
};

export type RemoteControlMessage =
  | RemoteControlStepMessage
  | RemoteControlTeleportMessage
  | RemoteControlLookAtMessage
  | RemoteControlPointToMessage
  | RemoteControlReachToMessage
  | RemoteControlClickMessage;

export type RemoteControlStepResult = {
  id?: string;
  elapsedMs: number;
  observation: SensorsObservation; // Return the rich unified observation!
};

export type RemoteControlStepCompletedMessage = RemoteControlStepResult & {
  type: 'STEP_COMPLETED';
};

export type RemoteControlActionRejectedMessage = {
  type: 'ACTION_REJECTED';
  id?: string;
  reason: 'active_step';
};

export type RemoteControlErrorMessage = {
  type: 'ERROR';
  id?: string;
  message: string;
};

export type RemoteControlOutgoingMessage =
  | RemoteControlHandshakeMessage
  | RemoteControlStepCompletedMessage
  | RemoteControlActionRejectedMessage
  | RemoteControlErrorMessage;

export function createHandshake(): RemoteControlHandshakeMessage {
  return {
    type: 'HANDSHAKE',
    client: 'xrblocks-remote-control',
    version: REMOTE_CONTROL_PROTOCOL_VERSION,
    capabilities: {
      compoundControl: true,
      embodiedControl: true,
    },
  };
}

export function isCommandMessage(
  value: unknown
): value is RemoteControlMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as {type?: string}).type;
  return (
    type === 'STEP' ||
    type === 'TELEPORT_TO' ||
    type === 'LOOK_AT_TARGET' ||
    type === 'POINT_TO' ||
    type === 'REACH_TO' ||
    type === 'CLICK'
  );
}

export function parseRemoteControlMessage(data: MessageEvent['data']): unknown {
  if (typeof data !== 'string') {
    throw new Error('Remote control messages must be JSON strings.');
  }
  return JSON.parse(data);
}
