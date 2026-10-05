/**
 * Cross-organization isolation.
 *
 * The brief requires a test proving that one organization cannot read another's
 * data. Two independent organizations are created through the API, each with its own
 * staff, properties, leases, charges and payments, and every read/write path is
 * probed from the other side. A foreign record must be indistinguishable from a
 * missing one (404), never a 403.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';

const app = createApp();

async function buildOrganization(label: string) {
  const fixture = await createOrganizationFixture(label);
  const headers = authHeader(fixture);

  const property = await request(app)
    .post('/api/v1/properties')
    .set(headers)
    .send({
      name: `${label} Tower`,
      type: 'apartment_block',
      address: { subCity: 'Bole', woreda: '03', landmark: `${label} landmark` },
    })
    .expect(201);

  const unit = await request(app)
    .post('/api/v1/units')
    .set(headers)
    .send({
      propertyId: property.body.property.id,
      label: 'A1',
      status: 'occupied',
      marketRent: { amountMinor: 1500000, currency: 'ETB' },
    })
    .expect(201);

  const tenant = await request(app)
    .post('/api/v1/tenants')
    .set(headers)
    .send({
      fullName: `${label} Tenant`,
      phone: '0911223344',
      idDocuments: [{ type: 'kebele_id', number: `DEMO-${label}-0001` }],
    })
    .expect(201);

  const lease = await request(app)
    .post('/api/v1/leases')
    .set(headers)
    .send({
      unitId: unit.body.unit.id,
      tenantId: tenant.body.tenant.id,
      billingCalendar: 'ethiopian',
      startDate: { year: 2015, month: 1, day: 1, calendar: 'ethiopian' },
      rentAmount: { amountMinor: 1500000, currency: 'ETB' },
      dueDayOfMonth: 5,
      status: 'active',
    })
    .expect(201);

  const generation = await request(app)
    .post('/api/v1/charges/generate')
    .set(headers)
    .send({ periodKeys: ['2019-01'], leaseIds: [lease.body.lease.id] })
    .expect(201);

  const payment = await request(app)
    .post('/api/v1/payments')
    .set(headers)
    .send({
      leaseId: lease.body.lease.id,
      amount: { amountMinor: 1500000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date().toISOString(),
      reference: `${label}-RECEIPT-1`,
    })
    .expect(201);

  return {
    fixture,
    headers,
    propertyId: property.body.property.id as string,
    unitId: unit.body.unit.id as string,
    tenantId: tenant.body.tenant.id as string,
    leaseId: lease.body.lease.id as string,
    chargeId:
      (generation.body.charges[0] as { leaseId: string } | undefined) && generation.body.charges[0].leaseId,
    paymentId: payment.body.paymentId as string,
    generated: generation.body as { created: number },
  };
}

describe('multi-organization isolation', () => {
  it("never lets one organization see another organization's records", async () => {
    const alpha = await buildOrganization('alpha');
    const beta = await buildOrganization('beta');

    expect(alpha.generated.created).toBe(1);
    expect(beta.generated.created).toBe(1);

    // --- lists contain only own data -------------------------------------
    const alphaLeases = await request(app).get('/api/v1/leases').set(alpha.headers).expect(200);
    expect(alphaLeases.body.leases).toHaveLength(1);
    expect(alphaLeases.body.leases[0].id).toBe(alpha.leaseId);

    const betaTenants = await request(app).get('/api/v1/tenants').set(beta.headers).expect(200);
    expect(betaTenants.body.tenants.map((t: { id: string }) => t.id)).not.toContain(alpha.tenantId);

    const betaCharges = await request(app)
      .get(`/api/v1/charges?leaseId=${alpha.leaseId}`)
      .set(beta.headers)
      .expect(200);
    expect(betaCharges.body.items).toHaveLength(0);
    expect(betaCharges.body.total).toBe(0);

    const betaPayments = await request(app)
      .get(`/api/v1/payments?leaseId=${alpha.leaseId}`)
      .set(beta.headers)
      .expect(200);
    expect(betaPayments.body.items).toHaveLength(0);

    // --- direct access to a foreign record is a 404, never a 403 ---------
    await request(app).get(`/api/v1/leases/${alpha.leaseId}`).set(beta.headers).expect(404);
    await request(app).get(`/api/v1/leases/${alpha.leaseId}/statement`).set(beta.headers).expect(404);

    await request(app)
      .patch(`/api/v1/leases/${alpha.leaseId}`)
      .set(beta.headers)
      .send({ rentAmount: { amountMinor: 1, currency: 'ETB' } })
      .expect(404);

    await request(app)
      .post(`/api/v1/leases/${alpha.leaseId}/deposit-charge`)
      .set(beta.headers)
      .send({ amount: { amountMinor: 100000, currency: 'ETB' }, dueDate: new Date().toISOString() })
      .expect(404);

    await request(app)
      .post('/api/v1/payments')
      .set(beta.headers)
      .send({
        leaseId: alpha.leaseId,
        amount: { amountMinor: 100000, currency: 'ETB' },
        method: 'cash',
        paidAt: new Date().toISOString(),
      })
      .expect(404);

    await request(app).get(`/api/v1/tenants/${alpha.tenantId}/id-documents`).set(beta.headers).expect(404);

    // --- generation cannot be aimed at another organization --------------
    const crossGeneration = await request(app)
      .post('/api/v1/charges/generate')
      .set(beta.headers)
      .send({ periodKeys: ['2019-02'], leaseIds: [alpha.leaseId] })
      .expect(201);
    expect(crossGeneration.body.created).toBe(0);

    const prisma = getPrisma();
    const alphaCharges = await prisma.charge.count({
      where: { organizationId: alpha.fixture.organizationId },
    });
    expect(alphaCharges).toBe(1); // unchanged by beta's attempt
  });

  it('scopes the audit log to the organization that produced it', async () => {
    const alpha = await buildOrganization('audit-alpha');
    await buildOrganization('audit-beta');
    const prisma = getPrisma();

    const alphaAudits = await prisma.auditLog.findMany({
      where: { organizationId: alpha.fixture.organizationId },
    });
    const otherOrgs = new Set(alphaAudits.map((entry) => entry.organizationId));
    expect(otherOrgs.size).toBe(1);
    expect(otherOrgs.has(alpha.fixture.organizationId)).toBe(true);
    // Creating portfolio records, generating a charge and recording a payment all
    // leave a trail. (`Organization` is created directly by the fixture, so it is
    // not in this list: the API path is covered by auth.test.ts.)
    expect(alphaAudits.map((entry) => entry.entityType)).toEqual(
      expect.arrayContaining(['Property', 'Unit', 'Tenant', 'Lease', 'Charge', 'Payment']),
    );
    expect(alphaAudits.every((entry) => entry.actorUserId === alpha.fixture.userId)).toBe(true);
  });

  it("keeps ledgers separated: one organization's balance is unaffected by another's payments", async () => {
    const alpha = await buildOrganization('ledger-alpha');
    const beta = await buildOrganization('ledger-beta');

    const alphaStatement = await request(app)
      .get(`/api/v1/leases/${alpha.leaseId}/statement`)
      .set(alpha.headers)
      .expect(200);

    // 1,500,000 charged, 1,500,000 paid -> zero.
    expect(alphaStatement.body.balanceMinor).toBe('0');

    const betaStatement = await request(app)
      .get(`/api/v1/leases/${beta.leaseId}/statement`)
      .set(beta.headers)
      .expect(200);
    expect(betaStatement.body.lines).toHaveLength(2); // one charge, one payment
  });
});
