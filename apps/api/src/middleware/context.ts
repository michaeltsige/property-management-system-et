/**
 * Request context: request id, logger, authenticated principal, and the
 * organization scope used by every query.
 */

import type { NextFunction, Request, Response } from 'express';

import type { AuthPrincipal } from '@pms/shared';

import { newRequestId } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { unauthenticated } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthPrincipal;
      /** Token id of the access token, useful for audit correlation. */
      tokenId?: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') ?? '').trim() || newRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Requires an authenticated principal; used on every route except health/auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthenticated());
    return;
  }
  next();
}

/**
 * The organization a request operates on.
 *
 * Platform admins may target another organization explicitly with the
 * `x-organization-id` header (used by support tooling); everyone else is pinned
 * to the organization in their access token.
 */
export function organizationIdOf(req: Request): string {
  const principal = req.auth;
  if (!principal) throw unauthenticated();
  if (principal.isPlatformAdmin) {
    const override = req.header('x-organization-id');
    if (override && override.trim().length > 0) return override.trim();
  }
  return principal.organizationId;
}

export function logRequestCompletion(req: Request, res: Response, startedAt: number): void {
  logger.info(
    {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.auth?.userId,
      organizationId: req.auth?.organizationId,
    },
    'request completed',
  );
}
