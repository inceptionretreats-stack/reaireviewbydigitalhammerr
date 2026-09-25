# Marketing material

Promotional material that is kept in the repository but is not part of the running product. Read it
before reusing the video script or bringing the parked story video back onto the site.

Related records live elsewhere:

- **Approved marketing rules** (the hero sentence supplied by the project owner, three-step How it
  works, the robot artwork, no fake customer logos, no unsupported claims, compact pricing cards):
  [product decisions](../decisions/product-decisions.md).
- **Where each image, video and font came from, and the right to use it:**
  [media rights](../media-rights/README.md).
- **The website's own text** is in the app's code, mostly under `apps/web/components/marketing/`;
  the legal pages are listed in the [product overview](../product/README.md#legal-pages).

## `promotional-video-hindi-script.txt`

A Hindi/Hinglish script for a 65–75 second vertical (9:16) promotional video: a shopkeeper (Aman)
asks a hurried customer (Riya) for a review, she scans the QR, gets an Ai-drafted review, confirms
it, copies it and opens Google. It lists scenes, dialogue, on-screen text and production directions
(straight full-frame phone, subtitles for every line, no automatic posting, the customer picks their
own star rating on Google).

It is a creative brief, not approved product copy. Parts of it do not match the current product: it
has no service-selection step (the live flow asks the customer to pick services, then to request a
draft explicitly), it labels the product's "New review" button "Shuffle", and it calls for a
"successful posting" sound effect, whereas the product never knows or claims that a review was
posted. Check any line against the [customer review flow](../features/customer-review-flow.md) and
the [product decisions](../decisions/product-decisions.md) before reusing it.

## The parked shopkeeper story video

| Piece     | Location                                                                             |
| --------- | ------------------------------------------------------------------------------------ |
| Component | `apps/web/components/marketing/parked/ReviewStoryVideo.tsx`                          |
| Video     | `apps/web/public/marketing/ai-review-customer-journey-v2-minimal-overlay.mp4`        |
| Poster    | `apps/web/public/marketing/ai-review-customer-journey-v2-minimal-overlay-poster.png` |

The component and its media are **kept but not mounted**: no page imports `ReviewStoryVideo`. It was
taken off the homepage because the claims and dialogue in the video were never verified against the
product. Because the files sit in `apps/web/public/`, they are still reachable by direct URL.

This is separate from the question of rights. On 18 September 2026 the project owner confirmed
commercial rights to the shopkeeper video, including its voice and music; that confirmation and its
limits are recorded in the [asset licence audit](../media-rights/asset-license-audit.md).

Do not mount it again without the project owner's approval and a check that everything it shows and
says matches the current product: no promise of more reviews, no claim that a review was posted, and
no star rating collected by the product.

The promotional video that **is** on the homepage is a different file,
`apps/web/public/marketing/ai-review-promo.mp4`, mounted by
`apps/web/components/marketing/home/PromoVideoSection.tsx`.
