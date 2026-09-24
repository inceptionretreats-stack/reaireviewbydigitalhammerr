'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, InlineError, Input, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/shared/forms/send-json';
import { useStepUp } from '../MfaStepUpDialog';

export interface SettingRow {
  key: string;
  value: number | string | null;
  version: number;
  updatedAt: string | null;
}

type Kind = 'number' | 'rupees' | 'percent_bps' | 'text' | 'textarea';

interface Meta {
  label: string;
  hint: string;
  kind: Kind;
  /** Which card the setting sits in. */
  group: 'commercial' | 'invoice';
  /** An empty text field means "not set" rather than the empty string. */
  nullable?: boolean;
}

const LABELS: Record<string, Meta> = {
  free_generation_limit: {
    label: 'Free Ai drafts per new business',
    hint: 'Lifetime allowance for a business that has not paid. Applies to businesses created from now on; existing ones keep theirs (change those on the business page).',
    kind: 'number',
    group: 'commercial',
  },
  annual_price_paise: {
    label: 'Pro price per year',
    hint: 'Charged at checkout from now on, GST included. Earlier payments and existing subscriptions keep the price they were sold at.',
    kind: 'rupees',
    group: 'commercial',
  },
  pro_generation_limit: {
    label: 'Pro Ai drafts per paid year',
    hint: 'Applies to businesses created from now on.',
    kind: 'number',
    group: 'commercial',
  },
  fair_use_monthly_soft_limit: {
    label: 'Fair-use warning per month',
    hint: 'Soft threshold for abuse monitoring. Leave empty to turn it off.',
    kind: 'number',
    group: 'commercial',
    nullable: true,
  },
  seller_legal_name: {
    label: 'Seller legal name',
    hint: 'Printed on every invoice as the supplier.',
    kind: 'text',
    group: 'invoice',
  },
  seller_address: {
    label: 'Seller address',
    hint: 'As it should appear on the invoice.',
    kind: 'textarea',
    group: 'invoice',
  },
  seller_gstin: {
    label: 'Seller GSTIN',
    hint: 'Leave empty until registered. Without one, invoices show the amount with no GST split — an unregistered seller may not charge it.',
    kind: 'text',
    group: 'invoice',
    nullable: true,
  },
  seller_state_code: {
    label: 'Seller GST state code',
    hint: 'Two digits (29 Karnataka, 27 Maharashtra, 07 Delhi…). Decides CGST+SGST against IGST, and stands in as the place of supply when a buyer gives no state.',
    kind: 'text',
    group: 'invoice',
    nullable: true,
  },
  gst_rate_bps: {
    label: 'GST rate',
    hint: 'In percent. The price above includes it; the invoice works the tax back out of the amount paid.',
    kind: 'percent_bps',
    group: 'invoice',
  },
  seller_sac_code: {
    label: 'SAC code',
    hint: 'Services Accounting Code for the subscription line. 998314 is online information and database services — have your accountant confirm.',
    kind: 'text',
    group: 'invoice',
  },
  invoice_prefix: {
    label: 'Invoice number prefix',
    hint: 'Numbers run PREFIX/2026-27/000001 per financial year. Changing the prefix starts a new series; issued invoices keep their numbers.',
    kind: 'text',
    group: 'invoice',
  },
};

function display(key: string, value: number | string | null): string {
  if (value === null) return '';
  const kind = LABELS[key]?.kind ?? 'number';
  if (kind === 'rupees') return String(Number(value) / 100);
  if (kind === 'percent_bps') return String(Number(value) / 100);
  return String(value);
}

function parse(key: string, raw: string): number | string | null {
  const meta: Pick<Meta, 'kind' | 'nullable'> = LABELS[key] ?? { kind: 'number' };
  const trimmed = raw.trim();
  if (meta.kind === 'text' || meta.kind === 'textarea') {
    return trimmed === '' && meta.nullable ? null : trimmed;
  }
  if (trimmed === '') return null;
  if (meta.kind === 'rupees' || meta.kind === 'percent_bps') return Math.round(Number(raw) * 100);
  return Number(raw);
}

/** ADMIN-04. One save, one reason, one audit row with every before/after. */
export function PlatformSettingsForm({ settings }: { settings: SettingRow[] }) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(settings.map((s) => [s.key, display(s.key, s.value)])),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    // Only the keys whose value actually changed: an unchanged key re-sent would advance its
    // version and put a no-op line in the audit row, and both of those are lies about history.
    const body: Record<string, unknown> = { reason: reason.trim() };
    for (const s of settings) {
      const next = parse(s.key, values[s.key] ?? '');
      if (next !== s.value) body[s.key] = next;
    }
    if (Object.keys(body).length === 1) {
      setBusy(false);
      setError('Nothing has changed.');
      return;
    }
    const result = await stepUp.run(() => sendJson('/api/v1/admin/settings', 'PATCH', body));
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setReason('');
    setSaved(true);
    router.refresh();
  };

  const field = (s: SettingRow) => {
    const meta = LABELS[s.key] ?? { label: s.key, hint: '', kind: 'number' as Kind };
    const version = s.version === 0 ? 'Currently the built-in default.' : `Version ${s.version}.`;
    return (
      <Field key={s.key} label={meta.label} hint={`${meta.hint} ${version}`}>
        {(control) =>
          meta.kind === 'textarea' ? (
            <Textarea
              {...control}
              value={values[s.key] ?? ''}
              onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
              rows={3}
              maxLength={500}
            />
          ) : (
            <div className="flex items-center gap-2">
              {meta.kind === 'rupees' && <span aria-hidden="true">₹</span>}
              <Input
                {...control}
                type={meta.kind === 'text' ? 'text' : 'number'}
                inputMode={meta.kind === 'text' ? undefined : 'decimal'}
                step={meta.kind === 'percent_bps' ? '0.01' : undefined}
                value={values[s.key] ?? ''}
                onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                className="max-w-xs"
              />
              {meta.kind === 'rupees' && <span className="text-sm text-ink-muted">per year</span>}
              {meta.kind === 'percent_bps' && <span className="text-sm text-ink-muted">%</span>}
            </div>
          )
        }
      </Field>
    );
  };

  const commercial = settings.filter(
    (s) => (LABELS[s.key]?.group ?? 'commercial') === 'commercial',
  );
  const invoice = settings.filter((s) => LABELS[s.key]?.group === 'invoice');

  return (
    <>
      {stepUp.dialog}
      <Card
        title="Commercial settings"
        titleAs="h2"
        description="Versioned. Every save is one audit entry."
      >
        <div className="stack">{commercial.map(field)}</div>
      </Card>

      <Card
        title="Invoices and GST"
        titleAs="h2"
        description="What every invoice says about the seller. Frozen onto each invoice at the moment of sale — changing these never rewrites an issued invoice."
      >
        <div className="stack">
          {invoice.map(field)}

          <Field
            label="Reason for this change"
            required
            hint="Written to the audit log. One reason covers every field changed above."
            error={error}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            )}
          </Field>
          {error && <InlineError>{error}</InlineError>}
          {saved && (
            <p className="text-sm text-success" role="status">
              Saved.
            </p>
          )}
          <div>
            <Button
              onClick={() => void submit()}
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              Save settings
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
