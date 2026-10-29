'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import BroadcastForm, { type BroadcastPayload } from '../../../../components/broadcasts/BroadcastForm';
import { api } from '../../../../lib/api';
import { useDirection } from '../../../../hooks/useDirection';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  contactTags?: { tag: { id: string; name: string; color: string } }[];
}

export default function NewBroadcastPage() {
  const router = useRouter();
  const { t } = useTranslation('broadcasts');
  const { isRTL: isRtl } = useDirection();
  const [contacts, setContacts] = useState<Contact[]>([]);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.getCached('/api/contacts', 2 * 60_000);
      setContacts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
      setContacts([]);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Set once the campaign exists. If sending it then fails (no connection, a
  // template that just lost approval…), tapping Send again updates and retries
  // this campaign instead of creating a second copy of it.
  const savedId = useRef<string | null>(null);

  const handleSave = async (broadcast: BroadcastPayload) => {
    if (savedId.current) {
      await api.put(`/api/broadcasts/${savedId.current}`, broadcast);
    } else {
      const created = await api.post<{ id: string }>('/api/broadcasts', broadcast);
      savedId.current = created?.id ?? null;
    }
    const id = savedId.current;

    // A scheduled broadcast is dispatched by the backend scheduler when its time
    // comes; only an immediate one is sent from here.
    if (!broadcast.scheduledAtLocal && id) {
      await api.post(`/api/broadcasts/${id}/send`, {});
    }

    // Straight to the campaign, where its progress is live.
    router.push(id ? `/broadcasts/${id}` : '/broadcasts');
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

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
          <h1 className="text-2xl font-bold text-ink">{t('form.createTitle')}</h1>
          <p className="text-ink-3">{t('form.createSubtitle')}</p>
        </div>
      </div>

      <BroadcastForm
        contacts={contacts}
        onBack={() => router.push('/broadcasts')}
        onSave={handleSave}
        confirmBeforeSave
      />
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
