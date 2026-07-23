'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  MessageSquare,
  Users,
  Send,
  Settings,
  Tags,
  MessageSquareReply,
  BriefcaseBusiness,
  CheckSquare,
  ShieldCheck,
  UserCog,
  UsersRound,
  FileText,
  Menu,
  X,
  LayoutTemplate,
  Bot,
  Target,
  Smartphone,
  Sparkles,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveCounts } from '../../hooks/useLiveCounts';
import { useLeadAlerts } from '../../hooks/useLeadAlerts';
import { useDirection } from '../../hooks/useDirection';
import { useOperatorAccess } from '../../hooks/useOperatorAccess';
import { isManager } from '../../lib/roles';
import SidebarConnect from '../whatsapp/SidebarConnect';

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useTranslation('sidebar');
  const { isRTL } = useDirection();

  const role    = (session?.user as any)?.role ?? 'AGENT';
  const isAdmin = isManager(role);
  const { isOperator } = useOperatorAccess();

  const { openConversations } = useLiveCounts();

  const { needsAttention } = useLeadAlerts();

  const liveCounts: Record<string, number | null> = {
    openConversations,
    leadsNeedsAttention: needsAttention,
  };

  const mainNav = [
    { key: 'dashboard',    href: '/dashboard',    icon: BarChart3 },
    { key: 'conversations',href: '/conversations', icon: MessageSquare, liveKey: 'openConversations' as const },
    { key: 'contacts',     href: '/contacts',      icon: Users },
    { key: 'tags',         href: '/tags',          icon: Tags },
    { key: 'savedReplies', href: '/saved-replies', icon: MessageSquareReply },
    { key: 'templates',    href: '/templates',     icon: FileText },
    { key: 'deals',        href: '/deals',         icon: BriefcaseBusiness },
    { key: 'tasks',        href: '/tasks',         icon: CheckSquare },
    { key: 'broadcasts',   href: '/broadcasts',    icon: Send },
    { key: 'settings',     href: '/settings',      icon: Settings },
  ];

  const salesNav = [
    { key: 'leads', href: '/leads', icon: Target, liveKey: 'leadsNeedsAttention' as const },
  ];

  const adminNav = [
    { key: 'users',       href: '/admin/users',        icon: UserCog },
    { key: 'teams',       href: '/admin/teams',         icon: UsersRound },
    { key: 'customerAi',  href: '/admin/customer-ai',  icon: Bot },
    { key: 'chatbot',     href: '/admin/chatbot',       icon: Sparkles },
  ];

  function NavItem({
    item,
  }: {
    item: {
      key: string;
      href: string;
      icon: React.ElementType;
      liveKey?: keyof typeof liveCounts;
    };
  }) {
    const active = !!pathname?.startsWith(item.href);
    const count = item.liveKey != null ? liveCounts[item.liveKey] : null;
    const showBadge = typeof count === 'number' && count > 0;

    return (
      <li>
        <Link
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex items-center gap-3 rounded-xl py-2.5 pe-3 ps-4 text-sm transition-all duration-150',
            active
              ? 'font-bold text-gray-900 dark:text-white'
              : 'font-medium text-gray-500 dark:text-[#8696A0] hover:text-gray-900 dark:hover:text-white',
          )}
        >
          {/* Active leading accent bar (flips side automatically via start-0) */}
          {active && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 start-0 w-1.5 rounded-full bg-[#16A34A] dark:bg-[#25D366]"
            />
          )}
          <item.icon
            className={cn(
              'h-[18px] w-[18px] shrink-0 transition-colors duration-150',
              active
                ? 'text-[#16A34A] dark:text-[#25D366]'
                : 'text-gray-400 dark:text-[#8696A0] group-hover:text-gray-600 dark:group-hover:text-white',
            )}
          />
          <span className="flex-1 truncate">{t(`nav.${item.key}`)}</span>
          {showBadge ? (
            <span className="flex h-5 min-w-[22px] items-center justify-center rounded-md bg-gray-900 px-1.5 text-[10px] font-bold text-white dark:bg-white/15 dark:text-white">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Link>
      </li>
    );
  }

  const inner = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/logo-tight.png"
          alt={t('appName')}
          className="h-10 w-10 shrink-0 rounded-2xl shadow-[0_8px_20px_-6px_rgba(13,77,46,0.6)]"
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight text-gray-900 dark:text-white">
            {t('appName')}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-[#8696A0]">
            {t('appSubtitle')}
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">

        {/* Main menu */}
        <div>
          <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-[#8696A0]">
            {t('menu')}
          </p>
          <ul className="space-y-1">
            {mainNav.map((item) => <NavItem key={item.key} item={item} />)}
          </ul>
        </div>

        {/* Sales Intelligence section */}
        <div>
          <div className="mb-2 flex items-center gap-2 px-2">
            <Target className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#25D366]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#16A34A] dark:text-[#25D366]">
              {t('salesIntelligence')}
            </p>
          </div>
          <ul className="space-y-1">
            {salesNav.map((item) => <NavItem key={item.key} item={item} />)}
          </ul>
        </div>

        {/* Admin-only section */}
        {isAdmin && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-2">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                {t('admin')}
              </p>
            </div>
            <ul className="space-y-1">
              {adminNav.map((item) => <NavItem key={item.key} item={item} />)}
            </ul>
          </div>
        )}

        {/* Operator-only: manage every client business (multi-tenant console) */}
        {isOperator && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-2">
              <Building2 className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#25D366]" />
              <p className="text-xs font-semibold uppercase tracking-wider text-[#16A34A] dark:text-[#25D366]">
                Operator
              </p>
            </div>
            <ul className="space-y-1">
              <li>
                <Link
                  href="/platform"
                  onClick={() => setOpen(false)}
                  aria-current={pathname?.startsWith('/platform') ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl py-2.5 pe-3 ps-4 text-sm transition-all duration-150',
                    pathname?.startsWith('/platform')
                      ? 'font-bold text-gray-900 dark:text-white'
                      : 'font-medium text-gray-500 dark:text-[#8696A0] hover:text-gray-900 dark:hover:text-white',
                  )}
                >
                  {pathname?.startsWith('/platform') && (
                    <span aria-hidden="true" className="absolute inset-y-1 start-0 w-1.5 rounded-full bg-[#16A34A] dark:bg-[#25D366]" />
                  )}
                  <Building2
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors duration-150',
                      pathname?.startsWith('/platform')
                        ? 'text-[#16A34A] dark:text-[#25D366]'
                        : 'text-gray-400 dark:text-[#8696A0] group-hover:text-gray-600 dark:group-hover:text-white',
                    )}
                  />
                  <span className="flex-1 truncate">Clients</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      {/* connection */}
      <div className="flex justify-center px-3 pb-4 pt-2">
        {/* Live WhatsApp connection — inline QR when offline */}
        <SidebarConnect />
      </div>
    </>
  );

  return (
    <>
      {/* Mobile: hamburger toggle — flips side in RTL */}
      {!open && (
        <button
          type="button"
          aria-label={t('openSidebar')}
          onClick={() => setOpen(true)}
          className={cn(
            'fixed top-4 z-50 hidden sm:inline-flex items-center justify-center rounded-md p-2 text-gray-700 bg-white shadow-md lg:hidden dark:bg-[#111B21] dark:text-white',
            isRTL ? 'right-4' : 'left-4',
          )}
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile sliding panel — slides from start edge (left in LTR, right in RTL) */}
      <div
        className={cn(
          'fixed inset-y-0 z-40 w-64 transform transition-transform duration-200 lg:hidden',
          isRTL
            ? cn('right-0', open ? 'translate-x-0' : 'translate-x-full')
            : cn('left-0',  open ? 'translate-x-0' : '-translate-x-full'),
        )}
        aria-hidden={!open}
      >
        <div className="relative h-full border-e border-gray-200 dark:border-white/5 bg-white dark:bg-[#111B21]">
          <button
            type="button"
            aria-label={t('closeSidebar')}
            onClick={() => setOpen(false)}
            className={cn(
              'absolute top-3 inline-flex items-center justify-center rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:text-white lg:hidden',
              isRTL ? 'left-3' : 'right-3',
            )}
          >
            <X className="h-5 w-5" />
          </button>
          {inner}
        </div>
      </div>

      {/* Desktop sidebar — blends into the white app container */}
      <aside className="hidden w-[248px] shrink-0 bg-transparent lg:flex lg:flex-col">
        {inner}
      </aside>
    </>
  );
}
