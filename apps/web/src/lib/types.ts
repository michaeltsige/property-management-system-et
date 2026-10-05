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

export interface Property {
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
  id: string;
  propertyId: string;
  label: string;
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

export interface Member {
  id: string;
  role: string;
  status: string;
  user: { id: string; email: string; fullName: string; language: string };
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
