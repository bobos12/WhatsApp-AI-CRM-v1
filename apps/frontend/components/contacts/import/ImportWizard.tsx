'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, FileSpreadsheet,
  Loader2, Upload, X, XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/utils';
import { Modal } from '../../ui/modal';
import {
  ACCEPT_ATTRIBUTE, ImportParseError, buildErrorReport, downloadCsv, parseFile,
  type ParsedFile, type ParsedSheet,
} from '../../../lib/import/parse';
import { CountrySelect, DEFAULT_PHONE_COUNTRY } from '../../ui/PhoneInput';
import type { CountryCode } from 'libphonenumber-js';

/**
 * ─── Contact import ──────────────────────────────────────────────────────────
 *
 * Four screens: drop a file, confirm the mapping, review what will happen,
 * watch it happen. The mapping is guessed server-side (so the guess uses the
 * same alias table the importer uses) and the review step is a real dry run
 * against the database, not a client-side approximation — what it promises is
 * what the import does.
 */

const BATCH_SIZE = 200;

type Step = 'upload' | 'map' | 'review' | 'running' | 'done';

const SKIP = '__skip__';

interface ImportTarget {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface ValidationRowResult {
  row: number;
  phone?: string;
  outcome: 'create' | 'update' | 'merge' | 'skip' | 'error';
  duplicateOf?: 'file' | 'database';
  existingName?: string | null;
  errors: string[];
}

type DuplicateStrategy = 'SKIP' | 'UPDATE' | 'MERGE' | 'CREATE_ONLY';

const STRATEGIES: Array<{ id: DuplicateStrategy; title: string; description: string }> = [
  { id: 'SKIP', title: 'Skip duplicates', description: 'Leave existing contacts exactly as they are.' },
  { id: 'UPDATE', title: 'Update existing', description: 'Overwrite existing fields with the values in your file.' },
  { id: 'MERGE', title: 'Merge', description: 'Only fill in fields that are currently empty. Nothing is overwritten.' },
  { id: 'CREATE_ONLY', title: 'Create new only', description: 'Report any contact that already exists as an error.' },
];

const OUTCOME_STYLES: Record<ValidationRowResult['outcome'], { label: string; className: string }> = {
  create: { label: 'New', className: 'bg-brand/15 text-brand' },
  update: { label: 'Update', className: 'bg-sky-500/15 text-sky-400' },
  merge: { label: 'Merge', className: 'bg-violet-500/15 text-violet-400' },
  skip: { label: 'Skip', className: 'bg-gray-500/15 text-gray-400' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-400' },
};

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['upload', 'map', 'review', 'done'];
  const current = step === 'running' ? 3 : order.indexOf(step);
  return (
    <div className="flex items-center gap-1.5">
      {order.map((_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 rounded-full transition-all',
            index === current ? 'w-6 bg-brand' : index < current ? 'w-1.5 bg-brand/50' : 'w-1.5 bg-white/15',
          )}
        />
      ))}
    </div>
  );
}

export default function ImportWizard({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation('contacts');

  const [step, setStep] = useState<Step>('upload');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [file, setFile] = useState<File | null>(null);

  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});

  const [strategy, setStrategy] = useState<DuplicateStrategy>('SKIP');
  /** Country of numbers in the file written without + / 00 (unless a row has its own). */
  const [country, setCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [validation, setValidation] = useState<ValidationRowResult[] | null>(null);

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState({ created: 0, updated: 0, merged: 0, skipped: 0, failed: 0 });
  const [failures, setFailures] = useState<Array<{ row: number; values: string[]; errors: string[] }>>([]);

  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  const sheet: ParsedSheet | null = parsed?.sheets[sheetIndex] ?? null;

  useEffect(() => () => { cancelled.current = true; }, []);

  // ── Parsing + auto-detection ───────────────────────────────────────────────

  const loadFile = useCallback(async (incoming: File, headerRow = true) => {
    setBusy(true);
    setError(null);
    try {
      const result = await parseFile(incoming, { hasHeaderRow: headerRow });
      setParsed(result);
      setFile(incoming);
      setSheetIndex(0);

      // Ask the server to map the columns: it owns the alias table the importer
      // actually uses, so the guess and the behaviour can never drift apart.
      const detected = await api.post<{ mapping: Record<number, string>; targets: ImportTarget[] }>(
        '/api/contacts/import/detect',
        { headers: result.sheets[0].headers },
      );
      setTargets(detected.targets);
      setMapping(detected.mapping ?? {});
      setStep('map');
    } catch (err) {
      setError(
        err instanceof ImportParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'That file could not be read.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // Re-parse when the header-row toggle flips, then re-detect against new headers.
  const toggleHeaderRow = async (next: boolean) => {
    setHasHeaderRow(next);
    if (file) await loadFile(file, next);
  };

  const changeSheet = async (index: number) => {
    if (!parsed) return;
    setSheetIndex(index);
    setBusy(true);
    try {
      const detected = await api.post<{ mapping: Record<number, string>; targets: ImportTarget[] }>(
        '/api/contacts/import/detect',
        { headers: parsed.sheets[index].headers },
      );
      setTargets(detected.targets);
      setMapping(detected.mapping ?? {});
    } catch {
      setMapping({});
    } finally {
      setBusy(false);
    }
  };

  // ── Row assembly ───────────────────────────────────────────────────────────

  /** Row numbers are 1-based and include the header row, so they match the file. */
  const rowNumberOf = useCallback(
    (index: number) => index + (hasHeaderRow ? 2 : 1),
    [hasHeaderRow],
  );

  const buildRows = useCallback(() => {
    if (!sheet) return [];
    return sheet.rows.map((row, index) => {
      const values: Record<string, unknown> = {};
      row.forEach((cell, column) => {
        const target = mapping[column];
        if (target && target !== SKIP) values[target] = cell;
      });
      return { row: rowNumberOf(index), values };
    });
  }, [sheet, mapping, rowNumberOf]);

  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter((id) => id !== SKIP)), [mapping]);
  const phoneMapped = mappedTargets.has('phone');

  const options = { duplicateStrategy: strategy, defaultCountry: country, createMissingTags: true, source: 'import' as const };

  // ── Review (server dry run) ────────────────────────────────────────────────

  const runValidation = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = buildRows();
      // Validating every row of a 50k file would post megabytes for a preview.
      // The first 500 catch essentially every structural problem; the import
      // itself validates all of them, row by row, and reports anything else.
      const sample = rows.slice(0, 500);
      const result = await api.post<{ results: ValidationRowResult[] }>('/api/contacts/import/validate', {
        rows: sample,
        options,
      });
      setValidation(result.results);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate the file.');
    } finally {
      setBusy(false);
    }
  };

  // Changing the duplicate strategy changes what every duplicate row will do,
  // so the preview has to be recomputed rather than left stale.
  useEffect(() => {
    if (step !== 'review') return;
    let stale = false;
    (async () => {
      try {
        const result = await api.post<{ results: ValidationRowResult[] }>('/api/contacts/import/validate', {
          rows: buildRows().slice(0, 500),
          options: { duplicateStrategy: strategy, defaultCountry: country, createMissingTags: true, source: 'import' },
        });
        if (!stale) setValidation(result.results);
      } catch { /* keep the previous preview rather than blanking the screen */ }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, country]);

  // ── Import ─────────────────────────────────────────────────────────────────

  const runImport = async () => {
    if (!sheet) return;
    const rows = buildRows();
    setStep('running');
    setError(null);
    cancelled.current = false;
    setProgress({ done: 0, total: rows.length });

    const totals = { created: 0, updated: 0, merged: 0, skipped: 0, failed: 0 };
    const collected: Array<{ row: number; values: string[]; errors: string[] }> = [];

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      if (cancelled.current) return;
      const batch = rows.slice(start, start + BATCH_SIZE);

      try {
        const result = await api.post<{
          created: number; updated: number; merged: number; skipped: number; failed: number;
          results: Array<{ row: number; outcome: string; errors?: string[] }>;
        }>('/api/contacts/import/batch', { rows: batch, options });

        totals.created += result.created;
        totals.updated += result.updated;
        totals.merged += result.merged;
        totals.skipped += result.skipped;
        totals.failed += result.failed;

        for (const entry of result.results) {
          if (entry.outcome !== 'failed') continue;
          const sourceIndex = entry.row - (hasHeaderRow ? 2 : 1);
          collected.push({
            row: entry.row,
            values: sheet.rows[sourceIndex] ?? [],
            errors: entry.errors ?? ['Unknown error'],
          });
        }
      } catch (err) {
        // A whole batch failing (network, auth, 500) is reported per row so the
        // error report stays complete and re-uploadable.
        totals.failed += batch.length;
        const message = err instanceof Error ? err.message : 'Request failed';
        for (const entry of batch) {
          const sourceIndex = entry.row - (hasHeaderRow ? 2 : 1);
          collected.push({ row: entry.row, values: sheet.rows[sourceIndex] ?? [], errors: [message] });
        }
      }

      setProgress({ done: Math.min(start + BATCH_SIZE, rows.length), total: rows.length });
      setSummary({ ...totals });
    }

    setFailures(collected);
    setSummary({ ...totals });
    setStep('done');
    onImported();
  };

  // ── Derived preview stats ──────────────────────────────────────────────────

  const stats = useMemo(() => {
    const counts = { create: 0, update: 0, merge: 0, skip: 0, error: 0 };
    for (const row of validation ?? []) counts[row.outcome] += 1;
    return counts;
  }, [validation]);

  const totalRows = sheet?.rows.length ?? 0;
  const previewedRows = validation?.length ?? 0;
  const validationIsSample = previewedRows > 0 && previewedRows < totalRows;

  // ── Screens ────────────────────────────────────────────────────────────────

  const uploadScreen = (
    <div
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) void loadFile(dropped, hasHeaderRow);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition',
        dragging ? 'border-brand bg-brand/5' : 'border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-canvas',
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) void loadFile(chosen, hasHeaderRow);
        }}
      />

      {busy ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
          <p className="text-sm font-medium text-ink">
            {t('import.reading', { defaultValue: 'Reading your file…' })}
          </p>
        </>
      ) : (
        <>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <FileSpreadsheet className="h-7 w-7" />
          </div>
          <p className="text-base font-semibold text-ink">
            {t('import.dropTitle', { defaultValue: 'Drop your contact file here' })}
          </p>
          <p className="max-w-sm text-xs text-ink-3">
            {t('import.dropBody', {
              defaultValue: 'CSV, TSV, or Excel (.xlsx, .xls). Columns are detected automatically — you can correct anything on the next step.',
            })}
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary mt-1 inline-flex"
          >
            <Upload className="h-4 w-4" />
            {t('import.choose', { defaultValue: 'Choose a file' })}
          </button>
        </>
      )}
    </div>
  );

  const mapScreen = sheet && (
    <div className="space-y-4">
      {parsed && parsed.sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-3">
            {t('import.sheet', { defaultValue: 'Sheet' })}:
          </span>
          {parsed.sheets.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => changeSheet(index)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                index === sheetIndex
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line text-ink-3 hover:bg-raised',
              )}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          {t('import.rowsFound', { count: totalRows, defaultValue: '{{count}} rows found' })}
          {sheet.truncated > 0 && ` · ${t('import.truncated', { count: sheet.truncated, defaultValue: '{{count}} rows beyond the 50,000 limit were dropped' })}`}
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-3">
          <input
            type="checkbox"
            checked={hasHeaderRow}
            onChange={(event) => void toggleHeaderRow(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand"
          />
          {t('import.hasHeader', { defaultValue: 'First row contains column names' })}
        </label>
      </div>

      {!phoneMapped && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-300">
            {t('import.needPhone', { defaultValue: 'Map one column to Phone — a contact cannot be created without a number.' })}
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-raised text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">{t('import.column', { defaultValue: 'Column in your file' })}</th>
                <th className="px-3 py-2 font-medium">{t('import.sample', { defaultValue: 'Sample' })}</th>
                <th className="px-3 py-2 font-medium">{t('import.mapsTo', { defaultValue: 'Maps to' })}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.headers.map((header, column) => {
                const selected = mapping[column] ?? SKIP;
                const samples = sheet.rows.slice(0, 3).map((row) => row[column]).filter(Boolean);
                return (
                  <tr key={column} className="border-t border-line">
                    <td className="max-w-[10rem] px-3 py-2">
                      <p className="truncate font-medium text-ink">{header}</p>
                    </td>
                    <td className="max-w-[12rem] px-3 py-2">
                      <p className="truncate text-xs text-ink-3" dir="auto">
                        {samples.length ? samples.join(', ') : '—'}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={selected}
                        onChange={(event) => {
                          const value = event.target.value;
                          setMapping((current) => {
                            const next = { ...current };
                            // A target can only be filled by one column, so claiming
                            // it releases whichever column held it before.
                            if (value !== SKIP) {
                              for (const [key, mapped] of Object.entries(next)) {
                                if (mapped === value) delete next[Number(key)];
                              }
                              next[column] = value;
                            } else {
                              delete next[column];
                            }
                            return next;
                          });
                        }}
                        className="w-full rounded-lg border border-line bg-white dark:bg-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
                      >
                        <option value={SKIP}>{t('import.dontImport', { defaultValue: "Don't import" })}</option>
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                            {target.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const reviewScreen = (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
          {t('import.phoneCountry', { defaultValue: 'Numbers without + are from' })}
        </p>
        <CountrySelect
          value={country}
          onChange={setCountry}
          ariaLabel={t('import.phoneCountry', { defaultValue: 'Numbers without + are from' })}
          className="field w-full sm:w-72"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          {t('import.phoneCountryHint', {
            defaultValue: 'Numbers from other countries must have their code (+971…, +20…) or a country_code column. Anything else is listed as an error, not guessed.',
          })}
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
          {t('import.duplicates', { defaultValue: 'When a contact already exists' })}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {STRATEGIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setStrategy(entry.id)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border p-3 text-left transition',
                strategy === entry.id
                  ? 'border-brand/50 bg-brand/10'
                  : 'border-line bg-white dark:bg-raised hover:border-gray-300 dark:hover:border-white/20',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  strategy === entry.id ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 dark:border-white/25',
                )}
              >
                {strategy === entry.id && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold', strategy === entry.id ? 'text-brand' : 'text-ink')}>
                  {entry.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
                  {entry.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([
          ['create', stats.create], ['update', stats.update], ['merge', stats.merge],
          ['skip', stats.skip], ['error', stats.error],
        ] as const).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-line bg-white dark:bg-canvas p-3 text-center">
            <p className={cn('text-xl font-bold', value > 0 && key === 'error' ? 'text-red-400' : 'text-ink')}>
              {value}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">
              {OUTCOME_STYLES[key].label}
            </p>
          </div>
        ))}
      </div>

      {validationIsSample && (
        <p className="text-[11px] text-ink-3">
          {t('import.sampleNote', {
            count: previewedRows,
            total: totalRows,
            defaultValue: 'Previewing the first {{count}} of {{total}} rows. Every row is validated during the import.',
          })}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="max-h-[35vh] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-raised text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">{t('import.row', { defaultValue: 'Row' })}</th>
                <th className="px-3 py-2 font-medium">{t('form.phone')}</th>
                <th className="px-3 py-2 font-medium">{t('import.action', { defaultValue: 'Action' })}</th>
                <th className="px-3 py-2 font-medium">{t('import.detail', { defaultValue: 'Detail' })}</th>
              </tr>
            </thead>
            <tbody>
              {(validation ?? []).slice(0, 200).map((row) => (
                <tr key={row.row} className="border-t border-line">
                  <td className="px-3 py-2 text-xs tabular-nums text-ink-3">{row.row}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink" dir="ltr">{row.phone ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', OUTCOME_STYLES[row.outcome].className)}>
                      {OUTCOME_STYLES[row.outcome].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-3">
                    {row.errors.length
                      ? <span className="text-red-400">{row.errors.join(' ')}</span>
                      : row.duplicateOf === 'database'
                        ? t('import.existsAs', { name: row.existingName || row.phone, defaultValue: 'Already exists as {{name}}' })
                        : row.duplicateOf === 'file'
                          ? t('import.dupInFile', { defaultValue: 'Duplicated earlier in this file' })
                          : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const runningScreen = (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <Loader2 className="h-10 w-10 animate-spin text-brand" />
      <p className="text-sm font-semibold text-ink">
        {t('import.importing', { defaultValue: 'Importing contacts…' })}
      </p>
      <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-overlay">
        <div
          className="h-2 rounded-full bg-brand transition-all duration-300"
          style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-ink-3">
        {progress.done} / {progress.total}
      </p>
      <div className="flex flex-wrap justify-center gap-3 text-[11px] text-ink-3">
        <span className="text-brand">{summary.created} new</span>
        <span>{summary.updated + summary.merged} updated</span>
        <span>{summary.skipped} skipped</span>
        {summary.failed > 0 && <span className="text-red-400">{summary.failed} failed</span>}
      </div>
    </div>
  );

  const doneScreen = (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      {summary.failed === 0 ? (
        <CheckCircle2 className="h-12 w-12 text-brand" />
      ) : (
        <XCircle className="h-12 w-12 text-amber-400" />
      )}
      <div>
        <p className="text-lg font-semibold text-ink">
          {t('import.doneTitle', { defaultValue: 'Import finished' })}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {t('import.doneBody', {
            created: summary.created,
            updated: summary.updated + summary.merged,
            skipped: summary.skipped,
            failed: summary.failed,
            defaultValue: '{{created}} created · {{updated}} updated · {{skipped}} skipped · {{failed}} failed',
          })}
        </p>
      </div>

      {failures.length > 0 && (
        <button
          type="button"
          onClick={() => downloadCsv(
            `import-errors-${new Date().toISOString().slice(0, 10)}.csv`,
            buildErrorReport(sheet?.headers ?? [], failures),
          )}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-300 transition hover:bg-amber-400/20"
        >
          <Download className="h-4 w-4" />
          {t('import.downloadErrors', { count: failures.length, defaultValue: 'Download {{count}} failed rows' })}
        </button>
      )}
    </div>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footer = () => {
    if (step === 'upload' || step === 'running') return null;

    if (step === 'done') {
      return (
        <button
          type="button"
          onClick={onClose}
          className="btn btn-primary"
        >
          {t('import.close', { defaultValue: 'Done' })}
        </button>
      );
    }

    const back = step === 'map' ? () => setStep('upload') : () => setStep('map');
    const next = step === 'map' ? runValidation : runImport;

    // The preview only validates a sample of a large file, so the actionable
    // count can read zero while thousands of importable rows sit past the sample.
    // Gate on there being rows at all; the importer decides each one on its merits.
    const actionable = stats.create + stats.update + stats.merge;
    const canAdvance = step === 'map' ? phoneMapped && !busy : !busy && totalRows > 0;

    return (
      <div className="flex w-full items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:bg-raised"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('import.back', { defaultValue: 'Back' })}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!canAdvance}
          className="btn btn-primary inline-flex disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {step === 'map'
            ? t('import.review', { defaultValue: 'Review' })
            : validationIsSample
              ? t('import.startAll', { count: totalRows, defaultValue: 'Import {{count}} rows' })
              : t('import.start', { count: actionable, defaultValue: 'Import {{count}} contacts' })}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={step === 'running' ? () => {} : onClose}
      aria-label={t('import.title', { defaultValue: 'Import contacts' })}
      overlayClassName="items-start overflow-y-auto bg-black/70 p-4"
      className="relative mx-auto my-8 w-full max-w-3xl rounded-xl border border-line bg-surface shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {t('import.title', { defaultValue: 'Import contacts' })}
          </h2>
          {parsed && step !== 'upload' && (
            <p className="mt-0.5 truncate text-xs text-ink-3">{parsed.fileName}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <StepDots step={step} />
          {step !== 'running' && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('import.close', { defaultValue: 'Close' })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-raised hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {step === 'upload' && uploadScreen}
        {step === 'map' && mapScreen}
        {step === 'review' && reviewScreen}
        {step === 'running' && runningScreen}
        {step === 'done' && doneScreen}
      </div>

      {footer() && (
        <div className="flex justify-end border-t border-line px-5 py-4">{footer()}</div>
      )}
    </Modal>
  );
}
