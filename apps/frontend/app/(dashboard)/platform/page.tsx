'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Plus, Trash2, Search, Users, Smartphone, CheckCircle2, PauseCircle,
  Play, Pause, LogIn, Copy, ShieldCheck, RefreshCw, X, Circle,
} from 'lucide-react';
import { api, startImpersonation } from '../../../lib/api';
import { Modal } from '../../../components/ui/modal';
import { cn } from '../../../lib/utils';
import { useToast } from '../../../hooks/useToast';
import { useOperatorAccess } from '../../../hooks/useOperatorAccess';

type WaStatus = 'connected' | 'connecting' | 'disconnected';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  users: number;
  contacts: number;
  whatsapp: { hasSession: boolean; status: WaStatus; connectedNumber: string | null };
};

const emptyForm = { name: '', ownerName: '', ownerEmail: '', ownerPassword: '' };

function StatCard({ icon: Icon, label, value, tint }: { icon: React.ElementType; label: string; value: number | string; tint: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] p-5">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tint)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold text-gray-900 dark:text-white leading-none">{value}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-[#8696A0]">{label}</p>
        </div>
      </div>
    </div>
  );
}

function WaBadge({ s, hasSession }: { s: WaStatus; hasSession: boolean }) {
  if (!hasSession) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-[#8696A0]"><Circle className="h-2 w-2 fill-current" /> Not linked</span>;
  }
  const map: Record<WaStatus, { c: string; t: string }> = {
    connected:    { c: 'text-[#25D366]', t: 'Connected' },
    connecting:   { c: 'text-amber-500 dark:text-amber-400', t: 'Connecting' },
    disconnected: { c: 'text-gray-400 dark:text-[#8696A0]', t: 'Offline' },
  };
  const m = map[s];
  return <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', m.c)}><Circle className="h-2 w-2 fill-current" /> {m.t}</span>;
}

export default function PlatformPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const { isOperator, loading: accessLoading } = useOperatorAccess();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // create modal
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  // per-row busy + delete confirm
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Guard ──
  useEffect(() => {
    if (accessLoading) return;
    if (!isOperator) router.replace('/dashboard');
  }, [isOperator, accessLoading, router]);

  // ── Load ──
  const loadTenants = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await api.get<{ tenants: Tenant[] }>('/api/platform/tenants');
      setTenants(data.tenants ?? []);
    } catch (err) {
      if (!silent) toastError(err instanceof Error ? err.message : 'Failed to load clients');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isOperator) loadTenants(); }, [isOperator, loadTenants]);

  // Poll WhatsApp/connection status live while the page is open.
  useEffect(() => {
    if (!isOperator) return;
    const id = setInterval(() => loadTenants(true), 15_000);
    return () => clearInterval(id);
  }, [isOperator, loadTenants]);

  // ── Derived ──
  const filtered = useMemo(() => {
    if (!search) return tenants;
    const q = search.toLowerCase();
    return tenants.filter((t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q));
  }, [tenants, search]);

  const stats = useMemo(() => ({
    total: tenants.length,
    active: tenants.filter((t) => t.status === 'ACTIVE').length,
    suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
    online: tenants.filter((t) => t.whatsapp.status === 'connected').length,
    contacts: tenants.reduce((s, t) => s + (t.contacts || 0), 0),
  }), [tenants]);

  // ── Actions ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Business name is required.'); return; }
    if (form.ownerEmail && !form.ownerPassword) { setFormError('A password is required when you set an owner email.'); return; }
    setSaving(true);
    try {
      await api.post('/api/platform/tenants', {
        name: form.name.trim(),
        ownerName: form.ownerName.trim() || undefined,
        ownerEmail: form.ownerEmail.trim() || undefined,
        ownerPassword: form.ownerPassword || undefined,
      });
      // Keep the credentials on screen so the operator can hand them over.
      if (form.ownerEmail) setCreated({ email: form.ownerEmail.trim(), password: form.ownerPassword });
      else setCreated(null);
      success('Client created.');
      setForm(emptyForm);
      if (!form.ownerEmail) setShowForm(false);
      await loadTenants(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (t: Tenant) => {
    setBusyId(t.id);
    const action = t.status === 'ACTIVE' ? 'suspend' : 'activate';
    try {
      await api.post(`/api/platform/tenants/${t.id}/${action}`, {});
      success(action === 'suspend' ? `${t.name} suspended.` : `${t.name} reactivated.`);
      await loadTenants(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: Tenant) => {
    setBusyId(t.id);
    setConfirmDeleteId(null);
    const snapshot = tenants;
    setTenants((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await api.delete(`/api/platform/tenants/${t.id}`);
      success(`${t.name} and all its data were deleted.`);
    } catch (err) {
      setTenants(snapshot);
      toastError(err instanceof Error ? err.message : 'Failed to delete client');
    } finally {
      setBusyId(null);
    }
  };

  const impersonate = async (t: Tenant) => {
    setBusyId(t.id);
    try {
      const { token } = await api.post<{ token: string }>(`/api/platform/tenants/${t.id}/impersonate`, {});
      if (!token) throw new Error('No token returned');
      startImpersonation(token, t.name);
      // Full reload so every provider re-initialises under the tenant token.
      window.location.href = '/dashboard';
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to open client');
      setBusyId(null);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => success('Copied.')).catch(() => {});
  };

  if (accessLoading || !isOperator) return null;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <section className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/40 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#16A34A] dark:text-[#25D366]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Operator console
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">Client Management</h1>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-[#8696A0]">
              Every business on this deployment. Create, suspend, open, or remove a client — each one is fully isolated.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => loadTenants()}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2.5 text-sm text-gray-600 dark:text-[#8696A0] hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => { setCreated(null); setForm(emptyForm); setFormError(''); setShowForm(true); }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#25D366]/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> New client
            </button>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={Building2}    label="Total clients"  value={stats.total}     tint="bg-[#25D366]/15 text-[#16A34A] dark:text-[#25D366]" />
        <StatCard icon={CheckCircle2} label="Active"         value={stats.active}    tint="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" />
        <StatCard icon={PauseCircle}  label="Suspended"      value={stats.suspended} tint="bg-amber-500/15 text-amber-600 dark:text-amber-400" />
        <StatCard icon={Smartphone}   label="WhatsApp online" value={stats.online}   tint="bg-sky-500/15 text-sky-600 dark:text-sky-400" />
        <StatCard icon={Users}        label="Total contacts" value={stats.contacts}  tint="bg-violet-500/15 text-violet-600 dark:text-violet-400" />
      </div>

      {/* ── Table ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#202C33] px-5 py-3.5">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-[#8696A0]" />
            <input
              type="text"
              placeholder="Search clients…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-[#111B21] py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#8696A0] outline-none focus:border-[#25D366]/50"
            />
          </div>
          <span className="ml-auto text-xs text-gray-500 dark:text-[#8696A0]">
            {filtered.length} {filtered.length === 1 ? 'client' : 'clients'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#202C33]">
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">Business</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">Status</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">WhatsApp</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">Members</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">Contacts</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-[#8696A0]">Created</th>
                <th className="px-5 py-3.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 w-24 rounded bg-gray-200 dark:bg-white/8" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Building2 className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-[#8696A0]/30" />
                    <p className="text-sm text-gray-500 dark:text-[#8696A0]">{search ? 'No clients match your search.' : 'No clients yet. Create your first one.'}</p>
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="group transition-colors hover:bg-gray-50 dark:hover:bg-white/3">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-sm font-bold text-white">
                          {t.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{t.name}</p>
                          <p className="truncate text-xs text-gray-400 dark:text-[#8696A0]">/{t.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-semibold',
                        t.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
                      )}>
                        {t.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <WaBadge s={t.whatsapp.status} hasSession={t.whatsapp.hasSession} />
                      {t.whatsapp.connectedNumber && (
                        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#8696A0]">{t.whatsapp.connectedNumber}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 dark:text-[#8696A0]">{t.users}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 dark:text-[#8696A0]">{t.contacts}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 dark:text-[#8696A0]">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      {confirmDeleteId === t.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-500 dark:text-red-300">Delete all data?</span>
                          <button type="button" onClick={() => handleDelete(t)} className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600 transition-colors">Yes, delete</button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-2.5 py-1 text-xs text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => impersonate(t)}
                            disabled={busyId === t.id || t.status === 'SUSPENDED'}
                            title={t.status === 'SUSPENDED' ? 'Reactivate to open' : 'Open this client’s workspace'}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
                          >
                            <LogIn className="h-3 w-3" /> Open
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStatus(t)}
                            disabled={busyId === t.id}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40 transition-colors',
                              t.status === 'ACTIVE'
                                ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                                : 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
                            )}
                          >
                            {t.status === 'ACTIVE' ? <><Pause className="h-3 w-3" /> Suspend</> : <><Play className="h-3 w-3" /> Activate</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(t.id)}
                            disabled={busyId === t.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create client modal ── */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setCreated(null); }}
        aria-label="Create client"
        overlayClassName="bg-black/70"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111B21] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.4)]"
      >
        {created ? (
          <div>
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[#25D366]" />
              <h2 className="text-lg font-semibold text-white">Client is ready</h2>
            </div>
            <p className="mb-4 text-sm text-[#8696A0]">Share these login details with the client. They log in at the same app and see only their own business.</p>
            <div className="space-y-2 rounded-xl border border-white/10 bg-[#202C33] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[#8696A0]">Email</span>
                <span className="flex items-center gap-2 text-sm text-white"><code>{created.email}</code>
                  <button type="button" onClick={() => copy(created.email)} className="text-[#8696A0] hover:text-white"><Copy className="h-3.5 w-3.5" /></button>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[#8696A0]">Password</span>
                <span className="flex items-center gap-2 text-sm text-white"><code>{created.password}</code>
                  <button type="button" onClick={() => copy(created.password)} className="text-[#8696A0] hover:text-white"><Copy className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={() => { setShowForm(false); setCreated(null); }} className="rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#25D366]/90 transition-colors">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate}>
            <div className="mb-5 flex items-center gap-3">
              <Building2 className="h-5 w-5 text-[#25D366]" />
              <h2 className="text-lg font-semibold text-white">New client</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#8696A0]">Business name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Dental" className="w-full rounded-lg border border-white/10 bg-[#202C33] px-3 py-2.5 text-sm text-white outline-none focus:border-[#25D366]" />
              </div>
              <div className="rounded-xl border border-white/5 bg-[#0B141A] p-3">
                <p className="mb-3 text-xs font-medium text-[#8696A0]">Owner login (optional — you can add members later)</p>
                <div className="space-y-3">
                  <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Owner name" className="w-full rounded-lg border border-white/10 bg-[#202C33] px-3 py-2.5 text-sm text-white outline-none focus:border-[#25D366]" />
                  <input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="owner@business.com" className="w-full rounded-lg border border-white/10 bg-[#202C33] px-3 py-2.5 text-sm text-white outline-none focus:border-[#25D366]" />
                  <input type="text" value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} placeholder="Temporary password" className="w-full rounded-lg border border-white/10 bg-[#202C33] px-3 py-2.5 text-sm text-white outline-none focus:border-[#25D366]" />
                </div>
              </div>
            </div>
            {formError && <p className="mt-3 text-xs text-red-400">{formError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-white/10 bg-[#202C33] px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#25D366]/90 transition-colors">{saving ? 'Creating…' : 'Create client'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
