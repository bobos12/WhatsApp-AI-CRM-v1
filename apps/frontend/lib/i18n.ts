import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// ── English translations ──────────────────────────────────────────────────────
import enCommon from '../locales/en/common.json';
import enAuth from '../locales/en/auth.json';
import enDashboard from '../locales/en/dashboard.json';
import enChat from '../locales/en/chat.json';
import enContacts from '../locales/en/contacts.json';
import enTemplates from '../locales/en/templates.json';
import enBroadcasts from '../locales/en/broadcasts.json';
import enSettings from '../locales/en/settings.json';
import enSidebar from '../locales/en/sidebar.json';
import enErrors from '../locales/en/errors.json';
import enValidation from '../locales/en/validation.json';
import enNotifications from '../locales/en/notifications.json';
import enDeals from '../locales/en/deals.json';
import enTasks from '../locales/en/tasks.json';
import enAdmin from '../locales/en/admin.json';
import enAutomations from '../locales/en/automations.json';
import enLeads from '../locales/en/leads.json';
import enAiConfig from '../locales/en/aiconfig.json';
import enWhatsApp from '../locales/en/whatsapp.json';

// ── Arabic translations ───────────────────────────────────────────────────────
import arCommon from '../locales/ar/common.json';
import arAuth from '../locales/ar/auth.json';
import arDashboard from '../locales/ar/dashboard.json';
import arChat from '../locales/ar/chat.json';
import arContacts from '../locales/ar/contacts.json';
import arTemplates from '../locales/ar/templates.json';
import arBroadcasts from '../locales/ar/broadcasts.json';
import arSettings from '../locales/ar/settings.json';
import arSidebar from '../locales/ar/sidebar.json';
import arErrors from '../locales/ar/errors.json';
import arValidation from '../locales/ar/validation.json';
import arNotifications from '../locales/ar/notifications.json';
import arDeals from '../locales/ar/deals.json';
import arTasks from '../locales/ar/tasks.json';
import arAdmin from '../locales/ar/admin.json';
import arAutomations from '../locales/ar/automations.json';
import arLeads from '../locales/ar/leads.json';
import arAiConfig from '../locales/ar/aiconfig.json';
import arWhatsApp from '../locales/ar/whatsapp.json';

export type Language = 'en' | 'ar';
export const SUPPORTED_LANGUAGES: Language[] = ['en', 'ar'];
export const LANGUAGE_STORAGE_KEY = 'crm-lang';

export function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
  return stored && SUPPORTED_LANGUAGES.includes(stored) ? stored : 'en';
}

export function isRTL(lang: Language): boolean {
  return lang === 'ar';
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common', 'auth', 'dashboard', 'chat', 'contacts',
      'templates', 'broadcasts', 'settings', 'sidebar',
      'errors', 'validation', 'notifications', 'deals', 'tasks', 'admin', 'automations', 'leads', 'aiconfig', 'whatsapp',
    ],
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        chat: enChat,
        contacts: enContacts,
        templates: enTemplates,
        broadcasts: enBroadcasts,
        settings: enSettings,
        sidebar: enSidebar,
        errors: enErrors,
        validation: enValidation,
        notifications: enNotifications,
        deals: enDeals,
        tasks: enTasks,
        admin: enAdmin,
        automations: enAutomations,
        leads: enLeads,
        aiconfig: enAiConfig,
        whatsapp: enWhatsApp,
      },
      ar: {
        common: arCommon,
        auth: arAuth,
        dashboard: arDashboard,
        chat: arChat,
        contacts: arContacts,
        templates: arTemplates,
        broadcasts: arBroadcasts,
        settings: arSettings,
        sidebar: arSidebar,
        errors: arErrors,
        validation: arValidation,
        notifications: arNotifications,
        deals: arDeals,
        tasks: arTasks,
        admin: arAdmin,
        automations: arAutomations,
        leads: arLeads,
        aiconfig: arAiConfig,
        whatsapp: arWhatsApp,
      },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18n;
