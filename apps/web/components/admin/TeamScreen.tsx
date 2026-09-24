'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  type TableColumn,
} from '@ai-review/ui';
import { sendJson } from '@/components/shared/forms/send-json';
import { useStepUp } from './MfaStepUpDialog';

/**
 * The admin team (AMENDMENT-027). Members with their MFA state, live invitations, and the
 * four actions — invite, change role, disable/enable, reset MFA — each behind a reason and a
 * fresh authenticator code (step-up), because each one changes who can administer the platform.
 */

export interface TeamMemberWire {
  id: string;
  email: string;
  full_name: string;
  role: 'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER';
  mfa_enabled_at: string | null;
  last_login_at: string | null;
  disabled_at: string | null;
  created_at: string;
  /** Preformatted on the server in the platform timezone. */
  last_login_label: string;
  mfa_label: string;
}

export interface InviteWire {
  id: string;
  email: string;
  full_name: string | null;
  role: 'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER';
  expires_label: string;
}

const ROLE_LABEL = {
  SUPER_ADMIN: 'Platform admin',
  BUSINESS_SUPPORT_VIEWER: 'Support viewer (read-only)',
} as const;

type Dialog =
  | { kind: 'invite' }
  | { kind: 'change_role'; member: TeamMemberWire }
  | { kind: 'disable'; member: TeamMemberWire }
  | { kind: 'enable'; member: TeamMemberWire }
  | { kind: 'mfa_reset'; member: TeamMemberWire };

export function TeamScreen({
  members,
  invites,
  selfId,
}: {
  members: TeamMemberWire[];
  invites: InviteWire[];
  selfId: string;
}) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER'>('SUPER_ADMIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const open = (next: Dialog) => {
    setDialog(next);
    setReason('');
    setError(null);
    setInviteLink(null);
    if (next.kind === 'change_role') {
      setRole(next.member.role === 'SUPER_ADMIN' ? 'BUSINESS_SUPPORT_VIEWER' : 'SUPER_ADMIN');
    }
    if (next.kind === 'invite') {
      setEmail('');
      setFullName('');
      setRole('SUPER_ADMIN');
    }
  };

  const act = async () => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    const result = await stepUp.run(() => {
      switch (dialog.kind) {
        case 'invite':
          return sendJson('/api/v1/admin/team', 'POST', {
            email: email.trim(),
            full_name: fullName.trim(),
            role,
            reason: reason.trim(),
          });
        case 'change_role':
          return sendJson(`/api/v1/admin/team/${dialog.member.id}`, 'PATCH', {
            action: 'change_role',
            role,
            reason: reason.trim(),
          });
        case 'disable':
        case 'enable':
          return sendJson(`/api/v1/admin/team/${dialog.member.id}`, 'PATCH', {
            action: dialog.kind,
            reason: reason.trim(),
          });
        case 'mfa_reset':
          return sendJson(`/api/v1/admin/team/${dialog.member.id}/mfa/reset`, 'POST', {
            reason: reason.trim(),
          });
      }
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    if (dialog.kind === 'invite' && typeof result.payload['invite_url'] === 'string') {
      // Shown when there is no mail provider (or it failed): the admin passes the link on.
      setInviteLink(result.payload['invite_url']);
      router.refresh();
      return;
    }
    setDialog(null);
    router.refresh();
  };

  const revokeInvite = async (id: string) => {
    await fetch(`/api/v1/admin/team/invites/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  const memberColumns: TableColumn<TeamMemberWire>[] = [
    {
      key: 'who',
      header: 'Member',
      isRowHeader: true,
      cell: (m) => (
        <div className="flex flex-col">
          <Link href={`/admin/team/${m.id}`} className="font-semibold text-ink">
            {m.full_name}
            {m.id === selfId ? ' (you)' : ''}
          </Link>
          <span className="text-xs text-ink-muted">{m.email}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (m) => (
        <Badge tone={m.role === 'SUPER_ADMIN' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
      ),
    },
    { key: 'mfa', header: 'Authenticator', cell: (m) => m.mfa_label },
    { key: 'seen', header: 'Last sign-in', cell: (m) => m.last_login_label },
    {
      key: 'status',
      header: 'Status',
      cell: (m) =>
        m.disabled_at ? (
          <Badge tone="danger">Disabled</Badge>
        ) : (
          <Badge tone="success">Active</Badge>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (m) =>
        m.id === selfId ? (
          <span className="text-xs text-ink-muted">Ask another admin</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="text" onClick={() => open({ kind: 'change_role', member: m })}>
              Change role
            </Button>
            {m.disabled_at ? (
              <Button variant="text" onClick={() => open({ kind: 'enable', member: m })}>
                Enable
              </Button>
            ) : (
              <Button variant="text" onClick={() => open({ kind: 'disable', member: m })}>
                Disable
              </Button>
            )}
            {m.mfa_enabled_at && (
              <Button variant="text" onClick={() => open({ kind: 'mfa_reset', member: m })}>
                Reset MFA
              </Button>
            )}
          </div>
        ),
    },
  ];

  const inviteColumns: TableColumn<InviteWire>[] = [
    { key: 'email', header: 'Invited', isRowHeader: true, cell: (i) => i.email },
    { key: 'name', header: 'Name', cell: (i) => i.full_name ?? '—' },
    { key: 'role', header: 'Role', cell: (i) => ROLE_LABEL[i.role] },
    { key: 'expires', header: 'Expires', cell: (i) => i.expires_label },
    {
      key: 'actions',
      header: 'Actions',
      cell: (i) => (
        <Button variant="text" onClick={() => void revokeInvite(i.id)}>
          Withdraw
        </Button>
      ),
    },
  ];

  const title = !dialog
    ? ''
    : dialog.kind === 'invite'
      ? 'Invite to the admin team'
      : dialog.kind === 'change_role'
        ? `Change ${dialog.member.full_name}'s role`
        : dialog.kind === 'disable'
          ? `Disable ${dialog.member.full_name}`
          : dialog.kind === 'enable'
            ? `Enable ${dialog.member.full_name}`
            : `Reset ${dialog.member.full_name}'s authenticator`;

  const description = !dialog
    ? ''
    : dialog.kind === 'invite'
      ? 'They get an emailed link that sets a password, then must set up an authenticator app before they can do anything.'
      : dialog.kind === 'change_role'
        ? 'They are signed out everywhere and sign back in with the new role.'
        : dialog.kind === 'disable'
          ? 'They are signed out everywhere and cannot sign in until enabled again. Their audit history stays.'
          : dialog.kind === 'enable'
            ? 'They can sign in again with their existing password and authenticator.'
            : 'Their authenticator and recovery codes are removed and they are signed out. At their next sign-in they set up a new app.';

  const canSubmit =
    reason.trim().length >= 3 &&
    (dialog?.kind !== 'invite' || (email.includes('@') && fullName.trim().length >= 2));

  return (
    <div className="stack">
      {stepUp.dialog}
      <Card
        title="Team"
        titleAs="h2"
        description="Everyone who can open this admin area. Every change here is audited with your name and a reason."
        actions={<Button onClick={() => open({ kind: 'invite' })}>Invite admin</Button>}
      >
        <Table caption="Admin team" columns={memberColumns} rows={members} rowKey={(m) => m.id} />
      </Card>

      <Card title="Pending invitations" titleAs="h2">
        <Table
          caption="Pending invitations"
          columns={inviteColumns}
          rows={invites}
          rowKey={(i) => i.id}
          empty={<EmptyState title="No open invitations" />}
        />
      </Card>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={title}
        description={description}
        footer={
          inviteLink ? (
            <Button onClick={() => setDialog(null)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => void act()}
                loading={busy}
                disabled={!canSubmit}
                variant={dialog?.kind === 'disable' ? 'destructive' : 'primary'}
              >
                {dialog?.kind === 'invite'
                  ? 'Send invitation'
                  : dialog?.kind === 'change_role'
                    ? 'Change role'
                    : dialog?.kind === 'disable'
                      ? 'Disable account'
                      : dialog?.kind === 'enable'
                        ? 'Enable account'
                        : 'Reset authenticator'}
              </Button>
            </>
          )
        }
      >
        {inviteLink ? (
          <div className="stack">
            <p className="text-sm text-ink">
              The invitation is ready. No email went out from this deployment, so pass this link on
              yourself — it works once and expires in three days.
            </p>
            <code className="block rounded-control bg-surface p-3 text-xs break-all">
              {inviteLink}
            </code>
          </div>
        ) : (
          <div className="stack">
            {dialog?.kind === 'invite' && (
              <>
                <Field label="Email" required>
                  {(control) => (
                    <Input
                      {...control}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field label="Name" required>
                  {(control) => (
                    <Input
                      {...control}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </Field>
              </>
            )}
            {(dialog?.kind === 'invite' || dialog?.kind === 'change_role') && (
              <Field label="Role" required>
                {(control) => (
                  <Select
                    {...control}
                    value={role}
                    onChange={(e) => setRole(e.target.value as typeof role)}
                    options={[
                      { value: 'SUPER_ADMIN', label: ROLE_LABEL.SUPER_ADMIN },
                      {
                        value: 'BUSINESS_SUPPORT_VIEWER',
                        label: ROLE_LABEL.BUSINESS_SUPPORT_VIEWER,
                      },
                    ]}
                  />
                )}
              </Field>
            )}
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
            {error && <InlineError>{error}</InlineError>}
          </div>
        )}
      </Modal>
    </div>
  );
}
