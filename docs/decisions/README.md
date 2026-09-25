# Decisions

Where the project's decisions are recorded: what has been decided and must be kept, what is still
waiting for the project owner, and how the original specification has been changed. Read this to
find the right record before changing product behaviour, pricing, website copy or operations, or
when a code comment cites a decision ID.

| Document                                  | What it records                                                                                    | Read it when                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Product decisions](product-decisions.md) | Approved decisions about the product, website, pricing, workspace and operations, not to be undone | Before changing the marketing site, pricing, the review flow or styles |
| [Open decisions](open-decisions.md)       | Business and operations decisions still waiting for the project owner, with their business impact  | Before any launch claim, and before touching payments, email or policy |
| [Spec amendments](spec-amendments.md)     | The formal change record for the frozen spec: every approved change and technical correction       | When a comment cites `CHANGE-`, `AMENDMENT-`, `ADR-AMEND-` or `OPEN-`  |

## How the records fit together

1. **The original spec** in [`docs/spec/`](../spec/README_FIRST.md) was delivered on 29 August 2026
   and last updated on 10 September 2026, when the 2,000-draft Pro cap and "Ai" casing were written
   into it. Its [decision log](../spec/22_Decision_Log.md) lists the product decisions: `D-001` to
   `D-029` are the originals, and `D-030` and `D-031` were added on 10 September 2026 with
   CHANGE-001 and CHANGE-002 (which also marked D-006, "fair-use unlimited", as superseded). The
   spec must not be edited now, so parts of it are out of date.
2. **[Spec amendments](spec-amendments.md)** records every later change to that spec. `CHANGE-`
   entries are product changes the project owner approved; `AMENDMENT-`, `ADR-AMEND-` and `OPEN-`
   entries are technical. The file opens with a status note saying which entries are superseded.
3. **[Product decisions](product-decisions.md)** is the short, current list of what must not be
   undone, including website and pricing choices that never needed a spec change.
4. **[Open decisions](open-decisions.md)** is what nobody may decide except the project owner.

The [glossary](../glossary.md#id-prefixes) explains every ID prefix and names the file that defines
it.

## The approved product changes in brief

| ID                                                                                                                   | Approved    | In plain words                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CHANGE-001](spec-amendments.md#change-001--pro-is-capped-at-2000-ai-review-drafts-per-subscription-year)            | 10 Sep 2026 | Pro, the only paid plan at ₹999 a year, allows up to 2,000 Ai drafts per paid year instead of "unlimited"                                            |
| [CHANGE-002](spec-amendments.md#change-002--user-facing-acronym-casing-is-ai)                                        | 10 Sep 2026 | Everything users read writes "Ai", not "AI"                                                                                                          |
| [CHANGE-003](spec-amendments.md#change-003--draft-language-is-a-per-business-setting-and-the-default-is-hinglish)    | 11 Sep 2026 | Each business chooses English or Hinglish drafts; Hinglish is the default                                                                            |
| [CHANGE-004](spec-amendments.md#change-004--nothing-per-business-by-hand-admin-panel-writing-rules-as-data-razorpay) | 11 Sep 2026 | Nothing is set up by hand per business: an admin console, Ai writing rules and prices stored as editable settings, and self-service Razorpay payment |

The only Ai cost analysis is at the end of
[spec amendments](spec-amendments.md#ai-unit-economics--verified). It is dated August 2026 and
prices a different Ai provider from the one production was last recorded using; re-check it before
any pricing decision (see [open decisions](open-decisions.md#ai-provider-and-running-cost)).
