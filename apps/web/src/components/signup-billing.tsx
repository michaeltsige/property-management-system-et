'use client';
import type { z } from 'zod';
import type { signupBillingSchema } from '@pms/shared';
import { usePreferences, CALENDARS } from '@/lib/preferences';
import { MoneyInput } from './form-controls';
import { feeText, feeToBps } from './hierarchy-controls';
import { Input, Label, Select } from './ui';
import { useState } from 'react';
export type SignupBilling = z.infer<typeof signupBillingSchema>;
export function SignupBillingForm({
  value,
  onChange,
}: {
  value: SignupBilling;
  onChange: (v: SignupBilling) => void;
}) {
  const { t } = usePreferences();
  const [rate, setRate] = useState(feeText(value.lateFeeBps));
  const update = (patch: Partial<SignupBilling>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t('onboarding.billing_hint')}</p>
      <Label htmlFor="billing-calendar">{t('lease.billing_calendar')}</Label>
      <Select
        id="billing-calendar"
        value={value.billingCalendar}
        onChange={(e) => update({ billingCalendar: e.target.value as SignupBilling['billingCalendar'] })}
      >
        {CALENDARS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.english}
          </option>
        ))}
      </Select>
      <Label htmlFor="due-day">{t('onboarding.due_day')}</Label>
      <Input
        id="due-day"
        type="number"
        required
        min={1}
        max={28}
        value={value.dueDay}
        onChange={(e) => update({ dueDay: e.target.valueAsNumber })}
      />
      <Label htmlFor="grace-days">{t('onboarding.grace_days')}</Label>
      <Input
        id="grace-days"
        type="number"
        required
        min={0}
        max={60}
        value={value.graceDays}
        onChange={(e) => update({ graceDays: e.target.valueAsNumber })}
      />
      <Label htmlFor="fee-rule">{t('onboarding.fee_rule')}</Label>
      <Select
        id="fee-rule"
        value={value.lateFeeRule}
        onChange={(e) => update({ lateFeeRule: e.target.value as SignupBilling['lateFeeRule'] })}
      >
        {(['none', 'percent', 'fixed'] as const).map((x) => (
          <option key={x} value={x}>
            {t(`onboarding.${x}`)}
          </option>
        ))}
      </Select>
      {value.lateFeeRule === 'percent' && (
        <>
          <Label htmlFor="late-rate">{t('onboarding.fee_percent')}</Label>
          <Input
            id="late-rate"
            inputMode="decimal"
            required
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              try {
                update({ lateFeeBps: feeToBps(e.target.value) ?? 0 });
                e.target.setCustomValidity('');
              } catch {
                e.target.setCustomValidity(t('portfolio.fee_invalid'));
              }
            }}
          />
        </>
      )}
      {value.lateFeeRule === 'fixed' && (
        <MoneyInput
          label={t('onboarding.fee_amount')}
          value={value.lateFeeMinor}
          onChange={(v) => update({ lateFeeMinor: v ?? 0 })}
        />
      )}
      <fieldset>
        <legend className="text-sm font-medium">{t('onboarding.payment_methods')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['cash', 'bank_transfer', 'telebirr', 'chapa'] as const).map((method) => (
            <label key={method} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.acceptedPaymentMethods.includes(method)}
                onChange={(e) =>
                  update({
                    acceptedPaymentMethods: e.target.checked
                      ? [...value.acceptedPaymentMethods, method]
                      : value.acceptedPaymentMethods.filter((m) => m !== method),
                  })
                }
              />
              {t(`payment.method.${method}` as never)}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-sm">{t('onboarding.currency')}: ETB</p>
    </div>
  );
}
