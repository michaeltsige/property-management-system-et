import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';

const app = createApp();

/**
 * Upload-authorization regression suite (owner review item 9).
 *
 * The tenant role used to hold staff read permissions (`documents.read`,
 * `leases.read`, …) whose endpoints are scoped to the organization only, so an
 * enrolled tenant could list and download every other tenant's files. The role
 * is now portal-only; these tests pin that boundary end to end.
 */

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Enrolls a portal account for the fixture's tenant and returns a tenant bearer header. */
async function tenantBearer(fixture: Awaited<ReturnType<typeof setup>>, phone = '0911234567') {
  await request(app).post(`/api/v1/tenants/${fixture.tenantId}/portal`).set(fixture.h).expect(201);
  await request(app).post('/api/v1/portal/request-code').send({ phone }).expect(200);
  const notification = await getPrisma().notification.findFirstOrThrow({
    where: {
      recipientUserId: (await getPrisma().tenant.findUniqueOrThrow({ where: { id: fixture.tenantId } }))
        .userId ?? '',
    },
    orderBy: { createdAt: 'desc' },
  });
  const code = (notification.payload as { code: string }).code;
  const verified = await request(app).post('/api/v1/portal/verify').send({ phone, code }).expect(200);
  return { Authorization: `Bearer ${verified.body.tokens.accessToken}` };
}

async function setup() {
  const f = await createOrganizationFixture();
  const tenant = await request(app)
    .post('/api/v1/tenants')
    .set(authHeader(f))
    .send({ fullName: 'Scoped Tenant', phone: '0911234567' })
    .expect(201);
  return { ...f, h: authHeader(f), tenantId: tenant.body.tenant.id as string };
}

async function uploadDocument(headers: Record<string, string>, tenantId: string, title: string) {
  const upload = await request(app)
    .post('/api/v1/documents')
    .set(headers)
    .send({
      category: 'id_document',
      title,
      filename: 'id.png',
      mimeType: 'image/png',
      dataBase64: TINY_PNG_BASE64,
      tenantId,
    })
    .expect(201);
  return upload.body.document.id as string;
}

describe('tenant role is portal-only (upload authorization audit)', () => {
  it('rejects tenant sessions on every org-wide staff list', async () => {
    const f = await setup();
    const bearer = await tenantBearer(f);

    // These endpoints read the whole organization on purpose: they are staff
    // surfaces. A tenant session must never list org-wide documents, leases,
    // charges, payments or settings.
    for (const path of [
      '/api/v1/documents',
      '/api/v1/leases',
      '/api/v1/charges',
      '/api/v1/payments',
      '/api/v1/organizations/settings',
    ]) {
      const response = await request(app).get(path).set(bearer);
      expect(response.status, path).toBe(403);
    }
  });

  it('still serves every portal surface a tenant legitimately uses', async () => {
    const f = await setup();
    const bearer = await tenantBearer(f);
    await request(app).get('/api/v1/portal/me').set(bearer).expect(200);
    await request(app).get('/api/v1/portal/documents').set(bearer).expect(200);
    await request(app).get('/api/v1/portal/notices').set(bearer).expect(200);
    await request(app).get('/api/v1/portal/maintenance-requests').set(bearer).expect(200);
  });

  it('scopes portal documents to the requesting tenant: list and download', async () => {
    const f = await setup();

    // A second tenant in the SAME organization, with their own ID scan.
    const other = await request(app)
      .post('/api/v1/tenants')
      .set(f.h)
      .send({ fullName: 'Other Tenant', phone: '0912223344' })
      .expect(201);
    const otherTenantId = other.body.tenant.id as string;
    const otherDocId = await uploadDocument(f.h, otherTenantId, 'Other tenant ID');

    const mineDocId = await uploadDocument(f.h, f.tenantId, 'My ID');

    const bearer = await tenantBearer(f);
    const list = await request(app).get('/api/v1/portal/documents').set(bearer).expect(200);
    const listedIds = (list.body.items as { id: string }[]).map((item) => item.id);
    expect(listedIds).toContain(mineDocId);
    expect(listedIds).not.toContain(otherDocId);

    await request(app).get(`/api/v1/portal/documents/${mineDocId}/download`).set(bearer).expect(200);
    // Someone else's document is not "not found" for the object — it is not
    // found for this tenant, which is the same 404 the isolation tests use.
    await request(app).get(`/api/v1/portal/documents/${otherDocId}/download`).set(bearer).expect(404);
  });
});
