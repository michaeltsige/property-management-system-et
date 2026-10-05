'use client';

/**
 * The application shell: sidebar navigation, top bar, and the preference
 * switchers (language + calendar) that apply to the whole session.
 *
 * Navigation follows the information architecture used by established property
 * management products (see docs/REFERENCES.md): portfolio first, then people,
 * leasing, money, operations, then administration.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
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
  Receipt,
  Settings,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

import { api } from '@/lib/api';
import { formatPeriodKey } from '@/lib/format';
import { CALENDARS, LANGUAGES, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { todayFor } from '@/lib/format';

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, t, language, calendar, setLanguage, setCalendar, signOut, ready } = usePreferences();

  // A signed-out visitor never sees organization data.
  useEffect(() => {
    if (ready && !session) router.replace('/login');
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  const today = todayFor(calendar);

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // Signing out locally matters more than telling the server.
    }
    signOut();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
            ቤ
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{t('app.name')}</p>
            <p className="text-xs text-slate-500">{session.organization.name}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.labelKey}>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {t(group.labelKey as never)}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-brand-50 font-medium text-brand-800'
                            : 'text-slate-600 hover:bg-slate-100',
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/dashboard" className="text-sm font-semibold text-slate-900 lg:hidden">
              {t('app.name')}
            </Link>
            <Badge tone="gold" className="hidden sm:inline-flex">
              {formatPeriodKey(`${today.year}-${String(today.month).padStart(2, '0')}`, calendar, language)}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="language-switcher">
              {t('preferences.language')}
            </label>
            <select
              id="language-switcher"
              value={language}
              onChange={(event) => setLanguage(event.target.value as typeof language)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              {LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="calendar-switcher">
              {t('preferences.calendar')}
            </label>
            <select
              id="calendar-switcher"
              value={calendar}
              onChange={(event) => setCalendar(event.target.value as typeof calendar)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              {CALENDARS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.english}
                </option>
              ))}
            </select>

            <div className="hidden items-center gap-2 border-l border-slate-200 pl-2 sm:flex">
              <div className="text-right">
                <p className="text-xs font-medium text-slate-800">{session.user.fullName}</p>
                <p className="text-[11px] text-slate-500">{t(`role.${session.role}` as never)}</p>
              </div>
              <Button variant="ghost" size="icon" title={t('auth.sign_out')} onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span>
            {t('app.name')} · {session.organization.slug}
          </span>
          <span className="flex items-center gap-1">
            <ChevronDown className="h-3 w-3 rotate-90" />
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
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{t(titleKey as never)}</h1>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
