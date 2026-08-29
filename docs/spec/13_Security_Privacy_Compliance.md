# Security, Privacy and Review-Policy Compliance

## Security baseline
- HTTPS only; HSTS after domain rollout is validated.
- Secure, HttpOnly, SameSite session cookies; no auth token in localStorage.
- Argon2id password hashing with environment-calibrated cost.
- MFA for Digital Hammerr super-admin accounts is mandatory.
- CSRF defense for cookie-authenticated mutations.
- Strict tenant authorization on every private resource.
- Server-side input validation using shared schemas.
- Parameterized DB access; no string-built SQL from user input.
- File upload allow-list by content magic bytes, MIME, max size and image re-encoding where feasible.
- Secrets stored in managed secret store, never committed.
- Central request ID; structured logs; PII redaction.
- WAF/rate limiting on public AI/feedback/auth endpoints.
- Dependency/SCA and container scanning in CI.
- Database backups encrypted; restore test required.

## PII minimization
Collect only what V1 needs:
- Business owner: name, email, mobile.
- Manual CRM contact: name, mobile, optional email, optional visit date/note.
- Private feedback: message; name/mobile optional.
- Public anonymous session: randomized token and privacy-preserving hashes; avoid storing raw IP longer than required for security controls.

## Data retention recommendation
- Anonymous raw event-level data: 13 months by default, then aggregate/delete unless justified.
- Security logs: 90-180 days depending on infrastructure need.
- Deleted CRM contacts: purge personal fields after grace period while keeping non-identifying audit facts if legally/operationally required.
- Closed business data: defined grace period before purge; payment/accounting records retained as legally required.

## Google review safeguards
Current Google guidance permits businesses to share a review link/QR, including in-store and via WhatsApp, but reviews must reflect genuine experiences. Google's fake-engagement policy can lead to review removal and Business Profile restrictions.

Product rules:
1. Never offer rewards/discounts for a review.
2. Never ask for a 5-star review.
3. Never route only positive users to Google or hide Google from unhappy users.
4. Do not force merchant-chosen words into every review.
5. AI text is an editable draft; customer confirmation of genuine experience is required before Copy.
6. Private Feedback is an equal option for every visitor.
7. Never automatically post a customer review.
8. Never claim Google submission/verification when the app only knows that Google was opened.
9. Do not scrape or simulate reviews.

## Merchant context risk
Because V1 intentionally asks customers no questions, merchant context cannot be treated as evidence of what the customer experienced. The AI must use low-claim language and avoid invented specifics. If user research later shows low utility, the compliant improvement is an optional one-line/voice customer input, not stronger merchant-controlled fake specificity.

## Abuse/fraud signals
- Hundreds of generations from one IP with no normal navigation/copy behavior.
- Free businesses creating repeated accounts/domains to reset quota.
- Very high regeneration loops.
- Prompt/context containing instructions like "always say 5 stars", competitor attacks, illegal content or fake testimonials.
- Custom domains failing ownership validation.

Admin should be able to warn, throttle or suspend abusive tenants with an audited reason.

## Legal documents required before public launch
- Terms of Service.
- Privacy Policy.
- Acceptable Use Policy.
- AI-assisted review disclosure.
- Refund/cancellation policy for annual plan.
- Data deletion/contact mechanism.
- QR standee purchase terms if physical sales are online.

Have Indian counsel review final legal language before launch; this PRD is an engineering/product document, not legal advice.
