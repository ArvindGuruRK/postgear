/** The small part of fontkit 2 (MIT) the sticker art script uses; fontkit ships no types. */
declare module 'fontkit' {
  export interface FontkitBBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export interface FontkitPath {
    bbox: FontkitBBox;
    scale(scaleX: number, scaleY?: number): FontkitPath;
    translate(x: number, y: number): FontkitPath;
    toSVG(): string;
  }

  export interface FontkitGlyph {
    path: FontkitPath;
  }

  export interface FontkitPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }

  export interface FontkitFont {
    familyName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    capHeight: number;
    layout(text: string): { glyphs: FontkitGlyph[]; positions: FontkitPosition[] };
  }

  export function openSync(file: string): FontkitFont;
}
