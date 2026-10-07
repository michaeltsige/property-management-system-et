'use client';

import { Download, Save, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LanguageCode } from '@pms/calendar';

import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { LANGUAGES, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';

type Filter = 'all' | 'untranslated' | 'machine_draft' | 'reviewed' | 'overridden';

const FILTERS: { id: Filter; labelKey: string }[] = [
  { id: 'all', labelKey: 'common.total' },
  { id: 'untranslated', labelKey: 'translation.status.unreviewed' },
  { id: 'machine_draft', labelKey: 'translation.status.machine_draft' },
  { id: 'reviewed', labelKey: 'translation.status.reviewed' },
  { id: 'overridden', labelKey: 'translation.override' },
];

/**
 * Translation Manager.
 *
 * Shows every key with its English source, the text the chosen language currently
 * resolves to, and where that text came from — so an unreviewed machine draft is
 * visible rather than silently shipped. Overrides are saved per organization and
 * keep their history; CSV import/export round-trips with the API.
 */
export default function TranslationsPage() {
  const { t, language, refreshOverrides } = usePreferences();
  const [target, setTarget] = useState<LanguageCode>(language === 'en' ? 'am' : language);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const rows = useAsync(() => api.translations(target), [target]);
  const { pending, error, message, setMessage, run } = useAction();

  const visible = useMemo(() => {
    const list = rows.data?.rows ?? [];
    return list.filter((row) => {
      if (filter === 'untranslated' && row.status !== 'missing' && row.source !== 'english_fallback')
        return false;
      if (filter === 'machine_draft' && row.status !== 'machine_draft') return false;
      if (filter === 'reviewed' && row.status !== 'reviewed') return false;
      if (filter === 'overridden' && !row.overridden) return false;
      if (search.trim()) {
        const needle = search.toLowerCase();
        return row.key.toLowerCase().includes(needle) || row.english.toLowerCase().includes(needle);
      }
      return true;
    });
  }, [rows.data, filter, search]);

  const coverage = rows.data?.coverage?.[target];

  async function save(key: string) {
    const text = edits[key];
    if (!text) return;
    await run(async () => {
      await api.saveTranslation(key, { key, language: target, text, status: 'reviewed' });
      setMessage(`${key} → ${target}`);
      setEdits((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      rows.reload();
      await refreshOverrides();
    }).catch(() => undefined);
  }

  async function exportCsv() {
    const csv = await api.exportTranslations(target);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `translations-${target}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    await run(async () => {
      const csv = await file.text();
      const result = await api.importTranslations(csv);
      setMessage(`${result.imported} rows imported`);
      rows.reload();
      await refreshOverrides();
    }).catch(() => undefined);
  }

  return (
    <div>
      <PageHeader
        titleKey="nav.translations"
        description={
          coverage
            ? `${coverage.translated}/${coverage.total} (${coverage.percent}%) · ${t('translation.status.machine_draft')}`
            : undefined
        }
        actions={
          <>
            <Select
              value={target}
              onChange={(event) => setTarget(event.target.value as LanguageCode)}
              className="h-9 w-40"
              aria-label={t('preferences.language')}
            >
              {LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-40"
            />
            <Button variant="secondary" onClick={() => void exportCsv()}>
              <Download className="h-4 w-4" />
              {t('translation.export')}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <Upload className="h-4 w-4" />
              {t('translation.import')}
              <input
                type="file"
                accept="text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importCsv(file);
                }}
              />
            </label>
          </>
        }
      />

      {message ? (
        <Alert tone="success" className="mb-3">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              filter === item.id
                ? 'border-brand-600 bg-brand-50 text-brand-800'
                : 'border-slate-200 text-slate-600',
            )}
          >
            {t(item.labelKey as never)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title={t('common.no_results')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('translation.key')}</Th>
                  <Th>{t('translation.english')}</Th>
                  <Th>{t('translation.current')}</Th>
                  <Th>{t('unit.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.key}>
                    <Td className="font-mono text-[11px] text-slate-500">{row.key}</Td>
                    <Td className="max-w-xs text-xs">{row.english}</Td>
                    <Td>
                      <Input
                        aria-label={`${t('translation.current')} — ${row.key}`}
                        defaultValue={row.current}
                        onChange={(event) =>
                          setEdits((current) => ({ ...current, [row.key]: event.target.value }))
                        }
                        className="h-8 w-full min-w-48"
                      />
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          row.status === 'reviewed'
                            ? 'brand'
                            : row.status === 'machine_draft'
                              ? 'warning'
                              : row.status === 'missing'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {t(`translation.status.${row.status}` as never)}
                      </Badge>
                      {row.overridden ? (
                        <span className="mt-1 block text-[10px] text-brand-700">
                          {t('translation.override')}
                        </span>
                      ) : (
                        <span className="mt-1 block text-[10px] text-slate-500">{row.source}</span>
                      )}
                    </Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending || edits[row.key] === undefined}
                        onClick={() => void save(row.key)}
                        title={t('common.save')}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
