import type {XBObjectOptions} from '../../interaction/manipulation/ManipulationTypes';

/**
 * Options for View.
 */
export type ViewOptions = {
  xb?: XBObjectOptions;
  name?: string;
  isRoot?: boolean;
  selectable?: boolean;
  weight?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  z?: number;
  paddingX?: number;
  paddingY?: number;
  paddingZ?: number;
  opacity?: number;
};
