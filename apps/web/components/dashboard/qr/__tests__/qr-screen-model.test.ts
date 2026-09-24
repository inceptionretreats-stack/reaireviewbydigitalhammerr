import { describe, expect, it } from 'vitest';
import {
  countSources,
  describeCounts,
  describeQrScan,
  describeQrStatus,
  formatCreatedAt,
  labelError,
  noteError,
  parseQrSource,
  readQrFailure,
  upsertSource,
  type QrSource,
} from '../qr-screen-model';

/**
 * The logic behind QR-01 that is worth pinning: list ordering under a rename, the defensive read of
 * an API payload, and the two product statements the screen makes about a disabled standee.
 */

function source(overrides: Partial<QrSource> = {}): QrSource {
  return {
    id: 'a1',
    code: 'ABCDEFGHJK',
    label: 'Reception',
    note: null,
    status: 'ACTIVE',
    createdAt: '2026-02-01T04:30:00.000Z',
    resolveUrl: 'https://example.test/r/ABCDEFGHJK',
    previewSrc: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    ...overrides,
  };
}

describe('countSources', () => {
  it('counts enabled and disabled separately', () => {
    const counts = countSources([
      source({ id: 'a1' }),
      source({ id: 'a2', status: 'DISABLED' }),
      source({ id: 'a3' }),
    ]);
    expect(counts).toEqual({ total: 3, active: 2, disabled: 1 });
  });

  it('reports an empty list as empty rather than as one of anything', () => {
    expect(countSources([])).toEqual({ total: 0, active: 0, disabled: 0 });
  });
});

describe('describeCounts', () => {
  it('never leaves a disabled source unmentioned, since it is still a standee on a counter', () => {
    expect(describeCounts({ total: 4, active: 3, disabled: 1 })).toBe(
      '4 sources, 1 of them disabled.',
    );
    expect(describeCounts({ total: 2, active: 0, disabled: 2 })).toBe('2 sources, all disabled.');
    expect(describeCounts({ total: 1, active: 0, disabled: 1 })).toBe('1 source, disabled.');
  });

  it('reads naturally for one source and for none', () => {
    expect(describeCounts({ total: 1, active: 1, disabled: 0 })).toBe('1 source, active.');
    expect(describeCounts({ total: 3, active: 3, disabled: 0 })).toBe('3 sources, all active.');
    expect(describeCounts({ total: 0, active: 0, disabled: 0 })).toBe('No QR sources yet.');
  });
});

describe('upsertSource', () => {
  const first = source({ id: 'a1', label: 'Reception' });
  const second = source({ id: 'a2', label: 'Billing Counter' });

  it('replaces a renamed source in place, so the row does not move under the owner', () => {
    const next = upsertSource([first, second], { ...first, label: 'Front Desk' });
    expect(next.map((entry) => entry.id)).toEqual(['a1', 'a2']);
    expect(next[0]?.label).toBe('Front Desk');
  });

  it('appends a source the list has not seen, which is where oldest-first puts a new one', () => {
    const created = source({ id: 'a3', label: 'Packaging' });
    expect(upsertSource([first, second], created).map((entry) => entry.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const sources = [first, second];
    upsertSource(sources, { ...first, label: 'Front Desk' });
    expect(sources[0]?.label).toBe('Reception');
  });
});

describe('parseQrSource', () => {
  const wire = {
    id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    code: 'ABCDEFGHJK',
    source_label: 'Reception',
    internal_note: 'By the front desk',
    status: 'DISABLED',
    created_at: '2026-02-01T04:30:00.000Z',
    resolve_url: 'https://example.test/r/ABCDEFGHJK',
    preview_src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  };

  it('reads the envelope both write endpoints answer with', () => {
    expect(parseQrSource({ source: wire })).toEqual({
      id: wire.id,
      code: 'ABCDEFGHJK',
      label: 'Reception',
      note: 'By the front desk',
      status: 'DISABLED',
      createdAt: '2026-02-01T04:30:00.000Z',
      resolveUrl: 'https://example.test/r/ABCDEFGHJK',
      previewSrc: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    });
  });

  it('reads a bare source object too', () => {
    expect(parseQrSource(wire)?.label).toBe('Reception');
  });

  it('treats an absent or non-string note as no note', () => {
    expect(parseQrSource({ ...wire, internal_note: null })?.note).toBeNull();
    expect(parseQrSource({ ...wire, internal_note: 42 })?.note).toBeNull();
  });

  it('rejects a payload missing a field the table renders', () => {
    for (const key of [
      'id',
      'code',
      'source_label',
      'created_at',
      'resolve_url',
      // The table renders the symbol itself, so a row without one would draw a broken image where
      // the owner expects to see which code they are looking at.
      'preview_src',
    ] as const) {
      const broken: Record<string, unknown> = { ...wire };
      delete broken[key];
      expect(parseQrSource(broken), `missing ${key} must be rejected`).toBeNull();
    }
  });

  it('rejects a status outside the enum, rather than rendering an unlabelled badge', () => {
    expect(parseQrSource({ ...wire, status: 'ARCHIVED' })).toBeNull();
    expect(parseQrSource({ ...wire, status: 'toString' })).toBeNull();
  });

  it('rejects a payload that is not an object', () => {
    for (const raw of [null, undefined, 'Reception', 7, [wire]]) {
      expect(parseQrSource(raw), `${String(raw)} must be rejected`).toBeNull();
    }
  });
});

describe('readQrFailure', () => {
  it('carries the safe message and the fields to mark invalid', () => {
    const failure = readQrFailure({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Please check the details you entered.',
        request_id: 'abc',
        details: { fields: ['source_label'] },
      },
    });
    expect(failure).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Please check the details you entered.',
      fields: ['source_label'],
    });
  });

  it('survives an envelope with no details', () => {
    const failure = readQrFailure({ error: { code: 'FORBIDDEN', message: 'Request rejected.' } });
    expect(failure.fields).toEqual([]);
    expect(failure.code).toBe('FORBIDDEN');
  });

  it('drops a non-string field name instead of rendering it', () => {
    const failure = readQrFailure({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'No.',
        details: { fields: ['status', 7, null] },
      },
    });
    expect(failure.fields).toEqual(['status']);
  });

  it('falls back to a generic message for anything that is not the envelope', () => {
    for (const payload of [null, undefined, '<html>502</html>', {}, { error: 'nope' }]) {
      expect(readQrFailure(payload).message).toBe('Something went wrong. Please try again.');
    }
  });
});

describe('formatCreatedAt', () => {
  const iso = '2026-02-01T20:00:00.000Z';

  it('formats in the business timezone, not UTC (AMENDMENT-004, AC-026)', () => {
    // 20:00 UTC is the next day in Asia/Kolkata, so a wrong timezone shows a different date.
    expect(formatCreatedAt(iso, 'Asia/Kolkata')).not.toBe(formatCreatedAt(iso, 'UTC'));
    expect(formatCreatedAt(iso, 'Asia/Kolkata')).toMatch(/2026/);
  });

  it('falls back to UTC for an unrecognised timezone rather than throwing', () => {
    expect(formatCreatedAt(iso, 'Not/AZone')).toBe(formatCreatedAt(iso, 'UTC'));
  });

  it('answers null for an unparseable instant, which the table shows as a dash', () => {
    expect(formatCreatedAt('yesterday', 'Asia/Kolkata')).toBeNull();
    expect(formatCreatedAt('', 'Asia/Kolkata')).toBeNull();
  });
});

describe('labelError', () => {
  it('accepts a normal label', () => {
    expect(labelError('Billing Counter')).toBeNull();
  });

  it('refuses an empty or whitespace label and suggests what a label is for', () => {
    expect(labelError('')).toMatch(/Reception/);
    expect(labelError('   ')).toMatch(/Reception/);
  });

  it('refuses a label past the column width, measured after trimming', () => {
    expect(labelError(`  ${'x'.repeat(120)}  `)).toBeNull();
    expect(labelError('x'.repeat(121))).not.toBeNull();
  });
});

describe('noteError', () => {
  it('accepts an empty note, since the note is optional', () => {
    expect(noteError('')).toBeNull();
  });

  it('refuses a note past the column width', () => {
    expect(noteError('x'.repeat(501))).not.toBeNull();
  });
});

describe('describeQrStatus', () => {
  it('offers the opposite action for each state', () => {
    expect(describeQrStatus('ACTIVE').action).toBe('Disable');
    expect(describeQrStatus('ACTIVE').nextStatus).toBe('DISABLED');
    expect(describeQrStatus('DISABLED').action).toBe('Enable');
    expect(describeQrStatus('DISABLED').nextStatus).toBe('ACTIVE');
  });

  it('does not use colour alone: every state has a word as well as a badge tone', () => {
    expect(describeQrStatus('ACTIVE').label).toBe('Active');
    expect(describeQrStatus('DISABLED').label).toBe('Disabled');
  });
});

describe('describeQrScan', () => {
  it('tells an owner a disabled standee can be switched back on (QR-01-02)', () => {
    // The whole value of a dynamic QR is that disabling is reversible without a reprint. If this
    // sentence stops saying so, owners stop disabling and start throwing standees away.
    expect(describeQrScan('DISABLED', true)).toMatch(/enable it/i);
  });

  it('promises a review page only while the tenant is actually served', () => {
    expect(describeQrScan('ACTIVE', true)).toMatch(/opens your review page/i);
  });

  it('never claims an enabled code opens the review page for a suspended tenant', () => {
    // loadPublicConfig serves nothing unless businesses.status is ACTIVE, so resolveByQrCode
    // answers BUSINESS_NOT_ACTIVE and /r/{code} renders "not available at the moment". The row
    // used to say "Scanning it opens your review page." directly under a banner saying the public
    // page was unavailable — one screen asserting both.
    const note = describeQrScan('ACTIVE', false);
    expect(note).not.toMatch(/opens your review page/i);
    expect(note).toMatch(/not available/i);
    expect(note).toMatch(/enabled/i);
  });

  it('does not offer Enable as the fix when the whole public page is down', () => {
    // There is no Enable button for a suspended tenant either (canManage is false), so a sentence
    // pointing at one would send the owner looking for a control that is not there.
    const note = describeQrScan('DISABLED', false);
    expect(note).toMatch(/not available/i);
    expect(note).not.toMatch(/enable it to switch it back on/i);
  });
});
