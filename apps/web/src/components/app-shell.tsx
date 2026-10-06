'use client';

/**
 * The application shell: sidebar navigation, top bar, and the preference
 * switchers (language + calendar) that apply to the whole session.
 *
 * Navigation follows the information architecture used by established property
 * management products (see docs/REFERENCES.md): portfolio first, then people,
 * leasing, money, operations, then administration.
 *
 * Layout rules:
 * - `lg` and up: a permanent sidebar.
 * - below `lg`: the same navigation in a modal drawer, because a phone user who
 *   cannot reach any other screen cannot do the job (see ADR-0023).
 * Both copies render the same `NavLinks`; only one is ever reachable, and the
 * drawer is hidden from assistive technology when closed because Radix Dialog
 * removes it from the tree.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  FileText,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';

import { api } from '@/lib/api';
import { formatPeriodKey, todayFor } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import { CALENDARS, LANGUAGES, usePreferences } from '@/lib/preferences';
import { ROLE_LABEL_FALLBACK } from '@/lib/roles';
import { cn } from '@/lib/utils';

import { Badge, Button } from './ui';

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.group.overview',
    items: [{ href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard }],
  },
  {
    labelKey: 'nav.group.portfolio',
    items: [
      { href: '/properties', labelKey: 'nav.properties', icon: Building2 },
      { href: '/units', labelKey: 'nav.units', icon: Home },
      { href: '/tenants', labelKey: 'nav.tenants', icon: Users },
      { href: '/leases', labelKey: 'nav.leases', icon: CalendarDays },
    ],
  },
  {
    labelKey: 'nav.group.money',
    items: [
      { href: '/charges', labelKey: 'nav.charges', icon: Receipt },
      { href: '/payments', labelKey: 'nav.payments', icon: Wallet },
      { href: '/reports', labelKey: 'nav.reports', icon: BarChart3 },
    ],
  },
  {
    labelKey: 'nav.group.operations',
    items: [
      { href: '/maintenance', labelKey: 'nav.maintenance', icon: Wrench },
      { href: '/documents', labelKey: 'nav.documents', icon: FileText },
    ],
  },
  {
    labelKey: 'nav.group.settings',
    items: [
      { href: '/settings', labelKey: 'nav.settings', icon: Settings },
      { href: '/settings/translations', labelKey: 'nav.translations', icon: Languages },
    ],
  },
];

/**
 * The longest href that matches the current path wins, so `/settings/translations`
 * marks the translations entry (not both settings entries) as the current page.
 */
export function activeHrefFor(pathname: string): string | undefined {
  return NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = usePreferences();
  const activeHref = activeHrefFor(pathname);

  return (
    <nav aria-label={t('nav.menu')} className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t(group.labelKey as never)}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === activeHref;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      active ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(item.labelKey as never)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function PreferenceSwitchers({ idPrefix }: { idPrefix: string }) {
  const { t, language, calendar, setLanguage, setCalendar } = usePreferences();
  const selectClass =
    'h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-slate-500" htmlFor={`${idPrefix}-language`}>
          {t('preferences.language')}
        </label>
        <select
          id={`${idPrefix}-language`}
          value={language}
          onChange={(event) => setLanguage(event.target.value as typeof language)}
          className={selectClass}
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-slate-500" htmlFor={`${idPrefix}-calendar`}>
          {t('preferences.calendar')}
        </label>
        <select
          id={`${idPrefix}-calendar`}
          value={calendar}
          onChange={(event) => setCalendar(event.target.value as typeof calendar)}
          className={selectClass}
        >
          {CALENDARS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.english}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, t, calendar, language, signOut, ready } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);

  // A signed-out visitor never sees organization data.
  useEffect(() => {
    if (ready && !session) router.replace('/login');
  }, [ready, session, router]);

  // A drawer left open during navigation would cover the page it just opened.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  const today = todayFor(calendar);
  // An empty role would show the raw key ("role.undefined") in the header.
  const roleLabel = session.role ? t(`role.${session.role}` as never) : ROLE_LABEL_FALLBACK;

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // Signing out locally matters more than telling the server.
    }
    signOut();
    router.replace('/login');
  }

  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
        ቤ
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{t('app.name')}</p>
        <p className="truncate text-xs text-slate-500">{session.organization.name}</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-800 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {t('a11y.skip_to_content')}
      </a>

      {/* Permanent sidebar on lg and up. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">{brand}</div>
        <NavLinks pathname={pathname} />
      </aside>

      {/* The same navigation on small screens, in a drawer (ADR-0023). */}
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl lg:hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4">
              <Dialog.Title className="min-w-0">{brand}</Dialog.Title>
              <Dialog.Description className="sr-only">{t('nav.menu')}</Dialog.Description>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.close')}>
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>

            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />

            <div className="space-y-3 border-t border-slate-100 px-4 py-4">
              <PreferenceSwitchers idPrefix="drawer" />
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-800">{session.user.fullName}</p>
                  <p className="truncate text-[11px] text-slate-500">{roleLabel}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('auth.sign_out')}
                  title={t('auth.sign_out')}
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="truncate text-sm font-semibold text-slate-900 lg:hidden">{t('app.name')}</span>
            <Badge tone="gold" className="hidden sm:inline-flex">
              {formatPeriodKey(`${today.year}-${String(today.month).padStart(2, '0')}`, calendar, language)}
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex">
              <PreferenceSwitchers idPrefix="header" />
            </div>
            <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex">
              <div className="text-right">
                <p className="text-xs font-medium text-slate-800">{session.user.fullName}</p>
                <p className="text-[11px] text-slate-500">{roleLabel}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('auth.sign_out')}
                title={t('auth.sign_out')}
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 focus:outline-none lg:p-6">
          {children}
        </main>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span className="truncate">
            {t('app.name')} · {session.organization.slug}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <ChevronDown className="h-3 w-3 rotate-90" aria-hidden="true" />
            {today.year}-{String(today.month).padStart(2, '0')}-{String(today.day).padStart(2, '0')}
            {calendar === 'ethiopian' ? ' E.C.' : ' G.C.'}
          </span>
        </footer>
      </div>
    </div>
  );
}

export function PageHeader({
  titleKey,
  description,
  actions,
}: {
  titleKey: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const { t } = usePreferences();
  const title = t(titleKey as never);

  // The document title is what a screen reader announces on navigation, and what
  // a sighted user sees in the tab and in their history.
  useDocumentTitle(`${title} · ${t('app.name')}`);

  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
