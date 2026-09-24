'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { Badge, Button, Field, InlineError, Input, Modal, Select, Textarea } from '@ai-review/ui';
import type { SelectOption } from '@ai-review/ui';
import {
  isObservedStatus,
  isOwnerSettableStatusValue,
  type CustomerStatus,
} from '@/lib/crm/customers/customer-status';
import type { CustomerDto } from '@/lib/crm/customers/repository';
import { patchCustomer, postCustomer, type CustomerInput } from './customer-api';
import {
  OWNER_STATUS_OPTIONS,
  describeStatus,
  describeStatusAuthority,
  formatMobile,
} from './presentation';

/**
 * CRM-01's `form` state — one dialog for both Add customer and Edit.
 *
 * One component rather than two, because the fields are identical: `customerRequest` in
 * `@ai-review/contracts` is the whole contact, and an edit offering a different set of fields from an
 * add would be two definitions of what a contact is. Only two things differ, and both follow from
 * whether `customer` is null: the copy, and whether a status appears at all.
 *
 * The dialog is mounted only while it is open and keyed on the contact, so its initial state comes
 * from props and there is no reset effect to forget. `Modal` supplies focus containment, Escape and
 * focus restoration (AC-037).
 *
 * The fields sit in a `<form>` inside the dialog body while the buttons sit in the dialog's footer,
 * joined by the button's `form` attribute. That is what makes Enter submit; the alternative, moving
 * the buttons into the body, puts them inside the scrolling region and somewhere different from every
 * other dialog in the product.
 */

const FIELD_KEYS = ['name', 'mobile', 'email', 'visit_date', 'note', 'status'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * Mirrors `customerRequest` so an input stops at the limit rather than accepting text the save will
 * reject. The contract is what actually gates the write; these only prevent wasted typing.
 */
const NAME_MAX = 120;
const MOBILE_MAX = 20;
const NOTE_MAX = 1000;
/** The longest address SMTP can carry (RFC 5321), which the endpoint also enforces. */
const EMAIL_MAX = 254;

/**
 * A deliberately loose shape check whose only job is catching a typo before a round trip. `z.email()`
 * on the server is authoritative, and its message is shown verbatim when the two disagree.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** D-017 / ADR-004 / REQ-01-02, said plainly where an owner might assume otherwise. */
const ADD_DESCRIPTION =
  'We never message your customers for you — you prepare the request and send it yourself.';

interface Values {
  name: string;
  mobile: string;
  email: string;
  visit_date: string;
  note: string;
  status: string;
}

export interface CustomerFormDialogProps {
  /** null adds a contact; a contact edits it. */
  customer: CustomerDto | null;
  onClose: () => void;
  onSaved: (customer: CustomerDto, mode: 'created' | 'updated') => void;
}

export function CustomerFormDialog({ customer, onClose, onSaved }: CustomerFormDialogProps) {
  const formId = useId();

  const [values, setValues] = useState<Values>({
    name: customer?.name ?? '',
    // Shown grouped for reading. It goes back as typed and `normalizePhone` returns it to E.164 on
    // the server, so re-saving an untouched contact cannot change what is stored.
    mobile: customer === null ? '' : formatMobile(customer.mobile),
    email: customer?.email ?? '',
    visit_date: customer?.visit_date ?? '',
    note: customer?.note ?? '',
    status: customer?.status ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = useCallback((field: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Clears this field's error, so a correction is not made under a stale message.
    setErrors(({ [field]: _cleared, ...rest }) => rest);
    setFormError(null);
  }, []);

  const statusLocked = customer !== null && isObservedStatus(customer.status);

  /**
   * MESSAGE_PREPARED is neither settable nor history, so it appears as a disabled option: the
   * dropdown has to tell the truth about where the contact currently is, without implying that
   * relabelling a row is the same as preparing a message.
   */
  const statusOptions = useMemo<readonly SelectOption[]>(() => {
    if (customer === null || isOwnerSettableStatusValue(customer.status)) {
      return OWNER_STATUS_OPTIONS;
    }
    const current: SelectOption = {
      value: customer.status,
      label: describeStatus(customer.status).label,
      disabled: true,
    };
    return [current, ...OWNER_STATUS_OPTIONS];
  }, [customer]);

  async function save(): Promise<void> {
    const trimmed = {
      name: values.name.trim(),
      mobile: values.mobile.trim(),
      email: values.email.trim(),
      visit_date: values.visit_date.trim(),
      note: values.note.trim(),
    };

    const found = localErrors(trimmed);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setFormError(null);

    // A locked status is never resubmitted. The endpoint would accept the unchanged value, but not
    // sending it means editing the note of an observed contact does not rely on that leniency.
    const statusToSend =
      customer !== null && !statusLocked && isOwnerSettableStatusValue(values.status)
        ? values.status
        : undefined;

    const input: CustomerInput = {
      name: trimmed.name,
      mobile: trimmed.mobile,
      // Omitted rather than sent as '': on an edit, an omitted field is what clears a stored value,
      // and the two have to mean the same thing for the endpoint to have one rule.
      ...(trimmed.email === '' ? {} : { email: trimmed.email }),
      ...(trimmed.visit_date === '' ? {} : { visit_date: trimmed.visit_date }),
      ...(trimmed.note === '' ? {} : { note: trimmed.note }),
      ...(statusToSend === undefined ? {} : { status: statusToSend }),
    };

    setBusy(true);
    try {
      const result =
        customer === null ? await postCustomer(input) : await patchCustomer(customer.id, input);

      if (!result.ok) {
        const named = result.failure.fields.filter(isFieldKey);
        if (named.length === 0) {
          setFormError(result.failure.message);
        } else {
          setErrors(Object.fromEntries(named.map((field) => [field, result.failure.message])));
        }
        return;
      }

      onSaved(result.value, customer === null ? 'created' : 'updated');
    } finally {
      setBusy(false);
    }
  }

  const noteLeft = NOTE_MAX - values.note.length;

  return (
    <Modal
      open
      onClose={onClose}
      title={customer === null ? 'Add a customer' : `Edit ${customer.name}`}
      description={customer === null ? ADD_DESCRIPTION : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={busy}
            loadingLabel={customer === null ? 'Adding…' : 'Saving…'}
          >
            {customer === null ? 'Add customer' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        // Our own messages rather than the browser's bubbles, so a failure reads the same whether the
        // browser caught it or the endpoint did.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-5"
      >
        {formError !== null && <InlineError>{formError}</InlineError>}

        <Field label="Name" required error={errors.name} hint="As you would greet them.">
          {(control) => (
            <Input
              {...control}
              name="name"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              autoComplete="name"
              maxLength={NAME_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="Mobile number"
          required
          error={errors.mobile}
          // CRM-01-03: the owner never needs to hear the term E.164, only that any way of writing an
          // Indian number is fine.
          hint="A 10-digit Indian mobile, or a full number with its country code."
        >
          {(control) => (
            <Input
              {...control}
              name="mobile"
              value={values.mobile}
              onChange={(event) => update('mobile', event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              maxLength={MOBILE_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Email" error={errors.email} hint="Optional.">
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              value={values.email}
              onChange={(event) => update('email', event.target.value)}
              autoComplete="email"
              maxLength={EMAIL_MAX}
              spellCheck={false}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Visit date" error={errors.visit_date} hint="Optional. When they came in.">
          {(control) => (
            <Input
              {...control}
              name="visit_date"
              type="date"
              value={values.visit_date}
              onChange={(event) => update('visit_date', event.target.value)}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="Note"
          error={errors.note}
          // The limit belongs here, not only in the counter below: `Field` wires the hint into
          // `aria-describedby`, so this is the one part of the field a screen reader reads out with
          // it. Without the number stated, `maxLength` silently dropping keystrokes at 1000 is a
          // limit the user was never told about (AC-037).
          hint={`Optional. Anything that helps you remember them. Up to ${NOTE_MAX} characters.`}
        >
          {(control) => (
            <>
              <Textarea
                {...control}
                name="note"
                value={values.note}
                onChange={(event) => update('note', event.target.value)}
                maxLength={NOTE_MAX}
                rows={3}
                disabled={busy}
              />
              {/* The running count stays hidden: announcing a number on every keystroke is chatter,
                  and the limit itself is now in the hint. */}
              <p className="text-sm text-ink-muted" aria-hidden="true">
                {noteLeft} characters left
              </p>
              {/* The one moment worth announcing is when typing stops being accepted, which
                  `maxLength` otherwise does silently. The region is always mounted and starts
                  empty, because a live region inserted at the same time as its text is not
                  reliably announced. */}
              <p className="sr-only" role="status">
                {noteLeft === 0 ? `Note limit reached — ${NOTE_MAX} characters.` : ''}
              </p>
            </>
          )}
        </Field>

        {customer !== null &&
          (statusLocked ? (
            <ObservedStatus status={customer.status} />
          ) : (
            <Field
              label="Status"
              error={errors.status}
              hint={describeStatusAuthority(customer.status)}
            >
              {(control) => (
                <Select
                  {...control}
                  name="status"
                  options={statusOptions}
                  value={values.status}
                  onChange={(event) => update('status', event.target.value)}
                  disabled={busy}
                />
              )}
            </Field>
          ))}
      </form>
    </Modal>
  );
}

/**
 * A status the platform observed, rendered as history rather than as a control.
 *
 * Not a disabled `<select>`: a disabled control says "not editable here, yet", where this is a record
 * of something that happened. A disabled select is also unreachable by keyboard, so a screen-reader
 * user would never hear the value at all.
 */
function ObservedStatus({ status }: { status: CustomerStatus }) {
  const presentation = describeStatus(status);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">Status</p>
      <Badge tone={presentation.tone} className="self-start">
        {presentation.label}
      </Badge>
      <p className="text-sm text-ink-muted">
        {presentation.detail} {describeStatusAuthority(status)}
      </p>
    </div>
  );
}

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * The checks worth making before a round trip.
 *
 * Deliberately not a copy of the contract. The mobile number is only checked for presence, because
 * `normalizePhone` lives in `@ai-review/core`, whose single entry point would pull `pg` and
 * argon2 into the browser bundle — and because a second, looser implementation of "is this a valid
 * Indian mobile" is worse than none: it would refuse numbers the server accepts.
 */
function localErrors(values: Omit<Values, 'status'>): FieldErrors {
  const errors: FieldErrors = {};

  if (values.name === '') errors.name = 'Enter their name.';
  if (values.mobile === '') errors.mobile = 'Enter their mobile number.';
  if (values.email !== '' && !EMAIL_SHAPE.test(values.email)) {
    errors.email = 'Enter a valid email address, or leave it blank.';
  }
  if (values.note.length > NOTE_MAX) {
    errors.note = `Keep the note to ${NOTE_MAX} characters or fewer.`;
  }

  return errors;
}
