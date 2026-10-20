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

/**
 * Role -> permissions.
 *
 * `owner_admin` deliberately receives every permission. The manager is the
 * owner's operational right hand and inherits the full money desk (waive,
 * reconcile, refund, reverse) — the former accountant role was folded into it
 * when the role model was reduced to three roles.
 *
 * `tenant` reaches ONLY the portal surface (`portal.*`). Staff list endpoints
 * (documents, leases, charges, payments, org settings) are org-wide by design
 * — they serve the whole portfolio, so a tenant holding their read permissions
 * could enumerate every other tenant's files and money. Tenant-facing data
 * flows exclusively through the tenancy-scoped `/portal/*` routes.
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
    'charges.waive',
    'payments.read',
    'payments.record',
    'payments.reconcile',
    'payments.refund',
    'payments.reverse',
    'ledger.read',
    'reports.read',
    'reports.export',
    'maintenance.read',
    'maintenance.write',
    // `maintenance.assign` (who works on it + the closing cost) is owner-only:
    // managers estimate and progress the work, but do not decide money or people.
    'vendors.read',
    'vendors.write',
    'documents.read',
    'documents.write',
    'notifications.read',
    'notifications.send',
    'audit.read',
  ],
  tenant: ['portal.use', 'portal.pay', 'portal.request_maintenance'],
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
export const STAFF_ROLES: readonly Role[] = ['owner_admin', 'manager'];
