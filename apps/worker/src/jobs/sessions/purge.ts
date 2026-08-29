import { SessionService } from '@ai-review/core';
import type { Database } from '@ai-review/db';
import { JOB_NAMES } from '../../queue/names';
import type { JobContext, JobHandler, JobSummary } from '../types';

/**
 * Expired session purge (AMENDMENT-001).
 *
 * Storage hygiene, not a security control: SessionService.resolve already refuses any session
 * past its expiry, so a row surviving here is inert. That is why deletion runs behind a grace
 * period instead of at the exact expiry instant — SET-01 shows the owner their sessions, and a
 * device that dropped off yesterday is more useful in that list than absent from it.
 *
 * Revoked-but-unexpired rows are deliberately left alone. They still carry revokedReason,
 * which is what makes "you were logged out because your password changed" answerable
 * (13_Security_Privacy_Compliance.md), and they age out on their own expiry.
 */

export interface SessionPurgeOptions {
  graceDays: number;
}

export class SessionPurgeJob implements JobHandler {
  readonly name = JOB_NAMES.sessionPurge;

  constructor(
    private readonly sessions: SessionService,
    private readonly options: SessionPurgeOptions,
  ) {}

  static fromDatabase(db: Database, options: SessionPurgeOptions): SessionPurgeJob {
    return new SessionPurgeJob(new SessionService(db), options);
  }

  async run(context: JobContext): Promise<JobSummary> {
    const cutoff = new Date(context.now.getTime() - this.options.graceDays * 86_400_000);
    const purged = await this.sessions.purgeExpired(cutoff);

    context.logger.info('expired sessions purged', {
      purged,
      cutoff: cutoff.toISOString(),
      graceDays: this.options.graceDays,
    });

    return { purged, cutoff: cutoff.toISOString() };
  }
}
