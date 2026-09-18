import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Durable cursors let short serverless maintenance invocations resume without losing work. */
export const maintenanceJobs = pgTable('maintenance_jobs', {
  name: varchar('name', { length: 80 }).primaryKey(),
  state: jsonb('state').notNull().default({}),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
