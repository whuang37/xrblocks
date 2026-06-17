import type {
  EmbodiedControlStep,
  EmbodiedControlStepResult,
  XRCompoundControl,
} from '../embodied-control';

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

export type RemoteControlStepMessage = EmbodiedControlStep & {
  type: 'STEP';
  control: XRCompoundControl;
};

export type RemoteControlStepCompletedMessage = EmbodiedControlStepResult & {
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

export function isStepMessage(
  value: unknown
): value is RemoteControlStepMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RemoteControlStepMessage>;
  return message.type === 'STEP' && !!message.control;
}

export function parseRemoteControlMessage(data: MessageEvent['data']): unknown {
  if (typeof data !== 'string') {
    throw new Error('Remote control messages must be JSON strings.');
  }
  return JSON.parse(data);
}
