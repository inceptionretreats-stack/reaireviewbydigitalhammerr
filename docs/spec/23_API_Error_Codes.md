# API Error Codes

All errors use:
```json
{"error":{"code":"CODE","message":"Safe user-facing message","request_id":"...","details":{}}}
```

| Code | HTTP | Meaning |
|---|---:|---|
| AUTH_REQUIRED | 401 | Login required |
| AUTH_INVALID_CREDENTIALS | 401 | Invalid login |
| AUTH_RATE_LIMITED | 429 | Too many login attempts |
| FORBIDDEN | 403 | Authenticated but not authorized |
| TENANT_SCOPE_VIOLATION | 403 | Attempt to access another tenant resource |
| VALIDATION_FAILED | 422 | Input validation errors |
| RESOURCE_NOT_FOUND | 404 | Resource absent/inaccessible |
| SLUG_UNAVAILABLE | 409 | Business slug already reserved |
| BUSINESS_NOT_ACTIVE | 409 | Business cannot perform active-only operation |
| REVIEW_DESTINATION_INVALID | 422 | Invalid/unsupported review URL |
| PLAN_QUOTA_EXHAUSTED | 402 | Free lifetime or Pro annual AI-draft allowance exhausted |
| FAIR_USE_THROTTLED | 429 | Short-window paid abuse protection triggered |
| PUBLIC_RATE_LIMITED | 429 | Anonymous generation/feedback rate limit |
| AI_PROVIDER_UNAVAILABLE | 503 | AI provider temporary failure |
| AI_OUTPUT_REJECTED | 503 | AI quality/safety gate failed after retry |
| QR_NOT_FOUND | 404 | Unknown dynamic QR |
| QR_DISABLED | 410 | QR intentionally disabled |
| DOMAIN_ALREADY_CLAIMED | 409 | Custom hostname is bound elsewhere |
| DOMAIN_VERIFICATION_PENDING | 409 | DNS/TLS not active yet |
| PAYMENT_VERIFICATION_FAILED | 400 | Checkout/webhook signature invalid |
| PAYMENT_ALREADY_PROCESSED | 200 | Idempotent already-processed event |
| SUBSCRIPTION_NOT_ACTIVE | 402 | Paid entitlement unavailable |
| UPLOAD_INVALID | 422 | Asset type/size/content failed validation |
| ADMIN_REASON_REQUIRED | 422 | High-risk admin action missing reason |
| INTERNAL_ERROR | 500 | Unexpected server error; safe message only |

Provider/raw stack traces must never be returned to public clients.
