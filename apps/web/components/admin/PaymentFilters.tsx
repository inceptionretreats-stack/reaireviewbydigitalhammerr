'use client';

import Link from 'next/link';
import { Button, Field, Input, Select } from '@ai-review/ui';

/** The payments list filter — a GET form, so the URL is the filter (AMENDMENT-029). */
export function PaymentFilters({
  values,
}: {
  values: { status: string; business: string; refunded: string; from: string; to: string };
}) {
  return (
    <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Status">
        {(control) => (
          <Select
            {...control}
            name="status"
            defaultValue={values.status}
            options={[
              { value: '', label: 'Any' },
              { value: 'CREATED', label: 'Started (open)' },
              { value: 'AUTHORIZED', label: 'Authorised' },
              { value: 'CAPTURED', label: 'Paid' },
              { value: 'REFUNDED', label: 'Refunded in full' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />
        )}
      </Field>
      <Field label="Business id">
        {(control) => <Input {...control} name="business" defaultValue={values.business} />}
      </Field>
      <Field label="Refunded">
        {(control) => (
          <Select
            {...control}
            name="refunded"
            defaultValue={values.refunded}
            options={[
              { value: '', label: 'Any' },
              { value: 'yes', label: 'Any refund' },
              { value: 'no', label: 'No refund' },
            ]}
          />
        )}
      </Field>
      <Field label="From">
        {(control) => <Input {...control} name="from" type="date" defaultValue={values.from} />}
      </Field>
      <Field label="To">
        {(control) => <Input {...control} name="to" type="date" defaultValue={values.to} />}
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit">Apply</Button>
        <Link
          href="/admin/payments"
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
