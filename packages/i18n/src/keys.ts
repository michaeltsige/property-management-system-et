/**
 * The canonical translation key registry.
 *
 * Rules (from the brief):
 * - Keys are stable identifiers, never English sentences: `lease.status.active`.
 * - English is the source of truth: a key exists only if it is in `en`.
 * - Lookup order at runtime is **organization override -> shipped locale file ->
 *   English fallback**.
 *
 * The catalogs are typed against this union, so forgetting a key is a TypeScript
 * error as well as a test failure (`check-catalogs.test.ts`).
 */

export const EN_CATALOG = {
  // CSV UI; non-English text is an unreviewed machine draft.
  'csv.title': 'Import CSV',
  'csv.hint':
    'UTF-8, up to 200 rows / 256 KiB. All rows import together or none. Tenant IDs/images are not accepted. Row numbers count records, including the header.',
  'csv.template': 'Download template',
  'csv.file': 'CSV file',
  'csv.text': 'CSV text',
  'csv.limit': 'File exceeds 256 KiB',
  'csv.validate': 'Validate',
  'csv.confirm': 'Import validated rows',
  'csv.replayed': 'This exact file was already imported; no new records created.',
  'csv.done': 'Imported {count} records',
  'csv.ready': '{count} rows validated; ready to import',
  'csv.invalid': 'Correct the errors and validate again.',
  'csv.errors': 'Download error report',
  'csv.row': 'Row',
  'csv.field': 'Field',
  'csv.issue': 'Issue',

  // Bulk unit labels; non-English entries are unreviewed machine drafts.
  'bulk.create': 'Bulk-create units',
  'bulk.hint':
    "Creates 1–200 vacant units, all or none. Use one '{n}' placeholder in the naming pattern. Existing labels cannot be reused.",
  'bulk.pattern': 'Naming pattern',
  'bulk.start': 'Start number',
  'bulk.count': 'Unit count',
  'bulk.padding': 'Number width',
  'bulk.preview': 'Preview',
  'bulk.invalid': 'Invalid pattern or range',
  'bulk.created': 'Created {count} units',

  'portfolio.mode': 'How will you use the account?',
  'portfolio.self_owned': 'I own these properties',
  'portfolio.managed': 'I manage properties for other owners',
  'portfolio.owners': 'Landlords',
  'portfolio.owner': 'Landlord',
  'portfolio.owner_name': 'Landlord name',
  'portfolio.fee': 'Management fee (%)',
  'portfolio.fee_hint': 'Optional, stored only. No fees are charged automatically.',
  'portfolio.fee_invalid': 'Enter a percentage from 0 to 100 with up to two decimal places.',
  'portfolio.blocks': 'Buildings / blocks',
  'portfolio.block': 'Building / block',
  'portfolio.block_name': 'Block name',
  'portfolio.no_block': 'No block',
  'portfolio.no_owners': 'Add a landlord before creating their property.',
  'portfolio.no_blocks': 'Blocks are optional. Units can belong directly to this property.',
  'portfolio.add_owner': 'Add landlord',
  'portfolio.add_block': 'Add block',
  'portfolio.choose_owner': 'Choose a landlord',

  // --- app shell -----------------------------------------------------------
  'app.name': 'Property Management',
  'app.tagline': 'Manage your properties, tenants and rent in one place',
  'app.loading': 'Loading…',
  'nav.dashboard': 'Dashboard',
  'nav.properties': 'Properties',
  'nav.units': 'Units',
  'nav.tenants': 'Tenants',
  'nav.leases': 'Leases',
  'nav.rent': 'Rent',
  'nav.payments': 'Payments',
  'nav.maintenance': 'Maintenance',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.translations': 'Translations',

  // --- auth ---------------------------------------------------------------
  'auth.sign_in': 'Sign in',
  'auth.sign_out': 'Sign out',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.register_organization': 'Create an account for your organization',
  'auth.invalid_credentials': 'Email or password is incorrect',
  'auth.session_expired': 'Your session has expired. Please sign in again.',
  'auth.too_many_attempts': 'Too many attempts. Please try again in {minutes} minutes.',

  // --- calendar & dates ---------------------------------------------------
  'calendar.ethiopian': 'Ethiopian',
  'calendar.gregorian': 'Gregorian',
  'calendar.preference': 'Calendar',
  'calendar.ethiopian_month.13': 'Pagume',
  'calendar.today': 'Today',
  'calendar.select_date': 'Select a date',
  'calendar.year': 'Year',
  'calendar.month': 'Month',
  'calendar.day': 'Day',

  // --- organizations and users -------------------------------------------
  'org.name': 'Organization',
  'org.settings': 'Organization settings',
  'org.default_currency': 'Default currency',
  'org.default_calendar': 'Default calendar',
  'org.default_language': 'Default language',
  'org.rent_due_day': 'Rent due day',
  'org.grace_period_days': 'Grace period (days)',
  'org.saved': 'Settings saved',

  'user.role': 'Role',
  'user.invite': 'Invite user',
  'user.invited': 'Invitation sent to {email}',

  'role.owner_admin': 'Owner / Admin',
  'role.manager': 'Property Manager',
  'role.accountant': 'Accountant',
  'role.maintenance': 'Maintenance',
  'role.tenant': 'Tenant',

  // --- properties, units, tenants, leases --------------------------------
  'property.name': 'Property name',
  'property.type': 'Property type',
  'property.address_landmark': 'Landmark description',

  'unit.label': 'Unit',
  'unit.status': 'Status',
  'unit.market_rent': 'Market rent',

  'tenant.full_name': 'Full name',
  'tenant.phone': 'Phone',
  'tenant.id_type': 'ID type',
  'tenant.id_number': 'ID number (stored securely)',

  'unit.status.vacant': 'Vacant',
  'unit.status.occupied': 'Occupied',
  'unit.status.notice': 'Notice given',
  'unit.status.turnover': 'Turnover',
  'unit.status.unavailable': 'Unavailable',

  'lease.title': 'Lease',
  'lease.status': 'Status',
  'lease.rent_amount': 'Rent amount',
  'lease.billing_calendar': 'Billing calendar',
  'lease.due_day': 'Due day of month',
  'lease.start_date': 'Start date',
  'lease.end_date': 'End date',
  'lease.deposit': 'Deposit',
  'lease.escalation': 'Annual increase',
  'lease.terminate': 'Terminate lease',

  'lease.status.draft': 'Draft',
  'lease.status.pending': 'Pending',
  'lease.status.active': 'Active',
  'lease.status.expired': 'Expired',
  'lease.status.terminated': 'Terminated',
  'lease.status.cancelled': 'Cancelled',

  // --- money --------------------------------------------------------------
  'money.amount': 'Amount',
  'money.balance': 'Balance',
  'money.outstanding': 'Outstanding',
  'money.paid': 'Paid',
  'money.rent_due': 'Rent due',
  'money.overdue': 'Overdue',
  'money.method': 'Payment method',
  'money.record_payment': 'Record payment',
  'money.receipt_number': 'Receipt number',

  'charge.status.open': 'Open',
  'charge.status.partial': 'Partly paid',
  'charge.status.paid': 'Paid',
  'charge.status.waived': 'Waived',
  'charge.status.written_off': 'Written off',

  'payment.method.cash': 'Cash',
  'payment.method.bank_transfer': 'Bank transfer',
  'payment.method.cheque': 'Cheque',
  'payment.method.telebirr': 'Telebirr',
  'payment.method.chapa': 'Chapa',
  'payment.method.cbe_birr': 'CBE Birr',
  'payment.method.other': 'Other',

  // --- maintenance --------------------------------------------------------
  'maintenance.title': 'Maintenance',
  'maintenance.new_request': 'New request',
  'maintenance.priority': 'Priority',
  'maintenance.assign_vendor': 'Assign vendor',

  'work_order.status.open': 'Open',
  'work_order.status.assigned': 'Assigned',
  'work_order.status.in_progress': 'In progress',
  'work_order.status.on_hold': 'On hold',
  'work_order.status.completed': 'Completed',
  'work_order.status.cancelled': 'Cancelled',

  'work_order.priority.low': 'Low',
  'work_order.priority.normal': 'Normal',
  'work_order.priority.high': 'High',
  'work_order.priority.urgent': 'Urgent',

  // --- notifications ------------------------------------------------------
  'notification.rent_due_soon': 'Rent of {amount} is due on {dueDate}',
  'notification.rent_overdue': 'Your rent of {amount} was due on {dueDate}. Please pay as soon as possible.',
  'notification.payment_received': 'We received your payment of {amount}. Thank you.',
  'notification.lease_expiring': 'Your lease ends on {endDate}',
  'notification.work_order_created': 'Maintenance request received: {title}',

  // --- errors and validation ---------------------------------------------
  'error.generic': 'Something went wrong. Please try again.',
  'error.network': 'Cannot reach the server. Check your connection.',
  'error.not_found': 'Not found',
  'error.forbidden': 'You do not have permission to do this',
  'error.validation': 'Please correct the highlighted fields',
  'error.required_field': 'This field is required',
  'error.invalid_amount': 'Enter a valid amount',
  'error.invalid_date': 'Enter a valid date',
  'error.duplicate_charge': 'A charge already exists for this period',

  // --- translations manager ----------------------------------------------
  'translation.key': 'Key',
  'translation.english': 'English',
  'translation.current': 'Current text',
  'translation.override': 'Organization override',
  'translation.status.machine_draft': 'Machine draft — not reviewed',
  'translation.status.unreviewed': 'Not reviewed',
  'translation.status.reviewed': 'Reviewed',
  'translation.export': 'Export CSV',
  'translation.import': 'Import CSV',

  // --- interface additions (Phase 1 web app) -------------------------------
  'nav.group.overview': 'Overview',
  'nav.group.portfolio': 'Portfolio',
  'nav.group.money': 'Money',
  'nav.group.operations': 'Operations',
  'nav.group.settings': 'Administration',
  'nav.charges': 'Rent charges',
  'nav.documents': 'Documents',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.search': 'Search',
  'common.actions': 'Actions',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.year': 'Year',
  'common.today': 'Today',
  'common.create': 'Create',
  'common.close': 'Close',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.loading': 'Loading…',
  'common.none': 'None',
  'common.total': 'Total',
  'common.optional': 'Optional',
  'common.filters': 'Filters',
  'common.no_results': 'Nothing to show yet',
  'preferences.language': 'Language',
  'preferences.calendar': 'Calendar',
  'dashboard.title': 'Dashboard',
  'dashboard.expected_rent': 'Expected this period',
  'dashboard.collected': 'Collected',
  'dashboard.arrears': 'Arrears',
  'dashboard.occupancy': 'Occupancy',
  'dashboard.open_work_orders': 'Open maintenance',
  'dashboard.collections_trend': 'Collections over the last periods',
  'dashboard.rent_this_period': 'Expected vs collected',
  'reports.title': 'Reports',
  'reports.rent_roll': 'Rent roll',
  'reports.arrears': 'Arrears aging',
  'reports.occupancy': 'Occupancy',
  'reports.collections': 'Collections',
  'reports.period': 'Period',
  'reports.export_csv': 'Export CSV',
  'documents.title': 'Documents',
  'documents.upload': 'Upload document',
  'documents.category': 'Category',
  'documents.file': 'File',
  'documents.download': 'Download',
  'documents.size': 'Size',
  'tenant.employer': 'Employer',
  'tenant.emergency_contact': 'Emergency contact',
  'unit.bedrooms': 'Bedrooms',
  'unit.area_sqm': 'Area (m²)',
  'property.region': 'Region',
  'property.sub_city': 'Sub-city / town',
  'property.woreda': 'Woreda',
  'property.kebele': 'Kebele',
  'property.house_number': 'House number',
  'common.all': 'All',
  'org.late_fee_enabled': 'Late fee',
  // --- web UI shell, charts and offline (Phase 3) --------------------------
  'nav.menu': 'Menu',
  'a11y.skip_to_content': 'Skip to content',
  'a11y.chart_data': 'Chart data as a table',
  'dashboard.quick_actions': 'Quick actions',
  'dashboard.quick.lease': 'New lease',
  'dashboard.quick.tenant': 'New tenant',
  'dashboard.onboarding_title': 'Your portfolio is empty',
  'dashboard.onboarding_body': 'Add a property and its units, then invite tenants and start a lease.',
  'dashboard.onboarding_cta': 'Add a property',
  'lease.billing_frequency': 'Billing frequency',
  'lease.terminate_reason': 'Reason',
  'lease.terminate_hint': 'Ending the lease frees the unit and keeps every charge and payment on the ledger.',
  'billing.monthly': 'Monthly',
  'billing.quarterly': 'Quarterly',
  'billing.semi_annual': 'Every six months',
  'billing.annual': 'Annual',
  'billing.custom': 'Custom',
  'payment.status.pending': 'Pending',
  'payment.status.succeeded': 'Succeeded',
  'payment.status.failed': 'Failed',
  'payment.status.reversed': 'Reversed',
  'payment.reverse': 'Reverse payment',
  'payment.reverse_reason': 'Reason for reversal',
  'payment.reverse_hint':
    'Reversing posts a mirror entry in the ledger and makes the charges payable again. The original payment stays in history.',
  'payment.reference_placeholder': 'Bank slip or cheque number',
  'payment.recorded': 'Payment recorded · receipt {receipt}',
  'payment.filter_method': 'Filter by method',
  'payment.paid_on': 'Payment date',
  'payment.reference': 'Reference',
  'offline.title': 'You are offline',
  'offline.body':
    'The connection dropped. Pages you loaded earlier are still here; reconnect for fresh figures.',
  'offline.retry': 'Try again',
} as const;

export type TranslationKey = keyof typeof EN_CATALOG;

export const TRANSLATION_KEYS = Object.keys(EN_CATALOG) as TranslationKey[];

/** Keys whose text contains ICU arguments, used by the catalog linter. */
export function extractIcuArguments(message: string): string[] {
  const args = new Set<string>();
  for (const match of message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)) {
    if (match[1]) args.add(match[1]);
  }
  return [...args].sort();
}
