/**
 * Structured logging with pino.
 *
 * Never log secrets, tokens, passwords or ID numbers. The redaction list below is
 * a safety net, not a licence to log sensitive fields: build the object correctly.
 */

import pino from 'pino';

import { getConfig } from '../config.js';

export const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'token',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'numberEncrypted',
  'idNumber',
  'req.body.password',
  'req.body.refreshToken',
  '*.password',
  '*.refreshToken',
];

export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'pms-api', env: getConfig().NODE_ENV },
  transport: getConfig().isDevelopment ? { target: 'pino/file', options: { destination: 1 } } : undefined,
});

export type Logger = typeof logger;
