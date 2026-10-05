/**
 * Error taxonomy.
 *
 * Everything thrown on purpose is an `AppError` with a stable machine code and
 * an HTTP status. The error middleware turns anything else into a 500 and hides
 * internals from the client.
 *
 * Note on multi-organization privacy: a resource that exists in another
 * organization must look exactly like a resource that does not exist —
 * `notFound()`, never `forbidden()`. Returning 403 for someone else's row leaks
 * information about that row.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UNPROCESSABLE',
  'BUSINESS_RULE',
  'PROVIDER_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorDetails {
  /** Field-level validation issues, e.g. from Zod. */
  fields?: { path: string; message: string }[];
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: AppErrorDetails;
  /** Safe to show to end users (translated by the client using our own keys). */
  readonly userMessageKey?: string;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: AppErrorDetails; userMessageKey?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.userMessageKey = options.userMessageKey;
  }
}

export const badRequest = (message: string, details?: AppErrorDetails): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message, { details, userMessageKey: 'error.validation' });

export const unauthenticated = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHENTICATED', message, { userMessageKey: 'auth.session_expired' });

export const forbidden = (message = 'Not permitted'): AppError =>
  new AppError(403, 'FORBIDDEN', message, { userMessageKey: 'error.forbidden' });

export const notFound = (message = 'Not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message, { userMessageKey: 'error.not_found' });

export const conflict = (message: string, details?: AppErrorDetails): AppError =>
  new AppError(409, 'CONFLICT', message, { details });

export const rateLimited = (message = 'Too many requests'): AppError =>
  new AppError(429, 'RATE_LIMITED', message, { userMessageKey: 'auth.too_many_attempts' });

export const unprocessable = (message: string, details?: AppErrorDetails): AppError =>
  new AppError(422, 'UNPROCESSABLE', message, { details });

export const businessRule = (message: string, details?: AppErrorDetails): AppError =>
  new AppError(422, 'BUSINESS_RULE', message, { details });

export const providerError = (message: string, details?: AppErrorDetails, cause?: unknown): AppError =>
  new AppError(502, 'PROVIDER_ERROR', message, { details, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Asserts a condition, throwing an `AppError` when it fails. Keeps service code
 * readable: `invariant(charge.status !== 'paid', conflict('Charge already paid'))`.
 */
export function invariant(condition: unknown, error: AppError): asserts condition {
  if (!condition) throw error;
}
