/**
 * Auth routes.
 *
 * Rate limited hard: these are the only unauthenticated endpoints that touch the
 * database, and the brief requires rate limiting on auth.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  acceptInviteSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@pms/shared';

import { getConfig } from '../config.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/context.js';
import {
  acceptInvite,
  forgotPassword,
  login,
  logout,
  refresh,
  registerOrganization,
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../services/auth.service.js';

const config = getConfig();

export const authRateLimiter = createRateLimiter({
  windowMs: config.RATE_LIMIT_AUTH_WINDOW_MS,
  max: config.RATE_LIMIT_AUTH_MAX,
  message: 'Too many authentication attempts. Please try again later.',
});

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const result = await registerOrganization(req.body, {
      requestId: req.requestId,
      ip: req.ip ?? undefined,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const result = await login(req.body, {
      requestId: req.requestId,
      ip: req.ip ?? undefined,
      userAgent: req.header('user-agent') ?? undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  '/refresh',
  authRateLimiter,
  validate({ body: refreshTokenSchema }),
  async (req, res, next) => {
    try {
      const tokens = await refresh(req.body.refreshToken, {
        requestId: req.requestId,
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      });
      res.json({ tokens });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Redeem a staff invitation: single-use token → password set, membership active.
 * Unauthenticated by design — the token IS the credential — but rate limited
 * like every other auth endpoint.
 */
authRouter.post(
  '/accept-invite',
  authRateLimiter,
  validate({ body: acceptInviteSchema }),
  async (req, res, next) => {
    try {
      const result = await acceptInvite(req.body, {
        requestId: req.requestId,
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Email verification. Redeeming the code mints the first session, so the web
 * session layer proxies this — tokens never reach the browser directly.
 */
authRouter.post(
  '/verify-email',
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  async (req, res, next) => {
    try {
      const result = await verifyEmail(req.body, {
        requestId: req.requestId,
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Ask for a fresh verification code. Always `ok` — never reveals account existence. */
authRouter.post(
  '/resend-verification',
  authRateLimiter,
  validate({ body: resendVerificationSchema }),
  async (req, res, next) => {
    try {
      res.json(await resendVerification(req.body));
    } catch (error) {
      next(error);
    }
  },
);

/** Ask for a password-reset code. Always `ok` — never reveals account existence. */
authRouter.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  async (req, res, next) => {
    try {
      res.json(await forgotPassword(req.body));
    } catch (error) {
      next(error);
    }
  },
);

/** Trade the emailed code for a new password; every live session is revoked. */
authRouter.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  async (req, res, next) => {
    try {
      const result = await resetPassword(req.body, {
        requestId: req.requestId,
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/logout',
  requireAuth,
  validate({ body: z.object({ refreshToken: z.string().optional() }) }),
  async (req, res, next) => {
    try {
      await logout(req.body.refreshToken, req.auth?.userId ?? '', req.auth?.organizationId ?? '');
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/** Current principal: the web app uses this to render the right navigation. */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.auth });
});
