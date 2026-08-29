# V1 Release Checklist

## Product
- [ ] Frozen decisions match Decision Log.
- [ ] ₹999/year and 10 free generations approved in production config.
- [ ] All non-goals remain excluded or behind disabled flags.
- [ ] Customer experience confirmation wording approved.
- [ ] No rating-gating flow exists.

## UI/UX
- [ ] Figma customer mobile flow approved.
- [ ] Business dashboard approved.
- [ ] Loading/error/empty/expired states designed.
- [ ] WCAG AA review completed.
- [ ] Browser/device matrix tested.

## AI
- [ ] Production prompt version activated.
- [ ] 200+ scenario evaluation passed.
- [ ] Similarity/regeneration gate passed.
- [ ] Unsupported claim tests passed.
- [ ] Per-business quota/rate limits tested under concurrency.
- [ ] Token/cost telemetry visible.

## Payments
- [ ] Razorpay live account configured.
- [ ] Annual plan configured.
- [ ] Checkout signature verification tested.
- [ ] Webhook signature/idempotency tested.
- [ ] Renewal/expiry/failure states tested.
- [ ] Tax/invoice/accounting flow approved by finance/accountant.

## Domains
- [ ] `review.digitalhammerr.com` production TLS active.
- [ ] Custom domain provider configured.
- [ ] DNS instructions tested with at least 3 external domains.
- [ ] Certificate activation/removal tested.
- [ ] Canonical fallback verified.

## Security
- [ ] Admin MFA mandatory.
- [ ] IDOR/tenant isolation penetration tests passed.
- [ ] Auth rate limits enabled.
- [ ] Public AI/feedback WAF/rate limits enabled.
- [ ] Upload hardening tested.
- [ ] Secrets scan clean.
- [ ] Dependency/container scan clean or accepted risk documented.
- [ ] Backup restore test passed.

## Analytics
- [ ] Events match taxonomy.
- [ ] Funnel counts reconcile against test sessions.
- [ ] QR source attribution verified.
- [ ] No "review submitted" metric exists.
- [ ] Timezone handling verified.

## Legal/compliance
- [ ] Terms of Service live.
- [ ] Privacy Policy live.
- [ ] Acceptable Use Policy live.
- [ ] Refund/cancellation policy live.
- [ ] AI disclosure and genuine-experience confirmation live.
- [ ] Google review/fake-engagement policy review completed.

## Operations
- [ ] Monitoring/alerts active.
- [ ] On-call/escalation owner defined.
- [ ] Support email/contact working.
- [ ] Incident rollback procedure tested.
- [ ] Production runbook accessible to engineering.
- [ ] First 50-business onboarding/support plan defined.
