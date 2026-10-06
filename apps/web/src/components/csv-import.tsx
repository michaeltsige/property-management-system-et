'use client';
import { useState } from 'react';
import { CSV_HEADERS, importErrorsCsv, type ImportKind, type ImportReport } from '@pms/shared';
import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';
import { useAction } from '@/lib/hooks';
import type { Property } from '@/lib/types';
import { Modal } from './modal';
import { Alert, Button, Input, Label, Select, Table, Th, Td } from './ui';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CsvImport({
  kind,
  properties = [],
  onImported,
}: {
  kind: ImportKind;
  properties?: Property[];
  onImported: () => void;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('csv.title')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('csv.title')}>
        {open && <CsvImportForm kind={kind} properties={properties} onImported={onImported} />}
      </Modal>
    </>
  );
}
export function CsvImportForm({
  kind,
  properties,
  onImported,
}: {
  kind: ImportKind;
  properties: Property[];
  onImported: () => void;
}) {
  const { t } = usePreferences();
  const [csv, setCsv] = useState('');
  const [propertyId, setProperty] = useState('');
  const [buildingId, setBuilding] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const { pending, error, run } = useAction();
  const submit = (dryRun: boolean) =>
    void run(async () => {
      const result = await api.importCsv(kind, {
        csv,
        dryRun,
        ...(kind === 'units' ? { propertyId, buildingId: buildingId || null } : {}),
      });
      setReport(result);
      if (result.imported) onImported();
    }).catch(() => undefined);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t('csv.hint')}</p>
      <Button
        variant="secondary"
        onClick={() => download(`${kind}-template.csv`, CSV_HEADERS[kind].join(',') + '\r\n')}
      >
        {t('csv.template')}
      </Button>
      {kind === 'units' && (
        <>
          <Label htmlFor="csv-property">{t('nav.properties')}</Label>
          <Select
            disabled={pending}
            id="csv-property"
            value={propertyId}
            onChange={(e) => {
              setProperty(e.target.value);
              setBuilding('');
              setReport(null);
            }}
          >
            <option value="">—</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Label htmlFor="csv-block">{t('portfolio.block')}</Label>
          <Select
            disabled={pending}
            id="csv-block"
            value={buildingId}
            onChange={(e) => {
              setBuilding(e.target.value);
              setReport(null);
            }}
          >
            <option value="">{t('portfolio.no_block')}</option>
            {properties
              .find((p) => p.id === propertyId)
              ?.buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
        </>
      )}
      <Label htmlFor="csv-file">{t('csv.file')}</Label>
      <Input
        id="csv-file"
        type="file"
        accept=".csv,text/csv"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          setReport(null);
          setCsv('');
          if (!file) return;
          void run(async () => {
            if (file.size > 262144) throw new Error(t('csv.limit'));
            setCsv(await file.text());
          }).catch(() => undefined);
        }}
      />
      <Label htmlFor="csv-text">{t('csv.text')}</Label>
      <textarea
        id="csv-text"
        className="min-h-32 w-full rounded border p-2 font-mono text-xs"
        value={csv}
        maxLength={262144}
        disabled={pending}
        onChange={(e) => {
          setCsv(e.target.value);
          setReport(null);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending || !csv || (kind === 'units' && !propertyId)}
          onClick={() => submit(true)}
        >
          {t('csv.validate')}
        </Button>
        <Button
          disabled={pending || !report?.valid || !!report.imported || !!report.replayed}
          onClick={() => submit(false)}
        >
          {t('csv.confirm')}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {report && (
        <div aria-live="polite">
          <p>
            {report.replayed
              ? t('csv.replayed')
              : report.valid
                ? report.imported
                  ? t('csv.done', { count: report.imported })
                  : t('csv.ready', { count: report.count })
                : t('csv.invalid')}
          </p>
          {!!report.errors.length && (
            <>
              <Button
                variant="secondary"
                onClick={() => download(`${kind}-errors.csv`, importErrorsCsv(report.errors))}
              >
                {t('csv.errors')}
              </Button>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('csv.row')}</Th>
                    <Th>{t('csv.field')}</Th>
                    <Th>{t('csv.issue')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e, i) => (
                    <tr key={i}>
                      <Td>{e.row}</Td>
                      <Td>{e.field}</Td>
                      <Td>{e.message}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
