/**
 * Role-based access control.
 *
 * `requirePermission` is applied per route; the permission table lives in
 * `@pms/shared` so the web app can hide the same actions it cannot perform.
 */

import type { NextFunction, Request, Response } from 'express';

import { roleHasPermission, type Permission } from '@pms/shared';

import { forbidden, unauthenticated } from '../lib/errors.js';
import type { Role } from '@pms/shared';

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.auth;
    if (!principal) {
      next(unauthenticated());
      return;
    }
    // Platform admins bypass the organization matrix but still act inside a
    // single organization scope per request.
    if (principal.isPlatformAdmin) {
      next();
      return;
    }
    const missing = permissions.filter((permission) => !roleHasPermission(principal.role, permission));
    if (missing.length > 0) {
      next(forbidden(`Missing permission: ${missing.join(', ')}`));
      return;
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.auth;
    if (!principal) {
      next(unauthenticated());
      return;
    }
    if (principal.isPlatformAdmin) {
      next();
      return;
    }
    if (!roles.includes(principal.role)) {
      next(forbidden(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
