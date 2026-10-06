import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
const app = createApp();
const base = {
  organizationName: 'Demo Management',
  fullName: 'Demo Admin',
  email: 'admin@example.test',
  password: 'StrongPass123',
  phone: '0911234567',
};
describe('signup billing defaults', () => {
  it('stores display and billing calendars independently with exact fee inputs', async () => {
    const r = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...base,
        accountType: 'management_company',
        portfolioMode: 'managed',
        calendar: 'gregorian',
        language: 'om',
        billing: {
          billingCalendar: 'ethiopian',
          dueDay: 8,
          graceDays: 3,
          lateFeeRule: 'fixed',
          lateFeeMinor: 15000,
          acceptedPaymentMethods: ['cash', 'chapa'],
        },
      })
      .expect(201);
    const id = r.body.organization.id;
    const rows = await getPrisma().organizationSetting.findMany({ where: { organizationId: id } });
    const settings = Object.fromEntries(rows.map((x) => [x.key, x.value]));
    expect(settings).toMatchObject({
      accountType: 'management_company',
      defaultCalendar: 'gregorian',
      defaultLanguage: 'om',
      defaultBillingCalendar: 'ethiopian',
      rentDueDay: 8,
      gracePeriodDays: 3,
      lateFeeEnabled: true,
      lateFeeType: 'fixed',
      lateFeeFixedMinor: 15000,
      acceptedPaymentMethods: ['cash', 'chapa'],
    });
    expect(await getPrisma().ledgerEntry.count()).toBe(0);
    expect(await getPrisma().property.count()).toBe(0);
  });
  it.each([
    { currency: 'USD' },
    { billing: { dueDay: 29 } },
    { billing: { lateFeeBps: 1.5 } },
    { billing: { acceptedPaymentMethods: ['cash', 'cash'] } },
    { billing: { lateFeeMinor: -1 } },
    { billing: { acceptedPaymentMethods: [] } },
  ])('rejects invalid signup settings %o', async (extra) => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base, ...extra })
      .expect(400);
    expect(await getPrisma().organization.count()).toBe(0);
  });
  it('keeps old clients valid with conservative defaults', async () => {
    const r = await request(app).post('/api/v1/auth/register').send(base).expect(201);
    const row = await getPrisma().organizationSetting.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: r.body.organization.id, key: 'lateFeeEnabled' } },
    });
    expect(row.value).toBe(false);
  });
});
