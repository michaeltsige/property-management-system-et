/**
 * SMS provider interface.
 *
 * Templates are translation keys resolved through `@pms/i18n` in the recipient's
 * own language, so an Amharic-speaking tenant gets Amharic SMS while the manager's
 * UI stays in English. Every message is logged to the `Notification` table with its
 * status, so the queue is visible even when the provider is a mock.
 */

import { createTranslator, type TranslationKey, type TranslationOverride } from '@pms/i18n';
import type { LanguageCode } from '@pms/calendar';

import { getConfig } from '../../config.js';
import { logger } from '../../lib/logger.js';

export interface SmsMessage {
  to: string;
  /** Translation key, not literal text: the text is resolved per recipient language. */
  templateKey: TranslationKey;
  values?: Record<string, string | number>;
  language: LanguageCode;
  overrides?: readonly TranslationOverride[];
}

export interface SmsSendResult {
  providerRef: string;
  status: 'sent' | 'failed' | 'queued';
  detail?: string;
}

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/** Render the final text for a message (kept separate so it can be unit tested). */
export function renderSmsBody(message: SmsMessage): string {
  const translator = createTranslator({ language: message.language, overrides: message.overrides ?? [] });
  return translator.t(message.templateKey, message.values ?? {});
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly outbox: { to: string; body: string; language: LanguageCode; at: Date }[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const body = renderSmsBody(message);
    this.outbox.push({ to: message.to, body, language: message.language, at: new Date() });
    if (getConfig().isDevelopment) {
      // Demo affordance: in dev there is no real phone, so the code must be
      // readable somewhere. Production never logs message bodies.
      logger.info({ to: message.to, body }, 'DEV demo: mock SMS body');
    } else {
      logger.info(
        { to: message.to, language: message.language, template: message.templateKey },
        'mock SMS captured (body not logged: it may contain personal data)',
      );
    }
    return { providerRef: `MOCK-SMS-${this.outbox.length}`, status: 'sent' };
  }
}

/**
 * Ethio Telecom SMS gateway adapter — NOT IMPLEMENTED.
 *
 * Sending SMS from an Ethiopian system requires an approved sender name/short code
 * issued by Ethio Telecom (or a licensed aggregator), plus their documented HTTP
 * interface. We do not invent endpoint paths or payload fields.
 *
 * TODO(notifications): implement against the official interface once the account,
 * sender name and documentation are available; keep the mock for development.
 */
export class EthioTelecomSmsProvider implements SmsProvider {
  readonly name = 'ethio-telecom-sms';

  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.SMS_API_URL && config.SMS_API_KEY && config.SMS_SENDER_NAME);
  }

  async send(_message: SmsMessage): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return {
        providerRef: 'not-sent',
        status: 'failed',
        detail: 'SMS_API_URL, SMS_API_KEY and SMS_SENDER_NAME are required',
      };
    }
    throw new Error(
      'Ethio Telecom SMS adapter is not implemented: the official interface contract is required ' +
        '(see docs/REFERENCES.md). Use SMS_PROVIDER=mock until then.',
    );
  }
}

export const mockSmsProvider = new MockSmsProvider();

export function getSmsProvider(): SmsProvider {
  const config = getConfig();
  return config.SMS_PROVIDER === 'ethio-telecom-sms' ? new EthioTelecomSmsProvider() : mockSmsProvider;
}
