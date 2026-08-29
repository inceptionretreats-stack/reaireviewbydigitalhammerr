# Architecture Decision Records (Condensed)

## ADR-001 - Multi-tenant single application/database
**Decision:** Use one SaaS application and shared PostgreSQL cluster with strict tenant keys, not one database per small business.  
**Why:** 10,000+ low-ARPU tenants require operational efficiency.  
**Guardrail:** strict server-side tenant scoping, tests for IDOR, tenant-aware indexes.

## ADR-002 - Separate public dynamic QR code from business slug
**Decision:** QR encodes opaque `/r/{code}`, never direct Google URL or slug.  
**Why:** destination/slug/domain may change; physical standee must remain valid.

## ADR-003 - No Google Business Profile API in V1
**Decision:** Use merchant-pasted Google review URL only.  
**Why:** faster launch, less OAuth/API complexity, matches approved scope.  
**Consequence:** cannot verify review submission; analytics stops at Google Open.

## ADR-004 - No WhatsApp API in V1
**Decision:** prepare/copy/deep-link message; merchant manually sends.  
**Why:** avoids API templates/cost/approval complexity and fits ₹999/year economics.

## ADR-005 - PostgreSQL + append-only event analytics
**Decision:** operational data and event source in Postgres initially; daily aggregate table for dashboards.  
**Why:** enough for 10,000+ businesses without premature data warehouse.  
**Trigger to revisit:** raw event volume/dashboard latency becomes a material bottleneck.

## ADR-006 - Prompt/model config is database-managed
**Decision:** prompt versions and model selection are admin data with activation/rollback.  
**Why:** AI quality changes faster than application releases.

## ADR-007 - GPT-5.6 Luna default
**Decision:** cost-sensitive high-volume model for short review drafts; canary/fallback to Terra only where justified.  
**Why:** supports plan economics and current OpenAI guidance for high-volume workloads.  
**Guardrail:** eval suite before model/prompt changes.

## ADR-008 - Customer confirmation before copy
**Decision:** require "I confirm this draft reflects my genuine experience" before Copy.  
**Why:** V1 collects no customer-specific experience input; this creates an essential compliance/UX checkpoint and keeps the text editable.

## ADR-009 - Cloudflare custom-hostname abstraction
**Decision:** implement a provider adapter around custom hostnames/TLS. Initial provider recommendation: Cloudflare for SaaS.  
**Why:** automatic TLS and thousands of customer hostnames are hard to operate manually.  
**Guardrail:** do not couple DB state to provider-specific response shapes.

## ADR-010 - AWS Mumbai core deployment
**Decision:** host core API/data near primary Indian market; CDN remains global.  
**Why:** latency, mature managed services and operational scalability.  
**Consequence:** infrastructure cost is higher than hobby PaaS but predictable and enterprise-ready.

## ADR-011 - One ₹999 paid plan
**Decision:** entitlements are simple: Free vs Pro; feature flags exist for rollout but not multiple commercial tiers in V1.  
**Why:** approved business model and lower sales/support complexity.
