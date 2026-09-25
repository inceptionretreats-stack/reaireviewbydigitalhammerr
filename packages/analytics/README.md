# @ai-review/analytics — the analytics event taxonomy

This package is the typed list of analytics events the product may record, with a validator for
untrusted payloads. Read it before adding an analytics call, touching the public events endpoint,
or changing anything that reads `analytics_events`.

## Where the events come from

The source of truth is the delivered CSV `docs/spec/11_Analytics_Event_Taxonomy.csv` (one row per
event: name, actor, trigger, required and optional properties). The TypeScript is generated from
it:

| File                             | Role                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/generate-events.ts`     | Generator. Reads the CSV and writes `src/events.generated.ts`.                   |
| `src/events.generated.ts`        | **Generated. Do not edit by hand.** `EVENT_NAMES`, `EVENT_SPECS`, property maps. |
| `src/index.ts`                   | Public API (below). Hand-written.                                                |
| `src/__tests__/taxonomy.test.ts` | Checks the generated names match the CSV and that validation rejects bad input.  |

Regenerate with:

```sh
pnpm --filter @ai-review/analytics generate
```

CI runs the same command and then `git diff --exit-code` on `src/events.generated.ts`, so a
hand edit, or a CSV change without regenerating, fails the build. The file is also listed in
`.prettierignore` (`*.generated.ts`), so do not reformat it.

`docs/spec/` is a frozen spec pack and is not edited. In practice the event list is fixed; adding
or changing an event is a specification change that must first be recorded in
[`docs/decisions/spec-amendments.md`](../../docs/decisions/spec-amendments.md).

## Public API (`@ai-review/analytics`)

| Export                            | Use                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `EVENT_NAMES`, `EventName`        | The allowed event names.                                                                 |
| `EVENT_SPECS`                     | Actor, trigger, required and optional properties for each event.                         |
| `EventPayload<E>`                 | Compile-time payload type: every required property, optional ones allowed, nothing else. |
| `validateEvent(name, properties)` | Runtime check for payloads from the browser (unknown name, missing or extra property).   |
| `isEventName(value)`              | Type guard.                                                                              |
| `FUNNEL_EVENTS`, `FunnelEvent`    | The customer funnel steps shown on the dashboard (hand-written in `src/index.ts`).       |

The funnel is `qr_scan` → `review_page_view` → `ai_generate_success` → `review_copy` →
`google_open`, and it deliberately ends at `google_open`. That is the last thing the product can
observe; it never knows whether a review was posted, and there is no event for it.

## Who uses it

- `apps/web/app/api/v1/public/events/route.ts` — the public ingestion endpoint (allow-listed
  events only).
- `apps/web/lib/analytics/` — dashboard metrics and queries.
- Route handlers that record server-side events (QR, subscription checkout/verify, Razorpay
  webhook, review requests).
- `apps/worker/src/jobs/analytics/metrics.ts` — the daily rollup.
