'use client';

import { useState, useCallback } from 'react';
import {
  X,
  MessageSquare,
  ExternalLink,
  HelpCircle,
  User,
  ShoppingBag,
  Calendar,
  HeadphonesIcon,
  CreditCard,
  Package,
  Zap,
  ChevronRight,
  Send,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InteractivePreset {
  id: string;
  category: PresetCategory;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  build: () => SidebarMessage;
}

export interface SidebarMessage {
  /** Text body sent to WhatsApp */
  text: string;
  /** Optional numbered options appended after the body */
  options?: Array<{ label: string; action?: string; value?: string }>;
  /** Parsed trigger map: reply "1" → options[0].action */
  triggerMap?: Record<string, string>;
}

type PresetCategory =
  | 'quick_replies'
  | 'cta'
  | 'faq'
  | 'support'
  | 'ecommerce'
  | 'appointment'
  | 'payment'
  | 'custom';

interface InteractiveSidebarProps {
  onSend: (message: SidebarMessage) => void;
  onClose: () => void;
  contactName?: string;
}

// ── Preset catalog ────────────────────────────────────────────────────────────

function buildNumberedMenu(body: string, options: Array<{ label: string; action?: string; value?: string }>): SidebarMessage {
  const lines = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  const triggerMap: Record<string, string> = {};
  options.forEach((o, i) => { if (o.action) triggerMap[String(i + 1)] = o.action; });
  return {
    text: `${body}\n\n${lines}\n\nReply with the number of your choice.`,
    options,
    triggerMap,
  };
}

const PRESETS: InteractivePreset[] = [
  // ── Quick Replies ──────────────────────────────────────────────────────────
  {
    id: 'quick_reply_order',
    category: 'quick_replies',
    label: 'Order Help',
    description: 'Track, modify, or cancel an order',
    icon: Package,
    color: 'from-violet-500 to-purple-600',
    build: () => buildNumberedMenu(
      'How can I help you with your order?',
      [
        { label: 'Track my order', action: 'track_order' },
        { label: 'Modify order', action: 'modify_order' },
        { label: 'Cancel order', action: 'cancel_order' },
        { label: 'Report an issue', action: 'order_issue' },
      ],
    ),
  },
  {
    id: 'quick_reply_support',
    category: 'quick_replies',
    label: 'Support Menu',
    description: 'Route customers to the right team',
    icon: HeadphonesIcon,
    color: 'from-blue-500 to-cyan-600',
    build: () => buildNumberedMenu(
      'Welcome! How can we help you today?',
      [
        { label: 'Technical support', action: 'tech_support' },
        { label: 'Billing question', action: 'billing' },
        { label: 'Account issue', action: 'account' },
        { label: 'Talk to an agent', action: 'agent' },
      ],
    ),
  },
  {
    id: 'quick_reply_product',
    category: 'quick_replies',
    label: 'Product Options',
    description: 'Present product or plan choices',
    icon: ShoppingBag,
    color: 'from-emerald-500 to-teal-600',
    build: () => buildNumberedMenu(
      'Which product are you interested in?',
      [
        { label: 'Starter Plan', action: 'plan_starter' },
        { label: 'Pro Plan', action: 'plan_pro' },
        { label: 'Enterprise', action: 'plan_enterprise' },
        { label: 'Compare all plans', action: 'compare_plans' },
      ],
    ),
  },
  // ── CTA Buttons ───────────────────────────────────────────────────────────
  {
    id: 'cta_website',
    category: 'cta',
    label: 'Visit Website',
    description: 'Send a link with a clear call to action',
    icon: ExternalLink,
    color: 'from-sky-500 to-blue-600',
    build: () => ({
      text: 'Visit our website to learn more:\nhttps://example.com',
    }),
  },
  {
    id: 'cta_book',
    category: 'cta',
    label: 'Book a Call',
    description: 'Send a booking link',
    icon: Calendar,
    color: 'from-rose-500 to-pink-600',
    build: () => ({
      text: 'Book a free consultation with our team:\nhttps://calendly.com/yourteam',
    }),
  },
  // ── FAQ ───────────────────────────────────────────────────────────────────
  {
    id: 'faq_general',
    category: 'faq',
    label: 'Common FAQs',
    description: 'Top frequently asked questions',
    icon: HelpCircle,
    color: 'from-amber-500 to-orange-600',
    build: () => buildNumberedMenu(
      'Here are our most frequently asked questions:',
      [
        { label: 'What are your hours?', action: 'faq_hours' },
        { label: 'How long does shipping take?', action: 'faq_shipping' },
        { label: 'What is your return policy?', action: 'faq_returns' },
        { label: 'How do I contact support?', action: 'faq_contact' },
      ],
    ),
  },
  // ── Appointment ───────────────────────────────────────────────────────────
  {
    id: 'appointment_reminder',
    category: 'appointment',
    label: 'Appointment Reminder',
    description: 'Confirm or reschedule an appointment',
    icon: Calendar,
    color: 'from-indigo-500 to-violet-600',
    build: () => buildNumberedMenu(
      'This is a reminder about your upcoming appointment.\n\nPlease confirm your attendance:',
      [
        { label: 'Confirm — I will attend', action: 'confirm_appointment' },
        { label: 'Reschedule', action: 'reschedule_appointment' },
        { label: 'Cancel appointment', action: 'cancel_appointment' },
      ],
    ),
  },
  // ── Payment ───────────────────────────────────────────────────────────────
  {
    id: 'payment_request',
    category: 'payment',
    label: 'Payment Request',
    description: 'Send a payment link',
    icon: CreditCard,
    color: 'from-green-500 to-emerald-600',
    build: () => ({
      text: 'Your payment link is ready:\nhttps://pay.example.com/invoice/12345\n\nReply "PAID" once completed or "HELP" for assistance.',
    }),
  },
  {
    id: 'payment_options',
    category: 'payment',
    label: 'Payment Methods',
    description: 'Let customer choose payment method',
    icon: CreditCard,
    color: 'from-teal-500 to-green-600',
    build: () => buildNumberedMenu(
      'How would you like to pay?',
      [
        { label: 'Credit/Debit card', action: 'pay_card' },
        { label: 'Bank transfer', action: 'pay_bank' },
        { label: 'Mobile wallet', action: 'pay_wallet' },
        { label: 'Cash on delivery', action: 'pay_cash' },
      ],
    ),
  },
  // ── E-commerce ────────────────────────────────────────────────────────────
  {
    id: 'order_tracking',
    category: 'ecommerce',
    label: 'Order Status',
    description: 'Ask customer for their order number',
    icon: Package,
    color: 'from-fuchsia-500 to-purple-600',
    build: () => ({
      text: 'I can help you track your order!\n\nPlease reply with your order number (e.g. *#12345*) and I will look it up right away.',
    }),
  },
  {
    id: 'delivery_update',
    category: 'ecommerce',
    label: 'Delivery Update',
    description: 'Inform customer about delivery status',
    icon: Package,
    color: 'from-orange-500 to-amber-600',
    build: () => buildNumberedMenu(
      'Your order is on its way! Would you like to:',
      [
        { label: 'Get live tracking link', action: 'get_tracking' },
        { label: 'Change delivery address', action: 'change_address' },
        { label: 'Schedule redelivery', action: 'schedule_redelivery' },
      ],
    ),
  },
  // ── Support Actions ───────────────────────────────────────────────────────
  {
    id: 'escalate_agent',
    category: 'support',
    label: 'Escalate to Agent',
    description: 'Transfer to human support',
    icon: User,
    color: 'from-slate-500 to-gray-600',
    build: () => ({
      text: 'I am connecting you to a live agent now.\n\nPlease hold for a moment — a support specialist will be with you shortly. ⏳',
    }),
  },
  {
    id: 'feedback_request',
    category: 'support',
    label: 'Request Feedback',
    description: 'Ask for a satisfaction rating',
    icon: MessageSquare,
    color: 'from-pink-500 to-rose-600',
    build: () => buildNumberedMenu(
      'We hope we resolved your issue! How would you rate your experience?',
      [
        { label: '⭐⭐⭐⭐⭐ Excellent', action: 'rating_5' },
        { label: '⭐⭐⭐⭐ Good', action: 'rating_4' },
        { label: '⭐⭐⭐ Average', action: 'rating_3' },
        { label: '⭐⭐ Poor', action: 'rating_2' },
      ],
    ),
  },
];

const CATEGORY_META: Record<PresetCategory, { label: string; icon: React.ElementType }> = {
  quick_replies: { label: 'Quick Replies', icon: MessageSquare },
  cta:           { label: 'CTA Buttons', icon: ExternalLink },
  faq:           { label: 'FAQ', icon: HelpCircle },
  support:       { label: 'Support', icon: HeadphonesIcon },
  ecommerce:     { label: 'E-commerce', icon: ShoppingBag },
  appointment:   { label: 'Appointments', icon: Calendar },
  payment:       { label: 'Payments', icon: CreditCard },
  custom:        { label: 'Custom', icon: Zap },
};

const CATEGORIES = Object.keys(CATEGORY_META) as PresetCategory[];

// ── Custom message builder ────────────────────────────────────────────────────

function CustomBuilder({ onSend }: { onSend: (msg: SidebarMessage) => void }) {
  const [body, setBody] = useState('');
  const [optionsRaw, setOptionsRaw] = useState('');

  const handleSend = useCallback(() => {
    if (!body.trim()) return;
    const lines = optionsRaw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length) {
      onSend(buildNumberedMenu(body.trim(), lines.map(l => ({ label: l }))));
    } else {
      onSend({ text: body.trim() });
    }
    setBody('');
    setOptionsRaw('');
  }, [body, optionsRaw, onSend]);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-3 uppercase tracking-wider">Message</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type your message…"
          rows={3}
          className="field w-full resize-none transition-colors"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-3 uppercase tracking-wider">
          Options <span className="normal-case font-normal">(one per line, optional)</span>
        </label>
        <textarea
          value={optionsRaw}
          onChange={e => setOptionsRaw(e.target.value)}
          placeholder={'Track Order\nContact Support\nTalk to Agent'}
          rows={4}
          className="field w-full resize-none transition-colors"
        />
      </div>
      {body.trim() && (
        <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Preview</p>
          <p className="whitespace-pre-wrap text-xs text-ink">
            {body.trim()}
            {optionsRaw.trim() && (
              <>
                {'\n\n'}
                {optionsRaw.split('\n').filter(l => l.trim()).map((l, i) => `${i + 1}. ${l.trim()}`).join('\n')}
                {'\n\nReply with the number of your choice.'}
              </>
            )}
          </p>
        </div>
      )}
      <button
        type="button"
        disabled={!body.trim()}
        onClick={handleSend}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
        Send Message
      </button>
    </div>
  );
}

// ── Preset card ───────────────────────────────────────────────────────────────

function PresetCard({ preset, onSend }: { preset: InteractivePreset; onSend: (msg: SidebarMessage) => void }) {
  const Icon = preset.icon;
  const [preview, setPreview] = useState<SidebarMessage | null>(null);

  return (
    <div className="group rounded-xl border border-line bg-surface transition-all hover:border-brand/30 hover:shadow-[0_0_0_1px_rgba(37,211,102,0.15)]">
      <div className="flex items-start gap-3 p-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${preset.color}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{preset.label}</p>
          <p className="mt-0.5 text-xs text-ink-3">{preset.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPreview(prev => prev ? null : preset.build())}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-3 hover:bg-white/5 hover:text-white transition-colors"
          >
            {preview ? 'Hide' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => { onSend(preset.build()); }}
            className="flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/20 transition-colors"
          >
            <Send className="h-3 w-3" />
            Send
          </button>
        </div>
      </div>

      {preview && (
        <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-white/10 bg-[#0B1419]">
          <p className="border-b border-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            WhatsApp Preview
          </p>
          <pre className="whitespace-pre-wrap px-3 py-2.5 text-xs leading-relaxed text-ink font-sans">
            {preview.text}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function InteractiveSidebar({ onSend, onClose, contactName }: InteractiveSidebarProps) {
  const [activeCategory, setActiveCategory] = useState<PresetCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const filteredPresets = PRESETS.filter(p => {
    const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
    const matchesSearch = !search || p.label.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categoriesInUse = Array.from(new Set(PRESETS.map(p => p.category)));

  return (
    <div className="flex h-full flex-col bg-[#0B1419] border-l border-white/8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-4 gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">Interactive Messages</h2>
          {contactName && <p className="text-xs text-ink-3 truncate">To: {contactName}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-ink-3 hover:bg-white/15 hover:text-white transition-colors"
          aria-label="Close interactive messages"
          title="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 fill-ink-3" aria-hidden>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search presets…"
            className="field w-full pl-8 pr-3 transition-colors"
          />
        </div>
      </div>

      {/* Category tabs — horizontal scroll */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            activeCategory === 'all'
              ? 'bg-brand text-brand-fg'
              : 'bg-white/8 text-ink-3 hover:bg-white/12 hover:text-white'
          }`}
        >
          All
        </button>
        {categoriesInUse.map(cat => {
          const meta = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                activeCategory === cat
                  ? 'bg-brand text-brand-fg'
                  : 'bg-white/8 text-ink-3 hover:bg-white/12 hover:text-white'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Preset list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeCategory === 'custom' ? (
          <CustomBuilder onSend={onSend} />
        ) : filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-ink-3 opacity-40" aria-hidden>
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            <p className="mt-3 text-sm text-ink-3">No presets match your search</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredPresets.map(preset => (
              <PresetCard key={preset.id} preset={preset} onSend={onSend} />
            ))}

            {/* Custom builder at the bottom */}
            <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-surface p-3">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-gray-600">
                  <Zap className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Custom Message</p>
                  <p className="text-xs text-ink-3">Build your own numbered menu</p>
                </div>
              </div>
              <CustomBuilder onSend={onSend} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
