import { ReactNode } from 'react';
import Sidebar from '../../components/layout/Sidebar';
import Header from '../../components/layout/Header';
import BottomNav from '../../components/layout/BottomNav';
import AppMain from '../../components/layout/AppMain';
import CommandPalette from '../../components/layout/CommandPalette';
import NotificationProvider from '../../components/providers/NotificationProvider';
import { RealtimeProvider } from '../../components/providers/RealtimeProvider';
import OnboardingWizard from '../../components/onboarding/OnboardingWizard';
import Toaster from '../../components/ui/Toaster';
import LeadAlertPopup from '../../components/notifications/LeadAlertPopup';
import CrmAssistantBubble from '../../components/layout/CrmAssistantBubble';
import WhatsAppConnectBanner from '../../components/whatsapp/WhatsAppConnectBanner';
import { WhatsAppConnectProvider } from '../../components/whatsapp/WhatsAppConnectProvider';
import SetupGate from '../../components/whatsapp/setup/SetupGate';
import AppUpdateBanner from '../../components/layout/AppUpdateBanner';
import ImpersonationBanner from '../../components/layout/ImpersonationBanner';
import ViewportFit from '../../components/layout/ViewportFit';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    // Full-bleed shell: dark sidebar, then the workspace. No floating container —
    // the window *is* the app, and every pixel of it goes to the work.
    <div className="flex h-[var(--app-h,100dvh)] overflow-hidden overscroll-none bg-canvas text-ink">
      <ViewportFit />
      <NotificationProvider />
      <RealtimeProvider>
        {/* One status read for the whole shell — the gate, sidebar line, banner
            and settings all share it. */}
        <WhatsAppConnectProvider>
          {/* Until a number is connected the CRM has nothing to work with, so the
              whole shell waits behind the setup (or "ask your manager") screen. */}
          <SetupGate>
            <OnboardingWizard />
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <ImpersonationBanner />
              <AppUpdateBanner />
              <WhatsAppConnectBanner />
              <AppMain>{children}</AppMain>
            </div>
            <BottomNav />
            <CommandPalette />
            <LeadAlertPopup />
            <CrmAssistantBubble />
          </SetupGate>
        </WhatsAppConnectProvider>
      </RealtimeProvider>
      <Toaster />
    </div>
  );
}
