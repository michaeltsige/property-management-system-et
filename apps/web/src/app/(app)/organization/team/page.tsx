'use client';

import { useState } from 'react';

import { roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

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
  const canManage = roleHasPermission(session?.role as Role, 'users.manage');

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.sendNotification({
        templateKey: 'notification.invite_user',
        channel: 'in_app',
        recipientEmail: invite.email,
        values: { email: invite.email, role: 'manager', name: invite.fullName },
      });
      setMessage(t('user.invited', { email: invite.email }));
      setInvite({ email: '', fullName: '' });
      members.reload();
    }).catch(() => undefined);
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

      {roleHasPermission(session?.role as Role, 'users.invite') ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('user.invite')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={sendInvite}>
              <div className="space-y-1">
                <Label htmlFor="invite-email">{t('auth.email')}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={invite.email}
                  onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-name">{t('tenant.full_name')}</Label>
                <Input
                  id="invite-name"
                  value={invite.fullName}
                  onChange={(event) => setInvite((current) => ({ ...current, fullName: event.target.value }))}
                />
              </div>
              <p className="sm:col-span-2 text-xs text-slate-500">
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
                    <Td className="font-medium text-slate-900">{member.fullName}</Td>
                    <Td className="text-xs">{member.email}</Td>
                    <Td>
                      <Badge tone={member.role === 'owner_admin' ? 'brand' : 'neutral'}>
                        {t(`role.${member.role}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={member.status === 'active' ? 'brand' : 'neutral'}>{member.status}</Badge>
                    </Td>
                    <Td>
                      {canManage ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void toggleStatus(member.id, member.status === 'active' ? 'disabled' : 'active')
                          }
                        >
                          {member.status === 'active' ? t('common.disabled') : t('common.enabled')}
                        </Button>
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
