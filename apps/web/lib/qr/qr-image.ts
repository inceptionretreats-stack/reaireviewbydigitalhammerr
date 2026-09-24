import * as QRCode from 'qrcode';

/**
 * One encoder configuration for every QR this product draws.
 *
 * The preview an owner sees on screen and the file they send to a printer have to be the same
 * symbol. If they are encoded with different settings they are different codes — and the way that
 * failure shows up is a standee that does not scan, discovered after a print run rather than in
 * the dashboard. Keeping the settings in one module is what makes "what you see is what you print"
 * a property of the code rather than a promise in a comment.
 */

/**
 * Error-correction level H recovers ~30% of a damaged symbol, against ~25% for Q.
 *
 * A QR on a shop counter gets scuffed, wiped and taped over, and the correction level is what
 * decides whether it still scans after that. H costs four extra modules per side for this payload
 * (41x41 rather than 37x37) — roughly 10% smaller modules at a fixed print size, which is not a
 * material change to scan distance at standee size. Trading a little optical margin for a lot of
 * damage tolerance is the right way round for a printed asset that cannot be reprinted cheaply.
 */
export const ERROR_CORRECTION = 'H';

/**
 * The four-module quiet zone required by ISO/IEC 18004. It is not decoration: without it a scanner
 * has nothing to lock the symbol's edges against, and a QR bled to the edge of printed artwork is
 * one of the commonest reasons a code that looks fine does not scan.
 */
export const QUIET_ZONE_MODULES = 4;

/**
 * A server-fixed size — the client cannot ask for a larger one, so no single request can be turned
 * into an expensive raster (raster cost grows with the pixel count). At 300 DPI this prints ~87mm
 * square, a correct counter-standee QR. Anything larger should use the SVG, which is
 * resolution-independent and is the reason the vector format is offered at all.
 */
export const IMAGE_WIDTH_PX = 1024;

/**
 * Pure black on pure white, never the tenant's brand accent. Maximum luminance contrast is what a
 * scanner thresholds against, and a printed QR has no second channel to fall back on — the same
 * "never rely on colour alone" principle as AC-038, applied to a machine reader. The explicit
 * opaque white matters too: a transparent quiet zone would let a coloured standee background show
 * through and destroy the very margin QUIET_ZONE_MODULES reserves.
 *
 * It is also why every on-screen preview keeps a white plate under it in dark mode.
 */
export const PRINT_COLORS = { dark: '#000000', light: '#ffffff' } as const;

/**
 * The machine-readable vector nested unchanged inside the branded download artwork.
 *
 * Keeping this primitive separate lets compact dashboard and onboarding previews stay square while
 * `qr-card.ts` adds print branding outside the quiet zone.
 */
export async function renderQrSvg(payload: string): Promise<string> {
  // `width` is honoured alongside the viewBox, so the file still scales losslessly but opens at a
  // sensible size instead of 41 pixels across when the owner double-clicks it.
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE_MODULES,
    width: IMAGE_WIDTH_PX,
    color: PRINT_COLORS,
  });
}

/**
 * The same symbol as a data URI, for rendering inline in a Server Component.
 *
 * A data URI rather than an <img> pointing at the download endpoint: the markup then carries the
 * code itself, so a preview cannot show a stale or a differently-encoded symbol, and a list of
 * sources costs no extra authenticated round trips.
 */
export async function qrDataUri(payload: string): Promise<string> {
  const svg = await renderQrSvg(payload);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
