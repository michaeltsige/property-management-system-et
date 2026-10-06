import { describe, expect, it } from 'vitest';
import { parsePortfolioCsv, importErrorsCsv, csvTenantSchema, csvUnitSchema } from './portfolio-csv.js';
describe('bounded strict portfolio CSV', () => {
  it('handles BOM, CRLF, quoted commas/newlines and escaped quotes', () => {
    expect(parsePortfolioCsv('\uFEFFname,note\r\n"Abebe, A","line\n""two"""\r\n')).toEqual([
      ['name', 'note'],
      ['Abebe, A', 'line\n"two"'],
    ]);
  });
  it.each(['a\n"unfinished', 'a\na"b', 'a\n"b"x'])('rejects malformed quotes %s', (csv) =>
    expect(() => parsePortfolioCsv(csv)).toThrow(),
  );
  it('enforces bounded input and row count', () => {
    expect(() => parsePortfolioCsv('x'.repeat(262145))).toThrow();
    expect(() => parsePortfolioCsv('h\n' + 'a\n'.repeat(201))).toThrow();
  });
  it('normalizes phones, rejects unsafe minor amounts and blocks ID columns', () => {
    expect(csvTenantSchema.parse({ fullName: 'Demo Tenant', phone: '0911234567' }).phone).toBe(
      '+251911234567',
    );
    expect(csvTenantSchema.safeParse({ fullName: 'Demo', idNumber: 'sensitive' }).success).toBe(false);
    for (const v of ['1.50', '1e3', '-1', '9007199254740992'])
      expect(csvUnitSchema.safeParse({ label: '1', marketRentMinor: v }).success).toBe(false);
  });
  it('neutralizes spreadsheet formulas and quotes report text', () => {
    expect(importErrorsCsv([{ row: 2, field: '=SUM(A1)', message: 'line, "quoted"' }])).toContain(
      '"\'=SUM(A1)"',
    );
    expect(importErrorsCsv([{ row: 2, field: 'x', message: 'line, "quoted"' }])).toContain(
      '"line, ""quoted"""',
    );
  });
});
