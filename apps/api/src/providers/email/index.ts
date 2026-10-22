/**
 * Email provider interface.
 *
 * Mirrors the SMS provider: the mock keeps development honest (bodies are logged
 * in dev and every send is recorded on the Notification row), Resend covers real
 * delivery on its free tier (3,000 emails/month, 100/day). There is no per-org
 * SMTP configuration yet — one provider serves the whole deployment, like SMS.
 */

import { createTranslator, type TranslationKey, type TranslationOverride } from '@pms/i18n';
import type { LanguageCode } from '@pms/calendar';

import { getConfig } from '../../config.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string;
  /** Translation key, not literal text: the text is resolved per recipient language. */
  templateKey: TranslationKey;
  values?: Record<string, string | number>;
  language: LanguageCode;
  overrides?: readonly TranslationOverride[];
}

export interface EmailSendResult {
  providerRef: string;
  status: 'sent' | 'failed' | 'queued';
  detail?: string;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Render the final text for a message (kept separate so it can be unit tested). */
export function renderEmailBody(message: EmailMessage): string {
  const translator = createTranslator({ language: message.language, overrides: message.overrides ?? [] });
  return translator.t(message.templateKey, message.values ?? {});
}

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly outbox: { to: string; subject: string; body: string; language: LanguageCode; at: Date }[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const body = renderEmailBody(message);
    this.outbox.push({ to: message.to, subject: body, body, language: message.language, at: new Date() });
    if (getConfig().isDevelopment) {
      // Demo affordance: in dev there is no real inbox, so the message must be
      // readable somewhere. Production never logs message bodies.
      logger.info({ to: message.to, body }, 'DEV demo: mock email body');
    } else {
      logger.info(
        { to: message.to, language: message.language, template: message.templateKey },
        'mock email captured (body not logged: it may contain personal data)',
      );
    }
    return { providerRef: `MOCK-EMAIL-${this.outbox.length}`, status: 'sent' };
  }
}

/**
 * Resend (https://resend.com) HTTP API adapter.
 *
 * The free tier (3,000 emails/month, 100/day) is enough for a first building's
 * transactional mail. The shared `onboarding@resend.dev` sender only delivers to
 * the Resend account owner's own address; set EMAIL_FROM and verify a domain in
 * the Resend dashboard to reach tenants.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  // The official API base URL; overridable so tests can point at a stub server.
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://api.resend.com') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return Boolean(getConfig().RESEND_API_KEY);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const config = getConfig();
    if (!config.RESEND_API_KEY) {
      return {
        providerRef: 'not-sent',
        status: 'failed',
        detail: 'RESEND_API_KEY is required (set EMAIL_PROVIDER=resend and add the key)',
      };
    }

    const body = renderEmailBody(message);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.EMAIL_FROM,
          to: [message.to],
          subject: body,
          text: body,
        }),
      });
    } catch (error) {
      return { providerRef: 'not-sent', status: 'failed', detail: `Resend request failed: ${String(error)}` };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        providerRef: 'not-sent',
        status: 'failed',
        detail: `Resend rejected the message (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { providerRef: payload.id ?? 'resend-ok', status: 'sent' };
  }
}

export const mockEmailProvider = new MockEmailProvider();

export function getEmailProvider(): EmailProvider {
  const config = getConfig();
  return config.EMAIL_PROVIDER === 'resend' ? new ResendEmailProvider() : mockEmailProvider;
}
