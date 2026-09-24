import { describe, expect, it } from 'vitest';
import { looksLikeLinkPreviewFetch } from '../link-preview';

/**
 * Telling a preview crawler apart from a customer (Flow F step 9).
 *
 * This matters more than it looks: WhatsApp fetches a pasted URL from the *sender's* device to build
 * its preview card, so without this the owner's own phone stamps `first_clicked_at` seconds after
 * preparing the message, and REQ-01 reports "link opened" for a customer who never touched it.
 */
describe('looksLikeLinkPreviewFetch', () => {
  it('detects the client that actually causes the problem', () => {
    expect(looksLikeLinkPreviewFetch('WhatsApp/2.23.20.0 A')).toBe(true);
  });

  it('detects the common social and search crawlers', () => {
    for (const agent of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'TelegramBot (like TwitterBot)',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ]) {
      expect(looksLikeLinkPreviewFetch(agent)).toBe(true);
    }
  });

  it('matches regardless of case, because user agents are not consistent about it', () => {
    expect(looksLikeLinkPreviewFetch('whatsapp/2.0')).toBe(true);
  });

  it('treats a real mobile browser as a person', () => {
    // The false positive is the expensive one: it discards a genuine customer's click silently.
    for (const agent of [
      'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    ]) {
      expect(looksLikeLinkPreviewFetch(agent)).toBe(false);
    }
  });

  it('treats a missing user agent as a person, not a bot', () => {
    // Privacy browsers and corporate proxies strip it; refusing to count those would under-report
    // real customers.
    expect(looksLikeLinkPreviewFetch(null)).toBe(false);
    expect(looksLikeLinkPreviewFetch('')).toBe(false);
  });

  it('treats a social app in-app browser as a person', () => {
    /*
     * The regression these pin. The list used to carry the bare app names `instagram`, `snapchat` and
     * `pinterest`, matched as substrings — and those apps put the app name in their in-app *browser*
     * user agent too, not only in their crawlers. So a customer who tapped the tracked link inside
     * the app was classified as a crawler and `record()` returned early: no `first_clicked_at`, no
     * `review_request_link_click`, no LINK_CLICKED. Tapping a link inside a social app is the ordinary
     * way this message gets opened, which makes it the expensive direction to be wrong in.
     */
    for (const agent of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.28.108 (iPhone14,5; iOS 17_4; en_IN)',
      'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 322.0.0.35.108 Android',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 Snapchat/12.79.0.44',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
    ]) {
      expect(looksLikeLinkPreviewFetch(agent)).toBe(false);
    }
  });

  it('still detects the bot-specific form of a dropped app name', () => {
    // Dropping the bare names must not lose the crawler: where a bot-exclusive string exists it is
    // matched instead, so a genuine preview fetch is still not counted as a customer.
    expect(
      looksLikeLinkPreviewFetch('Pinterestbot/1.0 (+https://www.pinterest.com/bot.html)'),
    ).toBe(true);
  });

  it('carries no token that a browser puts in its own user agent', () => {
    /*
     * The discipline of the list itself, asserted rather than trusted to review: every token has to be
     * crawler-exclusive, because a false positive silently discards a real click. A bare app name added
     * back to the list would match one of these real in-app-browser agents and fail here, which is the
     * check that was missing when `instagram` was added.
     */
    for (const agent of [
      // Chrome, Safari, Firefox, Samsung Internet, Edge, and the two in-app WebViews an Indian small
      // business's customers actually arrive in.
      'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
      'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 322.0.0.35.108 Android',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 Snapchat/12.79.0.44',
    ]) {
      expect(looksLikeLinkPreviewFetch(agent)).toBe(false);
    }
  });
});
