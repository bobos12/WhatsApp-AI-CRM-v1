import {
  Home, MessageSquare, Users, Send, Settings, Tags, MessageSquareReply,
  BriefcaseBusiness, CheckSquare, UserCog, UsersRound, FileText, Bot,
  Target, Sparkles, Building2, type LucideIcon,
} from 'lucide-react';

/**
 * The one navigation model. Sidebar, mobile drawer and the command palette all
 * read this list, so a route can't be reachable from one and missing from another.
 *
 * Grouped by the job, not by the data type: the daily loop (home, inbox,
 * people, pipeline) first; reaching out to many people second; configuration
 * last and only for the roles that can change it.
 */
export type LiveKey = 'openConversations' | 'leadsNeedsAttention';

export interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  liveKey?: LiveKey;
  /** Extra path prefixes that should light this item up. */
  match?: string[];
}

export interface NavGroup {
  key: 'workspace' | 'outreach' | 'admin' | 'operator';
  items: NavItem[];
  managerOnly?: boolean;
  operatorOnly?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'workspace',
    items: [
      { key: 'dashboard',     href: '/dashboard',     icon: Home },
      { key: 'conversations', href: '/conversations', icon: MessageSquare, liveKey: 'openConversations' },
      { key: 'contacts',      href: '/contacts',      icon: Users },
      { key: 'leads',         href: '/leads',         icon: Target, liveKey: 'leadsNeedsAttention' },
      { key: 'deals',         href: '/deals',         icon: BriefcaseBusiness },
      { key: 'tasks',         href: '/tasks',         icon: CheckSquare },
    ],
  },
  {
    key: 'outreach',
    items: [
      { key: 'broadcasts',   href: '/broadcasts',    icon: Send },
      { key: 'templates',    href: '/templates',     icon: FileText },
      { key: 'savedReplies', href: '/saved-replies', icon: MessageSquareReply },
      { key: 'tags',         href: '/tags',          icon: Tags },
    ],
  },
  {
    key: 'admin',
    managerOnly: true,
    items: [
      { key: 'customerAi', href: '/admin/customer-ai', icon: Bot },
      { key: 'chatbot',    href: '/admin/chatbot',     icon: Sparkles, match: ['/admin/ai-config'] },
      { key: 'users',      href: '/admin/users',       icon: UserCog },
      { key: 'teams',      href: '/admin/teams',       icon: UsersRound },
    ],
  },
  {
    key: 'operator',
    operatorOnly: true,
    items: [{ key: 'clients', href: '/platform', icon: Building2 }],
  },
];

/** Settings sits in the account area rather than a group: everyone has it. */
export const SETTINGS_ITEM: NavItem = { key: 'settings', href: '/settings', icon: Settings };

export function isActive(pathname: string | null | undefined, item: NavItem): boolean {
  if (!pathname) return false;
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function visibleGroups(opts: { manager: boolean; operator: boolean }): NavGroup[] {
  return NAV_GROUPS.filter((g) => (!g.managerOnly || opts.manager) && (!g.operatorOnly || opts.operator));
}
