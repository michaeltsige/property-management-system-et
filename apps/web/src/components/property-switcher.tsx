'use client';

import { useEffect } from 'react';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { usePropertyContext } from '@/lib/property-context';
import { usePreferences } from '@/lib/preferences';
import { roleHasPermission, type Role } from '@pms/shared';
import { Select } from './ui';

/**
 * Sidebar workspace card that scopes list screens to one property. It is a
 * filter on data the role can already read — never an authorization boundary.
 * It lives at the TOP of the navigation rail (above the nav groups) because it
 * reframes every list below it: the workspace-switcher spot.
 */
export function PropertySwitcher({ id }: { id: string }) {
  const { t, session } = usePreferences();
  const [propertyId, setPropertyId] = usePropertyContext();
  const properties = useAsync(
    () =>
      roleHasPermission(session?.role as Role, 'properties.read') ? api.properties() : Promise.resolve(null),
    [session?.role],
  );
  // A stored property that was deleted afterwards would scope every list to
  // nothing; drop it the moment we can see it is unknown.
  useEffect(() => {
    const list = properties.data?.properties;
    if (propertyId && list && !list.some((property) => property.id === propertyId)) setPropertyId(null);
  }, [properties.data, propertyId, setPropertyId]);

  if (!properties.data) return null;

  return (
    <div className="space-y-1">
      <label
        className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400"
        htmlFor={id}
      >
        {t('property.context')}
      </label>
      <Select
        id={id}
        className="w-full border-white/10 bg-white/5 text-slate-100 data-[state=open]:border-brand-400 data-[state=open]:ring-brand-400"
        value={propertyId ?? ''}
        onChange={(event) => setPropertyId(event.target.value || null)}
      >
        <option value="">{t('property.all')}</option>
        {properties.data.properties.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
