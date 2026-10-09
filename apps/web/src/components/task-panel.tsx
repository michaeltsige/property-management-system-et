'use client';

import Link from 'next/link';
import { ClipboardList, Receipt, TrendingDown } from 'lucide-react';
import { roleHasPermission, type Role } from '@pms/shared';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

/**
 * The sidebar answers "what needs attention?" before "where can I navigate?".
 * Counts come from the same report endpoints the screens use, so a task is only
 * shown when the role can read the data behind it — the API enforces the same
 * permissions, this panel just decides what to ask for.
 */
export function TaskPanel() {
  const { t, session } = usePreferences();
  const role = session?.role as Role;
  const canCharges = roleHasPermission(role, 'charges.read');
  const canMaintenance = roleHasPermission(role, 'maintenance.read');
  const canReports = roleHasPermission(role, 'reports.read');

  const overdue = useAsync(
    () => (canCharges ? api.charges('?status=overdue&pageSize=1') : Promise.resolve(null)),
    [canCharges],
  );
  const workOrders = useAsync(
    () => (canMaintenance ? api.workOrders('?pageSize=1') : Promise.resolve(null)),
    [canMaintenance],
  );
  const arrears = useAsync(() => (canReports ? api.arrears() : Promise.resolve(null)), [canReports]);

  interface Task {
    href: string;
    label: string;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
  }
  const tasks = (
    [
      canCharges && {
        href: '/charges?status=overdue',
        label: t('tasks.overdue_charges'),
        count: overdue.data?.total ?? 0,
        icon: Receipt,
      },
      canMaintenance && {
        href: '/maintenance',
        label: t('tasks.open_work_orders'),
        count: workOrders.data?.openCount ?? 0,
        icon: ClipboardList,
      },
      canReports && {
        href: '/reports',
        label: t('tasks.arrears_review'),
        count: arrears.data?.rows.length ?? 0,
        icon: TrendingDown,
      },
    ] as (Task | false)[]
  ).filter((task): task is Task => Boolean(task));

  if (tasks.length === 0) return null;

  return (
    <section aria-labelledby="task-panel" className="border-b border-white/10 px-3 py-3">
      <p id="task-panel" className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {t('tasks.title')}
      </p>
      <ul className="space-y-0.5">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <li key={task.href}>
              <Link
                href={task.href}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  {task.label}
                </span>
                {task.count > 0 && (
                  <span className="rounded-md bg-amber-400/15 px-1.5 text-xs font-semibold text-amber-300">
                    {task.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
