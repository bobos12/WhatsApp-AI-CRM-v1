'use client';

import { useState, useEffect, useCallback } from 'react';
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
      const data = await api.get('/api/contacts');
      setContacts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
      setContacts([]);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleSave = async (broadcast: BroadcastPayload) => {
    const createdBroadcast = await api.post('/api/broadcasts', broadcast);

    // A scheduled broadcast is dispatched by the backend scheduler when its time
    // comes; only an immediate one is sent from here.
    if (!broadcast.scheduledAtLocal && createdBroadcast?.id) {
      await api.post(`/api/broadcasts/${createdBroadcast.id}/send`, {});
    }

    router.push('/broadcasts');
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6">
      {/* Page header — hidden on mobile (wizard handles its own back navigation) */}
      <div className="hidden sm:flex items-center gap-4">
        <Link
          href="/broadcasts"
          className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
        >
          <BackIcon className="h-4 w-4" />
          {t('back')}
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('form.createTitle')}</h1>
          <p className="text-gray-500 dark:text-[#8696A0]">{t('form.createSubtitle')}</p>
        </div>
      </div>

      <BroadcastForm
        contacts={contacts}
        onBack={() => router.push('/broadcasts')}
        onSave={handleSave}
      />
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
