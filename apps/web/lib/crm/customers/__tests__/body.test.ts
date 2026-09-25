import { describe, expect, it } from 'vitest';
import { EMAIL_MAX_LENGTH, readCustomerBody } from '../body';

/**
 * The request-body rules for CRM-01, which `customer-status.test.ts` deliberately does not reach.
 *
 * That suite pins the *authority table* — which values are the platform's observations. This one
 * pins the gate that consults it: `readCustomerBody(raw, mode)` is the only thing standing between a
 * request body and a stored status, and the two branches that refuse a body (any status on a create,
 * an observed status on an update) are exactly the D-028 / AC-025 rule expressed as code. A table
 * that classifies GOOGLE_OPENED correctly while the endpoint accepts it anyway would be honest in
 * the wrong file.
 *
 * The rest of what is asserted here is the shaping nobody sees until it is wrong: the blank-to-null
 * collapse that makes clearing the email box on a full-record PATCH actually remove the address
 * (CRM-01-02), the 254-character cap that is the only bound on an unbounded citext column, and the
 * E.164 normalisation that makes a contact findable however the owner wrote the number (CRM-01-03).
 */

/** The minimum a body needs to get past `customerRequest` and reach the branch under test. */
const CONTACT = { name: 'Asha Menon', mobile: '9876543210' } as const;

function expectRejection(result: ReturnType<typeof readCustomerBody>) {
  if (result.ok) throw new Error('expected the body to be rejected');
  return result;
}

function expectAccepted(result: ReturnType<typeof readCustomerBody>) {
  if (!result.ok) throw new Error(`expected the body to be accepted, got: ${result.message}`);
  return result.body;
}

describe('a status in a customer request body', () => {
  it('refuses any status at all on a create', () => {
    // Not "refuses the observed ones": a contact that has just been written down has not been
    // contacted, so even NOT_CONTACTED — which a PATCH may set — is not the create's to name.
    for (const status of [
      'NOT_CONTACTED',
      'MESSAGE_PREPARED',
      'MESSAGE_SENT_MANUAL',
      'LINK_CLICKED',
      'AI_GENERATED',
      'REVIEW_COPIED',
      'GOOGLE_OPENED',
      'PRIVATE_FEEDBACK',
    ]) {
      const rejected = expectRejection(readCustomerBody({ ...CONTACT, status }, 'create'));
      expect(rejected.fields).toEqual(['status']);
    }
  });

  it('refuses every status the platform owns on an update', () => {
    // The five observations plus MESSAGE_PREPARED, which REQ-01 writes by preparing a message and
    // which relabelling a row must therefore not be able to claim.
    for (const status of [
      'LINK_CLICKED',
      'AI_GENERATED',
      'REVIEW_COPIED',
      'GOOGLE_OPENED',
      'PRIVATE_FEEDBACK',
      'MESSAGE_PREPARED',
    ]) {
      const rejected = expectRejection(readCustomerBody({ ...CONTACT, status }, 'update'));
      expect(rejected.fields).toEqual(['status']);
      // AC-025: the copy explains where the value comes from and never suggests the owner could
      // have set it, because saying Google was opened is a measurement and not a choice.
      expect(rejected.message).toBe(
        'That status is set from what happens on your review page, so it cannot be chosen here.',
      );
    }
  });

  it('accepts the two statuses that record the owner’s own action on an update', () => {
    for (const status of ['NOT_CONTACTED', 'MESSAGE_SENT_MANUAL'] as const) {
      expect(expectAccepted(readCustomerBody({ ...CONTACT, status }, 'update')).status).toBe(
        status,
      );
    }
  });

  it('reads a body with no status as “leave it alone” in both modes', () => {
    // Absent, null and blank all have to mean the same thing: a create writes the column default and
    // an update leaves the stored stage untouched. `status` is omitted rather than set to undefined
    // so a caller cannot spread it over a real value.
    for (const raw of [
      { ...CONTACT },
      { ...CONTACT, status: null },
      { ...CONTACT, status: '   ' },
    ]) {
      for (const mode of ['create', 'update'] as const) {
        const body = expectAccepted(readCustomerBody(raw, mode));
        expect(body.status).toBeUndefined();
        expect('status' in body).toBe(false);
      }
    }
  });

  it('refuses a status that is not a member of the enum at all', () => {
    for (const status of ['GOOGLE_OPENED ', 'google_opened', 'toString', 42, true]) {
      expect(expectRejection(readCustomerBody({ ...CONTACT, status }, 'update')).fields).toEqual([
        'status',
      ]);
    }
  });
});

describe('optional fields that were left blank', () => {
  it('stores null rather than an empty string, so clearing a box removes the value', () => {
    // The PATCH is a full-record update, so an emptied email box is the only way an owner has to say
    // "I no longer have their address". A stored '' would then have to be told apart from a missing
    // one at every read.
    const body = expectAccepted(
      readCustomerBody({ ...CONTACT, email: '  ', visit_date: '', note: ' \t ' }, 'update'),
    );

    expect(body.values.email).toBeNull();
    expect(body.values.visitDate).toBeNull();
    expect(body.values.note).toBeNull();
  });

  it('stores null when the field is absent entirely', () => {
    const body = expectAccepted(readCustomerBody({ ...CONTACT }, 'create'));

    expect(body.values).toEqual({
      name: 'Asha Menon',
      mobile: '+919876543210',
      email: null,
      visitDate: null,
      note: null,
    });
  });

  it('keeps a value that was actually supplied, trimmed', () => {
    const body = expectAccepted(
      readCustomerBody(
        { ...CONTACT, email: ' asha@example.com ', visit_date: '2026-03-14', note: '  Regular  ' },
        'create',
      ),
    );

    expect(body.values.email).toBe('asha@example.com');
    expect(body.values.visitDate).toBe('2026-03-14');
    expect(body.values.note).toBe('Regular');
  });
});

describe('the email length cap', () => {
  // `customerRequest.email` is `z.email()` with no maximum and `customers.email` is unbounded citext,
  // so this endpoint is the only thing between the column and a megabyte of "address". 254 is the
  // longest an SMTP path can be (RFC 5321), which makes anything past it undeliverable by definition.
  const DOMAIN = '@example.com';

  function emailOfLength(total: number): string {
    return `${'a'.repeat(total - DOMAIN.length)}${DOMAIN}`;
  }

  it('accepts the longest deliverable address', () => {
    const email = emailOfLength(EMAIL_MAX_LENGTH);
    expect(email).toHaveLength(254);

    expect(expectAccepted(readCustomerBody({ ...CONTACT, email }, 'create')).values.email).toBe(
      email,
    );
  });

  it('refuses one character more, saying so against the email field', () => {
    const email = emailOfLength(EMAIL_MAX_LENGTH + 1);
    expect(email).toHaveLength(255);

    const rejected = expectRejection(readCustomerBody({ ...CONTACT, email }, 'create'));
    expect(rejected.fields).toEqual(['email']);
    // Its own message, not the generic "enter a valid email": the address is well formed, it is
    // simply longer than anything that could be delivered to.
    expect(rejected.message).toBe('Use 254 characters or fewer for the email address.');
  });

  it('still refuses a malformed address with the contract’s message', () => {
    const rejected = expectRejection(
      readCustomerBody({ ...CONTACT, email: 'not-an-address' }, 'create'),
    );
    expect(rejected.fields).toEqual(['email']);
    expect(rejected.message).toBe('Enter a valid email address, or leave it blank.');
  });
});

describe('trimming before the contract sees the body', () => {
  it('fails a name that is only whitespace', () => {
    // Trimmed here rather than in the form, because the API is the contract: '  ' has to fail
    // `min(1)` rather than be stored as two spaces that render as a nameless row.
    const rejected = expectRejection(readCustomerBody({ ...CONTACT, name: '  ' }, 'create'));
    expect(rejected.fields).toEqual(['name']);
    expect(rejected.message).toBe('Enter their name, using 120 characters or fewer.');
  });

  it('trims a name that has content', () => {
    expect(
      expectAccepted(readCustomerBody({ ...CONTACT, name: '  Asha Menon  ' }, 'create')).values
        .name,
    ).toBe('Asha Menon');
  });

  it('leaves a non-string alone so the contract reports the type error', () => {
    // `{ name: 42 }` must not be turned into something that reads as a missing field.
    expect(expectRejection(readCustomerBody({ ...CONTACT, name: 42 }, 'create')).fields).toEqual([
      'name',
    ]);
  });

  it('reports the generic message when more than one field is wrong', () => {
    // `use-form-submit.ts` shows one message against every field it is handed, so a sentence about
    // the name would be wrong against the note.
    const rejected = expectRejection(
      readCustomerBody({ name: '', mobile: '9876543210', note: 'x'.repeat(1001) }, 'create'),
    );
    expect(rejected.fields).toEqual(expect.arrayContaining(['name', 'note']));
    expect(rejected.message).toBe('Please check the details you entered.');
  });

  it('refuses a body that is not an object', () => {
    for (const raw of [null, undefined, 'x', 42, [], [CONTACT]]) {
      const rejected = expectRejection(readCustomerBody(raw, 'create'));
      expect(rejected.message).toBe('Malformed request body.');
      expect(rejected.fields).toEqual([]);
    }
  });
});

describe('the stored mobile number', () => {
  it('is E.164 however the owner wrote an Indian number (CRM-01-03)', () => {
    // The three shapes an owner actually types: bare 10 digits (D-002 makes those +91), a spaced
    // international number, and a domestic trunk prefix in front of a country code.
    for (const typed of ['9876543210', '+91 98765 43210', '091-9876543210', ' 98765-43210 ']) {
      expect(
        expectAccepted(readCustomerBody({ ...CONTACT, mobile: typed }, 'create')).values.mobile,
      ).toBe('+919876543210');
    }
  });

  it('reports the rejection reason rather than a generic message', () => {
    // The copy has to name the 10-digit case, because that is what the owner is almost certainly
    // trying to type (D-002).
    const cases: readonly [string, string][] = [
      ['12345678', 'That number looks too short. Enter a 10-digit Indian mobile number.'],
      ['98765432101', 'That number looks too long. Enter a 10-digit Indian mobile number.'],
      ['5876543210', 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.'],
    ];

    for (const [typed, message] of cases) {
      const rejected = expectRejection(readCustomerBody({ ...CONTACT, mobile: typed }, 'create'));
      expect(rejected.fields).toEqual(['mobile']);
      expect(rejected.message).toBe(message);
    }
  });

  it('fails the contract before normalisation when the box is empty', () => {
    // `customerRequest.mobile` is `min(8)`, so a blank never reaches `normalizePhone`. Either way the
    // owner is told to enter a number, which is why both paths are asserted to say the same thing.
    const rejected = expectRejection(readCustomerBody({ ...CONTACT, mobile: '   ' }, 'create'));
    expect(rejected.fields).toEqual(['mobile']);
    expect(rejected.message).toBe('Enter their mobile number.');
  });
});
