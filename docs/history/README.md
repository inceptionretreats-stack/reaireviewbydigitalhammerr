# History

Dated records of what happened to the project: releases, production data changes, verification
results and reorganisations. Read these to understand why something is the way it is, or what was
verified on a given date. For how things work now, use the rest of [`docs/`](../README.md).

| Document                                                                  | What it is                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Changelog](changelog.md)                                                 | Dated notes on releases, live-data changes and verification, newest first |
| [2026-09-24 repository restructure](2026-09-24-repository-restructure.md) | Why the layout changed, with the full old → new path map                  |
| [2026-09-23 fresh-start reset](2026-09-23-fresh-start-reset.md)           | The owner-requested removal of all earlier production application data    |

How to read them:

- **Records are not edited to match later changes.** They quote file paths, component names,
  deployment IDs and counts as they were on the date. A path that no longer exists has probably
  moved; look it up in the [restructure path map](2026-09-24-repository-restructure.md).
- **"Verified live" means on that date.** A deployment named in a record may have been replaced
  since. Check the current deployment before relying on a live claim.
- **Add, don't rewrite.** Record a new release or decision as a new dated entry at the top of the
  [changelog](changelog.md), or as a new dated file here for a large event. Never include secrets,
  connection strings or personal data.
