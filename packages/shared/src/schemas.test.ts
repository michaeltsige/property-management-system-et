import { describe, expect, it } from 'vitest';

import {
  civilDateSchema,
  createLeaseSchema,
  moneySchema,
  paginationSchema,
  passwordSchema,
  phoneEtSchema,
  recordManualPaymentSchema,
  taxRuleSchema,
  translationKeySchema,
} from './schemas.js';

describe('civil dates are validated against the real calendar', () => {
  it('accepts real dates in both calendars', () => {
    expect(civilDateSchema.safeParse({ year: 2019, month: 1, day: 25, calendar: 'ethiopian' }).success).toBe(
      true,
    );
    expect(civilDateSchema.safeParse({ year: 2019, month: 13, day: 6, calendar: 'ethiopian' }).success).toBe(
      true,
    );
    expect(civilDateSchema.safeParse({ year: 2026, month: 10, day: 5, calendar: 'gregorian' }).success).toBe(
      true,
    );
  });

  it('rejects dates that do not exist', () => {
    // Pagume 2019 has 6 days (leap), Pagume 2020 has 5 (common), and no month has 31 days.
    expect(civilDateSchema.safeParse({ year: 2020, month: 13, day: 6, calendar: 'ethiopian' }).success).toBe(
      false,
    );
    expect(civilDateSchema.safeParse({ year: 2019, month: 1, day: 31, calendar: 'ethiopian' }).success).toBe(
      false,
    );
    expect(civilDateSchema.safeParse({ year: 2026, month: 2, day: 29, calendar: 'gregorian' }).success).toBe(
      false,
    );
    expect(civilDateSchema.safeParse({ year: 2024, month: 2, day: 29, calendar: 'gregorian' }).success).toBe(
      true,
    );
    expect(civilDateSchema.safeParse({ year: 2019, month: 14, day: 1, calendar: 'ethiopian' }).success).toBe(
      false,
    );
  });
});

describe('money schema', () => {
  it('accepts integer minor units and normalises the currency', () => {
    const parsed = moneySchema.parse({ amountMinor: 125050, currency: 'etb' });
    expect(parsed).toEqual({ amountMinor: 125050, currency: 'ETB' });
  });

  it('refuses floats and unknown currencies', () => {
    expect(moneySchema.safeParse({ amountMinor: 12.5, currency: 'ETB' }).success).toBe(false);
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'XYZ' }).success).toBe(false);
  });
});

describe('Ethiopian phone numbers', () => {
  it('normalises mobile numbers to +251', () => {
    expect(phoneEtSchema.parse('0911234567')).toBe('+251911234567');
    expect(phoneEtSchema.parse('+251 91 123 4567')).toBe('+251911234567');
    expect(phoneEtSchema.parse('251911234567')).toBe('+251911234567');
    expect(phoneEtSchema.parse('0712345678')).toBe('+251712345678');
  });

  it('rejects landlines and malformed numbers', () => {
    expect(phoneEtSchema.safeParse('0111234567').success).toBe(false);
    expect(phoneEtSchema.safeParse('09112345').success).toBe(false);
    expect(phoneEtSchema.safeParse('+15551234567').success).toBe(false);
  });
});

describe('translation keys are stable identifiers', () => {
  it('accepts dotted keys and rejects English sentences', () => {
    expect(translationKeySchema.safeParse('lease.status.active').success).toBe(true);
    expect(translationKeySchema.safeParse('nav.property_list').success).toBe(true);
    expect(translationKeySchema.safeParse('Lease Status Active').success).toBe(false);
    expect(translationKeySchema.safeParse('lease').success).toBe(false);
    expect(translationKeySchema.safeParse('lease..status').success).toBe(false);
  });
});

describe('password policy', () => {
  it('requires length plus letters and digits', () => {
    expect(passwordSchema.safeParse('karibu2024aa').success).toBe(true);
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlylettershere').success).toBe(false);
  });
});

describe('lease creation', () => {
  const base = {
    unitId: '5f0c1f4a-9b1e-4a3e-8f2a-0c1b2d3e4f50',
    tenantId: '5f0c1f4a-9b1e-4a3e-8f2a-0c1b2d3e4f51',
    startDate: { year: 2019, month: 1, day: 1, calendar: 'ethiopian' },
    rentAmount: { amountMinor: 1500000, currency: 'ETB' },
    dueDayOfMonth: 5,
  };

  it('accepts a lease with sane defaults', () => {
    const parsed = createLeaseSchema.parse(base);
    expect(parsed.billingFrequency).toBe('monthly');
    expect(parsed.depositType).toBe('months_of_rent');
    expect(parsed.status).toBe('draft');
    expect(parsed.coTenantIds).toEqual([]);
  });

  it('rejects impossible due days and mismatched calendars', () => {
    expect(createLeaseSchema.safeParse({ ...base, dueDayOfMonth: 31 }).success).toBe(false);
    expect(
      createLeaseSchema.safeParse({
        ...base,
        // Ethiopian month 13 has 5/6 days, so day 20 cannot exist in Pagume
        startDate: { year: 2020, month: 13, day: 20, calendar: 'ethiopian' },
      }).success,
    ).toBe(false);
  });

  it('takes no per-lease billing calendar — leases inherit the organization setting', () => {
    // A client-supplied value is dropped; the server stamps the org calendar.
    const parsed = createLeaseSchema.parse({ ...base, billingCalendar: 'gregorian' });
    expect(parsed).not.toHaveProperty('billingCalendar');
  });
});

describe('payments and tax rules', () => {
  it('accepts a manual payment with an offset timestamp', () => {
    const parsed = recordManualPaymentSchema.parse({
      amount: { amountMinor: 1500000, currency: 'ETB' },
      method: 'cash',
      paidAt: '2026-10-05T09:30:00+03:00',
    });
    expect(parsed.method).toBe('cash');
  });

  it('marks tax rules unverified by default', () => {
    const parsed = taxRuleSchema.parse({
      code: 'vat',
      name: 'VAT',
      ratePercent: 15,
      effectiveFrom: '2026-01-01',
    });
    expect(parsed.verified).toBe(false);
    expect(parsed.brackets).toEqual([]);
    expect(parsed.appliesToChargeTypes).toEqual([]);
  });
});

describe('pagination', () => {
  it('coerces query strings and applies safe defaults', () => {
    expect(paginationSchema.parse({})).toMatchObject({ page: 1, pageSize: 25, sortDir: 'desc' });
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
    expect(paginationSchema.safeParse({ pageSize: '5000' }).success).toBe(false);
  });
});
