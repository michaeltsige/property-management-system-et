/**
 * Express application wiring.
 *
 * Ordering matters: security headers, CORS, body parsing, request context,
 * authentication, routes, then the 404 and error handlers last.
 */

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { getConfig } from './config.js';
import { logger } from './lib/logger.js';
import { attachPrincipal } from './middleware/auth.js';
import { requestContext, logRequestCompletion } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.js';

export function createApp(): Express {
  const config = getConfig();
  const app = express();

  // Behind a reverse proxy in production; needed for correct client IPs in rate limits.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests have no Origin header.
        if (!origin) return callback(null, true);
        if (config.CORS_ORIGINS.includes(origin)) return callback(null, true);
        // The hosted preview proxies the app under a per-port host; allow those
        // origins so the preview works, but never wildcard in production.
        if (!config.isProduction && /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-organization-id'],
      maxAge: 600,
    }),
  );

  // JSON only: uploads use the storage layer, not multipart bodies.
  app.use(express.json({ limit: '1mb' }));

  // Money columns are BigInt (integer minor units) because ETB amounts in santim
  // can exceed quietly-lossy float ranges, and JSON.stringify cannot represent
  // BigInt at all. This single setting is the wire format for money: a decimal
  // string ("125000"). The web client parses it with `@pms/shared`'s helpers.
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  app.use(requestContext);
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => logRequestCompletion(req, res, startedAt));
    next();
  });

  app.use(attachPrincipal);

  // Health is available both at the root (for infrastructure probes) and under the
  // versioned prefix (for the web app).
  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (config.isDevelopment) {
    logger.debug('express app configured (development)');
  }

  return app;
}
