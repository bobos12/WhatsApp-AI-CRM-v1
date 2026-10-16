'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { UsersRound, Plus, Pencil, Trash2, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../../../../lib/api';
import { Modal } from '../../../../components/ui/modal';
import { isManager, roleLabel } from '../../../../lib/roles';
import { useLiveData } from '../../../../hooks/useLiveData';

type Member = { id: string; name: string; email: string; role: string };
type Team   = { id: string; name: string; autoAssign: boolean; owner: { id: string; name: string }; members: Member[] };
type User   = { id: string; name: string; email: string; role: string; teamId: string | null };

export default function AdminTeamsPage() {
  const { t } = useTranslation('admin');
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [teams, setTeams]           = useState<Team[]>([]);
  const [allUsers, setAllUsers]     = useState<User[]>([]);
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState<Team | null>(null);
  const [teamName, setTeamName]     = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [expandedTeam, setExpanded] = useState<string | null>(null);
  const [addUserId, setAddUserId]   = useState('');

  useEffect(() => {
    if (status === 'loading') return;
    if (!isManager(role)) router.replace('/dashboard');
  }, [role, status, router]);

  const loadData = useCallback(async () => {
    const [teamsData, usersData] = await Promise.all([
      api.get('/api/teams/all'),
      api.get('/api/users'),
    ]);
    setTeams(Array.isArray(teamsData) ? teamsData : []);
    setAllUsers(Array.isArray(usersData) ? usersData : []);
  }, []);
  useLiveData(['teams', 'users'], loadData);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setTeamName(editing ? editing.name : '');
  }, [editing, showForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) { setError(t('teams.form.teamName')); return; }
    setError(''); setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/teams/${editing.id}`, { name: teamName });
        setSuccess(t('teams.toast.updated'));
      } else {
        await api.post('/api/teams', { name: teamName });
        setSuccess(t('teams.toast.created'));
      }
      setShowForm(false); setEditing(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (team: Team) => {
    if (!window.confirm(t('teams.deleteConfirm', { name: team.name }))) return;
    try {
      await api.delete(`/api/teams/${team.id}`);
      setSuccess(t('teams.toast.deleted'));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete team');
    }
  };

  const handleAddMember = async (teamId: string) => {
    if (!addUserId) return;
    try {
      await api.post(`/api/teams/${teamId}/members`, { userId: addUserId });
      setAddUserId(''); setSuccess(t('teams.toast.memberAdded'));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  };

  const handleToggleAutoAssign = async (team: Team) => {
    try {
      await api.put(`/api/teams/${team.id}/auto-assign`, { autoAssign: !team.autoAssign });
      setSuccess(!team.autoAssign
        ? t('teams.toast.autoAssignEnabled', { name: team.name })
        : t('teams.toast.autoAssignDisabled', { name: team.name }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update setting');
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    try {
      await api.delete(`/api/teams/${teamId}/members/${userId}`);
      setSuccess(t('teams.toast.memberRemoved'));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  if (status === 'loading' || !isManager(role)) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={t('teams.title')}
        meta={<span className="chip chip-warn gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{t('badge')}</span>}
        description={t('teams.subtitle')}
        actions={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary inline-flex">
            <Plus className="h-4 w-4" />
            {t('teams.newTeam')}
          </button>
        }
      />

      {error   && <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 dark:border-emerald-500/30 bg-green-50 dark:bg-emerald-500/10 px-4 py-3 text-sm text-green-700 dark:text-emerald-300">{success}</div>}

      {/* Teams list */}
      <div className="space-y-4">
        {teams.length === 0 && (
          <div className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-ink-3">
            {t('teams.noTeams')}
          </div>
        )}
        {teams.map((team) => {
          const isExpanded  = expandedTeam === team.id;
          const memberIds   = new Set(team.members.map((m) => m.id));
          const available   = allUsers.filter((u) => !memberIds.has(u.id));

          return (
            <div key={team.id} className="rounded-xl border border-line bg-surface overflow-hidden">
              {/* Team header row */}
              <div className="flex items-center justify-between px-5 py-4">
                <button
                  type="button"
                  className="flex items-center gap-3 text-left"
                  onClick={() => setExpanded(isExpanded ? null : team.id)}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand">
                    <UsersRound className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{team.name}</p>
                    <p className="text-xs text-ink-3">{t(team.members.length !== 1 ? 'teams.memberCountPlural' : 'teams.memberCount', { count: team.members.length })}</p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleAutoAssign(team)}
                    title={team.autoAssign ? t('teams.autoAssignDisable') : t('teams.autoAssignEnable')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      team.autoAssign
                        ? 'border-brand/40 bg-brand/10 text-brand'
                        : 'border-line bg-white dark:bg-raised text-gray-500 dark:text-gray-400 hover:bg-raised'
                    }`}
                  >
                    {team.autoAssign ? t('teams.autoAssignOn') : t('teams.autoAssignOff')}
                  </button>
                  <button
                    onClick={() => { setEditing(team); setShowForm(true); }}
                    className="btn btn-secondary btn-sm inline-flex"
                  >
                    <Pencil className="h-3 w-3" /> {t('teams.rename')}
                  </button>
                  <button
                    onClick={() => handleDelete(team)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> {t('teams.delete')}
                  </button>
                </div>
              </div>

              {/* Expanded: members */}
              {isExpanded && (
                <div className="border-t border-line px-5 py-4 space-y-3">
                  {/* Member list */}
                  {team.members.length > 0 ? (
                    <ul className="space-y-2">
                      {team.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between rounded-lg bg-raised px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                              {m.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-ink">{m.name}</p>
                              <p className="text-xs text-ink-3">{roleLabel(m.role)}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(team.id, m.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors"
                          >
                            <UserMinus className="h-3 w-3" /> {t('teams.remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-4">{t('teams.noMembers')}</p>
                  )}

                  {/* Add member */}
                  {available.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <select
                        value={addUserId}
                        onChange={(e) => setAddUserId(e.target.value)}
                        className="field field-sm flex-1 h-9"
                      >
                        <option value="">{t('teams.selectUser')}</option>
                        {available.map((u) => (
                          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAddMember(team.id)}
                        disabled={!addUserId}
                        className="btn btn-primary btn-sm inline-flex disabled:opacity-40"
                      >
                        <UserPlus className="h-3 w-3" /> {t('teams.add')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        aria-label={editing ? t('teams.form.renameTitle') : t('teams.form.createTitle')}
        overlayClassName="bg-black/70"
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-pop"
      >
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-3 mb-5">
              <UsersRound className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white">{editing ? t('teams.form.renameTitle') : t('teams.form.createTitle')}</h2>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('teams.form.teamName')}</label>
              <input
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="field w-full"
                placeholder={t('teams.form.teamNamePlaceholder')}
              />
            </div>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="btn btn-secondary"
              >
                {t('teams.form.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? t('teams.form.saving') : editing ? t('teams.form.rename') : t('teams.form.createTeam')}
              </button>
            </div>
          </form>
      </Modal>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
