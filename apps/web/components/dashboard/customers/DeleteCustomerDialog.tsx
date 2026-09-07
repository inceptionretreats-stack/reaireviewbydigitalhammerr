'use client';

import { useRef, useState } from 'react';
import { Button, InlineError, Modal } from '@ai-review/ui';
import type { CustomerDto } from '@/app/api/v1/customers/repository';
import { deleteCustomer } from './customer-api';
import { formatMobile } from './presentation';

/**
 * The confirmation behind CRM-01's Delete action.
 *
 * It exists because the delete is not reversible from this screen — AC-040 keeps the row, but nothing
 * in the dashboard can bring a contact back — so the owner has to be told what will happen before it
 * does, in the words the brief asks for: deleting removes them from the list.
 *
 * The copy is careful in two places. It does not promise erasure: the row survives so that any review
 * request already prepared for this person still makes sense, and
 * `13_Security_Privacy_Compliance.md` purges the personal fields on a retention schedule rather than
 * on this click. And it states that the number becomes free again, which is the behaviour the
 * schema's partial index on `(business_id, mobile) WHERE deleted_at IS NULL` is written to allow.
 *
 * Cancel takes initial focus rather than Delete: the destructive action should never be one stray
 * Enter away in a dialog that just appeared.
 */

export interface DeleteCustomerDialogProps {
  customer: CustomerDto;
  onClose: () => void;
  onDeleted: (customer: CustomerDto) => void;
}

export function DeleteCustomerDialog({ customer, onClose, onDeleted }: DeleteCustomerDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteCustomer(customer.id);
      if (!result.ok) {
        setError(result.failure.message);
        return;
      }
      onDeleted(customer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Delete ${customer.name}?`}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} loadingLabel="Deleting…" onClick={remove}>
            Delete customer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink">
        {error !== null && <InlineError>{error}</InlineError>}

        <p>
          This removes {customer.name} ({formatMobile(customer.mobile)}) from your customer list.
          You will not see them here again, and there is no undo on this screen.
        </p>
        <p className="text-ink-muted">
          Any review request you have already prepared for them stays as it is, so your history
          still makes sense. You can add this mobile number again later as a new customer.
        </p>
      </div>
    </Modal>
  );
}
