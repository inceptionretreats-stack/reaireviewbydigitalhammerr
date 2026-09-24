# Robot artwork generation inputs

Both assets were produced with built-in image generation in **edit** mode. Original artwork is retained; the new assets are versioned siblings. The phone UI and six-step video animation remain code-rendered in `scripts/media/hero-review-walkthrough.html`.

Source art for the renders (`hero-review-scene-*.png`, `customer-reviewing-auth.png`) lives in `scripts/media/assets/`, which is not deployed. Only the finished account artwork is served from `apps/web/public/marketing/`.

## Hero scene

Edit target: `scripts/media/assets/hero-review-scene-v1.png`.
Style reference: `apps/web/public/marketing/ai-review-robot-mascot.png` — removed 24 Sep 2026 (unused; in git history).
Saved asset: `scripts/media/assets/hero-review-scene-v2.png`.

Final prompt:

Use case: precise-object-edit. Image 1 is the edit target: an existing square 1254x1254 website animation scene with a full upright black smartphone on the left and a woman in a blue shirt on the right. Image 2 is ONLY the existing robot style reference. Change ONLY the woman into the same friendly premium 3D Ai robot style as Image 2: glossy white rounded shell, black face display with cheerful cyan smiling eyes, cyan rim accents, black mechanical fingers, white articulated legs and feet. No human remains. Robot stands to the right of the phone, full head/body/feet visible, pointing a mechanical finger towards the phone like the original pose. Keep robot within the original woman's approximate native region x680–995 and y209–1105; do not cover the phone's white screen, top caption area or bottom step area. Do not copy the reference robot's review card or floating stars: the robot has no card or other prop, because the review stars will animate later in code. Preserve the original phone and blank white screen exactly, same coordinates, size, black bezel, notch, side buttons, straight orientation and shadows. Preserve the complete square composition and original pale-blue/white background, floor, lighting, soft shadows and clear margins. Native phone screen is approximately x257 y148 width421 height907; absolutely no new UI, letters or texture inside it, code will render the actual review screens. High-quality charming polished 3D render matching the site's existing mascot. No text, logos, watermark, humans, extra phones, extra limbs, tilt or cropped robot.

## Account artwork

Edit target: `scripts/media/assets/customer-reviewing-auth.png`.
Style reference: the new `scripts/media/assets/hero-review-scene-v2.png`.
Saved asset: `apps/web/public/marketing/robot-reviewing-auth-v1.png`.

Final prompt:

Precise-object-edit. Image 1 is the edit target: portrait 1024x1536 account page artwork with a woman seated at a café table looking at a smartphone. Image 2 is ONLY the robot character style reference from this same website. Replace ONLY the entire woman, including every human hand, hair, face, clothing and leg, with that same adorable premium 3D white Ai robot: glossy white rounded shell, black face screen, cheerful cyan smiling eyes, cyan glowing rims, black articulated fingers, white robotic arms/legs. Keep seated posture in the original person's approximate right-side region and complete head/body/knees visible. The friendly robot looks down at the small phone held naturally in its two mechanical hands, as in the original action. Do NOT add the huge phone from Image 2; keep only the original small handheld phone. No human remains, no human texture. Preserve the original café background, windows, greenery, pendant lights, table, coffee cup, wooden chair, warm natural lighting and portrait framing unchanged. Keep the top-left quarter mostly background as in the original for code-rendered text, and lower-right area free of new props for an existing caption card. No text, logos, watermarks, added cards, floating stars or extra limbs. A polished charming white/cyan robot integrated naturally into the real softly-lit café, consistent with the website's hero robot.
