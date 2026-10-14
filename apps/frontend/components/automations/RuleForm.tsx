'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/modal';

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  keyword: string | null;
  response: string;
  isActive: boolean;
  createdAt: string;
}

interface RuleFormProps {
  rule: AutomationRule | null;
  onSave: (rule: Partial<AutomationRule>) => void;
  onCancel: () => void;
}

export default function RuleForm({ rule, onSave, onCancel }: RuleFormProps) {
  const { t } = useTranslation('automations');
  const [formData, setFormData] = useState({
    name: rule?.name || '',
    trigger: rule?.trigger || 'KEYWORD',
    keyword: rule?.keyword || '',
    response: rule?.response || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      aria-label={rule ? t('form.editTitle') : t('form.createTitle')}
      overlayClassName="items-start overflow-y-auto bg-black/70"
      className="relative top-20 mx-auto p-5 border border-line w-96 shadow-lg rounded-2xl bg-surface"
    >
        <div className="mt-3">
          <h3 className="text-lg font-medium text-ink mb-4">
            {rule ? t('form.editTitle') : t('form.createTitle')}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-2">{t('form.name')}</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full border border-line bg-white dark:bg-raised rounded-md shadow-sm py-2 px-3 text-ink focus:outline-none focus:ring-brand focus:border-brand dark:focus:ring-brand dark:focus:border-brand"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-2">{t('form.trigger')}</label>
              <select
                value={formData.trigger}
                onChange={(e) => setFormData({ ...formData, trigger: e.target.value })}
                className="mt-1 block w-full border border-line bg-white dark:bg-raised rounded-md shadow-sm py-2 px-3 text-ink focus:outline-none focus:ring-brand focus:border-brand dark:focus:ring-brand dark:focus:border-brand"
              >
                <option value="KEYWORD">{t('triggers.KEYWORD')}</option>
                <option value="FIRST_MESSAGE">{t('triggers.FIRST_MESSAGE')}</option>
                <option value="ANY_MESSAGE">{t('triggers.ANY_MESSAGE')}</option>
                <option value="OUTSIDE_HOURS">{t('triggers.OUTSIDE_HOURS')}</option>
              </select>
            </div>

            {formData.trigger === 'KEYWORD' && (
              <div>
                <label className="block text-sm font-medium text-ink-2">{t('form.keyword')}</label>
                <input
                  type="text"
                  required
                  value={formData.keyword}
                  onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                  className="mt-1 block w-full border border-line bg-white dark:bg-raised rounded-md shadow-sm py-2 px-3 text-ink focus:outline-none focus:ring-brand focus:border-brand dark:focus:ring-brand dark:focus:border-brand"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ink-2">{t('form.response')}</label>
              <textarea
                required
                rows={4}
                value={formData.response}
                onChange={(e) => setFormData({ ...formData, response: e.target.value })}
                className="mt-1 block w-full border border-line bg-white dark:bg-raised rounded-md shadow-sm py-2 px-3 text-ink focus:outline-none focus:ring-brand focus:border-brand dark:focus:ring-brand dark:focus:border-brand"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={onCancel}
                className="btn btn-secondary"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
              >
                {t('form.save')}
              </button>
            </div>
          </form>
        </div>
    </Modal>
  );
}

