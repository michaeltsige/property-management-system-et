/**
 * Receipt assembly: load a succeeded payment with its allocations and produce
 * the data the PDF renderer needs. Both the staff route and the tenant portal
 * route funnel through here so a receipt is never assembled twice differently.
 */

import type { PrismaClient } from '@prisma/client';

import { notFound } from '../lib/errors.js';
import type { ReceiptLine } from '../lib/pdf.js';

export interface ReceiptDocument {
  filename: string;
  data: {
    organizationName: string;
    receiptNumber: string;
    paidAt: Date;
    currency: string;
    method: string;
    reference: string | null;
    tenantName: string;
    unitLabel: string | null;
    propertyName: string | null;
    lines: ReceiptLine[];
    totalMinor: bigint;
    allocatedMinor: bigint;
    unallocatedMinor: bigint;
  };
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  telebirr: 'Telebirr',
  chapa: 'Chapa',
  cbe_birr: 'CBE Birr',
  amole: 'Amole',
  mock: 'Mock (demo)',
  other: 'Other',
};

export async function buildPaymentReceipt(
  prisma: PrismaClient,
  params: { organizationId: string; paymentId: string; tenantId?: string },
): Promise<ReceiptDocument> {
  const payment = await prisma.payment.findFirst({
    where: {
      id: params.paymentId,
      organizationId: params.organizationId,
      // When a portal session asks, the payment must be their own — a receipt
      // for someone else's rent is a 404, exactly like the record itself.
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    },
    include: {
      allocations: { include: { charge: true } },
      tenant: { select: { fullName: true } },
      lease: {
        include: {
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
      organization: { select: { name: true } },
    },
  });
  if (!payment) throw notFound('Payment not found in this organization');
  if (payment.status !== 'succeeded') {
    throw notFound('Only a completed payment has a receipt');
  }
  if (!payment.receiptNumber) throw notFound('This payment has no receipt number yet');

  const lines: ReceiptLine[] = payment.allocations.map((allocation) => {
    const charge = allocation.charge;
    const period = charge.periodKey ? ` · period ${charge.periodKey}` : '';
    const label = charge.description
      ? `${charge.description}${period ? ` (${charge.periodKey ?? ''})` : ''}`
      : `${charge.type}${period}`;
    const display = label.charAt(0).toUpperCase() + label.slice(1);
    return { label: display, amountMinor: allocation.amountMinor };
  });

  const allocatedMinor = payment.allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  const unallocatedMinor = payment.amountMinor - allocatedMinor;

  return {
    filename: `${payment.receiptNumber}.pdf`,
    data: {
      organizationName: payment.organization.name,
      receiptNumber: payment.receiptNumber,
      paidAt: payment.paidAt,
      currency: payment.currency,
      method: METHOD_LABELS[payment.method] ?? payment.method,
      reference: payment.reference,
      tenantName: payment.tenant?.fullName ?? '—',
      unitLabel: payment.lease?.unit.label ?? null,
      propertyName: payment.lease?.unit.property.name ?? null,
      lines,
      totalMinor: payment.amountMinor,
      allocatedMinor,
      unallocatedMinor,
    },
  };
}
