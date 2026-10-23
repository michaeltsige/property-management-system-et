/**
 * Multipart/form-data upload parsing (busboy).
 *
 * JSON-with-base64 stays the primary upload transport for the web app (it
 * rides the same-origin proxy unchanged), but phones and future native clients
 * benefit from a real multipart path: no base64 inflation (+33%), streaming
 * field parsing, and a body shape every HTTP client can produce. Handlers
 * accept BOTH: `multipart/form-data` is detected by content type, anything
 * else goes through the JSON schemas as before.
 *
 * Size limits: busboy enforces the per-file byte cap while streaming, so a
 * malicious client cannot park 20 MB in RAM through this path.
 */

import Busboy from 'busboy';

import { badRequest } from './errors.js';

export interface MultipartFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

export function isMultipartRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/form-data');
}

/** Parse one multipart request: simple text fields plus a single file field. */
export function parseMultipartUpload(
  req: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> },
  options: { fieldName?: string; maxBytes: number },
): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    let busboy: Busboy.Busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: options.maxBytes, files: 1, fields: 40, fieldSize: 64 * 1024 },
      });
    } catch {
      reject(badRequest('Malformed multipart request'));
      return;
    }

    const fields: Record<string, string> = {};
    let file: MultipartFile | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ fields, file });
    };

    busboy.on('field', (name, value) => {
      if (fields[name] === undefined) fields[name] = value;
    });

    busboy.on('file', (name, stream, info) => {
      if (name !== (options.fieldName ?? 'file')) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        settled = true;
        reject(badRequest(`File is larger than the ${Math.round(options.maxBytes / 1024 / 1024)} MB limit`));
      });
      stream.on('end', () => {
        file = {
          filename: info.filename ?? 'upload',
          mimeType: info.mimeType ?? 'application/octet-stream',
          data: Buffer.concat(chunks),
        };
      });
    });

    busboy.on('error', (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(badRequest('Malformed multipart request', { cause: String(error) }));
      }
    });
    busboy.on('close', finish);
    busboy.on('finish', finish);

    // Feed the request into the parser; errors on the incoming stream (client
    // disconnect) end the parse with whatever is legal so far.
    req.pipe(busboy);
  });
}
