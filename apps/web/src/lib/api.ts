'use client';

/**
 * The single API client for the web app.
 *
 * Rules it enforces for every call:
 *  - relative URLs only, so the same build works locally, in Cloud Shell Web
 *    Preview and behind a load balancer;
 *  - **no credentials in JavaScript at all**: the session lives in `HttpOnly`
 *    cookies that this code cannot read, and the proxy in
 *    `app/api/v1/[...path]/route.ts` attaches the Bearer token server-side. This
 *    client never sends an `Authorization` header (ADR-0026);
 *  - a 401 is retried behind a server-side refresh, so access-token expiry is
 *    invisible; if the refresh cookie is dead too, the session is over and the
 *    app is told to sign out;
 *  - money arrives as decimal strings (BigInt on the server) and is parsed by the
 *    caller with `@pms/shared` helpers, never with `Number()` arithmetic.
 */

import type { ImportKind, ImportReport, PaymentGatewayStatus } from '@pms/shared';
import type { LanguageCode } from '@pms/calendar';

import type {
  Owner,
  Building,
  Arrears,
  AuditLogEntry,
  Charge,
  CollectionRow,
  Document,
  LeaseDetail,
  LeaseSummary,
  Member,
  Notification,
  OccupancyRow,
  Payment,
  PaymentProof,
  PortalCompletedPayment,
  PortalCharge,
  PortalDocument,
  PortalMe,
  PortalNotice,
  PortalPayment,
  PortalPaymentIntent,
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
  WorkOrderNote,
} from './types';

/**
 * What the browser remembers about the session.
 *
 * Identity only. It is a display cache so the shell can render instantly on a
 * reload; everything in it is re-verified against `GET /api/session/me`, and none
 * of it grants access — the cookies do that, and they are not readable here.
 */
export interface StoredSession {
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
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession> & Record<string, unknown>;
    if (!parsed?.user || !parsed?.organization) return null;

    // Rebuild the object field by field. An older build stored tokens here; they
    // are dropped rather than carried forward (ADR-0026).
    return {
      user: parsed.user as StoredSession['user'],
      organization: parsed.organization as StoredSession['organization'],
      role: typeof parsed.role === 'string' ? parsed.role : '',
    };
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

/**
 * Broadcast when the session is over, so the shell can send the user to `/login`
 * even though the failure happened inside some screen's data fetch.
 */
export const SESSION_EXPIRED_EVENT = 'pms:session-expired';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
}

function requestHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  // Required by the proxy on every state-changing request (CSRF, see ADR-0026).
  // A cross-site page cannot set a custom header without a preflight this server
  // never approves.
  if ((options.method ?? 'GET') !== 'GET') headers['X-Requested-With'] = 'XMLHttpRequest';
  return headers;
}

async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  return fetch(path, {
    method: options.method ?? 'GET',
    headers: requestHeaders(options),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: 'no-store',
    // Same-origin: the session cookie rides along, and nothing else does.
    credentials: 'same-origin',
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Parse a `{ error: { code, message, details } }` envelope into an `ApiError`. */
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    const baseMessage = body.error?.message ?? `Request failed with status ${response.status}`;
    // Validation failures carry a generic message plus per-field details; surface
    // the first field problem so "Request validation failed" explains itself.
    const fields = (body.error?.details as { fields?: { path: string; message: string }[] } | undefined)
      ?.fields;
    const firstField = fields?.[0];
    const message =
      firstField && firstField.message
        ? `${baseMessage} — ${firstField.path ? `${firstField.path}: ` : ''}${firstField.message}`
        : baseMessage;
    return new ApiError(response.status, body.error?.code ?? 'INTERNAL_ERROR', message, body.error?.details);
  } catch {
    return new ApiError(response.status, 'INTERNAL_ERROR', `Request failed with status ${response.status}`);
  }
}

/**
 * Resolve a call to a URL this origin serves.
 *
 * Data calls pass an API path (`/properties`); session calls pass the absolute
 * path they live at (`/api/session/login`). Both stay relative to the page origin,
 * so the same build works in every environment.
 */
function resolveUrl(path: string): string {
  return path.startsWith('/api/') ? path : `/api/v1${path}`;
}

async function runFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await rawRequest(resolveUrl(path), options);

  if (response.status === 401) {
    // The proxy has already tried a refresh before answering 401, so this means
    // the session is genuinely over.
    if (typeof window !== 'undefined') {
      saveSession(null);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw await toApiError(response);
  }

  if (!response.ok) throw await toApiError(response);
  return parseResponse<T>(response);
}

/**
 * Concurrent duplicate GETs share a single request.
 *
 * The shell mounts several components that each need the same lists (search,
 * task panel, screens), and dev-mode StrictMount runs effects twice — without
 * deduplication the dashboard fires four copies of the same call, and every
 * copy pays the Cloud Shell preview's round-trip cost. Only in-flight requests
 * are shared (never cached), so data is never stale; requests with an
 * AbortSignal are excluded because the signal belongs to one caller.
 */
const inflightGets = new Map<string, Promise<unknown>>();

export function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if ((options.method ?? 'GET') !== 'GET' || options.signal) return runFetch<T>(path, options);

  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;

  const promise = runFetch<T>(path, options).finally(() => {
    inflightGets.delete(path);
  });
  inflightGets.set(path, promise);
  return promise;
}

export const api = {
  // --- auth -----------------------------------------------------------------
  // Session endpoints live on the web server: they call the API, set HttpOnly
  // cookies and return identity only. Tokens never reach this code (ADR-0026).
  register: (body: unknown) =>
    apiFetch<{ user: StoredSession['user']; organization: StoredSession['organization'] }>(
      '/api/session/register',
      { method: 'POST', body },
    ),
  login: (body: { email: string; password: string }) =>
    apiFetch<{
      user: StoredSession['user'];
      organization: StoredSession['organization'];
      /** The role this session acts as. */
      role: string;
      /** Every organization the user can switch to. */
      memberships: { organizationId: string; name: string; slug: string; role: string }[];
    }>('/api/session/login', { method: 'POST', body }),
  logout: () => apiFetch<void>('/api/session/logout', { method: 'POST', body: {} }),
  me: () => apiFetch<{ user: StoredSession['user'] & { role?: string } }>('/api/session/me'),
  /** Ask for an OTP; the answer is identical for known and unknown numbers. */
  portalRequestCode: (body: { phone: string }) =>
    apiFetch<{ ok: boolean }>('/api/session/portal-request', { method: 'POST', body }),
  /** Consume the OTP; sets the HttpOnly session cookies server-side. */
  portalVerify: (body: { phone: string; code: string }) =>
    apiFetch<{
      user: StoredSession['user'];
      organization: StoredSession['organization'];
      role: string;
      memberships: unknown[];
      tenant: { id: string; fullName: string };
    }>('/api/session/portal-verify', { method: 'POST', body }),

  // --- portfolio ------------------------------------------------------------
  owners: () => apiFetch<{ owners: Owner[]; portfolioMode: 'self_owned' | 'managed' }>('/owners'),
  createOwner: (body: unknown) => apiFetch<{ owner: Owner }>('/owners', { method: 'POST', body }),
  updateOwner: (id: string, body: unknown) =>
    apiFetch<{ owner: Owner }>(`/owners/${id}`, { method: 'PATCH', body }),
  createBuilding: (body: unknown) => apiFetch<{ building: Building }>('/buildings', { method: 'POST', body }),
  updateBuilding: (id: string, body: unknown) =>
    apiFetch<{ building: Building }>(`/buildings/${id}`, { method: 'PATCH', body }),
  updateProperty: (id: string, body: unknown) =>
    apiFetch<{ property: Property }>(`/properties/${id}`, { method: 'PATCH', body }),
  updateUnit: (id: string, body: unknown) =>
    apiFetch<{ unit: Unit }>(`/units/${id}`, { method: 'PATCH', body }),
  properties: () => apiFetch<{ properties: Property[] }>('/properties'),
  createProperty: (body: unknown) =>
    apiFetch<{ property: Property }>('/properties', { method: 'POST', body }),
  units: () => apiFetch<{ units: Unit[] }>('/units'),
  importCsv: (kind: ImportKind, body: unknown) =>
    apiFetch<ImportReport>(`/imports/${kind}`, { method: 'POST', body }),
  bulkUnits: (body: unknown) =>
    apiFetch<{ units: Unit[]; count: number }>('/units/bulk', { method: 'POST', body }),
  setRentByType: (body: {
    propertyId: string;
    typeLabel: string;
    marketRent: { amountMinor: number; currency: string };
  }) => apiFetch<{ updated: number }>('/units/rent-by-type', { method: 'PATCH', body }),
  createUnit: (body: unknown) => apiFetch<{ unit: Unit }>('/units', { method: 'POST', body }),
  tenants: (search?: string) =>
    apiFetch<{ tenants: Tenant[] }>(`/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createTenant: (body: unknown) => apiFetch<{ tenant: Tenant }>('/tenants', { method: 'POST', body }),
  enableTenantPortal: (tenantId: string) =>
    apiFetch<{ enrolled: boolean; replayed?: boolean }>(`/tenants/${tenantId}/portal`, {
      method: 'POST',
      body: {},
    }),
  disableTenantPortal: (tenantId: string) =>
    apiFetch<{ enrolled: boolean }>(`/tenants/${tenantId}/portal`, { method: 'DELETE' }),
  /** What a signed-in tenant sees on their portal page. */
  portalMe: () => apiFetch<PortalMe>('/portal/me'),
  /** Lease papers, receipts and anything else filed for this tenant. */
  portalDocuments: () => apiFetch<{ items: PortalDocument[] }>('/portal/documents'),
  /** Same-origin download URL — the session cookie authorizes it. */
  portalDocumentUrl: (id: string) => `/api/v1/portal/documents/${id}/download`,
  /** Server-side CSV export; open in a new tab so the browser downloads it. */
  exportCsvUrl: (kind: 'tenants' | 'leases' | 'charges' | 'payments' | 'arrears') =>
    `/api/v1/exports/${kind}.csv`,
  auditLogs: (query = '') => apiFetch<{ items: AuditLogEntry[]; total: number }>(`/audit-logs${query}`),

  // --- tenant portal payments -----------------------------------------------
  // The intent lives server-side; the browser only ever sees the reference.
  portalInitiatePayment: (body: { amountMinor?: string } = {}) =>
    apiFetch<PortalPaymentIntent>('/portal/payments/initiate', { method: 'POST', body }),
  portalPaymentIntent: (providerRef: string) =>
    apiFetch<PortalPaymentIntent>(`/portal/payments/${encodeURIComponent(providerRef)}`),
  portalCompletePayment: (providerRef: string) =>
    apiFetch<PortalCompletedPayment>(`/portal/payments/${encodeURIComponent(providerRef)}/complete`, {
      method: 'POST',
      body: {},
    }),
  uploadPortalPaymentProof: (body: unknown) =>
    apiFetch<{ proof: PaymentProof }>('/portal/payment-proofs', { method: 'POST', body }),
  portalPaymentProofs: () => apiFetch<{ items: PaymentProof[] }>('/portal/payment-proofs'),

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
  paymentProofs: (query = '') =>
    apiFetch<{ items: PaymentProof[]; total: number }>(`/payments/proofs${query}`),
  approvePaymentProof: (proofId: string, notes?: string) =>
    apiFetch<{ proof: PaymentProof; payment: { paymentId: string; receiptNumber: string } }>(
      `/payments/proofs/${proofId}/approve`,
      { method: 'POST', body: { notes } },
    ),
  rejectPaymentProof: (proofId: string, reason: string) =>
    apiFetch<{ proof: PaymentProof }>(`/payments/proofs/${proofId}/reject`, {
      method: 'POST',
      body: { reason },
    }),
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
  workOrder: (id: string) => apiFetch<{ workOrder: WorkOrder }>(`/work-orders/${id}`),
  addWorkOrderNote: (id: string, body: { body: string; internal?: boolean }) =>
    apiFetch<{ note: WorkOrderNote }>(`/work-orders/${id}/notes`, { method: 'POST', body }),
  /** The tenant's rent account statement (charges with what was paid). */
  portalCharges: () => apiFetch<{ items: PortalCharge[] }>('/portal/charges'),
  /** The tenant's payment history. */
  portalPayments: () => apiFetch<{ items: PortalPayment[] }>('/portal/payments'),
  /** Receipt PDF for one of the tenant's own payments. */
  portalReceiptUrl: (paymentId: string) =>
    `/api/v1/portal/payments/by-id/${encodeURIComponent(paymentId)}/receipt.pdf`,
  /** In-app notices for the signed-in tenant. */
  portalNotices: () => apiFetch<{ items: PortalNotice[] }>('/portal/notices'),
  portalMaintenanceRequests: () => apiFetch<{ items: WorkOrder[] }>('/portal/maintenance-requests'),
  createPortalMaintenanceRequest: (body: { title: string; description?: string }) =>
    apiFetch<{ workOrder: WorkOrder }>('/portal/maintenance-requests', { method: 'POST', body }),
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
  finishOnboarding: (body: unknown) =>
    apiFetch<{ status: string; replayed: boolean; propertyId?: string | null }>('/organizations/onboarding', {
      method: 'POST',
      body,
    }),
  settings: () => apiFetch<{ settings: Record<string, unknown> }>('/organizations/settings'),
  updateSettings: (body: unknown) =>
    apiFetch<{ settings: Record<string, unknown> }>('/organizations/settings', { method: 'PATCH', body }),
  paymentGateway: () => apiFetch<{ gateway: PaymentGatewayStatus }>('/organizations/payment-gateway'),
  updatePaymentGateway: (body: unknown) =>
    apiFetch<{ gateway: PaymentGatewayStatus }>('/organizations/payment-gateway', { method: 'PUT', body }),
  resetPaymentGateway: () =>
    apiFetch<{ gateway: PaymentGatewayStatus }>('/organizations/payment-gateway', { method: 'DELETE' }),
  members: () => apiFetch<{ members: Member[] }>('/organizations/members'),
  updateMembership: (membershipId: string, body: { role?: string; status?: 'active' | 'disabled' }) =>
    apiFetch<{ membership: Member }>(`/organizations/members/${membershipId}`, { method: 'PATCH', body }),
  updateOrganizationProfile: (body: { name: string }) =>
    apiFetch<{ organization: { id: string; name: string; slug: string } }>('/organizations/profile', {
      method: 'PATCH',
      body,
    }),
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
    const response = await rawRequest(`/api/v1/translations/export?language=${language}`);
    if (!response.ok) throw await toApiError(response);
    return response.text();
  },
  importTranslations: (csv: string) =>
    apiFetch<{ imported: number }>('/translations/import', { method: 'POST', body: { csv } }),
};
