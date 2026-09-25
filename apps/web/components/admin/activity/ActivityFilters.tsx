'use client';

import Link from 'next/link';
import { Button, Field, Input, Select } from '@ai-review/ui';

/**
 * The explorer's filter form (AMENDMENT-028). A plain GET form — the URL is the filter — kept in
 * a client component only because `Field` takes a render function, which a server component
 * cannot hand across the boundary.
 */
export interface ActivityFilterValues {
  email: string;
  business: string;
  action: string;
  outcome: string;
  from: string;
  to: string;
}

export function ActivityFilters({
  values,
  actionOptions,
  emailHint,
}: {
  values: ActivityFilterValues;
  actionOptions: Array<{ value: string; label: string }>;
  emailHint?: string;
}) {
  return (
    <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Person (email)" hint={emailHint}>
        {(control) => <Input {...control} name="email" defaultValue={values.email} />}
      </Field>
      <Field label="Business id">
        {(control) => <Input {...control} name="business" defaultValue={values.business} />}
      </Field>
      <Field label="Action" hint="An area (auth.) or one exact action.">
        {(control) => (
          <Select
            {...control}
            name="action"
            defaultValue={values.action}
            options={[{ value: '', label: 'Any' }, ...actionOptions]}
          />
        )}
      </Field>
      <Field label="Outcome">
        {(control) => (
          <Select
            {...control}
            name="outcome"
            defaultValue={values.outcome}
            options={[
              { value: '', label: 'Any' },
              { value: 'SUCCESS', label: 'OK' },
              { value: 'FAILURE', label: 'Failed' },
              { value: 'DENIED', label: 'Denied' },
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
          href="/admin/activity"
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
