'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Edit, MessageSquare, Trash2, ArrowUpDown, ArrowUp, ArrowDown, MoreHorizontal, Eye, CheckSquare, BriefcaseBusiness,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../../lib/phone';
import { localeFor } from '../../lib/format';
import { cn } from '../../lib/utils';
import Avatar from '../ui/Avatar';
import { formatFieldValue, type CustomFieldDefinition, type CustomFieldValues } from '../../lib/custom-fields';

interface ContactTag {
  tag: { id: string; name: string; color: string };
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
  createdAt: string;
  contactTags?: ContactTag[];
  customFields?: (CustomFieldValues & { avatarUrl?: string | null }) | null;
}

export type ContactSortKey = 'name' | 'phone' | 'createdAt';

interface ContactsTableProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  sortKey: ContactSortKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: ContactSortKey) => void;
  onEdit: (contact: Contact) => void;
  onDelete: (id: string) => void;
  onOpenDetails: (contact: Contact) => void;
  confirmDeleteId: string | null;
  onConfirmDelete: (id: string | null) => void;
  /** Every active custom field, rendered as its own column/row wherever a contact has a value. */
  customFieldDefs?: CustomFieldDefinition[];
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-brand" />
    : <ArrowDown className="h-3 w-3 text-brand" />;
}

/** A tag as a quiet chip — its colour is a dot, so a row of tags isn't a row of loud pills. */
export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-md bg-raised px-1.5 text-2xs font-medium text-ink-2 ring-1 ring-inset ring-line">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {name}
    </span>
  );
}

/**
 * Secondary row actions, one menu instead of five icons on every line.
 *
 * Rendered in a portal so no scrolling or clipped container can cut it off: a
 * bottom sheet on phones (thumb-reachable, like WhatsApp's own menus), and a
 * dropdown on larger screens that opens upward when there is no room below.
 */
function RowMenu({ contact, onOpenDetails, onEdit, onConfirmDelete }: {
  contact: Contact;
  onOpenDetails: (c: Contact) => void;
  onEdit: (c: Contact) => void;
  onConfirmDelete: (id: string | null) => void;
}) {
  const { t } = useTranslation('contacts');
  const { t: tChat } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const [sheet, setSheet] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const phone = window.matchMedia('(max-width: 767px)').matches;
    setSheet(phone);
    const r = btnRef.current?.getBoundingClientRect();
    if (r && !phone) {
      const W = 208; // w-52
      const up = window.innerHeight - r.bottom < 240;
      const rtl = document.documentElement.dir === 'rtl';
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: rtl ? r.left : r.right - W, up });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const item = sheet
    ? 'flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-start text-[15px] text-ink active:bg-raised'
    : 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] text-ink-2 hover:bg-raised hover:text-ink';
  const icon = sheet ? 'h-5 w-5 text-ink-3' : 'h-4 w-4 text-ink-3';
  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  const items = (
    <>
      <button type="button" className={item} onClick={run(() => onEdit(contact))}>
        <Edit className={icon} /> {t('edit', { defaultValue: 'Edit' })}
      </button>
      <button type="button" className={item} onClick={run(() => onOpenDetails(contact))}>
        <Eye className={icon} /> {t('tabs.overview')}
      </button>
      <Link href={`/tasks?contactId=${encodeURIComponent(contact.id)}`} className={item} onClick={() => setOpen(false)}>
        <CheckSquare className={icon} /> {tChat('details.createTask')}
      </Link>
      <Link href={`/deals?contactId=${encodeURIComponent(contact.id)}`} className={item} onClick={() => setOpen(false)}>
        <BriefcaseBusiness className={icon} /> {tChat('details.createDeal')}
      </Link>
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        className={cn(item, 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10')}
        onClick={run(() => onConfirmDelete(contact.id))}
      >
        <Trash2 className={cn(icon, 'text-current')} /> {t('deleteConfirm.title')}
      </button>
    </>
  );

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={t('table.actions')} className="btn btn-ghost btn-icon">
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        sheet ? (
          <div className="fixed inset-0 z-[70]" role="presentation">
            <div className="absolute inset-0 bg-[rgb(8_12_10/0.35)] animate-fade-in" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              ref={menuRef}
              role="menu"
              className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-pop animate-slide-up"
            >
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
              <p dir="auto" className="truncate px-3 pb-2 text-sm font-semibold text-ink">{contact.name || formatPhone(contact.phone)}</p>
              {items}
            </div>
          </div>
        ) : pos && (
          <div
            ref={menuRef}
            role="menu"
            className="pop-enter fixed z-[70] w-52 rounded-lg bg-surface p-1 shadow-pop"
            style={{ left: pos.left, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {items}
          </div>
        ),
        document.body,
      )}
    </>
  );
}

export default function ContactsTable({
  contacts,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onDelete,
  onOpenDetails,
  confirmDeleteId,
  onConfirmDelete,
  customFieldDefs = [],
}: ContactsTableProps) {
  const { t, i18n } = useTranslation('contacts');
  const router = useRouter();
  const locale = localeFor(i18n.language);
  const allSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const someSelected = !allSelected && contacts.some((c) => selectedIds.has(c.id));
  const chat = (c: Contact) => router.push(`/conversations?phone=${encodeURIComponent(c.phone)}`);

  const SortTh = ({ k, label }: { k: ContactSortKey; label: string }) => (
    <th scope="col" aria-sort={sortKey === k ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('inline-flex select-none items-center gap-1.5 text-2xs font-medium transition-colors', sortKey === k ? 'text-ink' : 'text-ink-3 hover:text-ink')}
      >
        {label}
        <SortIcon active={sortKey === k} dir={sortDir} />
      </button>
    </th>
  );

  const deleteConfirm = (contact: Contact) => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-red-600 dark:text-red-400">{t('deleteConfirm.title')}?</span>
      <button type="button" onClick={() => onDelete(contact.id)} className="btn btn-sm h-7 bg-red-600 px-2.5 text-white hover:bg-red-700">
        {t('yesDelete')}
      </button>
      <button type="button" onClick={() => onConfirmDelete(null)} className="btn btn-secondary btn-sm h-7 px-2.5">
        {t('deleteConfirm.cancel')}
      </button>
    </div>
  );

  return (
    <div className="border-t border-line">
      {/* ── Phone: a list, no horizontal scroll ── */}
      <ul className="divide-y divide-line md:hidden">
        {contacts.map((contact) => {
          const selected = selectedIds.has(contact.id);
          return (
            <li key={contact.id} className={cn('px-3 py-3', selected && 'bg-brand/[0.05]')}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(contact.id)}
                  aria-label={contact.name || contact.phone}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand"
                />
                <Link href={`/contacts/${contact.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Avatar src={contact.customFields?.avatarUrl} name={contact.name || contact.phone} size={40} />
                  <div className="min-w-0">
                    <p dir={contact.name ? undefined : 'ltr'} className="truncate text-sm font-medium text-ink">
                      {contact.name || <>{'‎'}{formatPhone(contact.phone)}</>}
                    </p>
                    <p dir="ltr" className="truncate text-start text-xs tabular-nums text-ink-3">{'‎'}{formatPhone(contact.phone)}</p>
                  </div>
                </Link>
                {confirmDeleteId !== contact.id && (
                  <>
                    <button type="button" onClick={() => chat(contact)} className="btn btn-ghost btn-icon" aria-label="Chat">
                      <MessageSquare aria-hidden="true" />
                    </button>
                    <RowMenu contact={contact} onOpenDetails={onOpenDetails} onEdit={onEdit} onConfirmDelete={onConfirmDelete} />
                  </>
                )}
              </div>
              {(contact.contactTags ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 ps-[3.25rem]">
                  {(contact.contactTags ?? []).map(({ tag }) => <TagChip key={tag.id} name={tag.name} color={tag.color} />)}
                </div>
              )}
              {confirmDeleteId === contact.id && <div className="mt-2 ps-[3.25rem]">{deleteConfirm(contact)}</div>}
            </li>
          );
        })}
      </ul>

      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-10 ps-4">
                <span className="sr-only">Select</span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={onToggleAll}
                  className="h-4 w-4 cursor-pointer rounded border-line-strong accent-brand"
                />
              </th>
              <SortTh k="name" label={t('table.name')} />
              <SortTh k="phone" label={t('table.phone')} />
              <th className="px-3 py-2.5 text-2xs font-medium text-ink-3">{t('table.tags')}</th>
              <th className="px-3 py-2.5 text-2xs font-medium text-ink-3">{t('form.notes')}</th>
              {customFieldDefs.map((definition) => (
                <th key={definition.id} className="whitespace-nowrap px-3 py-2.5 text-2xs font-medium text-ink-3">{definition.label}</th>
              ))}
              <SortTh k="createdAt" label={t('table.createdAt')} />
              <th className="w-px px-3 py-2.5"><span className="sr-only">{t('table.actions')}</span></th>
            </tr>
          </thead>
          <tbody className="stagger divide-y divide-line">
            {contacts.map((contact) => {
              const selected = selectedIds.has(contact.id);
              return (
                <tr key={contact.id} className={cn('group transition-colors hover:bg-raised/60', selected && 'bg-brand/[0.05]')}>
                  <td className="w-10 ps-4">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelect(contact.id)}
                      aria-label={contact.name || contact.phone}
                      className="h-4 w-4 cursor-pointer rounded border-line-strong accent-brand"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/contacts/${contact.id}`} className="inline-flex items-center gap-2.5 font-medium text-ink hover:text-brand">
                      <Avatar src={contact.customFields?.avatarUrl} name={contact.name || contact.phone} size={30} />
                      <span dir={contact.name ? undefined : 'ltr'}>{contact.name || <>{'‎'}{formatPhone(contact.phone)}</>}</span>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-2">
                    <span dir="ltr" className="inline-block">{'‎'}{formatPhone(contact.phone)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(contact.contactTags ?? []).length > 0
                        ? (contact.contactTags ?? []).map(({ tag }) => <TagChip key={tag.id} name={tag.name} color={tag.color} />)
                        : <span className="text-ink-4">—</span>}
                    </div>
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-ink-3">{contact.notes || <span className="text-ink-4">—</span>}</td>
                  {customFieldDefs.map((definition) => (
                    <td key={definition.id} className="max-w-xs truncate px-3 py-2 text-ink-3">
                      {formatFieldValue(definition, contact.customFields?.[definition.key])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-3">
                    {new Date(contact.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {confirmDeleteId === contact.id ? deleteConfirm(contact) : (
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <button type="button" onClick={() => chat(contact)} className="btn btn-ghost btn-icon btn-sm" title="Chat" aria-label="Chat">
                          <MessageSquare aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => onEdit(contact)} className="btn btn-ghost btn-icon btn-sm" title={t('edit', { defaultValue: 'Edit' })} aria-label={t('edit', { defaultValue: 'Edit' })}>
                          <Edit aria-hidden="true" />
                        </button>
                        <RowMenu contact={contact} onOpenDetails={onOpenDetails} onEdit={onEdit} onConfirmDelete={onConfirmDelete} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
