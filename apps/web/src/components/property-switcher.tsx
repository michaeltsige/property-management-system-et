'use client';

import { useEffect } from 'react';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { usePropertyContext } from '@/lib/property-context';
import { usePreferences } from '@/lib/preferences';
import { roleHasPermission, type Role } from '@pms/shared';
import { Select } from './ui';

/**
 * Header control that scopes list screens to one property. It is a filter on
 * data the role can already read — never an authorization boundary.
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
      <label className="block text-[11px] font-medium text-slate-500" htmlFor={id}>
        {t('property.context')}
      </label>
      <Select
        id={id}
        className="h-8 w-44 text-xs"
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
