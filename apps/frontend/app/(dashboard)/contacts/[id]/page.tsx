'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, MessageSquare, BriefcaseBusiness, CheckSquare,
  PlusCircle, Phone, CalendarDays, StickyNote, Tag as TagIcon, Clock,
  Loader2, ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../lib/api';
import { formatPhone } from '../../../../lib/phone';
import { cn } from '../../../../lib/utils';
import { useDirection } from '../../../../hooks/useDirection';
import ContactTimeline from '../../../../components/contacts/ContactTimeline';
import ContactTagSelector from '../../../../components/contacts/ContactTagSelector';
import Avatar from '../../../../components/ui/Avatar';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
  createdAt: string;
  customFields?: { avatarUrl?: string | null } | null;
}

interface ContactDetails {
  contact: Contact;
  deals: Array<{ id: string; title: string; stage: string; value: number }>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  conversations: Array<{ id: string; status: string; lastMessage: string | null; lastMessageAt: string | null }>;
}

const STAGE_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  LEAD: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  QUALIFIED: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  NEGOTIATION: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  WON: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  LOST: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  ON_HOLD: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-ink-3',
  RESOLVED: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-ink-3',
};

function StatCard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 ">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{value}</p>
          <p className="truncate text-xs text-ink-3">{label}</p>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, iconColor, action, children }: {
  title: string; icon: React.ElementType; iconColor: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface ">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon className={cn('h-4 w-4', iconColor)} />
          {title}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function ContactProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { isRTL } = useDirection();
  const { t } = useTranslation('contacts');
  const { t: tc } = useTranslation('common');
  const contactId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [details, setDetails] = useState<ContactDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/contacts/${contactId}/details`);
      setDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('messages.loadDetailsFailed'));
      setDetails(null);
    } finally {
      setLoading(false);
    }
  }, [contactId, t]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  const contact = details?.contact;
  const name = contact?.name || (contact ? formatPhone(contact.phone) : '');
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const totalDealValue = (details?.deals ?? []).reduce((sum, d) => sum + Number(d.value || 0), 0);
  const openTasks = (details?.tasks ?? []).filter((tk) => tk.status !== 'DONE' && tk.status !== 'COMPLETED').length;

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in" role="status" aria-label="Loading contact">
        <div className="flex items-center gap-3">
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="skeleton h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-3 w-28" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="skeleton h-72 rounded-2xl lg:col-span-2" />
          <div className="skeleton h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <p className="text-sm text-ink-3">{error || t('contactDetails')}</p>
        <button
          type="button"
          onClick={() => router.push('/contacts')}
          className="btn btn-primary mt-4 inline-flex"
        >
          <BackIcon className="h-4 w-4" />
          {t('title')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Back */}
      <button
        type="button"
        onClick={() => router.push('/contacts')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-ink-3 dark:hover:text-white transition-colors"
      >
        <BackIcon className="h-4 w-4" />
        {t('title')}
      </button>

      {/* Profile header */}
      <section className="overflow-hidden rounded-xl border border-line bg-gradient-to-br from-brand/5 via-white to-white dark:from-brand/10 dark:via-surface dark:to-surface ">
        <div className="relative p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar src={contact.customFields?.avatarUrl} name={name} size={64} />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold text-ink">
                  {name.startsWith('+')
                    ? <span dir="ltr">{'‎'}{name}</span>
                    : <bdi>{name}</bdi>}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-3">
                  <span dir="ltr" className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {'‎'}{formatPhone(contact.phone)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" /> {new Date(contact.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { router.push(`/conversations?phone=${encodeURIComponent(contact.phone)}`); }}
                className="btn btn-primary inline-flex"
              >
                <MessageSquare className="h-4 w-4" />
                {t('openConversation')}
              </button>
              <Link
                href={`/deals?contactId=${encodeURIComponent(contact.id)}`}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/70 dark:bg-white/5 px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-brand/40 hover:text-brand-strong"
              >
                <BriefcaseBusiness className="h-4 w-4" />
                {t('newDeal')}
              </Link>
              <Link
                href={`/tasks?contactId=${encodeURIComponent(contact.id)}`}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/70 dark:bg-white/5 px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-brand/40 hover:text-brand-strong"
              >
                <CheckSquare className="h-4 w-4" />
                {t('newTask')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={BriefcaseBusiness} label={t('dealsSection')} value={String(details?.deals?.length ?? 0)} accent="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" />
        <StatCard icon={BriefcaseBusiness} label={t('profile.dealValue')} value={`$${totalDealValue.toLocaleString()}`} accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" />
        <StatCard icon={CheckSquare} label={t('profile.openTasks')} value={String(openTasks)} accent="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400" />
        <StatCard icon={MessageSquare} label={t('conversationsSection')} value={String(details?.conversations?.length ?? 0)} accent="bg-brand/15 text-brand-strong" />
      </div>

      {/* Two-column content */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: deals, tasks, conversations */}
        <div className="space-y-5 lg:col-span-2">
          <SectionCard
            title={t('dealsSection')}
            icon={BriefcaseBusiness}
            iconColor="text-amber-500"
            action={
              <Link href={`/deals?contactId=${encodeURIComponent(contact.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <PlusCircle className="h-3.5 w-3.5" /> {t('newDeal')}
              </Link>
            }
          >
            {details?.deals?.length ? (
              <div className="space-y-2">
                {details.deals.map((deal) => (
                  <div key={deal.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{deal.title}</p>
                      <p className="text-xs text-ink-3">${Number(deal.value || 0).toLocaleString()}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STAGE_COLORS[deal.stage] ?? STAGE_COLORS.NEW)}>
                      {deal.stage}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-4">{t('noDeals')}</p>
            )}
          </SectionCard>

          <SectionCard
            title={t('tasksSection')}
            icon={CheckSquare}
            iconColor="text-brand"
            action={
              <Link href={`/tasks?contactId=${encodeURIComponent(contact.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <PlusCircle className="h-3.5 w-3.5" /> {t('newTask')}
              </Link>
            }
          >
            {details?.tasks?.length ? (
              <div className="space-y-2">
                {details.tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{task.title}</p>
                      {task.dueDate && (
                        <p className="inline-flex items-center gap-1 text-xs text-ink-3">
                          <Clock className="h-3 w-3" /> {new Date(task.dueDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-200/80 dark:bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-ink-3">
                      {task.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-4">{t('noTasks')}</p>
            )}
          </SectionCard>

          <SectionCard
            title={t('conversationsSection')}
            icon={MessageSquare}
            iconColor="text-emerald-500"
            action={
              <button
                type="button"
                onClick={() => { router.push(`/conversations?phone=${encodeURIComponent(contact.phone)}`); }}
                className="text-xs font-semibold text-brand hover:underline"
              >
                {t('openConversation')}
              </button>
            }
          >
            {details?.conversations?.length ? (
              <div className="space-y-2">
                {details.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => { router.push(`/conversations?phone=${encodeURIComponent(contact.phone)}`); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2.5 text-start transition hover:border-brand/40 hover:bg-brand/5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-2">{conv.lastMessage || t('timeline.noMessages')}</p>
                      {conv.lastMessageAt && (
                        <p className="text-xs text-ink-4">{new Date(conv.lastMessageAt).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_COLORS[conv.status] ?? STATUS_COLORS.ON_HOLD)}>
                        {conv.status}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-300 dark:text-ink-4" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-4">{t('noLinkedConversations')}</p>
            )}
          </SectionCard>
        </div>

        {/* Right: tags, notes, timeline */}
        <div className="space-y-5">
          <SectionCard title={tc('labels.tags')} icon={TagIcon} iconColor="text-purple-500">
            <ContactTagSelector contactId={contact.id} />
          </SectionCard>

          <SectionCard title={t('form.notes')} icon={StickyNote} iconColor="text-amber-500">
            {contact.notes
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{contact.notes}</p>
              : <p className="text-sm text-ink-4">—</p>}
          </SectionCard>

          <SectionCard title={t('timeline.title')} icon={Clock} iconColor="text-blue-500">
            <ContactTimeline contactId={contact.id} />
          </SectionCard>
        </div>
      </div>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
