# Instructions for AI coding agents

Read [AI_HANDOVER.md](AI_HANDOVER.md) before doing anything in this repository. It gives the reading
order, the ground rules and the owner's approved product decisions.

The rules that matter most:

- Run `git status --short` first and preserve changes you did not make. Never reset, clean, stash or
  blanket-stage.
- Ask the owner before generating a new migration; before running any migration, on any database
  (`pnpm dev:up` runs migrations on every start, against `DIRECT_DATABASE_URL` when it is set and
  `DATABASE_URL` otherwise); before running the seed, `pnpm test:integration` or `pnpm e2e` against
  the owner's local database, which the owner has not confirmed is disposable; before deploying;
  before provider, DNS, account or paid changes; before changing production data; before emailing
  or messaging real people; and before any destructive operation. A known issue or recommendation
  in the docs is not approval.
- Never copy, print or overwrite `.env` or any other `.env*` file except `.env.example`, and never
  copy anything under `.vercel/`. Refer to variables by name.
- Check the [commands with side effects](docs/operations/local-development.md#commands-with-side-effects)
  before running a `pnpm` script. `pnpm dev:up` opens a public tunnel and runs migrations;
  `pnpm dev` also starts the background worker.
- The product never posts reviews and never claims one was submitted or posted; do not add growth
  promises. User-facing casing is "Ai", not "AI".
- `docs/spec/` is frozen and applied migrations in `packages/db/drizzle/` are never edited.
- In `apps/web`, read the Next.js 16 guide in `apps/web/node_modules/next/dist/docs/` before writing
  code (see [apps/web/AGENTS.md](apps/web/AGENTS.md)).
