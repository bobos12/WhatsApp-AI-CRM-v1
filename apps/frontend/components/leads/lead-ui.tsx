'use client';

import { AlertTriangle, ShoppingCart, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// ── Shared types ──────────────────────────────────────────────────────────────
export type LeadStatus =
  | 'NEW_LEAD' | 'QUALIFIED' | 'HOT' | 'WARM' | 'COLD'
  | 'CUSTOMER' | 'LOST' | 'NOT_INTERESTED' | 'SPAM';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface LeadSignals {
  pricingRequest: boolean;
  meetingRequest: boolean;
  callRequest: boolean;
  urgency: boolean;
  readyToBuy: boolean;
}

export interface Lead {
  id: string;
  contactId: string;
  status: LeadStatus;
  score: number;
  priority: Priority;
  confidence: number;
  needsAttention: boolean;
  buyingIntent: boolean;
  signals: LeadSignals | null;
  summaryEn: string | null;
  summaryAr: string | null;
  recommendationEn: string | null;
  recommendationAr: string | null;
  lastAnalyzedAt: string | null;
  updatedAt: string;
  contact: { id: string; name: string | null; phone: string; lifecycleStage?: string } | null;
  conversationId: string | null;
  assignedTo?: string | null;
}

export interface LeadStatusEvent {
  id: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  score: number;
  reason: string | null;
  createdAt: string;
}

export const SIGNAL_KEYS: Array<keyof LeadSignals> = [
  'pricingRequest', 'meetingRequest', 'callRequest', 'urgency', 'readyToBuy',
];

// ── Visual config ─────────────────────────────────────────────────────────────
// Chips must read in both themes: a 600-weight text colour in light, 300 in dark.
export const STATUS_CFG: Record<LeadStatus, { dot: string; badge: string }> = {
  HOT:            { dot: 'bg-red-500',     badge: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  QUALIFIED:      { dot: 'bg-brand',       badge: 'bg-brand/10 text-brand' },
  WARM:           { dot: 'bg-amber-500',   badge: 'bg-amber-500/12 text-amber-800 dark:text-amber-300' },
  COLD:           { dot: 'bg-sky-500',     badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  NEW_LEAD:       { dot: 'bg-violet-500',  badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  CUSTOMER:       { dot: 'bg-brand',       badge: 'bg-brand/10 text-brand' },
  LOST:           { dot: 'bg-ink-4',       badge: 'bg-raised text-ink-3 ring-1 ring-inset ring-line' },
  NOT_INTERESTED: { dot: 'bg-ink-4',       badge: 'bg-raised text-ink-3 ring-1 ring-inset ring-line' },
  SPAM:           { dot: 'bg-rose-700',    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
};

export const PRIORITY_CFG: Record<Priority, string> = {
  URGENT: 'bg-red-600 text-white',
  HIGH:   'bg-orange-500/12 text-orange-700 dark:text-orange-300',
  NORMAL: 'bg-raised text-ink-3 ring-1 ring-inset ring-line',
  LOW:    'bg-raised text-ink-4 ring-1 ring-inset ring-line',
};

export function scoreColor(score: number): string {
  if (score >= 75) return 'text-red-600 dark:text-red-400';
  if (score >= 50) return 'text-amber-700 dark:text-amber-400';
  if (score >= 25) return 'text-sky-700 dark:text-sky-400';
  return 'text-ink-3';
}

/** Pick the AI free-text field matching the current UI language. */
export function localizedText(lead: Lead, field: 'summary' | 'recommendation', lang: string): string {
  const isAr = lang.startsWith('ar');
  if (field === 'summary') return (isAr ? lead.summaryAr : lead.summaryEn) || lead.summaryEn || lead.summaryAr || '';
  return (isAr ? lead.recommendationAr : lead.recommendationEn) || lead.recommendationEn || lead.recommendationAr || '';
}

// ── Reusable presentational bits ──────────────────────────────────────────────
export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  const { t } = useTranslation('leads');
  const cfg = STATUS_CFG[status];
  return (
    <span className={cn('chip gap-1.5', cfg.badge, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
      {t(`status.${status}`)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation('leads');
  return (
    <span className={cn('chip', PRIORITY_CFG[priority])}>
      {t(`priority.${priority}`)}
    </span>
  );
}

export function FlagChips({ lead }: { lead: Lead }) {
  const { t } = useTranslation('leads');
  if (!lead.needsAttention && !lead.buyingIntent) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lead.needsAttention && (
        <span className="chip chip-danger">
          <AlertTriangle className="h-3 w-3" />
          {t('flags.needsAttention')}
        </span>
      )}
      {lead.buyingIntent && (
        <span className="chip chip-brand">
          <ShoppingCart className="h-3 w-3" />
          {t('flags.buyingIntent')}
        </span>
      )}
    </div>
  );
}

export function SignalChips({ signals }: { signals: LeadSignals | null }) {
  const { t } = useTranslation('leads');
  const active = signals ? SIGNAL_KEYS.filter((k) => signals[k]) : [];
  if (active.length === 0) {
    return <p className="text-xs text-ink-3">{t('noSignals')}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {active.map((k) => (
        <span key={k} className="chip chip-neutral">
          {t(`signalLabels.${k}`)}
        </span>
      ))}
    </div>
  );
}

export function leadInitial(lead: Lead): string {
  return (lead.contact?.name ?? lead.contact?.phone ?? '?').charAt(0).toUpperCase();
}

export function LeadAvatar({ lead, className = '' }: { lead: Lead; className?: string }) {
  const identity = lead.contact?.name ?? lead.contact?.phone ?? '';
  const isPhone = !lead.contact?.name && identity.startsWith('+');
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand/12 font-semibold text-brand', className)}>
      {isPhone
        ? <UserRound aria-hidden="true" className="h-1/2 w-1/2" />
        : (identity.charAt(0) || '?').toUpperCase()}
    </div>
  );
}
