'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTags, type Tag } from '../../hooks/useTags';
import { useCustomFields } from '../../hooks/useCustomFields';
import ContactTagSelector from './ContactTagSelector';
import CustomFieldInput from './CustomFieldInput';
import { Modal } from '../ui/modal';
import PhoneInput from '../ui/PhoneInput';
import { initialFieldValues, validateFieldValue, type CustomFieldValues } from '../../lib/custom-fields';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email?: string | null;
  company?: string | null;
  notes: string | null;
  createdAt: string;
  customFields?: CustomFieldValues | null;
}

interface ContactFormProps {
  contact: Contact | null;
  onSave: (contact: Partial<Contact> & { tagIds?: string[]; customFields?: CustomFieldValues }) => Promise<void> | void;
  onCancel: () => void;
}

export default function ContactForm({ contact, onSave, onCancel }: ContactFormProps) {
  const { t } = useTranslation('contacts');
  const allTags = useTags();
  const { definitions, loading: loadingFields } = useCustomFields();

  const [formData, setFormData] = useState({
    phone: contact?.phone || '',
    name: contact?.name || '',
    email: contact?.email || '',
    company: contact?.company || '',
    notes: contact?.notes || '',
  });

  const [values, setValues] = useState<CustomFieldValues>({});
  const seeded = useRef(false);

  // Definitions arrive asynchronously, so the form seeds itself the first time
  // they land. Seeding exactly once keeps a later cache broadcast from wiping
  // whatever the user has typed since.
  useEffect(() => {
    if (seeded.current || loadingFields) return;
    seeded.current = true;
    setValues(initialFieldValues(definitions, contact?.customFields));
  }, [definitions, loadingFields, contact?.customFields]);

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The number as it will be stored (+966…), or null while it isn't valid. */
  const [phoneE164, setPhoneE164] = useState<string | null>(contact?.phone || null);

  const setCustomValue = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Clearing the error as soon as the user edits keeps the form from nagging.
    if (fieldErrors[key]) {
      const { [key]: _cleared, ...rest } = fieldErrors;
      setFieldErrors(rest);
    }
  };

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const errors: Record<string, string> = {};
    for (const definition of definitions) {
      const error = validateFieldValue(definition, values[definition.key]);
      if (error) errors[definition.key] = error;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    if (!phoneE164) {
      setSubmitError(t('form.phoneInvalid', { defaultValue: 'Enter a valid phone number and its country.' }));
      return;
    }

    try {
      setSaving(true);
      await onSave({
        ...formData,
        phone: phoneE164,
        // Always sent, even when empty, so the server can enforce required fields
        // and so clearing a field actually clears it.
        customFields: values,
        ...(contact ? {} : { tagIds: selectedTagIds }),
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('form.saveFailed', { defaultValue: 'Could not save this contact.' }));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'mt-1 block w-full rounded-xl border border-line bg-white dark:bg-raised py-2 px-3 text-sm text-ink shadow-sm outline-none transition focus:border-brand focus:ring-1 focus:ring-brand/30';
  const labelCls = 'block text-sm font-medium text-ink-2';

  return (
    <Modal
      open
      onClose={onCancel}
      aria-label={contact ? t('form.editTitle') : t('form.createTitle')}
      overlayClassName="items-start overflow-y-auto bg-black/70 p-4"
      className="relative mx-auto my-10 w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg"
    >
      <h3 className="mb-4 text-lg font-medium text-ink">
        {contact ? t('form.editTitle') : t('form.createTitle')}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>{t('form.phone')}</label>
          <PhoneInput
            value={contact?.phone || ''}
            onChange={setPhoneE164}
            required
            autoFocus={!contact}
            inputClassName={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>{t('form.name')}</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputCls}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t('form.email', { defaultValue: 'Email' })}</label>
            <input
              type="email"
              dir="ltr"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{t('form.company', { defaultValue: 'Company' })}</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>{t('form.tags')}</label>
          {contact ? (
            /* Edit mode — ContactTagSelector handles its own API calls */
            <div className="mt-2">
              <ContactTagSelector contactId={contact.id} />
            </div>
          ) : (
            /* Create mode — chip picker that collects IDs for after creation */
            <div className="mt-2">
              {allTags.length === 0 ? (
                <p className="text-xs text-ink-4">
                  {t('form.noTagsYet', { defaultValue: 'No tags yet — create them in the Tags page.' })}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag: Tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all border ${
                          selected
                            ? 'text-white border-transparent'
                            : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/15 hover:border-gray-300 dark:hover:border-white/30'
                        }`}
                        style={selected ? { backgroundColor: tag.color } : {}}
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                        {selected && <X className="h-2.5 w-2.5 opacity-80" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>{t('form.notes')}</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={3}
            className={inputCls}
          />
        </div>

        {/* ── Custom fields ── */}
        {loadingFields ? (
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('form.loadingFields', { defaultValue: 'Loading custom fields…' })}
          </div>
        ) : definitions.length > 0 ? (
          <div className="space-y-4 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                {t('form.customFields', { defaultValue: 'Custom fields' })}
              </p>
              <Link
                href="/settings/custom-fields"
                className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
              >
                <Settings2 className="h-3 w-3" />
                {t('form.manageFields', { defaultValue: 'Manage' })}
              </Link>
            </div>

            {definitions.map((definition) => (
              <CustomFieldInput
                key={definition.id}
                definition={definition}
                value={values[definition.key]}
                onChange={(value) => setCustomValue(definition.key, value)}
                error={fieldErrors[definition.key]}
              />
            ))}
          </div>
        ) : null}

        {submitError && (
          <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary"
          >
            {t('form.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || !phoneE164}
            className="btn btn-primary inline-flex disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('form.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
