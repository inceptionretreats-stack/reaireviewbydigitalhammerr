# Recommended Repository Structure

Use a TypeScript monorepo so UI/API/workers can share schemas, event names and types without sharing privileged server code.

```text
ai-review/
├─ apps/
│  ├─ web/                       # Next.js public + business/admin UI
│  │  ├─ app/
│  │  │  ├─ (public)/
│  │  │  ├─ (auth)/
│  │  │  ├─ app/                # business dashboard routes
│  │  │  └─ admin/
│  │  ├─ components/
│  │  ├─ lib/
│  │  └─ tests/
│  ├─ api/                       # NestJS/Fastify REST service
│  │  └─ src/
│  │     ├─ auth/
│  │     ├─ businesses/
│  │     ├─ public/
│  │     ├─ ai/
│  │     ├─ qr/
│  │     ├─ profile/
│  │     ├─ customers/
│  │     ├─ feedback/
│  │     ├─ analytics/
│  │     ├─ domains/
│  │     ├─ subscriptions/
│  │     ├─ admin/
│  │     ├─ audit/
│  │     └─ common/
│  └─ worker/
│     └─ src/
│        ├─ analytics-aggregation/
│        ├─ custom-domains/
│        ├─ qr-export/
│        └─ retries/
├─ packages/
│  ├─ contracts/                 # Zod/OpenAPI/shared DTOs
│  ├─ database/                  # migrations/repositories/generated types
│  ├─ ui/                        # design system primitives
│  ├─ analytics/                 # event constants + schemas
│  ├─ ai/                        # prompt builder, output schemas, eval fixtures
│  ├─ config/
│  └─ eslint-config/
├─ infra/
│  ├─ terraform/                 # or chosen IaC
│  ├─ docker/
│  └─ monitoring/
├─ docs/
│  └─ (this developer pack)
├─ scripts/
│  ├─ seed.ts
│  ├─ aggregate.ts
│  └─ smoke.ts
├─ .github/workflows/
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md
```

## Code ownership boundaries
- Public UI may consume only public API contracts.
- AI provider key exists only in API/worker runtime.
- Payment secrets exist only in API/worker runtime.
- Database access is server-only.
- Shared `contracts` package contains no secrets/business logic that would weaken authorization.
