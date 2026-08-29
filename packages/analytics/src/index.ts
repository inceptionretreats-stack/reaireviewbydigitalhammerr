import {
  EVENT_NAMES,
  EVENT_SPECS,
  type EventName,
  type EventOptionalProps,
  type EventRequiredProps,
  type EventSpec,
} from './events.generated';

export { EVENT_NAMES, EVENT_SPECS };
export type { EventName, EventSpec, EventRequiredProps, EventOptionalProps };

export type PropertyValue = string | number | boolean | null;

/**
 * The payload shape for one event: every required property from the taxonomy, plus any of
 * its optional ones. Omitting a required property, or inventing a property the taxonomy does
 * not list, is a compile error — which is how AN-01-01 ("metric definitions match event
 * taxonomy") is held true in code rather than by review.
 */
export type EventPayload<E extends EventName> = Record<EventRequiredProps[E], PropertyValue> &
  Partial<Record<EventOptionalProps[E], PropertyValue>>;

export interface AnalyticsEventInput<E extends EventName = EventName> {
  name: E;
  properties: EventPayload<E>;
  occurredAt?: Date;
}

/**
 * Validates a payload against the taxonomy at runtime.
 *
 * The compile-time types cover first-party call sites; this covers the public ingestion
 * endpoint, where the payload arrives from a browser and must be treated as untrusted.
 * 02_System_Architecture.md requires the public event endpoint to accept allow-listed events
 * only.
 */
export function validateEvent(
  name: string,
  properties: Record<string, unknown>,
): { ok: true; name: EventName } | { ok: false; reason: string } {
  if (!isEventName(name)) {
    return { ok: false, reason: `Unknown event name: ${name}` };
  }

  const spec = EVENT_SPECS[name];
  const allowed = new Set<string>([...spec.required, ...spec.optional]);

  for (const required of spec.required) {
    if (properties[required] === undefined || properties[required] === null) {
      return { ok: false, reason: `Event ${name} is missing required property ${required}` };
    }
  }

  for (const key of Object.keys(properties)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `Event ${name} does not declare property ${key}` };
    }
  }

  return { ok: true, name };
}

export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Events that make up the customer funnel (01_Product_Scope_and_Roadmap.md goal 6).
 *
 * Note what this deliberately ends on. The funnel stops at google_open because that is the
 * last thing the platform can actually observe; D-028 and AC-025 forbid inferring submission
 * from it, and there is no event after it for that reason.
 */
export const FUNNEL_EVENTS = [
  'qr_scan',
  'review_page_view',
  'ai_generate_success',
  'review_copy',
  'google_open',
] as const satisfies readonly EventName[];

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
