'use client';

import { useState } from 'react';

import { roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import type { Member } from '@/lib/types';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { statusTone } from '@/lib/format';

import { PageHeader } from '@/components/app-shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';

/** The link an invitee opens to set their password; the token IS the credential. */
function inviteLink(token: string): string {
  if (typeof window === 'undefined') return `/accept-invite?token=${token}`;
  return `${window.location.origin}/accept-invite?token=${token}`;
}

/**
 * The organization's people: invite staff, activate or disable accounts.
 * Roles are fixed at creation — there are exactly three (owner/admin, property
 * manager, tenant) and they are not transferable, so this screen has no role
 * selector; a member's role is read-only context.
 */
export default function TeamPage() {
  const { t, session } = usePreferences();
  const members = useAsync(() => api.members(), []);
  const [invite, setInvite] = useState({ email: '', fullName: '' });
  const { pending, error, message, setMessage, run } = useAction();
  // The one-time invite link to hand over, with its expiry.
  const [inviteOutcome, setInviteOutcome] = useState<{
    email: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const canManage = roleHasPermission(session?.role as Role, 'users.manage');
  const canInvite = roleHasPermission(session?.role as Role, 'users.invite');

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api.inviteMember({
        email: invite.email,
        fullName: invite.fullName || undefined,
      });
      setInviteOutcome({
        email: result.invite.email,
        token: result.invite.token,
        expiresAt: result.invite.expiresAt,
      });
      setCopied(false);
      setMessage(null);
      setInvite({ email: '', fullName: '' });
      members.reload();
    }).catch(() => undefined);
  }

  async function resendInvite(member: Member) {
    await run(async () => {
      const result = await api.resendInvite(member.id);
      setInviteOutcome({
        email: result.invite.email,
        token: result.invite.token,
        expiresAt: result.invite.expiresAt,
      });
      setCopied(false);
      setMessage(null);
      members.reload();
    }).catch(() => undefined);
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(true);
    } catch {
      // Clipboard can be blocked (http, permissions); the input stays selectable.
      setCopied(false);
    }
  }

  async function toggleStatus(membershipId: string, next: 'active' | 'disabled') {
    await run(async () => {
      await api.updateMembership(membershipId, { status: next });
      members.reload();
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <PageHeader titleKey="org.team" />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* No email provider is connected, so the invite is handed over here:
          a one-time link the invitee opens to choose their password. */}
      {inviteOutcome ? (
        <Alert tone="success" title={t('user.invited', { email: inviteOutcome.email })}>
          <div className="mt-1 space-y-2">
            <p className="text-xs">{t('user.invite_token_hint', {
              email: inviteOutcome.email,
              date: new Date(inviteOutcome.expiresAt).toLocaleDateString(),
            })}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Input
                readOnly
                value={inviteLink(inviteOutcome.token)}
                onFocus={(event) => event.currentTarget.select()}
                className="h-8 w-full font-mono text-xs sm:flex-1"
                aria-label={t('user.invite_link')}
              />
              <Button variant="outline" size="sm" onClick={() => void copyLink(inviteOutcome.token)}>
                {copied ? t('user.invite_copied') : t('user.copy_link')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInviteOutcome(null)}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('user.invite')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={sendInvite}>
              <div className="space-y-1">
                <Label htmlFor="invite-email" required>
                  {t('auth.email')}
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={invite.email}
                  onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-name">{`${t('tenant.full_name')} (${t('common.optional')})`}</Label>
                <Input
                  id="invite-name"
                  value={invite.fullName}
                  onChange={(event) => setInvite((current) => ({ ...current, fullName: event.target.value }))}
                />
              </div>
              <p className="sm:col-span-2 text-xs text-muted">
                {t('user.invite_hint')}
              </p>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t('app.loading') : t('user.invite')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('org.team')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {members.loading ? (
            <div className="p-4">
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (members.data?.members.length ?? 0) === 0 ? (
            <EmptyState title={t('common.no_results')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('tenant.full_name')}</Th>
                  <Th>{t('auth.email')}</Th>
                  <Th>{t('user.role')}</Th>
                  <Th>{t('unit.status')}</Th>
                  {canManage ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {members.data?.members.map((member) => (
                  <tr key={member.id}>
                    <Td className="font-medium text-strong">{member.fullName}</Td>
                    <Td className="text-xs">{member.email}</Td>
                    <Td>
                      <Badge tone={member.role === 'owner_admin' ? 'brand' : 'neutral'}>
                        {t(`role.${member.role}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[member.status])}>
                        {t(`member.status.${member.status}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage ? (
                        <div className="flex justify-end gap-2">
                          {member.status === 'invited' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={pending}
                              onClick={() => void resendInvite(member)}
                            >
                              {t('user.resend_invite')}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                void toggleStatus(
                                  member.id,
                                  member.status === 'active' ? 'disabled' : 'active',
                                )
                              }
                            >
                              {member.status === 'active' ? t('common.disabled') : t('common.enabled')}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
