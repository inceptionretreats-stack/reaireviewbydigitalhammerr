# AI Review by Digital Hammerr - Developer Pack

**Version:** 1.0  
**Frozen product scope date:** 29 August 2026  
**Primary product domain:** `review.digitalhammerr.com`  
**Target:** 10,000+ independent local businesses

This folder is the complete pre-development handoff for Version 1 of **AI Review by Digital Hammerr**.

## Read these files in this order

1. `00_Master_PRD_AI_Review.docx` - executive and functional master PRD.
2. `01_Product_Scope_and_Roadmap.md` - what is in V1, what is not, and phase boundaries.
3. `02_System_Architecture.md` - production architecture, scaling, reliability and technology choices.
4. `03_Screen_Field_Button_Spec.md` - every V1 screen, field, button, state and validation rule.
5. `04_User_Flows.md` - end-to-end business, customer, payment, QR and domain flows.
6. `05_RBAC_Permissions.md` - roles and permissions.
7. `06_Database_Schema.sql` - canonical PostgreSQL schema draft.
8. `07_ERD.mmd` - Mermaid ER diagram.
9. `08_OpenAPI_v1.yaml` - REST API contract draft.
10. `09_AI_Prompt_and_Generation_Spec.md` - AI behavior, compliance guardrails, generation and regeneration logic.
11. `10_AI_Prompt_Templates.json` - machine-readable prompt templates/config.
12. `11_Analytics_Event_Taxonomy.csv` - event names and required properties.
13. `12_QA_Acceptance_Criteria.md` - definition of done and acceptance criteria.
14. `13_Security_Privacy_Compliance.md` - security, privacy, abuse and Google-review-policy safeguards.
15. `14_DevOps_Deployment_Runbook.md` - environments, CI/CD, backups, monitoring and deployment.
16. `15_Environment_Variables.example` - configuration contract.
17. `16_Repository_Folder_Structure.md` - recommended monorepo layout.
18. `17_Backlog_Epics_User_Stories.md` - implementation backlog.
19. `18_UI_UX_Design_System_Brief.md` - UI/UX handoff for Figma/design.
20. `19_Admin_Panel_Spec.md` - Digital Hammerr super-admin requirements.
21. `20_Test_Data_Seed.json` - safe non-production seed data.
22. `21_Release_Checklist.md` - launch readiness checklist.
23. `22_Decision_Log.md` - product decisions already made; do not reopen without change approval.
24. `23_API_Error_Codes.md` - standardized error model.
25. `24_Glossary.md` - shared terminology.
26. `25_Architecture_Decisions_ADRs.md` - major architecture decisions and trade-offs.

## Frozen business decisions

- Brand: **AI Review by Digital Hammerr**.
- Market: local businesses first.
- Business onboarding: self-service and Digital Hammerr-assisted account creation.
- Public URL: `review.digitalhammerr.com/{businessSlug}`.
- QR landing: direct AI Review page.
- Customer account: never required.
- Customer questionnaire: none in V1.
- Star selection: only on the external review platform (Google primary).
- Private feedback: available to every visitor.
- Free plan: 10 lifetime AI generations per business.
- Paid plan: ₹999/year, all V1 features, fair-use unlimited AI generations.
- Language: English only in V1.
- Google Business Profile API: not in V1.
- WhatsApp API: not in V1. The business copies/opens a prefilled message and sends from its own number.
- CRM: simple review-request contact list only.
- Multi-location: not in V1.
- Employee attribution: not in V1.
- Physical product: QR standee only.
- Additional review platforms: optional link-driven buttons; hidden when no URL exists.
- Default public profile buttons: Google Review, WhatsApp, Call, Instagram, Facebook; business can hide/reorder.
- Dynamic QR: required.
- Custom business domains/subdomains: supported.
- White label: later phase.

## Engineering principle

The app must be simple enough for a local shop owner to configure in minutes, but architected as a proper multi-tenant SaaS. Every persistent business-owned row must carry `business_id` (directly or through a strict parent), every privileged action must be audited, and every public interaction must be event-tracked without claiming that a Google review was submitted when the platform cannot verify it.

## Compliance gate

The product is an **AI writing assistant for genuine customer feedback**, not a guaranteed-positive or fake-review engine. Merchant-configured terms are context, not mandatory review wording. The customer must be able to edit the draft, and before copying the final draft must confirm that it reflects their genuine experience.
