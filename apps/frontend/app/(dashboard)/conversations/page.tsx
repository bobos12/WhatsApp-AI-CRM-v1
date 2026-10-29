'use client';

import { Suspense, useCallback, useEffect, useState, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import ConversationList from '../../../components/conversations/ConversationList';
import ChatWindow from '../../../components/conversations/ChatWindow';
import { api } from '../../../lib/api';
import { useTranslation } from 'react-i18next';
import { useChatOpen } from '../../../stores/chat-open-store';

interface Contact {
  id: string;
  name: string | null;
  phone: string;
}

function ConversationsPageContent() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The open conversation lives in the URL (?c=<id>) so the browser Back/Forward
  // buttons work: opening a chat pushes a history entry, closing it pops back.
  const selectedConversationId = searchParams.get('c');
  const targetPhone = searchParams.get('phone');
  const targetConversationId = searchParams.get('conversationId');
  const conversationListRef = useRef<{ refetch: () => void } | null>(null);
  const setChatOpen = useChatOpen((s) => s.setOpen);
  // True once THIS visit opened a chat from the list (so we pushed a history
  // entry we can safely pop). Stays false when the user deep-linked straight
  // into a chat, so closing then reveals the list instead of leaving the app.
  const pushedFromListRef = useRef(false);

  useEffect(() => {
    setChatOpen(!!selectedConversationId);
    return () => setChatOpen(false);
  }, [selectedConversationId, setChatOpen]);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.getCached('/api/contacts?fields=basic', 5 * 60_000);
      setContacts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
      setContacts([]);
    }
  }, []);

  const handleContactSaved = useCallback(() => {
    fetchContacts();
    conversationListRef.current?.refetch?.();
  }, [fetchContacts]);

  // Only the forward / save-contact dialogs need the full contact list. Loading
  // it up front competed with the inbox itself for the first second, so it waits
  // until the screen is idle.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void fetchContacts());
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => void fetchContacts(), 1500);
    return () => clearTimeout(timer);
  }, [fetchContacts]);

  // Build a /conversations URL with `c` set (and one-time deep-link params dropped).
  const buildUrl = useCallback(
    (conversationId: string | null) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.delete('phone');
      params.delete('conversationId');
      if (conversationId) params.set('c', conversationId);
      else params.delete('c');
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  // Select (or switch) the open conversation via the URL. Opening from the list
  // pushes a history entry; switching between chats replaces it, so Back always
  // returns to the list (not the previously-viewed chat) — like WhatsApp Web.
  //
  // The browser's own history API, not router.push: Next keeps useSearchParams
  // in sync with it, and it changes the URL without asking the server for the
  // page again — router.push cost a network round trip on every tap, which is
  // most of why opening a chat felt like loading a website.
  const selectConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId || conversationId === selectedConversationId) return;
      const url = buildUrl(conversationId);
      if (selectedConversationId) {
        window.history.replaceState(null, '', url);
      } else {
        pushedFromListRef.current = true;
        window.history.pushState(null, '', url);
      }
    },
    [buildUrl, selectedConversationId],
  );

  // Close the open conversation (mobile back arrow / conversation-not-found).
  const closeConversation = useCallback(() => {
    if (pushedFromListRef.current) {
      // Pop the entry we pushed — clean Back with no phantom forward entry.
      pushedFromListRef.current = false;
      window.history.back();
    } else {
      // Deep-linked straight into a chat: just drop `c` to reveal the list.
      window.history.replaceState(null, '', buildUrl(null));
    }
  }, [buildUrl]);

  useEffect(() => {
    const resolveConversation = async () => {
      if (!targetPhone) return;
      try {
        const result = await api.get(`/api/conversations/by-phone/${encodeURIComponent(targetPhone)}`);
        if (result?.conversation?.id) {
          // Normalise ?phone=… into the canonical ?c=… (replace: no extra entry).
          window.history.replaceState(null, '', buildUrl(result.conversation.id));
        }
      } catch (error) {
        console.error('Failed to resolve conversation from phone:', error);
      }
    };

    void resolveConversation();
  }, [targetPhone, buildUrl]);

  // Deep-link straight to a conversation by id (e.g. from a notification):
  // normalise ?conversationId=… into ?c=… without adding a history entry.
  useEffect(() => {
    if (targetConversationId) {
      window.history.replaceState(null, '', buildUrl(targetConversationId));
    }
  }, [targetConversationId, buildUrl]);

  // Full-bleed, follows the document direction: in Arabic the list sits on the
  // right and the chat on the left, exactly as WhatsApp does it.
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-surface">
      {/* Conversation list — full-width on mobile, hidden once a chat is open */}
      <div
        className={`${selectedConversationId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-e border-line md:w-[320px] lg:w-[360px]`}
      >
        <ConversationList
          ref={conversationListRef}
          selectedId={selectedConversationId}
          onSelect={selectConversation}
        />
      </div>

      {/* Chat — full-width on mobile, shown only when a chat is selected */}
      <div className={`${selectedConversationId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
        <ChatWindow
          conversationId={selectedConversationId}
          recipientContacts={contacts}
          onContactSaved={handleContactSaved}
          onBack={closeConversation}
          onConversationNotFound={() => {
            closeConversation();
            conversationListRef.current?.refetch?.();
          }}
        />
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  const { t } = useTranslation('common');
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-ink-3">{t('loading')}</div>}>
      <ConversationsPageContent />
    </Suspense>
  );
}
