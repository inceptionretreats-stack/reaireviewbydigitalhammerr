# Media rights

Records of where the website's images, videos, fonts and icons came from, and on what basis Ai
Review may use them. Read this before adding, replacing or reusing any marketing media, and when
someone asks "are we allowed to use this?". "Media rights" here means provenance and permission to
use: who made an asset, from what source, and under which licence or confirmation. These are
technical records kept by the team, not legal advice or a legal clearance.

The product's legal policies (privacy, terms, cancellation and refunds) are not here: they are pages
of the app under `/legal/`, listed in the [product overview](../product/README.md#legal-pages).

| Record                                                  | What it records                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Asset licence audit](asset-license-audit.md)           | The main record (18 September 2026, with later updates): font licences, icon and software licences, the licensed stock photo, the project owner's confirmation of rights to the robot artwork and shopkeeper video, and what is still unproven |
| [FAQ screenshot sources](faq-screenshot-sources.md)     | How each screenshot in the website's FAQ was captured from the product itself, with example data, and which are still in use                                                                                                                   |
| [Marketing concept assets](marketing-concept-assets.md) | The generation briefs for the Ai-generated landing-page illustrations of 23 September 2026, and which are still in use                                                                                                                         |
| [Robot artwork prompts](robot-artwork-prompts.md)       | The edit targets, style references and exact prompts used to generate the robot hero scene and the artwork on the sign-in and sign-up pages                                                                                                    |

## Where things stand

- **Fonts and icons** are open-source with commercial use allowed (SIL Open Font License for DM Sans
  and Inter; ISC and MIT for the Lucide icons). Their licence notices must be kept.
- **The benefits-section photo** is a Pexels stock photo whose licence allows commercial website
  use. The people in it are not customers or endorsers.
- **The robot artwork and the shopkeeper promotional video**, including its voice and music, are
  used on the basis of the project owner's confirmation of commercial rights on 18 September 2026.
  That is the project owner's confirmation, not independent proof; the underlying records should be
  kept.
- **The promotional video shown on the homepage** (`apps/web/public/marketing/ai-review-promo.mp4`
  and its poster `ai-review-promo-poster.webp`, mounted by
  `apps/web/components/marketing/home/PromoVideoSection.tsx` under the heading "Stop Losing
  Customers Because of Bad or Missing Reviews") has **no source or rights record** in this folder
  yet. It is a different file from the parked shopkeeper video, and no record says whether the 18
  September confirmation covers it.
- **The hero walkthrough video and the three How it works clips** that the homepage serves
  (`hero-review-walkthrough-v3.*` and `how-it-works/*-v5.*` under `apps/web/public/marketing/`) are
  rendered by the project's own scripts, but from existing artwork whose original rights the
  [asset licence audit](asset-license-audit.md) still lists as needing confirmation.
- **The FAQ screenshots** show the product's own screens with example data; they are not customer
  testimonials.
- **Other older images and removed versions** have no source records in the repository and need them
  before anyone reuses them.
- **Google's name and colours** appear on the site. Open-source licences do not grant any right to
  Google's trademarks or imply a partnership.

Whether a video is shown on the site is a separate question from the right to use it: the shopkeeper
video is kept off the site because its claims were never verified (see
[marketing material](../marketing/README.md)).

When media is added, replaced or removed, update the matching record here in the same change, so the
records keep describing what the site actually serves.
