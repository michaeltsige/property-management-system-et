/**
 * Rate limiting.
 *
 * Auth endpoints are the only unauthenticated paths that touch the database, so
 * they are limited per IP. The limiter is built by a factory rather than created
 * inline, because tests need to construct one with a tiny limit to prove the
 * behaviour without waiting 15 minutes.
 */

import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { getConfig } from '../config.js';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: options.message ?? 'Too many requests. Please try again later.',
      },
    },
  });
}

/**
 * The whole-API per-IP budget. Disabled under test so a suite that fires
 * hundreds of requests through one app instance never trips it — the auth and
 * OTP limiters stay active because several tests exercise them deliberately.
 */
export function apiRateLimiter(): RequestHandler {
  const config = getConfig();
  if (config.isTest) return (_req, _res, next) => next();
  return createRateLimiter({
    windowMs: config.RATE_LIMIT_API_WINDOW_MS,
    max: config.RATE_LIMIT_API_MAX,
    message: 'Too many requests from this address. Please slow down.',
  });
}
