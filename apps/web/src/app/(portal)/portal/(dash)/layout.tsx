'use client';

/**
 * The tenant portal shell — the owner/admin rail, in the tenant's register.
 *
 * Same dark rail, same brand mark, same account card pattern and the same
 * Poppins/ink/brand system as the staff side (owner request: one theme across
 * the two sides), but only the six things a tenant needs: overview, payments,
 * their rent account, maintenance, documents and profile. Everything under
 * this layout requires a tenant session; a signed-out visitor is sent to
 * /portal/login.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  ArrowDown2,
  ArrowUp2,
  DocumentText,
  Element3,
  Logout,
  Menu as MenuIcon,
  Profile2User,
  ReceiptItem,
  Setting3,
  Wallet3,
} from '@/components/icons';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { Button, Skeleton } from '@/components/ui';
import { Logo } from '@/components/logo';

const NAV_ITEMS = [
  { href: '/portal', labelKey: 'portal.nav.dashboard', icon: Element3 },
  { href: '/portal/payments', labelKey: 'portal.nav.payments', icon: Wallet3 },
  { href: '/portal/statement', labelKey: 'portal.nav.statement', icon: ReceiptItem },
  { href: '/portal/maintenance', labelKey: 'portal.nav.maintenance', icon: Setting3 },
  { href: '/portal/documents', labelKey: 'portal.nav.documents', icon: DocumentText },
  { href: '/portal/profile', labelKey: 'portal.nav.profile', icon: Profile2User },
];

function activeHrefFor(pathname: string): string {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  // `/portal` must not swallow `/portal/payments` — the longest match wins.
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? '/portal';
}

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = usePreferences();
  const activeHref = activeHrefFor(pathname);

  return (
    <nav aria-label={t('portal.title')} className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === activeHref;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-white' : 'text-slate-400')} />
                <span className="truncate">{t(item.labelKey as never)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, ready, t, signOut } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const isTenant = session?.role === 'tenant';

  useEffect(() => {
    if (ready && !session) router.replace('/portal/login');
  }, [ready, session, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // Signing out locally matters more than telling the server.
    }
    signOut();
    router.replace('/portal/login');
  }

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  // A staff session that wandered into the portal gets the quiet notice the
  // old single page showed; the shell itself is tenant-only.
  if (!isTenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-sm text-slate-600">{t('portal.not_tenant')}</p>
          <Link href="/portal/login" className="text-sm font-medium text-brand-700 underline">
            {t('portal.title')}
          </Link>
        </div>
      </div>
    );
  }

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo size={34} className="shrink-0" />
      <p className="truncate text-sm font-semibold text-white">{t('portal.title')}</p>
    </div>
  );

  const accountCard = () => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${session.user.fullName} — ${t('auth.sign_out')}`}
          aria-haspopup="menu"
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white/[0.07] p-2.5 text-left outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-400/70"
        >
          <span className="relative shrink-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-sm font-semibold text-brand-800">
              {initialsOf(session.user.fullName)}
            </span>
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-ink-900"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">
              {session.user.fullName}
            </span>
            <span className="block truncate text-xs text-slate-400">{t('role.tenant')}</span>
          </span>
          <span aria-hidden="true" className="flex shrink-0 flex-col text-slate-500">
            <ArrowUp2 size={12} />
            <ArrowDown2 size={12} />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          <DropdownMenu.Label className="px-2.5 py-2">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {session.user.fullName}
            </span>
            <span className="block truncate text-xs text-slate-500">{session.organization.name}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            onSelect={() => {
              void handleSignOut();
            }}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-red-600 outline-none transition-colors hover:bg-red-50 focus:bg-red-50"
          >
            <Logout className="h-4 w-4" aria-hidden="true" />
            {t('auth.sign_out')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-800 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {t('a11y.skip_to_content')}
      </a>

      {/* Permanent rail on lg and up — the same operations-console convention
          as the staff side. */}
      <aside className="hidden h-full w-64 shrink-0 flex-col bg-ink-900 lg:flex">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">{brand}</div>
        <NavLinks pathname={pathname} />
        <div className="border-t border-white/10 p-3">{accountCard()}</div>
      </aside>

      {/* Phone: the same navigation in a drawer (ADR-0023). */}
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/60 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-ink-900 shadow-xl lg:hidden">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
              <Dialog.Title className="min-w-0">{brand}</Dialog.Title>
              <Dialog.Description className="sr-only">{t('nav.menu')}</Dialog.Description>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400 hover:bg-white/10 hover:text-white"
                  aria-label={t('common.close')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            <div className="border-t border-white/10 p-3">{accountCard()}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Phone-only top bar; on desktop the rail carries the identity. */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Logo size={28} onDark={false} className="shrink-0" />
            <span className="truncate text-sm font-semibold text-slate-900">{t('portal.title')}</span>
          </div>
        </header>

        <main
          id="portal-main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 focus:outline-none lg:p-8"
        >
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
