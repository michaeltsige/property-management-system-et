/**
 * Tenant ID documents: masked by default, readable in full only with
 * `tenants.ids.read` (and audited), and reviewable with `tenants.write`.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/crypto.js';
import { issueTokens } from '../services/auth.service.js';
import { authHeader, createOrganizationFixture, type Fixture } from './helpers.js';

/** Add an accountant member to an existing organization and return its header. */
async function accountantIn(organizationId: string): Promise<Record<string, string>> {
  const prisma = getPrisma();
  const email = `acct-${Math.random().toString(36).slice(2, 10)}@test.local`;
  const user = await prisma.user.create({
    data: { email, fullName: 'Accountant', passwordHash: await hashPassword('TestPass123') },
  });
  await prisma.membership.create({
    data: { organizationId, userId: user.id, role: 'accountant', status: 'active', acceptedAt: new Date() },
  });
  const tokens = await issueTokens(user.id, organizationId, 'accountant', email, false);
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

const app = createApp();
const ID_NUMBER = 'PN-1234567890';

let owner: Fixture;
let tenantId: string;
let documentId: string;

async function createTenantWithDocument(fixture: Fixture): Promise<{ tenantId: string; documentId: string }> {
  const created = await request(app)
    .post('/api/v1/tenants')
    .set(authHeader(fixture))
    .send({
      fullName: 'Demo Tenant',
      phone: '0911000999',
      language: 'am',
      idDocuments: [{ type: 'national_id', number: ID_NUMBER, issuedBy: 'Vital Events' }],
    })
    .expect(201);
  const listed = await request(app).get('/api/v1/tenants').set(authHeader(fixture)).expect(200);
  const tenant = listed.body.tenants.find((row: { id: string }) => row.id === created.body.tenant.id);
  const documents = await getPrisma().tenantIdDocument.findMany({ where: { tenantId: tenant.id } });
  return { tenantId: tenant.id, documentId: documents[0].id };
}

beforeEach(async () => {
  owner = await createOrganizationFixture('idorg');
  ({ tenantId, documentId } = await createTenantWithDocument(owner));
});

describe('tenant ID documents', () => {
  it('lists documents masked and never includes the full number', async () => {
    const listed = await request(app)
      .get(`/api/v1/tenants/${tenantId}/id-documents`)
      .set(authHeader(owner))
      .expect(200);
    expect(listed.body.documents[0].maskedNumber).toBe('****7890');
    expect(JSON.stringify(listed.body)).not.toContain(ID_NUMBER);
  });

  it('reveals the full number only with tenants.ids.read and audits the read', async () => {
    const revealed = await request(app)
      .get(`/api/v1/tenants/${tenantId}/id-documents/${documentId}`)
      .set(authHeader(owner))
      .expect(200);
    expect(revealed.body.document.number).toBe(ID_NUMBER);
    expect(revealed.body.document.type).toBe('national_id');

    const audit = await getPrisma().auditLog.findFirst({
      where: { entityType: 'TenantIdDocument', entityId: documentId, action: 'read_id' },
    });
    expect(audit).not.toBeNull();
    // The audit row proves the read without storing the number itself.
    expect(JSON.stringify(audit)).not.toContain(ID_NUMBER);
  });

  it('refuses the reveal for roles without tenants.ids.read even inside the org', async () => {
    // Accountants can read tenant records but never identity numbers.
    const accountant = await accountantIn(owner.organizationId);
    await request(app).get(`/api/v1/tenants/${tenantId}/id-documents`).set(accountant).expect(200);
    await request(app)
      .get(`/api/v1/tenants/${tenantId}/id-documents/${documentId}`)
      .set(accountant)
      .expect(403);
    await request(app)
      .post(`/api/v1/tenants/${tenantId}/id-documents/${documentId}/verification`)
      .set(accountant)
      .send({ verified: true })
      .expect(403);
  });

  it('refuses the reveal across organizations', async () => {
    const other = await createOrganizationFixture('other');
    await request(app)
      .get(`/api/v1/tenants/${tenantId}/id-documents/${documentId}`)
      .set(authHeader(other))
      .expect(404);
  });

  it('toggles verification with tenants.write and records audits', async () => {
    const verified = await request(app)
      .post(`/api/v1/tenants/${tenantId}/id-documents/${documentId}/verification`)
      .set(authHeader(owner))
      .send({ verified: true })
      .expect(200);
    expect(verified.body.document.verifiedAt).toBeTruthy();

    const cleared = await request(app)
      .post(`/api/v1/tenants/${tenantId}/id-documents/${documentId}/verification`)
      .set(authHeader(owner))
      .send({ verified: false })
      .expect(200);
    expect(cleared.body.document.verifiedAt).toBeNull();

    const audits = await getPrisma().auditLog.findMany({
      where: { entityType: 'TenantIdDocument', entityId: documentId, action: 'verify' },
    });
    expect(audits.length).toBe(2);
  });

  it('refuses verification for tenant-role sessions', async () => {
    const tenantUser = await createOrganizationFixture('tenant', 'tenant');
    await request(app)
      .post(`/api/v1/tenants/${tenantId}/id-documents/${documentId}/verification`)
      .set(authHeader(tenantUser))
      .send({ verified: true })
      .expect(403);
  });
});
