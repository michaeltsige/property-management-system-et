/**
 * Small cross-cutting types used by API and web.
 */

import type { CalendarKind, LanguageCode } from '@pms/calendar';
import type { Role } from './constants.js';
import type { Permission } from './permissions.js';

export type { CalendarKind, LanguageCode };

/** The authenticated caller, as attached to `req.auth` by the API. */
export interface AuthPrincipal {
  userId: string;
  email: string;
  fullName: string;
  /** Organization currently in scope for this request. */
  organizationId: string;
  role: Role;
  permissions: readonly Permission[];
  /** Platform operators can create organizations and manage global overrides. */
  isPlatformAdmin: boolean;
  /** Effective calendar preference: user override, else organization default. */
  calendar: CalendarKind;
  language: LanguageCode;
}

/** Standard error payload returned by the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation details, when the failure came from Zod. */
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Any value that can be serialised into an audit-log before/after snapshot. */
export type AuditSnapshot = Record<string, unknown> | null;

export const CALENDAR_LABELS: Record<CalendarKind, string> = {
  ethiopian: 'Ethiopian',
  gregorian: 'Gregorian',
};
