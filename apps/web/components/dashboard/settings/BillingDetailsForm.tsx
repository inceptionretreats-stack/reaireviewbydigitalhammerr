'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button, Card, Field, InlineError, Input, Textarea } from '@ai-review/ui';
import { fieldError } from '../../auth/use-form-submit';
import { unattachedFailure, useSettingsSubmit } from './use-settings-submit';

/**
 * AMENDMENT-029 — what goes on the invoice for the next payment. Everything is optional: a
 * business with no GSTIN still gets an invoice, addressed to it by name. The GSTIN and state
 * code are checked for shape here and at the endpoint; the seller's accountant checks the rest.
 */
export interface BillingDetailsFormProps {
  initial: {
    billingLegalName: string;
    gstin: string;
    billingStateCode: string;
    billingAddress: string;
  };
}

type FieldKey = 'billing_legal_name' | 'gstin' | 'billing_state_code' | 'billing_address';
const FIELDS: readonly FieldKey[] = [
  'billing_legal_name',
  'gstin',
  'billing_state_code',
  'billing_address',
];

export function BillingDetailsForm({ initial }: BillingDetailsFormProps) {
  const router = useRouter();
  const { state, submit, reset } = useSettingsSubmit('/api/v1/business/billing', 'PUT');
  const [legalName, setLegalName] = useState(initial.billingLegalName);
  const [gstin, setGstin] = useState(initial.gstin);
  const [stateCode, setStateCode] = useState(initial.billingStateCode);
  const [address, setAddress] = useState(initial.billingAddress);
  const busy = state.status === 'submitting';

  const touched = useCallback(() => {
    if (state.status !== 'idle') reset();
  }, [reset, state.status]);

  const save = useCallback(async () => {
    const result = await submit({
      billing_legal_name: legalName.trim(),
      gstin: gstin.trim().toUpperCase(),
      billing_state_code: stateCode.trim(),
      billing_address: address.trim(),
    });
    if (result.status === 'success') router.refresh();
  }, [address, gstin, legalName, router, stateCode, submit]);

  const unattached = unattachedFailure(state, FIELDS);
  const saved = state.status === 'success';

  return (
    <Card
      title="Invoice details"
      titleAs="h2"
      description="Printed on the GST invoice for your next payment. Leave blank to be invoiced by your business name."
    >
      <div className="flex flex-col gap-5">
        {unattached !== null && <InlineError>{unattached}</InlineError>}
        <div
          role="status"
          aria-live="polite"
          className={
            saved
              ? 'rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success'
              : 'sr-only'
          }
        >
          {saved && (
            <p className="font-semibold">
              <span aria-hidden="true">{'✓'}</span> Saved
            </p>
          )}
        </div>

        <Field
          label="Legal name for invoices"
          hint="The registered name of the business, if different from its display name."
          error={fieldError(state, 'billing_legal_name')}
        >
          {(control) => (
            <Input
              {...control}
              value={legalName}
              maxLength={200}
              autoComplete="organization"
              onChange={(e) => {
                touched();
                setLegalName(e.target.value);
              }}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <Field
            label="GSTIN"
            hint="15 characters. Only if your business is registered for GST."
            error={fieldError(state, 'gstin')}
          >
            {(control) => (
              <Input
                {...control}
                value={gstin}
                maxLength={15}
                autoCapitalize="characters"
                className="font-mono uppercase"
                onChange={(e) => {
                  touched();
                  setGstin(e.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label="GST state code"
            hint="Two digits, e.g. 29."
            error={fieldError(state, 'billing_state_code')}
          >
            {(control) => (
              <Input
                {...control}
                value={stateCode}
                maxLength={2}
                inputMode="numeric"
                onChange={(e) => {
                  touched();
                  setStateCode(e.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Field
          label="Billing address"
          hint="Optional."
          error={fieldError(state, 'billing_address')}
        >
          {(control) => (
            <Textarea
              {...control}
              value={address}
              rows={3}
              maxLength={500}
              onChange={(e) => {
                touched();
                setAddress(e.target.value);
              }}
            />
          )}
        </Field>
        <div>
          <Button onClick={() => void save()} loading={busy}>
            Save invoice details
          </Button>
        </div>
      </div>
    </Card>
  );
}
