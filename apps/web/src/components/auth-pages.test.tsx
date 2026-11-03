/**
 * The email-era auth doors: login's verification gate, verify-email, and the
 * code-based password reset pair.
 *
 * The harness mirrors the other page tests: preferences and the API client are
 * mocked, jsdom renders the real pages, and every flow is driven end to end.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';

import LoginPage from '@/app/(auth)/login/page';
import VerifyEmailPage from '@/app/(auth)/verify-email/page';
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page';
import ResetPasswordPage from '@/app/(auth)/reset-password/page';
import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({ replace: vi.fn(), signIn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: context.replace, push: vi.fn() }),
}));

vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG, values?: Record<string, string>) => {
      let text: string = EN_CATALOG[key] ?? (key as string);
      for (const [name, value] of Object.entries(values ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    },
    language: 'en',
    session: { role: 'owner_admin' },
    signIn: context.signIn,
  }),
  LANGUAGES: [{ code: 'en', label: 'English' }],
  CALENDARS: [{ code: 'ethiopian', label: 'Ethiopian' }],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    api: {
      ...original.api,
      login: vi.fn(),
      verifyEmail: vi.fn(),
      resendVerification: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    },
  };
});

describe('login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers the verify-email door when the API reports an unverified address', async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockRejectedValue(
      new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in.'),
    );
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Email'), 'pending@example.test');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(EN_CATALOG['auth.email_not_verified'])).toBeInTheDocument();
    const verifyLink = screen.getByRole('link', { name: EN_CATALOG['auth.verify_title'] });
    expect(verifyLink).toHaveAttribute('href', '/verify-email?email=pending%40example.test');
    expect(context.signIn).not.toHaveBeenCalled();
  });

  it('links to forgot-password', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('signs in as before when the account is fine', async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue({
      user: { id: 'u1', email: 'a@b.test', fullName: 'A', language: 'en' } as never,
      organization: { id: 'o1', name: 'O', slug: 'o', currency: 'ETB' } as never,
      role: 'owner_admin',
      memberships: [],
    });
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Email'), 'a@b.test');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(context.signIn).toHaveBeenCalled());
    expect(context.replace).toHaveBeenCalledWith('/dashboard');
  });
});

describe('verify-email page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redeems the code, starts the session and follows ?next', async () => {
    window.history.replaceState(null, '', '/verify-email?email=new@org.test&next=/onboarding');
    const user = userEvent.setup();
    vi.mocked(api.verifyEmail).mockResolvedValue({
      user: { id: 'u1', email: 'new@org.test', fullName: 'N', language: 'en' } as never,
      organization: { id: 'o1', name: 'O', slug: 'o', currency: 'ETB' } as never,
      role: 'owner_admin',
      memberships: [],
      emailVerified: true,
    });
    render(<VerifyEmailPage />);
    expect(await screen.findByDisplayValue('new@org.test')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Verification code*'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() =>
      expect(api.verifyEmail).toHaveBeenCalledWith({ email: 'new@org.test', code: '123456' }),
    );
    await waitFor(() => expect(context.signIn).toHaveBeenCalled());
    expect(context.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('asks for a fresh code and shows the development echo', async () => {
    window.history.replaceState(null, '', '/verify-email');
    const user = userEvent.setup();
    vi.mocked(api.resendVerification).mockResolvedValue({ ok: true, devVerificationCode: '654321' });
    render(<VerifyEmailPage />);
    await user.type(screen.getByLabelText('Email'), 'pending@example.test');
    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    expect(await screen.findByText(EN_CATALOG['auth.verify_resent'])).toBeInTheDocument();
    expect(screen.getByText('Development only — your code is 654321')).toBeInTheDocument();
    expect(api.resendVerification).toHaveBeenCalledWith({ email: 'pending@example.test' });
  });
});

describe('forgot-password page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests a code and links on to the reset form', async () => {
    const user = userEvent.setup();
    vi.mocked(api.forgotPassword).mockResolvedValue({ ok: true, devResetCode: '111222' });
    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email*'), 'staff@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText(EN_CATALOG['auth.forgot_sent'])).toBeInTheDocument();
    expect(api.forgotPassword).toHaveBeenCalledWith({ email: 'staff@example.test' });
    expect(screen.getByText('Development only — your code is 111222')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a new password' })).toHaveAttribute(
      'href',
      '/reset-password?email=staff%40example.test',
    );
  });

  it('shows the same success text when the address is unknown (no enumeration)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.forgotPassword).mockResolvedValue({ ok: true });
    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email*'), 'ghost@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText(EN_CATALOG['auth.forgot_sent'])).toBeInTheDocument();
    expect(screen.queryByText(/your code is/)).not.toBeInTheDocument();
  });
});

describe('reset-password page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mismatched passwords without calling the API', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText('Email*'), 'staff@example.test');
    await user.type(screen.getByLabelText('Reset code*'), '123456');
    await user.type(screen.getByLabelText('New password*'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm new password*'), 'Different123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText(EN_CATALOG['auth.reset_password_mismatch'])).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('submits the code and offers sign-in afterwards', async () => {
    const user = userEvent.setup();
    vi.mocked(api.resetPassword).mockResolvedValue({ ok: true });
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText('Email*'), 'staff@example.test');
    await user.type(screen.getByLabelText('Reset code*'), '123456');
    await user.type(screen.getByLabelText('New password*'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm new password*'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText(EN_CATALOG['auth.reset_done'])).toBeInTheDocument();
    expect(api.resetPassword).toHaveBeenCalledWith({
      email: 'staff@example.test',
      code: '123456',
      password: 'NewPass123',
    });
    // Both the success-screen button and the page footer link back to sign-in.
    const signInLinks = screen.getAllByRole('link', { name: 'Sign in' });
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of signInLinks) expect(link).toHaveAttribute('href', '/login');
  });
});
