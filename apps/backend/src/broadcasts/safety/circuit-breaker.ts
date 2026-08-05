/**
 * ─── Send circuit breaker ────────────────────────────────────────────────────
 *
 * The runtime half of account safety. The pre-flight report reasons about a
 * campaign before it starts; this watches what WhatsApp actually says back while
 * it runs, and stops the run when the answers turn bad.
 *
 * This is the single most important thing missing from the old worker. Its send
 * loop caught every error, wrote `status: 'failed'` on the recipient, and moved
 * to the next number — so a 5,000-recipient campaign against a number WhatsApp
 * had just time-locked would work its way through all five thousand, collecting
 * five thousand refusals. Each of those refusals is a strike. The loop that was
 * supposed to deliver a campaign was instead methodically demolishing the
 * account, at one strike every two seconds, and reporting it as "0 sent,
 * 5000 failed" at the end.
 *
 * Three escalating responses:
 *
 *   • **Slow down** — failures are elevated but not conclusive. Widen the gaps
 *     and keep going.
 *   • **Pause** — something is wrong that time may fix (socket dropped, quota
 *     hit). Park the campaign; the scheduler retries later. Nothing is marked
 *     failed, because nothing was refused.
 *   • **Halt** — WhatsApp is actively refusing this account's traffic. Stop the
 *     campaign, flag the account, and tell the user plainly what happened.
 */

export type BreakerAction = 'CONTINUE' | 'SLOW_DOWN' | 'PAUSE' | 'HALT';

export interface BreakerVerdict {
  action: BreakerAction;
  /** Multiplier the pacer should apply to its delays. 1 = unchanged. */
  slowdown: number;
  reason: string | null;
  /** Machine-readable cause, persisted on the campaign for the UI. */
  code: string | null;
}

/** Consecutive failures that mean "this isn't bad luck". */
const CONSECUTIVE_FAILURE_LIMIT = Number(process.env.BROADCAST_BREAKER_CONSECUTIVE ?? 5);
/** Sliding window used for rate-based checks. */
const WINDOW_SIZE = 20;
/** Failure rate in the window that trips a pause. */
const WINDOW_FAILURE_HALT = 0.5;
/** Failure rate that merely slows things down. */
const WINDOW_FAILURE_SLOW = 0.25;
/** Any of these, even once, is conclusive. */
const HALT_CODES = new Set(['COLD_REACHOUT_463']);
/** These mean "come back later", not "you are in trouble". */
const PAUSE_CODES = new Set(['DISCONNECTED', 'QUOTA', 'RATE_LIMITED']);
/** How many 403s inside one run before we treat it as a pattern. */
const BLOCK_LIMIT = Number(process.env.BROADCAST_BREAKER_BLOCKS ?? 8);

export class SendCircuitBreaker {
  private window: boolean[] = [];
  private consecutiveFailures = 0;
  private blockCount = 0;
  private coldReachoutCount = 0;
  private attempts = 0;
  private failures = 0;
  private tripped: BreakerVerdict | null = null;

  /** Record a successful send. */
  recordSuccess(): void {
    this.attempts += 1;
    this.consecutiveFailures = 0;
    this.push(true);
  }

  /**
   * Record a failure and get the verdict. Once tripped the breaker stays
   * tripped — a run that WhatsApp has started refusing does not get to talk
   * itself back into sending because the next two calls happened to work.
   */
  recordFailure(errorCode: string): BreakerVerdict {
    this.attempts += 1;
    this.failures += 1;
    this.consecutiveFailures += 1;
    this.push(false);

    if (errorCode === 'COLD_REACHOUT_463') this.coldReachoutCount += 1;
    if (errorCode === 'BLOCKED_403') this.blockCount += 1;

    const verdict = this.evaluate(errorCode);
    if (verdict.action === 'HALT' || verdict.action === 'PAUSE') this.tripped = verdict;
    return verdict;
  }

  /** Current verdict without recording anything — checked before each send. */
  peek(): BreakerVerdict {
    if (this.tripped) return this.tripped;
    return this.evaluate(null);
  }

  get stats() {
    return {
      attempts: this.attempts,
      failures: this.failures,
      failureRate: this.attempts ? this.failures / this.attempts : 0,
      consecutiveFailures: this.consecutiveFailures,
      blockCount: this.blockCount,
      coldReachoutCount: this.coldReachoutCount,
    };
  }

  private push(ok: boolean): void {
    this.window.push(ok);
    if (this.window.length > WINDOW_SIZE) this.window.shift();
  }

  private windowFailureRate(): number {
    if (this.window.length < 8) return 0; // too few samples to conclude anything
    const failed = this.window.filter((ok) => !ok).length;
    return failed / this.window.length;
  }

  private evaluate(errorCode: string | null): BreakerVerdict {
    // 1. Conclusive refusal from WhatsApp. Nothing else matters.
    if (errorCode && HALT_CODES.has(errorCode)) {
      return {
        action: 'HALT',
        slowdown: 1,
        code: errorCode,
        reason:
          'WhatsApp refused a message with error 463 (cold reachout). It has time-locked this number from ' +
          'messaging people who have not messaged it first. The campaign was stopped to protect the account — ' +
          'continuing would push it towards a permanent restriction.',
      };
    }
    if (this.coldReachoutCount > 0) {
      return {
        action: 'HALT',
        slowdown: 1,
        code: 'COLD_REACHOUT_463',
        reason: 'WhatsApp is refusing cold outreach from this number (error 463). The campaign was stopped.',
      };
    }

    // 2. Recipients blocking us in bulk.
    if (this.blockCount >= BLOCK_LIMIT) {
      return {
        action: 'HALT',
        slowdown: 1,
        code: 'MASS_BLOCK',
        reason:
          `${this.blockCount} recipients blocked this number during the campaign. ` +
          'That rate of blocks is what triggers a WhatsApp spam review — the campaign was stopped.',
      };
    }

    // 3. Transient conditions: park, do not punish the audience.
    if (errorCode && PAUSE_CODES.has(errorCode)) {
      return {
        action: 'PAUSE',
        slowdown: 1,
        code: errorCode,
        reason:
          errorCode === 'DISCONNECTED'
            ? 'WhatsApp disconnected mid-campaign. The run was paused so the remaining recipients are not marked as failed; it resumes automatically once the connection is back.'
            : 'The account reached its sending limit for now. The campaign was paused and resumes when the limit resets.',
      };
    }

    // 4. Something is broadly wrong — most sends are failing.
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      return {
        action: 'PAUSE',
        slowdown: 1,
        code: 'CONSECUTIVE_FAILURES',
        reason:
          `${this.consecutiveFailures} sends failed in a row. The campaign was paused rather than working through ` +
          'the rest of the audience — repeated refusals damage sender reputation.',
      };
    }

    const rate = this.windowFailureRate();
    if (rate >= WINDOW_FAILURE_HALT) {
      return {
        action: 'PAUSE',
        slowdown: 1,
        code: 'HIGH_FAILURE_RATE',
        reason: `${Math.round(rate * 100)}% of recent sends failed. The campaign was paused for review.`,
      };
    }
    if (rate >= WINDOW_FAILURE_SLOW) {
      return {
        action: 'SLOW_DOWN',
        slowdown: 2,
        code: 'ELEVATED_FAILURES',
        reason: `${Math.round(rate * 100)}% of recent sends failed — slowing delivery down.`,
      };
    }

    return { action: 'CONTINUE', slowdown: 1, code: null, reason: null };
  }
}
