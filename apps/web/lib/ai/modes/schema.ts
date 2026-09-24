/**
 * Request shapes for the AI-02 review-mode endpoints.
 *
 * Hand-written rather than Zod. `packages/contracts` carries no review-mode DTO yet and `zod` is
 * not a dependency of `@ai-review/web`, so importing it here would be an undeclared dependency;
 * `readLinks` in `api/v1/business/links/route.ts` already parses by hand for the same reason. The
 * limits below mirror the authoritative constraints rather than inventing new ones: `name`
 * varchar(80) and `description` varchar(500) from `packages/db/src/schema/ai.ts`, and the
 * thirty-terms-of-eighty cap `aiContextRequest` sets for the business context fields. A
 * `reviewModeRequest` belongs beside `aiContextRequest` in `packages/contracts`; until it exists
 * this module is the single definition of the wire shape and the client mirrors it.
 *
 * Notice which field is absent. Nothing here could make a mode mean "positive only", "5 star" or
 * "suppress negative" — 09_AI_Prompt_and_Generation_Spec.md forbids all three, and a mode carries a
 * name, a description and context terms and nothing that touches sentiment. Its absence from the
 * parser is what stops one being added by accident, exactly as `aiContextRequest` has no field for
 * mandatory keywords (D-025).
 */

/** varchar(80) on review_modes.name. */
export const MODE_NAME_MAX = 80;

/** varchar(500) on review_modes.description. */
export const MODE_DESCRIPTION_MAX = 500;

/** The caps `aiContextRequest` sets for services and context_terms, applied to a mode's terms. */
export const MODE_TERMS_MAX = 30;
export const MODE_TERM_LENGTH_MAX = 80;

/**
 * A rejection names the fields to highlight, which is what `details.fields` carries in the error
 * envelope (23_API_Error_Codes.md) and what `SubmitFailure` reads on the client.
 */
export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; message: string; fields: readonly string[] };

export interface CreateModeInput {
  name: string;
  description: string | null;
  contextTerms: string[];
}

/**
 * Every property is optional because PATCH is a partial update, but an absent property and an
 * explicit null are different requests: `description: null` clears the description while omitting
 * it leaves the stored one alone. `undefined` means absent so that distinction survives.
 */
export interface UpdateModeInput {
  name?: string;
  description?: string | null;
  contextTerms?: string[];
  isArchived?: boolean;
}

export function parseCreateMode(raw: unknown): ParseResult<CreateModeInput> {
  const body = asRecord(raw);
  if (!body) return malformed();

  const name = parseName(body.name, true);
  if (!name.ok) return name;

  const description = parseDescription(body.description);
  if (!description.ok) return description;

  const contextTerms = parseTerms(body.context_terms);
  if (!contextTerms.ok) return contextTerms;

  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      contextTerms: contextTerms.value ?? [],
    },
  };
}

export function parseUpdateMode(raw: unknown): ParseResult<UpdateModeInput> {
  const body = asRecord(raw);
  if (!body) return malformed();

  // Activation is deliberately not a field on this endpoint. AI-02-01 needs exactly one active
  // mode, which is one transaction that deactivates the current mode and activates the new one; a
  // general "set is_active" would be a second route to that invariant, and the second route is the
  // one that gets it wrong. Rejected loudly rather than ignored, because a client that sent the
  // field believes it changed something.
  if ('is_active' in body) {
    return {
      ok: false,
      message: 'Use the activate action to choose which mode is in use.',
      fields: ['is_active'],
    };
  }

  const value: UpdateModeInput = {};

  if ('name' in body) {
    const name = parseName(body.name, false);
    if (!name.ok) return name;
    value.name = name.value;
  }

  if ('description' in body) {
    const description = parseDescription(body.description);
    if (!description.ok) return description;
    value.description = description.value;
  }

  if ('context_terms' in body) {
    const contextTerms = parseTerms(body.context_terms);
    if (!contextTerms.ok) return contextTerms;
    value.contextTerms = contextTerms.value ?? [];
  }

  if ('is_archived' in body) {
    if (typeof body.is_archived !== 'boolean') {
      return {
        ok: false,
        message: 'Please check the details you entered.',
        fields: ['is_archived'],
      };
    }
    value.isArchived = body.is_archived;
  }

  // An empty patch is a client bug rather than a no-op to absorb: it would move updated_at and
  // report success while changing nothing the owner asked for.
  if (Object.keys(value).length === 0) {
    return { ok: false, message: 'There is nothing to change in this request.', fields: [] };
  }

  return { ok: true, value };
}

function parseName(raw: unknown, required: boolean): ParseResult<string> {
  if (typeof raw !== 'string') {
    return required
      ? { ok: false, message: 'Enter a name for this mode.', fields: ['name'] }
      : { ok: false, message: 'Please check the details you entered.', fields: ['name'] };
  }

  const name = collapseWhitespace(raw);
  if (name === '') return { ok: false, message: 'Enter a name for this mode.', fields: ['name'] };

  if (name.length > MODE_NAME_MAX) {
    return {
      ok: false,
      message: `Keep the mode name to ${MODE_NAME_MAX} characters or fewer.`,
      fields: ['name'],
    };
  }

  return { ok: true, value: name };
}

function parseDescription(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };

  if (typeof raw !== 'string') {
    return { ok: false, message: 'Please check the details you entered.', fields: ['description'] };
  }

  // Only the ends are trimmed. A description is prose, and collapsing its internal whitespace
  // would join deliberate line breaks into one paragraph.
  const description = raw.trim();
  if (description === '') return { ok: true, value: null };

  if (description.length > MODE_DESCRIPTION_MAX) {
    return {
      ok: false,
      message: `Keep the description to ${MODE_DESCRIPTION_MAX} characters or fewer.`,
      fields: ['description'],
    };
  }

  return { ok: true, value: description };
}

/**
 * Terms are normalized the way TagInput normalizes them client-side — whitespace collapsed, blanks
 * dropped, case-insensitive duplicates removed keeping the casing typed first — so a term pasted
 * out of a menu with a stray newline does not become a second distinct hint. The server repeats the
 * work rather than trusting it: the client is a convenience, not the boundary.
 */
function parseTerms(raw: unknown): ParseResult<string[] | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      message: 'Please check the details you entered.',
      fields: ['context_terms'],
    };
  }

  const terms: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return {
        ok: false,
        message: 'Please check the details you entered.',
        fields: ['context_terms'],
      };
    }

    const term = collapseWhitespace(entry);
    if (term === '') continue;

    if (term.length > MODE_TERM_LENGTH_MAX) {
      return {
        ok: false,
        message: `Keep each context term to ${MODE_TERM_LENGTH_MAX} characters or fewer.`,
        fields: ['context_terms'],
      };
    }

    const folded = term.toLocaleLowerCase();
    if (seen.has(folded)) continue;

    seen.add(folded);
    terms.push(term);
  }

  // Checked after de-duplication, so a list that only exceeds the cap because of repeats is
  // accepted rather than refused for a reason the owner cannot see on screen.
  if (terms.length > MODE_TERMS_MAX) {
    return {
      ok: false,
      message: `You can add up to ${MODE_TERMS_MAX} context terms.`,
      fields: ['context_terms'],
    };
  }

  return { ok: true, value: terms };
}

/**
 * Mirrors `normalizeTag` in `@ai-review/ui`, reimplemented so that a route handler need not import
 * a package whose entry point is full of client components.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function malformed<T>(): ParseResult<T> {
  return { ok: false, message: 'Malformed request body.', fields: [] };
}
