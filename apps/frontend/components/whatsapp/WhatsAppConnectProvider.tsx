'use client';

/**
 * One WhatsApp pairing handshake per app, shared by every surface that shows it.
 *
 * The QR now appears in three places at once — the dashboard connection strip,
 * the connect popup, and the sidebar's status line — and each of them used to run
 * its own useWhatsAppConnect. That meant several independent `POST /connect`
 * calls racing for the same socket, each clearing the credentials the others were
 * mid-way through pairing with, which is a very effective way to make a QR appear
 * and then die for no visible reason.
 *
 * The handshake lives here instead. Surfaces read it; nobody starts a second one.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useWhatsAppConnect, type WhatsAppConnectState } from '../../hooks/useWhatsAppConnect';

const WhatsAppConnectContext = createContext<WhatsAppConnectState | null>(null);

export function WhatsAppConnectProvider({ children }: { children: ReactNode }) {
  // Always enabled: the hook stops polling on its own once connected, and having
  // a code already waiting is the difference between "scan this" and "wait…".
  const connection = useWhatsAppConnect(true);
  return (
    <WhatsAppConnectContext.Provider value={connection}>
      {children}
    </WhatsAppConnectContext.Provider>
  );
}

export function useWhatsAppConnection(): WhatsAppConnectState {
  const connection = useContext(WhatsAppConnectContext);
  if (!connection) {
    throw new Error('useWhatsAppConnection must be used inside <WhatsAppConnectProvider>');
  }
  return connection;
}
