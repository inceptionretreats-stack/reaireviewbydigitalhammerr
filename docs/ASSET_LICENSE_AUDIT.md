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
  demo/fixture data. They are not screenshots of the reference website.
- See `apps/web/public/marketing/faq/SOURCES.md` for each image's component,
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

| Assets / surface                                                                                                                                                              | What is known                                                                                                               | Unresolved                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ai-review-robot-mascot.png`, `robot-reviewing-auth-v1.png`, `customer-review-hero-v4.png`, `digital-hammerr-agency-v1.png`, hero scene/cafe artwork and other marketing PNGs | Present in the project; earlier requests asked for generated/robot imagery                                                  | No complete generation receipts, source-image rights or commercial-use records found in the repository                             |
| `hero-review-walkthrough-v3.*`, `how-it-works/*-v5.*`                                                                                                                         | Repository contains HTML storyboards and rendering scripts                                                                  | Those scripts use existing raster artwork; original artwork rights still require confirmation                                      |
| `ai-review-customer-journey-v2-minimal-overlay.mp4` and related story/customer-journey versions/posters                                                                       | User previously supplied a WhatsApp promotional video for editing                                                           | Ownership or permission for video, performances, voices, music and any source footage is not established by possession of the file |
| Earlier unused marketing versions remaining in `public/marketing`                                                                                                             | Files remain publicly addressable even when not rendered on the homepage                                                    | Review their rights too; none were deleted as part of this audit                                                                   |
| Existing slogans and marketing copy outside the new FAQ                                                                                                                       | Some were supplied by the user in earlier screenshots; source scan found no Interakt name/reference copy in current UI text | A local string search cannot certify originality or ownership of all existing copy                                                 |

Do not describe these older assets as "copyright-free" or "open source". The
specified robot artwork and shopkeeper video are used on the basis of the
owner's commercial-rights confirmation. Other legacy images/unused versions
not covered by that confirmation still need source records before reuse.
No old media was silently deleted or replaced during this task.

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
