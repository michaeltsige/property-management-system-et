/**
 * @pms/i18n — translation catalogs, ICU formatting, database overrides and the
 * tooling behind the admin Translation Manager.
 *
 * Lookup order: organization override -> shipped locale file -> English fallback.
 * Machine-generated text is never presented as reviewed.
 */

export * from './keys.js';
export * from './resolve.js';
export * from './csv.js';
export * from './lint.js';
export { AM_CATALOG } from './catalogs/am.js';
export { OM_CATALOG } from './catalogs/om.js';
export { TI_CATALOG } from './catalogs/ti.js';
