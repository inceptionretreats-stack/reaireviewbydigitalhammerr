import { describe, expect, it } from 'vitest';
import {
  asciiStem,
  contentDisposition,
  encodeRfc5987,
  filenameLabel,
  parseFormat,
} from '../filename';

/**
 * The download route claims that quoted-string escape, CRLF header injection and path traversal are
 * impossible *by construction*, and that a lone surrogate cannot make encodeURIComponent throw. A
 * claim of that kind is worth nothing until something fails when it stops holding, which is what
 * this file is for.
 *
 * The label is tenant-controlled text (`qr_codes.source_label`, set by QR-01's Rename), so every
 * case below is reachable input rather than a hypothetical.
 */

const CODE = 'ABCDEFGHJK';

/** The two RFC 6266 forms, pulled back out of the header the route sends. */
function parseDisposition(header: string): { ascii: string; encoded: string } {
  const match = /^attachment; filename="([^"]*)"; filename\*=UTF-8''(.*)$/u.exec(header);
  const ascii = match?.[1];
  const encoded = match?.[2];
  if (ascii === undefined || encoded === undefined) {
    throw new Error(`unparseable disposition: ${header}`);
  }
  return { ascii, encoded };
}

describe('parseFormat', () => {
  it('defaults to svg for an absent or blank parameter, per 08_OpenAPI_v1.yaml', () => {
    expect(parseFormat(null)).toBe('svg');
    expect(parseFormat('')).toBe('svg');
    expect(parseFormat('   ')).toBe('svg');
  });

  it('accepts either format regardless of case or surrounding space', () => {
    expect(parseFormat('svg')).toBe('svg');
    expect(parseFormat('SVG')).toBe('svg');
    expect(parseFormat(' PNG ')).toBe('png');
  });

  it('refuses anything else rather than falling back to a format', () => {
    // Null is what makes the route answer VALIDATION_FAILED. Defaulting an unknown word to svg
    // would hand a caller that asked for a PDF a file it did not ask for.
    expect(parseFormat('gif')).toBeNull();
    expect(parseFormat('pdf')).toBeNull();
    expect(parseFormat('svg,png')).toBeNull();
  });
});

describe('filenameLabel', () => {
  it('turns path separators and Windows-reserved characters into spaces', () => {
    expect(filenameLabel('Front/Back')).toBe('Front Back');
    expect(filenameLabel('Front\\Back')).toBe('Front Back');
    expect(filenameLabel('Aisle 3: "Tea" <hot>|?*')).toBe('Aisle 3 Tea hot');
  });

  it('strips a traversal prefix rather than leaving one to reach filename*', () => {
    // A single pass over dots-and-spaces as one run is the only thing that gets this right: two
    // separate passes leave ".. etc passwd" behind.
    expect(filenameLabel('../../etc/passwd')).toBe('etc passwd');
    expect(filenameLabel('..\\..\\windows')).toBe('windows');
  });

  it('removes control characters, so a CRLF can never survive into a header', () => {
    expect(filenameLabel('Counter\r\nX-Injected: yes')).toBe('Counter X-Injected yes');
    expect(filenameLabel('Tab\there')).toBe('Tab here');
  });

  it('drops an unpaired surrogate, which encodeURIComponent would otherwise throw on', () => {
    expect(filenameLabel('Counter\ud83d')).toBe('Counter');
    // A real pair is one code point to `for...of` and must survive intact.
    expect(filenameLabel('Counter \u{1f375}')).toBe('Counter \u{1f375}');
  });

  it('falls back to a name when the label reduces to nothing', () => {
    // source_label need only be one character, and that character may be a dot or a space.
    expect(filenameLabel('.')).toBe('qr');
    expect(filenameLabel(' ')).toBe('qr');
    expect(filenameLabel('///')).toBe('qr');
  });
});

describe('asciiStem', () => {
  it('folds accents instead of hyphenating them away', () => {
    expect(asciiStem('Café', CODE)).toBe(`Cafe-${CODE}`);
  });

  it('collapses every non-alphanumeric run to a single hyphen', () => {
    expect(asciiStem('Front desk (main)', CODE)).toBe(`Front-desk-main-${CODE}`);
  });

  it('falls back for a label with nothing ASCII-representable in it', () => {
    // A wholly Devanagari label is a normal case for an India-first product, not an error — the
    // real name still travels in filename*.
    expect(asciiStem('काउंटर', CODE)).toBe(`qr-${CODE}`);
  });

  it('never leaves a dangling hyphen when the truncation lands on one', () => {
    const stem = asciiStem(`${'a'.repeat(39)} tail`, CODE);
    expect(stem).toBe(`${'a'.repeat(39)}-${CODE}`);
    expect(stem).not.toContain('--');
  });

  it('cannot produce a Windows reserved device name, because the code is appended', () => {
    expect(asciiStem('NUL', CODE)).toBe(`NUL-${CODE}`);
    expect(asciiStem('CON', CODE)).toBe(`CON-${CODE}`);
  });
});

describe('encodeRfc5987', () => {
  it('escapes the four characters encodeURIComponent leaves that attr-char forbids', () => {
    expect(encodeRfc5987("'()*")).toBe('%27%28%29%2A');
  });
});

describe('contentDisposition', () => {
  it('emits both filename forms with the code appended', () => {
    expect(contentDisposition('Reception', CODE, 'svg')).toBe(
      `attachment; filename="Reception-${CODE}.svg"; filename*=UTF-8''Reception-${CODE}.svg`,
    );
  });

  it('cannot be made to close the quoted string', () => {
    const header = contentDisposition('Say "hi"; filename="evil.exe', CODE, 'png');
    const { ascii } = parseDisposition(header);
    // Allowlisted to [A-Za-z0-9] plus hyphens: there is no quote or backslash left to escape with.
    expect(ascii).toMatch(/^[A-Za-z0-9-]+\.png$/u);
    expect(header.match(/"/gu)).toHaveLength(2);
  });

  it('cannot inject a header, because no CR or LF survives the label', () => {
    const header = contentDisposition('Counter\r\nSet-Cookie: a=b', CODE, 'svg');
    expect(header).not.toMatch(/[\r\n]/u);
    // The colon is reserved on Windows too, so the label arrives as inert text in both forms and
    // there is no header name left for a client to act on.
    expect(header).not.toContain('Set-Cookie:');
    expect(header).toContain(`filename="Counter-Set-Cookie-a-b-${CODE}.svg"`);
    expect(header).toContain(`Counter%20Set-Cookie%20a%3Db-${CODE}.svg`);
  });

  it('cannot contribute a path segment to either form', () => {
    const header = contentDisposition('../../etc/passwd', CODE, 'svg');
    const { ascii, encoded } = parseDisposition(header);
    expect(ascii).toBe(`etc-passwd-${CODE}.svg`);
    expect(encoded).toBe(`etc%20passwd-${CODE}.svg`);
    for (const form of [ascii, encoded]) {
      expect(form).not.toContain('/');
      expect(form).not.toContain('%2F');
      expect(form).not.toContain('..');
    }
  });

  it('keeps a non-Latin label intact in filename* while filename stays ASCII', () => {
    const { ascii, encoded } = parseDisposition(contentDisposition('काउंटर', CODE, 'png'));
    expect(ascii).toBe(`qr-${CODE}.png`);
    // RFC 6266 needs the header body to be 7-bit; filename* is where the real name lives.
    expect(/^[!-~]+$/u.test(encoded)).toBe(true);
    expect(decodeURIComponent(encoded)).toBe(`काउंटर-${CODE}.png`);
  });

  it('does not throw on an unpaired surrogate', () => {
    expect(() => contentDisposition('Counter\ud83d', CODE, 'svg')).not.toThrow();
    expect(contentDisposition('\ud83d', CODE, 'svg')).toBe(
      `attachment; filename="qr-${CODE}.svg"; filename*=UTF-8''qr-${CODE}.svg`,
    );
  });
});
