# FAQ screenshot provenance

Captured on 2026-09-18 from this repository's rendered application at
`http://127.0.0.1:3000`, using installed Chrome through Playwright. These are
screenshots of the existing product interface, not third-party reference images,
generated artwork, or reconstructed product mockups.

| Asset                  | Dimensions  | Rendered source                                                                                                                                                        |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qr-setup.webp`        | 1620 × 2199 | `/app/qr`, page heading and complete branded standee/download panel from `components/dashboard/qr/QrSourcesScreen.tsx` and `components/shared/qr/QrStandeePreview.tsx` |
| `edit-review.webp`     | 1080 × 1714 | `/demo-south-cafe/review`, complete named customer editor from `components/customer/review/ReviewFlow.tsx`                                                             |
| `google-handoff.webp`  | 1080 × 1782 | `/demo-south-cafe/review`, complete named customer editor in confirmed/copied state from `components/customer/review/ReviewFlow.tsx`                                   |
| `change-location.webp` | 1500 × 1704 | Complete `components/dashboard/profile/ReviewLocationCard.tsx`, rendered with example props in a temporary local preview route                                         |
| `plans.webp`           | 2640 × 1338 | `/#pricing`, complete final white-card `PricingPlanCards` from `components/marketing/pricing/PricingPlanCards.tsx`                                                     |

Component paths above are relative to `apps/web`.

## Capture conditions

- The local seeded demo business was used for the QR and customer-editor views.
  Dashboard captures show no account credentials or personal customer information.
- Review generation and public event requests were intercepted with local
  fixtures, following `e2e/customer-review-visual.spec.ts`. The generated draft
  was edited through the normal textarea, and its experience checkbox was checked
  through the normal control. The handoff image shows the application's actual
  successful-copy state, using a local clipboard stub and a local destination
  fixture. No review was posted and no external destination was contacted.
- Dashboard sign-in was used only to read the existing demo QR interface. No
  business setting was saved.
- The location image renders the unchanged production `ReviewLocationCard`
  component with example props: `initialUrl` and `initialOpenUrl` set to
  `https://g.page/r/ExampleBusiness/review`, `initialKind="composer"`,
  `initialEnabled=true`, and `disabled=false`. The normal input was then filled
  with `https://g.page/r/ExampleNewShop/review` to show the editable form before
  Save. Neither Save nor Open was clicked. This is an illustrative component
  state, not evidence of a real verified or updated Google listing. The local
  database's existing destination was unchanged.
- That location capture used a temporary `/faq-asset-preview` route importing
  the actual component, with a server-side `notFound()` guard outside development.
  The temporary page and client wrapper were removed after capture; no preview
  route is part of the delivered site. No product markup was reconstructed.
- Routes that write analytics during server rendering (`/r/{code}` and
  `/{slug}/feedback`) were blocked. No migrations, seeds, provider requests,
  downloads, business mutations, or production operations were performed.
- Next.js development chrome was hidden for capture. Product content and states
  were not visually replaced. All five final images are lossless WebP conversions
  of original PNG captures. Sharp performed cropping and lossless encoding only:
  no image was upscaled or resampled in the final conversion.
- The final QR and complete location-form captures used a 540 × 1100 browser
  viewport at 3× pixel density. QR includes the real page heading, source heading,
  whole standee, artwork description, and both download controls. The location
  card is 500 CSS pixels wide and is captured in its entirety.
- The review editor used a 650 × 1000 browser viewport at 2× density, with a
  540 CSS-pixel-wide article. Each final image includes the complete article:
  business identity, editor, confirmation, actions, feedback link, and footer.
- Pricing was refreshed after the shared production cards received their final
  white-card layout, blue Pro border, and actions above the feature lists.
  It used a 964 × 1100 viewport at 3× density, capturing the complete
  880 CSS-pixel-wide two-column panel. Its actual feature-list text
  is 16 CSS pixels. The image shows both cards and all prices, limits, features,
  and account actions, with no external heading included. No screenshot-specific
  changes were made to product markup or typography.
- No pixels from the user's layout reference, external stock images, or other
  websites were incorporated into these screenshot assets. Brand names and
  typography are the same ones already rendered by the repository's interface.

Capture validation reported no application runtime errors, console errors, or
unexpected write requests. The temporary capture script and original PNG images
were kept outside the repository.
