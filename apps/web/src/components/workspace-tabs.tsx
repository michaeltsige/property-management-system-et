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
    /*
     * The tray-and-folder tab bar (reviewed direction: 3A slot + 3C Chrome tab).
     *
     * The white host continues the header surface; the tray inside it is a
     * shallow slot cut into that surface — a recessed ink-tint with an inner
     * shadow at its top edge, so it reads as INSET rather than drawn on.
     * Tabs sit flush with the tray's mouth (no bottom padding): the active
     * tab takes the canvas color, so it reads as physically connected to the
     * page content below (the Chrome folder-tab convention) and lifts out of
     * the slot with a soft ink-tinted shadow; the 1px `after` bridge hides
     * any subpixel seam between tab and page. Inactive tabs stay flat and
     * quiet inside the slot until hovered.
     */
    <nav aria-label={t('tabs.label')} className="bg-white px-2 pt-1.5">
      <div className="flex items-end overflow-x-auto rounded-t-lg bg-ink-900/[0.06] px-1.5 pt-1.5 shadow-[inset_0_1px_2px_rgba(13,47,40,0.07)]">
        <ul className="flex w-max items-end gap-1">
          {tabs.map((path) => {
            const active = path === pathname;
            return (
              <li
                key={path}
                className={cn(
                  'relative flex shrink-0 items-center rounded-t-lg pr-1 transition-colors',
                  active
                    ? 'bg-canvas shadow-[0_1px_2px_rgba(13,47,40,0.06),0_-2px_6px_-2px_rgba(13,47,40,0.10)] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-canvas after:content-[""]'
                    : 'hover:bg-white/60',
                )}
              >
                <Link
                  href={path}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 py-1.5 pl-2.5 text-xs transition-colors',
                    active ? 'font-semibold text-ink-900' : 'text-slate-600 hover:text-ink-900',
                  )}
                >
                  {labelFor(path)}
                </Link>
                <button
                  type="button"
                  aria-label={`${t('tabs.close')} ${labelFor(path)}`}
                  onClick={(event) => close(event, path)}
                  className={cn(
                    'rounded p-0.5 transition-colors',
                    active
                      ? 'text-slate-500 hover:bg-white hover:text-ink-900'
                      : 'text-slate-400 hover:bg-white/70 hover:text-slate-700',
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
