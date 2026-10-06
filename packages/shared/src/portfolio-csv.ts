import { createTenantSchema, createUnitSchema, languageSchema, uuidSchema } from './schemas.js';
import { z } from 'zod';
export const CSV_HEADERS = {
  units: ['label', 'floor', 'bedrooms', 'bathrooms', 'marketRentMinor'],
  tenants: ['fullName', 'phone', 'email', 'language', 'emergencyContactName', 'emergencyContactPhone'],
} as const;
export type ImportKind = keyof typeof CSV_HEADERS;
export interface ImportError {
  row: number;
  field: string;
  message: string;
}
export interface ImportReport {
  valid: boolean;
  count: number;
  imported: number;
  replayed?: boolean;
  errors: ImportError[];
}
export const importRequestSchema = z
  .object({
    csv: z.string().min(1).max(262144),
    dryRun: z.boolean().default(true),
    propertyId: uuidSchema.optional(),
    buildingId: uuidSchema.nullable().optional(),
  })
  .strict();

/** Strict bounded RFC-style records. Row numbers are logical records, not physical lines. */
export function parsePortfolioCsv(input: string): string[][] {
  if (input.length > 262144) throw new Error('CSV exceeds 256 KiB text limit');
  const s = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'plain' | 'quoted' | 'closed' = 'plain';
  function cell() {
    row.push(field);
    field = '';
    state = 'plain';
    if (row.length > 10) throw new Error('Too many columns');
  }
  function record() {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > 201) throw new Error('Maximum 200 data rows');
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (state === 'quoted') {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else state = 'closed';
      } else field += c;
    } else if (c === ',') cell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      record();
    } else if (state === 'closed') throw new Error('Unexpected text after closing quote');
    else if (c === '"') {
      if (field) throw new Error('Quote inside unquoted field');
      state = 'quoted';
    } else field += c;
  }
  if (state === 'quoted') throw new Error('Unclosed quoted field');
  if (field || row.length || state === 'closed') record();
  return rows;
}
const integer = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const floor = z
  .string()
  .regex(/^-?\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(-5).max(200));
export const csvUnitSchema = createUnitSchema
  .pick({ label: true })
  .extend({
    floor: floor.optional(),
    bedrooms: integer.pipe(z.number().max(50)).optional(),
    bathrooms: integer.pipe(z.number().max(50)).optional(),
    marketRentMinor: integer.optional(),
  })
  .strict();
export const csvTenantSchema = createTenantSchema
  .pick({ fullName: true, phone: true, email: true, emergencyContactName: true, emergencyContactPhone: true })
  .extend({ language: languageSchema.optional() })
  .strict();

/** Spreadsheet formula-safe export; reports never include source cell values. */
export function importErrorsCsv(errors: ImportError[]): string {
  const cell = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  return (
    'row,field,message\r\n' +
    errors.map((e) => [String(e.row), e.field, e.message].map(cell).join(',')).join('\r\n')
  );
}
