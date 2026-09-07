/**
 * The parts of `GET /api/v1/qr/{id}/download` that are decided by input alone: which format was
 * asked for, and what the file is called once it lands on the owner's disk.
 *
 * Split out of `route.ts` for the reason `qr-source.ts` is split out of the list route — nothing
 * here imports `next/server`, `@ai-review/db` or `@ai-review/core`, so the rules can be exercised
 * as plain functions. That matters more here than anywhere else in this route: the header safety
 * below is asserted to be correct *by construction*, and an assertion of that kind is worth very
 * little until something fails when it stops holding.
 */

export const FORMATS = ['svg', 'png'] as const;
export type QrFormat = (typeof FORMATS)[number];

/** Illegal in a filename on Windows, and `/` and `\` are path separators everywhere. */
const RESERVED_FILENAME_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

/**
 * 08_OpenAPI_v1.yaml declares format as svg|png with svg as the default, so an absent parameter is
 * valid and means svg rather than being an error.
 */
export function parseFormat(raw: string | null): QrFormat | null {
  if (raw === null || raw.trim() === '') return 'svg';

  const normalized = raw.trim().toLowerCase();
  for (const format of FORMATS) {
    if (format === normalized) return format;
  }
  return null;
}

/**
 * RFC 6266 Content-Disposition carrying both filename forms.
 *
 * The ASCII `filename` is built by allowlist — everything outside [A-Za-z0-9] collapses to a
 * hyphen — rather than by stripping characters known to be dangerous. That is what makes
 * quoted-string escape and header injection impossible by construction instead of by enumeration:
 * a source label containing a quote, a backslash or a CRLF cannot produce one in the header.
 *
 * `filename*` carries the real label so a Devanagari or Tamil source label arrives intact rather
 * than as a row of hyphens, which matters for an India-first product. The opaque code is appended
 * to both forms: two standees both labelled "Counter" stay distinguishable on disk, a printed file
 * can be matched back to the source label that appears in analytics (QR-01 acceptance note), and
 * the suffix incidentally means the stem can never equal a Windows reserved device name — a label
 * of "NUL" yields "NUL-ABCDEFGHJK", which is an ordinary filename.
 */
export function contentDisposition(sourceLabel: string, code: string, format: QrFormat): string {
  const label = filenameLabel(sourceLabel);
  const ascii = `${asciiStem(label, code)}.${format}`;
  const encoded = encodeRfc5987(`${label}-${code}.${format}`);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function asciiStem(label: string, code: string): string {
  const stem = label
    // NFKD followed by dropping combining marks turns "CafÃ©" into "Cafe" rather than "Caf-".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    // Truncate before the final trim, so a hyphen landing on the cut is not left dangling.
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');

  // A label with nothing ASCII-representable in it at all — a wholly Devanagari or Tamil one — is
  // a normal case here, not an error. The real name still travels in filename*.
  return stem.length > 0 ? `${stem}-${code}` : `qr-${code}`;
}

/**
 * Reduces the label to something that is a legal filename on Windows, macOS and Linux alike.
 *
 * Control characters, path separators and the characters Windows reserves (: * ? " < > |) all
 * become spaces, and leading or trailing dots are dropped. Two of those go beyond tidiness:
 * removing path separators and any leading ".." means a label can never contribute a traversal
 * segment to `filename*`, even though RFC 6266 makes stripping path information the recipient's
 * job — and Windows is the realistic download target for a merchant sending artwork to a printer.
 *
 * Iterating by code point rather than by code unit guarantees a surrogate pair is never split, and
 * an unpaired surrogate — which `for...of` yields on its own, and which encodeURIComponent throws
 * URIError on — is dropped alongside the control characters. Without that, `encodeRfc5987` throws
 * from outside the route's render try/catch and a download answers 500 rather than a file. Postgres
 * will not store one today, since a lone surrogate is not representable in UTF-8, so this guards
 * the claim rather than a live path — but the claim is what the header safety here rests on, so it
 * is true by construction now instead of by luck.
 */
export function filenameLabel(value: string): string {
  let out = '';
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    const isControl = point < 0x20 || (point >= 0x7f && point <= 0x9f);
    const isLoneSurrogate = point >= 0xd800 && point <= 0xdfff;
    out += isControl || isLoneSurrogate || RESERVED_FILENAME_CHARS.has(char) ? ' ' : char;
  }

  // Leading and trailing dots and spaces go in one pass each, as a single run. Stripping dots and
  // whitespace in separate passes is not equivalent: "../../etc/passwd" becomes ".. .. etc passwd"
  // once the separators are spaced out, and one leading-dot strip then leaves ".. etc passwd".
  const cleaned = out
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s]+/u, '')
    .replace(/[.\s]+$/u, '');

  // Empty is reachable rather than exceptional: source_label need only be one character long, and
  // that character may be a space or a dot.
  return cleaned.length > 0 ? cleaned : 'qr';
}

/**
 * RFC 5987 attr-char is a narrower set than encodeURIComponent leaves unescaped, so the four
 * characters it permits and the RFC does not — apostrophe, parentheses and asterisk — are escaped
 * by hand.
 */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
