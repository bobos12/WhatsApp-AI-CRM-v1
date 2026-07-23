'use client';

import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { isImpersonating, getImpersonationLabel, stopImpersonation } from '../../lib/api';

/**
 * Persistent bar shown across the app while the platform operator is viewing a
 * client's workspace ("impersonating"). Exiting drops the tenant-scoped token
 * and returns to the operator's own session + the console.
 */
export default function ImpersonationBanner() {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setActive(isImpersonating());
    setLabel(getImpersonationLabel());
  }, []);

  if (!active) return null;

  const exit = () => {
    stopImpersonation();
    // Full reload back to the operator console under the operator's own session.
    window.location.href = '/platform';
  };

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Viewing as {label ? <strong>{label}</strong> : 'a client'} — you are in their workspace.
      </span>
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950/15 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-950/25 transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" /> Exit
      </button>
    </div>
  );
}
