/**
 * Express application wiring.
 *
 * Ordering matters: security headers, CORS, body parsing, request context,
 * authentication, routes, then the 404 and error handlers last.
 */

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    export interface Request {
      /**
       * Raw body bytes, captured for every JSON request so signature-verified
       * webhooks (Chapa HMAC over the exact bytes) can re-hash what was signed.
       */
      rawBody?: Buffer;
    }
  }
}

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
        // No wildcard and no sandbox-host leftovers: origins are an allowlist.
        // (The old non-production e2b.app pattern is gone — dead weight that
        // silently trusted whatever *.e2b.app subdomain existed.)
        return callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-organization-id'],
      maxAge: 600,
    }),
  );

  // JSON bodies. Upload routes get a larger cap because their JSON transport
  // carries the file as base64 (a 10 MB file inflates to ~13.7 MB of base64);
  // they also accept multipart/form-data (see lib/multipart.ts), which skips
  // this parser entirely. Everything else keeps the tight 1 MB cap. The verify
  // hook keeps the raw bytes alongside the parsed body — webhook routes need
  // the exact bytes that were signed, not a re-serialization.
  const verifyRawBody = (request: express.Request, _response: express.Response, buffer: Buffer) => {
    request.rawBody = Buffer.from(buffer);
  };
  const uploadBodyParser = express.json({ limit: '20mb', verify: verifyRawBody });
  const bodyParser = express.json({ limit: '1mb', verify: verifyRawBody });
  const UPLOAD_PATHS = new Set(['/api/v1/documents', '/api/v1/portal/payment-proofs']);
  app.use((req, res, next) => {
    if (UPLOAD_PATHS.has(req.path)) return uploadBodyParser(req, res, next);
    return bodyParser(req, res, next);
  });

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
