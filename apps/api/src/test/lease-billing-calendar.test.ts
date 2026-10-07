import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { authHeader, createOrganizationFixture } from './helpers.js';

const app = createApp();

/**
 * The billing calendar is an organization-level owner decision: leases inherit
 * it instead of choosing their own, and the API no longer accepts a per-lease
 * value.
 */
describe('lease billing calendar inheritance', () => {
  it('new leases inherit the organization billing calendar set in Settings', async () => {
    const fixture = await createOrganizationFixture();
    const headers = authHeader(fixture);

    const property = await request(app)
      .post('/api/v1/properties')
      .set(headers)
      .send({ name: 'Calendar Tower', type: 'apartment_block' })
      .expect(201);
    const unit = await request(app)
      .post('/api/v1/units')
      .set(headers)
      .send({ propertyId: property.body.property.id, label: 'C1', status: 'vacant' })
      .expect(201);
    const tenant = await request(app)
      .post('/api/v1/tenants')
      .set(headers)
      .send({ fullName: 'Calendar Tenant', phone: '0911334455' })
      .expect(201);

    const leaseBody = {
      unitId: unit.body.unit.id,
      tenantId: tenant.body.tenant.id,
      startDate: { year: 2018, month: 1, day: 1, calendar: 'ethiopian' },
      rentAmount: { amountMinor: 1_000_000, currency: 'ETB' },
      dueDayOfMonth: 5,
      status: 'active',
    };

    // Default organization setting: Ethiopian.
    const first = await request(app).post('/api/v1/leases').set(headers).send(leaseBody).expect(201);
    expect(first.body.lease.billingCalendar).toBe('ethiopian');

    // The owner switches the organization to Gregorian billing in Settings.
    await request(app)
      .patch('/api/v1/organizations/settings')
      .set(headers)
      .send({ defaultBillingCalendar: 'gregorian' })
      .expect(200);

    const secondUnit = await request(app)
      .post('/api/v1/units')
      .set(headers)
      .send({ propertyId: property.body.property.id, label: 'C2', status: 'vacant' })
      .expect(201);
    const second = await request(app)
      .post('/api/v1/leases')
      .set(headers)
      .send({ ...leaseBody, unitId: secondUnit.body.unit.id })
      .expect(201);
    expect(second.body.lease.billingCalendar).toBe('gregorian');
  });
});
