/**
 * Money helpers.
 *
 * Hard rules for this codebase:
 * 1. Money is stored as an **integer number of minor units** (santim for ETB)
 *    plus an ISO-4217 currency code. Floats are never used for money.
 * 2. All arithmetic keeps integers; anything that would introduce a fraction
 *    (percentages, splits, pro-rating) must specify an explicit rounding mode.
 * 3. Amounts are validated to stay inside the safe-integer range so that
 *    Postgres `bigint` and JavaScript `number` agree.
 */

export type CurrencyCode = string;

export interface Money {
  /** Integer amount in minor units, e.g. 125050 santim = 1,250.50 ETB. */
  amountMinor: number;
  /** ISO-4217 code, e.g. "ETB". */
  currency: CurrencyCode;
}

export type RoundingMode = 'half-up' | 'half-even' | 'floor' | 'ceil';

export interface CurrencyDefinition {
  code: CurrencyCode;
  /** Minor units per major unit: 100 for ETB (1 birr = 100 santim). */
  minorUnit: number;
  symbol: string;
  symbolAmharic?: string;
  /** Default fraction digits used for display. */
  decimals: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {
  ETB: { code: 'ETB', minorUnit: 100, symbol: 'Br', symbolAmharic: 'ብር', decimals: 2 },
  USD: { code: 'USD', minorUnit: 100, symbol: '$', decimals: 2 },
  EUR: { code: 'EUR', minorUnit: 100, symbol: '€', decimals: 2 },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'ETB';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function getCurrency(code: CurrencyCode): CurrencyDefinition {
  const currency = CURRENCIES[code.toUpperCase()];
  if (!currency) throw new MoneyError(`Unknown currency: ${code}`);
  return currency;
}

export function isSupportedCurrency(code: CurrencyCode): boolean {
  return Boolean(CURRENCIES[code.toUpperCase()]);
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units, received: ${value}`);
  }
  if (Math.abs(value) > MAX_SAFE_MINOR) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
}

export function money(amountMinor: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  assertInteger(amountMinor, 'amountMinor');
  return { amountMinor, currency: currency.toUpperCase() };
}

export function zeroMoney(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Cannot combine ${a.currency} with ${b.currency} without an exchange rate`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function sumMoney(amounts: readonly Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  let total = 0;
  for (const amount of amounts) {
    assertSameCurrency(amount, money(0, currency));
    total += amount.amountMinor;
  }
  return money(total, currency);
}

export function isZeroMoney(a: Money): boolean {
  return a.amountMinor === 0;
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

/**
 * Multiply by a factor (e.g. a tax rate) with an explicit rounding mode.
 *
 * Uses integer-scaled arithmetic: the factor is rounded to 9 decimal places first
 * so that `0.15` behaves exactly like 15% instead of drifting in binary floats.
 */
export function multiplyMoney(
  amount: Money,
  factor: number,
  options: { rounding?: RoundingMode } = {},
): Money {
  if (!Number.isFinite(factor)) throw new MoneyError(`Factor must be finite, received: ${factor}`);
  const { rounding = 'half-up' } = options;
  const scaled = Math.round(factor * 1e9);
  const product = amount.amountMinor * scaled;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('Multiplication result exceeds the safe integer range');
  }
  return money(divideRound(product, 1e9, rounding), amount.currency);
}

/** Apply a percentage with explicit rounding, e.g. VAT. */
export function applyPercent(
  amount: Money,
  percent: number,
  options: { rounding?: RoundingMode } = {},
): Money {
  return multiplyMoney(amount, percent / 100, options);
}

/** Integer division with a named rounding mode. */
export function divideRound(
  numerator: number,
  denominator: number,
  rounding: RoundingMode = 'half-up',
): number {
  if (denominator === 0) throw new MoneyError('Division by zero');
  const quotient = numerator / denominator;
  switch (rounding) {
    case 'floor':
      return Math.floor(quotient);
    case 'ceil':
      return Math.ceil(quotient);
    case 'half-even': {
      const floor = Math.floor(quotient);
      const diff = quotient - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      return Math.sign(quotient) * Math.round(Math.abs(quotient));
  }
}

/**
 * Split an amount into parts by weights without losing or inventing a santim
 * (largest-remainder method). Used for pro-rating rent between tenants or
 * splitting a utility bill between units.
 */
export function allocateMoney(amount: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError('Weights must be finite and non-negative');
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) throw new MoneyError('Total weight must be greater than zero');

  const base: number[] = [];
  let allocated = 0;
  for (const weight of weights) {
    const share = divideRound(amount.amountMinor * weight, totalWeight, 'floor');
    base.push(share);
    allocated += share;
  }

  let remainder = amount.amountMinor - allocated;
  const remainders = weights.map((weight, index) => {
    const exact = (amount.amountMinor * weight) / totalWeight;
    const fraction = exact - Math.floor(exact);
    return { index, fraction };
  });
  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const step = remainder >= 0 ? 1 : -1;
  let cursor = 0;
  while (remainder !== 0 && cursor < remainders.length * 2) {
    const target = remainders[cursor % remainders.length] as { index: number };
    base[target.index] = (base[target.index] as number) + step;
    remainder -= step;
    cursor += 1;
  }
  if (remainder !== 0) throw new MoneyError('Allocation failed to distribute the remainder');

  return base.map((value) => money(value, amount.currency));
}

/** Pro-rate an amount by a fraction of a period (0..1), rounded once. */
export function prorateMoney(
  amount: Money,
  fraction: number,
  options: { rounding?: RoundingMode } = {},
): Money {
  if (fraction < 0 || fraction > 1)
    throw new MoneyError(`Pro-ration fraction must be between 0 and 1: ${fraction}`);
  return multiplyMoney(amount, fraction, options);
}

export interface FormatMoneyOptions {
  /** `en`, `am`, `om`, `ti`. Amharic shows the birr symbol as ብር. */
  language?: 'en' | 'am' | 'om' | 'ti';
  /** Show the currency symbol/code. */
  showSymbol?: boolean;
  /** `symbol` (Br) or `code` (ETB). */
  symbolStyle?: 'symbol' | 'code';
  /** Override the number of decimals (defaults to the currency's). */
  decimals?: number;
  /** Use Western Arabic digits (default) or Geʽez numerals for the integer part. */
  useGrouping?: boolean;
}

/** Format minor units for display: `125050` ETB -> `"Br 1,250.50"`. */
export function formatMoney(amount: Money, options: FormatMoneyOptions = {}): string {
  const { language = 'en', showSymbol = true, symbolStyle = 'symbol', useGrouping = true } = options;
  const currency = getCurrency(amount.currency);
  const decimals = options.decimals ?? currency.decimals;
  const negative = amount.amountMinor < 0;
  const absolute = Math.abs(amount.amountMinor);
  const major = Math.trunc(absolute / currency.minorUnit);
  const minor = absolute % currency.minorUnit;

  const majorText = useGrouping
    ? new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 }).format(major)
    : String(major);
  const minorText = decimals > 0 ? `.${String(minor).padStart(decimals, '0').slice(0, decimals)}` : '';
  const numberText = `${negative ? '-' : ''}${majorText}${minorText}`;

  if (!showSymbol) return numberText;
  const label =
    symbolStyle === 'code'
      ? currency.code
      : language === 'am' && currency.symbolAmharic
        ? currency.symbolAmharic
        : currency.symbol;
  return `${label} ${numberText}`;
}

/**
 * Parse user input into minor units. Accepts `"1,250.50"`, `"1250.5"`, `"Br 1250"`,
 * `"1250,50"` (comma decimal separator, as used in some Amharic locales).
 * Throws rather than guessing when the input is ambiguous.
 */
export function parseMoneyInput(input: string, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  const definition = getCurrency(currency);
  const trimmed = input.trim().replace(/\s+/g, '');
  if (trimmed === '') throw new MoneyError('Empty amount');

  let normalized = trimmed.replace(/(?:br|ብር|etb|\$|€)/gi, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    // 1,250.50 -> dot is the decimal separator
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    normalized =
      lastComma > lastDot
        ? normalized.replace(/\./g, '').replace(',', '.') // 1.250,50
        : normalized.replace(/,/g, '');
  } else if (hasComma) {
    const decimalsAfterComma = normalized.length - normalized.lastIndexOf(',') - 1;
    normalized =
      decimalsAfterComma === 3 && !/^-?\d+,\d{1,2}$/.test(normalized)
        ? normalized.replace(/,/g, '') // 1,250 -> thousands separator
        : normalized.replace(',', '.');
  }

  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  if (!/^\d+(\.\d+)?$/.test(unsigned)) throw new MoneyError(`Cannot parse amount: "${input}"`);

  const [majorText, fractionText = ''] = unsigned.split('.') as [string, string?];
  const decimals = String(definition.minorUnit).length - 1;
  if (fractionText.length > decimals) {
    throw new MoneyError(`Too many decimal places for ${currency} (max ${decimals}): "${input}"`);
  }
  const major = Number(majorText);
  const fraction = Number(fractionText.padEnd(decimals, '0') || '0');
  if (!Number.isSafeInteger(major)) throw new MoneyError(`Amount is too large: "${input}"`);

  const value = major * definition.minorUnit + fraction;
  return money(negative ? -value : value, currency);
}

/** Major-unit decimal string without a symbol, e.g. `"1250.50"` for exports and CSV. */
export function toMajorUnitsString(amount: Money, decimals = 2): string {
  const currency = getCurrency(amount.currency);
  const sign = amount.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amount.amountMinor);
  const major = Math.trunc(absolute / currency.minorUnit);
  const minor = absolute % currency.minorUnit;
  // String math (not numbers) so no precision is lost for large amounts.
  return decimals === 0
    ? `${sign}${major}`
    : `${sign}${major}.${String(minor).padStart(decimals, '0').slice(0, decimals)}`;
}
