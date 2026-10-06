/**
 * Permissions and role matrix.
 *
 * The API enforces these; the web app uses the same table to hide actions the
 * user cannot perform. Keeping one source of truth prevents the classic bug where
 * the UI hides a button but the endpoint still allows the call.
 *
 * Every permission is checked **inside** an organization scope: a permission
 * never crosses organizations.
 */

import { ROLES, type Role } from './constants.js';

export const PERMISSIONS = [
  // organization
  'org.read',
  'org.update',
  'org.billing.manage',
  'org.settings.manage',
  'users.read',
  'users.invite',
  'users.manage',
  'roles.manage',
  'translations.read',
  'translations.manage',
  'audit.read',
  // portfolio
  'owners.read',
  'owners.write',
  'properties.read',
  'properties.write',
  'units.read',
  'units.write',
  'tenants.read',
  'tenants.write',
  'tenants.ids.read',
  // leasing & money
  'leases.read',
  'leases.write',
  'leases.approve',
  'charges.read',
  'charges.write',
  'charges.waive',
  'payments.read',
  'payments.record',
  'payments.reconcile',
  'payments.refund',
  'payments.reverse',
  'ledger.read',
  'reports.read',
  'reports.export',
  // operations
  'maintenance.read',
  'maintenance.write',
  'maintenance.assign',
  'vendors.read',
  'vendors.write',
  'documents.read',
  'documents.write',
  'notifications.read',
  'notifications.send',
  // tenant portal
  'portal.use',
  'portal.pay',
  'portal.request_maintenance',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY_PORTFOLIO: readonly Permission[] = [
  'org.read',
  'properties.read',
  'units.read',
  'leases.read',
  'charges.read',
  'payments.read',
  'maintenance.read',
  'documents.read',
];

/**
 * Role -> permissions.
 *
 * `owner_admin` deliberately receives every permission; `maintenance` sees
 * property/unit context but no financial data (they need to know where to go,
 * not what the rent is); `tenant` only reaches the portal surface and their own
 * records, which the API additionally filters by tenancy.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner_admin: PERMISSIONS,
  manager: [
    'owners.read',
    'owners.write',
    'org.read',
    'users.read',
    'users.invite',
    'translations.read',
    'properties.read',
    'properties.write',
    'units.read',
    'units.write',
    'tenants.read',
    'tenants.write',
    'tenants.ids.read',
    'leases.read',
    'leases.write',
    'leases.approve',
    'charges.read',
    'charges.write',
    'payments.read',
    'payments.record',
    'ledger.read',
    'reports.read',
    'reports.export',
    'maintenance.read',
    'maintenance.write',
    'maintenance.assign',
    'vendors.read',
    'vendors.write',
    'documents.read',
    'documents.write',
    'notifications.read',
    'notifications.send',
    'audit.read',
  ],
  accountant: [
    'owners.read',
    'org.read',
    ...READ_ONLY_PORTFOLIO.filter((p) => p !== 'documents.read' && p !== 'maintenance.read'),
    'leases.read',
    'charges.write',
    'charges.waive',
    'payments.record',
    'payments.reconcile',
    'payments.refund',
    'payments.reverse',
    'ledger.read',
    'reports.read',
    'reports.export',
    'documents.read',
    'documents.write',
    'notifications.read',
    'tenants.read',
    'audit.read',
  ],
  maintenance: [
    'org.read',
    'properties.read',
    'units.read',
    'maintenance.read',
    'maintenance.write',
    'vendors.read',
    'documents.read',
    'documents.write',
    'notifications.read',
    'tenants.read',
  ],
  tenant: [
    'org.read',
    'portal.use',
    'portal.pay',
    'portal.request_maintenance',
    'leases.read',
    'charges.read',
    'payments.read',
    'documents.read',
  ],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Permissions that only make sense for staff working inside an organization. */
export const STAFF_ROLES: readonly Role[] = ['owner_admin', 'manager', 'accountant', 'maintenance'];
