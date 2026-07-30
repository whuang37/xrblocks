import type {ViewOptions} from './ViewOptions';

export type PanelOptions = ViewOptions & {
  backgroundColor?: string;
  touchable?: boolean;
  isRoot?: boolean;
  width?: number;
  height?: number;

  showHighlights?: boolean;
  useDefaultPosition?: boolean;
  useBorderlessShader?: boolean;
  borderWidth?: number;
};
