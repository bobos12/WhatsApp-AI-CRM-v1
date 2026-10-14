'use client';

import { useState } from 'react';
import { GripVertical, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/modal';
import { cn } from '../../lib/utils';
import {
  CUSTOM_FIELD_TYPES,
  CHOICE_TYPES,
  FIELD_TYPE_HINTS,
  FIELD_TYPE_LABELS,
  slugifyFieldKey,
  type CustomFieldDefinition,
  type CustomFieldOption,
  type CustomFieldType,
} from '../../lib/custom-fields';

const inputCls =
  'block w-full rounded-xl border border-line bg-white dark:bg-raised px-3 py-2 text-sm ' +
  'text-ink placeholder:text-ink-4 outline-none transition ' +
  'focus:border-brand focus:ring-1 focus:ring-brand/30';

export interface CustomFieldDraft {
  label: string;
  key: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  placeholder: string;
  helpText: string;
  currency: string;
}

export function draftFrom(definition: CustomFieldDefinition | null): CustomFieldDraft {
  return {
    label: definition?.label ?? '',
    key: definition?.key ?? '',
    type: definition?.type ?? 'TEXT',
    options: definition?.options ?? [],
    required: definition?.required ?? false,
    placeholder: definition?.placeholder ?? '',
    helpText: definition?.helpText ?? '',
    currency: definition?.currency ?? 'USD',
  };
}

function OptionRows({
  options,
  onChange,
}: {
  options: CustomFieldOption[];
  onChange: (options: CustomFieldOption[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomFieldOption>) =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  return (
    <div className="space-y-2">
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={option.label}
            placeholder="Label shown to users"
            onChange={(event) => {
              // The stored value tracks the label until someone edits it directly,
              // so a fresh option never saves with an empty value.
              const label = event.target.value;
              const valueTracksLabel = !option.value || option.value === slugifyFieldKey(option.label);
              update(index, { label, ...(valueTracksLabel ? { value: slugifyFieldKey(label) || label } : {}) });
            }}
            className={cn(inputCls, 'flex-1')}
          />
          <input
            type="color"
            value={option.color ?? '#25D366'}
            onChange={(event) => update(index, { color: event.target.value })}
            className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
            aria-label="Option colour"
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-500/10 hover:text-red-400"
            aria-label="Remove option"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { value: '', label: '', color: '#25D366' }])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-white/15 px-3 py-1.5 text-xs font-medium text-ink-3 hover:border-brand/50 hover:text-brand"
      >
        <Plus className="h-3.5 w-3.5" />
        Add option
      </button>
    </div>
  );
}

export default function CustomFieldEditor({
  definition,
  onSave,
  onCancel,
}: {
  /** null → creating a new field. */
  definition: CustomFieldDefinition | null;
  onSave: (draft: CustomFieldDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = Boolean(definition);
  const [draft, setDraft] = useState<CustomFieldDraft>(draftFrom(definition));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The key is derived from the label while creating, and frozen afterwards:
  // every stored value on every contact is addressed by it.
  const derivedKey = isEdit ? draft.key : slugifyFieldKey(draft.label);
  const needsOptions = CHOICE_TYPES.has(draft.type);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!draft.label.trim()) return setError('Give the field a name.');
    if (!derivedKey) return setError('That name produces no usable key — use letters or numbers.');
    if (needsOptions && draft.options.filter((option) => option.label.trim()).length === 0) {
      return setError(`${FIELD_TYPE_LABELS[draft.type]} fields need at least one option.`);
    }

    try {
      setSaving(true);
      await onSave({
        ...draft,
        key: derivedKey,
        options: draft.options
          .filter((option) => option.label.trim())
          .map((option) => ({ ...option, value: option.value || slugifyFieldKey(option.label) })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this field.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      aria-label={isEdit ? 'Edit custom field' : 'New custom field'}
      overlayClassName="items-start overflow-y-auto bg-black/70 p-4"
      className="relative mx-auto my-10 w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg"
    >
      <h3 className="mb-4 text-lg font-medium text-ink">
        {isEdit ? 'Edit field' : 'New custom field'}
      </h3>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-2">Field name</label>
          <input
            autoFocus
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            placeholder="e.g. Annual Revenue"
            className={cn(inputCls, 'mt-1')}
          />
          {derivedKey && (
            <p className="mt-1 text-xs text-ink-3">
              Template token: <code className="font-mono text-brand">{`{{${derivedKey}}}`}</code>
              {isEdit && ' · cannot be changed'}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-2">Type</label>
          <select
            value={draft.type}
            onChange={(event) => setDraft({ ...draft, type: event.target.value as CustomFieldType })}
            className={cn(inputCls, 'mt-1')}
          >
            {CUSTOM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">{FIELD_TYPE_HINTS[draft.type]}</p>
        </div>

        {needsOptions && (
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-2">Options</label>
            <OptionRows options={draft.options} onChange={(options) => setDraft({ ...draft, options })} />
          </div>
        )}

        {draft.type === 'CURRENCY' && (
          <div>
            <label className="block text-sm font-medium text-ink-2">Currency</label>
            <input
              value={draft.currency}
              onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase().slice(0, 3) })}
              placeholder="USD"
              maxLength={3}
              className={cn(inputCls, 'mt-1 uppercase')}
            />
            <p className="mt-1 text-xs text-ink-3">Three-letter ISO code, e.g. USD, EGP, SAR.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-2">Placeholder</label>
            <input
              value={draft.placeholder}
              onChange={(event) => setDraft({ ...draft, placeholder: event.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2">Help text</label>
            <input
              value={draft.helpText}
              onChange={(event) => setDraft({ ...draft, helpText: event.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
          />
          <span className="text-sm text-gray-700 dark:text-gray-200">Required on new contacts</span>
        </label>

        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary inline-flex disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create field'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirm dialog for deletion — values are kept unless the user opts to purge. */
export function DeleteFieldDialog({
  definition,
  onConfirm,
  onCancel,
}: {
  definition: CustomFieldDefinition;
  onConfirm: (purgeValues: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onCancel}
      aria-label="Delete custom field"
      overlayClassName="items-center bg-black/70 p-4"
      className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
          <Trash2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-ink">Delete “{definition.label}”?</h3>
          <p className="mt-1 text-sm text-ink-3">
            The field disappears from every form, filter and import. Values already saved on your contacts are kept, so
            re-creating a field with the same key brings them back.
          </p>
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-red-400/20 bg-red-400/5 p-3">
        <input
          type="checkbox"
          checked={purge}
          onChange={(event) => setPurge(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-500"
        />
        <span className="text-xs text-red-300">
          Also erase this field&apos;s value from every contact. This cannot be undone.
        </span>
      </label>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(purge); } finally { setBusy(false); }
          }}
          className="btn bg-red-600 text-white hover:bg-red-700 inline-flex disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Delete field
        </button>
      </div>
    </Modal>
  );
}

/** Drag handle used by the reorderable list on the settings page. */
export function DragHandle({ className }: { className?: string }) {
  return <GripVertical className={cn('h-4 w-4 cursor-grab text-gray-400 active:cursor-grabbing', className)} />;
}
