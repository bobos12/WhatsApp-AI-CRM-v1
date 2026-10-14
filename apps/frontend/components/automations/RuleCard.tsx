import { Edit, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  keyword: string | null;
  response: string;
  isActive: boolean;
  createdAt: string;
}

interface RuleCardProps {
  rule: AutomationRule;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggle?: () => void;
}

export default function RuleCard({ rule, onEdit, onDelete, onToggle }: RuleCardProps) {
  const { t } = useTranslation('automations');

  const getTriggerLabel = (trigger: string) => {
    return (t as any)(`triggers.${trigger}`, { defaultValue: trigger });
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-soft transition hover:-translate-y-0.5 hover:bg-gray-50 dark:hover:bg-raised">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-ink">{rule.name}</h3>
        <div className="flex items-center space-x-2">
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className={`rounded-full p-1 transition ${rule.isActive ? 'text-brand' : 'text-ink-3'}`}
            >
              {rule.isActive ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
            </button>
          )}
          {!onToggle && (
            <span className={`${rule.isActive ? 'text-brand' : 'text-ink-4'}`}>
              {rule.isActive ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
            </span>
          )}
          {onEdit && (
            <button type="button" onClick={onEdit} className="p-1 text-ink-3 transition hover:text-brand dark:hover:text-brand">
              <Edit className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="p-1 text-red-500 dark:text-rose-400 transition hover:text-red-600 dark:hover:text-rose-300">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <span className="text-sm font-medium text-ink-3">{t('card.trigger')}:</span>
          <span className="ml-2 rounded-full border border-brand/30 dark:border-brand/30 bg-brand/10 dark:bg-brand/15 px-2 py-1 text-xs text-brand">
            {getTriggerLabel(rule.trigger)}
          </span>
        </div>

        {rule.keyword && (
          <div className="flex items-center">
            <span className="text-sm font-medium text-ink-3">{t('card.keyword')}:</span>
            <span className="ml-2 text-sm text-ink">&quot;{rule.keyword}&quot;</span>
          </div>
        )}

        <div>
          <span className="text-sm font-medium text-ink-3">{t('card.response')}:</span>
          <p className="mt-1 line-clamp-2 text-sm text-ink">{rule.response}</p>
        </div>
      </div>
    </div>
  );
}

