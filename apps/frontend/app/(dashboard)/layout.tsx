import { ReactNode } from 'react';
import Sidebar from '../../components/layout/Sidebar';
import Header from '../../components/layout/Header';
import BottomNav from '../../components/layout/BottomNav';
import NotificationProvider from '../../components/providers/NotificationProvider';
import { RealtimeProvider } from '../../components/providers/RealtimeProvider';
import OnboardingWizard from '../../components/onboarding/OnboardingWizard';
import Toaster from '../../components/ui/Toaster';
import LeadAlertPopup from '../../components/notifications/LeadAlertPopup';
import CrmAssistantBubble from '../../components/layout/CrmAssistantBubble';
import WhatsAppConnectBanner from '../../components/whatsapp/WhatsAppConnectBanner';
import { WhatsAppConnectProvider } from '../../components/whatsapp/WhatsAppConnectProvider';
import AppUpdateBanner from '../../components/layout/AppUpdateBanner';
import ImpersonationBanner from '../../components/layout/ImpersonationBanner';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    // Soft gray page → floating white rounded app container (Donezo shell)
    <div className="h-screen overflow-hidden bg-[#F1F2F4] p-0 text-gray-900 sm:p-3 lg:p-4 dark:bg-[#070C10] dark:text-white">
      <NotificationProvider />
      <RealtimeProvider>
        <OnboardingWizard />
        {/* One pairing handshake for the whole shell — the sidebar status line,
            the connect popup and the dashboard QR all read the same one. */}
        <WhatsAppConnectProvider>
          <div className="flex h-full overflow-hidden bg-white sm:rounded-[28px] sm:shadow-[0_20px_60px_-30px_rgba(16,24,40,0.25)] dark:bg-[#0B141A] dark:shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <ImpersonationBanner />
              <AppUpdateBanner />
              <WhatsAppConnectBanner />
              <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pt-5 sm:px-6 sm:py-5 lg:px-7 pb-[var(--bottom-nav-space)] animate-fade-in">
                {children}
              </main>
            </div>
          </div>
        </WhatsAppConnectProvider>
      </RealtimeProvider>
      <BottomNav />
      <Toaster />
      <LeadAlertPopup />
      <CrmAssistantBubble />
    </div>
  );
}
