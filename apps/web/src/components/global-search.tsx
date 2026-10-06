'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { roleHasPermission, type Role } from '@pms/shared';
import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

interface SearchHit {
  id: string;
  kind: 'property' | 'unit' | 'tenant';
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Header search over the lists the role can already read: no new endpoint, the
 * org-scoped lists are fetched once when the box is focused and filtered
 * locally. Selecting a hit navigates; Escape closes.
 */
export function GlobalSearch() {
  const { t, session } = usePreferences();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const role = session?.role as Role;
  const canProperties = roleHasPermission(role, 'properties.read');
  const canUnits = roleHasPermission(role, 'units.read');
  const canTenants = roleHasPermission(role, 'tenants.read');

  const properties = useMemo(
    () => (canProperties ? api.properties().then((r) => r.properties) : Promise.resolve([])),
    [canProperties],
  );
  const units = useMemo(
    () => (canUnits ? api.units().then((r) => r.units) : Promise.resolve([])),
    [canUnits],
  );
  const tenants = useMemo(
    () => (canTenants ? api.tenants().then((r) => r.tenants) : Promise.resolve([])),
    [canTenants],
  );
  const [data, setData] = useState<{
    properties: Awaited<typeof properties>;
    units: Awaited<typeof units>;
    tenants: Awaited<typeof tenants>;
  } | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    void Promise.all([properties, units, tenants])
      .then(([p, u, tn]) => {
        if (!cancelled) setData({ properties: p, units: u, tenants: tn });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, data, properties, units, tenants]);

  useEffect(() => {
    setQuery('');
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !data) return [];
    const match = (value: string | null | undefined) =>
      Boolean(value && value.toLowerCase().includes(needle));
    const out: SearchHit[] = [];
    for (const p of data.properties)
      if (match(p.name))
        out.push({
          id: p.id,
          kind: 'property',
          title: p.name,
          subtitle: t('search.properties'),
          href: '/properties',
        });
    for (const u of data.units)
      if (match(u.label))
        out.push({
          id: u.id,
          kind: 'unit',
          title: u.label,
          subtitle: u.property?.name ?? t('search.units'),
          href: '/units',
        });
    for (const tn of data.tenants)
      if (match(tn.fullName) || match(tn.phone) || match(tn.email))
        out.push({
          id: tn.id,
          kind: 'tenant',
          title: tn.fullName,
          subtitle: tn.phone ?? tn.email ?? '',
          href: `/tenants?search=${encodeURIComponent(tn.fullName)}`,
        });
    return out.slice(0, 8);
  }, [query, data, t]);

  useEffect(() => setActive(0), [query]);

  function choose(hit: SearchHit) {
    setOpen(false);
    setQuery('');
    router.push(hit.href);
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
        aria-hidden="true"
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="global-search-results"
        aria-activedescendant={hits[active] ? `search-hit-${hits[active].id}` : undefined}
        aria-label={t('search.placeholder')}
        placeholder={t('search.placeholder')}
        className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-sm focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, hits.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && hits[active]) {
            event.preventDefault();
            choose(hits[active]);
          }
        }}
      />
      {open && query.trim() && (
        <ul
          id="global-search-results"
          role="listbox"
          aria-label={t('search.placeholder')}
          className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              {data ? t('search.no_results') : t('app.loading')}
            </li>
          ) : (
            hits.map((hit, index) => (
              <li
                key={`${hit.kind}-${hit.id}`}
                id={`search-hit-${hit.id}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(hit);
                }}
                className={
                  index === active ? 'cursor-pointer bg-brand-50 px-3 py-1.5' : 'cursor-pointer px-3 py-1.5'
                }
              >
                <p className="text-sm text-slate-800">{hit.title}</p>
                <p className="text-[11px] text-slate-500">
                  {t(`search.${hit.kind}` as never)} · {hit.subtitle}
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
