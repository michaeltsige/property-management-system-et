/**
 * Test fixtures.
 *
 * Everything created here is synthetic. Helpers build an organization with an
 * owner, and portfolio objects, so tests can focus on the behaviour under test
 * rather than on setup boilerplate.
 */

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { civilToUtcDate, type CalendarKind } from '@pms/calendar';

import { hashPassword } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import { issueTokens } from '../services/auth.service.js';
import { generateCharges } from '../services/charges.js';

export const TEST_PASSWORD = 'TestPass123';

export interface Fixture {
  organizationId: string;
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function createOrganizationFixture(
  label = 'org',
  role: 'owner_admin' | 'manager' | 'accountant' | 'maintenance' | 'tenant' = 'owner_admin',
): Promise<Fixture> {
  const prisma = getPrisma();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}`, currency: 'ETB', calendar: 'ethiopian' },
  });

  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@test.local`, fullName: `${label} owner`, passwordHash },
  });

  await prisma.membership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role,
      status: 'active',
      acceptedAt: new Date(),
    },
  });

  const tokens = await issueTokens(user.id, organization.id, role, user.email, false);

  return {
    organizationId: organization.id,
    userId: user.id,
    email: user.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

export function authHeader(fixture: Pick<Fixture, 'accessToken'>): Record<string, string> {
  return { Authorization: `Bearer ${fixture.accessToken}` };
}

export interface PortfolioFixture {
  propertyId: string;
  unitId: string;
  tenantId: string;
  leaseId: string;
}

/** A property + unit + tenant + active lease, created directly (fast, precise dates). */
export async function createPortfolio(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    billingCalendar?: CalendarKind;
    rentAmountMinor?: number;
    dueDayOfMonth?: number;
    billingFrequency?: string;
    startDate: Date;
    endDate?: Date | null;
    tenantPhone?: string;
  },
): Promise<PortfolioFixture> {
  const property = await prisma.property.create({
    data: {
      organizationId: params.organizationId,
      name: `Property ${randomUUID().slice(0, 6)}`,
      type: 'apartment_block',
    },
  });
  const unit = await prisma.unit.create({
    data: { organizationId: params.organizationId, propertyId: property.id, label: 'A1', status: 'occupied' },
  });
  const tenant = await prisma.tenant.create({
    data: {
      organizationId: params.organizationId,
      fullName: 'Test Tenant',
      phone: params.tenantPhone ?? '+251911000123',
      language: 'am',
    },
  });
  const lease = await prisma.lease.create({
    data: {
      organizationId: params.organizationId,
      unitId: unit.id,
      tenantId: tenant.id,
      billingCalendar: params.billingCalendar ?? 'ethiopian',
      billingFrequency: params.billingFrequency ?? 'monthly',
      status: 'active',
      startDate: params.startDate,
      endDate: params.endDate ?? null,
      rentAmountMinor: BigInt(params.rentAmountMinor ?? 1_500_000),
      currency: 'ETB',
      dueDayOfMonth: params.dueDayOfMonth ?? 5,
    },
  });

  return { propertyId: property.id, unitId: unit.id, tenantId: tenant.id, leaseId: lease.id };
}

export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function civilDateToUtc(civil: {
  year: number;
  month: number;
  day: number;
  calendar: CalendarKind;
}): Date {
  return civilToUtcDate(civil);
}

export { generateCharges };
