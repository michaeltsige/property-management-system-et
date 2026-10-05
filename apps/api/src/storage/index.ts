/**
 * File storage abstraction.
 *
 * Phase 1 ships the local-disk driver (a real implementation, not a stub); an
 * S3-compatible driver is added later without touching call sites. Uploads are
 * validated for type and size before they are written, filenames are never taken
 * from user input, and files are stored under an organization-scoped path.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { ALLOWED_UPLOAD_MIME_TYPES, DEFAULT_MAX_UPLOAD_BYTES } from '@pms/shared';

import { getConfig } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';

export interface StoredFile {
  driver: 'local' | 's3';
  key: string;
  sizeBytes: number;
  mimeType: string;
  checksumSha256: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  save(params: {
    organizationId: string;
    filename: string;
    mimeType: string;
    data: Buffer | Readable;
    maxBytes?: number;
  }): Promise<StoredFile>;
  read(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const ALLOWED_MIME_TYPES = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);

export function assertUploadAllowed(mimeType: string, sizeBytes?: number, maxBytes = DEFAULT_MAX_UPLOAD_BYTES): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw badRequest(`Unsupported file type: ${mimeType}`);
  }
  if (sizeBytes !== undefined && sizeBytes > maxBytes) {
    throw badRequest(`File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  }
}

/** Never trust a user-supplied filename: keep only a safe extension. */
export function safeExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : '';
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;

  constructor(private readonly rootDir: string = getConfig().STORAGE_LOCAL_DIR) {}

  private resolveKey(key: string): string {
    const absoluteRoot = path.resolve(this.rootDir);
    const absolute = path.resolve(absoluteRoot, key);
    // Defence against `../` traversal in a key that came from the database or a URL.
    if (!absolute.startsWith(absoluteRoot + path.sep)) {
      throw badRequest('Invalid storage key');
    }
    return absolute;
  }

  async save(params: {
    organizationId: string;
    filename: string;
    mimeType: string;
    data: Buffer | Readable;
    maxBytes?: number;
  }): Promise<StoredFile> {
    const maxBytes = params.maxBytes ?? getConfig().MAX_UPLOAD_BYTES;
    const buffer = Buffer.isBuffer(params.data) ? params.data : await streamToBuffer(params.data, maxBytes);
    assertUploadAllowed(params.mimeType, buffer.byteLength, maxBytes);

    const key = path.join(
      params.organizationId,
      new Date().toISOString().slice(0, 10),
      `${randomUUID()}${safeExtension(params.filename)}`,
    );
    const absolute = this.resolveKey(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    return {
      driver: 'local',
      key,
      sizeBytes: buffer.byteLength,
      mimeType: params.mimeType,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw notFound('File not found');
    }
  }

  async stream(key: string): Promise<Readable> {
    const absolute = this.resolveKey(key);
    try {
      await stat(absolute);
    } catch {
      throw notFound('File not found');
    }
    return createReadStream(absolute);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch {
      // Deleting a missing file is not an error: the desired end state is reached.
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** S3-compatible driver placeholder; see docs/DECISIONS.md (ADR-0006). */
export function createS3StorageDriver(): StorageDriver {
  throw new Error(
    'The S3-compatible storage driver is not implemented yet. Set STORAGE_DRIVER=local, ' +
      'or implement it in apps/api/src/storage/s3.ts and record the decision in docs/DECISIONS.md.',
  );
}

export function getStorageDriver(): StorageDriver {
  const config = getConfig();
  if (config.STORAGE_DRIVER === 's3') return createS3StorageDriver();
  return new LocalStorageDriver(config.STORAGE_LOCAL_DIR);
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maxBytes) throw badRequest(`File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Used by the document route to write a stream to disk with backpressure. */
export async function saveStreamToFile(
  destination: string,
  source: Readable,
): Promise<{ sizeBytes: number; checksumSha256: string }> {
  await mkdir(path.dirname(destination), { recursive: true });
  const hash = createHash('sha256');
  source.on('data', (chunk) => hash.update(chunk));
  await pipeline(source, createWriteStream(destination));
  const stats = await stat(destination);
  return { sizeBytes: stats.size, checksumSha256: hash.digest('hex') };
}
