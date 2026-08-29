# RBAC and Permissions

## Roles
- `PUBLIC`: anonymous customer/browser.
- `BUSINESS_OWNER`: full control of one business tenant in V1.
- `BUSINESS_SUPPORT_VIEWER` (optional internal support role): read-only support access, no payment/AI prompt/admin mutation.
- `SUPER_ADMIN`: Digital Hammerr platform administrator.

V1 intentionally avoids complex business team roles. Add manager/editor roles only after real demand.

## Permission matrix

| Capability | Public | Business Owner | Support Viewer | Super Admin |
|---|---:|---:|---:|---:|
| View enabled public business page | Yes | Yes | Yes | Yes |
| Generate customer AI review | Yes, rate/entitlement limited | Yes via public preview/test rules | No special bypass | Test tools only |
| Submit private feedback | Yes | Yes | No | No |
| Edit own business profile | No | Yes | No | Yes, audited support action |
| Configure AI context/modes | No | Yes | Read | Yes |
| See global system prompt | No | No | No | Yes |
| Manage QR sources | No | Yes | Read | Yes |
| View own analytics | No | Yes | Read | Yes |
| View another business analytics | No | No | No | Yes |
| Manage customers | No | Yes | Read | Yes |
| Manage custom domain | No | Yes | Read | Yes |
| Start/renew payment | No | Yes | No | Support view only unless explicit admin tool |
| Change platform price/quota | No | No | No | Yes |
| Suspend business | No | No | No | Yes |
| Reset quota/entitlement | No | No | No | Yes, reason required |
| Impersonate tenant | No | No | Read-only support session if enabled | Read-only by default, audited |
| View audit logs | No | Own security log subset later | No | Yes |

## Authorization rules
1. Authentication is not authorization. Every business mutation checks ownership on the server.
2. Never trust `business_id` from browser for scoping. Resolve active tenant from session and compare resource ownership.
3. Public QR code is an opaque locator, not an authorization token for private data.
4. Admin endpoints use separate middleware/guards and should be easy to isolate at network/logging level.
5. Admin high-risk actions require `reason` and are written to immutable audit logs.
6. Custom-domain hostname resolution can only return public tenant configuration.
