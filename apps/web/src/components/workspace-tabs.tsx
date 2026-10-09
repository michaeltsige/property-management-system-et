'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { roleHasPermission, type Role } from '@pms/shared';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { closeWorkspaceTab, useWorkspaceTabs } from '@/lib/workspace-tabs';
import { cn } from '@/lib/utils';

const ROUTE_LABEL_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/properties': 'nav.properties',
  '/units': 'nav.units',
  '/tenants': 'nav.tenants',
  '/leases': 'nav.leases',
  '/charges': 'nav.charges',
  '/payments': 'nav.payments',
  '/reports': 'nav.reports',
  '/maintenance': 'nav.maintenance',
  '/documents': 'nav.documents',
  '/organization': 'nav.organization',
  '/organization/team': 'org.team',
  '/organization/translations': 'nav.translations',
  '/onboarding': 'onboarding.first_property',
};

/** ` /units/<id>` is the only dynamic route that opens as a tab today. */
export function isTabbedRoute(pathname: string): boolean {
  return pathname in ROUTE_LABEL_KEYS || /^\/units\/[\w-]+$/.test(pathname);
}

export function WorkspaceTabs() {
  const { t, session } = usePreferences();
  const pathname = usePathname();
  const router = useRouter();
  const tabs = useWorkspaceTabs();

  const canUnits = roleHasPermission(session?.role as Role, 'units.read');
  const units = useAsync(
    () => (canUnits ? api.units().catch(() => ({ units: [] })) : Promise.resolve({ units: [] })),
    [canUnits],
  );

  if (tabs.length === 0) return null;

  function labelFor(path: string): string {
    const key = ROUTE_LABEL_KEYS[path];
    if (key) return t(key as never);
    const match = path.match(/^\/units\/([\w-]+)$/);
    if (match) {
      const unit = units.data?.units.find((candidate) => candidate.id === match[1]);
      return unit ? `${t('unit.label')} ${unit.label}` : `${t('unit.label')} ${match[1].slice(0, 8)}`;
    }
    return path;
  }

  function close(event: React.MouseEvent, path: string) {
    event.preventDefault();
    event.stopPropagation();
    const fallback = closeWorkspaceTab(path);
    if (path === pathname) router.push(fallback ?? '/dashboard');
  }

  return (
    <nav aria-label={t('tabs.label')} className="overflow-x-auto border-b border-slate-200 bg-white">
      <ul className="flex items-center gap-1.5 px-2 py-1.5">
        {tabs.map((path) => {
          const active = path === pathname;
          return (
            <li key={path} className="flex shrink-0 items-center">
              <Link
                href={path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? // The one filled chip on the strip: solid brand on brand
                      // border, so the current tab wins at a glance.
                      'border-brand-700 bg-brand-600 font-semibold text-white shadow-sm'
                    : // Every other tab gets a visible bordered chip so the
                      // strip reads as separate, clickable tabs.
                      'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                {labelFor(path)}
              </Link>
              <button
                type="button"
                aria-label={`${t('tabs.close')} ${labelFor(path)}`}
                onClick={(event) => close(event, path)}
                className={cn(
                  '-ml-0.5 rounded p-0.5',
                  active
                    ? 'text-white/70 hover:bg-white/20 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700',
                )}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
