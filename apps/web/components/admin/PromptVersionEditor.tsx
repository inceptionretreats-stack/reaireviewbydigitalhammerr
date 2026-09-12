'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, InlineError, Input, Modal, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/dashboard/ai/send-json';

/**
 * ADMIN-03 editor. A DRAFT is editable; an ACTIVE or ARCHIVED version is shown read-only with
 * "New draft from this version" as the way to change it — a version that has written drafts
 * must keep saying what it said when it wrote them.
 *
 * The rules are edited as one rule per line. That is the shape people can diff and the shape
 * the builder consumes; there is no richer editor to get wrong.
 */

export interface GuidanceWire {
  language_rules: { en: string[]; hinglish: string[] };
  claim_rules: string[];
  emoji_rules: string[];
  opening_hints: string[];
  emoji_placements: string[];
}

export interface PromptVersionWire {
  id: string;
  version: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  model: string;
  reasoning_effort: string;
  max_output_tokens: number;
  system_prompt: string;
  guidance: GuidanceWire;
}

const join = (lines: string[]) => lines.join('\n');
const split = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

export function PromptVersionEditor({ version: initial }: { version: PromptVersionWire }) {
  const router = useRouter();
  const editable = initial.status === 'DRAFT';
  const [v, setV] = useState({
    version: initial.version,
    model: initial.model,
    reasoning_effort: initial.reasoning_effort,
    max_output_tokens: String(initial.max_output_tokens),
    system_prompt: initial.system_prompt,
    en: join(initial.guidance.language_rules.en),
    hinglish: join(initial.guidance.language_rules.hinglish),
    claim_rules: join(initial.guidance.claim_rules),
    emoji_rules: join(initial.guidance.emoji_rules),
    opening_hints: join(initial.guidance.opening_hints),
    emoji_placements: join(initial.guidance.emoji_placements),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<'activate' | 'archive' | 'clone' | null>(null);
  const [reason, setReason] = useState('');
  const [cloneVersion, setCloneVersion] = useState(bump(initial.version));

  const set = (key: keyof typeof v) => (value: string) => {
    setV({ ...v, [key]: value });
    setSaved(false);
  };

  const body = () => ({
    version: v.version.trim(),
    model: v.model.trim(),
    reasoning_effort: v.reasoning_effort.trim(),
    max_output_tokens: Number(v.max_output_tokens),
    system_prompt: v.system_prompt,
    guidance: {
      language_rules: { en: split(v.en), hinglish: split(v.hinglish) },
      claim_rules: split(v.claim_rules),
      emoji_rules: split(v.emoji_rules),
      opening_hints: split(v.opening_hints),
      emoji_placements: split(v.emoji_placements),
    },
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await sendJson(
      `/api/v1/admin/ai/prompt-versions/${initial.id}`,
      'PATCH',
      body(),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const act = async () => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    let result;
    if (dialog === 'clone') {
      result = await sendJson('/api/v1/admin/ai/prompt-versions', 'POST', {
        clone_from: initial.id,
        version: cloneVersion.trim(),
      });
    } else {
      result = await sendJson(`/api/v1/admin/ai/prompt-versions/${initial.id}/${dialog}`, 'POST', {
        reason: reason.trim(),
      });
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setDialog(null);
    setReason('');
    if (dialog === 'clone') {
      router.push(`/admin/ai/${String(result.payload['id'])}`);
    } else {
      router.refresh();
    }
  };

  const text = (label: string, key: keyof typeof v, hint: string, rows = 5) => (
    <Field label={label} hint={hint}>
      {(control) => (
        <Textarea
          {...control}
          value={v[key]}
          onChange={(e) => set(key)(e.target.value)}
          rows={rows}
          readOnly={!editable}
        />
      )}
    </Field>
  );

  return (
    <div className="stack">
      <Card
        title="Version"
        titleAs="h2"
        description={
          editable
            ? 'A draft. Nothing here reaches a customer until you activate it.'
            : `${initial.status === 'ACTIVE' ? 'The active version — every draft on the platform is written with it.' : 'Archived.'} Read-only: start a new draft from it to change anything.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button onClick={() => void save()} loading={busy}>
                Save draft
              </Button>
            )}
            {initial.status !== 'ACTIVE' && (
              <Button variant="secondary" onClick={() => setDialog('activate')} disabled={busy}>
                {initial.status === 'ARCHIVED' ? 'Roll back to this version' : 'Activate'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('clone')} disabled={busy}>
              New draft from this version
            </Button>
            {initial.status === 'DRAFT' && (
              <Button variant="destructive" onClick={() => setDialog('archive')} disabled={busy}>
                Archive
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Version">
            {(control) => (
              <Input
                {...control}
                value={v.version}
                onChange={(e) => set('version')(e.target.value)}
                readOnly={!editable}
              />
            )}
          </Field>
          <Field label="Model" hint="A model id the configured provider knows.">
            {(control) => (
              <Input
                {...control}
                value={v.model}
                onChange={(e) => set('model')(e.target.value)}
                readOnly={!editable}
              />
            )}
          </Field>
          <Field label="Reasoning effort" hint="none / minimal / low / medium / high, or blank.">
            {(control) => (
              <Input
                {...control}
                value={v.reasoning_effort}
                onChange={(e) => set('reasoning_effort')(e.target.value)}
                readOnly={!editable}
              />
            )}
          </Field>
          <Field label="Max output tokens" hint="On Gemini, thinking tokens count against this.">
            {(control) => (
              <Input
                {...control}
                type="number"
                min={64}
                max={4096}
                value={v.max_output_tokens}
                onChange={(e) => set('max_output_tokens')(e.target.value)}
                readOnly={!editable}
              />
            )}
          </Field>
        </div>
        {text(
          'System prompt',
          'system_prompt',
          'The platform prompt. Owners never see or edit this.',
          8,
        )}
      </Card>

      <Card
        title="Writing rules"
        titleAs="h2"
        description="One rule per line. The first line of a language block introduces the language; the rest are its rules."
      >
        <div className="stack">
          {text(
            'Hinglish rules',
            'hinglish',
            'Applied when a business writes in Hinglish (the default).',
          )}
          {text('English rules', 'en', 'Applied when a business has chosen English.', 3)}
          {text(
            'Claim rules (both languages)',
            'claim_rules',
            'What the model must not invent. Leave empty to turn off.',
            3,
          )}
          {text('Emoji rules', 'emoji_rules', 'Leave empty for no emoji at all.', 3)}
          {text(
            'Opening angles',
            'opening_hints',
            'Rotated per generation, so consecutive drafts open differently. At least one.',
            6,
          )}
          {text(
            'Emoji placements',
            'emoji_placements',
            'Rotated on a different stride from the openings. At least one.',
            4,
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
        {saved && (
          <p className="text-sm text-success" role="status">
            Draft saved.
          </p>
        )}
      </Card>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog === 'activate'
            ? initial.status === 'ARCHIVED'
              ? `Roll back to ${initial.version}`
              : `Activate ${initial.version}`
            : dialog === 'archive'
              ? `Archive ${initial.version}`
              : `New draft from ${initial.version}`
        }
        description={
          dialog === 'activate'
            ? 'Every draft generated from now on uses this version. The current active version is archived and can be rolled back to.'
            : dialog === 'archive'
              ? 'The draft is kept for the record but can no longer be edited or activated.'
              : 'A copy of every field of this version, as an editable draft with a new version number.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void act()}
              loading={busy}
              disabled={
                dialog === 'clone' ? cloneVersion.trim().length < 5 : reason.trim().length < 3
              }
            >
              {dialog === 'activate'
                ? 'Activate'
                : dialog === 'archive'
                  ? 'Archive'
                  : 'Create draft'}
            </Button>
          </>
        }
      >
        {dialog === 'clone' ? (
          <Field label="New version number" hint="Like 1.2.0.">
            {(control) => (
              <Input
                {...control}
                value={cloneVersion}
                onChange={(e) => setCloneVersion(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field
            label="Reason"
            required
            hint="Written to the audit log with your name and the time."
            error={error}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            )}
          </Field>
        )}
      </Modal>
    </div>
  );
}

/** 1.1.0 → 1.2.0; anything unparseable gets a suffix rather than a guess. */
function bump(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return `${version}-next`;
  return `${m[1]}.${Number(m[2]) + 1}.0`;
}
