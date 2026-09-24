/**
 * Tells an automated link-preview fetch apart from a person opening the tracked link.
 *
 * This exists because of how the message actually travels. The owner pastes the tracked link into
 * WhatsApp; WhatsApp fetches the URL *from the sender's own device* to build the little preview card
 * before the message is even sent. Counted naively, `first_clicked_at` would be stamped by the
 * owner's phone seconds after they prepared the request, and REQ-01 would report "link opened" for
 * every customer who never touched it. Flow F step 9 is about the recipient opening the link; a
 * crawler is not the recipient.
 *
 * It is a heuristic, and the honest reading of it is: a fetch that names itself a preview bot is not
 * counted, and everything else is. False negatives (a bot that lies) inflate the count slightly;
 * false positives are what the token list is chosen to avoid, because every token in it is one no
 * browser — including an in-app browser — puts in its own user agent. The alternative, counting every
 * fetch, makes the one number on this screen wrong by default.
 *
 * Detected requests are still redirected normally. A crawler that receives a 302 to the review page
 * behaves exactly as it would have; only the write is skipped.
 */

/**
 * Lower-cased tokens matched as substrings of the user agent.
 *
 * Every entry has to be **crawler-exclusive**: a string no in-app browser puts in its own user agent.
 * That is the whole discipline of this list, and it is not a stylistic preference — a false positive
 * silently discards a real customer's click, which is the expensive direction to be wrong in.
 *
 * So the generic words are absent (`bot`, `crawler`, `spider`, `preview` on its own — vendor strings
 * have carried all four inside longer legitimate tokens), and so are the bare app names. `instagram`,
 * `snapchat` and `pinterest` were here and had to go: those apps' in-app *browsers* put the app name
 * in the user agent too (an Instagram WebView appends `Instagram <version>`), so a customer who tapped
 * the tracked link inside the app was classified as a crawler and their click was thrown away — no
 * `first_clicked_at`, no `review_request_link_click`, no LINK_CLICKED. Tapping a link inside a social
 * app is the ordinary way this message is opened, not an edge case. Where a bot-specific string exists
 * it is used instead (`pinterestbot`); Instagram and Snapchat previews are fetched by
 * `facebookexternalhit` and by generic fetchers, so nothing is lost by dropping them.
 *
 * `whatsapp` stays, and it is the one entry that carries any risk. It is also the entry this module
 * exists for: WhatsApp fetches a pasted URL from the *sender's* device, so without it every prepared
 * request reports "link opened" seconds later. WhatsApp's in-app browser is a plain WebView that does
 * not name the app, so the token is still crawler-exclusive in practice. If that ever changes, the
 * fix is the version-suffixed form (`whatsapp/`), not dropping the check.
 */
const PREVIEW_AGENT_TOKENS: readonly string[] = [
  'whatsapp',
  'facebookexternalhit',
  'facebookcatalog',
  'telegrambot',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'skypeuripreview',
  'pinterestbot',
  'redditbot',
  'googlebot',
  'google-inspectiontool',
  'bingbot',
  'yandexbot',
  'duckduckbot',
  'applebot',
  'embedly',
  'quora link preview',
  'vkshare',
];

export function looksLikeLinkPreviewFetch(userAgent: string | null): boolean {
  // An absent user agent is treated as a person, not a bot. Some privacy browsers and corporate
  // proxies strip it, and refusing to count those visits would silently under-report real customers.
  if (!userAgent) return false;

  const agent = userAgent.toLowerCase();
  return PREVIEW_AGENT_TOKENS.some((token) => agent.includes(token));
}
