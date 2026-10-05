/**
 * Access-token verification.
 *
 * The access token is a short-lived JWT (HS256, `jose`) carrying the user, the
 * organization in scope and the role. Nothing is trusted from the token beyond
 * identity: the membership is re-read from the database on each request so that
 * disabling a user or changing a role takes effect immediately, and so that a
 * deactivated organization stops working at once.
 */

import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';

import { permissionsForRole, type AuthPrincipal, type LanguageCode, type Role } from '@pms/shared';
import type { CalendarKind } from '@pms/calendar';

import { getConfig } from '../config.js';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { getPrisma } from '../lib/prisma.js';

export interface AccessTokenClaims {
  sub: string;
  org: string;
  role: Role;
  email: string;
  /** Platform operator flag; still re-checked against the database. */
  platform?: boolean;
}

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(getConfig().JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const config = getConfig();
  return new SignJWT({ org: claims.org, role: claims.role, email: claims.email, platform: claims.platform })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('pms-et')
    .setAudience('pms-et-api')
    .setExpirationTime(`${config.JWT_ACCESS_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret(), {
      issuer: 'pms-et',
      audience: 'pms-et-api',
    });
    if (!payload.sub || typeof payload.org !== 'string' || typeof payload.role !== 'string') return null;
    return {
      sub: payload.sub,
      org: payload.org,
      role: payload.role as Role,
      email: String(payload.email ?? ''),
      platform: payload.platform === true,
    };
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

/**
 * Populates `req.auth` when a valid token is present. Never rejects on its own —
 * routes decide whether anonymous access is acceptable (`requireAuth`).
 */
export async function attachPrincipal(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    next();
    return;
  }
  const claims = await verifyAccessToken(token);
  if (!claims) {
    next();
    return;
  }

  try {
    const prisma = getPrisma();
    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: claims.org, userId: claims.sub } },
      include: { organization: true, user: true },
    });

    if (!membership || membership.status !== 'active') {
      next(unauthenticated('Your access to this organization is not active'));
      return;
    }
    if (membership.organization.status !== 'active' || membership.organization.deletedAt) {
      next(forbidden('This organization is not active'));
      return;
    }
    if (!membership.user.isActive) {
      next(unauthenticated('This account has been disabled'));
      return;
    }

    const role = membership.role as Role;
    const principal: AuthPrincipal = {
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      organizationId: membership.organizationId,
      role,
      permissions: permissionsForRole(role),
      isPlatformAdmin: membership.user.isPlatformAdmin,
      calendar: (membership.user.calendar ?? membership.organization.calendar) as CalendarKind,
      language: membership.user.language as LanguageCode,
    };
    req.auth = principal;
    next();
  } catch (error) {
    next(error);
  }
}
