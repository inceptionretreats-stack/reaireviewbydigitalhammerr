import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import sharp from 'sharp';

import {
  QR_CARD_COLORS,
  QR_CARD_HEIGHT_PX,
  QR_CARD_WIDTH_PX,
  renderQrCardPng,
  renderQrCardSvg,
} from '../qr-card';
import { renderQrSvg } from '../qr-image';

const PAYLOAD = 'https://review.digitalhammerr.com/r/example-source';

function embeddedQr(svg: string): string {
  const encoded = svg.match(
    /<image data-role="qr-code" href="data:image\/svg\+xml;base64,([^"]+)"/,
  )?.[1];
  if (!encoded) throw new Error('QR image was not embedded in the card');
  return Buffer.from(encoded, 'base64').toString();
}

describe('renderQrCardSvg', () => {
  it('builds a self-contained three-part card around the untouched shared QR symbol', async () => {
    const card = await renderQrCardSvg(PAYLOAD, { businessName: 'Aster Coffee House' });

    expect(card).toContain(`width="${QR_CARD_WIDTH_PX}" height="${QR_CARD_HEIGHT_PX}"`);
    expect(card).toContain('viewBox="0 0 900 1350"');
    expect(card).toContain('Aster Coffee House');
    expect(card).toContain('aria-label="Ai Review by Digital Hammerr"');
    expect(card).toContain('data-role="business-name"');
    expect(card).toContain('data-role="qr-code"');
    expect(card).toContain('data-role="brand-credit"');
    // Every glyph is a path: the host that rasterises this has no fonts (see qr-card-text.ts).
    expect(card).not.toMatch(/<text\b/);
    expect(card).not.toMatch(/font-family/);
    expect(card.match(/data-name-line=/g)).toHaveLength(1);
    expect(card).toContain('data-brand-part="name"');
    expect(card).toContain('data-brand-part="by"');
    expect(card.match(/<image\b/g)).toHaveLength(1);
    expect(card).not.toMatch(/YOUR EXPERIENCE MATTERS|Scan for your review draft|SCAN TO BEGIN/);
    expect(card).not.toMatch(/data-role="business-(?:logo|initials)"/);
    expect(embeddedQr(card)).toBe(await renderQrSvg(PAYLOAD));
  });

  it('uses Google-inspired accents without the retired purple or warm card themes', async () => {
    const card = await renderQrCardSvg(PAYLOAD, { businessName: 'Aster Coffee House' });

    expect(card).toContain(QR_CARD_COLORS.canvas);
    expect(card).toContain(QR_CARD_COLORS.shell);
    expect(card).toContain(QR_CARD_COLORS.ink);
    for (const brandColor of [
      QR_CARD_COLORS.blue,
      QR_CARD_COLORS.red,
      QR_CARD_COLORS.yellow,
      QR_CARD_COLORS.green,
    ]) {
      expect(card).toContain(brandColor);
    }
    for (const retiredColor of [
      '#f7f4fb',
      '#eee8f8',
      '#6d35d6',
      '#45239a',
      '#7b47df',
      '#9b76ec',
      '#24153f',
      '#26134f',
      '#eee9f6',
      '#d9cbf4',
      '#c8b3ef',
      '#e9e0fa',
      '#eee7ff',
      '#ede8f5',
      '#d7c7fa',
      '#c7472b',
      '#932f1f',
      '#df7253',
      '#85291b',
    ]) {
      expect(card.toLowerCase()).not.toContain(retiredColor);
    }
  });

  it('escapes hostile business copy and constrains a long name to two lines', async () => {
    const card = await renderQrCardSvg(PAYLOAD, {
      businessName: 'A&B <script>alert("hello")</script> Extraordinarily Long Coffee Company Name',
    });

    expect(card).not.toContain('<script>');
    expect(card).toContain('A&amp;B &lt;script&gt;');
    expect(card).toContain('&quot;hello&quot;');
    expect(card.match(/data-name-line=/g)).toHaveLength(2);
    // The glyphs are paths; the name reaches the markup only as escaped accessible text in the
    // title, description and aria-label. The ellipsised second line is a path like the rest.
  });

  it('uses a safe fallback when the business name is blank', async () => {
    const card = await renderQrCardSvg(PAYLOAD, { businessName: '   ' });

    expect(card).toContain('Your Business');
    expect(card.match(/data-name-line=/g)).toHaveLength(1);
    expect(card.match(/<image\b/g)).toHaveLength(1);
  });
});

describe('renderQrCardPng', () => {
  it('rasterises the complete card at its print dimensions', async () => {
    const png = await renderQrCardPng(PAYLOAD, { businessName: 'Aster Coffee House' });

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(QR_CARD_WIDTH_PX);
    expect(png.readUInt32BE(20)).toBe(QR_CARD_HEIGHT_PX);
  });

  /**
   * The first PNG printed from production had a blank where the name should be: the card wrote
   * its text with a font the Linux host did not have. This looks at the pixels, not the markup,
   * so a regression of that kind fails on any machine.
   */
  it('actually paints the business name and the brand lockup', async () => {
    const png = await renderQrCardPng(PAYLOAD, { businessName: 'Aster Coffee House' });
    const inkInBand = async (top: number, height: number) => {
      const raster = await sharp(png)
        .extract({ left: 0, top, width: QR_CARD_WIDTH_PX, height })
        .ensureAlpha()
        .raw()
        .toBuffer();
      let dark = 0;
      for (let i = 0; i < raster.length; i += 4) {
        if (raster[i]! < 80 && raster[i + 1]! < 80 && raster[i + 2]! < 100) dark += 1;
      }
      return dark;
    };
    // Name band, and the "Ai Review" line of the lockup.
    expect(await inkInBand(190, 80)).toBeGreaterThan(2_000);
    expect(await inkInBand(1130, 60)).toBeGreaterThan(1_500);
    // The four bars carry the brand colours.
    const lockup = await sharp(png)
      .extract({ left: 150, top: 1110, width: 250, height: 140 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const seen = new Set<string>();
    for (let i = 0; i < lockup.length; i += 4) {
      seen.add(`${lockup[i]},${lockup[i + 1]},${lockup[i + 2]}`);
    }
    for (const hex of [
      QR_CARD_COLORS.blue,
      QR_CARD_COLORS.red,
      QR_CARD_COLORS.yellow,
      QR_CARD_COLORS.green,
    ]) {
      const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(',');
      expect(seen.has(rgb)).toBe(true);
    }
  });

  it('keeps the final branded PNG scannable as the exact dynamic URL', async () => {
    const png = await renderQrCardPng(PAYLOAD, { businessName: 'Aster Coffee House' });
    const raster = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(
      new Uint8ClampedArray(raster.data),
      raster.info.width,
      raster.info.height,
      { inversionAttempts: 'dontInvert' },
    );

    expect(decoded?.data).toBe(PAYLOAD);
  });
});
