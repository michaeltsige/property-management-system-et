'use client';

/**
 * The single API client for the web app.
 *
 * Rules it enforces for every call:
 *  - relative URLs only, so the same build works locally, in the sandbox preview
 *    and behind a load balancer (see `next.config.ts` for the rewrite);
 *  - the access token rides in `Authorization`, never in a query string;
 *  - one transparent refresh when a token has expired, with the request replayed;
 *  - money arrives as decimal strings (BigInt on the server) and is parsed by the
 *    caller with `@pms/shared` helpers, never with `Number()` arithmetic.
 */

import type { LanguageCode } from '@pms/calendar';

import type {
  Arrears,
  Charge,
  CollectionRow,
  Document,
  LeaseDetail,
  LeaseSummary,
  Member,
  Notification,
  OccupancyRow,
  Payment,
  Property,
  RentRoll,
  StatementLine,
  Summary,
  Tenant,
  TenantIdType,
  TranslationRow,
  Unit,
  Vendor,
  WorkOrder,
} from './types';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    language: LanguageCode;
    calendar: 'ethiopian' | 'gregorian';
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    calendar: 'ethiopian' | 'gregorian';
    language: LanguageCode;
  };
  role: string;
}

const STORAGE_KEY = 'pms.session.v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null): void {
  if (typeof window === 'undefined') return;
  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(STORAGE_KEY);
}

export function updateStoredSession(patch: Partial<StoredSession>): StoredSession | null {
  const current = loadSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveSession(next);
  return next;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Skip the automatic refresh (used by the refresh call itself). */
  skipRefresh?: boolean;
  /** Send the request without a token (login, register). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const session = loadSession();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous && session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;

  return fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: 'no-store',
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function refreshSession(): Promise<boolean> {
  const session = loadSession();
  if (!session?.refreshToken) return false;

  const response = await rawRequest('/auth/refresh', {
    method: 'POST',
    anonymous: true,
    body: { refreshToken: session.refreshToken },
  });
  if (!response.ok) {
    saveSession(null);
    return false;
  }
  const payload = await parseResponse<{ tokens: { accessToken: string; refreshToken: string } }>(response);
  updateStoredSession({
    accessToken: payload.tokens.accessToken,
    refreshToken: payload.tokens.refreshToken,
  });
  return true;
}

/** Parse a `{ error: { code, message, details } }` envelope into an `ApiError`. */
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    return new ApiError(
      response.status,
      body.error?.code ?? 'INTERNAL_ERROR',
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.details,
    );
  } catch {
    return new ApiError(response.status, 'INTERNAL_ERROR', `Request failed with status ${response.status}`);
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.anonymous && !options.skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) response = await rawRequest(path, { ...options, skipRefresh: true });
  }

  if (!response.ok) throw await toApiError(response);
  return parseResponse<T>(response);
}

export const api = {
  // --- auth -----------------------------------------------------------------
  register: (body: unknown) =>
    apiFetch<{ tokens: { accessToken: string; refreshToken: string } }>('/auth/register', {
      method: 'POST',
      body,
      anonymous: true,
    }),
  login: (body: { email: string; password: string }) =>
    apiFetch<{
      tokens: { accessToken: string; refreshToken: string };
      user: StoredSession['user'];
      organization: StoredSession['organization'];
      /** The role this session acts as. */
      role: string;
      /** Every organization the user can switch to. */
      memberships: { organizationId: string; name: string; slug: string; role: string }[];
    }>('/auth/login', { method: 'POST', body, anonymous: true }),
  logout: () =>
    apiFetch<void>('/auth/logout', { method: 'POST', body: { refreshToken: loadSession()?.refreshToken } }),
  me: () => apiFetch<{ user: StoredSession['user'] }>('/auth/me'),

  // --- portfolio ------------------------------------------------------------
  properties: () => apiFetch<{ properties: Property[] }>('/properties'),
  createProperty: (body: unknown) =>
    apiFetch<{ property: Property }>('/properties', { method: 'POST', body }),
  units: () => apiFetch<{ units: Unit[] }>('/units'),
  createUnit: (body: unknown) => apiFetch<{ unit: Unit }>('/units', { method: 'POST', body }),
  tenants: (search?: string) =>
    apiFetch<{ tenants: Tenant[] }>(`/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createTenant: (body: unknown) => apiFetch<{ tenant: Tenant }>('/tenants', { method: 'POST', body }),
  leases: () => apiFetch<{ leases: LeaseSummary[] }>('/leases'),
  lease: (id: string) => apiFetch<{ lease: LeaseDetail; balanceMinor: string }>(`/leases/${id}`),
  createLease: (body: unknown) => apiFetch<{ lease: LeaseDetail }>('/leases', { method: 'POST', body }),
  terminateLease: (id: string, body: unknown) =>
    apiFetch<{ lease: LeaseDetail }>(`/leases/${id}/terminate`, { method: 'POST', body }),

  // --- money ----------------------------------------------------------------
  charges: (query = '') => apiFetch<{ items: Charge[]; total: number }>(`/charges${query}`),
  generateCharges: (body: unknown) =>
    apiFetch<{ created: number; skippedExisting: number; skippedOutOfRange: number }>('/charges/generate', {
      method: 'POST',
      body,
    }),
  waiveCharge: (chargeId: string, reason: string) =>
    apiFetch<{ charge: Charge }>(`/charges/${chargeId}/waive`, { method: 'POST', body: { reason } }),
  payments: (query = '') => apiFetch<{ items: Payment[]; total: number }>(`/payments${query}`),
  recordPayment: (body: unknown) =>
    apiFetch<{ paymentId: string; receiptNumber: string }>('/payments', { method: 'POST', body }),
  reversePayment: (paymentId: string, reason: string) =>
    apiFetch<{ payment: Payment }>(`/payments/${paymentId}/reverse`, { method: 'POST', body: { reason } }),
  statement: (leaseId: string) =>
    apiFetch<{ leaseId: string; currency: string; balanceMinor: string; lines: StatementLine[] }>(
      `/leases/${leaseId}/statement`,
    ),

  // --- operations -----------------------------------------------------------
  workOrders: (query = '') =>
    apiFetch<{ items: WorkOrder[]; total: number; openCount: number; urgentCount: number }>(
      `/work-orders${query}`,
    ),
  createWorkOrder: (body: unknown) =>
    apiFetch<{ workOrder: WorkOrder }>('/work-orders', { method: 'POST', body }),
  updateWorkOrder: (id: string, body: unknown) =>
    apiFetch<{ workOrder: WorkOrder }>(`/work-orders/${id}`, { method: 'PATCH', body }),
  vendors: () => apiFetch<{ vendors: Vendor[] }>('/vendors'),
  createVendor: (body: unknown) => apiFetch<{ vendor: Vendor }>('/vendors', { method: 'POST', body }),
  documents: (query = '') => apiFetch<{ items: Document[]; total: number }>(`/documents${query}`),
  uploadDocument: (body: unknown) => apiFetch<{ document: Document }>('/documents', { method: 'POST', body }),
  deleteDocument: (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' }),
  notifications: () => apiFetch<{ items: Notification[]; total: number; queued: number }>('/notifications'),
  sendNotification: (body: unknown) =>
    apiFetch<{ notification: Notification; body: string }>('/notifications/send', { method: 'POST', body }),

  // --- reports & settings ---------------------------------------------------
  summary: (query = '') => apiFetch<Summary>(`/reports/summary${query}`),
  rentRoll: (query = '') => apiFetch<RentRoll>(`/reports/rent-roll${query}`),
  arrears: (query = '') => apiFetch<Arrears>(`/reports/arrears${query}`),
  occupancy: () =>
    apiFetch<{
      rows: OccupancyRow[];
      totals: { totalUnits: number; occupiedUnits: number; vacantUnits: number; occupancyRate: number };
    }>('/reports/occupancy'),
  collections: (query = '') =>
    apiFetch<{ calendar: string; currency: string; rows: CollectionRow[] }>(`/reports/collections${query}`),
  settings: () => apiFetch<{ settings: Record<string, unknown> }>('/organizations/settings'),
  updateSettings: (body: unknown) =>
    apiFetch<{ settings: Record<string, unknown> }>('/organizations/settings', { method: 'PATCH', body }),
  members: () => apiFetch<{ members: Member[] }>('/organizations/members'),
  idTypes: () => apiFetch<{ idTypes: TenantIdType[] }>('/organizations/id-types'),
  translations: (language: string) =>
    apiFetch<{
      rows: TranslationRow[];
      coverage: Record<string, { translated: number; total: number; percent: number }>;
    }>(`/translations?language=${language}`),
  saveTranslation: (key: string, body: unknown) =>
    apiFetch<{ override: unknown }>(`/translations/${encodeURIComponent(key)}`, { method: 'PUT', body }),
  /** CSV is text, not JSON: fetched raw so it can be saved to a file verbatim. */
  exportTranslations: async (language: string): Promise<string> => {
    const session = loadSession();
    const response = await fetch(`/api/v1/translations/export?language=${language}`, {
      headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
      cache: 'no-store',
    });
    if (!response.ok) throw await toApiError(response);
    return response.text();
  },
  importTranslations: (csv: string) =>
    apiFetch<{ imported: number }>('/translations/import', { method: 'POST', body: { csv } }),
};
