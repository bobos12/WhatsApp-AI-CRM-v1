'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import { UserCheck, Users, RefreshCw, Clock } from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
}

function ActionIcon({ action }: { action: string }) {
  if (action === 'assign_user') return <UserCheck className="h-4 w-4 text-blue-500" />;
  if (action === 'assign_team') return <Users className="h-4 w-4 text-purple-500" />;
  if (action === 'status_change') return <RefreshCw className="h-4 w-4 text-green-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

export default function AssignmentHistory({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('chat');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('assignmentHistory.justNow');
    if (mins < 60) return t('assignmentHistory.minsAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('assignmentHistory.hrsAgo', { count: hrs });
    return t('assignmentHistory.daysAgo', { count: Math.floor(hrs / 24) });
  }

  function describeAction(log: AuditLog) {
    const actor = log.user?.name || log.user?.email || 'System';
    const d = log.details || {};
    if (log.action === 'assign_user') {
      return d.agentName
        ? t('assignmentHistory.assignedTo', { actor, name: d.agentName })
        : t('assignmentHistory.unassignedAgent', { actor });
    }
    if (log.action === 'assign_team') {
      return d.teamName
        ? t('assignmentHistory.assignedToTeam', { actor, name: d.teamName })
        : t('assignmentHistory.removedTeam', { actor });
    }
    if (log.action === 'status_change') {
      return t('assignmentHistory.changedStatus', { actor, status: d.newStatus || d.status || '?' });
    }
    return t('assignmentHistory.defaultAction', { actor, action: log.action });
  }

  useEffect(() => {
    setLoading(true);
    api.get(`/api/activity/conversation/${conversationId}`)
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [conversationId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {t('details.assignmentHistory')}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-center text-xs text-ink-4 mt-8">{t('assignmentHistory.loading')}</p>
        ) : logs.length === 0 ? (
          <p className="text-center text-xs text-ink-4 mt-8">{t('assignmentHistory.noHistory')}</p>
        ) : (
          <ol className="relative border-l border-line ml-2 space-y-4">
            {logs.map((log) => (
              <li key={log.id} className="ml-4">
                <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-surface ring-2 ring-gray-200 dark:ring-white/10">
                  <ActionIcon action={log.action} />
                </span>
                <p className="text-sm text-ink">{describeAction(log)}</p>
                <p className="text-xs text-ink-4">{timeAgo(log.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
