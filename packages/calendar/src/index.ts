/**
 * @pms/calendar — Ethiopian ↔ Gregorian calendar support for the property
 * management system.
 *
 * Rules:
 * 1. The database stores UTC/Gregorian instants; conversion happens here, at the
 *    input/output boundary.
 * 2. A lease's `billing_calendar` decides how months, periods and due dates are
 *    generated (the Ethiopian calendar has 12×30 days + Pagume).
 * 3. Nothing in the app may hand-roll date math — everything goes through this
 *    package, which is unit tested against ICU as an independent oracle.
 */

export * from './types.js';
export * from './jdn.js';
export * from './ethiopian.js';
export * from './civil.js';
export * from './periods.js';
export * from './format.js';
