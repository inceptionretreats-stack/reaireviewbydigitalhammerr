'use client';

import { Button, InlineError, Modal } from '@ai-review/ui';
import type { QrSource } from './qr-sources';

/**
 * QR-01's `disabled` state, confirmed before it is entered.
 *
 * Disabling is confirmed while enabling is not, and that asymmetry is the point: the code being
 * switched off is printed on something in the physical world, and the owner cannot see who is
 * standing in front of it. Enabling only ever restores service, so it happens on one click.
 *
 * The copy answers the two questions an owner actually has — what a customer sees now, and whether
 * this is permanent. Both answers come from `app/(customer)/r/[code]/page.tsx`, which renders a short
 * unavailable page for a disabled code rather than a 404 (QR-01-02), and from the fact that the
 * code is immutable and reversible (QR-01-01), so nothing printed is wasted.
 */

export interface DisableQrDialogProps {
  open: boolean;
  source: QrSource | null;
  busy: boolean;
  /** Set when the last attempt failed; already a safe, user-facing message. */
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DisableQrDialog({
  open,
  source,
  busy,
  error,
  onClose,
  onConfirm,
}: DisableQrDialogProps) {
  if (!source) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Disable ${source.label}?`}
      dismissOnBackdrop={false}
      closeLabel="Cancel"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            loadingLabel="Disabling…"
            onClick={onConfirm}
          >
            Disable this QR
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink">
        {error && <InlineError>{error}</InlineError>}

        <p className="m-0">
          Anyone who scans it will see a short &ldquo;not available&rdquo; message instead of your
          review page. Use this when a standee has been taken down or moved.
        </p>
        <p className="m-0 text-ink-muted">
          Nothing is deleted. The code{' '}
          <code className="rounded-control bg-surface px-1.5 py-0.5 font-mono break-all">
            {source.code}
          </code>{' '}
          stays as it is, and enabling this source again brings the same printed standee straight
          back to life.
        </p>
      </div>
    </Modal>
  );
}
