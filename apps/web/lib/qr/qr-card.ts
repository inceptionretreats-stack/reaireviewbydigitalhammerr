import sharp from 'sharp';

import { outlineText } from './qr-card-text';
import { renderQrSvg } from './qr-image';

export const QR_CARD_WIDTH_PX = 900;
export const QR_CARD_HEIGHT_PX = 1350;

export const QR_CARD_COLORS = {
  canvas: '#eef3fb',
  shell: '#ffffff',
  ink: '#0b1f33',
  muted: '#5f6368',
  line: '#d2e3fc',
  blue: '#4285f4',
  red: '#ea4335',
  yellow: '#fbbc05',
  green: '#34a853',
  /** The "by Digital Hammerr" line in the brand lockup — the same blue-grey as the nav. */
  brandMuted: '#52627a',
} as const;

export interface QrCardBranding {
  businessName: string;
}

const FALLBACK_BUSINESS_NAME = 'Your Business';
const MAX_NAME_LINE_LENGTH = 28;
const QR_PLATE_SIZE = 680;
const QR_MAX_SIZE = 608;
const QR_PLATE_Y = 350;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function normaliseBusinessName(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || FALLBACK_BUSINESS_NAME;
}

/**
 * Keep the visible business name within two predictable lines without browser-only measurement.
 * The full value remains available in the SVG title and description for accessible readers.
 */
function wrapBusinessName(value: string): string[] {
  let remaining = normaliseBusinessName(value);
  const lines: string[] = [];

  while (remaining && lines.length < 2) {
    if (remaining.length <= MAX_NAME_LINE_LENGTH) {
      lines.push(remaining);
      remaining = '';
      break;
    }

    const candidate = remaining.slice(0, MAX_NAME_LINE_LENGTH + 1);
    const lastSpace = candidate.lastIndexOf(' ');
    const splitAt =
      lastSpace >= Math.floor(MAX_NAME_LINE_LENGTH * 0.55) ? lastSpace : MAX_NAME_LINE_LENGTH;

    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining && lines.length === 2) {
    const lastLine = lines[1] ?? '';
    lines[1] = `${lastLine.slice(0, MAX_NAME_LINE_LENGTH - 1).trimEnd()}…`;
  }

  return lines;
}

function qrModuleCount(svg: string): number {
  const match = svg.match(/\bviewBox=["']0 0 ([0-9]+) ([0-9]+)["']/);
  const width = Number(match?.[1] ?? 0);
  const height = Number(match?.[2] ?? 0);
  return Number.isInteger(width) && width > 0 && width === height ? width : 0;
}

function qrPlacement(svg: string): { size: number; x: number; y: number } {
  const moduleCount = qrModuleCount(svg);
  // Integer output pixels per module keep PNG exports crisp and preserve the encoder's quiet zone.
  const size =
    moduleCount > 0 && moduleCount <= QR_MAX_SIZE
      ? Math.floor(QR_MAX_SIZE / moduleCount) * moduleCount
      : QR_MAX_SIZE;
  const plateX = (QR_CARD_WIDTH_PX - QR_PLATE_SIZE) / 2;

  return {
    size,
    x: plateX + (QR_PLATE_SIZE - size) / 2,
    y: QR_PLATE_Y + (QR_PLATE_SIZE - size) / 2,
  };
}

/**
 * The business name as outlined glyphs, one path per line, centred on the card. Paths rather
 * than a text element because the host that rasterises the PNG has no fonts (qr-card-text.ts).
 */
function renderName(lines: string[]): string {
  const firstBaseline = lines.length === 1 ? 250 : 220;
  return lines
    .map((line, index) => {
      const { d } = outlineText(line, {
        weight: 'extrabold',
        size: 50,
        x: 450,
        y: firstBaseline + index * 56,
        anchor: 'middle',
        letterSpacing: -1,
      });
      return `<path data-name-line="${index + 1}" d="${d}" fill="${QR_CARD_COLORS.ink}"/>`;
    })
    .join('');
}

/**
 * The brand lockup from the site header — four bars, "Ai Review", "by Digital Hammerr" — drawn
 * at card scale and centred as one group. The product owner asked for the logo here rather than
 * a "By Digital Hammerr" line, so the printout carries the same mark as the screen.
 */
function renderBrandLockup(): string {
  const barWidth = 19;
  const barGap = 10;
  const barHeights = [48, 74, 93, 112];
  const barColors = [
    QR_CARD_COLORS.blue,
    QR_CARD_COLORS.red,
    QR_CARD_COLORS.yellow,
    QR_CARD_COLORS.green,
  ];
  const barsWidth = barWidth * barHeights.length + barGap * (barHeights.length - 1);
  const barsBottom = 1232;
  const copyGap = 38;

  const name = outlineText('Ai Review', {
    weight: 'extrabold',
    size: 58,
    x: 0,
    y: 1178,
    letterSpacing: -2,
  });
  const byLine = outlineText('by Digital Hammerr', { weight: 'semibold', size: 37, x: 0, y: 1222 });
  const copyWidth = Math.max(name.width, byLine.width);
  const left = Math.round((QR_CARD_WIDTH_PX - (barsWidth + copyGap + copyWidth)) / 2);
  const copyX = left + barsWidth + copyGap;

  const bars = barHeights
    .map((height, index) => {
      const x = left + index * (barWidth + barGap);
      return `<rect x="${x}" y="${barsBottom - height}" width="${barWidth}" height="${height}" rx="${barWidth / 2}" fill="${barColors[index]}"/>`;
    })
    .join('');

  return `<g data-role="brand-credit" role="img" aria-label="Ai Review by Digital Hammerr">
    ${bars}
    <path data-brand-part="name" transform="translate(${copyX} 0)" d="${name.d}" fill="${QR_CARD_COLORS.ink}"/>
    <path data-brand-part="by" transform="translate(${copyX} 0)" d="${byLine.d}" fill="${QR_CARD_COLORS.brandMuted}"/>
  </g>`;
}

/**
 * Render the exact three-part counter card requested by the product owner: business name, QR and
 * the Ai Review brand lockup. The machine-readable symbol is embedded byte-for-byte from the
 * shared encoder on opaque white with its four-module quiet zone intact. Every piece of text is
 * outlined into paths, so the SVG and the PNG carry no dependency on the host's fonts.
 */
export async function renderQrCardSvg(payload: string, branding: QrCardBranding): Promise<string> {
  const businessName = normaliseBusinessName(branding.businessName);
  const rawQrSvg = await renderQrSvg(payload);
  const qrDataUri = `data:image/svg+xml;base64,${Buffer.from(rawQrSvg).toString('base64')}`;
  const placement = qrPlacement(rawQrSvg);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_CARD_WIDTH_PX}" height="${QR_CARD_HEIGHT_PX}" viewBox="0 0 ${QR_CARD_WIDTH_PX} ${QR_CARD_HEIGHT_PX}" role="img" aria-labelledby="cardTitle cardDescription">
  <title id="cardTitle">QR card for ${escapeXml(businessName)}</title>
  <desc id="cardDescription">${escapeXml(businessName)} business name above a QR code, with the Ai Review by Digital Hammerr logo below.</desc>
  <defs>
    <filter id="shellShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="30" flood-color="#0b1f33" flood-opacity="0.14"/>
    </filter>
    <filter id="qrShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="13" stdDeviation="18" flood-color="#0b1f33" flood-opacity="0.12"/>
    </filter>
    <clipPath id="shellClip"><rect x="20" y="20" width="860" height="1310" rx="68"/></clipPath>
  </defs>

  <rect width="${QR_CARD_WIDTH_PX}" height="${QR_CARD_HEIGHT_PX}" fill="${QR_CARD_COLORS.canvas}"/>
  <rect x="20" y="20" width="860" height="1310" rx="68" fill="${QR_CARD_COLORS.shell}" filter="url(#shellShadow)"/>
  <g clip-path="url(#shellClip)">
    <rect x="20" y="20" width="215" height="18" fill="${QR_CARD_COLORS.blue}"/>
    <rect x="235" y="20" width="215" height="18" fill="${QR_CARD_COLORS.red}"/>
    <rect x="450" y="20" width="215" height="18" fill="${QR_CARD_COLORS.yellow}"/>
    <rect x="665" y="20" width="215" height="18" fill="${QR_CARD_COLORS.green}"/>
  </g>

  <g data-role="business-name" role="img" aria-label="${escapeXml(businessName)}">${renderName(wrapBusinessName(businessName))}</g>

  <rect x="110" y="${QR_PLATE_Y}" width="${QR_PLATE_SIZE}" height="${QR_PLATE_SIZE}" rx="42" fill="#ffffff" stroke="${QR_CARD_COLORS.line}" stroke-width="3" filter="url(#qrShadow)"/>
  <path d="M154 394h-24v24" fill="none" stroke="${QR_CARD_COLORS.blue}" stroke-width="9" stroke-linecap="round"/>
  <path d="M746 394h24v24" fill="none" stroke="${QR_CARD_COLORS.red}" stroke-width="9" stroke-linecap="round"/>
  <path d="M154 986h-24v-24" fill="none" stroke="#f9ab00" stroke-width="9" stroke-linecap="round"/>
  <path d="M746 986h24v-24" fill="none" stroke="${QR_CARD_COLORS.green}" stroke-width="9" stroke-linecap="round"/>
  <image data-role="qr-code" href="${qrDataUri}" x="${placement.x}" y="${placement.y}" width="${placement.size}" height="${placement.size}" image-rendering="pixelated"/>

  ${renderBrandLockup()}
</svg>`;
}

/** Raster companion for print shops and owners that do not accept SVG files. */
export async function renderQrCardPng(payload: string, branding: QrCardBranding): Promise<Buffer> {
  const svg = await renderQrCardSvg(payload, branding);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
