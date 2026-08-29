import type { PartitionStore } from './store';
import { partitionNameFor, type YearMonth } from './window';

/** In-memory partition catalogue, so the retention decision is testable without Postgres. */
export class MemoryPartitionStore implements PartitionStore {
  private readonly partitions = new Map<string, number>();
  readonly dropped: string[] = [];

  seed(partitionName: string, rowCount = 0): void {
    this.partitions.set(partitionName, rowCount);
  }

  ensurePartition(month: YearMonth): Promise<string> {
    const name = partitionNameFor(month);
    if (!this.partitions.has(name)) this.partitions.set(name, 0);
    return Promise.resolve(name);
  }

  listPartitions(): Promise<string[]> {
    return Promise.resolve([...this.partitions.keys()].sort());
  }

  countRows(partitionName: string): Promise<number> {
    return Promise.resolve(this.partitions.get(partitionName) ?? 0);
  }

  dropPartition(partitionName: string): Promise<void> {
    if (!this.partitions.has(partitionName)) {
      return Promise.reject(new Error(`No such partition: ${partitionName}`));
    }
    this.partitions.delete(partitionName);
    this.dropped.push(partitionName);
    return Promise.resolve();
  }

  has(partitionName: string): boolean {
    return this.partitions.has(partitionName);
  }
}
