# Website content and licence audit

Reviewed 18 September 2026. This is a technical inventory, not a legal clearance
or a guarantee that every asset is free of third-party rights.

## Important distinction

Open source does not mean uncopyrighted. Software and fonts can be copyrighted
and licensed for commercial use subject to conditions. The practical aim is to
avoid **unlicensed third-party content**, not to remove required copyright
notices or claim all material is public domain.

## Newly added FAQ

- Questions and answers were written for Ai Review from this project's features
  and plan limits. The reference site's wording was not copied.
- The reference informed the general accordion / adjacent-image interaction.
  No reference screenshot pixels, third-party source code, branding, or stock
  graphics were incorporated.
- The five images are captures of this repository's rendered product with local
  demo/fixture data. They are not screenshots of the reference website. One of
  them, `faq/qr-setup.webp`, was later replaced in the FAQ by a generated
  illustration and removed on 24 September 2026 (it remains in git history).
- See [FAQ screenshot sources](faq-screenshot-sources.md) for each image's component,
  dimensions, capture conditions and data provenance.
- Example reviews are illustrative, not customer testimonials. Image alternative
  text identifies them as example product screens; visible captions were removed
  at the owner's request.
- New disclosure icons are simple inline SVG paths written in the component.
- This does not grant a new licence to the whole application or establish the
  ownership of pre-existing product code or branding.

## Fonts: verified open-source licences

| Font                       | Evidence                                                                                        | Result                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| DM Sans                    | `apps/web/assets/fonts/dm-sans-variable.ttf` name-table metadata agrees with `DM-Sans-OFL.txt`  | SIL Open Font License 1.1; retain its copyright/licence notice                                                                             |
| Inter SemiBold / ExtraBold | Both bundled WOFF name tables identify the Inter Project Authors, 2016, and the OFL licence URL | SIL Open Font License 1.1; `LICENSE.inter.txt` had an incorrect `Google Inc.` header, now corrected to the official Inter copyright notice |

The font files were not replaced or modified. Official sources checked:

- [DM Sans licence](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt)
- [Inter licence](https://github.com/rsms/inter/blob/master/LICENSE.txt)
- [Google Fonts commercial/open-source overview](https://developers.google.com/fonts)

## Business-category icons

The landing-page business strip uses `lucide-react` outline icons. Lucide's ISC
licence permits commercial use; icons derived from Feather carry the included
MIT notice. The package's licence text is retained in
`apps/web/public/licenses/lucide.txt` for the deployed site. These icons are
decorative; the business names remain text.

## Benefits-section photography (23 September 2026)

- `apps/web/public/marketing/benefits-local-shop-v1.webp` is an optimized copy
  of [Pexels photo 29834266 by Daniel & Hannah Snipes](https://www.pexels.com/photo/friendly-interaction-at-local-shop-counter-29834266/).
  The source page labels it free to use. [Pexels' licence](https://www.pexels.com/license/)
  permits commercial website use and modification without required attribution.
- The photo illustrates an ordinary shop-counter conversation. The depicted
  people are not Ai Review customers or endorsers; no testimonial, review
  total, or product-result claim is attached to their image.
- The nearby editable review draft is application-made example UI, disclosed on
  the page as an illustrative preview. It is not part of the source photo.

## Installed software: metadata audit, not full distribution clearance

Command: `pnpm --filter @ai-review/web... licenses list --prod --json`.
The installed production dependency graph reported 102 package entries:

| Declared licence                 | Entries |
| -------------------------------- | ------: |
| MIT                              |      76 |
| Apache-2.0                       |      10 |
| ISC                              |      11 |
| Apache-2.0 AND LGPL-3.0-or-later |       1 |
| CC-BY-4.0                        |       1 |
| Unlicense                        |       1 |
| BSD-3-Clause                     |       1 |
| 0BSD                             |       1 |

No unknown licence group appeared in this installed graph. This is not proof
that every transitive file, native binary or other platform's optional package
has been independently cleared. In particular:

- `@img/sharp-win32-x64` declares Apache-2.0 AND LGPL-3.0-or-later: preserve the
  native dependency notices and review redistribution conditions if packaging
  or distributing binaries.
- `caniuse-lite` declares CC-BY-4.0: retain applicable attribution.
- Direct runtime packages include MIT-licensed React, Next.js, QRCode, pg,
  ioredis and opentype.js, and Apache-2.0-licensed sharp and drizzle-orm.
- The installed drizzle-orm package declares Apache-2.0, but a top-level licence
  file was not located in this audit. Review the upstream licence/notice when
  preparing a redistributed software package.
- Do not remove upstream notices. Metadata alone is not a substitute for
  checking the final deployed/distributed bundle and its native dependencies.

## Existing media: owner confirmation and remaining evidence limits

On 18 September 2026, the owner explicitly confirmed commercial-use rights to
the existing robot artwork and shopkeeper promotional video, including its
voice and music. This records the owner's confirmation; it is not an independent
review of licences, generation terms or releases. Keep the underlying records.

| Assets / surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | What is known                                                                                                                                                                                                                                                                    | Unresolved                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Robot and scene artwork. Served: `apps/web/public/marketing/robot-reviewing-auth-v1.png`, `apps/web/public/marketing/ai-review-floating-robot-v1.png`. Render source art (not deployed): `scripts/media/assets/hero-review-scene-v1.png`, `hero-review-scene-v2.png`, `customer-reviewing-auth.png`, `digital-hammerr-agency-v1.png`. Removed 24 Sep 2026 (unused; in git history): `ai-review-robot-mascot.png`, `customer-review-hero-v4.png`, `hero-review-cafe-v1.png`, `hero-review-cafe-v2.png` | Present in the project; earlier requests asked for generated/robot imagery. Generation inputs for the robot scene and account artwork are in [robot artwork prompts](robot-artwork-prompts.md); the floating robot is in [marketing concept assets](marketing-concept-assets.md) | No complete generation receipts, source-image rights or commercial-use records found in the repository                             |
| `apps/web/public/marketing/hero-review-walkthrough-v3.*`, `apps/web/public/marketing/how-it-works/*-v5.*`                                                                                                                                                                                                                                                                                                                                                                                             | Repository contains HTML storyboards and rendering scripts in `scripts/media/`, with their source art in `scripts/media/assets/`                                                                                                                                                 | Those scripts use existing raster artwork; original artwork rights still require confirmation                                      |
| `apps/web/public/marketing/ai-review-customer-journey-v2-minimal-overlay.mp4` and its poster (parked: kept but not mounted; see [marketing material](../marketing/README.md)). Older story/customer-journey versions and posters were removed 24 Sep 2026 (unused; in git history)                                                                                                                                                                                                                    | User previously supplied a WhatsApp promotional video for editing                                                                                                                                                                                                                | Ownership or permission for video, performances, voices, music and any source footage is not established by possession of the file |
| Superseded marketing versions formerly in `apps/web/public/marketing`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Deleted on 24 September 2026 because nothing referenced them; git history keeps them. The parked story video above remains publicly addressable although not rendered                                                                                                            | Review rights before restoring any removed file from history                                                                       |
| Existing slogans and marketing copy outside the new FAQ                                                                                                                                                                                                                                                                                                                                                                                                                                               | Some were supplied by the user in earlier screenshots; source scan found no Interakt name/reference copy in current UI text                                                                                                                                                      | A local string search cannot certify originality or ownership of all existing copy                                                 |

Do not describe these older assets as "copyright-free" or "open source". The
specified robot artwork and shopkeeper video are used on the basis of the
owner's commercial-rights confirmation. Other legacy images/unused versions
not covered by that confirmation still need source records before reuse.
No old media was silently deleted or replaced during the 18 September audit. The
unused versions were removed later, on 24 September 2026, as part of a dead-code
cleanup; they can be recovered from git history.

## Provenance records

- [FAQ screenshot sources](faq-screenshot-sources.md): how each FAQ screenshot was captured.
- [Marketing concept assets](marketing-concept-assets.md): generation briefs for the
  23 September landing-page illustrations.
- [Robot artwork prompts](robot-artwork-prompts.md): edit targets, style references and
  final prompts for the robot scene and account artwork.

## Brand / trademark considerations

The website refers to Google and uses Google-like colours/lettering in several
existing visuals. Open-source font or code licences do not licence Google's
trademarks or imply a partnership. The new FAQ uses plain-text references to
Google and screenshots of the application's own controls, not Google UI.

Review the existing multicolour Google wordmark, robot insignia and promotional
video against [Google's brand guidance](https://about.google/brand-resource-center/guidance/).
Do not imply endorsement or claim that brand elements are public domain.

## Current status

FAQ provenance and font licences checked; Inter notice corrected. Commercial
rights to the existing robot artwork and shopkeeper video are **owner-confirmed**.
Independent documentation, other legacy assets and full-brand clearance remain
outside this verification. No production deployment was performed.
