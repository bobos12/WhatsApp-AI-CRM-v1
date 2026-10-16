/**
 * Pre-flight types, mirroring apps/backend/src/broadcasts/preflight.service.ts.
 *
 * These used to describe a ban-prevention engine: a risk score, an account
 * health grade, contact quality tiers, a pacing recommendation. All of that
 * existed because the CRM sent over an unofficial WhatsApp Web library, where
 * volume alone could get a number banned. On the official Cloud API those
 * constraints are Meta's and are published directly — a messaging limit tier and
 * a quality rating — so the report now carries what Meta actually enforces plus
 * the one thing that genuinely blocks a campaign: an approved template.
 */

export type FindingKind = 'blocker' | 'warning' | 'tip';

export type QualityRating = 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED';

export interface PreflightFinding {
  key: string;
  kind: FindingKind;
  label: string;
  detail: string;
  /** Values for the translated wording (`safety.findings.<key>`). */
  params?: Record<string, string | number>;
  fix?: {
    action: 'choose_template' | 'connect_channel' | 'exclude_already_received';
    label: string;
    /** For `exclude_already_received`: the earlier campaign to leave out. */
    broadcastId?: string;
  };
}

export interface PreflightReport {
  generatedAt: string;
  canSend: boolean;
  findings: PreflightFinding[];
  audience: {
    requested: number;
    deliverable: number;
    invalid: number;
    duplicates: number;
    alreadyReceived: number;
  };
  channel: {
    connected: boolean;
    displayPhoneNumber: string | null;
    qualityRating: QualityRating;
    /** Meta tier string, e.g. "TIER_1K". */
    messagingLimit: string | null;
  };
  template: { id: string; name: string; status: string | null } | null;
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** Meta's tier strings are machine-shaped; render them for humans. */
export function formatMessagingLimit(tier: string | null): string {
  if (!tier) return 'Not set yet';
  const value = tier.replace(/^TIER_/, '');
  if (value === 'UNLIMITED') return 'Unlimited';
  return `${value} conversations/day`;
}

export function qualityLabel(rating: QualityRating): string {
  switch (rating) {
    case 'GREEN': return 'High quality';
    case 'YELLOW': return 'Medium quality';
    case 'RED': return 'Low quality';
    default: return 'Not rated yet';
  }
}

export function qualityTone(rating: QualityRating): 'good' | 'warn' | 'bad' | 'neutral' {
  switch (rating) {
    case 'GREEN': return 'good';
    case 'YELLOW': return 'warn';
    case 'RED': return 'bad';
    default: return 'neutral';
  }
}

export function blockers(report: PreflightReport | null | undefined): PreflightFinding[] {
  return (report?.findings ?? []).filter((f) => f.kind === 'blocker');
}

export function warnings(report: PreflightReport | null | undefined): PreflightFinding[] {
  return (report?.findings ?? []).filter((f) => f.kind !== 'blocker');
}
