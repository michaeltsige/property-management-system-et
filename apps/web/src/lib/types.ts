/**
 * Wire types for the API responses the web app consumes.
 *
 * These mirror `apps/api` exactly. Money fields are always `*Minor: string`
 * because the server serialises `BigInt` minor units as decimal strings; parse
 * them with `parseMoneyString` from `@pms/shared` before doing arithmetic.
 */

import type { CalendarKind } from '@pms/calendar';

export interface EthiopianAddress {
  regionCode: string | null;
  cityOrZone: string | null;
  subCity: string | null;
  woreda: string | null;
  kebele: string | null;
  houseNumber: string | null;
  landmark: string | null;
}

export interface Owner {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  managementFeeBps: number | null;
}
export interface Building {
  id: string;
  propertyId: string;
  name: string;
}

export interface Property {
  ownerId: string;
  owner?: { id: string; name: string };
  buildings?: Building[];
  id: string;
  name: string;
  code: string | null;
  type: string;
  status: string;
  regionCode: string | null;
  cityOrZone: string | null;
  subCity: string | null;
  woreda: string | null;
  kebele: string | null;
  houseNumber: string | null;
  landmark: string | null;
  notes: string | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  createdAt: string;
}

export interface Unit {
  buildingId?: string | null;
  building?: Building | null;
  id: string;
  propertyId: string;
  label: string;
  typeLabel?: string | null;
  floor: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  marketRentMinor: string | null;
  currency: string;
  status: string;
  property?: { id: string; name: string };
}

export interface Tenant {
  id: string;
  fullName: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  nationality: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  employer: string | null;
  language: string;
  notes: string | null;
  createdAt: string;
  /** Present when staff enabled the OTP portal for this tenant. */
  portalEnabledAt: string | null;
}

export interface LeaseSummary {
  id: string;
  status: string;
  billingCalendar: CalendarKind;
  billingFrequency: string;
  startDate: string;
  endDate: string | null;
  rentAmountMinor: string;
  currency: string;
  dueDayOfMonth: number;
  balanceMinor: string;
  unit: { id: string; label: string; property: { id: string; name: string } };
  tenant: { id: string; fullName: string; phone: string | null };
}

export interface LeaseDetail extends Omit<LeaseSummary, 'balanceMinor'> {
  depositAmountMinor: string | null;
  depositType: string;
  gracePeriodDays: number;
  lateFeePercent: number | null;
  escalationPercent: number | null;
  escalationEveryMonths: number | null;
  coTenants?: { tenant: { id: string; fullName: string } }[];
  charges?: Charge[];
}

export interface Charge {
  id: string;
  leaseId: string | null;
  tenantId: string | null;
  unitId: string | null;
  type: string;
  description: string;
  periodKey: string;
  periodCalendar: CalendarKind;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: string;
  paidMinor: string;
  currency: string;
  status: 'open' | 'partial' | 'paid' | 'waived' | 'written_off';
  waiverReason?: string | null;
}

export interface Payment {
  id: string;
  leaseId: string | null;
  tenantId: string | null;
  receiptNumber: string | null;
  amountMinor: string;
  currency: string;
  method: string;
  status: string;
  paidAt: string;
  reference: string | null;
  provider: string | null;
  allocations?: { chargeId: string; amountMinor: string }[];
}

export interface StatementLine {
  id: string;
  kind: 'charge' | 'payment' | 'waiver' | 'write_off' | 'adjustment' | 'reversal';
  occurredAt: string;
  amountMinor: string;
  currency: string;
  memo: string | null;
  runningBalanceMinor: string;
}

export interface WorkOrderNote {
  id: string;
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  ticketNumber: string | null;
  title: string;
  description: string | null;
  category: string | null;
  priority: string;
  status: string;
  reportedAt: string;
  scheduledFor: string | null;
  completedAt: string | null;
  estimatedCostMinor: string | null;
  actualCostMinor: string | null;
  currency: string;
  property?: { id: string; name: string };
  unit?: { id: string; label: string } | null;
  vendor?: { id: string; name: string } | null;
  tenant?: { id: string; fullName: string; phone?: string | null } | null;
  notes?: WorkOrderNote[];
}

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  tinNumber: string | null;
  isActive: boolean;
}

export interface Document {
  id: string;
  category: string;
  title: string | null;
  mimeType: string;
  sizeBytes: number;
  propertyId: string | null;
  leaseId: string | null;
  tenantId: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  templateKey: string;
  channel: string;
  recipientPhone: string | null;
  recipientEmail: string | null;
  language: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface Summary {
  organization: { currency: string; calendar: CalendarKind; language: string };
  portfolio: {
    properties: number;
    units: number;
    occupiedUnits: number;
    vacantUnits: number;
    occupancyRate: number;
    tenants: number;
    activeLeases: number;
    openWorkOrders: number;
  };
  period: { key: string; calendar: CalendarKind; from: string; to: string };
  money: {
    currency: string;
    expectedMinor: string;
    collectedMinor: string;
    collectionRate: number | null;
    arrearsMinor: string;
    chargesRaised: number;
    paymentsRecorded: number;
  };
}

export interface RentRollRow {
  leaseId: string;
  property: { id: string; name: string; regionCode: string | null };
  unit: { id: string; label: string };
  tenant: { id: string; fullName: string; phone: string | null };
  billingCalendar: CalendarKind;
  rentAmountMinor: string;
  currency: string;
  dueDayOfMonth: number;
  period: { key: string; calendar: CalendarKind };
  periodDueMinor: string;
  periodPaidMinor: string;
  outstandingMinor: string;
  creditMinor: string;
  periodCharged: boolean;
}

export interface RentRoll {
  period: {
    key: string;
    calendar: CalendarKind;
    from: { year: number; month: number; day: number };
    to: { year: number; month: number; day: number };
  };
  currency: string;
  rows: RentRollRow[];
  totals: { dueMinor: string; paidMinor: string; outstandingMinor: string; leaseCount: number };
}

export interface ArrearsRow {
  tenant: { id: string; fullName: string; phone: string | null } | null;
  unit: { id: string; label: string } | null;
  property: { id: string; name: string } | null;
  leaseId: string;
  buckets: Record<string, string>;
  totalMinor: string;
  oldestDueDate: string | null;
}

export interface Arrears {
  asOf: string;
  currency: string;
  buckets: { key: string; label: string; totalMinor: string }[];
  rows: ArrearsRow[];
  totalMinor: string;
}

export interface OccupancyRow {
  propertyId: string;
  name: string;
  regionCode: string | null;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRate: number;
  byStatus: Record<string, number>;
}

export interface CollectionRow {
  periodKey: string;
  year: number;
  month: number;
  from: { year: number; month: number; day: number };
  to: { year: number; month: number; day: number };
  totalMinor: string;
  paymentCount: number;
  byMethod: Record<string, string>;
}

/** A membership row, as `GET /api/v1/organizations/members` returns it. */
export interface Member {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TenantIdType {
  id: string;
  code: string;
  label: string;
  organizationId: string | null;
  isActive: boolean;
}

export interface TranslationRow {
  key: string;
  english: string;
  current: string;
  language: string;
  status: 'machine_draft' | 'unreviewed' | 'reviewed' | 'missing';
  source: string;
  overridden: boolean;
}

/** What a signed-in tenant sees on their portal page. */
export interface PortalMe {
  tenant: {
    id: string;
    fullName: string;
    phone: string | null;
    language: string;
  };
  leases: {
    id: string;
    status: string;
    unit: string;
    property: string;
    rentAmountMinor: string;
    currency: string;
    startDate: string;
  }[];
  /** Sum of pending + overdue charges, minor units as a decimal string. */
  dueMinor: string;
}

/** A portal payment attempt: pending until the provider confirms it. */
export interface PortalPaymentIntent {
  paymentId: string;
  provider: string;
  providerRef: string;
  redirectUrl?: string;
  amountMinor: string;
  currency: string;
  status: string;
}

export interface PortalCompletedPayment {
  paymentId: string;
  receiptNumber: string;
  amountMinor: string;
  currency: string;
  allocatedMinor: string;
  unallocatedMinor: string;
  allocations: { chargeId: string; amountMinor: string }[];
  status: string;
}

/** A tenant-submitted proof of payment awaiting staff review. */
export interface PaymentProof {
  id: string;
  organizationId: string;
  tenantId: string;
  leaseId: string | null;
  documentId: string;
  amountMinor: string;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  paymentId: string | null;
  createdAt: string;
  tenant?: { id: string; fullName: string; phone: string | null };
  document?: { id: string; filename: string; mimeType: string; sizeBytes: number };
}
