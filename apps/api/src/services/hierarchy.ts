import type { Prisma } from '@prisma/client';
import { businessRule, notFound } from '../lib/errors.js';

export async function resolveOwner(tx: Prisma.TransactionClient, organizationId: string, ownerId?: string) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (ownerId) {
    const owner = await tx.owner.findFirst({ where: { id: ownerId, organizationId } });
    if (!owner) throw notFound('Owner not found in this organization');
    if (org.portfolioMode === 'self_owned' && owner.defaultKey !== 'self') {
      throw businessRule('Self-owned portfolios use the default landlord');
    }
    return owner.id;
  }
  if (org.portfolioMode === 'managed') throw businessRule('Choose an owner for this property');
  const owner = await tx.owner.upsert({
    where: { organizationId_defaultKey: { organizationId, defaultKey: 'self' } },
    create: { organizationId, defaultKey: 'self', name: org.name },
    update: {},
  });
  return owner.id;
}

export async function checkBuilding(
  tx: Prisma.TransactionClient,
  organizationId: string,
  propertyId: string,
  buildingId?: string | null,
) {
  if (!buildingId) return;
  const building = await tx.building.findFirst({ where: { id: buildingId, organizationId, propertyId } });
  if (!building) throw notFound('Building not found in this property');
}
