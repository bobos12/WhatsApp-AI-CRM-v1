'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Modal } from '../ui/modal';

interface SaveContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  name?: string | null;
  onSuccess?: () => void;
}

export default function SaveContactModal({ isOpen, onClose, phone, name, onSuccess }: SaveContactModalProps) {
  const { t } = useTranslation('contacts');
  const { t: tc } = useTranslation('common');
  const [contactName, setContactName] = useState(name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await api.post('/api/contacts', {
        phone,
        name: contactName,
      });
      setContactName('');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.message || t('form.updateSuccess'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      aria-label={t('form.createTitle')}
      overlayClassName="bg-black/50"
      className="w-full max-w-sm rounded-2xl bg-surface shadow-lg"
    >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-ink">{t('form.createTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('actions.close')}
            className="text-ink-3 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4">
          <div>
            <label className="block text-sm font-medium text-ink-2">{t('table.phone')}</label>
            <input
              type="text"
              value={phone}
              disabled
              className="mt-1 block w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink opacity-60 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-2">{t('table.name')}</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t('form.namePlaceholder')}
              className="mt-1 block w-full rounded-lg border border-line bg-white dark:bg-raised px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSaving ? t('form.save') + '...' : t('form.save')}
            </button>
          </div>
        </form>
    </Modal>
  );
}
