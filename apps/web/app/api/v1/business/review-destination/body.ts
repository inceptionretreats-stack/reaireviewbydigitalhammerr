/** Large enough for every Google share URL, while refusing an unbounded text payload. */
export const REVIEW_URL_MAX = 2048;

export type ReviewDestinationBody =
  { ok: true; url: string } | { ok: false; message: string; fields: ['url'] };

/** The structural boundary before the authoritative Google URL validator runs. */
export function readReviewDestinationBody(raw: unknown): ReviewDestinationBody {
  if (typeof raw !== 'object' || raw === null || !('url' in raw) || typeof raw.url !== 'string') {
    return {
      ok: false,
      message: 'Paste the full Google review link.',
      fields: ['url'],
    };
  }

  if (raw.url.length > REVIEW_URL_MAX) {
    return {
      ok: false,
      message: `Keep the Google review link to ${REVIEW_URL_MAX} characters or fewer.`,
      fields: ['url'],
    };
  }

  return { ok: true, url: raw.url };
}
