'use client';

/**
 * Organization → Payment gateway.
 *
 * The org's admins choose which provider runs tenant online payments and save
 * its merchant credentials here. The demo provider (`mock`) simulates a full
 * checkout and moves no money — it is the default until the organization's
 * business license unlocks real Telebirr/Chapa credentials. Switching later is
 * a save on this form, not a code change: the credential structure is the same
 * for every provider.
 *
 * Saved credential values are encrypted at rest and never returned by the API —
 * only a `••••last4` hint is shown. An empty input keeps the saved value.
 */

import { useEffect, useState } from 'react';

import {
  PAYMENT_GATEWAY_CREDENTIAL_FIELDS,
  PAYMENT_GATEWAY_MODES,
  PAYMENT_GATEWAY_PROVIDERS,
  type PaymentGatewayProvider,
} from '@pms/shared';

import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Skeleton,
} from '@/components/ui';

const PROVIDER_LABEL_KEYS: Record<PaymentGatewayProvider, string> = {
  mock: 'org.gateway_provider_mock',
  telebirr: 'org.gateway_provider_telebirr',
  chapa: 'org.gateway_provider_chapa',
};

export function PaymentGatewaySettings() {
  const { t } = usePreferences();
  const gateway = useAsync(() => api.paymentGateway(), []);
  const { pending, error, message, setMessage, run } = useAction();

  const [provider, setProvider] = useState<PaymentGatewayProvider | null>(null);
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [values, setValues] = useState<Record<string, string>>({});

  const status = gateway.data?.gateway ?? null;
  const active: PaymentGatewayProvider = provider ?? status?.provider ?? 'mock';

  useEffect(() => {
    if (!gateway.data) return;
    setProvider(gateway.data.gateway.provider);
    setMode(gateway.data.gateway.mode ?? 'test');
    setValues({});
  }, [gateway.data]);

  function switchProvider(next: string) {
    setProvider(next as PaymentGatewayProvider);
    setMode('test');
    setValues({});
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!provider) return;
    await run(async () => {
      const credentials = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value.trim() !== ''),
      );
      const result = await api.updatePaymentGateway({ provider, mode, credentials });
      setMessage(t('org.gateway_saved'));
      gateway.reload();
      setProvider(result.gateway.provider);
      setMode(result.gateway.mode ?? 'test');
      setValues({});
    }).catch(() => undefined);
  }

  async function reset() {
    if (!window.confirm(t('org.gateway_reset_confirm'))) return;
    await run(async () => {
      await api.resetPaymentGateway();
      setMessage(t('org.gateway_reset_done'));
      gateway.reload();
      setProvider(null);
      setValues({});
    }).catch(() => undefined);
  }

  if (gateway.loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('org.gateway_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  const fields = PAYMENT_GATEWAY_CREDENTIAL_FIELDS[active];
  const savedCredentials = status?.provider === active ? (status?.credentials ?? {}) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('org.gateway_title')}
          {status && active === 'mock' ? (
            <Badge tone="neutral">{t('org.gateway_demo_badge')}</Badge>
          ) : status?.configured ? (
            <Badge tone={mode === 'live' ? 'brand' : 'neutral'}>
              {mode === 'live' ? t('org.gateway_mode_live') : t('org.gateway_mode_test')}
            </Badge>
          ) : (
            <Badge tone="warning">{t('org.gateway_incomplete')}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">{t('org.gateway_hint')}</p>

        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {status && status.source === 'platform' ? (
          <Alert tone="info">{t('org.gateway_platform_source')}</Alert>
        ) : null}
        {status && !status.configured && status.missing.length > 0 ? (
          <Alert tone="warning">
            {t('org.gateway_missing', { fields: status.missing.join(', ') })}
          </Alert>
        ) : null}
        {active === 'mock' ? <Alert tone="info">{t('org.gateway_demo_note')}</Alert> : null}
        {active !== 'mock' && mode === 'live' ? (
          <Alert tone="warning">{t('org.gateway_live_note')}</Alert>
        ) : null}

        <form className="space-y-3" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="gateway-provider">{t('org.gateway_provider')}</Label>
              <Select id="gateway-provider" value={active} onChange={(e) => switchProvider(e.target.value)}>
                {PAYMENT_GATEWAY_PROVIDERS.map((option) => (
                  <option key={option} value={option}>
                    {t(PROVIDER_LABEL_KEYS[option] as never)}
                  </option>
                ))}
              </Select>
            </div>
            {active !== 'mock' ? (
              <div className="space-y-1">
                <Label htmlFor="gateway-mode">{t('org.gateway_mode')}</Label>
                <Select
                  id="gateway-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'test' | 'live')}
                >
                  {PAYMENT_GATEWAY_MODES.map((option) => (
                    <option key={option} value={option}>
                      {option === 'test' ? t('org.gateway_mode_test') : t('org.gateway_mode_live')}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>

          {fields.length > 0 ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label htmlFor={`gateway-${field.key}`}>{t(field.i18nKey as never)}</Label>
                    <Input
                      id={`gateway-${field.key}`}
                      type={field.secret ? 'password' : 'text'}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={
                        savedCredentials[field.key]?.configured
                          ? (savedCredentials[field.key].hint ?? '')
                          : undefined
                      }
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">{t('org.gateway_credentials_hint')}</p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
            {status?.source === 'organization' ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => void reset()}>
                {t('org.gateway_reset')}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
