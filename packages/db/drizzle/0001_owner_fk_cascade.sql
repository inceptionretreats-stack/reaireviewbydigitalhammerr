-- AMENDMENT-015 — businesses.owner_user_id cascades on delete.
--
-- It was the only foreign key in the schema with no ON DELETE action, so removing a user raised
-- a constraint violation rather than removing the business beneath them. Flow J's irreversible
-- purge needs the cascade, and its absence also meant integration fixtures could not tear down.
ALTER TABLE "businesses" DROP CONSTRAINT "businesses_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

-- REMOVED BY HAND, and the reason matters:
--
-- drizzle-kit also emitted
--     ALTER TABLE "analytics_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (...)
-- because meta/0000_snapshot.json models analytics_events as an ordinary table — the partitioning
-- and the identity column in 0000 are hand-written DDL the Drizzle DSL cannot express, so they
-- are invisible to the differ. That column already IS an identity column, and applying the
-- statement fails outright.
--
-- This is precisely the drift scripts/check-migrations.mjs was written to guard, now observed in
-- the wild on the very next generated migration. The guard has been tightened to flag ANY
-- statement touching analytics_events in a generated migration, not only destructive ones.
