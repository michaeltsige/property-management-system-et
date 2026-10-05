import { describe, expect, it } from 'vitest';

import {
  addMoney,
  allocateMoney,
  applyPercent,
  compareMoney,
  formatMoney,
  getCurrency,
  isSupportedCurrency,
  MoneyError,
  money,
  multiplyMoney,
  parseMoneyInput,
  prorateMoney,
  subtractMoney,
  sumMoney,
  toMajorUnitsString,
} from './money.js';

describe('money construction', () => {
  it('requires integer minor units', () => {
    expect(money(125050).amountMinor).toBe(125050);
    expect(() => money(12.5)).toThrow(MoneyError);
  });

  it('uppercases the currency code and knows its minor unit', () => {
    expect(money(100, 'etb').currency).toBe('ETB');
    expect(getCurrency('ETB').minorUnit).toBe(100);
    expect(isSupportedCurrency('etb')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(() => getCurrency('XYZ')).toThrow(MoneyError);
  });

  it('refuses amounts outside the safe integer range', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 10)).toThrow(/safe integer/);
  });

  it('protects against mixing currencies', () => {
    expect(addMoney(money(100, 'ETB'), money(250, 'ETB')).amountMinor).toBe(350);
    expect(() => addMoney(money(100, 'ETB'), money(100, 'USD'))).toThrow(/exchange rate/);
    expect(() => sumMoney([money(100, 'ETB'), money(100, 'USD')], 'ETB')).toThrow(/exchange rate/);
  });

  it('adds, subtracts, sums and compares without floats', () => {
    expect(subtractMoney(money(1000), money(250)).amountMinor).toBe(750);
    expect(sumMoney([money(1), money(2), money(3)]).amountMinor).toBe(6);
    expect(compareMoney(money(5), money(7))).toBeLessThan(0);
  });
});

describe('percentages and rounding', () => {
  it('applies a percentage with an explicit rounding mode', () => {
    // 15% VAT on Br 1,250.50 = 18757.5 santim
    expect(applyPercent(money(125050), 15).amountMinor).toBe(18758); // half-up (default)
    expect(applyPercent(money(125050), 15, { rounding: 'floor' }).amountMinor).toBe(18757);
    expect(applyPercent(money(125050), 15, { rounding: 'ceil' }).amountMinor).toBe(18758);
  });

  it('is not fooled by binary floating point', () => {
    // 0.1 + 0.2 style drift must not appear in money math
    const tenth = multiplyMoney(money(1000), 0.1);
    expect(tenth.amountMinor).toBe(100);
    expect(sumMoney([tenth, multiplyMoney(money(1000), 0.2)]).amountMinor).toBe(300);
  });

  it('uses banker\u2019s rounding when asked', () => {
    // 2.5 -> 2 and 3.5 -> 4 under half-even
    expect(multiplyMoney(money(25), 0.1, { rounding: 'half-even' }).amountMinor).toBe(2);
    expect(multiplyMoney(money(35), 0.1, { rounding: 'half-even' }).amountMinor).toBe(4);
  });

  it('guards against nonsense factors', () => {
    expect(() => multiplyMoney(money(100), Number.NaN)).toThrow(MoneyError);
    expect(() => multiplyMoney(money(100), Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('allocation and pro-ration (no lost santim)', () => {
  it('splits an amount into parts that add back to the original', () => {
    const parts = allocateMoney(money(10000), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(sumMoney(parts).amountMinor).toBe(10000);
  });

  it('splits by weight, largest remainder last', () => {
    const parts = allocateMoney(money(1000), [1, 2, 3]);
    expect(parts.map((p) => p.amountMinor)).toEqual([167, 333, 500]);
    expect(sumMoney(parts).amountMinor).toBe(1000);
  });

  it('never invents or loses santim for awkward numbers', () => {
    for (const total of [1, 7, 999, 123457]) {
      for (const weights of [
        [1, 1, 1],
        [1, 2, 3],
        [5, 5, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ]) {
        const parts = allocateMoney(money(total), weights);
        expect(sumMoney(parts).amountMinor).toBe(total);
      }
    }
  });

  it('rejects impossible allocations', () => {
    expect(allocateMoney(money(1000), [])).toEqual([]);
    expect(() => allocateMoney(money(1000), [0, 0])).toThrow(/Total weight/);
    expect(() => allocateMoney(money(1000), [1, -1])).toThrow(/non-negative/);
  });

  it('pro-rates by a fraction of a period', () => {
    // Half a month of Br 5,000 rent
    expect(prorateMoney(money(500000), 0.5).amountMinor).toBe(250000);
    // 1/3 of Br 1,000 is 33333.33… -> rounded once, not accumulated
    expect(prorateMoney(money(100000), 1 / 3).amountMinor).toBe(33333);
    expect(() => prorateMoney(money(100000), 1.5)).toThrow(/between 0 and 1/);
  });
});

describe('formatting', () => {
  it('formats ETB with the birr symbol and two decimals', () => {
    expect(formatMoney(money(125050))).toBe('Br 1,250.50');
    expect(formatMoney(money(0))).toBe('Br 0.00');
    expect(formatMoney(money(-125050))).toBe('Br -1,250.50');
    expect(formatMoney(money(125050), { language: 'am' })).toBe('ብር 1,250.50');
    expect(formatMoney(money(125050), { symbolStyle: 'code' })).toBe('ETB 1,250.50');
    expect(formatMoney(money(125050), { showSymbol: false })).toBe('1,250.50');
  });

  it('exports major units as a plain decimal string', () => {
    expect(toMajorUnitsString(money(125050))).toBe('1250.50');
    expect(toMajorUnitsString(money(5))).toBe('0.05');
    expect(toMajorUnitsString(money(-5))).toBe('-0.05');
  });
});

describe('parsing user input', () => {
  it('accepts the formats Ethiopian staff actually type', () => {
    expect(parseMoneyInput('1,250.50').amountMinor).toBe(125050);
    expect(parseMoneyInput('1250.5').amountMinor).toBe(125050);
    expect(parseMoneyInput('1250').amountMinor).toBe(125000);
    expect(parseMoneyInput('Br 1250').amountMinor).toBe(125000);
    expect(parseMoneyInput('1.250,50').amountMinor).toBe(125050);
    expect(parseMoneyInput(' 1 250.50 ').amountMinor).toBe(125050);
    expect(parseMoneyInput('1250,50').amountMinor).toBe(125050);
  });

  it('round-trips through formatting', () => {
    for (const value of [1, 99, 100, 125050, 999999]) {
      expect(parseMoneyInput(formatMoney(money(value), { showSymbol: false })).amountMinor).toBe(value);
    }
  });

  it('rejects ambiguous or over-precise input instead of guessing', () => {
    expect(() => parseMoneyInput('12.345')).toThrow(/Too many decimal places/);
    expect(() => parseMoneyInput('')).toThrow(/Empty amount/);
    expect(() => parseMoneyInput('abc')).toThrow(/Cannot parse/);
    expect(() => parseMoneyInput('1..2')).toThrow(/Cannot parse/);
  });
});
