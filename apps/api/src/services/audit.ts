/**
 * Audit trail.
 *
 * Every create/update/delete of a financial or lease record writes an AuditLog row
 * **inside the same transaction** as the change, so a committed change always has
 * a matching audit entry. Snapshots are redacted before storage.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import type { AuditSnapshot } from '@pms/shared';

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface AuditEvent {
  organizationId?: string | null;
  actorUserId?: string | null;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'login'
    | 'logout'
    | 'export'
    | 'reversal'
    | 'generate'
    | 'verify'
    | 'read_id';
  entityType: string;
  entityId?: string | null;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Fields that must never be written to the audit log. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'numberEncrypted',
  'providerPayload',
]);

export function redactSnapshot(snapshot: AuditSnapshot): AuditSnapshot {
  if (!snapshot) return null;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (REDACTED_FIELDS.has(key)) {
      output[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      output[key] = redactSnapshot(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function recordAudit(tx: PrismaLike, event: AuditEvent): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: event.organizationId ?? null,
      actorUserId: event.actorUserId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      before: (redactSnapshot(event.before ?? null) ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (redactSnapshot(event.after ?? null) ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
    },
  });
}
