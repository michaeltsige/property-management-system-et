/**
 * Helpers for reading Express query values safely.
 *
 * Express types `req.query` as `string | string[] | ParsedQs | ...`; after Zod
 * validation the values are already normalised, but TypeScript cannot know that, so
 * routes read them through these helpers instead of sprinkling casts.
 */

export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function num(value: unknown, fallback: number): number {
  const raw = str(value);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bool(value: unknown, fallback = false): boolean {
  const raw = str(value);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * Path parameter as a string.
 *
 * Express 5 types path parameters loosely, and `validate()` has already parsed
 * them, so this narrows the type and fails loudly if a route was wired without it.
 */
export function pstr(req: { params: Record<string, unknown> }, name: string): string {
  const value = req.params[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw new Error(`Missing path parameter "${name}" — did the route forget validate()?`);
}
