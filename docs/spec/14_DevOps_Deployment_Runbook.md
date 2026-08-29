# DevOps and Deployment Runbook

## Environments
- `local`
- `development`
- `staging`
- `production`

Never share production database/API keys with non-production.

## Branch / release model
- Protected `main`.
- Short-lived feature branches.
- Pull request required.
- CI: format -> lint -> typecheck -> unit -> integration -> build -> vulnerability scan.
- Staging deploy automatically after merge.
- Production deploy via explicit release approval/tag.

## Containers/services
- `web`: Next.js.
- `api`: NestJS/Fastify.
- `worker`: queues, analytics aggregation, custom-domain polling, asset exports.
- DB migrations run as a one-shot controlled task, never from every app replica on boot.

## Database
- PostgreSQL 18.x latest approved patch.
- Automated daily backups + point-in-time recovery where supported.
- Production deletion protection.
- Quarterly restore drill minimum; monthly preferred during early product phase.
- Migration rule: additive/backward-compatible first, code deploy, cleanup in later migration.

## Redis
Use for:
- rate-limit counters;
- queue backplane;
- QR/business public config cache;
- idempotency locks.
Redis is not the source of truth for subscriptions or business data.

## Observability
Metrics:
- HTTP request rate/errors/latency.
- AI request success/latency/token usage by prompt/model.
- generation cost estimate by business/plan.
- DB CPU/connections/slow queries.
- queue depth/age.
- Razorpay webhook failures.
- custom-domain verification failures.
- analytics ingestion lag.

Alerts:
- 5xx > threshold for 5 minutes.
- AI failure rate > threshold.
- webhook queue retry exhaustion.
- DB storage/CPU/connection pressure.
- certificate/custom-domain failures spike.
- suspicious generation burst.

## Deployment order
1. Run CI tests.
2. Backup/verify migration safety.
3. Deploy backward-compatible DB migration.
4. Deploy API/worker.
5. Deploy web.
6. Run smoke tests.
7. Monitor error/latency dashboards.
8. If rollback needed, roll back application first; DB rollback only if explicitly safe.

## Smoke tests
- Login.
- Dashboard loads.
- Test business public page.
- Dynamic QR resolves.
- AI test preview works.
- Public generation works on a staging paid tenant.
- Copy-confirm gate exists.
- External review link opens test/safe destination.
- Private feedback submits.
- Custom domain status endpoint works.
- Razorpay test webhook verifies.

## Cost controls
- Default AI model Luna; max output tightly capped.
- Store token usage per generation.
- CDN cache public assets/config.
- Aggregate analytics instead of running expensive raw event queries on every dashboard load.
- Alerts on per-tenant abnormal AI spend.

## Disaster recovery targets (initial)
- RPO target: <= 15 minutes for production data if infrastructure supports PITR.
- RTO target: <= 4 hours initially, improve as revenue/criticality grows.
