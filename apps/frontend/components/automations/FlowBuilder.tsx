'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical, MessageSquare, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/modal';

type StepType = 'SEND_MESSAGE' | 'WAIT';

interface FlowStep {
  order: number;
  type: StepType;
  message?: string;
  delayMs?: number;
}

interface FlowData {
  name: string;
  trigger: string;
  keyword?: string;
  stopOnReply: boolean;
  steps: FlowStep[];
}

interface Props {
  initial?: FlowData;
  onSave: (data: FlowData) => Promise<void>;
  onCancel: () => void;
}

export default function FlowBuilder({ initial, onSave, onCancel }: Props) {
  const { t } = useTranslation('automations');

  const TRIGGERS = [
    { value: 'KEYWORD', label: t('triggers.KEYWORD') },
    { value: 'FIRST_MESSAGE', label: t('triggers.FIRST_MESSAGE') },
    { value: 'ANY_MESSAGE', label: t('triggers.ANY_MESSAGE') },
    { value: 'OUTSIDE_HOURS', label: t('triggers.OUTSIDE_HOURS') },
  ];

  const DELAY_PRESETS = [
    { label: t('flow.delay1Min'), ms: 60000 },
    { label: t('flow.delay5Min'), ms: 300000 },
    { label: t('flow.delay1Hr'), ms: 3600000 },
    { label: t('flow.delay24Hr'), ms: 86400000 },
  ];

  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState(initial?.trigger ?? 'KEYWORD');
  const [keyword, setKeyword] = useState(initial?.keyword ?? '');
  const [stopOnReply, setStopOnReply] = useState(initial?.stopOnReply ?? true);
  const [steps, setSteps] = useState<FlowStep[]>(
    initial?.steps ?? [{ order: 0, type: 'SEND_MESSAGE', message: '' }],
  );
  const [saving, setSaving] = useState(false);

  const addStep = (type: StepType) => {
    setSteps((prev) => [...prev, { order: prev.length, type, message: '', delayMs: 60000 }]);
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })));
  };

  const updateStep = (idx: number, patch: Partial<FlowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, trigger, keyword: keyword || undefined, stopOnReply, steps });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      closeOnBackdrop={false}
      aria-label={initial ? t('flow.editTitle') : t('flow.createTitle')}
      overlayClassName="bg-black/50"
      className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-raised p-6 shadow-xl"
    >
        <h2 className="text-lg font-semibold text-ink mb-4">
          {initial ? t('flow.editTitle') : t('flow.createTitle')}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-3 mb-1">{t('flow.name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('flow.namePlaceholder')}
              className="field w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-3 mb-1">{t('flow.trigger')}</label>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className="field w-full"
              >
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {trigger === 'KEYWORD' && (
              <div>
                <label className="block text-xs font-medium text-ink-3 mb-1">{t('flow.keyword')}</label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('flow.keywordPlaceholder')}
                  className="field w-full"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={stopOnReply}
              onChange={(e) => setStopOnReply(e.target.checked)}
              className="rounded"
            />
            {t('flow.stopOnReply')}
          </label>

          {/* Steps */}
          <div>
            <p className="text-xs font-medium text-ink-3 mb-2">{t('flow.steps')}</p>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-xl border border-line bg-gray-50 dark:bg-surface p-3"
                >
                  <div className="mt-1 text-gray-400">
                    {step.type === 'WAIT' ? <Clock className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink-3">
                        {idx + 1}. {step.type === 'WAIT' ? t('flow.stepWait') : t('flow.stepSendMessage')}
                      </span>
                    </div>
                    {step.type === 'SEND_MESSAGE' && (
                      <textarea
                        value={step.message ?? ''}
                        onChange={(e) => updateStep(idx, { message: e.target.value })}
                        rows={2}
                        placeholder={t('flow.messagePlaceholder')}
                        className="field w-full resize-none"
                      />
                    )}
                    {step.type === 'WAIT' && (
                      <div className="flex gap-2 flex-wrap">
                        {DELAY_PRESETS.map((p) => (
                          <button
                            key={p.ms}
                            type="button"
                            onClick={() => updateStep(idx, { delayMs: p.ms })}
                            className={`rounded-lg px-3 py-1 text-xs font-medium border transition-colors ${
                              step.delayMs === p.ms
                                ? 'bg-brand text-brand-fg border-brand'
                                : 'border-line text-gray-600 dark:text-gray-400 hover:border-brand/50'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                        <input
                          type="number"
                          value={Math.round((step.delayMs ?? 60000) / 1000)}
                          onChange={(e) => updateStep(idx, { delayMs: Number(e.target.value) * 1000 })}
                          className="field field-sm w-20"
                          placeholder={t('flow.sec')}
                        />
                        <span className="self-center text-xs text-gray-500">{t('flow.sec')}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    className="mt-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => addStep('SEND_MESSAGE')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-raised transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('flow.addMessage')}
              </button>
              <button
                type="button"
                onClick={() => addStep('WAIT')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-raised transition-colors"
              >
                <Clock className="h-3.5 w-3.5" />
                {t('flow.addDelay')}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-raised transition-colors"
          >
            {t('flow.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="btn btn-primary disabled:opacity-50"
          >
            {saving ? t('flow.saving') : t('flow.save')}
          </button>
        </div>
    </Modal>
  );
}
