'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, InlineError, Input, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/dashboard/ai/send-json';

export interface SettingRow {
  key: string;
  value: number | null;
  version: number;
  updatedAt: string | null;
}

const LABELS: Record<string, { label: string; hint: string; unit?: 'paise' }> = {
  free_generation_limit: {
    label: 'Free Ai drafts per new business',
    hint: 'Lifetime allowance for a business that has not paid. Applies to businesses created from now on; existing ones keep theirs (change those on the business page).',
  },
  annual_price_paise: {
    label: 'Pro price per year',
    hint: 'Charged at checkout from now on. Earlier payments and existing subscriptions keep the price they were sold at.',
    unit: 'paise',
  },
  pro_generation_limit: {
    label: 'Pro Ai drafts per paid year',
    hint: 'Applies to businesses created from now on.',
  },
  fair_use_monthly_soft_limit: {
    label: 'Fair-use warning per month',
    hint: 'Soft threshold for abuse monitoring. Leave empty to turn it off.',
  },
};

/** ADMIN-04. One save, one reason, one audit row with every before/after. */
export function PlatformSettingsForm({ settings }: { settings: SettingRow[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      settings.map((s) => [
        s.key,
        s.value === null
          ? ''
          : s.key === 'annual_price_paise'
            ? String(s.value / 100)
            : String(s.value),
      ]),
    ),
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
      const raw = values[s.key] ?? '';
      const next =
        s.key === 'fair_use_monthly_soft_limit'
          ? raw.trim() === ''
            ? null
            : Number(raw)
          : s.key === 'annual_price_paise'
            ? Math.round(Number(raw) * 100)
            : Number(raw);
      if (next !== s.value) body[s.key] = next;
    }
    if (Object.keys(body).length === 1) {
      setBusy(false);
      setError('Nothing has changed.');
      return;
    }
    const result = await sendJson('/api/v1/admin/settings', 'PATCH', body);
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setReason('');
    setSaved(true);
    router.refresh();
  };

  return (
    <Card
      title="Commercial settings"
      titleAs="h2"
      description="Versioned. Every save is one audit entry."
    >
      <div className="stack">
        {settings.map((s) => {
          const meta = LABELS[s.key] ?? { label: s.key, hint: '' };
          return (
            <Field
              key={s.key}
              label={meta.label}
              hint={`${meta.hint} ${s.version === 0 ? 'Currently the built-in default.' : `Version ${s.version}.`}`}
            >
              {(control) => (
                <div className="flex items-center gap-2">
                  {meta.unit === 'paise' && <span aria-hidden="true">₹</span>}
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    value={values[s.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                    className="max-w-xs"
                  />
                  {meta.unit === 'paise' && (
                    <span className="text-sm text-ink-muted">per year</span>
                  )}
                </div>
              )}
            </Field>
          );
        })}

        <Field
          label="Reason for this change"
          required
          hint="Written to the audit log."
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
          <Button onClick={() => void submit()} loading={busy} disabled={reason.trim().length < 3}>
            Save settings
          </Button>
        </div>
      </div>
    </Card>
  );
}
