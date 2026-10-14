'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, BriefcaseBusiness, CheckSquare, FileText, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface TimelineEvent {
  type: 'conversation' | 'deal' | 'task' | 'note';
  at: string;
  data: any;
}

interface Props {
  contactId: string;
}

export default function ContactTimeline({ contactId }: Props) {
  const { t } = useTranslation('contacts');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const TYPE_CONFIG = {
    conversation: { icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', label: t('timeline.conversation') },
    deal: { icon: BriefcaseBusiness, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', label: t('timeline.deal') },
    task: { icon: CheckSquare, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-500/10', label: t('timeline.task') },
    note: { icon: FileText, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10', label: t('timeline.note') },
  };

  function formatRelative(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('timeline.justNow');
    if (mins < 60) return t('timeline.minsAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('timeline.hrsAgo', { count: hrs });
    return new Date(iso).toLocaleDateString();
  }

  function eventSummary(event: TimelineEvent): string {
    const { type, data } = event;
    switch (type) {
      case 'conversation': return `${data.status} · ${data.lastMessage ? data.lastMessage.slice(0, 60) : t('timeline.noMessages')}`;
      case 'deal': return `${data.title} · ${data.stage} · $${Number(data.value || 0).toLocaleString()}`;
      case 'task': return `${data.title} · ${data.status}`;
      case 'note': return (data.body ?? '').slice(0, 80);
      default: return '';
    }
  }

  useEffect(() => {
    setLoading(true);
    api.get(`/api/contacts/${contactId}/timeline`)
      .then((data: any) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [contactId]);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-raised animate-pulse" />
        ))}
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-4">
        {t('timeline.noActivityContact')}
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      <div className="absolute left-5 top-0 bottom-0 w-px bg-overlay" />
      {events.map((event, i) => {
        const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.note;
        const Icon = cfg.icon;
        return (
          <div key={i} className="relative flex items-start gap-3 pl-2">
            <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
              <Icon className={`h-4 w-4 ${cfg.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{cfg.label}</span>
                <span className="flex items-center gap-1 text-[11px] text-ink-4">
                  <Clock className="h-3 w-3" />
                  {formatRelative(event.at)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-3 truncate">{eventSummary(event)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
