# Digital Hammerr Super Admin Panel Specification

## Admin security
- Super-admin account only.
- MFA mandatory.
- Separate admin route and guard.
- Every mutation logged.
- Sensitive actions require reason.
- Support impersonation is read-only by default and visibly bannered.

## Admin dashboard KPIs
- Total businesses.
- Active businesses.
- Free businesses.
- Paid businesses.
- New signups today/7d/30d.
- Annual recurring billed value / collected revenue (do not call ARR if not accounting-correct).
- AI generations today/month.
- AI cost estimate.
- QR scans.
- Google opens.
- Private feedback count.
- Custom domains active/pending/error.
- Payment failures.
- Abuse alerts.
- System incident banner.

## Businesses list
Columns:
- Business name.
- Slug.
- Owner email/mobile.
- Category/city.
- Status.
- Plan.
- Free usage or paid usage warning.
- Subscription expiry.
- Custom domain.
- Created date.

Filters:
- Free/Pro.
- Active/suspended/draft.
- Expiring soon.
- High AI usage.
- Custom-domain errors.

Actions:
- Open details.
- Suspend/reactivate (reason required).
- Adjust free quota/entitlement (reason required).
- Send reset/invite email.
- Read-only support view.
- Never hard-delete in the primary list UI.

## Business detail tabs
1. Overview.
2. Owner/account.
3. Public profile config.
4. AI context/modes.
5. QR sources.
6. Analytics.
7. Subscription/payments.
8. Domain.
9. Usage/abuse.
10. Audit history.

## AI operations
Prompt Versions table:
- version.
- model.
- reasoning setting.
- created by.
- created date.
- status.
- rollout percent.
- evaluation score summary.

Actions:
- Create draft.
- Clone version.
- Test against eval set.
- Activate.
- Rollback.
- Archive.

Never allow a business owner to edit this system prompt.

## Platform settings
- Free generation limit (default 10).
- Annual price (₹999 -> 99900 paise).
- Fair-use warning thresholds.
- Generation rate limits.
- Available business categories.
- Allowed profile section types.
- Feature flags.
- Support/contact links.

## Payments
- Payment list.
- Verified webhook status.
- Provider IDs.
- Refund/support state if later implemented.
- Subscription start/end.
- Manual entitlement change must be visually distinct from paid entitlement.

## Abuse dashboard
Signals:
- generation spikes.
- repeated free-account creation patterns.
- unsafe AI context instructions.
- feedback spam.
- custom-domain abuse.

Admin actions:
- warn.
- temporary throttle.
- suspend AI only.
- suspend business.
- restore.

Every action requires an audit event.
