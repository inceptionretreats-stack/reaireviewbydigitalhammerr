import opentype, { type Font } from 'opentype.js';

import { INTER_EXTRABOLD_WOFF_BASE64, INTER_SEMIBOLD_WOFF_BASE64 } from './qr-card-fonts.generated';

/**
 * Text for the printable QR card, as SVG path data.
 *
 * The card is rasterised by sharp (librsvg), which draws `<text>` with whatever fonts the host
 * has. This laptop has Arial; the Linux host the product runs on has none, and the first PNG
 * printed from production had a blank where the business name should be. Outlining the glyphs
 * here with a bundled face removes the host from the equation: the SVG carries only shapes, so
 * the PNG is the same on every machine, and the SVG download looks identical to the PNG.
 */

export type CardWeight = 'semibold' | 'extrabold';

const sources: Record<CardWeight, string> = {
  semibold: INTER_SEMIBOLD_WOFF_BASE64,
  extrabold: INTER_EXTRABOLD_WOFF_BASE64,
};

const loaded = new Map<CardWeight, Font>();

function font(weight: CardWeight): Font {
  let face = loaded.get(weight);
  if (!face) {
    const bytes = Buffer.from(sources[weight], 'base64');
    face = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    loaded.set(weight, face);
  }
  return face;
}

export interface OutlinedText {
  /** SVG path data, positioned so the text's baseline sits at `y`. */
  d: string;
  /** Advance width at the requested size, before letter-spacing. */
  width: number;
}

export interface OutlineOptions {
  weight: CardWeight;
  size: number;
  /** Baseline y. */
  y: number;
  /** x of the anchor point. */
  x: number;
  anchor?: 'start' | 'middle' | 'end';
  /** Extra tracking in px per glyph gap. */
  letterSpacing?: number;
}

export function outlineText(text: string, options: OutlineOptions): OutlinedText {
  const face = font(options.weight);
  const letterSpacing = options.letterSpacing ?? 0;
  const renderOptions = { kerning: true, letterSpacing: letterSpacing / options.size };
  const width = face.getAdvanceWidth(text, options.size, renderOptions);
  const anchor = options.anchor ?? 'start';
  const startX =
    anchor === 'middle' ? options.x - width / 2 : anchor === 'end' ? options.x - width : options.x;
  const path = face.getPath(text, startX, options.y, options.size, renderOptions);
  return { d: path.toPathData(2), width };
}
