/**
 * Payment provider registry.
 *
 * `PAYMENT_PROVIDER` selects the active adapter. Unconfigured providers are still
 * instantiable (so `/ready` can report their state) but every call throws a clear
 * error instead of silently pretending to work.
 */

import { getConfig } from '../../config.js';
import { ChapaPaymentProvider } from './chapa.js';
import { MockPaymentProvider, mockPaymentProvider } from './mock.js';
import { TelebirrPaymentProvider } from './telebirr.js';
import type { PaymentProviderAdapter, ProviderName } from './types.js';

const registry: Record<ProviderName, () => PaymentProviderAdapter> = {
  mock: () => mockPaymentProvider,
  telebirr: () => new TelebirrPaymentProvider(),
  chapa: () => new ChapaPaymentProvider(),
};

export function getPaymentProvider(
  name: ProviderName = getConfig().PAYMENT_PROVIDER as ProviderName,
): PaymentProviderAdapter {
  const factory = registry[name];
  if (!factory) throw new Error(`Unknown payment provider: ${name}`);
  return factory();
}

export function listPaymentProviders(): { name: ProviderName; configured: boolean }[] {
  return (Object.keys(registry) as ProviderName[]).map((name) => ({
    name,
    configured: registry[name]().isConfigured(),
  }));
}

export { MockPaymentProvider, mockPaymentProvider };
export * from './types.js';
