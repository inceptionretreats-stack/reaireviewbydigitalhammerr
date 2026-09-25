# History

Dated records of what happened to the project: releases, production data changes, verification
results and reorganisations. Read these to understand why something is the way it is, or what was
verified on a given date. For how things work now, use the rest of [`docs/`](../README.md). For a
one-screen timeline, start with the milestone summary at the top of the [changelog](changelog.md).

| Document                                                                  | What it is                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Changelog](changelog.md)                                                 | A milestone summary, then dated notes on releases, live-data changes and verification, newest first |
| [2026-09-24 repository restructure](2026-09-24-repository-restructure.md) | Why the layout changed, with the full old → new path map                                            |
| [2026-09-23 Supabase cutover](2026-09-23-supabase-cutover.md)             | The evidence from moving the production database from Neon to Supabase                              |
| [2026-09-23 fresh-start reset](2026-09-23-fresh-start-reset.md)           | All earlier production application data removed at the project owner's request                      |
| [2026-09-17 Vercel deploy runbook](2026-09-17-vercel-deploy-runbook.md)   | The runbook behind the first Vercel deployment (Neon and Upstash era); superseded                   |

How to read them:

- **Records are not edited to match later changes.** They quote file paths, component names,
  deployment IDs and counts as they were on the date. A path that no longer exists has probably
  moved; look it up in the [restructure path map](2026-09-24-repository-restructure.md).
- **"Verified live" means on that date.** A deployment named in a record may have been replaced
  since. Check the current deployment before relying on a live claim.
- **"The owner" means the project owner,** the person who approves changes and deployments, unless
  the record says a business owner (see the [glossary](../glossary.md#owner)).
- **Some cited files are not in the repository, on purpose.** A few records name backups, one-off
  production scripts or evidence files that were never committed because they hold private data or
  are single-use tools for the live database. They are kept in the project owner's private backup
  folder outside the repository, `ai-review-private-backups/`:
  - database backups from the cutover and the reset, under
    `ai-review-private-backups/2026-09-23-supabase/`;
  - the one-off cutover, restore and reset scripts that records cite as `tmp/supabase/…` (for
    example `tmp/supabase/reset-application-data.mjs`), now under
    `ai-review-private-backups/2026-09-23-supabase/tooling/`;
  - the portable PostgreSQL client the cutover used, under `ai-review-private-backups/tools/`.

  Ask the project owner for access. Never recreate or rerun those scripts from a description: they
  are guarded against changed data and some are destructive. Other `tmp/` helpers named in dated
  records (for example `tmp/vendor-ui-*`) were local scratch files and no longer exist. Screenshots
  and browser evidence described as saved in a temporary folder were never kept as project files.

- **Add, don't rewrite.** Record a new release or decision as a new dated entry at the top of the
  [changelog](changelog.md), and add a line to the milestone summary for anything a non-developer
  would need to know. Use a new dated file here for a large event. Never include secrets, connection
  strings or personal data.
