import { JOB_NAMES } from '../../queue/names';
import { JobAbortedError, type JobContext, type JobHandler, type JobSummary } from '../types';
import type { PartitionStore } from './store';
import {
  DEFAULT_PARTITION_NAME,
  monthsToEnsure,
  partitionNameFor,
  planPartitionDrops,
} from './window';

/**
 * Monthly partition maintenance for analytics_events (AMENDMENT-012).
 *
 * Two responsibilities that pull in opposite directions, which is why they share a job: create
 * partitions far enough ahead that the DEFAULT one stays empty, and drop partitions once
 * 13_Security_Privacy_Compliance.md no longer permits keeping them.
 */

export interface PartitionMaintenanceOptions {
  monthsAhead: number;
  retentionMonths: number;
  /**
   * When false the job reports exactly what it would drop and drops nothing. See
   * WORKER_PARTITION_DROP_ENABLED in config.ts for why that is the default and why leaving it
   * there permanently is a compliance gap rather than a safe steady state.
   */
  dropEnabled: boolean;
  maxDropsPerRun: number;
}

export class PartitionMaintenanceJob implements JobHandler {
  readonly name = JOB_NAMES.analyticsPartitionMaintenance;

  constructor(
    private readonly store: PartitionStore,
    private readonly options: PartitionMaintenanceOptions,
  ) {}

  async run(context: JobContext): Promise<JobSummary> {
    const ensured = await this.ensureUpcomingPartitions(context);
    const defaultPartitionRows = await this.auditDefaultPartition(context);
    const retention = await this.enforceRetention(context);

    return {
      ensured: ensured.join(','),
      defaultPartitionRows,
      dropEnabled: this.options.dropEnabled,
      retentionMonths: this.options.retentionMonths,
      firstRetainedMonth: retention.firstRetainedMonth,
      dropped: retention.dropped.join(','),
      wouldDrop: retention.wouldDrop.join(','),
      deferred: retention.deferred.join(','),
    };
  }

  private async ensureUpcomingPartitions(context: JobContext): Promise<string[]> {
    const created: string[] = [];

    for (const month of monthsToEnsure(context.now, this.options.monthsAhead)) {
      if (context.signal.aborted) throw new JobAbortedError(this.name);

      const name = await this.store.ensurePartition(month);
      created.push(name);

      // The function is idempotent, so this only tells us the name it settled on. A mismatch
      // means the migration's naming and this module's have drifted apart, which would make
      // every retention decision meaningless.
      const expected = partitionNameFor(month);
      if (name !== expected) {
        context.logger.error(
          'partition naming disagrees with ensure_analytics_events_partition',
          new Error(`expected ${expected}, database created ${name}`),
          { expected, actual: name },
        );
      }
    }

    context.logger.info('analytics_events partitions ensured', {
      months: created.length,
      partitions: created.join(','),
    });

    return created;
  }

  /**
   * The DEFAULT partition exists only so an unexpected timestamp can never fail an insert and
   * break the customer flow (AC-035). Rows in it mean a month partition was missing when they
   * arrived — the maintenance job did not run, or did not run far enough ahead. It is a
   * warning, never an error state for the customer, and the partition is never dropped: doing
   * so would remove the safety net and delete undated events at the same time.
   */
  private async auditDefaultPartition(context: JobContext): Promise<number> {
    const rows = await this.store.countRows(DEFAULT_PARTITION_NAME);

    if (rows > 0) {
      context.logger.warn('events landed in the DEFAULT analytics partition', {
        partition: DEFAULT_PARTITION_NAME,
        rows,
        action: 'inspect occurred_at range, create the missing month partition, then move rows',
      });
    }

    return rows;
  }

  private async enforceRetention(context: JobContext): Promise<{
    firstRetainedMonth: string;
    dropped: string[];
    wouldDrop: string[];
    deferred: string[];
  }> {
    const partitions = await this.store.listPartitions();
    const plan = planPartitionDrops(
      partitions,
      context.now,
      this.options.retentionMonths,
      this.options.maxDropsPerRun,
    );

    const cutoff = `${plan.firstRetainedMonth.year}-${String(plan.firstRetainedMonth.month).padStart(2, '0')}`;

    if (plan.unrecognised.length > 0) {
      // Includes analytics_events_default every run, by design. Logged at debug so it is
      // visible when investigating without adding noise every night.
      context.logger.debug('partitions not considered for retention', {
        partitions: plan.unrecognised.join(','),
      });
    }

    const dropped: string[] = [];

    for (const partitionName of plan.drop) {
      if (context.signal.aborted) throw new JobAbortedError(this.name);

      const rows = await this.store.countRows(partitionName);

      // Logged BEFORE the drop, at warn, with everything needed to reconstruct the decision:
      // once the table is gone this line is the only record that it existed.
      context.logger.warn('dropping analytics_events partition past the retention window', {
        partition: partitionName,
        rows,
        retentionMonths: this.options.retentionMonths,
        firstRetainedMonth: cutoff,
        dryRun: !this.options.dropEnabled,
      });

      if (!this.options.dropEnabled) continue;

      await this.store.dropPartition(partitionName);
      dropped.push(partitionName);
      context.logger.warn('analytics_events partition dropped', { partition: partitionName, rows });
    }

    if (plan.deferred.length > 0) {
      context.logger.info('further partitions eligible, deferred by the per-run cap', {
        partitions: plan.deferred.join(','),
        maxDropsPerRun: this.options.maxDropsPerRun,
      });
    }

    return {
      firstRetainedMonth: cutoff,
      dropped,
      wouldDrop: this.options.dropEnabled ? [] : plan.drop,
      deferred: plan.deferred,
    };
  }
}
