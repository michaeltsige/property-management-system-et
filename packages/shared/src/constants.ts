/**
 * Domain constants.
 *
 * NOTE ON CONFIGURABILITY: the brief requires Ethiopian tax, legal and
 * administrative data to be *configurable data, not hardcoded logic*.
 * Everything in this file is therefore a **seed default** that the database can
 * override per organization (see `OrganizationSetting`). Code must read the
 * organisation's configuration, never these constants directly, when it makes a
 * financial decision.
 *
 * Items marked `NEEDS HUMAN VERIFICATION` are placeholders for an Ethiopian
 * accountant/lawyer; see docs/DECISIONS.md.
 */

// ---------------------------------------------------------------------------
// Roles and access
// ---------------------------------------------------------------------------

export const ROLES = ['owner_admin', 'manager', 'accountant', 'maintenance', 'tenant'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner_admin: 'Owner / Admin',
  manager: 'Property Manager',
  accountant: 'Accountant',
  maintenance: 'Maintenance',
  tenant: 'Tenant',
};

/** Organization lifecycle. */
export const ORG_STATUSES = ['active', 'suspended', 'closed'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'disabled'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// ---------------------------------------------------------------------------
// Properties, units, leases
// ---------------------------------------------------------------------------

export const PROPERTY_TYPES = [
  'residential_building',
  'apartment_block',
  'single_family',
  'commercial_building',
  'office',
  'retail_shop',
  'warehouse',
  'mixed_use',
  'land',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const UNIT_STATUSES = ['vacant', 'occupied', 'notice', 'turnover', 'unavailable'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const LEASE_STATUSES = ['draft', 'pending', 'active', 'expired', 'terminated', 'cancelled'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

/**
 * How rent is charged for a lease.
 * - `monthly`      : one charge per month of the billing calendar
 * - `quarterly`    : one charge every three months
 * - `semi_annual`  : every six months
 * - `annual`       : once per calendar year
 * - `custom`       : explicit schedule entered by the manager
 */
export const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual', 'custom'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const DEPOSIT_TYPES = ['none', 'fixed', 'months_of_rent'] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export const RENT_DUE_DAY_MAX = 30; // no month in either calendar has 31 days for rent purposes

// ---------------------------------------------------------------------------
// Money: charges, payments, ledger
// ---------------------------------------------------------------------------

export const CHARGE_TYPES = [
  'rent',
  'deposit',
  'utility_water',
  'utility_electric',
  'utility_gas',
  'service_charge',
  'parking',
  'late_fee',
  'tax',
  'adjustment',
  'other',
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const CHARGE_STATUSES = ['open', 'partial', 'paid', 'waived', 'written_off'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/**
 * Payment methods. `manual` methods are recorded by staff; the others run through
 * a payment provider adapter (see apps/api/src/payments).
 */
export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'cheque',
  'telebirr',
  'chapa',
  'cbe_birr',
  'amole',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const MANUAL_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'other'];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'reversed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Ledger entry kinds. The ledger is append-only; corrections are reversals. */
export const LEDGER_ENTRY_KINDS = [
  'charge',
  'payment',
  'waiver',
  'write_off',
  'reversal',
  'adjustment',
] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export const WORK_ORDER_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'masonry',
  'carpentry',
  'painting',
  'cleaning',
  'security',
  'generator',
  'water_pump',
  'other',
] as const;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORIES = [
  'lease_agreement',
  'id_document',
  'payment_receipt',
  'invoice',
  'inspection_report',
  'maintenance_photo',
  'utility_bill',
  'tax_document',
  'other',
] as const;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = ['in_app', 'sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TEMPLATE_KEYS = [
  'notification.rent_due_soon',
  'notification.rent_overdue',
  'notification.payment_received',
  'notification.lease_expiring',
  'notification.lease_renewed',
  'notification.work_order_created',
  'notification.work_order_completed',
  'notification.invite_user',
  'notification.password_reset',
] as const;

// ---------------------------------------------------------------------------
// Tenant identification (configurable per organization)
// ---------------------------------------------------------------------------

/** Seeded ID types; organisations may add their own in `TenantIdType`. */
export const TENANT_ID_TYPES = [
  'kebele_id',
  'national_id_fayda',
  'passport',
  'drivers_license',
  'employee_id',
  'business_license_tin',
  'refugee_id',
  'other',
] as const;
export type TenantIdType = (typeof TENANT_ID_TYPES)[number];

// ---------------------------------------------------------------------------
// Ethiopian administrative structure (seed data, overridable in the database)
// ---------------------------------------------------------------------------

/**
 * Regions and chartered cities. Ethiopia reorganised its regions in 2023
 * (Central Ethiopia, South Ethiopia, South West Ethiopia Peoples'), so these are
 * seed rows in `Region`, not an enum the code depends on.
 */
export const ETHIOPIAN_REGIONS = [
  { code: 'AA', name: 'Addis Ababa', nameAm: 'አዲስ አበባ', type: 'city_administration' },
  { code: 'DD', name: 'Dire Dawa', nameAm: 'ድሬ ዳዋ', type: 'city_administration' },
  { code: 'AF', name: 'Afar', nameAm: 'አፋር', type: 'region' },
  { code: 'AM', name: 'Amhara', nameAm: 'አማራ', type: 'region' },
  { code: 'BG', name: 'Benishangul-Gumuz', nameAm: 'በንሻንጉል ጉሙዝ', type: 'region' },
  { code: 'CE', name: 'Central Ethiopia', nameAm: 'ማዕከላዊ ኢትዮጵያ', type: 'region' },
  { code: 'GA', name: 'Gambella', nameAm: 'ጋምቤላ', type: 'region' },
  { code: 'HA', name: 'Harari', nameAm: 'ሐረሪ', type: 'region' },
  { code: 'OR', name: 'Oromia', nameAm: 'ኦሮሚያ', type: 'region' },
  { code: 'SI', name: 'Sidama', nameAm: 'ሲዳማ', type: 'region' },
  { code: 'SO', name: 'Somali', nameAm: 'ሶማሌ', type: 'region' },
  { code: 'SE', name: 'South Ethiopia', nameAm: 'ደቡብ ኢትዮጵያ', type: 'region' },
  { code: 'SW', name: 'South West Ethiopia Peoples', nameAm: 'ደቡብ ምዕራብ ኢትዮጵያ ሕዝቦች', type: 'region' },
  { code: 'TI', name: 'Tigray', nameAm: 'ትግራይ', type: 'region' },
] as const;

// ---------------------------------------------------------------------------
// Tax and legal configuration defaults
// ---------------------------------------------------------------------------

/**
 * Shape of the organisation's tax configuration. `code` matches a
 * `TaxRule` row so that a rate change is a data change with an effective date,
 * not a deployment.
 *
 * NEEDS HUMAN VERIFICATION (Ethiopian accountant / lawyer):
 *  - VAT rate and which charges are VAT-able (residential vs commercial rent);
 *  - rental-income tax treatment for individuals vs companies, and whether the
 *    landlord or the property manager files;
 *  - stamp duty on lease agreements;
 *  - late-fee caps and notice periods allowed under lease law;
 *  - withholding obligations when a tenant is a business.
 */
export const TAX_RULE_CODES = [
  'vat',
  'rental_income_tax_individual',
  'rental_income_tax_company',
  'stamp_duty',
  'withholding_rent',
] as const;
export type TaxRuleCode = (typeof TAX_RULE_CODES)[number];

export interface UnverifiedTaxDefaults {
  readonly [code: string]: {
    /** Rate as a percentage, stored with an effective date in the database. */
    readonly ratePercent: number | null;
    /** Bracket definitions, if the tax is progressive. */
    readonly brackets?: readonly { readonly upToMinor: number | null; readonly ratePercent: number }[];
    /** Populated by the accountant. `null` means "must be configured before use". */
    readonly verified: boolean;
    readonly note: string;
  };
}

export const UNVERIFIED_TAX_DEFAULTS: UnverifiedTaxDefaults = {
  vat: {
    ratePercent: 15,
    verified: false,
    note: 'NEEDS HUMAN VERIFICATION: commonly cited Ethiopian VAT rate is 15%. Confirm current rate, and whether the organisation charges VAT on commercial rent, with an accountant before enabling.',
  },
  rental_income_tax_individual: {
    ratePercent: null,
    brackets: [],
    verified: false,
    note: 'NEEDS HUMAN VERIFICATION: rental income tax for individuals is bracket-based under federal law but the current schedule must be confirmed and entered by an accountant. Do not compute this value automatically.',
  },
  rental_income_tax_company: {
    ratePercent: null,
    verified: false,
    note: 'NEEDS HUMAN VERIFICATION: corporate rental income treatment must be confirmed with an accountant.',
  },
  stamp_duty: {
    ratePercent: null,
    verified: false,
    note: 'NEEDS HUMAN VERIFICATION: stamp duty applies to lease agreements; the current rate and base must be confirmed.',
  },
  withholding_rent: {
    ratePercent: null,
    verified: false,
    note: 'NEEDS HUMAN VERIFICATION: withholding obligations when the tenant is a business entity.',
  },
};

/** Default operational settings an organization starts with (all editable). */
export const DEFAULT_ORG_SETTINGS = {
  currency: 'ETB',
  defaultCalendar: 'ethiopian' as 'ethiopian' | 'gregorian',
  defaultLanguage: 'en' as 'en' | 'am' | 'om' | 'ti',
  lateFeeEnabled: false,
  lateFeeType: 'percent' as 'percent' | 'fixed',
  lateFeePercent: 0,
  lateFeeFixedMinor: 0,
  gracePeriodDays: 0,
  rentDueDay: 5,
  remindersEnabled: true,
  reminderDaysBefore: 3,
  overdueRemindersEnabled: true,
  overdueReminderEveryDays: 7,
  idDocumentRetentionMonths: 24,
} as const;
