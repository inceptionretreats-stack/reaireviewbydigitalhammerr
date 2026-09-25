'use client';

import { Button, Drawer, StatusBadge } from '@ai-review/ui';
import type { AssignableFeedbackStatus } from '@/lib/feedback/filters';
import type { FeedbackRow } from '@/lib/feedback/row';

/**
 * FB-02's `detail` state.
 *
 * A drawer rather than a route. The whole message is already in the list response — the column is
 * `varchar(2000)` — so a `/app/feedback/{id}` page would spend a navigation and a second query to
 * show data the browser is holding, and would take the merchant out of the inbox they are working
 * down. `18_UI_UX_Design_System_Brief.md` names a drawer or modal as the pattern for exactly this.
 *
 * Opening a message does not mark it read. FB-02 lists Mark read as its own action, and marking on
 * open would make that action pointless and would fire a write every time someone glanced at a row.
 * The button is repeated here so the two are one click apart in the place the merchant is looking.
 *
 * Nothing in this component can dismiss a message permanently: `private_feedback` has no delete
 * path, and Archive only files.
 */

export interface FeedbackDetailProps {
  /** Null closes the drawer. Keeping the open row in the parent is what lets a filed row close it. */
  row: FeedbackRow | null;
  busy: boolean;
  onClose: () => void;
  onChangeStatus: (next: AssignableFeedbackStatus) => void;
}

export function FeedbackDetail({ row, busy, onClose, onChangeStatus }: FeedbackDetailProps) {
  if (row === null) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Message received ${row.receivedLabel}`}
      description="Private to your business. It is not published anywhere."
      footer={
        <div className="flex flex-wrap gap-2">
          {row.status === 'NEW' && (
            <Button loading={busy} onClick={() => onChangeStatus('READ')}>
              Mark read
            </Button>
          )}
          {row.status === 'ARCHIVED' ? (
            <Button variant="secondary" loading={busy} onClick={() => onChangeStatus('READ')}>
              Move to inbox
            </Button>
          ) : (
            <Button variant="secondary" loading={busy} onClick={() => onChangeStatus('ARCHIVED')}>
              Archive
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink-muted">Received</dt>
            <dd>
              <time dateTime={row.receivedIso}>{row.receivedLabel}</time>
            </dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink-muted">Status</dt>
            <dd>
              <StatusBadge status={row.status} />
            </dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink-muted">Name</dt>
            {/*
              Optional on FB-01, so "Not given" is an ordinary answer rather than a missing value.
              AC-039: this is the only screen in the product that shows it.
            */}
            <dd className={row.name === null ? 'text-ink-muted' : undefined}>
              {row.name ?? 'Not given'}
            </dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink-muted">Mobile</dt>
            <dd className={row.mobile === null ? 'text-ink-muted' : undefined}>
              {row.mobile ?? 'Not given'}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink-muted">Message</h3>
          {/*
            `whitespace-pre-wrap` keeps the paragraphs the customer typed. It is rendered as text,
            never as markup, so a message containing HTML is shown rather than interpreted.
          */}
          <p className="rounded-card border border-line bg-surface p-3 text-sm whitespace-pre-wrap">
            {row.message}
          </p>
        </div>

        <p className="text-sm text-ink-muted">
          Names and mobile numbers stay on this screen. They never appear on your public page and
          are not part of any analytics report.
        </p>
      </div>
    </Drawer>
  );
}
