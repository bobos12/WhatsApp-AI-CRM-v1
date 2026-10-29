'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import BroadcastForm, { type BroadcastPayload } from '../../../../../components/broadcasts/BroadcastForm';
import { api } from '../../../../../lib/api';
import { useDirection } from '../../../../../hooks/useDirection';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  contactTags?: { tag: { id: string; name: string; color: string } }[];
}

interface Broadcast {
  id: string;
  status?: string;
  name: string;
  message: string;
  /** The wall clock the user originally picked, e.g. "2026-07-10T14:30". */
  scheduledAtLocal: string | null;
  timezone: string;
  recipients: { phone: string }[];
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
  smartSending?: boolean;
  batchSize?: number | null;
  batchIntervalMinutes?: number | null;
  /** The approved template this campaign sends, and its variable mapping. */
  templateId?: string | null;
  templateVariables?: Record<string, string> | null;
}

export default function EditBroadcastPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { t } = useTranslation('broadcasts');
  const { isRTL: isRtl } = useDirection();
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.getCached('/api/contacts', 2 * 60_000);
      setContacts(Array.isArray(data) ? data : []);
    } catch {
      setContacts([]);
    }
  }, []);

  const fetchBroadcast = useCallback(async () => {
    if (!params?.id) return;
    const data = await api.get(`/api/broadcasts/${params.id}`);
    setBroadcast(data);
  }, [params]);

  useEffect(() => {
    fetchContacts();
    fetchBroadcast();
  }, [fetchContacts, fetchBroadcast]);

  const handleSave = async (values: BroadcastPayload) => {
    if (!params?.id) return;
    await api.put(`/api/broadcasts/${params.id}`, values);
    // A paused campaign is resumed from its own page, so go back there.
    router.push(broadcast?.status === 'PAUSED' ? `/broadcasts/${params.id}` : '/broadcasts');
  };

  return (
    <div className="space-y-6">
      {/* Page header — hidden on mobile (wizard handles its own back navigation) */}
      <div className="hidden sm:flex items-center gap-4">
        <Link
          href="/broadcasts"
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
        >
          <BackIcon className="h-4 w-4" />
          {t('back')}
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('form.editTitle')}</h1>
          <p className="text-ink-3">{t('form.editSubtitle')}</p>
        </div>
      </div>

      {broadcast ? (
        <BroadcastForm
          contacts={contacts}
          initialValues={{
            name: broadcast.name,
            message: broadcast.message,
            recipients: broadcast.recipients.map(recipient => recipient.phone),
            // Bound verbatim — no Date round-trip. Converting here is what used to
            // shift the time by the UTC offset on every save.
            scheduledAtLocal: broadcast.scheduledAtLocal,
            timezone: broadcast.timezone,
            mediaUrl: broadcast.mediaUrl ?? undefined,
            mediaType: broadcast.mediaType ?? undefined,
            mediaFilename: broadcast.mediaFilename ?? undefined,
            smartSending: broadcast.smartSending,
            batchSize: broadcast.batchSize,
            batchIntervalMinutes: broadcast.batchIntervalMinutes,
            // Without these the picker reopens empty on every edit and the save
            // would clear the template off a campaign that had one.
            templateId: broadcast.templateId ?? null,
            templateVariables: broadcast.templateVariables ?? null,
          }}
          // Without this the campaign is flagged as a duplicate of itself the
          // moment its own content hash is looked up.
          currentBroadcastId={broadcast.id}
          submitLabel={t('form.saveChanges')}
          onBack={() => router.push('/broadcasts')}
          onSave={handleSave}
        />
      ) : (
        <div className="rounded-lg bg-surface p-6  text-ink">{t('form.loading')}</div>
      )}
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
