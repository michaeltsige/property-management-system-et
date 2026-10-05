/**
 * Conversion between database money storage and the shared `Money` type.
 *
 * Postgres columns are `BigInt` (minor units). The domain uses JavaScript numbers,
 * which are only safe up to 2^53 santim (about 90 trillion birr) — far beyond any
 * property portfolio, but we still check rather than silently corrupt a balance.
 */

import { money, type Money } from '@pms/shared';

import { MoneyError } from '@pms/shared';

export function toMoney(amountMinor: bigint | null | undefined, currency: string): Money {
  if (amountMinor === null || amountMinor === undefined) return money(0, currency);
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER) || amountMinor < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`Amount ${amountMinor} exceeds the safe integer range for javascript arithmetic`);
  }
  return money(Number(amountMinor), currency);
}

export function toBigInt(amount: Money): bigint {
  return BigInt(amount.amountMinor);
}

/** Multiply a stored amount by a whole number of months (e.g. quarterly rent). */
export function timesMonths(amountMinor: bigint, months: number): bigint {
  if (!Number.isInteger(months) || months < 1) {
    throw new MoneyError(`Months must be a positive integer, received: ${months}`);
  }
  return amountMinor * BigInt(months);
}
