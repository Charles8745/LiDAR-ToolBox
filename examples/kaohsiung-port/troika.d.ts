declare module '*.woff?url' { const url: string; export default url; }

declare module 'troika-three-text' {
  import { Mesh, Color } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: number | string | Color;
    anchorX: number | 'left' | 'center' | 'right';
    anchorY: number | 'top' | 'middle' | 'bottom';
    outlineWidth: number | string;
    outlineColor: number | string | Color;
    outlineOpacity: number;
    fillOpacity: number;
    depthOffset: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
