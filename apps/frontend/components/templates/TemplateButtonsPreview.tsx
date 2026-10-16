'use client';

import { useTranslation } from 'react-i18next';
import { Reply, ExternalLink, Phone, Copy, List } from 'lucide-react';
import type { TemplateButton } from '@/lib/template-engine/schema';

const ICONS = { QUICK_REPLY: Reply, URL: ExternalLink, PHONE_NUMBER: Phone, COPY_CODE: Copy } as const;

/**
 * Footer + buttons drawn the way WhatsApp draws them under a template bubble:
 * hairline-separated rows in link blue, an icon before each label, and — past
 * three buttons — the first two plus "See all options", exactly as the phone
 * collapses them. Shared by the builder, the campaign preview and the picker so
 * all three show one truth.
 */
export function TemplateFooterLine({ text, className = '' }: { text?: string; className?: string }) {
  if (!text) return null;
  return <p dir="auto" className={`text-[12px] leading-4 opacity-60 ${className}`}>{text}</p>;
}

export default function TemplateButtonsPreview({
  buttons,
  size = 'md',
  tone = 'dark',
}: {
  buttons?: TemplateButton[];
  /** `sm` for the miniature phone in the campaign wizard. */
  size?: 'sm' | 'md';
  /** `dark` on an always-dark bubble; `auto` follows WhatsApp's light/dark bubble. */
  tone?: 'dark' | 'auto';
}) {
  const { t } = useTranslation('templates');
  if (!buttons?.length) return null;

  const collapsed = buttons.length > 3;
  const shown = collapsed ? buttons.slice(0, 2) : buttons;
  const row = size === 'sm'
    ? 'gap-1 py-1.5 text-[10px]'
    : 'gap-1.5 py-2.5 text-[13px]';
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const lines = tone === 'dark'
    ? 'divide-white/10 border-white/10'
    : 'divide-black/10 border-black/10 dark:divide-white/10 dark:border-white/10';
  const ink = tone === 'dark' ? 'text-[#53BDEB]' : 'text-[#027EB5] dark:text-[#53BDEB]';

  return (
    <div className={`divide-y border-t ${lines}`}>
      {shown.map((b, i) => {
        const Icon = ICONS[b.type];
        const label = b.type === 'COPY_CODE'
          ? (b.text || t('builder.buttons.copyCode'))
          : b.text || '…';
        return (
          <div key={i} dir="auto" className={`flex items-center justify-center px-2 font-medium ${ink} ${row}`}>
            <Icon className={`${icon} shrink-0`} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </div>
        );
      })}
      {collapsed && (
        <div className={`flex items-center justify-center px-2 font-medium ${ink} ${row}`}>
          <List className={`${icon} shrink-0`} aria-hidden="true" />
          <span className="truncate">{t('builder.buttons.seeAll')}</span>
        </div>
      )}
    </div>
  );
}
