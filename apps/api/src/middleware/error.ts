/**
 * Central error handling: one place that decides what a client sees.
 */

import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import type { ApiErrorBody } from '@pms/shared';

import { AppError, isAppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound('Route not found'));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = normalize(error, req);

  if (appError.status >= 500) {
    logger.error({ err: error, requestId: req.requestId }, 'unhandled error');
  } else {
    logger.warn(
      { code: appError.code, message: appError.message, requestId: req.requestId },
      'request failed',
    );
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.requestId,
      ...(appError.details?.fields ? { details: appError.details.fields } : {}),
    },
  };

  res.status(appError.status).json(body);
}

function normalize(error: unknown, req: Request): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', {
      details: {
        fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
      userMessageKey: 'error.validation',
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta?.target as string[]).join(', ')
          : 'record';
        return new AppError(409, 'CONFLICT', `A record with the same ${target} already exists`);
      }
      case 'P2003':
        return new AppError(409, 'CONFLICT', 'Related record is missing or still referenced');
      case 'P2025':
        return notFound('Record not found');
      default:
        return new AppError(500, 'INTERNAL_ERROR', 'Database error');
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Never leak the query: it may contain column values.
    logger.error({ err: error, requestId: req.requestId }, 'prisma validation error');
    return new AppError(500, 'INTERNAL_ERROR', 'Database validation error');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Unexpected error');
}
