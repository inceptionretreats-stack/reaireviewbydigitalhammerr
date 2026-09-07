import { describe, expect, it } from 'vitest';
import {
  isQrSourceId,
  isQrStatus,
  parseQrSourceCreate,
  parseQrSourcePatch,
  toQrSourceWire,
} from '../qr-source';
// The client pre-check, imported across the boundary on purpose: the point of the length tests
// below is that the dialog and the endpoint measure the same string. A relative path because the
// unit suite runs without Next's `@/` alias (vitest.config.mts).
import {
  LABEL_MAX,
  NOTE_MAX,
  labelError,
  noteError,
} from '../../../../../components/dashboard/qr/qr-sources';

/**
 * Request validation for the QR-01 write endpoints.
 *
 * These are the rules that cannot be re-checked later: a stored blank label is an unattributable
 * row in analytics (QR-01-03), and a body that appears to rename the printed code is a promise the
 * product cannot keep (QR-01-01). Exercised as functions because the handlers themselves need a
 * session, a database and `next/server`.
 */

describe('parseQrSourceCreate', () => {
  it('accepts a label and stores no note when none was given', () => {
    const result = parseQrSourceCreate({ source_label: 'Reception' });
    expect(result).toEqual({ ok: true, value: { sourceLabel: 'Reception', internalNote: null } });
  });

  it('trims the label, since it becomes the attribution key in analytics (QR-01-03)', () => {
    const result = parseQrSourceCreate({ source_label: '  Billing Counter  ' });
    expect(result.ok && result.value.sourceLabel).toBe('Billing Counter');
  });

  it('rejects a label that is only whitespace, which z.string().min(1) accepts', () => {
    const result = parseQrSourceCreate({ source_label: '   ' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['source_label']);
  });

  it('rejects a missing label', () => {
    const result = parseQrSourceCreate({ internal_note: 'By the till' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['source_label']);
  });

  it('rejects a label past the column width', () => {
    const result = parseQrSourceCreate({ source_label: 'x'.repeat(121) });
    expect(result.ok).toBe(false);
  });

  it('measures the label after trimming, as the dialog does', () => {
    // The dialog trims before counting (`labelError`) and `Input` caps typing at LABEL_MAX, so a
    // pasted 120-character label with a stray space passed the client check and then hit
    // z.string().max(120) at 124 here — a 422 saying only "check the details you entered" for a
    // label that is exactly the width the column allows once stored.
    const padded = `  ${'x'.repeat(LABEL_MAX)}  `;
    const result = parseQrSourceCreate({ source_label: padded });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sourceLabel).toBe('x'.repeat(LABEL_MAX));
  });

  it('and still refuses one that is too long after trimming', () => {
    const result = parseQrSourceCreate({ source_label: `  ${'x'.repeat(LABEL_MAX + 1)}  ` });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['source_label']);
  });

  it('measures the note after trimming too', () => {
    const padded = ` ${'x'.repeat(NOTE_MAX)} `;
    const result = parseQrSourceCreate({ source_label: 'Reception', internal_note: padded });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.internalNote).toBe('x'.repeat(NOTE_MAX));

    const over = parseQrSourceCreate({
      source_label: 'Reception',
      internal_note: ` ${'x'.repeat(NOTE_MAX + 1)} `,
    });
    expect(over.ok).toBe(false);
  });

  it('keeps saying what a source label is for when the label trims away (QR-01-03)', () => {
    // Trimming first means a whitespace label reaches the contract as '' and would otherwise fail
    // min(1) as the generic message. The specific one is the useful one.
    const result = parseQrSourceCreate({ source_label: '  ' });
    expect(!result.ok && result.message).toMatch(/Reception/);
  });

  it('does not edit the body it was handed', () => {
    const body = { source_label: '  Reception  ', internal_note: ' by the till ' };
    parseQrSourceCreate(body);
    expect(body).toEqual({ source_label: '  Reception  ', internal_note: ' by the till ' });
  });

  it('rejects a note past the column width', () => {
    const result = parseQrSourceCreate({
      source_label: 'Reception',
      internal_note: 'x'.repeat(501),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['internal_note']);
  });

  it('stores a blank note as null rather than as an empty string', () => {
    const result = parseQrSourceCreate({ source_label: 'Reception', internal_note: '   ' });
    expect(result.ok && result.value.internalNote).toBeNull();
  });

  it('trims a note it keeps', () => {
    const result = parseQrSourceCreate({
      source_label: 'Reception',
      internal_note: ' front desk ',
    });
    expect(result.ok && result.value.internalNote).toBe('front desk');
  });
});

describe('parseQrSourcePatch', () => {
  it('reads a rename on its own', () => {
    const result = parseQrSourcePatch({ source_label: 'Front Desk' });
    expect(result).toEqual({ ok: true, value: { sourceLabel: 'Front Desk' } });
  });

  it('reads a disable and an enable', () => {
    expect(parseQrSourcePatch({ status: 'DISABLED' })).toEqual({
      ok: true,
      value: { status: 'DISABLED' },
    });
    expect(parseQrSourcePatch({ status: 'ACTIVE' })).toEqual({
      ok: true,
      value: { status: 'ACTIVE' },
    });
  });

  it('reads a rename and a status change together', () => {
    const result = parseQrSourcePatch({ source_label: 'Packaging', status: 'DISABLED' });
    expect(result).toEqual({ ok: true, value: { sourceLabel: 'Packaging', status: 'DISABLED' } });
  });

  it('refuses a body that tries to change the printed code (QR-01-01)', () => {
    const result = parseQrSourcePatch({ source_label: 'Reception', code: 'ABCDEFGHJK' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['code']);
    // The message has to say the code is permanent, not merely that the field was unexpected:
    // silently stripping it would let a client believe the standee had been re-pointed.
    expect(!result.ok && result.message).toMatch(/permanent/i);
  });

  it('refuses a body that tries to change the row id', () => {
    const result = parseQrSourcePatch({ id: '11111111-1111-4111-8111-111111111111' });
    expect(result.ok).toBe(false);
  });

  it('rejects a status outside the qr_status enum', () => {
    for (const status of ['ARCHIVED', 'active', 'constructor', '', 1, null, true]) {
      const result = parseQrSourcePatch({ status });
      expect(result.ok, `status ${String(status)} must be rejected`).toBe(false);
      expect(!result.ok && result.fields).toEqual(['status']);
    }
  });

  it('rejects a rename to whitespace', () => {
    const result = parseQrSourcePatch({ source_label: ' ' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['source_label']);
    expect(!result.ok && result.message).toMatch(/Reception/);
  });

  it('measures a rename after trimming, as the dialog does', () => {
    const result = parseQrSourcePatch({ source_label: `  ${'x'.repeat(LABEL_MAX)}  ` });
    expect(result).toEqual({ ok: true, value: { sourceLabel: 'x'.repeat(LABEL_MAX) } });

    const over = parseQrSourcePatch({ source_label: `  ${'x'.repeat(LABEL_MAX + 1)}  ` });
    expect(over.ok).toBe(false);
  });

  it('does not edit the body it was handed', () => {
    const body = { source_label: '  Front Desk  ', status: 'DISABLED' };
    parseQrSourcePatch(body);
    expect(body.source_label).toBe('  Front Desk  ');
  });

  it('clears the note when it is present and blank, and leaves it alone when absent', () => {
    const cleared = parseQrSourcePatch({ internal_note: '' });
    expect(cleared).toEqual({ ok: true, value: { internalNote: null } });

    const untouched = parseQrSourcePatch({ source_label: 'Reception' });
    expect(untouched.ok && 'internalNote' in untouched.value).toBe(false);
  });

  it('rejects an explicit null note, because clearing is done with an empty string', () => {
    const result = parseQrSourcePatch({ internal_note: null });
    expect(result.ok).toBe(false);
  });

  it('refuses a body with nothing to change', () => {
    const result = parseQrSourcePatch({});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual([]);
  });

  it('refuses a body that is not an object', () => {
    for (const raw of [null, 'Reception', 42, ['Reception'], undefined]) {
      expect(parseQrSourcePatch(raw).ok, `${String(raw)} must be rejected`).toBe(false);
    }
  });

  it('ignores a key the contract does not declare rather than failing on it', () => {
    // Zod strips unknown keys. Only `code` and `id` are singled out above, because those two are
    // the ones a caller could reasonably think this endpoint changes.
    const result = parseQrSourcePatch({ source_label: 'Reception', destination: 'google.com' });
    expect(result).toEqual({ ok: true, value: { sourceLabel: 'Reception' } });
  });
});

/**
 * The pre-check in QR-01's dialog and the gate on the endpoint have to agree, or the dialog accepts
 * a value the API then refuses with a message that names no field. This is the pair that diverged:
 * one trimmed before counting and the other did not.
 */
describe('client pre-check and server gate agree', () => {
  const cases = [
    'Reception',
    `  ${'x'.repeat(LABEL_MAX)}  `,
    'x'.repeat(LABEL_MAX),
    'x'.repeat(LABEL_MAX + 1),
    `  ${'x'.repeat(LABEL_MAX + 1)}  `,
    '   ',
    '',
  ];

  it.each(cases)('agrees on the label %j', (label) => {
    expect(parseQrSourceCreate({ source_label: label }).ok).toBe(labelError(label) === null);
  });

  it.each([' ', 'x'.repeat(NOTE_MAX), ` ${'x'.repeat(NOTE_MAX)} `, 'x'.repeat(NOTE_MAX + 1)])(
    'agrees on a note of length %j',
    (note) => {
      const result = parseQrSourceCreate({ source_label: 'Reception', internal_note: note });
      expect(result.ok).toBe(noteError(note) === null);
    },
  );
});

describe('isQrStatus', () => {
  it('accepts exactly the enum values', () => {
    expect(isQrStatus('ACTIVE')).toBe(true);
    expect(isQrStatus('DISABLED')).toBe(true);
  });

  it('does not answer true for an inherited property name', () => {
    expect(isQrStatus('toString')).toBe(false);
    expect(isQrStatus('__proto__')).toBe(false);
  });
});

describe('isQrSourceId', () => {
  it('accepts a uuid in either case', () => {
    expect(isQrSourceId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d')).toBe(true);
    expect(isQrSourceId('9A1B2C3D-4E5F-4A6B-8C7D-0E1F2A3B4C5D')).toBe(true);
  });

  it('rejects anything Postgres would raise 22P02 on', () => {
    for (const id of ['', 'main-qr', '1', "' or 1=1--", '9a1b2c3d4e5f4a6b8c7d0e1f2a3b4c5d']) {
      expect(isQrSourceId(id), `${id} must be rejected`).toBe(false);
    }
  });

  it('is anchored, so a uuid with anything appended is rejected', () => {
    expect(isQrSourceId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d/download')).toBe(false);
    expect(isQrSourceId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d\n')).toBe(false);
  });
});

describe('toQrSourceWire', () => {
  const row = {
    id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    code: 'ABCDEFGHJK',
    sourceLabel: 'Reception',
    internalNote: null,
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-02-01T04:30:00.000Z'),
  };

  it('answers in the field names GET /api/v1/qr uses, so one list shape serves all three', () => {
    expect(toQrSourceWire(row, 'https://example.test/r/ABCDEFGHJK')).toEqual({
      id: row.id,
      code: 'ABCDEFGHJK',
      source_label: 'Reception',
      internal_note: null,
      status: 'ACTIVE',
      created_at: '2026-02-01T04:30:00.000Z',
      resolve_url: 'https://example.test/r/ABCDEFGHJK',
    });
  });
});
