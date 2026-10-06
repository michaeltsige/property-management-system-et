/**
 * Role labels.
 *
 * The role name is translated by key (`role.owner_admin`). A user whose session
 * arrived without a role would otherwise see the raw key — `role.undefined` —
 * in the header and the drawer, which is how this file came to exist.
 */
export const ROLE_KEYS = ['owner_admin', 'manager', 'accountant', 'maintenance', 'tenant'] as const;

export type RoleCode = (typeof ROLE_KEYS)[number];

/** Shown when a session carries no recognizable role. */
export const ROLE_LABEL_FALLBACK = '—';
