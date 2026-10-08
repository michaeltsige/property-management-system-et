'use client';

/**
 * The application shell: sidebar navigation, top bar, and the preference
 * switchers (language + calendar) that apply to the whole session.
 *
 * Navigation follows the information architecture used by established property
 * management products (see docs/REFERENCES.md): portfolio first, then people,
 * leasing, money, operations, then administration. The shell itself follows
 * the operations-console convention that reference (java110/MicroCommunity)
 * popularised: a dark, grouped navigation rail against a light content area,
 * a quiet top bar, and dense tables doing the work — no decorative surfaces.
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
import { Logo } from './logo';
import { usePathname, useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
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

import { Button } from './ui';
import { GlobalSearch } from './global-search';
import { PropertySwitcher } from './property-switcher';
import { TaskPanel } from './task-panel';
import { WorkspaceTabs, isTabbedRoute } from './workspace-tabs';
import { openWorkspaceTab } from '@/lib/workspace-tabs';

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
    labelKey: 'nav.group.organization',
    items: [
      { href: '/organization', labelKey: 'nav.organization', icon: Building2 },
      { href: '/organization/team', labelKey: 'org.team', icon: Users },
      { href: '/organization/translations', labelKey: 'nav.translations', icon: Languages },
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
    <nav aria-label={t('nav.menu')} className="flex-1 space-y-4 overflow-y-auto py-3">
      <TaskPanel />
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t(group.labelKey as never)}
          </p>
          <ul className="space-y-0.5 px-2">
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
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      active
                        ? // The inset bar stands in for a left border so text
                          // never shifts when the selection moves.
                          'bg-white/10 font-medium text-white shadow-[inset_2px_0_0_var(--color-brand-400)]'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-300' : 'text-slate-400')} />
                    <span className="truncate">{t(item.labelKey as never)}</span>
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
    <div className="flex flex-wrap items-end gap-2">
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

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
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

  // Visiting a workspace screen opens (or re-orders) its tab.
  useEffect(() => {
    if (session && isTabbedRoute(pathname)) openWorkspaceTab(pathname);
  }, [pathname, session]);

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
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo size={32} className="shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{t('app.name')}</p>
        <p className="truncate text-xs text-slate-400">{session.organization.name}</p>
      </div>
    </div>
  );

  const userBlock = (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
      >
        {initialsOf(session.user.fullName)}
      </span>
      <div className="min-w-0 text-right">
        <p className="truncate text-xs font-medium text-slate-800">{session.user.fullName}</p>
        <p className="truncate text-[11px] text-slate-500">{roleLabel}</p>
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

      {/* Permanent sidebar on lg and up: the dark navigation rail. Identity
          and sign-out live in the top bar, so the rail stays pure navigation
          (the java110/MicroCommunity convention). */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink-900 lg:flex">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">{brand}</div>
        <NavLinks pathname={pathname} />
      </aside>

      {/* The same navigation on small screens, in a drawer (ADR-0023). */}
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

            <div className="space-y-3 border-t border-white/10 px-4 py-4">
              <PreferenceSwitchers idPrefix="drawer" />
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-slate-300">{userBlock}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400 hover:bg-white/10 hover:text-white"
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
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
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
            {/* Today in the active calendar: quiet context, not a badge. */}
            <span className="hidden shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 sm:inline-flex">
              {formatPeriodKey(`${today.year}-${String(today.month).padStart(2, '0')}`, calendar, language)}
            </span>
            <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
              <GlobalSearch />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex">
              <PreferenceSwitchers idPrefix="header" />
            </div>
            <div className="hidden lg:block">
              <PropertySwitcher id="header-property-context" />
            </div>
            <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex">
              {userBlock}
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

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceTabs />
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-4 focus:outline-none lg:p-6">
            {children}
          </main>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span className="truncate">
            {t('app.name')} · {session.organization.slug}
          </span>
          <span className="tabular shrink-0">
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
