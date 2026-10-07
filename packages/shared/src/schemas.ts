/**
 * Zod schemas — the single source of truth for input validation.
 *
 * The API validates every request body/query with these; the web app reuses the
 * same schemas for form validation, so the two can never disagree about what is
 * acceptable. Types are inferred from the schemas (`z.infer`) rather than written
 * twice.
 */

import { z } from 'zod';
import { CALENDAR_KINDS, isValidCivilDate, type CalendarKind } from '@pms/calendar';

import {
  BILLING_FREQUENCIES,
  CHARGE_TYPES,
  DEPOSIT_TYPES,
  DOCUMENT_CATEGORIES,
  LEASE_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TEMPLATE_KEYS,
  PAYMENT_METHODS,
  PROPERTY_TYPES,
  RENT_DUE_DAY_MAX,
  ROLES,
  TAX_RULE_CODES,
  UNIT_STATUSES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
} from './constants.js';
import { CURRENCIES } from './money.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid('Must be a UUID');
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO 8601 date (YYYY-MM-DD)');

export const calendarKindSchema = z.enum(CALENDAR_KINDS as unknown as [CalendarKind, ...CalendarKind[]]);
export const languageSchema = z.enum(['en', 'am', 'om', 'ti']);

/**
 * A civil (date-only) value in a chosen calendar. Validated through
 * `@pms/calendar` so that, for example, `13-30` (Pagume with 30 days) or
 * `2024-02-30` are rejected at the edge.
 */
export const civilDateSchema = z
  .object({
    year: z.number().int().min(1).max(9999),
    month: z.number().int().min(1).max(13),
    day: z.number().int().min(1).max(30),
    calendar: calendarKindSchema,
  })
  .refine((value) => isValidCivilDate(value), {
    message: 'Not a real date in the given calendar (check month length, Pagume and leap years)',
  });

export type CivilDateInput = z.infer<typeof civilDateSchema>;

/** Money as integer minor units + ISO-4217 code. Floats are rejected outright. */
export const moneySchema = z.object({
  amountMinor: z
    .number()
    .int('Money must be an integer number of minor units (santim), never a float')
    .safe('Amount exceeds the safe integer range'),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase())
    .refine((code) => code in CURRENCIES, { message: 'Unsupported currency' }),
});

export const phoneEtSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^(?:\+251|251|0)?[79]\d{8}$/.test(value), {
    message: 'Expected an Ethiopian mobile number, e.g. +251911234567, 0911234567',
  })
  .transform((value) => {
    const national = value.replace(/^(?:\+251|251|0)/, '');
    return `+251${national}`;
  });

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single dashes');

/**
 * Translation keys are stable identifiers, never English sentences:
 * `lease.status.active`. Lower-case, dot-separated, snake_case segments.
 */
export const translationKeySchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/, {
    message: 'Expected a dotted translation key such as lease.status.active',
  });

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Include at least one letter and one number',
  });

// ---------------------------------------------------------------------------
// Query helpers (list endpoints)
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().min(1).max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

// ---------------------------------------------------------------------------
// Ethiopian addresses
// ---------------------------------------------------------------------------

/**
 * Addresses in Ethiopia are frequently informal, so a structured administrative
 * hierarchy is stored *alongside* a free-text landmark description, and only a
 * couple of fields are mandatory.
 */
export const addressSchema = z.object({
  regionCode: z.string().max(10).optional(),
  region: z.string().trim().max(120).optional(),
  cityOrZone: z.string().trim().max(120).optional(),
  subCity: z.string().trim().max(120).optional(),
  woreda: z.string().trim().max(120).optional(),
  kebele: z.string().trim().max(120).optional(),
  houseNumber: z.string().trim().max(60).optional(),
  street: z.string().trim().max(160).optional(),
  /** e.g. "behind Edna Mall, blue gate next to the mosque" */
  landmark: z.string().trim().max(400).optional(),
  postalCode: z.string().trim().max(20).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export type AddressInput = z.infer<typeof addressSchema>;

// ---------------------------------------------------------------------------
// Auth & organization
// ---------------------------------------------------------------------------

export const portfolioModeSchema = z.enum(['self_owned', 'managed']);

export const signupBillingSchema = z
  .object({
    billingCalendar: calendarKindSchema.default('ethiopian'),
    dueDay: z.number().int().min(1).max(28).default(5),
    graceDays: z.number().int().min(0).max(60).default(0),
    lateFeeRule: z.enum(['none', 'percent', 'fixed']).default('none'),
    lateFeeBps: z.number().int().min(0).max(10000).default(0),
    lateFeeMinor: z.number().int().nonnegative().safe().default(0),
    acceptedPaymentMethods: z
      .array(z.enum(['cash', 'bank_transfer', 'telebirr', 'chapa']))
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length, 'Duplicate payment methods')
      .default(['cash', 'bank_transfer']),
  })
  .strict();

export const registerSchema = z.object({
  accountType: z.enum(['individual_landlord', 'management_company']).default('individual_landlord'),
  currency: z.literal('ETB').default('ETB'),
  billing: signupBillingSchema.optional(),
  portfolioMode: portfolioModeSchema.default('self_owned'),
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: slugSchema.optional(),
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneEtSchema.optional(),
  password: passwordSchema,
  /** UI language preference; the organization default is chosen separately. */
  language: languageSchema.default('en'),
  calendar: calendarKindSchema.default('ethiopian'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
  organizationSlug: slugSchema.optional(),
});

export const portalRequestSchema = z.object({ phone: phoneEtSchema }).strict();
export const portalVerifySchema = z
  .object({ phone: phoneEtSchema, code: z.string().regex(/^\d{6}$/) })
  .strict();

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(20) });

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES as unknown as [string, ...string[]]),
  fullName: z.string().trim().min(2).max(120).optional(),
});

export const updateMembershipSchema = z.object({
  role: z.enum(ROLES as unknown as [string, ...string[]]).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const organizationSettingsSchema = z.object({
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase())
    .refine((code) => code in CURRENCIES, { message: 'Unsupported currency' })
    .optional(),
  defaultCalendar: calendarKindSchema.optional(),
  defaultLanguage: languageSchema.optional(),
  rentDueDay: z.number().int().min(1).max(RENT_DUE_DAY_MAX).optional(),
  gracePeriodDays: z.number().int().min(0).max(60).optional(),
  lateFeeEnabled: z.boolean().optional(),
  lateFeeType: z.enum(['percent', 'fixed']).optional(),
  lateFeePercent: z.number().min(0).max(100).optional(),
  lateFeeFixedMinor: z.number().int().min(0).optional(),
  remindersEnabled: z.boolean().optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).optional(),
  overdueRemindersEnabled: z.boolean().optional(),
  overdueReminderEveryDays: z.number().int().min(1).max(90).optional(),
  idDocumentRetentionMonths: z.number().int().min(0).max(600).optional(),
});

export type UpdateOrganizationSettings = z.infer<typeof organizationSettingsSchema>;

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export const createOwnerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: phoneEtSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    managementFeeBps: z.number().int().min(0).max(10000).nullable().optional(),
  })
  .strict();
export const updateOwnerSchema = createOwnerSchema.partial();
export const createBuildingSchema = z
  .object({
    propertyId: uuidSchema,
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const updateBuildingSchema = createBuildingSchema.pick({ name: true });

export const createPropertySchema = z.object({
  ownerId: uuidSchema.optional(),
  name: z.string().trim().min(2).max(160),
  type: z.enum(PROPERTY_TYPES),
  code: z.string().trim().max(40).optional(),
  address: addressSchema.optional(),
  notes: z.string().max(2000).optional(),
  yearBuilt: z.number().int().min(1800).max(2100).optional(),
  totalFloors: z.number().int().min(0).max(200).optional(),
});

export const updatePropertySchema = createPropertySchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
});

export const createUnitSchema = z.object({
  buildingId: uuidSchema.nullable().optional(),
  propertyId: uuidSchema,
  label: z.string().trim().min(1).max(60),
  floor: z.number().int().min(-5).max(200).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  areaSqm: z.number().min(0).max(100000).optional(),
  marketRent: moneySchema.optional(),
  status: z.enum(UNIT_STATUSES).default('vacant'),
  notes: z.string().max(2000).optional(),
});

export const updateUnitSchema = createUnitSchema.partial().omit({ propertyId: true });

export const tenantIdDocumentSchema = z.object({
  type: z.string().trim().min(2).max(60),
  /** Stored encrypted at rest; only the last 4 digits are ever returned to clients. */
  number: z.string().trim().min(3).max(60),
  issuedBy: z.string().trim().max(120).optional(),
  issuedAt: isoDateSchema.optional(),
  expiresAt: isoDateSchema.optional(),
});

export const createTenantSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: phoneEtSchema.optional(),
  email: emailSchema.optional(),
  altPhone: phoneEtSchema.optional(),
  nationality: z.string().trim().max(60).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: phoneEtSchema.optional(),
  employer: z.string().trim().max(160).optional(),
  notes: z.string().max(2000).optional(),
  idDocuments: z.array(tenantIdDocumentSchema).max(5).optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

export const createLeaseSchema = z.object({
  unitId: uuidSchema,
  /** Tenant of record; additional occupants/co-tenants go in `coTenantIds`. */
  tenantId: uuidSchema,
  coTenantIds: z.array(uuidSchema).max(10).default([]),
  /** The calendar this lease is billed in — drives periods and due dates. */
  billingCalendar: calendarKindSchema,
  startDate: civilDateSchema,
  /** `null` = open-ended. */
  endDate: civilDateSchema.nullish(),
  rentAmount: moneySchema,
  billingFrequency: z.enum(BILLING_FREQUENCIES).default('monthly'),
  depositType: z.enum(DEPOSIT_TYPES).default('months_of_rent'),
  depositMonths: z.number().min(0).max(24).optional(),
  depositAmount: moneySchema.optional(),
  /** Day within the billing month on which rent is due (clamped to real month length). */
  dueDayOfMonth: z.number().int().min(1).max(RENT_DUE_DAY_MAX),
  gracePeriodDays: z.number().int().min(0).max(90).optional(),
  lateFeePercent: z.number().min(0).max(100).optional(),
  /** Rent escalation, e.g. 10% every 12 months. */
  escalationPercent: z.number().min(0).max(100).optional(),
  escalationEveryMonths: z.number().int().min(1).max(120).optional(),
  status: z.enum(LEASE_STATUSES).default('draft'),
  signedAt: isoDateSchema.optional(),
  notes: z.string().max(4000).optional(),
});

export const updateLeaseSchema = createLeaseSchema.partial().omit({ unitId: true, tenantId: true });

export const terminateLeaseSchema = z.object({
  terminatedOn: civilDateSchema,
  reason: z.string().trim().max(500).optional(),
  /** Whether the deposit was refunded in full; partial amounts are recorded as ledger entries. */
  depositRefundedAmount: moneySchema.optional(),
});

export const generateChargesSchema = z.object({
  /** Periods to generate, in the lease's own billing calendar, e.g. ["2026-09"]. */
  periodKeys: z
    .array(z.string().regex(/^\d{4}-\d{2}$/))
    .min(1)
    .max(24),
  /** Generate for specific leases only (default: all active leases in the organization). */
  leaseIds: z.array(uuidSchema).max(500).optional(),
  /** Skip leases whose start date is after the period ends. Defaults to true. */
  skipNotYetStarted: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Payments & ledger
// ---------------------------------------------------------------------------

export const recordManualPaymentSchema = z.object({
  tenantId: uuidSchema.optional(),
  leaseId: uuidSchema.optional(),
  amount: moneySchema,
  method: z.enum(PAYMENT_METHODS as unknown as [string, ...string[]]),
  paidAt: z.string().datetime({ offset: true }),
  /** Bank slip / cheque number / receipt reference. */
  reference: z.string().trim().max(80).optional(),
  notes: z.string().max(2000).optional(),
  /** Explicit allocation to charges; omitted means "oldest open charge first". */
  allocations: z
    .array(z.object({ chargeId: uuidSchema, amount: moneySchema }))
    .max(100)
    .optional(),
});

export const reverseLedgerEntrySchema = z.object({
  entryId: uuidSchema,
  reason: z.string().trim().min(3).max(500),
});

export const initiateOnlinePaymentSchema = z.object({
  chargeId: uuidSchema,
  amount: moneySchema,
  provider: z.enum(['mock', 'telebirr', 'chapa']),
  returnUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export const createWorkOrderSchema = z.object({
  propertyId: uuidSchema,
  unitId: uuidSchema.optional(),
  reportedByTenantId: uuidSchema.optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(60).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).default('normal'),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  vendorId: uuidSchema.optional(),
  estimatedCost: moneySchema.optional(),
});

// ---------------------------------------------------------------------------
// Documents, translations, tax configuration
// ---------------------------------------------------------------------------

export const documentUploadMetaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  propertyId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
  leaseId: uuidSchema.optional(),
  chargeId: uuidSchema.optional(),
  title: z.string().trim().max(160).optional(),
  notes: z.string().max(1000).optional(),
});

export const translationOverrideSchema = z.object({
  key: translationKeySchema,
  language: languageSchema,
  text: z.string().min(1).max(4000),
  /** Organization scope; omit for a platform-wide override (platform admins only). */
  organizationId: uuidSchema.optional(),
  status: z.enum(['machine_draft', 'unreviewed', 'reviewed']).default('unreviewed'),
});

export const taxRuleSchema = z.object({
  code: z.enum(TAX_RULE_CODES),
  name: z.string().trim().min(2).max(120),
  ratePercent: z.number().min(0).max(100).nullable(),
  /** Progressive brackets, when applicable. `upToMinor: null` = no upper bound. */
  brackets: z
    .array(z.object({ upToMinor: z.number().int().nullable(), ratePercent: z.number().min(0).max(100) }))
    .max(20)
    .default([]),
  appliesToChargeTypes: z.array(z.enum(CHARGE_TYPES)).default([]),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullish(),
  /** Rates start unverified; a human must confirm them against the law. */
  verified: z.boolean().default(false),
  verifiedBy: z.string().trim().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Operations (vendors, work-order updates, notifications, reports)
// ---------------------------------------------------------------------------

export const createVendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().max(60).optional(),
  phone: phoneEtSchema.optional(),
  email: emailSchema.optional(),
  /** Ethiopian Taxpayer Identification Number, when the vendor is a business. */
  tinNumber: z
    .string()
    .trim()
    .regex(/^\d{9,10}$/, 'A TIN is 9 or 10 digits')
    .optional(),
  notes: z.string().max(2000).optional(),
});

export const updateVendorSchema = createVendorSchema.partial().extend({ isActive: z.boolean().optional() });

export const updateWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(60).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  vendorId: uuidSchema.nullish(),
  scheduledFor: z.string().datetime({ offset: true }).nullish(),
  completedAt: z.string().datetime({ offset: true }).nullish(),
  actualCost: moneySchema.nullish(),
  resolutionNotes: z.string().max(2000).optional(),
});

/** A note on a work order. `internal` notes are staff-only. */
export const workOrderNoteSchema = z.object({
  body: z.string().trim().min(3).max(2000),
  internal: z.boolean().optional(),
});

/** A tenant-submitted maintenance request via the portal. */
export const portalMaintenanceRequestSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().max(4000).optional(),
});

/**
 * Upload body.
 *
 * The API is JSON-only (no multipart), so a file arrives base64-encoded together
 * with its metadata. The size limit is enforced on the decoded bytes by the
 * storage layer, not by trusting `sizeBytes` from the client.
 */
export const documentUploadSchema = documentUploadMetaSchema.extend({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  dataBase64: z.string().min(1).max(20_000_000),
});

export const documentListQuerySchema = paginationSchema.partial().extend({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  propertyId: uuidSchema.optional(),
  leaseId: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
  workOrderId: uuidSchema.optional(),
});

export const sendNotificationSchema = z.object({
  templateKey: z.enum(NOTIFICATION_TEMPLATE_KEYS as unknown as [string, ...string[]]),
  channel: z.enum(NOTIFICATION_CHANNELS).default('sms'),
  /** Either an explicit recipient or a tenant/lease to resolve one from. */
  tenantId: uuidSchema.optional(),
  leaseId: uuidSchema.optional(),
  recipientPhone: z.string().trim().max(30).optional(),
  recipientEmail: emailSchema.optional(),
  /** ICU arguments for the template, e.g. `{ amount: "Br 1,500.00" }`. */
  values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export const reportQuerySchema = z.object({
  /** Period to report on, in the organization's default calendar. */
  periodKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  calendar: calendarKindSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  propertyId: uuidSchema.optional(),
});
