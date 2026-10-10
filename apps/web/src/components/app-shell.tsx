'use client';

/**
 * The application shell: sidebar navigation with the property scope and the
 * account card, a quiet top bar holding the global search, and the workspace
 * tab strip.
 *
 * Navigation follows the information architecture used by established property
 * management products (see docs/REFERENCES.md): portfolio first, then people,
 * leasing, money, operations, then administration. The shell itself follows
 * the operations-console convention that reference (java110/MicroCommunity)
 * popularised: a dark, grouped navigation rail against a light content area,
 * a quiet top bar, and dense tables doing the work — no decorative surfaces.
 *
 * Layout rules:
 * - The shell is one screen tall (`h-screen`, no body scroll). The rail is a
 *   fixed column that never moves; only the content column scrolls. The rail
 *   therefore has the same length on every page (owner request).
 * - `lg` and up: a permanent sidebar. The property scope sits at its top (it
 *   reframes every list below it, so it belongs above the navigation, in the
 *   workspace-switcher spot) and the account card at its bottom (the Slack/
 *   Linear convention) — it opens the account menu with Organization settings
 *   and Sign out.
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
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  ArrowDown2,
  ArrowUp2,
  Building3,
  Calendar2,
  Chart,
  ClipboardText,
  DocumentText,
  Element3,
  Home2,
  LanguageSquare,
  Logout,
  Menu as MenuIcon,
  People,
  Profile2User,
  ReceiptItem,
  Setting2,
  Setting3,
  Wallet3,
} from './icons';

import { api } from '@/lib/api';
import { todayFor } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
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
  /** Typeface trial: a one-off family for the portfolio entries (owner picks). */
  style?: React.CSSProperties;
}

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.group.overview',
    items: [{ href: '/dashboard', labelKey: 'nav.dashboard', icon: Element3 }],
  },
  {
    labelKey: 'nav.group.portfolio',
    // Typeface trial (owner request): each entry renders in one candidate
    // family — Plus Jakarta Sans, Lexend, Inter, DM Sans — so the winner can
    // be picked from the rail itself. Remove the `style` when decided.
    items: [
      {
        href: '/properties',
        labelKey: 'nav.properties',
        icon: Building3,
        style: { fontFamily: 'var(--font-jakarta), var(--font-poppins), sans-serif' },
      },
      {
        href: '/units',
        labelKey: 'nav.units',
        icon: Home2,
        style: { fontFamily: 'var(--font-lexend), var(--font-poppins), sans-serif' },
      },
      {
        href: '/tenants',
        labelKey: 'nav.tenants',
        icon: Profile2User,
        style: { fontFamily: 'var(--font-inter), var(--font-poppins), sans-serif' },
      },
      {
        href: '/leases',
        labelKey: 'nav.leases',
        icon: Calendar2,
        style: { fontFamily: 'var(--font-dm-sans), var(--font-poppins), sans-serif' },
      },
    ],
  },
  {
    labelKey: 'nav.group.money',
    items: [
      { href: '/charges', labelKey: 'nav.charges', icon: ReceiptItem },
      { href: '/payments', labelKey: 'nav.payments', icon: Wallet3 },
      { href: '/reports', labelKey: 'nav.reports', icon: Chart },
    ],
  },
  {
    labelKey: 'nav.group.operations',
    items: [
      { href: '/maintenance', labelKey: 'nav.maintenance', icon: Setting3 },
      { href: '/documents', labelKey: 'nav.documents', icon: DocumentText },
    ],
  },
  {
    labelKey: 'nav.group.organization',
    items: [
      // /organization itself lives in the account card at the bottom of the
      // rail — account and organization settings are the same surface for an
      // owner-admin, so the rail does not repeat it.
      { href: '/organization/team', labelKey: 'org.team', icon: People },
      { href: '/organization/audit', labelKey: 'nav.audit', icon: ClipboardText },
      { href: '/organization/translations', labelKey: 'nav.translations', icon: LanguageSquare },
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
    <nav aria-label={t('nav.menu')} className="flex-1 space-y-5 overflow-y-auto py-4">
      <TaskPanel />
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          {/* Lowercase quiet group label, per the reference rail: hierarchy via
              size and tone, not caps. */}
          <p className="px-4 pb-1.5 text-[11px] font-medium tracking-wide text-slate-500">
            {t(group.labelKey as never)}
          </p>
          <ul className="space-y-1 px-3">
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
                      'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-white' : 'text-slate-400')} />
                    <span className="truncate" style={item.style}>
                      {t(item.labelKey as never)}
                    </span>
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, t, calendar, signOut, ready } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);

  // A signed-out visitor never sees organization data, and the staff shell is
  // staff-only: a tenant session lands here only by typing a staff URL, and it
  // belongs in its own portal.
  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace('/login');
    } else if (session.role === 'tenant') {
      router.replace('/portal');
    }
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
    <div className="flex min-w-0 items-center gap-3">
      <Logo size={42} className="shrink-0" />
      <p className="truncate text-base font-semibold text-white">{t('app.name')}</p>
    </div>
  );

  /**
   * The account card, per the owner's reference rail: a darker rounded box
   * holding the brand tile with a presence dot, the organization name and the
   * signed-in email, and an up/down chevron pair. It opens the account menu —
   * Organization settings and a labelled, always-readable Sign out (the icon
   * button this replaces was invisible when icons did not render).
   */
  const accountCard = () => {
    const accountActive = pathname === '/organization' || pathname.startsWith('/organization/');
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`${t('nav.organization')} — ${session.user.fullName}`}
            aria-haspopup="menu"
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white/[0.07] p-2.5 text-left outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-400/70',
              accountActive && 'bg-white/10',
            )}
          >
            <span className="relative shrink-0">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-800 ring-1 ring-white/10">
                <Logo size={30} />
              </span>
              <span
                aria-hidden="true"
                className="absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-ink-900"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">
                {session.organization.name}
              </span>
              <span className="block truncate text-xs text-slate-400">{session.user.email}</span>
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
            className="z-50 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            <DropdownMenu.Label className="px-2.5 py-2">
              <span className="block truncate text-sm font-semibold text-slate-900">
                {session.user.fullName}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {t(`role.${session.role}` as never)}
              </span>
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
            <DropdownMenu.Item asChild>
              <Link
                href="/organization"
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100"
              >
                <Setting2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
                {t('nav.organization')}
              </Link>
            </DropdownMenu.Item>
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
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-800 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {t('a11y.skip_to_content')}
      </a>

      {/* Permanent sidebar on lg and up: the dark navigation rail. The property
          scope sits at the top (it reframes every list below it) and the
          account card at the bottom, so the rail reads top-to-bottom as:
          workspace → navigation → account. */}
      <aside className="hidden h-full w-72 shrink-0 flex-col bg-ink-900 lg:flex">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">{brand}</div>
        <div className="border-b border-white/10 px-3 py-3">
          <PropertySwitcher id="sidebar-property-context" />
        </div>
        <NavLinks pathname={pathname} />
        <div className="border-t border-white/10 p-3">{accountCard()}</div>
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

            <div className="border-t border-white/10 px-3 py-3">
              <PropertySwitcher id="drawer-property-context" />
            </div>
            <div className="border-t border-white/10 p-3">{accountCard()}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* The top bar carries no border: the gradient hairline under it does
            that job with a little brand warmth. */}
        <header className="flex items-center gap-3 bg-white px-4 py-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <span className="truncate text-sm font-semibold text-slate-900 lg:hidden">{t('app.name')}</span>
          <div className="flex min-w-0 flex-1 justify-center md:px-6">
            <GlobalSearch />
          </div>
        </header>
        <div aria-hidden="true" className="h-px bg-gradient-to-r from-brand-600 via-brand-300/60 to-transparent" />

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
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
